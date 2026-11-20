import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EARTH_RADIUS_METERS,
  calculateCurrentPaceMinPerKm,
  calculatePaceMinPerKm,
  computeRunMetrics,
  formatDuration,
  formatPace,
  haversineMeters,
  normalizeSegments,
  shouldAcceptFix,
} from '../../src/utils/gpsMath.js';

describe('gpsMath — haversineMeters', () => {
  it('returns 0 for identical coordinates and invalid inputs', () => {
    assert.equal(haversineMeters(4.60163, -74.22268, 4.60163, -74.22268), 0);
    assert.equal(haversineMeters(NaN, -74.22, 4.6, -74.22), 0);
    assert.equal(haversineMeters(4.6, undefined, 4.61, -74.22), 0);
  });

  it('computes Ciudad Verde Soacha segment within <0.5% of reference (~400.3m)', () => {
    const d = haversineMeters(4.60163, -74.22268, 4.60523, -74.22268);
    // 0.0036 deg latitude on sphere R=6,371,000 m is ~400.30 m
    assert.ok(Math.abs(d - 400.3) < 0.5, `expected ~400.3m, got ${d}`);
  });

  it('handles equator and antipodal coordinates without NaN', () => {
    const eq = haversineMeters(0, 0, 0, 1);
    assert.ok(Math.abs(eq - 111194.9) < 5, `expected ~111194.9m, got ${eq}`);
    const antipodal = haversineMeters(0, 0, 0, 180);
    assert.ok(Number.isFinite(antipodal));
    assert.ok(Math.abs(antipodal - Math.PI * EARTH_RADIUS_METERS) < 1);
  });
});

describe('gpsMath — shouldAcceptFix', () => {
  it('accepts initial point with real or synthetic Playwright accuracy (0/undefined/null)', () => {
    for (const acc of [0, undefined, null, 10, 35]) {
      const res = shouldAcceptFix(null, {
        lat: 4.60163,
        lng: -74.22268,
        ts: 1000,
        acc,
      });
      assert.equal(res.accepted, true);
      assert.equal(res.deltaMeters, 0);
    }
  });

  it('rejects invalid coordinates, low accuracy (>35m), stale timestamps, and jitter (<1.5m)', () => {
    assert.equal(
      shouldAcceptFix(null, { lat: 95, lng: -74, ts: 1000 }).reason,
      'invalid_coords'
    );
    assert.equal(
      shouldAcceptFix(null, { lat: 4.6, lng: -74.2, ts: 1000, acc: 50 }).reason,
      'low_accuracy'
    );

    const p1 = { lat: 4.60163, lng: -74.22268, ts: 5000, acc: 8 };
    assert.equal(
      shouldAcceptFix(p1, { lat: 4.6017, lng: -74.22268, ts: 4000, acc: 8 }).reason,
      'stale_timestamp'
    );
    assert.equal(
      shouldAcceptFix(p1, { lat: 4.601635, lng: -74.22268, ts: 6000, acc: 8 }).reason,
      'jitter'
    );
  });

  it('rejects coarse teleport spikes (dt>=1s && acc>20 && >12m/s) while allowing fast Playwright steps', () => {
    const p1 = { lat: 4.60163, lng: -74.22268, ts: 10000, acc: 10 };

    // Coarse accuracy (25m) jumping ~400m in 2s (200 m/s) -> teleport_spike
    const spike = shouldAcceptFix(p1, {
      lat: 4.60523,
      lng: -74.22268,
      ts: 12000,
      acc: 25,
    });
    assert.equal(spike.accepted, false);
    assert.equal(spike.reason, 'teleport_spike');

    // Rapid synthetic Playwright step: 50m in 0.2s with acc=0 or acc=5 -> accepted
    const rapidSynthetic = shouldAcceptFix(p1, {
      lat: 4.60208,
      lng: -74.22268,
      ts: 10200,
      acc: 0,
    });
    assert.equal(rapidSynthetic.accepted, true);
    assert.ok(rapidSynthetic.deltaMeters > 45 && rapidSynthetic.deltaMeters < 55);

    // High precision rapid step (acc <= 20) -> accepted even when speed > 12 m/s
    const preciseStep = shouldAcceptFix(p1, {
      lat: 4.6025,
      lng: -74.22268,
      ts: 12000,
      acc: 5,
    });
    assert.equal(preciseStep.accepted, true);
  });
});

