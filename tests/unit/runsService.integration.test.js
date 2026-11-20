import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deleteApp } from 'firebase/app';
import { deleteDoc, doc, getDoc, terminate } from 'firebase/firestore';
import { app, db, getTargetContext } from '../../src/firebase.js';
import {
  buildLogsSummaryEntry,
  deleteRun,
  deserializeRunFromFirestore,
  deserializeSegments,
  getRunById,
  listRuns,
  saveRun,
  serializeRunForFirestore,
  serializeSegments,
  subscribeRuns,
} from '../../src/services/runsService.js';

function assertNoForbiddenValues(obj, path = 'root') {
  if (obj === undefined) {
    throw new Error(`Found undefined at ${path}`);
  }
  if (typeof obj === 'number' && !Number.isFinite(obj)) {
    throw new Error(`Found non-finite number ${obj} at ${path}`);
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, idx) => {
      if (Array.isArray(item)) {
        throw new Error(`Found nested array at ${path}[${idx}]`);
      }
      assertNoForbiddenValues(item, `${path}[${idx}]`);
    });
    return;
  }
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      assertNoForbiddenValues(v, `${path}.${k}`);
    }
  }
}

describe('firebase.js — getTargetContext', () => {
  it('defaults to sports_prime/camilo and handles overrides + slash sanitization', () => {
    const def = getTargetContext();
    assert.deepEqual(def, {
      collectionName: 'sports_prime',
      athleteId: 'camilo',
      isTestMode: false,
    });

    const overridden = getTargetContext({
      collectionName: 'sports_prime_test',
      athleteId: 'unit_runner',
    });
    assert.deepEqual(overridden, {
      collectionName: 'sports_prime_test',
      athleteId: 'unit_runner',
      isTestMode: true,
    });

    // Multi-segment slash paths and reserved Firestore IDs (., .., __*__) must be rejected
    for (const [badCol, badAth] of [
      ['a/b', 'c/d'],
      ['..', '.'],
      ['__reserved__', '__doc__'],
    ]) {
      const invalid = getTargetContext({
        collectionName: badCol,
        athleteId: badAth,
      });
      assert.equal(invalid.collectionName, 'sports_prime');
      assert.equal(invalid.athleteId, 'camilo');
    }
  });

  it('reads ?testCollection=...&athlete=... from window.location.search when present', () => {
    const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
    const prevWindow = globalThis.window;
    try {
      globalThis.window = {
        location: { search: '?testCollection=sports_prime_test&athlete=e2e_test' },
      };
      const ctx = getTargetContext();
      assert.deepEqual(ctx, {
        collectionName: 'sports_prime_test',
        athleteId: 'e2e_test',
        isTestMode: true,
      });
    } finally {
      if (hadWindow) {
        globalThis.window = prevWindow;
      } else {
        delete globalThis.window;
      }
    }
  });
});

