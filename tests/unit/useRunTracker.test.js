import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRunTrackerController,
  useRunTracker,
} from '../../src/hooks/useRunTracker.js';
import { haversineMeters } from '../../src/utils/gpsMath.js';

function createMockGeolocation() {
  let nextWatchId = 1;
  const activeWatches = new Map();
  const clearCalls = [];

  return {
    watchPosition(success, error, options) {
      const id = nextWatchId++;
      activeWatches.set(id, { success, error, options });
      return id;
    },
    clearWatch(id) {
      clearCalls.push(id);
      activeWatches.delete(id);
    },
    emitFix(coords, timestamp = Date.now()) {
      for (const { success } of activeWatches.values()) {
        success({ coords, timestamp });
      }
    },
    emitError(err) {
      for (const { error } of activeWatches.values()) {
        error(err);
      }
    },
    get activeWatchCount() {
      return activeWatches.size;
    },
    get clearCalls() {
      return clearCalls;
    },
  };
}

describe('useRunTracker — createRunTrackerController', () => {
  it('exports useRunTracker React hook function', () => {
    assert.equal(typeof useRunTracker, 'function');
  });

  it('executes start -> move -> pause -> jump -> resume -> move -> finish with 0m jump & 0s paused active time', async () => {
    const geo = createMockGeolocation();
    let clockMs = 1795133700000;
    let releasedCount = 0;

    const wakeLock = {
      async request() {
        return {
          addEventListener() {},
          async release() {
            releasedCount += 1;
          },
        };
      },
    };

    const controller = createRunTrackerController({
      geolocation: geo,
      wakeLock,
      doc: null,
      now: () => clockMs,
      tickIntervalMs: 0,
    });

    assert.equal(controller.getState().status, 'idle');

    // Start run
    controller.startRun();
    await Promise.resolve();
    assert.equal(controller.getState().status, 'recording');
    assert.equal(geo.activeWatchCount, 1);

    // Leg 1: move ~400.3 m over 120 s
    const p1 = { latitude: 4.60163, longitude: -74.22268, accuracy: 8 };
    const p2 = { latitude: 4.60523, longitude: -74.22268, accuracy: 8 };
    geo.emitFix(p1, clockMs);
    clockMs += 120000;
    geo.emitFix(p2, clockMs);

    const leg1Dist = haversineMeters(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
    let state = controller.getState();
    assert.ok(Math.abs(state.distanceMeters - leg1Dist) < 0.2);
    assert.equal(state.activeDurationSec, 120);

    // Pause run: must call clearWatch and freeze activeDurationSec
    controller.pauseRun();
    assert.equal(controller.getState().status, 'paused');
    assert.equal(geo.activeWatchCount, 0);
    assert.equal(geo.clearCalls.length, 1);

    // Advance 60 s while paused + simulate coordinate jump to 4.61500
    clockMs += 60000;
    const pJump = { latitude: 4.615, longitude: -74.22268, accuracy: 6 };
    geo.emitFix(pJump, clockMs); // no active watch, should be ignored anyway
    state = controller.getState();
    assert.equal(state.activeDurationSec, 120);
    assert.equal(state.elapsedDurationSec, 180);
    assert.equal(state.pausedDurationSec, 60);
    assert.ok(Math.abs(state.distanceMeters - leg1Dist) < 0.2);

    // Resume run: opens new segment and new watch
    controller.resumeRun();
    await Promise.resolve();
    assert.equal(controller.getState().status, 'recording');
    assert.equal(geo.activeWatchCount, 1);

    // Leg 2 starts at pJump (0m jump) and runs ~300 m over 90 s
    const p3 = { latitude: 4.6177, longitude: -74.22268, accuracy: 6 };
    geo.emitFix(pJump, clockMs);
    clockMs += 90000;
    geo.emitFix(p3, clockMs);

    const leg2Dist = haversineMeters(
      pJump.latitude,
      pJump.longitude,
      p3.latitude,
      p3.longitude
    );

    const runActivity = controller.finishRun();
    assert.ok(runActivity);
    assert.equal(controller.getState().status, 'summary');
    assert.equal(geo.activeWatchCount, 0);
    assert.equal(runActivity.schemaVersion, 1);
    assert.equal(runActivity.source, 'gps_pwa');
    assert.equal(runActivity.sport, 'running');
    assert.equal(runActivity.status, 'completed');
    assert.equal(runActivity.segments.length, 2);
    assert.equal(runActivity.pointCount, 4);
    assert.equal(runActivity.activeDurationSec, 210);
    assert.equal(runActivity.elapsedDurationSec, 270);
    assert.equal(runActivity.pausedDurationSec, 60);
    assert.ok(
      Math.abs(runActivity.distanceMeters - (leg1Dist + leg2Dist)) < 0.2,
      `expected ${leg1Dist + leg2Dist}, got ${runActivity.distanceMeters}`
    );
    assert.ok(releasedCount >= 1);

    controller.dispose();
  });

  it('handles transient Chrome 158 POSITION_UNAVAILABLE (code 2) and TIMEOUT (code 3) without stopping watch, while code 1 resets to idle', async () => {
    const geo = createMockGeolocation();
    let clockMs = 1795134000000;

    const controller = createRunTrackerController({
      geolocation: geo,
      wakeLock: null,
      doc: null,
      now: () => clockMs,
      tickIntervalMs: 0,
    });

    controller.startRun();
    const p1 = { latitude: 4.60163, longitude: -74.22268, accuracy: 0 };
    geo.emitFix(p1, clockMs);
    assert.equal(controller.getState().gpsStatus, 'locked');
    assert.equal(controller.getState().gpsError, null);

    // Chrome 158 emits code 2 in the exact same millisecond before the new fix
    clockMs += 5000;
    geo.emitError({ code: 2, message: 'Position unavailable' });
    let state = controller.getState();
    assert.equal(state.status, 'recording');
    assert.notEqual(state.gpsStatus, 'error');
    assert.equal(geo.activeWatchCount, 1);
    assert.equal(geo.clearCalls.length, 0);

    // Same-millisecond valid fix arrives right after code 2
    const p2 = { latitude: 4.60253, longitude: -74.22268, accuracy: 0 };
    geo.emitFix(p2, clockMs);
    state = controller.getState();
    assert.equal(state.gpsStatus, 'locked');
    assert.equal(state.gpsError, null);

    // Also test code 3 TIMEOUT followed by next fix
    clockMs += 5000;
    geo.emitError({ code: 3, message: 'Timeout' });
    state = controller.getState();
    assert.equal(state.status, 'recording');
    assert.notEqual(state.gpsStatus, 'error');
    assert.equal(geo.activeWatchCount, 1);

    const p3 = { latitude: 4.60343, longitude: -74.22268, accuracy: 0 };
    geo.emitFix(p3, clockMs);
    state = controller.getState();
    assert.equal(state.gpsStatus, 'locked');
    assert.equal(state.gpsError, null);

    const expectedDist =
      haversineMeters(p1.latitude, p1.longitude, p2.latitude, p2.longitude) +
      haversineMeters(p2.latitude, p2.longitude, p3.latitude, p3.longitude);
    assert.ok(Math.abs(state.distanceMeters - expectedDist) < 0.2);

    // Fatal code 1 PERMISSION_DENIED must clearWatch, stop timer, release wake lock, remove visibility listener, and reset to idle while keeping gpsStatus === 'error'
    let emittedStates = 0;
    let releasedSentinels = 0;
    const visibilityEvents = [];
    const mockDoc = {
      visibilityState: 'visible',
      addEventListener(type, fn) {
        visibilityEvents.push({ op: 'add', type, fn });
      },
      removeEventListener(type, fn) {
        visibilityEvents.push({ op: 'remove', type, fn });
      },
    };
    const permGeo = createMockGeolocation();
    let permClock = 1795134500000;
    const permWakeLock = {
      async request() {
        return {
          addEventListener() {},
          async release() {
            releasedSentinels += 1;
          },
        };
      },
    };
    const permController = createRunTrackerController({
      geolocation: permGeo,
      wakeLock: permWakeLock,
      doc: mockDoc,
      now: () => permClock,
      tickIntervalMs: 15,
      onStateChange: () => {
        emittedStates += 1;
      },
    });

    permController.startRun();
    await Promise.resolve();
    assert.equal(visibilityEvents.filter((e) => e.op === 'add' && e.type === 'visibilitychange').length, 1);
    permGeo.emitFix({ latitude: 4.60163, longitude: -74.22268, accuracy: 5 }, permClock);
    permClock += 10000;
    assert.equal(permController.getState().activeDurationSec, 10);
    assert.equal(permController.getState().elapsedDurationSec, 10);

    permGeo.emitError({ code: 1, message: 'User denied Geolocation' });
    await Promise.resolve();
    state = permController.getState();
    assert.equal(state.status, 'idle');
    assert.equal(state.gpsStatus, 'error');
    assert.equal(typeof state.gpsError, 'string');
    assert.ok(state.gpsError.length > 0 && state.gpsError.includes('Permiso'));
    assert.equal(state.activeDurationSec, 0);
    assert.equal(state.elapsedDurationSec, 0);
    assert.equal(state.pausedDurationSec, 0);
    assert.equal(state.distanceMeters, 0);
    assert.equal(state.currentPosition, null);
    assert.equal(state.accuracyMeters, null);
    assert.equal(state.segments.length, 0);
    assert.equal(permGeo.activeWatchCount, 0);
    assert.equal(permGeo.clearCalls.length, 1);
    assert.equal(releasedSentinels, 1);
    assert.equal(visibilityEvents.filter((e) => e.op === 'remove' && e.type === 'visibilitychange').length, 1);

    // Ensure interval timer stopped (no further emissions or ticking even as now() advances)
    const emitsAtError = emittedStates;
    permClock += 5000;
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(emittedStates, emitsAtError);
    state = permController.getState();
    assert.equal(state.activeDurationSec, 0);
    assert.equal(state.elapsedDurationSec, 0);
    assert.equal(state.pausedDurationSec, 0);

    // Subsequent startRun() retry clears gpsError and records cleanly
    permController.startRun();
    await Promise.resolve();
    state = permController.getState();
    assert.equal(state.status, 'recording');
    assert.equal(state.gpsStatus, 'acquiring');
    assert.equal(state.gpsError, null);
    assert.equal(permGeo.activeWatchCount, 1);
    permGeo.emitFix({ latitude: 4.60163, longitude: -74.22268, accuracy: 5 }, permClock);
    permClock += 15000;
    permGeo.emitFix({ latitude: 4.60253, longitude: -74.22268, accuracy: 5 }, permClock);
    const retriedRun = permController.finishRun();
    assert.ok(retriedRun);
    assert.equal(retriedRun.activeDurationSec, 15);
    assert.ok(retriedRun.distanceMeters > 95);

    permController.dispose();
    controller.dispose();
  });

  it('keeps status idle with zero ticking timer when geolocation is unavailable or synchronously denies permission', async () => {
    let clockMs = 1795134800000;
    let wakeLockRequests = 0;
    let emitted = 0;
    const visLog = [];
    const doc = {
      visibilityState: 'visible',
      addEventListener(type, fn) {
        visLog.push({ op: 'add', type, fn });
      },
      removeEventListener(type, fn) {
        visLog.push({ op: 'remove', type, fn });
      },
    };
    const wakeLock = {
      async request() {
        wakeLockRequests += 1;
        return { addEventListener() {}, async release() {} };
      },
    };

    // Case 1: geolocation === null
    const nullGeoController = createRunTrackerController({
      geolocation: null,
      wakeLock,
      doc,
      now: () => clockMs,
      tickIntervalMs: 15,
      onStateChange: () => {
        emitted += 1;
      },
    });
    nullGeoController.startRun();
    const emitsAfterNull = emitted;
    clockMs += 5000;
    await new Promise((r) => setTimeout(r, 40));
    let state = nullGeoController.getState();
    assert.equal(state.status, 'idle');
    assert.equal(state.gpsStatus, 'error');
    assert.equal(typeof state.gpsError, 'string');
    assert.ok(state.gpsError.length > 0 && state.gpsError.includes('Geolocalización'));
    assert.equal(state.activeDurationSec, 0);
    assert.equal(state.elapsedDurationSec, 0);
    assert.equal(state.pausedDurationSec, 0);
    assert.equal(emitted, emitsAfterNull);
    assert.equal(wakeLockRequests, 0);
    assert.equal(visLog.filter((e) => e.op === 'add').length, 0);
    nullGeoController.dispose();

    // Case 2: geolocation missing watchPosition
    const missingWatchController = createRunTrackerController({
      geolocation: {},
      wakeLock,
      doc,
      now: () => clockMs,
      tickIntervalMs: 15,
    });
    missingWatchController.startRun();
    clockMs += 5000;
    state = missingWatchController.getState();
    assert.equal(state.status, 'idle');
    assert.equal(state.gpsStatus, 'error');
    assert.ok(state.gpsError && state.gpsError.length > 0);
    assert.equal(state.activeDurationSec, 0);
    assert.equal(state.elapsedDurationSec, 0);
    assert.equal(wakeLockRequests, 0);
    missingWatchController.dispose();

    // Case 3: watchPosition synchronously invokes error code 1
    const clearedSyncIds = [];
    const syncDenyGeo = {
      watchPosition(_ok, err) {
        err({ code: 1, message: 'Permission denied' });
        return 42;
      },
      clearWatch(id) {
        clearedSyncIds.push(id);
      },
    };
    const syncDenyController = createRunTrackerController({
      geolocation: syncDenyGeo,
      wakeLock,
      doc,
      now: () => clockMs,
      tickIntervalMs: 15,
    });
    syncDenyController.startRun();
    clockMs += 5000;
    await new Promise((r) => setTimeout(r, 40));
    state = syncDenyController.getState();
    assert.equal(state.status, 'idle');
    assert.equal(state.gpsStatus, 'error');
    assert.ok(state.gpsError && state.gpsError.includes('Permiso'));
    assert.equal(state.activeDurationSec, 0);
    assert.equal(state.elapsedDurationSec, 0);
    assert.equal(state.pausedDurationSec, 0);
    assert.deepEqual(clearedSyncIds, [42]);
    assert.equal(wakeLockRequests, 0);
    syncDenyController.dispose();
  });

  it('survives Wake Lock rejection and supports discardRun / resetToIdle', async () => {
    const geo = createMockGeolocation();
    let clockMs = 1795135000000;
    const rejectingWakeLock = {
      async request() {
        throw new Error('WakeLock not allowed');
      },
    };

    const controller = createRunTrackerController({
      geolocation: geo,
      wakeLock: rejectingWakeLock,
      doc: null,
      now: () => clockMs,
      tickIntervalMs: 0,
    });

    controller.startRun();
    await Promise.resolve();
    assert.equal(controller.getState().status, 'recording');

    geo.emitFix({ latitude: 4.6, longitude: -74.22, accuracy: 5 }, clockMs);
    clockMs += 10000;
    controller.discardRun();
    assert.equal(controller.getState().status, 'idle');
    assert.equal(controller.getState().distanceMeters, 0);
    assert.equal(controller.getState().lastCompletedRun, null);
    assert.equal(geo.activeWatchCount, 0);

    controller.startRun();
    controller.finishRun();
    assert.equal(controller.getState().status, 'summary');
    controller.resetToIdle();
    assert.equal(controller.getState().status, 'idle');
    assert.equal(controller.getState().lastCompletedRun, null);

    controller.dispose();
  });

  it('releases all Wake Lock sentinels across deferred async start -> pause -> resume -> finish -> dispose races', async () => {
    const geo = createMockGeolocation();
    const sentinels = [];
    const pendingRequests = [];

    const deferredWakeLock = {
      request() {
        return new Promise((resolve) => {
          const sentinel = {
            id: sentinels.length,
            released: false,
            addEventListener() {},
            async release() {
              sentinel.released = true;
            },
          };
          sentinels.push(sentinel);
          pendingRequests.push(() => resolve(sentinel));
        });
      },
    };

    const controller = createRunTrackerController({
      geolocation: geo,
      wakeLock: deferredWakeLock,
      doc: null,
      now: () => 1795136000000,
      tickIntervalMs: 0,
    });

    // Race 1: startRun -> pauseRun -> resumeRun while sentinel 0 is still pending
    controller.startRun();
    controller.pauseRun();
    controller.resumeRun();
    assert.equal(pendingRequests.length, 2);

    // Resolve stale sentinel 0 -> must be released immediately
    pendingRequests[0]();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(sentinels[0].released, true);

    // Resolve active sentinel 1 -> remains held until finishRun
    pendingRequests[1]();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(sentinels[1].released, false);

    controller.finishRun();
    await Promise.resolve();
    assert.equal(sentinels[1].released, true);

    // Race 2: startRun -> finishRun -> dispose before sentinel 2 resolves
    controller.startRun();
    assert.equal(pendingRequests.length, 3);
    controller.finishRun();
    controller.dispose();
    pendingRequests[2]();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(sentinels.length, 3);
    assert.ok(sentinels.every((s) => s.released === true));
  });

  it('pre-validates coordinates, avoids premature accuracy rounding, isolates rejected fixes, and clears currentPace on resume', () => {
    const geo = createMockGeolocation();
    let clockMs = 1795137000000;

    const controller = createRunTrackerController({
      geolocation: geo,
      wakeLock: null,
      doc: null,
      now: () => clockMs,
      tickIntervalMs: 0,
    });

    controller.startRun();

    // Valid baseline fix
    geo.emitFix({ latitude: 4.60163, longitude: -74.22268, accuracy: 8 }, clockMs);
    let state = controller.getState();
    assert.equal(state.gpsStatus, 'locked');
    assert.equal(state.currentPosition.lat, 4.60163);
    assert.equal(state.accuracyMeters, 8);
    assert.equal(state.segments[0].length, 1);

    // Invalid NaN / out-of-range coordinates must not mutate currentPosition or gpsStatus
    geo.emitFix({ latitude: NaN, longitude: -74.22268, accuracy: 5 }, clockMs + 1000);
    geo.emitFix({ latitude: 95, longitude: -74.22268, accuracy: 5 }, clockMs + 1000);
    state = controller.getState();
    assert.equal(Number.isNaN(state.currentPosition.lat), false);
    assert.equal(state.currentPosition.lat, 4.60163);
    assert.equal(state.segments[0].length, 1);

    // Transient error sets gpsError; rejected fixes must NOT clear gpsError or mutate currentPosition
    geo.emitError({ code: 2, message: 'Position unavailable' });
    assert.ok(controller.getState().gpsError);

    // Accuracy 500m coarse outlier rejected
    geo.emitFix({ latitude: 4.62, longitude: -74.22268, accuracy: 500 }, clockMs + 2000);
    state = controller.getState();
    assert.equal(state.currentPosition.lat, 4.60163);
    assert.equal(state.accuracyMeters, 8);
    assert.ok(state.gpsError);
    assert.equal(state.segments[0].length, 1);

    // Accuracy 35.01 must NOT be rounded down to 35 before shouldAcceptFix
    geo.emitFix({ latitude: 4.602, longitude: -74.22268, accuracy: 35.01 }, clockMs + 3000);
    state = controller.getState();
    assert.equal(state.currentPosition.lat, 4.60163);
    assert.equal(state.segments[0].length, 1);
    assert.equal(state.distanceMeters, 0);
    assert.ok(state.gpsError);

    // Teleport spike (>12 m/s with acc > 20 and dt >= 1s) rejected without mutating currentPosition
    geo.emitFix({ latitude: 4.61, longitude: -74.22268, accuracy: 25 }, clockMs + 2000);
    state = controller.getState();
    assert.equal(state.currentPosition.lat, 4.60163);
    assert.ok(state.gpsError);

    // Stale timestamp rejected without mutating currentPosition
    geo.emitFix({ latitude: 4.602, longitude: -74.22268, accuracy: 5 }, clockMs - 1000);
    state = controller.getState();
    assert.equal(state.currentPosition.lat, 4.60163);
    assert.ok(state.gpsError);

    // Stationary jitter fix (valid coords & acc <= 35) refreshes currentPosition & clears transient gpsError
    clockMs += 4000;
    geo.emitFix({ latitude: 4.601635, longitude: -74.22268, accuracy: 6 }, clockMs);
    state = controller.getState();
    assert.equal(state.currentPosition.lat, 4.601635);
    assert.equal(state.accuracyMeters, 6);
    assert.equal(state.gpsStatus, 'locked');
    assert.equal(state.gpsError, null);
    assert.equal(state.segments[0].length, 1);

    // Move ~50m in 10s so currentPaceFormatted becomes active, then pause & resume -> resets to --:-- /km
    clockMs += 10000;
    geo.emitFix({ latitude: 4.60208, longitude: -74.22268, accuracy: 5 }, clockMs);
    state = controller.getState();
    assert.notEqual(state.currentPaceFormatted, '--:-- /km');

    controller.pauseRun();
    clockMs += 5000;
    controller.resumeRun();
    state = controller.getState();
    assert.equal(state.currentPaceFormatted, '--:-- /km');

    controller.dispose();
  });
});
