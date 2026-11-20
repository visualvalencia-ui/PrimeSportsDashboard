import { parseArgs } from 'node:util';
import { deleteApp } from 'firebase/app';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  terminate,
} from 'firebase/firestore';
import { app, db } from './src/firebase.js';

function printUsage() {
  console.log(`Usage: node query-runs.mjs [options]

Read-only CLI to inspect GPS runs stored in Firebase Firestore (dashboard-semanal-99c26).

Options:
  --collection <name>   Firestore collection (default: VITE_FIRESTORE_COLLECTION or "sports_prime")
  --athlete <id>        Athlete document ID (default: VITE_ATHLETE_ID or "camilo")
  --limit <n>           Max runs to return in list mode, positive integer (default: 10)
  --runId <id>          Fetch a single run by document ID
  --json                Emit structured JSON to stdout
  -h, --help            Show this help message

Examples:
  node query-runs.mjs
  node query-runs.mjs --collection sports_prime --athlete camilo --limit 5 --json
  node query-runs.mjs --collection sports_prime_test --athlete e2e_test --runId run_123 --json`);
}

function cleanId(value) {
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

function formatDurationCompact(totalSeconds) {
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

function summarizeSegments(rawSegments, fallbackTrackpoints) {
  if (Array.isArray(rawSegments) && rawSegments.length > 0) {
    let points = 0;
    for (const seg of rawSegments) {
      if (Array.isArray(seg)) {
        points += seg.length;
      } else if (seg && Array.isArray(seg.points)) {
        points += seg.points.length;
      }
    }
    return { segmentCount: rawSegments.length, pointCount: points };
  }
  if (Array.isArray(fallbackTrackpoints) && fallbackTrackpoints.length > 0) {
    return { segmentCount: 1, pointCount: fallbackTrackpoints.length };
  }
  return { segmentCount: 0, pointCount: 0 };
}

function parsePointCount(value, fallback) {
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

function printHumanRunList(target, runs) {
  console.log(`Target: ${target.path} (${runs.length} run${runs.length === 1 ? '' : 's'})`);
  if (runs.length === 0) {
    console.log('No runs found.');
    return;
  }

  for (const run of runs) {
    const segSummary = summarizeSegments(run.segments, run.trackpoints);
    const pointCount = parsePointCount(run.pointCount, segSummary.pointCount);
    const splitsCount = Array.isArray(run.splitsKm) ? run.splitsKm.length : 0;
    const distanceKm = Number.isFinite(Number(run.distanceKm))
      ? Number(run.distanceKm).toFixed(2)
      : '0.00';
    const activeDur = formatDurationCompact(Number(run.activeDurationSec));
    const pausedSec = Number.isFinite(Number(run.pausedDurationSec))
      ? Number(run.pausedDurationSec)
      : 0;
    const pace = run.avgPaceFormatted || '--:-- /km';
    const speed = Number.isFinite(Number(run.avgSpeedKmh))
      ? `${Number(run.avgSpeedKmh).toFixed(2)} km/h`
      : '0.00 km/h';

    console.log(
      `- [${run.id}] ${run.dateLocal || run.startedAt || ''} | ${run.title || 'Carrera GPS'} | ${distanceKm} km | active ${activeDur} (paused ${pausedSec}s) | ${pace} | ${speed} | ${pointCount} pts (${segSummary.segmentCount} segs) | ${splitsCount} splits${run.notes ? ` | notes: ${run.notes}` : ''}`
    );
  }
}

function printHumanRunDetail(target, run) {
  const segSummary = summarizeSegments(run.segments, run.trackpoints);
  const pointCount = parsePointCount(run.pointCount, segSummary.pointCount);
  console.log(`Run: ${target.path}/${run.id}`);
  console.log(`Title: ${run.title || 'Carrera GPS'}`);
  console.log(`Date: ${run.dateLocal || ''} (${run.startedAt || ''} -> ${run.endedAt || ''})`);
  console.log(
    `Distance: ${Number(run.distanceKm || 0).toFixed(2)} km (${run.distanceMeters ?? 0} m)`
  );
  console.log(
    `Duration: active ${formatDurationCompact(Number(run.activeDurationSec))} (${run.activeDurationSec ?? 0}s), elapsed ${run.elapsedDurationSec ?? 0}s, paused ${run.pausedDurationSec ?? 0}s`
  );
  console.log(
    `Pace & Speed: ${run.avgPaceFormatted || '--:-- /km'} | ${Number(run.avgSpeedKmh || 0).toFixed(2)} km/h`
  );
  console.log(
    `Trace: ${pointCount} points across ${segSummary.segmentCount} segment(s)`
  );
  if (run.bounds) {
    console.log(`Bounds: ${JSON.stringify(run.bounds)}`);
  }
  if (Array.isArray(run.splitsKm) && run.splitsKm.length > 0) {
    console.log('Splits:');
    for (const split of run.splitsKm) {
      console.log(
        `  km ${split.km}: ${formatDurationCompact(Number(split.durationSec))} (${split.paceFormatted || '--:-- /km'})`
      );
    }
  }
  if (run.notes) {
    console.log(`Notes: ${run.notes}`);
  }
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        collection: { type: 'string' },
        athlete: { type: 'string' },
        limit: { type: 'string', default: '10' },
        runId: { type: 'string' },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: false,
    }));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (values.help) {
    printUsage();
    return;
  }

  const rawCollection =
    values.collection ?? process.env.VITE_FIRESTORE_COLLECTION ?? 'sports_prime';
  const rawAthlete =
    values.athlete ?? process.env.VITE_ATHLETE_ID ?? 'camilo';

  const collectionName = cleanId(rawCollection);
  const athleteId = cleanId(rawAthlete);

  if (!collectionName) {
    console.error('Error: --collection must be a non-empty single path segment.');
    process.exitCode = 1;
    return;
  }
  if (!athleteId) {
    console.error('Error: --athlete must be a non-empty single path segment.');
    process.exitCode = 1;
    return;
  }

  const parsedLimit = Number(values.limit);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
    console.error('Error: --limit must be a positive integer (>= 1).');
    process.exitCode = 1;
    return;
  }

  let runId = null;
  if (values.runId !== undefined) {
    runId = cleanId(values.runId);
    if (!runId) {
      console.error('Error: --runId must be a non-empty single document ID.');
      process.exitCode = 1;
      return;
    }
  }

  const target = {
    collection: collectionName,
    athlete: athleteId,
    path: `${collectionName}/${athleteId}/runs`,
  };

  let usedFirestore = false;
  try {
    usedFirestore = true;
    if (runId) {
      const snap = await getDoc(doc(db, collectionName, athleteId, 'runs', runId));
      if (!snap.exists()) {
        process.exitCode = 1;
        if (values.json) {
          console.log(
            JSON.stringify({ target, runId, found: false, run: null }, null, 2)
          );
        } else {
          console.error(`No run found at ${target.path}/${runId}`);
        }
        return;
      }

      const run = { id: snap.id, ...snap.data() };
      if (values.json) {
        console.log(
          JSON.stringify({ target, runId, found: true, run }, null, 2)
        );
      } else {
        printHumanRunDetail(target, run);
      }
      return;
    }

    const q = query(
      collection(db, collectionName, athleteId, 'runs'),
      orderBy('startedAt', 'desc'),
      limit(parsedLimit)
    );
    const snapshot = await getDocs(q);
    const runs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (values.json) {
      console.log(
        JSON.stringify(
          {
            target,
            limit: parsedLimit,
            count: runs.length,
            runs,
          },
          null,
          2
        )
      );
    } else {
      printHumanRunList(target, runs);
    }
  } catch (err) {
    console.error(`Error querying Firestore: ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (usedFirestore) {
      await terminate(db).catch(() => {});
      await deleteApp(app).catch(() => {});
    }
  }
}

await main();
