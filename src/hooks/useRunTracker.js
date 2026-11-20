import { useCallback, useEffect, useRef, useState } from 'react';
import {
  calculateCurrentPaceMinPerKm,
  computeRunMetrics,
  formatPace,
  shouldAcceptFix,
} from '../utils/gpsMath.js';

const DEFAULT_WATCH_OPTIONS = Object.freeze({
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 10000,
});

function formatLocalDate(ms) {
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Pure dependency-injected GPS run tracker state machine controller.
 * Designed for direct Node `--test` verification and React 18 StrictMode hook wrapping.
 */
export function createRunTrackerController({
  geolocation = typeof navigator !== 'undefined' ? navigator.geolocation : null,
  wakeLock = typeof navigator !== 'undefined' ? navigator.wakeLock : null,
  doc = typeof document !== 'undefined' ? document : null,
  now = () => Date.now(),
  tickIntervalMs = 250,
  watchOptions = DEFAULT_WATCH_OPTIONS,
  filterOptions = {},
  onStateChange = null,
} = {}) {
  let getNow = now;
  let currentWatchOptions = { ...DEFAULT_WATCH_OPTIONS, ...watchOptions };
  let currentFilterOptions = { ...filterOptions };
  let stateListener = onStateChange;

  let status = 'idle';
  let runStartedAtMs = null;
  let accumulatedActiveMs = 0;
  let activeSegmentStartMs = null;
  let segments = [];
  let lastActivePoint = null;
  let currentPosition = null;
  let gpsStatus = 'idle';
  let gpsError = null;
  let accuracyMeters = null;
  let lastCompletedRun = null;

  let watchId = null;
  let timerId = null;
  let wakeLockSentinel = null;
  let wakeLockEpoch = 0;
  let wakeLockInFlight = false;
  let disposed = false;
  let visibilityHandler = null;

  function getActiveMs(atMs = getNow()) {
    if (status === 'recording' && activeSegmentStartMs !== null) {
      return accumulatedActiveMs + Math.max(0, atMs - activeSegmentStartMs);
    }
    return accumulatedActiveMs;
  }

  function getElapsedMs(atMs = getNow()) {
    if (runStartedAtMs === null) {
      return 0;
    }
    if (status === 'summary' && lastCompletedRun) {
      return lastCompletedRun.elapsedDurationSec * 1000;
    }
    return Math.max(getActiveMs(atMs), Math.max(0, atMs - runStartedAtMs));
  }

  function getState() {
    const atMs = getNow();
    const activeSec =
      status === 'summary' && lastCompletedRun
        ? lastCompletedRun.activeDurationSec
        : Math.round(getActiveMs(atMs) / 1000);
    const elapsedSec =
      status === 'summary' && lastCompletedRun
        ? lastCompletedRun.elapsedDurationSec
        : Math.round(getElapsedMs(atMs) / 1000);

    const metrics =
      status === 'summary' && lastCompletedRun
        ? {
            distanceMeters: lastCompletedRun.distanceMeters,
            distanceKm: lastCompletedRun.distanceKm,
            activeDurationSec: lastCompletedRun.activeDurationSec,
            elapsedDurationSec: lastCompletedRun.elapsedDurationSec,
            pausedDurationSec: lastCompletedRun.pausedDurationSec,
            avgPaceMinPerKm: lastCompletedRun.avgPaceMinPerKm,
            avgPaceFormatted: lastCompletedRun.avgPaceFormatted,
            splitsKm: lastCompletedRun.splitsKm,
          }
        : computeRunMetrics(segments, activeSec, elapsedSec);

    const rawCurrentPace =
      status === 'recording'
        ? calculateCurrentPaceMinPerKm(segments, atMs)
        : null;

    return {
      status,
      distanceMeters: metrics.distanceMeters,
      distanceKm: metrics.distanceKm,
      activeDurationSec: metrics.activeDurationSec,
      elapsedDurationSec: metrics.elapsedDurationSec,
      pausedDurationSec: metrics.pausedDurationSec,
      avgPaceMinPerKm: metrics.avgPaceMinPerKm,
      avgPaceFormatted: metrics.avgPaceFormatted,
      currentPaceFormatted: formatPace(rawCurrentPace),
      splitsKm: metrics.splitsKm,
      segments: segments.map((seg) => seg.slice()),
      currentPosition,
      gpsStatus,
      gpsError,
      accuracyMeters,
      lastCompletedRun,
    };
  }

  function emit() {
    if (!disposed && typeof stateListener === 'function') {
      stateListener(getState());
    }
  }

  function stopWatch() {
    if (
      watchId !== null &&
      geolocation &&
      typeof geolocation.clearWatch === 'function'
    ) {
      try {
        geolocation.clearWatch(watchId);
      } catch {
        // Ignore browser cleanup errors
      }
    }
    watchId = null;
  }

  function stopTimer() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function startTimer() {
    stopTimer();
    if (typeof tickIntervalMs === 'number' && tickIntervalMs > 0) {
      timerId = setInterval(() => {
        if (!disposed && (status === 'recording' || status === 'paused')) {
          emit();
        }
      }, tickIntervalMs);
    }
  }

  async function releaseWakeLock() {
    wakeLockEpoch += 1;
    wakeLockInFlight = false;
    const sentinel = wakeLockSentinel;
    wakeLockSentinel = null;
    if (sentinel && typeof sentinel.release === 'function') {
      try {
        await sentinel.release();
      } catch {
        // Ignore release errors
      }
    }
  }

  async function acquireWakeLock() {
    if (
      disposed ||
      status !== 'recording' ||
      wakeLockSentinel ||
      wakeLockInFlight ||
      !wakeLock ||
      typeof wakeLock.request !== 'function'
    ) {
      return;
    }

    const myEpoch = ++wakeLockEpoch;
    wakeLockInFlight = true;
    try {
      const sentinel = await wakeLock.request('screen');
      if (myEpoch === wakeLockEpoch) {
        wakeLockInFlight = false;
      }
      if (disposed || status !== 'recording' || myEpoch !== wakeLockEpoch) {
        if (sentinel && typeof sentinel.release === 'function') {
          await sentinel.release().catch(() => {});
        }
        return;
      }
      const prevSentinel = wakeLockSentinel;
      wakeLockSentinel = sentinel;
      if (sentinel && typeof sentinel.addEventListener === 'function') {
        sentinel.addEventListener('release', () => {
          if (wakeLockSentinel === sentinel) {
            wakeLockSentinel = null;
          }
        });
      }
      if (
        prevSentinel &&
        prevSentinel !== sentinel &&
        typeof prevSentinel.release === 'function'
      ) {
        await prevSentinel.release().catch(() => {});
      }
    } catch {
      if (myEpoch === wakeLockEpoch) {
        wakeLockInFlight = false;
        wakeLockSentinel = null;
      }
    }
  }

  function bindVisibility() {
    if (
      visibilityHandler ||
      !doc ||
      typeof doc.addEventListener !== 'function'
    ) {
      return;
    }
    visibilityHandler = () => {
      if (
        !disposed &&
        doc.visibilityState === 'visible' &&
        status === 'recording' &&
        !wakeLockSentinel
      ) {
        acquireWakeLock();
      }
    };
    doc.addEventListener('visibilitychange', visibilityHandler);
  }

  function unbindVisibility() {
    if (
      visibilityHandler &&
      doc &&
      typeof doc.removeEventListener === 'function'
    ) {
      doc.removeEventListener('visibilitychange', visibilityHandler);
    }
    visibilityHandler = null;
  }

  function handlePosition(pos) {
    if (disposed || status !== 'recording' || !pos?.coords) {
      return;
    }

    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      return;
    }

    const rawAcc = pos.coords.accuracy;
    const rawAccFinite =
      typeof rawAcc === 'number' && Number.isFinite(rawAcc) ? rawAcc : null;
    const roundedAcc =
      rawAccFinite !== null ? Math.round(rawAccFinite * 10) / 10 : null;
    const ts =
      typeof pos.timestamp === 'number' &&
      Number.isFinite(pos.timestamp) &&
      pos.timestamp > 0
        ? pos.timestamp
        : getNow();

    const activeSec = Math.round((getActiveMs(getNow()) / 1000) * 10) / 10;
    const candidatePoint = {
      lat,
      lng,
      ts,
      elapsedSec: activeSec,
      acc: rawAccFinite,
    };

    const filterResult = shouldAcceptFix(
      lastActivePoint,
      candidatePoint,
      currentFilterOptions
    );

    if (!filterResult.accepted && filterResult.reason !== 'jitter') {
      return;
    }

    currentPosition = { lat, lng, acc: roundedAcc, ts };
    accuracyMeters = roundedAcc;
    gpsStatus = 'locked';
    gpsError = null;

    if (filterResult.accepted) {
      const storedPoint = {
        lat,
        lng,
        ts,
        elapsedSec: activeSec,
        acc: roundedAcc,
      };
      if (segments.length === 0) {
        segments = [[]];
      }
      const nextSegments = segments.slice();
      const activeIdx = nextSegments.length - 1;
      nextSegments[activeIdx] = [...nextSegments[activeIdx], storedPoint];
      segments = nextSegments;
      lastActivePoint = storedPoint;
    }

    emit();
  }

  function abortToIdleWithError(message) {
    stopWatch();
    stopTimer();
    releaseWakeLock();
    unbindVisibility();

    status = 'idle';
    runStartedAtMs = null;
    accumulatedActiveMs = 0;
    activeSegmentStartMs = null;
    segments = [];
    lastActivePoint = null;
    currentPosition = null;
    accuracyMeters = null;
    lastCompletedRun = null;
    gpsStatus = 'error';
    gpsError = message;
  }

  function handlePositionError(err) {
    if (disposed || status !== 'recording') {
      return;
    }

    const code = err?.code;
    if (code === 2 || code === 3) {
      // Transient POSITION_UNAVAILABLE (2) or TIMEOUT (3) — e.g. Chrome 158 CDP
      // setGeolocationOverride emits code 2 right before the updated fix.
      // Never stop the watch or abort/pause the run; next fix clears gpsError.
      gpsStatus = gpsStatus === 'locked' ? 'locked' : 'acquiring';
      gpsError =
        code === 3
          ? 'Tiempo de espera GPS agotado; reintentando señal...'
          : 'Señal GPS temporalmente no disponible; reintentando...';
      emit();
      return;
    }

    if (code === 1) {
      abortToIdleWithError(
        'Permiso de ubicación denegado. Activa el GPS para iniciar la carrera.'
      );
      emit();
      return;
    }

    gpsStatus = 'error';
    gpsError = err?.message || 'Error al obtener señal GPS.';
    emit();
  }

  function startWatch() {
    stopWatch();
    if (!geolocation || typeof geolocation.watchPosition !== 'function') {
      abortToIdleWithError('Geolocalización no disponible en este navegador.');
      return;
    }

    gpsStatus = 'acquiring';
    gpsError = null;
    let nextWatchId;
    try {
      nextWatchId = geolocation.watchPosition(
        handlePosition,
        handlePositionError,
        currentWatchOptions
      );
    } catch {
      abortToIdleWithError(
        'No se pudo iniciar el GPS. Verifica los permisos de ubicación.'
      );
      return;
    }
    if (disposed || status !== 'recording') {
      if (typeof geolocation.clearWatch === 'function') {
        try {
          geolocation.clearWatch(nextWatchId);
        } catch {
          // Ignore browser cleanup errors
        }
      }
      watchId = null;
      return;
    }
    watchId = nextWatchId;
  }

  function startRun() {
    if (status !== 'idle' && status !== 'summary') {
      return;
    }

    stopWatch();
    stopTimer();
    releaseWakeLock();
    unbindVisibility();

    const startMs = getNow();
    runStartedAtMs = startMs;
    accumulatedActiveMs = 0;
    activeSegmentStartMs = startMs;
    segments = [[]];
    lastActivePoint = null;
    currentPosition = null;
    accuracyMeters = null;
    gpsStatus = 'acquiring';
    gpsError = null;
    lastCompletedRun = null;
    status = 'recording';

    startWatch();
    if (status === 'recording') {
      startTimer();
      bindVisibility();
      acquireWakeLock();
    }
    emit();
  }

  function pauseRun() {
    if (status !== 'recording') {
      return;
    }

    const pauseMs = getNow();
    if (activeSegmentStartMs !== null) {
      accumulatedActiveMs += Math.max(0, pauseMs - activeSegmentStartMs);
    }
    activeSegmentStartMs = null;
    lastActivePoint = null;
    status = 'paused';

    stopWatch();
    releaseWakeLock();
    emit();
  }

  function resumeRun() {
    if (status !== 'paused') {
      return;
    }

    segments = [...segments, []];
    lastActivePoint = null;
    activeSegmentStartMs = getNow();
    status = 'recording';

    startWatch();
    if (status === 'recording') {
      bindVisibility();
      acquireWakeLock();
    }
    emit();
  }

  function finishRun() {
    if (status !== 'recording' && status !== 'paused') {
      return null;
    }

    const endMs = getNow();
    if (status === 'recording' && activeSegmentStartMs !== null) {
      accumulatedActiveMs += Math.max(0, endMs - activeSegmentStartMs);
      activeSegmentStartMs = null;
    }

    stopWatch();
    stopTimer();
    releaseWakeLock();
    unbindVisibility();

    status = 'summary';
    const cleanedSegments = segments
      .filter((seg) => seg.length > 0)
      .map((seg) => seg.slice());
    segments = cleanedSegments;

    const anchorStartMs = runStartedAtMs ?? endMs;
    const activeSec = Math.round(accumulatedActiveMs / 1000);
    const elapsedSec = Math.max(
      activeSec,
      Math.round(Math.max(0, endMs - anchorStartMs) / 1000)
    );
    const metrics = computeRunMetrics(cleanedSegments, activeSec, elapsedSec);

    const runActivity = {
      schemaVersion: 1,
      id: `run_${anchorStartMs}`,
      source: 'gps_pwa',
      sport: 'running',
      status: 'completed',
      title: `Carrera GPS - ${metrics.distanceKm.toFixed(2)} km`,
      startedAt: new Date(anchorStartMs).toISOString(),
      endedAt: new Date(endMs).toISOString(),
      dateLocal: formatLocalDate(anchorStartMs),
      ...metrics,
      segments: cleanedSegments,
      notes: '',
    };

    lastCompletedRun = runActivity;
    emit();
    return runActivity;
  }

  function resetState() {
    stopWatch();
    stopTimer();
    releaseWakeLock();
    unbindVisibility();

    status = 'idle';
    runStartedAtMs = null;
    accumulatedActiveMs = 0;
    activeSegmentStartMs = null;
    segments = [];
    lastActivePoint = null;
    currentPosition = null;
    gpsStatus = 'idle';
    gpsError = null;
    accuracyMeters = null;
    lastCompletedRun = null;
    emit();
  }

  function discardRun() {
    resetState();
  }

  function resetToIdle() {
    resetState();
  }

  function dispose() {
    disposed = true;
    stopWatch();
    stopTimer();
    releaseWakeLock();
    unbindVisibility();
  }

  function setDisposed(nextDisposed) {
    disposed = Boolean(nextDisposed);
  }

  function updateOptions(nextOptions = {}) {
    if (typeof nextOptions.now === 'function') {
      getNow = nextOptions.now;
    }
    if (nextOptions.watchOptions) {
      currentWatchOptions = {
        ...DEFAULT_WATCH_OPTIONS,
        ...nextOptions.watchOptions,
      };
    }
    if (nextOptions.filterOptions) {
      currentFilterOptions = { ...nextOptions.filterOptions };
    }
    if (nextOptions.onStateChange !== undefined) {
      stateListener = nextOptions.onStateChange;
    }
  }

  return {
    startRun,
    pauseRun,
    resumeRun,
    finishRun,
    discardRun,
    resetToIdle,
    getState,
    dispose,
    setDisposed,
    updateOptions,
  };
}

