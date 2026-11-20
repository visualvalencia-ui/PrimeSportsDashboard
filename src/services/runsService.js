import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
} from 'firebase/firestore';
import { db, getTargetContext } from '../firebase.js';

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

function parseNonNegativeCount(value, fallback) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return fallback;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallback;
  }
  return fallback;
}

function finiteOrZero(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function safeIsoString(value, fallbackMs = Date.now()) {
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return new Date(fallbackMs).toISOString();
}

function compareRunsDesc(a, b) {
  const aTime = Date.parse(a?.startedAt || a?.endedAt || '') || 0;
  const bTime = Date.parse(b?.startedAt || b?.endedAt || '') || 0;
  return bTime - aTime;
}

/**
 * Sanitizes a single GPS TrackPoint so Firestore never receives NaN/Infinity/undefined.
 */
export function sanitizePoint(pt) {
  if (!pt || typeof pt !== 'object') {
    return null;
  }
  const lat = Number(pt.lat);
  const lng = Number(pt.lng ?? pt.lon);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    return null;
  }

  return {
    lat,
    lng,
    ts: finiteOrZero(pt.ts),
    elapsedSec: finiteOrZero(pt.elapsedSec),
    acc: finiteOrNull(pt.acc ?? pt.accuracy),
  };
}

/**
 * Serializes TrackPoint[][] (or wrapped segments) into Firestore-safe
 * Array<{ index: number, points: TrackPoint[] }> (zero nested arrays).
 */
export function serializeSegments(segments) {
  if (!Array.isArray(segments)) {
    return [];
  }

  const out = [];
  for (const seg of segments) {
    const rawPts = Array.isArray(seg)
      ? seg
      : seg && Array.isArray(seg.points)
        ? seg.points
        : [];
    const pts = rawPts.map(sanitizePoint).filter(Boolean);
    if (pts.length > 0) {
      out.push({
        index: out.length,
        points: pts,
      });
    }
  }
  return out;
}

/**
 * Deserializes `{ index, points }[]`, `{ segmentIndex, points }[]`, raw `TrackPoint[][]`,
 * or flat `trackpoints[]` back into canonical `TrackPoint[][]`.
 */
export function deserializeSegments(rawSegments, fallbackTrackpoints = null) {
  if (Array.isArray(rawSegments) && rawSegments.length > 0) {
    const firstNonNull = rawSegments.find((item) => item !== null && item !== undefined);
    if (firstNonNull && !Array.isArray(firstNonNull) && Array.isArray(firstNonNull.points)) {
      const sorted = rawSegments
        .map((seg, arrIdx) => ({ seg, arrIdx }))
        .filter(({ seg }) => seg && Array.isArray(seg.points))
        .sort((a, b) => {
          const idxA = Number.isFinite(Number(a.seg.index))
            ? Number(a.seg.index)
            : Number.isFinite(Number(a.seg.segmentIndex))
              ? Number(a.seg.segmentIndex)
              : a.arrIdx;
          const idxB = Number.isFinite(Number(b.seg.index))
            ? Number(b.seg.index)
            : Number.isFinite(Number(b.seg.segmentIndex))
              ? Number(b.seg.segmentIndex)
              : b.arrIdx;
          return idxA - idxB;
        });

      return sorted
        .map(({ seg }) => seg.points.map(sanitizePoint).filter(Boolean))
        .filter((pts) => pts.length > 0);
    }

    return rawSegments
      .filter((seg) => Array.isArray(seg))
      .map((seg) => seg.map(sanitizePoint).filter(Boolean))
      .filter((pts) => pts.length > 0);
  }

  if (Array.isArray(fallbackTrackpoints) && fallbackTrackpoints.length > 0) {
    const pts = fallbackTrackpoints.map(sanitizePoint).filter(Boolean);
    return pts.length > 0 ? [pts] : [];
  }

  return [];
}

/**
 * Normalizes and serializes a RunActivity for Firestore persistence (no nested arrays, no undefined/NaN).
 */
