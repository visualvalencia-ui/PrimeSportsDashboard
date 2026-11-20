import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export const FIREBASE_PROJECT_ID = 'dashboard-semanal-99c26';
export const FIRESTORE_REST_BASE =
  `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
export const TEST_COLLECTION = 'sports_prime_test';
export const PROD_COLLECTION = 'sports_prime';
export const PROD_ATHLETE_ID = 'camilo';

function enc(segment) {
  return encodeURIComponent(segment);
}

export function assertSafeTestTarget(collection, athleteId) {
  if (typeof collection !== 'string' || typeof athleteId !== 'string') {
    throw new Error('SAFETY GUARD: collection and athleteId must be strings');
  }
  const col = collection.trim();
  const ath = athleteId.trim();

  if (col.toLowerCase() === PROD_COLLECTION) {
    throw new Error(`SAFETY GUARD: Refusing to touch production collection "${col}"`);
  }
  if (ath.toLowerCase() === PROD_ATHLETE_ID) {
    throw new Error(`SAFETY GUARD: Refusing to touch production athlete "${ath}"`);
  }
  if (collection !== col || athleteId !== ath) {
    throw new Error(
      'SAFETY GUARD: collection and athleteId must not contain leading/trailing whitespace'
    );
  }
  if (col !== TEST_COLLECTION) {
    throw new Error(
      `SAFETY GUARD: E2E tests may only target "${TEST_COLLECTION}", got "${col}"`
    );
  }
  if (!ath || !ath.startsWith('e2e_test_')) {
    throw new Error(
      `SAFETY GUARD: Test athleteId must start with "e2e_test_", got "${ath}"`
    );
  }
  if (ath.includes('/') || /^__.*__$/.test(ath)) {
    throw new Error(`SAFETY GUARD: Invalid Firestore document ID "${ath}"`);
  }
}

export function generateTestAthleteId(tag = 'run') {
  const safeTag =
    String(tag)
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 16) || 'run';
  const id = `e2e_test_${safeTag}_${Date.now()}_${randomUUID().slice(0, 6)}`;
  assertSafeTestTarget(TEST_COLLECTION, id);
  return id;
}

export function fromFirestoreValue(val) {
  if (!val || typeof val !== 'object') return undefined;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('booleanValue' in val) return val.booleanValue;
  if ('nullValue' in val) return null;
  if ('timestampValue' in val) return val.timestampValue;
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map(fromFirestoreValue);
  }
  if ('mapValue' in val) {
    return decodeFields(val.mapValue.fields || {});
  }
  return undefined;
}

export function decodeFields(fields = {}) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = fromFirestoreValue(v);
  }
  return out;
}

export function decodeDocument(doc) {
  return {
    id: doc.name.split('/').pop(),
    name: doc.name,
    createTime: doc.createTime,
    updateTime: doc.updateTime,
    data: decodeFields(doc.fields || {}),
  };
}

export function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(toFirestoreValue) } };
  }
  if (typeof val === 'object') {
    return { mapValue: { fields: encodeFields(val) } };
  }
  return { stringValue: String(val) };
}

export function encodeFields(obj = {}) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      fields[k] = toFirestoreValue(v);
    }
  }
  return fields;
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: res.status, ok: res.ok, json, text };
}

export async function getAthleteDoc(athleteId, collection = TEST_COLLECTION) {
  assertSafeTestTarget(collection, athleteId);
  const url = `${FIRESTORE_REST_BASE}/${enc(collection)}/${enc(athleteId)}`;
  const { status, ok, json, text } = await fetchJson(url);
  if (status === 404) return null;
  if (!ok) {
    throw new Error(`getAthleteDoc(${collection}/${athleteId}) failed (${status}): ${text}`);
  }
  return decodeDocument(json);
}

export async function listRuns(athleteId, collection = TEST_COLLECTION) {
  assertSafeTestTarget(collection, athleteId);
  const runs = [];
  let pageToken = null;

  do {
    const qs = new URLSearchParams({ pageSize: '100' });
    if (pageToken) qs.set('pageToken', pageToken);
    const url = `${FIRESTORE_REST_BASE}/${enc(collection)}/${enc(athleteId)}/runs?${qs.toString()}`;
    const { status, ok, json, text } = await fetchJson(url);
    if (status === 404) return [];
    if (!ok) {
      throw new Error(`listRuns(${collection}/${athleteId}) failed (${status}): ${text}`);
    }
    const docs = json?.documents || [];
    for (const d of docs) {
      runs.push(decodeDocument(d));
    }
    pageToken = json?.nextPageToken || null;
  } while (pageToken);

  runs.sort((a, b) => {
    const ta = Date.parse(a.data?.startedAt || a.data?.endedAt || a.createTime || 0);
    const tb = Date.parse(b.data?.startedAt || b.data?.endedAt || b.createTime || 0);
    return tb - ta;
  });

  return runs;
}

export async function getRunDoc(athleteId, runId, collection = TEST_COLLECTION) {
  assertSafeTestTarget(collection, athleteId);
  if (!runId || typeof runId !== 'string' || runId.includes('/')) {
    throw new Error(`Invalid runId "${runId}"`);
  }
  const url = `${FIRESTORE_REST_BASE}/${enc(collection)}/${enc(athleteId)}/runs/${enc(runId)}`;
  const { status, ok, json, text } = await fetchJson(url);
  if (status === 404) return null;
  if (!ok) {
    throw new Error(`getRunDoc(${collection}/${athleteId}/runs/${runId}) failed (${status}): ${text}`);
  }
  return decodeDocument(json);
}

export async function writeTestAthleteDoc(
  athleteId,
  payload,
  collection = TEST_COLLECTION
) {
  assertSafeTestTarget(collection, athleteId);
  const url = `${FIRESTORE_REST_BASE}/${enc(collection)}/${enc(athleteId)}`;
  const { status, ok, json, text } = await fetchJson(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: encodeFields(payload) }),
  });
  if (!ok) {
    throw new Error(`writeTestAthleteDoc(${collection}/${athleteId}) failed (${status}): ${text}`);
  }
  return decodeDocument(json);
}

export async function writeTestRunDoc(
  athleteId,
  runId,
  payload,
  collection = TEST_COLLECTION
) {
  assertSafeTestTarget(collection, athleteId);
  if (!runId || typeof runId !== 'string' || runId.includes('/')) {
    throw new Error(`Invalid runId "${runId}"`);
  }
  const url = `${FIRESTORE_REST_BASE}/${enc(collection)}/${enc(athleteId)}/runs/${enc(runId)}`;
  const { status, ok, json, text } = await fetchJson(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: encodeFields(payload) }),
  });
  if (!ok) {
    throw new Error(
      `writeTestRunDoc(${collection}/${athleteId}/runs/${runId}) failed (${status}): ${text}`
    );
  }
  return decodeDocument(json);
}

export async function waitForRunPersistence(
  athleteId,
  {
    minRuns = 1,
    expectLogCount = 1,
    timeoutMs = 15000,
    pollMs = 350,
    collection = TEST_COLLECTION,
  } = {}
) {
  assertSafeTestTarget(collection, athleteId);
  const deadline = Date.now() + timeoutMs;
  let lastRuns = [];
  let lastAthlete = null;

  while (Date.now() <= deadline) {
    const [runs, athleteDoc] = await Promise.all([
      listRuns(athleteId, collection),
      getAthleteDoc(athleteId, collection),
    ]);
    lastRuns = runs;
    lastAthlete = athleteDoc;
    const logsCount = Array.isArray(athleteDoc?.data?.logs)
      ? athleteDoc.data.logs.length
      : 0;
    if (runs.length >= minRuns && logsCount >= expectLogCount) {
      return { runs, athleteDoc };
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for Firestore persistence (${collection}/${athleteId}): ` +
      `runs=${lastRuns.length} (expected >= ${minRuns}), logs=${lastAthlete?.data?.logs?.length ?? 0} (expected >= ${expectLogCount})`
  );
}

