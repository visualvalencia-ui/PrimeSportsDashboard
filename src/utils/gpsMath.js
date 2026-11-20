/**
 * R1 Reverse-Engineering Findings (`https://github.com/morluto/rea`) & Strava GPS Math
 * ----------------------------------------------------------------------------------
 * 1. Repository Audit (`morluto/rea`, `rea-agents` v6.9.0, commit cb380f0ab3de302de112061a34924afd9554513b):
 *    The repository is "REA: Reverse Engineer Anything" (an MCP server & CLI toolkit for
 *    reverse-engineering native binaries, Electron/JS apps, and APKs). It contains zero Strava,
 *    GPS `watchPosition`, Haversine distance, pace, or map polyline code.
 * 2. Reverse-Engineered Strava & Web Geolocation Specification applied here (F1/F2):
 *    - 2D spherical Haversine distance with R = 6,371,000 m (matching athlete GPX tools).
 *    - Segment-isolated tracking (`TrackPoint[][]`): pausing closes the active segment and
 *      clears `lastActivePoint`; resuming opens a new segment so paused displacement adds 0 m.
 *    - Timestamp-anchored active clock strictly excludes paused intervals.
 *    - GPS noise & spike filtering: rejects `accuracy > 35 m` (allows synthetic `0`/`undefined`/`null`
 *      from automated browser tests), rejects micro-jitter `< 1.5 m`, and gates teleport rejection
 *      (`> 12 m/s`) strictly on `dt >= 1.0 s && accuracy > 20 m` so rapid simulated fixes pass.
 *    - Pace computation in `min/km` with 60-second rollover-safe `M:SS /km` formatting,
 *      windowed rolling current pace, and linearly interpolated per-km splits.
 */

export const EARTH_RADIUS_METERS = 6371000;

export const DEFAULT_FILTER_OPTIONS = Object.freeze({
  maxAccuracyMeters: 35,
  minJitterMeters: 1.5,
  maxSpeedMps: 12,
  teleportMinDtSec: 1.0,
  teleportMinAccuracyMeters: 20,
});

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

/**
 * Spherical Haversine distance in meters between two WGS84 coordinates.
 */
export function haversineMeters(lat1, lon1, lat2, lon2) {
  if (
    !Number.isFinite(lat1) ||
    !Number.isFinite(lon1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lon2)
  ) {
    return 0;
  }
  if (lat1 === lat2 && lon1 === lon2) {
    return 0;
  }

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const rLat1 = toRadians(lat1);
  const rLat2 = toRadians(lat2);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const a = sinDLat * sinDLat + Math.cos(rLat1) * Math.cos(rLat2) * sinDLon * sinDLon;
  const clampedA = Math.min(1, Math.max(0, a));
  const c = 2 * Math.atan2(Math.sqrt(clampedA), Math.sqrt(1 - clampedA));

  return EARTH_RADIUS_METERS * c;
}

/**
 * Evaluates whether an incoming GPS fix should be accepted into the active segment.
 */
export function shouldAcceptFix(prevPoint, nextPoint, options = {}) {
  const opts = { ...DEFAULT_FILTER_OPTIONS, ...options };

  if (
    !nextPoint ||
    typeof nextPoint !== 'object' ||
    !Number.isFinite(nextPoint.lat) ||
    !Number.isFinite(nextPoint.lng) ||
    Math.abs(nextPoint.lat) > 90 ||
    Math.abs(nextPoint.lng) > 180
  ) {
    return { accepted: false, reason: 'invalid_coords', deltaMeters: 0 };
  }

  const acc = nextPoint.acc ?? nextPoint.accuracy;
  if (typeof acc === 'number' && Number.isFinite(acc) && acc > opts.maxAccuracyMeters) {
    return { accepted: false, reason: 'low_accuracy', deltaMeters: 0 };
  }

  if (!prevPoint) {
    return { accepted: true, deltaMeters: 0 };
  }

  if (
    Number.isFinite(prevPoint.ts) &&
    Number.isFinite(nextPoint.ts) &&
    nextPoint.ts < prevPoint.ts
  ) {
    return { accepted: false, reason: 'stale_timestamp', deltaMeters: 0 };
  }

  const deltaMeters = haversineMeters(
    prevPoint.lat,
    prevPoint.lng,
    nextPoint.lat,
    nextPoint.lng
  );

  if (deltaMeters < opts.minJitterMeters) {
    return { accepted: false, reason: 'jitter', deltaMeters };
  }

  const dtSec = (Number(nextPoint.ts ?? 0) - Number(prevPoint.ts ?? 0)) / 1000;
  const hasCoarseAcc =
    typeof acc === 'number' &&
    Number.isFinite(acc) &&
    acc > opts.teleportMinAccuracyMeters;

  if (
    dtSec >= opts.teleportMinDtSec &&
    hasCoarseAcc &&
    deltaMeters / dtSec > opts.maxSpeedMps
  ) {
    return { accepted: false, reason: 'teleport_spike', deltaMeters };
  }

  return { accepted: true, deltaMeters };
}