describe('runsService — pure serialization & deserialization', () => {
  it('serializes segments as [{ index, points }] with zero nested arrays or undefined/NaN', () => {
    const rawRun = {
      id: 'run_pure_1',
      startedAt: '2026-11-20T10:00:00.000Z',
      endedAt: '2026-11-20T10:15:00.000Z',
      distanceMeters: 2150.4,
      distanceKm: 2.15,
      activeDurationSec: 800,
      elapsedDurationSec: 900,
      pausedDurationSec: 100,
      avgPaceMinPerKm: undefined,
      avgPaceFormatted: undefined,
      avgSpeedKmh: NaN,
      segments: [
        [
          { lat: 4.60163, lng: -74.22268, ts: 1000, elapsedSec: 0, acc: undefined },
          { lat: 4.60523, lng: -74.22268, ts: 2000, elapsedSec: 10, acc: 5.2 },
        ],
        [
          { lat: 4.61, lng: -74.22, ts: 5000, elapsedSec: 10, acc: 0 },
        ],
      ],
      notes: undefined,
    };

    const serialized = serializeRunForFirestore(rawRun);
    assertNoForbiddenValues(serialized);
    assert.equal(serialized.segments.length, 2);
    assert.equal(serialized.segments[0].index, 0);
    assert.equal(serialized.segments[1].index, 1);
    assert.equal(serialized.pointCount, 3);
    assert.equal(serialized.avgPaceMinPerKm, null);

    const roundtrip = deserializeRunFromFirestore(serialized, serialized.id);
    assert.equal(roundtrip.segments.length, 2);
    assert.ok(Array.isArray(roundtrip.segments[0]));
    assert.equal(roundtrip.segments[0][0].acc, null);
    assert.equal(roundtrip.segments[0][1].acc, 5.2);
  });

  it('deserializes { index, points }, { segmentIndex, points }, TrackPoint[][], and flat trackpoints', () => {
    assert.equal(
      deserializeSegments([
        { index: 1, points: [{ lat: 4.61, lng: -74.22 }] },
        { index: 0, points: [{ lat: 4.6, lng: -74.22 }] },
      ])[0][0].lat,
      4.6
    );
    assert.equal(
      deserializeSegments([
        { segmentIndex: 0, points: [{ lat: 4.62, lng: -74.22 }] },
      ])[0][0].lat,
      4.62
    );
    assert.equal(
      deserializeSegments([[{ lat: 4.63, lng: -74.22 }]])[0][0].lat,
      4.63
    );
    assert.equal(
      deserializeSegments(null, [{ lat: 4.64, lng: -74.22 }])[0][0].lat,
      4.64
    );
    assert.equal(serializeSegments([[{ lat: 4.6, lng: -74.22 }]])[0].index, 0);
  });

  it('buildLogsSummaryEntry omits segments/trackpoints and preserves Dashboard compatibility fields', () => {
    const entry = buildLogsSummaryEntry({
      id: 'run_123',
      startedAt: '2026-11-20T10:00:00.000Z',
      endedAt: '2026-11-20T10:20:00.000Z',
      distanceKm: 4.02,
      activeDurationSec: 1800,
      avgPaceMinPerKm: 7.46,
      avgPaceFormatted: '7:28 /km',
      pointCount: 42,
      notes: 'Zona 2',
    });

    assert.equal(entry.type, 'cardio');
    assert.equal(entry.source, 'gps_pwa');
    assert.equal(entry.v1, 4.02);
    assert.equal(entry.v2, 30);
    assert.equal(entry.runId, 'run_123');
    assert.equal('segments' in entry, false);
    assert.equal('trackpoints' in entry, false);
  });

  it('computes pointCount from segments when pointCount is null, empty string, or boolean, and rejects reserved IDs', async () => {
    const segs = [
      [
        { lat: 4.60163, lng: -74.22268, ts: 1000 },
        { lat: 4.60523, lng: -74.22268, ts: 2000 },
      ],
    ];
    for (const badPointCount of [null, '', '  ', true, false, undefined, -1, NaN]) {
      const ser = serializeRunForFirestore({
        id: 'run_pc_edge',
        pointCount: badPointCount,
        segments: segs,
      });
      assert.equal(ser.pointCount, 2);

      const deser = deserializeRunFromFirestore({
        id: 'run_pc_edge',
        pointCount: badPointCount,
        segments: [{ index: 0, points: segs[0] }],
      });
      assert.equal(deser.pointCount, 2);
    }

    // Explicit 0 must still be respected when intentionally 0
    assert.equal(
      serializeRunForFirestore({ id: 'run_zero', pointCount: 0, segments: [] }).pointCount,
      0
    );

    // Reserved IDs (., .., __*__) must be rejected in cleanSegmentId consumers
    const serDot = serializeRunForFirestore({ id: '..', segments: [] });
    assert.ok(serDot.id.startsWith('run_'));
    assert.equal(await getRunById('.', { collectionName: 'sports_prime_test', athleteId: 'noop' }), null);
    await assert.rejects(
      deleteRun('..', { collectionName: 'sports_prime_test', athleteId: 'noop' }),
      /Invalid runId/
    );
    await assert.rejects(
      deleteRun('__reserved__', { collectionName: 'sports_prime_test', athleteId: 'noop' }),
      /Invalid runId/
    );
  });
});

