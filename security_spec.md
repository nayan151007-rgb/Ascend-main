# Ascend — Firestore Zero-Trust Security Specification (Phase 0 & Red Team Audit)

## 1. Data Invariants & Master Sources of Truth
1. **Global Default-Deny:** Any path not explicitly matched under `/databases/{database}/documents` is unconditionally denied (`allow read, write: if false;`).
2. **Verified Identity Mandate:** Every write operation (`create`, `update`, `delete`) across every collection requires `isSignedIn()` AND `request.auth.token.email_verified == true`.
3. **PII Split Isolation (`/users/{userId}` vs `/users/{userId}/private/{docId}`):**
   - Public display profiles (`/users/{userId}`) NEVER store `email`, phone numbers, or addresses.
   - Sensitive PII (`email`) is strictly isolated in `/users/{userId}/private/{docId}` where `docId == 'info'`, gated by parent existence (`exists(/databases/$(database)/documents/users/$(userId))`) and strict owner-only `get`/`create`/`update` (`request.auth.uid == userId`). `list` and `delete` on private PII docs are denied.
4. **Master Gate Relational Sync (`/chats/{chatId}/messages/{messageId}`):**
   - Unbounded chat turns are stored in a subcollection rather than an unbounded array.
   - Every operation on `/chats/{chatId}/messages/{messageId}` verifies ownership against the parent `/chats/$(chatId)` document via `get(/databases/$(database)/documents/chats/$(chatId)).data.ownerId == request.auth.uid`.
5. **Strict Blueprint Validation & Anti-Update-Gap:**
   - Every `create` and `update` invokes its standalone `isValid[Entity](incoming())` helper enforcing `hasAll`, `hasOnly`, exact field types, regex ID guards (`^[a-zA-Z0-9_\-]+$`), string `.size()` bounds, and bounded list sizes (`sourceLinks.size() <= 6`, `conceptNodes.size() <= 10`).
   - Every `update` wraps `isValid[Entity](incoming())`, enforces action-based `incoming().diff(existing()).affectedKeys().hasOnly(...)`, preserves immutable fields (`ownerId`, `uid`, `createdAt`), and requires `incoming().updatedAt == request.time`.
6. **Terminal State Locking (`/scores/{scoreId}`):**
   - Mission scores are created directly in terminal state `status == 'completed'` and lock all subsequent updates (`allow update: if false;`).
7. **Secure List Queries (Zero Client Delegation / Zero O(n) `get()` in `list`):**
   - `/briefings` and `/chats` enforce `allow list: if isSignedIn() && resource.data.ownerId == request.auth.uid;`.
   - `/scores` allows authenticated leaderboard queries strictly when `resource.data.status == 'completed'` and `request.query.limit <= 20` (no PII present).

---

## 2. The "Dirty Dozen" Adversarial Payloads

| # | Pillar Targeted | Target Path & Op | Malicious Payload | Expected Result |
|---|---|---|---|---|
| 1 | Pillar 1: Master Gate Bypass | `create /chats/foreignChat/messages/msg1` | `{ chatId: "foreignChat", ownerId: "attackerUid", role: "user", content: "Injected", createdAt: SERVER_TIMESTAMP }` | `PERMISSION_DENIED` (parent chat owned by `victimUid`) |
| 2 | Pillar 2: Shadow Field Create | `create /briefings/b1` | Valid briefing fields + `{ isAdmin: true }` | `PERMISSION_DENIED` (`hasOnly` rejects ghost key) |
| 3 | Pillar 2: Update-Gap Value Poisoning | `update /briefings/b1` | `{ saved: "not-a-boolean", updatedAt: SERVER_TIMESTAMP }` | `PERMISSION_DENIED` (`isValidCloudBriefing` rejects non-bool) |
| 4 | Pillar 3: Path ID Poisoning | `create /briefings/bad$id!spaces` | Valid briefing payload with invalid document ID chars | `PERMISSION_DENIED` (`isValidId` regex guard) |
| 5 | Pillar 4: Immutable Owner Hijack | `update /briefings/b1` | `{ ownerId: "otherUser", saved: true, updatedAt: SERVER_TIMESTAMP }` | `PERMISSION_DENIED` (`affectedKeys` + `ownerId` immutability) |
| 6 | Pillar 5: Unbounded Array Exhaustion | `create /briefings/b1` | `conceptNodes` array with 25 items (limit is 10) | `PERMISSION_DENIED` (`conceptNodes.size() <= 10`) |
| 7 | Pillar 6: PII Cross-User Read | `get /users/victimUid/private/info` | Authenticated as `attackerUid` reading `victimUid` email | `PERMISSION_DENIED` (`isOwner(userId)` fails) |
| 8 | Pillar 6: Email Spoofing (Unverified) | `create /users/attackerUid` | Token has `email_verified: false` | `PERMISSION_DENIED` (`isVerifiedUser()` fails) |
| 9 | Pillar 7: Orphaned Subcollection Write | `create /users/attackerUid/private/info` | Parent `/users/attackerUid` does not exist yet | `PERMISSION_DENIED` (parent `existsAfter`/`exists` gate) |
| 10 | Pillar 8: Unfiltered Collection Scrape | `list /briefings` (no `where('ownerId', '==', uid)`) | Authenticated attacker queries entire `/briefings` collection | `PERMISSION_DENIED` (`resource.data.ownerId == request.auth.uid`) |
| 11 | Temporal Spoofing | `create /chats/c1` | `{ ..., createdAt: Timestamp.fromMillis(946684800000) }` | `PERMISSION_DENIED` (`incoming().createdAt == request.time`) |
| 12 | Terminal State Mutation | `update /scores/s1` | `{ score: 999999 }` on completed score record | `PERMISSION_DENIED` (`allow update: if false` terminal lock) |

---

## 3. Red Team Audit Conflict Report

- **`/users/{userId}`**:
  - Identity Spoofing: Blocked (`userId == request.auth.uid && incoming().uid == request.auth.uid`).
  - Shadow Update: Blocked (`hasOnly` + `affectedKeys().hasOnly(['displayName', 'photoURL', 'updatedAt'])`).
  - Resource Poisoning: Blocked (`isValidId(userId)`, `displayName.size() <= 80`, `photoURL.size() <= 500`).
- **`/users/{userId}/private/{docId}`**:
  - PII Blanket Leak: Blocked (`allow get: if isOwner(userId); allow list: if false;`).
  - Orphaned PII Record: Blocked (`existsAfter(/databases/$(database)/documents/users/$(userId))`).
- **`/briefings/{briefingId}`**:
  - Query Trust Leak: Blocked (`allow list: if isSignedIn() && resource.data.ownerId == request.auth.uid;`).
  - Value Poisoning on Update: Blocked (`isValidCloudBriefing(incoming())` wraps `allow update`).
- **`/chats/{chatId}` & `/chats/{chatId}/messages/{messageId}`**:
  - Relational Sync: Enforced via `get(/databases/$(database)/documents/chats/$(chatId)).data.ownerId == request.auth.uid`.
- **`/scores/{scoreId}`**:
  - State Shortcutting / Tampering: Blocked (`status == 'completed'`, `score >= 0 && score <= 1000000`, `allow update: if false`).
