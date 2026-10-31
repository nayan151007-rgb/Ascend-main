/**
 * Firestore Security Rules — Dirty Dozen Adversarial Verification Suite
 *
 * Verifies that all 12 Dirty Dozen payloads documented in `security_spec.md`
 * are rejected with PERMISSION_DENIED by `firestore.rules`.
 *
 * Run against the Firebase Local Emulator Suite (`firebase emulators:exec --only firestore ...`)
 * when `@firebase/rules-unit-testing` is installed in CI.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  pillar: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  auth: { uid: string; email: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expectedOutcome: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TEST_CASES: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Master Gate Bypass on foreign chat subcollection',
    pillar: 'Pillar 1: Master Gate',
    operation: 'create',
    path: 'chats/victim_chat_1/messages/msg_1',
    auth: { uid: 'attacker_uid', email: 'attacker@example.com', email_verified: true },
    payload: {
      chatId: 'victim_chat_1',
      ownerId: 'attacker_uid',
      role: 'user',
      content: 'Unauthorized message injection',
      createdAt: 'SERVER_TIMESTAMP',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Shadow Field injection on CloudBriefing creation',
    pillar: 'Pillar 2: Strict Keys (hasOnly)',
    operation: 'create',
    path: 'briefings/brief_1',
    auth: { uid: 'researcher_1', email: 'res@example.com', email_verified: true },
    payload: {
      ownerId: 'researcher_1',
      query: 'Quantum error correction',
      summary: 'Valid summary.',
      background: 'Valid background.',
      keyMethods: 'Valid methods.',
      recentFindings: 'Valid findings.',
      openQuestions: 'Valid questions.',
      sourceLinks: ['https://arxiv.org/abs/2401.00001'],
      conceptNodes: ['Surface Codes'],
      saved: true,
      isAdmin: true, // Ghost shadow field
      createdAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Update-Gap Value Poisoning on saved boolean',
    pillar: 'Pillar 2: Anti-Update-Gap',
    operation: 'update',
    path: 'briefings/brief_1',
    auth: { uid: 'researcher_1', email: 'res@example.com', email_verified: true },
    payload: {
      saved: 'malicious_string_instead_of_boolean',
      updatedAt: 'SERVER_TIMESTAMP',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Document ID Regex Poisoning',
    pillar: 'Pillar 3: Path Variable Hardening',
    operation: 'create',
    path: 'briefings/invalid$id!with!symbols',
    auth: { uid: 'researcher_1', email: 'res@example.com', email_verified: true },
    payload: { ownerId: 'researcher_1' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Immutable ownerId Hijack on Update',
    pillar: 'Pillar 4: Tiered Identity & Immutability',
    operation: 'update',
    path: 'briefings/brief_1',
    auth: { uid: 'researcher_1', email: 'res@example.com', email_verified: true },
    payload: {
      ownerId: 'hijacked_uid',
      saved: true,
      updatedAt: 'SERVER_TIMESTAMP',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Unbounded Array Exhaustion (>10 conceptNodes)',
    pillar: 'Pillar 5: Total Array Guarding',
    operation: 'create',
    path: 'briefings/brief_overflow',
    auth: { uid: 'researcher_1', email: 'res@example.com', email_verified: true },
    payload: {
      conceptNodes: Array.from({ length: 25 }, (_, i) => `Node_${i}`),
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Cross-User PII Email Read',
    pillar: 'Pillar 6: PII Split Isolation',
    operation: 'get',
    path: 'users/victim_uid/private/info',
    auth: { uid: 'attacker_uid', email: 'attacker@example.com', email_verified: true },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Unverified Email Write Attempt',
    pillar: 'Verified Identity Gate',
    operation: 'create',
    path: 'users/unverified_uid',
    auth: { uid: 'unverified_uid', email: 'spoof@example.com', email_verified: false },
    payload: {
      uid: 'unverified_uid',
      displayName: 'Spoofed Researcher',
      photoURL: '',
      createdAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Orphaned Private Info Write Without Parent User Doc',
    pillar: 'Pillar 7: Atomicity Guarantee (existsAfter)',
    operation: 'create',
    path: 'users/orphan_uid/private/info',
    auth: { uid: 'orphan_uid', email: 'orphan@example.com', email_verified: true },
    payload: {
      uid: 'orphan_uid',
      email: 'orphan@example.com',
      updatedAt: 'SERVER_TIMESTAMP',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Unfiltered Collection List Scrape on Briefings',
    pillar: 'Pillar 8: Secure List Queries',
    operation: 'list',
    path: 'briefings',
    auth: { uid: 'attacker_uid', email: 'attacker@example.com', email_verified: true },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Client-Forged Past Timestamp on Chat Creation',
    pillar: 'Temporal Integrity (request.time)',
    operation: 'create',
    path: 'chats/chat_forged',
    auth: { uid: 'researcher_1', email: 'res@example.com', email_verified: true },
    payload: {
      ownerId: 'researcher_1',
      title: 'Forged Time Thread',
      model: 'gemini-3.8-flash',
      turnCount: 1,
      createdAt: '2000-01-01T00:00:00Z',
      updatedAt: '2000-01-01T00:00:00Z',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Mutating Terminal Orbital Score Record',
    pillar: 'Terminal State Locking',
    operation: 'update',
    path: 'scores/score_1',
    auth: { uid: 'researcher_1', email: 'res@example.com', email_verified: true },
    payload: {
      score: 999999,
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
];