describe('runsService — live Firestore integration (sports_prime_test)', () => {
  const uniqueAthlete = `unit_test_${process.pid}_${Date.now()}`;
  const targetCtx = {
    collectionName: 'sports_prime_test',
    athleteId: uniqueAthlete,
    isTestMode: true,
  };
  const createdRunIds = [];

  after(async () => {
    for (const runId of createdRunIds) {
      await deleteDoc(
        doc(db, targetCtx.collectionName, targetCtx.athleteId, 'runs', runId)
      ).catch(() => {});
    }
    await deleteDoc(
      doc(db, targetCtx.collectionName, targetCtx.athleteId)
    ).catch(() => {});
    await terminate(db);
    await deleteApp(app);
  });

  it('saves, reads, subscribes, updates logs[], and deletes in sports_prime_test without touching sports_prime/camilo', async () => {
    const runId = `run_it_${Date.now()}`;
    createdRunIds.push(runId);

    const sampleRun = {
      schemaVersion: 1,
      id: runId,
      source: 'gps_pwa',
      sport: 'running',
      status: 'completed',
      title: 'Carrera GPS - 1.50 km',
      startedAt: '2026-11-20T10:00:00.000Z',
      endedAt: '2026-11-20T10:12:00.000Z',
      dateLocal: '2026-11-20',
      distanceMeters: 1500,
      distanceKm: 1.5,
      activeDurationSec: 600,
      elapsedDurationSec: 720,
      pausedDurationSec: 120,
      avgPaceMinPerKm: 6.67,
      avgPaceFormatted: '6:40 /km',
      avgSpeedKmh: 9.0,
      pointCount: 3,
      bounds: { minLat: 4.60163, maxLat: 4.61, minLng: -74.22268, maxLng: -74.22 },
      splitsKm: [
        { km: 1, durationSec: 400, paceMinPerKm: 6.67, paceFormatted: '6:40 /km' },
      ],
      segments: [
        [
          { lat: 4.60163, lng: -74.22268, ts: 1795133700000, elapsedSec: 0, acc: 5 },
          { lat: 4.60523, lng: -74.22268, ts: 1795133900000, elapsedSec: 200, acc: 5 },
        ],
        [
          { lat: 4.61, lng: -74.22, ts: 1795134300000, elapsedSec: 600, acc: 5 },
        ],
      ],
      notes: 'Integration test',
    };

    const saved = await saveRun(sampleRun, targetCtx);
    assert.equal(saved.id, runId);
    assert.equal(saved.segments.length, 2);

    // Verify stored Firestore raw doc has object-wrapped segments [{ index, points }]
    const rawSnap = await getDoc(
      doc(db, targetCtx.collectionName, targetCtx.athleteId, 'runs', runId)
    );
    assert.equal(rawSnap.exists(), true);
    const rawData = rawSnap.data();
    assert.equal(Array.isArray(rawData.segments), true);
    assert.equal(rawData.segments[0].index, 0);
    assert.equal(rawData.segments[1].index, 1);

    // Verify getRunById and listRuns
    const fetched = await getRunById(runId, targetCtx);
    assert.ok(fetched);
    assert.equal(fetched.segments.length, 2);
    assert.equal(fetched.distanceKm, 1.5);

    const listed = await listRuns(targetCtx, 10);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, runId);

    // Verify athlete logs[] summary has no segments
    const athleteSnap = await getDoc(
      doc(db, targetCtx.collectionName, targetCtx.athleteId)
    );
    assert.equal(athleteSnap.exists(), true);
    const logs = athleteSnap.data().logs;
    assert.equal(Array.isArray(logs), true);
    assert.equal(logs[0].runId, runId);
    assert.equal(logs[0].type, 'cardio');
    assert.equal(logs[0].v1, 1.5);
    assert.equal(logs[0].v2, 10);
    assert.equal('segments' in logs[0], false);

    // Verify subscribeRuns emits the saved run
    const subscribedRuns = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('subscribeRuns timeout')), 10000);
      const unsub = subscribeRuns(
        (runs) => {
          if (runs.length > 0) {
            clearTimeout(timeout);
            unsub();
            resolve(runs);
          }
        },
        targetCtx,
        (err) => {
          clearTimeout(timeout);
          reject(err);
        }
      );
    });
    assert.equal(subscribedRuns[0].id, runId);

    // Verify deleteRun removes both subcollection doc and logs[] entry
    await deleteRun(runId, targetCtx);
    const afterDelete = await getRunById(runId, targetCtx);
    assert.equal(afterDelete, null);

    const athleteAfterDelete = await getDoc(
      doc(db, targetCtx.collectionName, targetCtx.athleteId)
    );
    assert.equal(athleteAfterDelete.data().logs.length, 0);
  });
});
