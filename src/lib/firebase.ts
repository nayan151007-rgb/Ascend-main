import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  collection,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  where,
  limit,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type { LibraryItem } from '../types/research';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// Mandatory boot connection check per firebase-integration-rpc
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Defensive ID and string bounds matching firebase-blueprint.json verbatim
const VALID_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

export function sanitizeDocId(rawId: string): string {
  const cleaned = rawId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120);
  if (cleaned.length >= 1 && VALID_ID_REGEX.test(cleaned)) {
    return cleaned;
  }
  return `doc-${Date.now()}`;
}

function clampString(val: string, minLen: number, maxLen: number, fallback = 'N/A'): string {
  const trimmed = (val || '').trim();
  const base = trimmed.length >= minLen ? trimmed : fallback;
  return base.slice(0, maxLen);
}

// ---------------------------------------------------------------------------
// Google Authentication + Split-Collection Profile Sync
// ---------------------------------------------------------------------------
export async function signInResearcherWithGoogle(): Promise<User> {
  const credential = await signInWithPopup(auth, googleProvider);
  await syncUserProfile(credential.user);
  return credential.user;
}

export async function signOutResearcher(): Promise<void> {
  await signOut(auth);
}

export { onAuthStateChanged, type User };

export async function syncUserProfile(user: User): Promise<void> {
  if (!user.emailVerified || !user.email) return;
  const uid = sanitizeDocId(user.uid);
  const publicPath = `users/${uid}`;
  const privatePath = `users/${uid}/private/info`;

  const publicRef = doc(db, 'users', uid);
  const privateRef = doc(db, 'users', uid, 'private', 'info');

  let existingSnap;
  try {
    existingSnap = await getDoc(publicRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, publicPath);
  }

  const displayName = clampString(
    user.displayName || user.email.split('@')[0] || 'Researcher',
    1,
    80,
    'Researcher'
  );
  const photoURL = (user.photoURL || '').trim().slice(0, 500);
  const email = user.email.trim().slice(0, 160);

  if (!existingSnap.exists()) {
    try {
      const batch = writeBatch(db);
      batch.set(publicRef, {
        uid,
        displayName,
        photoURL,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(privateRef, {
        uid,
        email,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `${publicPath} + ${privatePath}`);
    }
  } else {
    try {
      await updateDoc(publicRef, {
        displayName,
        photoURL,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, publicPath);
    }
  }
}

// ---------------------------------------------------------------------------
// Cloud Briefings Persistence (`/briefings/{briefingId}`)
// ---------------------------------------------------------------------------
export async function upsertCloudBriefing(user: User, item: LibraryItem): Promise<void> {
  if (!user.emailVerified) return;
  const uid = sanitizeDocId(user.uid);
  const docId = sanitizeDocId(`${uid.slice(0, 24)}_${item.id}`);
  const path = `briefings/${docId}`;
  const ref = doc(db, 'briefings', docId);

  const findSection = (title: string) =>
    item.sections.find((s) => s.title.toLowerCase() === title.toLowerCase())?.body || '';

  const sourceLinks = item.sources
    .slice(0, 6)
    .map((s) => `${s.title} (${s.year ?? 'n.d.'}) — ${s.url}`.slice(0, 400));

  const conceptNodes = (item.graph?.nodes || [item.query])
    .slice(0, 10)
    .map((n) => clampString(n, 1, 80, 'Concept'));

  const payloadBase = {
    summary: clampString(item.summary, 1, 3000),
    background: clampString(findSection('Background'), 1, 2400),
    keyMethods: clampString(findSection('Key methods'), 1, 2400),
    recentFindings: clampString(findSection('Recent findings'), 1, 2400),
    openQuestions: clampString(findSection('Open questions'), 1, 2400),
    sourceLinks,
    conceptNodes,
    saved: Boolean(item.saved),
    updatedAt: serverTimestamp(),
  };

  let snap;
  try {
    snap = await getDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (!snap.exists()) {
    try {
      await setDoc(ref, {
        ownerId: uid,
        query: clampString(item.query, 3, 200, 'Research Topic'),
        ...payloadBase,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  } else {
    try {
      await updateDoc(ref, payloadBase);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }
}

export async function removeCloudBriefing(user: User, itemId: string): Promise<void> {
  if (!user.emailVerified) return;
  const uid = sanitizeDocId(user.uid);
  const docId = sanitizeDocId(`${uid.slice(0, 24)}_${itemId}`);
  const path = `briefings/${docId}`;
  try {
    await deleteDoc(doc(db, 'briefings', docId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export interface CloudBriefingSummary {
  docId: string;
  query: string;
  summary: string;
  background: string;
  keyMethods: string;
  recentFindings: string;
  openQuestions: string;
  sourceLinks: string[];
  conceptNodes: string[];
  saved: boolean;
  createdAtIso: string;
}

export function subscribeUserCloudBriefings(
  user: User,
  onUpdate: (items: CloudBriefingSummary[]) => void
): Unsubscribe {
  const uid = sanitizeDocId(user.uid);
  const q = query(collection(db, 'briefings'), where('ownerId', '==', uid), limit(40));

  return onSnapshot(
    q,
    (snapshot) => {
      const records: Array<CloudBriefingSummary & { sortMs: number }> = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        const ts = d.createdAt instanceof Timestamp ? d.createdAt.toMillis() : Date.now();
        records.push({
          docId: docSnap.id,
          query: String(d.query || ''),
          summary: String(d.summary || ''),
          background: String(d.background || ''),
          keyMethods: String(d.keyMethods || ''),
          recentFindings: String(d.recentFindings || ''),
          openQuestions: String(d.openQuestions || ''),
          sourceLinks: Array.isArray(d.sourceLinks) ? d.sourceLinks.map(String) : [],
          conceptNodes: Array.isArray(d.conceptNodes) ? d.conceptNodes.map(String) : [],
          saved: Boolean(d.saved),
          createdAtIso: new Date(ts).toISOString(),
          sortMs: ts,
        });
      });
      records.sort((a, b) => b.sortMs - a.sortMs);
      onUpdate(records);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'briefings');
    }
  );
}

// ---------------------------------------------------------------------------
// Multi-Turn Chat Thread & Message Subcollection Sync (`/chats/{chatId}/messages/{messageId}`)
// ---------------------------------------------------------------------------
export async function recordChatExchangeToCloud(
  user: User,
  chatIdRaw: string,
  title: string,
  model: 'gemini-3.8-flash' | 'gemini-3.1-flash-lite' | 'gemini-4-argon',
  turnCount: number,
  userPrompt: string,
  assistantReply: string
): Promise<void> {
  if (!user.emailVerified) return;
  const uid = sanitizeDocId(user.uid);
  const chatId = sanitizeDocId(chatIdRaw);
  const chatPath = `chats/${chatId}`;
  const chatRef = doc(db, 'chats', chatId);

  let chatSnap;
  try {
    chatSnap = await getDoc(chatRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, chatPath);
  }

  const msgBaseId = `${Date.now()}`;
  const userMsgRef = doc(db, 'chats', chatId, 'messages', sanitizeDocId(`u_${msgBaseId}`));
  const modelMsgRef = doc(db, 'chats', chatId, 'messages', sanitizeDocId(`m_${msgBaseId}`));

  try {
    const batch = writeBatch(db);
    if (!chatSnap.exists()) {
      batch.set(chatRef, {
        ownerId: uid,
        title: clampString(title, 1, 120, 'Research Inquiry'),
        model,
        turnCount: Math.max(1, Math.min(500, Math.floor(turnCount))),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.update(chatRef, {
        title: clampString(title, 1, 120, 'Research Inquiry'),
        model,
        turnCount: Math.max(1, Math.min(500, Math.floor(turnCount))),
        updatedAt: serverTimestamp(),
      });
    }

    batch.set(userMsgRef, {
      chatId,
      ownerId: uid,
      role: 'user',
      content: clampString(userPrompt, 1, 8000),
      createdAt: serverTimestamp(),
    });

    batch.set(modelMsgRef, {
      chatId,
      ownerId: uid,
      role: 'model',
      content: clampString(assistantReply, 1, 8000),
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${chatPath}/messages`);
  }
}

// ---------------------------------------------------------------------------
// 3D Orbital Simulation Leaderboard (`/scores/{scoreId}`)
// ---------------------------------------------------------------------------
export interface OrbitalLeaderboardEntry {
  id: string;
  pilotName: string;
  score: number;
  wave: number;
  createdAtIso: string;
}

export async function recordOrbitalMissionScore(
  user: User,
  score: number,
  wave: number
): Promise<void> {
  if (!user.emailVerified) return;
  const uid = sanitizeDocId(user.uid);
  const scoreId = sanitizeDocId(`sc_${uid.slice(0, 16)}_${Date.now()}`);
  const path = `scores/${scoreId}`;

  const pilotName = clampString(
    user.displayName || user.email?.split('@')[0] || 'Orbital Pilot',
    1,
    40,
    'Orbital Pilot'
  );

  try {
    await setDoc(doc(db, 'scores', scoreId), {
      ownerId: uid,
      pilotName,
      score: Math.max(0, Math.min(1_000_000, Math.round(score))),
      wave: Math.max(1, Math.min(99, Math.round(wave))),
      status: 'completed',
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export function subscribeOrbitalLeaderboard(
  user: User | null,
  onUpdate: (entries: OrbitalLeaderboardEntry[]) => void
): Unsubscribe | null {
  if (!user) return null;
  const q = query(collection(db, 'scores'), where('status', '==', 'completed'), limit(20));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: OrbitalLeaderboardEntry[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        const ts = d.createdAt instanceof Timestamp ? d.createdAt.toMillis() : Date.now();
        items.push({
          id: docSnap.id,
          pilotName: String(d.pilotName || 'Pilot'),
          score: Number(d.score || 0),
          wave: Number(d.wave || 1),
          createdAtIso: new Date(ts).toISOString(),
        });
      });
      items.sort((a, b) => b.score - a.score);
      onUpdate(items.slice(0, 8));
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'scores');
    }
  );
}