export function serializeRunForFirestore(runActivity) {
  const nowMs = Date.now();
  const id = cleanSegmentId(runActivity?.id) || `run_${nowMs}`;
  const startedAt = safeIsoString(runActivity?.startedAt, nowMs);
  const endedAt = safeIsoString(runActivity?.endedAt, Date.parse(startedAt) || nowMs);
  const dateLocal =
    typeof runActivity?.dateLocal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(runActivity.dateLocal)
      ? runActivity.dateLocal
      : startedAt.slice(0, 10);

  const segments = serializeSegments(runActivity?.segments);
  const computedPointCount = segments.reduce((sum, s) => sum + s.points.length, 0);
  const pointCount = parseNonNegativeCount(runActivity?.pointCount, computedPointCount);

  const distanceMeters = Math.max(0, finiteOrZero(runActivity?.distanceMeters));
  const distanceKm = Math.max(0, finiteOrZero(runActivity?.distanceKm));
  const activeDurationSec = Math.max(0, Math.round(finiteOrZero(runActivity?.activeDurationSec)));
  const elapsedDurationSec = Math.max(
    activeDurationSec,
    Math.round(finiteOrZero(runActivity?.elapsedDurationSec ?? activeDurationSec))
  );
  const pausedDurationSec = Math.max(
    0,
    Math.round(
      finiteOrZero(
        runActivity?.pausedDurationSec ?? elapsedDurationSec - activeDurationSec
      )
    )
  );

  const rawBounds = runActivity?.bounds;
  const bounds =
    rawBounds &&
    typeof rawBounds === 'object' &&
    Number.isFinite(Number(rawBounds.minLat)) &&
    Number.isFinite(Number(rawBounds.maxLat)) &&
    Number.isFinite(Number(rawBounds.minLng)) &&
    Number.isFinite(Number(rawBounds.maxLng))
      ? {
          minLat: Number(rawBounds.minLat),
          maxLat: Number(rawBounds.maxLat),
          minLng: Number(rawBounds.minLng),
          maxLng: Number(rawBounds.maxLng),
        }
      : null;

  const splitsKm = Array.isArray(runActivity?.splitsKm)
    ? runActivity.splitsKm
        .filter((s) => s && typeof s === 'object' && Number.isFinite(Number(s.km)))
        .map((s) => ({
          km: Math.round(Number(s.km)),
          durationSec: Math.max(0, Math.round(finiteOrZero(s.durationSec))),
          paceMinPerKm: finiteOrNull(s.paceMinPerKm),
          paceFormatted:
            typeof s.paceFormatted === 'string' && s.paceFormatted
              ? s.paceFormatted
              : '--:-- /km',
        }))
    : [];

  const title =
    typeof runActivity?.title === 'string' && runActivity.title.trim()
      ? runActivity.title.trim()
      : `Carrera GPS - ${distanceKm.toFixed(2)} km`;

  return {
    schemaVersion: 1,
    id,
    source: 'gps_pwa',
    sport: 'running',
    status: 'completed',
    title,
    startedAt,
    endedAt,
    dateLocal,
    distanceMeters,
    distanceKm,
    activeDurationSec,
    elapsedDurationSec,
    pausedDurationSec,
    avgPaceMinPerKm: finiteOrNull(runActivity?.avgPaceMinPerKm),
    avgPaceFormatted:
      typeof runActivity?.avgPaceFormatted === 'string' && runActivity.avgPaceFormatted
        ? runActivity.avgPaceFormatted
        : '--:-- /km',
    avgSpeedKmh: Math.max(0, finiteOrZero(runActivity?.avgSpeedKmh)),
    pointCount,
    bounds,
    splitsKm,
    segments,
    notes: typeof runActivity?.notes === 'string' ? runActivity.notes : '',
  };
}

/**
 * Reconstructs canonical RunActivity (with `segments: TrackPoint[][]`) from Firestore data.
 */
