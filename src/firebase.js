import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeFirestore, getFirestore } from 'firebase/firestore';

export const DEFAULT_COLLECTION = 'sports_prime';
export const DEFAULT_ATHLETE_ID = 'camilo';

const firebaseConfig = {
  apiKey: 'AIzaSyAgi9ftgGFYGG8UcaYQ_lw6haWY4p8NPLs',
  authDomain: 'dashboard-semanal-99c26.firebaseapp.com',
  projectId: 'dashboard-semanal-99c26',
  storageBucket: 'dashboard-semanal-99c26.firebasestorage.app',
  messagingSenderId: '484144858932',
  appId: '1:484144858932:web:3a4576805c9da39e65c761',
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

function createDb(firebaseApp) {
  try {
    return initializeFirestore(firebaseApp, { ignoreUndefinedProperties: true });
  } catch {
    return getFirestore(firebaseApp);
  }
}

export const db = createDb(app);

function cleanSegmentId(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed.includes('/') ||
    trimmed === '.' ||
    trimmed === '..' ||
    /^__.*__$/.test(trimmed)
  ) {
    return '';
  }
  return trimmed;
}

/**
 * Resolves the target Firestore collection and athlete document ID across
 * overrides, browser query params (`?testCollection=...&athlete=...`),
 * Vite env (`import.meta.env`), and Node (`process.env`), defaulting to `sports_prime/camilo`.
 */
export function getTargetContext(overrides = {}) {
  const searchParams =
    typeof window !== 'undefined' && typeof window.location?.search === 'string'
      ? new URLSearchParams(window.location.search)
      : null;

  const metaEnv = typeof import.meta !== 'undefined' ? import.meta.env : undefined;
  const procEnv = typeof process !== 'undefined' ? process.env : undefined;

  const collectionName =
    cleanSegmentId(overrides?.collectionName) ||
    cleanSegmentId(searchParams?.get('testCollection')) ||
    cleanSegmentId(metaEnv?.VITE_FIRESTORE_COLLECTION) ||
    cleanSegmentId(procEnv?.VITE_FIRESTORE_COLLECTION || procEnv?.FIRESTORE_COLLECTION) ||
    DEFAULT_COLLECTION;

  const athleteId =
    cleanSegmentId(overrides?.athleteId) ||
    cleanSegmentId(searchParams?.get('athlete')) ||
    cleanSegmentId(metaEnv?.VITE_ATHLETE_ID) ||
    cleanSegmentId(procEnv?.VITE_ATHLETE_ID || procEnv?.ATHLETE_ID) ||
    DEFAULT_ATHLETE_ID;

  return {
    collectionName,
    athleteId,
    isTestMode:
      collectionName !== DEFAULT_COLLECTION || athleteId !== DEFAULT_ATHLETE_ID,
  };
}