/**
 * React 18 StrictMode-safe hook wrapping `createRunTrackerController`.
 */
export function useRunTracker(options = {}) {
  const controllerRef = useRef(null);
  if (!controllerRef.current) {
    controllerRef.current = createRunTrackerController(options);
  }

  const [snapshot, setSnapshot] = useState(() => controllerRef.current.getState());

  controllerRef.current.updateOptions({
    now: options.now,
    watchOptions: options.watchOptions,
    filterOptions: options.filterOptions,
    onStateChange: setSnapshot,
  });

  useEffect(() => {
    const controller = controllerRef.current;
    controller.setDisposed(false);
    controller.updateOptions({ onStateChange: setSnapshot });

    return () => {
      controller.dispose();
    };
  }, []);

  const startRun = useCallback(() => controllerRef.current.startRun(), []);
  const pauseRun = useCallback(() => controllerRef.current.pauseRun(), []);
  const resumeRun = useCallback(() => controllerRef.current.resumeRun(), []);
  const finishRun = useCallback(() => controllerRef.current.finishRun(), []);
  const discardRun = useCallback(() => controllerRef.current.discardRun(), []);
  const resetToIdle = useCallback(() => controllerRef.current.resetToIdle(), []);

  return {
    ...snapshot,
    startRun,
    pauseRun,
    resumeRun,
    finishRun,
    discardRun,
    resetToIdle,
  };
}