export function deserializeRunFromFirestore(rawData, docId = '') {
  const data = rawData && typeof rawData === 'object' ? rawData : {};
  const id = cleanSegmentId(data.id) || cleanSegmentId(docId) || '';
  const segments = deserializeSegments(data.segments, data.trackpoints);
  const computedPointCount = segments.reduce((sum, seg) => sum + seg.length, 0);
  const distanceKm = Math.max(0, finiteOrZero(data.distanceKm));

  return {
    schemaVersion: Number.isFinite(Number(data.schemaVersion)) ? Number(data.schemaVersion) : 1,
    id,
    source: typeof data.source === 'string' && data.source ? data.source : 'gps_pwa',
    sport: typeof data.sport === 'string' && data.sport ? data.sport : 'running',
    status: typeof data.status === 'string' && data.status ? data.status : 'completed',
    title:
      typeof data.title === 'string' && data.title.trim()
        ? data.title.trim()
        : `Carrera GPS - ${distanceKm.toFixed(2)} km`,
    startedAt: safeIsoString(data.startedAt),
    endedAt: safeIsoString(data.endedAt ?? data.startedAt),
    dateLocal:
      typeof data.dateLocal === 'string' && data.dateLocal
        ? data.dateLocal
        : safeIsoString(data.startedAt).slice(0, 10),
    distanceMeters: Math.max(0, finiteOrZero(data.distanceMeters)),
    distanceKm,
    activeDurationSec: Math.max(0, Math.round(finiteOrZero(data.activeDurationSec))),
    elapsedDurationSec: Math.max(
      0,
      Math.round(finiteOrZero(data.elapsedDurationSec ?? data.activeDurationSec))
    ),
    pausedDurationSec: Math.max(0, Math.round(finiteOrZero(data.pausedDurationSec))),
    avgPaceMinPerKm: finiteOrNull(data.avgPaceMinPerKm),
    avgPaceFormatted:
      typeof data.avgPaceFormatted === 'string' && data.avgPaceFormatted
        ? data.avgPaceFormatted
        : '--:-- /km',
    avgSpeedKmh: Math.max(0, finiteOrZero(data.avgSpeedKmh)),
    pointCount: parseNonNegativeCount(data.pointCount, computedPointCount),
    bounds: data.bounds ?? null,
    splitsKm: Array.isArray(data.splitsKm) ? data.splitsKm : [],
    segments,
    notes: typeof data.notes === 'string' ? data.notes : '',
  };
}

/**
 * Builds the lightweight summary pushed to `{collection}/{athlete}.logs[]`.
 * Never includes `segments` or `trackpoints`.
 */
export function buildLogsSummaryEntry(run) {
  const distanceKm = Math.max(0, finiteOrZero(run?.distanceKm));
  const activeDurationSec = Math.max(0, Math.round(finiteOrZero(run?.activeDurationSec)));

  return {
    id: run.id,
    runId: run.id,
    date: run.endedAt || run.startedAt,
    type: 'cardio',
    source: 'gps_pwa',
    v1: distanceKm,
    v2: Math.round((activeDurationSec / 60) * 10) / 10,
    distanceKm,
    activeDurationSec,
    avgPaceMinPerKm: run.avgPaceMinPerKm ?? null,
    avgPaceFormatted: run.avgPaceFormatted || '--:-- /km',
    pointCount: parseNonNegativeCount(run?.pointCount, 0),
    notes: typeof run?.notes === 'string' ? run.notes : '',
  };
}

/**
 * Saves a RunActivity to `{collection}/{athlete}/runs/{runId}` and prepends a lightweight
 * summary into `{collection}/{athlete}.logs[]`.
 */
export async function saveRun(runActivity, targetCtx = undefined) {
  const ctx = getTargetContext(targetCtx);
  const serialized = serializeRunForFirestore(runActivity);
  if (!cleanSegmentId(serialized.id)) {
    throw new Error('Invalid run id');
  }

  const runRef = doc(db, ctx.collectionName, ctx.athleteId, 'runs', serialized.id);
  const athleteRef = doc(db, ctx.collectionName, ctx.athleteId);

  await setDoc(runRef, serialized);

  const canonical = deserializeRunFromFirestore(serialized, serialized.id);
  const summaryEntry = buildLogsSummaryEntry(canonical);

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(athleteRef);
      const existingLogs =
        snap.exists() && Array.isArray(snap.data().logs) ? snap.data().logs : [];
      const filtered = existingLogs.filter(
        (entry) => entry?.id !== serialized.id && entry?.runId !== serialized.id
      );
      tx.set(athleteRef, { logs: [summaryEntry, ...filtered] }, { merge: true });
    });
  } catch (err) {
    if (err?.code === 'unavailable') {
      const snap = await getDoc(athleteRef);
      const existingLogs =
        snap.exists() && Array.isArray(snap.data().logs) ? snap.data().logs : [];
      const filtered = existingLogs.filter(
        (entry) => entry?.id !== serialized.id && entry?.runId !== serialized.id
      );
      await setDoc(athleteRef, { logs: [summaryEntry, ...filtered] }, { merge: true });
    } else {
      throw err;
    }
  }

  return canonical;
}