export function extractTrackpointStats(runData) {
  if (!runData || typeof runData !== 'object') {
    return { segmentCount: 0, points: [], segmentsNormalized: [] };
  }

  if (Array.isArray(runData.segments)) {
    const normalizedItems = runData.segments.map((seg, origPos) => {
      if (Array.isArray(seg)) {
        return { sortKey: origPos, origPos, hasExplicitIndex: false, points: seg };
      }
      if (seg && Array.isArray(seg.points)) {
        const hasIdx = typeof seg.index === 'number' && Number.isFinite(seg.index);
        return {
          sortKey: hasIdx ? seg.index : origPos,
          origPos,
          hasExplicitIndex: hasIdx,
          points: seg.points,
        };
      }
      return { sortKey: origPos, origPos, hasExplicitIndex: false, points: [] };
    });

    if (normalizedItems.some((item) => item.hasExplicitIndex)) {
      normalizedItems.sort((a, b) => a.sortKey - b.sortKey || a.origPos - b.origPos);
    }

    const segs = normalizedItems
      .map((item) => item.points)
      .filter((pts) => pts.length > 0);

    if (segs.length > 0) {
      return {
        segmentCount: segs.length,
        points: segs.flat(),
        segmentsNormalized: segs,
      };
    }
  }

  if (Array.isArray(runData.trackpoints)) {
    const bySeg = new Map();
    for (const pt of runData.trackpoints) {
      const idx = pt?.segmentIndex ?? 0;
      if (!bySeg.has(idx)) bySeg.set(idx, []);
      bySeg.get(idx).push(pt);
    }
    const segs = [...bySeg.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, pts]) => pts)
      .filter((pts) => pts.length > 0);
    return {
      segmentCount: segs.length,
      points: segs.flat(),
      segmentsNormalized: segs,
    };
  }

  return { segmentCount: 0, points: [], segmentsNormalized: [] };
}