describe('gpsMath — pace & duration formatting', () => {
  it('returns null / placeholder when distance < 10m or duration <= 0', () => {
    assert.equal(calculatePaceMinPerKm(60, 5), null);
    assert.equal(calculatePaceMinPerKm(0, 500), null);
    assert.equal(formatPace(null), '--:-- /km');
    assert.equal(formatPace(undefined), '--:-- /km');
    assert.equal(formatPace(-1), '--:-- /km');
  });

  it('handles 60-second rollover safely in formatPace', () => {
    assert.equal(formatPace(6.999), '7:00 /km');
    assert.equal(formatPace(7.999), '8:00 /km');
    assert.equal(formatPace(5.5), '5:30 /km');
  });

  it('formats durations into MM:SS and HH:MM:SS', () => {
    assert.equal(formatDuration(-5), '00:00');
    assert.equal(formatDuration(65), '01:05');
    assert.equal(formatDuration(3661), '01:01:01');
  });
});

describe('gpsMath — computeRunMetrics & rolling pace', () => {
  it('isolates segments across pause/resume (0m jump) and computes splits/bounds/speed', () => {
    // Seg 1: 0 -> ~1200 m (1.2 km) over 360 s
    // Pause jump: +500 m gap between seg1 end and seg2 start
    // Seg 2: ~1000 m (1.0 km) over 300 s -> total ~2.2 km, 660 s active, 780 s elapsed (120 s paused)
    const seg1 = [
      { lat: 4.6, lng: -74.22, ts: 0, elapsedSec: 0, acc: 5 },
      { lat: 4.6054, lng: -74.22, ts: 180000, elapsedSec: 180, acc: 5 },
      { lat: 4.6108, lng: -74.22, ts: 360000, elapsedSec: 360, acc: 5 },
    ];
    const seg2 = [
      // Paused jump north to 4.6160 (~578m away from seg1 end) - must add 0m
      { lat: 4.616, lng: -74.22, ts: 480000, elapsedSec: 360, acc: 5 },
      { lat: 4.625, lng: -74.22, ts: 780000, elapsedSec: 660, acc: 5 },
    ];

    const expectedSeg1Dist =
      haversineMeters(seg1[0].lat, seg1[0].lng, seg1[1].lat, seg1[1].lng) +
      haversineMeters(seg1[1].lat, seg1[1].lng, seg1[2].lat, seg1[2].lng);
    const expectedSeg2Dist = haversineMeters(
      seg2[0].lat,
      seg2[0].lng,
      seg2[1].lat,
      seg2[1].lng
    );

    const metrics = computeRunMetrics([seg1, seg2], 660, 780);
    assert.equal(metrics.pointCount, 5);
    assert.equal(metrics.pausedDurationSec, 120);
    assert.ok(
      Math.abs(metrics.distanceMeters - (expectedSeg1Dist + expectedSeg2Dist)) < 0.2
    );
    assert.equal(metrics.splitsKm.length, 2);
    assert.equal(metrics.splitsKm[0].km, 1);
    assert.equal(metrics.splitsKm[1].km, 2);
    assert.deepEqual(metrics.bounds, {
      minLat: 4.6,
      maxLat: 4.625,
      minLng: -74.22,
      maxLng: -74.22,
    });
    assert.ok(metrics.avgSpeedKmh > 10 && metrics.avgSpeedKmh < 14);
  });

  it('normalizes both raw TrackPoint[][] and Firestore {index, points}[] objects and filters out-of-range coords', () => {
    const wrapped = [
      { index: 0, points: [{ lat: 4.6, lng: -74.22, ts: 1000 }, { lat: 999, lng: -74.22, ts: 1500 }] },
      { segmentIndex: 1, points: [{ lat: 4.601, lng: -74.22, ts: 2000 }, { lat: 4.602, lng: -181, ts: 2500 }] },
      [{ lat: -91, lng: 0, ts: 3000 }],
    ];
    const norm = normalizeSegments(wrapped);
    assert.equal(norm.length, 2);
    assert.equal(norm[0].length, 1);
    assert.equal(norm[0][0].lat, 4.6);
    assert.equal(norm[1].length, 1);
    assert.equal(norm[1][0].lat, 4.601);
  });

  it('computes rolling current pace when points are fresh and returns null when stale or trailing segment is empty', () => {
    const seg = [
      { lat: 4.6, lng: -74.22, ts: 10000 },
      { lat: 4.60045, lng: -74.22, ts: 20000 }, // ~50m in 10s = 5 m/s -> 3:20 /km
    ];
    const pace = calculateCurrentPaceMinPerKm([seg], 25000);
    assert.ok(pace !== null && pace > 3.0 && pace < 3.6);
    const stale = calculateCurrentPaceMinPerKm([seg], 50000);
    assert.equal(stale, null);

    // Post-resume empty trailing segment must return null instead of reading paused segment
    assert.equal(calculateCurrentPaceMinPerKm([seg, []], 25000), null);
    assert.equal(
      calculateCurrentPaceMinPerKm([seg, [{ lat: 4.61, lng: -74.22, ts: 24000 }]], 25000),
      null
    );
    assert.equal(
      calculateCurrentPaceMinPerKm(
        [
          { index: 0, points: seg },
          { index: 1, points: [] },
        ],
        25000
      ),
      null
    );
  });
});