/**
 * Computes pace in decimal minutes per kilometer, or null when insufficient data.
 */
export function calculatePaceMinPerKm(activeDurationSec, distanceMeters) {
  if (
    !Number.isFinite(activeDurationSec) ||
    !Number.isFinite(distanceMeters) ||
    activeDurationSec <= 0 ||
    distanceMeters < 10
  ) {
    return null;
  }
  return activeDurationSec / 60 / (distanceMeters / 1000);
}

/**
 * Formats seconds into MM:SS or HH:MM:SS.
 */
export function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '00:00';
  }
  const s = Math.floor(totalSeconds);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;

  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Formats decimal min/km pace into "M:SS /km", handling 60-second rollover safely.
 */
export function formatPace(paceMinPerKm) {
  if (
    paceMinPerKm === null ||
    paceMinPerKm === undefined ||
    !Number.isFinite(paceMinPerKm) ||
    paceMinPerKm <= 0
  ) {
    return '--:-- /km';
  }

  const totalSec = Math.round(paceMinPerKm * 60);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${String(secs).padStart(2, '0')} /km`;
}

/**
 * Normalizes TrackPoint[][] or [{ index/segmentIndex, points }] into valid TrackPoint[][].
 */
export function normalizeSegments(segments) {
  if (!Array.isArray(segments)) {
    return [];
  }

  const normalized = [];
  for (const seg of segments) {
    const rawPoints = Array.isArray(seg)
      ? seg
      : Array.isArray(seg?.points)
        ? seg.points
        : [];
    const validPoints = rawPoints.filter(
      (pt) =>
        pt &&
        typeof pt === 'object' &&
        Number.isFinite(pt.lat) &&
        Number.isFinite(pt.lng) &&
        Math.abs(pt.lat) <= 90 &&
        Math.abs(pt.lng) <= 180
    );
    if (validPoints.length > 0) {
      normalized.push(validPoints);
    }
  }
  return normalized;
}

/**
 * Computes rolling windowed current pace (min/km) over the trailing window of the active segment.
 */
export function calculateCurrentPaceMinPerKm(
  segments,
  nowMs = null,
  windowSec = 20,
  minWindowDistMeters = 15
) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return null;
  }

  const lastRaw = segments[segments.length - 1];
  const lastRawPts = Array.isArray(lastRaw) ? lastRaw : lastRaw?.points;
  if (!Array.isArray(lastRawPts) || lastRawPts.length < 2) {
    return null;
  }

  const normalizedLast = normalizeSegments([lastRaw]);
  if (normalizedLast.length === 0) {
    return null;
  }

  const seg = normalizedLast[0];
  if (!seg || seg.length < 2) {
    return null;
  }

  const lastPt = seg[seg.length - 1];
  if (!Number.isFinite(lastPt.ts)) {
    return null;
  }

  if (
    nowMs !== null &&
    Number.isFinite(nowMs) &&
    (nowMs - lastPt.ts) / 1000 > windowSec
  ) {
    return null;
  }

  let anchorIdx = seg.length - 1;
  let dist = 0;

  for (let i = seg.length - 2; i >= 0; i--) {
    const pt = seg[i];
    if (!Number.isFinite(pt.ts)) {
      break;
    }
    if ((lastPt.ts - pt.ts) / 1000 > windowSec) {
      break;
    }
    dist += haversineMeters(pt.lat, pt.lng, seg[i + 1].lat, seg[i + 1].lng);
    anchorIdx = i;
  }

  if (anchorIdx === seg.length - 1) {
    return null;
  }

  const dtSec = (lastPt.ts - seg[anchorIdx].ts) / 1000;
  if (dist < minWindowDistMeters || dtSec <= 0 || dist / dtSec < 0.5) {
    return null;
  }

  return dtSec / 60 / (dist / 1000);
}

/**
 * Computes complete run metrics strictly accumulating distance within each segment.
 */
export function computeRunMetrics(segments, activeDurationSec, elapsedDurationSec) {
  const segs = normalizeSegments(segments);

  let rawDistanceMeters = 0;
  let pointCount = 0;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  const splitsKm = [];
  let cumDist = 0;
  let nextKm = 1;
  let prevKmActiveSec = 0;
  let fallbackActiveSec = 0;

  for (const seg of segs) {
    let prevPt = null;
    let prevActiveSec = fallbackActiveSec;

    for (const pt of seg) {
      pointCount += 1;
      if (pt.lat < minLat) minLat = pt.lat;
      if (pt.lat > maxLat) maxLat = pt.lat;
      if (pt.lng < minLng) minLng = pt.lng;
      if (pt.lng > maxLng) maxLng = pt.lng;

      let ptActiveSec;
      if (typeof pt.elapsedSec === 'number' && Number.isFinite(pt.elapsedSec)) {
        ptActiveSec = Math.max(0, pt.elapsedSec);
      } else if (
        prevPt &&
        typeof pt.ts === 'number' &&
        Number.isFinite(pt.ts) &&
        typeof prevPt.ts === 'number' &&
        Number.isFinite(prevPt.ts)
      ) {
        fallbackActiveSec += Math.max(0, (pt.ts - prevPt.ts) / 1000);
        ptActiveSec = fallbackActiveSec;
      } else {
        ptActiveSec = fallbackActiveSec;
      }
      if (ptActiveSec > fallbackActiveSec) {
        fallbackActiveSec = ptActiveSec;
      }

      if (prevPt) {
        const stepDist = haversineMeters(prevPt.lat, prevPt.lng, pt.lat, pt.lng);
        rawDistanceMeters += stepDist;
        const prevCumDist = cumDist;
        cumDist += stepDist;

        while (stepDist > 0 && cumDist >= nextKm * 1000) {
          const targetMeters = nextKm * 1000;
          const fraction = (targetMeters - prevCumDist) / stepDist;
          const crossSec =
            prevActiveSec + fraction * Math.max(0, ptActiveSec - prevActiveSec);
          const splitDur = Math.max(1, Math.round(crossSec - prevKmActiveSec));
          const splitPaceMin = splitDur / 60;

          splitsKm.push({
            km: nextKm,
            durationSec: splitDur,
            paceMinPerKm: Math.round(splitPaceMin * 100) / 100,
            paceFormatted: formatPace(splitPaceMin),
          });

          prevKmActiveSec = crossSec;
          nextKm += 1;
        }
      }

      prevPt = pt;
      prevActiveSec = ptActiveSec;
    }
  }

  const safeActiveSec = Math.max(0, Math.round(Number(activeDurationSec) || 0));
  const safeElapsedSec = Math.max(
    safeActiveSec,
    Math.round(Number(elapsedDurationSec ?? safeActiveSec) || 0)
  );
  const pausedDurationSec = Math.max(0, safeElapsedSec - safeActiveSec);

  const distanceMeters = Math.round(rawDistanceMeters * 10) / 10;
  const distanceKm = Math.round((rawDistanceMeters / 1000) * 100) / 100;

  const rawPace = calculatePaceMinPerKm(safeActiveSec, rawDistanceMeters);
  const avgPaceMinPerKm = rawPace !== null ? Math.round(rawPace * 100) / 100 : null;
  const avgPaceFormatted = formatPace(rawPace);
  const avgSpeedKmh =
    rawDistanceMeters >= 10 && safeActiveSec > 0
      ? Math.round((rawDistanceMeters / 1000 / (safeActiveSec / 3600)) * 100) / 100
      : 0;

  const bounds =
    pointCount > 0
      ? { minLat, maxLat, minLng, maxLng }
      : null;

  return {
    distanceMeters,
    distanceKm,
    activeDurationSec: safeActiveSec,
    elapsedDurationSec: safeElapsedSec,
    pausedDurationSec,
    avgPaceMinPerKm,
    avgPaceFormatted,
    avgSpeedKmh,
    splitsKm,
    bounds,
    pointCount,
  };
}