export async function deleteRunDoc(athleteId, runId, collection = TEST_COLLECTION) {
  assertSafeTestTarget(collection, athleteId);
  if (!runId || typeof runId !== 'string' || runId.includes('/')) {
    throw new Error(`Invalid runId "${runId}"`);
  }
  const url = `${FIRESTORE_REST_BASE}/${enc(collection)}/${enc(athleteId)}/runs/${enc(runId)}`;
  const { status, ok, text } = await fetchJson(url, { method: 'DELETE' });
  if (status === 404 || ok) return true;
  throw new Error(`deleteRunDoc(${collection}/${athleteId}/runs/${runId}) failed (${status}): ${text}`);
}

export async function cleanupTestAthlete(athleteId, collection = TEST_COLLECTION) {
  assertSafeTestTarget(collection, athleteId);
  const errors = [];
  let deletedRunsCount = 0;

  const runs = await listRuns(athleteId, collection);
  for (let i = 0; i < runs.length; i += 10) {
    const batch = runs.slice(i, i + 10);
    const results = await Promise.allSettled(
      batch.map((r) => deleteRunDoc(athleteId, r.id, collection))
    );
    for (const res of results) {
      if (res.status === 'fulfilled') {
        deletedRunsCount += 1;
      } else {
        errors.push(res.reason);
      }
    }
  }

  let deletedParentDoc = false;
  const parentUrl = `${FIRESTORE_REST_BASE}/${enc(collection)}/${enc(athleteId)}`;
  const parentDel = await fetchJson(parentUrl, { method: 'DELETE' });
  if (parentDel.status === 404 || parentDel.ok) {
    deletedParentDoc = parentDel.ok;
  } else {
    errors.push(
      new Error(
        `DELETE parent ${collection}/${athleteId} failed (${parentDel.status}): ${parentDel.text}`
      )
    );
  }

  const [remainingRuns, remainingParent] = await Promise.all([
    listRuns(athleteId, collection),
    getAthleteDoc(athleteId, collection),
  ]);
  if (remainingRuns.length > 0 || remainingParent !== null) {
    errors.push(
      new Error(
        `Cleanup incomplete for ${collection}/${athleteId}: remainingRuns=${remainingRuns.length}, parentExists=${remainingParent !== null}`
      )
    );
  }

  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      `cleanupTestAthlete(${collection}/${athleteId}) encountered ${errors.length} error(s)`
    );
  }

  return { athleteId, deletedRunsCount, deletedParentDoc };
}

export function createCleanupTracker(collection = TEST_COLLECTION) {
  const registered = new Set();

  return {
    register(athleteId) {
      assertSafeTestTarget(collection, athleteId);
      registered.add(athleteId);
      return athleteId;
    },
    async cleanupOne(athleteId) {
      try {
        return await cleanupTestAthlete(athleteId, collection);
      } finally {
        registered.delete(athleteId);
      }
    },
    async cleanupAll() {
      const remaining = [...registered];
      const results = await Promise.allSettled(
        remaining.map((id) => cleanupTestAthlete(id, collection))
      );
      registered.clear();
      const failures = results.filter((r) => r.status === 'rejected');
      if (failures.length > 0) {
        throw new AggregateError(
          failures.map((f) => f.reason),
          `cleanupAll failed for ${failures.length} athlete(s)`
        );
      }
      return results.map((r) => r.value);
    },
  };
}

/**
 * Strictly READ-ONLY (GET) snapshot of production sports_prime/camilo.
 */
export async function snapshotProductionCamilo() {
  const docUrl = `${FIRESTORE_REST_BASE}/${PROD_COLLECTION}/${PROD_ATHLETE_ID}`;
  const runsUrl = `${docUrl}/runs?pageSize=100`;

  const [docRes, runsRes] = await Promise.all([fetchJson(docUrl), fetchJson(runsUrl)]);
  if (!docRes.ok) {
    throw new Error(
      `Read-only snapshot of ${PROD_COLLECTION}/${PROD_ATHLETE_ID} failed (${docRes.status}): ${docRes.text}`
    );
  }
  if (!runsRes.ok) {
    throw new Error(
      `Read-only snapshot of ${PROD_COLLECTION}/${PROD_ATHLETE_ID}/runs failed (${runsRes.status}): ${runsRes.text}`
    );
  }

  const logsArr = docRes.json?.fields?.logs?.arrayValue?.values || [];
  const decodedLogs = logsArr.map(fromFirestoreValue);
  const latestLogId = decodedLogs[0]?.id ?? null;
  const runsCount = (runsRes.json?.documents || []).length;

  return Object.freeze({
    updateTime: docRes.json?.updateTime ?? null,
    createTime: docRes.json?.createTime ?? null,
    logsCount: logsArr.length,
    latestLogId,
    runsCount,
  });
}

export async function assertProductionCamiloUnchanged(beforeSnapshot) {
  const afterSnapshot = await snapshotProductionCamilo();
  assert.deepStrictEqual(
    afterSnapshot,
    beforeSnapshot,
    `Production ${PROD_COLLECTION}/${PROD_ATHLETE_ID} mutated during E2E test!`
  );
  return afterSnapshot;
}