/**
 * Subscribes to runs under `{collection}/{athlete}/runs` ordered newest-first.
 */
export function subscribeRuns(callback, targetCtx = undefined, onError = undefined) {
  const ctx = getTargetContext(targetCtx);
  const q = query(
    collection(db, ctx.collectionName, ctx.athleteId, 'runs'),
    orderBy('startedAt', 'desc')
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const runs = snapshot.docs.map((d) => deserializeRunFromFirestore(d.data(), d.id));
      runs.sort(compareRunsDesc);
      callback(runs);
    },
    (err) => {
      if (typeof onError === 'function') {
        onError(err);
      } else {
        console.error('[runsService] subscribeRuns error:', err);
      }
    }
  );
}

/**
 * Lists recent runs from `{collection}/{athlete}/runs` ordered newest-first.
 */
export async function listRuns(targetCtx = undefined, limitCount = 20) {
  const ctx = getTargetContext(targetCtx);
  const safeLimit =
    Number.isInteger(limitCount) && limitCount > 0 ? limitCount : 20;
  const q = query(
    collection(db, ctx.collectionName, ctx.athleteId, 'runs'),
    orderBy('startedAt', 'desc'),
    limit(safeLimit)
  );
  const snapshot = await getDocs(q);
  const runs = snapshot.docs.map((d) => deserializeRunFromFirestore(d.data(), d.id));
  runs.sort(compareRunsDesc);
  return runs;
}

/**
 * Fetches a single run by ID from `{collection}/{athlete}/runs/{runId}`.
 */
export async function getRunById(runId, targetCtx = undefined) {
  const safeId = cleanSegmentId(runId);
  if (!safeId) {
    return null;
  }
  const ctx = getTargetContext(targetCtx);
  const snap = await getDoc(doc(db, ctx.collectionName, ctx.athleteId, 'runs', safeId));
  return snap.exists() ? deserializeRunFromFirestore(snap.data(), snap.id) : null;
}

/**
 * Deletes a run document from `{collection}/{athlete}/runs/{runId}` and cleans its
 * matching entry from `{collection}/{athlete}.logs[]`.
 */
export async function deleteRun(runId, targetCtx = undefined) {
  const safeId = cleanSegmentId(runId);
  if (!safeId) {
    throw new Error('Invalid runId');
  }
  const ctx = getTargetContext(targetCtx);
  const runRef = doc(db, ctx.collectionName, ctx.athleteId, 'runs', safeId);
  const athleteRef = doc(db, ctx.collectionName, ctx.athleteId);

  await deleteDoc(runRef);

  const removeFromLogs = (existingLogs) =>
    existingLogs.filter((entry) => entry?.id !== safeId && entry?.runId !== safeId);

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(athleteRef);
      if (!snap.exists() || !Array.isArray(snap.data().logs)) {
        return;
      }
      const existingLogs = snap.data().logs;
      const filtered = removeFromLogs(existingLogs);
      if (filtered.length !== existingLogs.length) {
        tx.set(athleteRef, { logs: filtered }, { merge: true });
      }
    });
  } catch (err) {
    if (err?.code === 'unavailable') {
      const snap = await getDoc(athleteRef);
      if (snap.exists() && Array.isArray(snap.data().logs)) {
        const existingLogs = snap.data().logs;
        const filtered = removeFromLogs(existingLogs);
        if (filtered.length !== existingLogs.length) {
          await setDoc(athleteRef, { logs: filtered }, { merge: true });
        }
      }
    } else {
      throw err;
    }
  }
}
