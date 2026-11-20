import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { deleteApp } from 'firebase/app';
import { deleteDoc, doc, setDoc, terminate } from 'firebase/firestore';
import { app, db } from '../../src/firebase.js';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const cliPath = path.join(projectRoot, 'query-runs.mjs');

describe('query-runs.mjs CLI', () => {
  const athleteId = `cli_test_${process.pid}_${Date.now()}`;
  const runId = `run_cli_${Date.now()}`;

  after(async () => {
    await deleteDoc(doc(db, 'sports_prime_test', athleteId, 'runs', runId)).catch(
      () => {}
    );
    await deleteDoc(doc(db, 'sports_prime_test', athleteId)).catch(() => {});
    await terminate(db);
    await deleteApp(app);
  });

  it('prints usage for --help and exits 0', async () => {
    const { stdout } = await execFileAsync(process.execPath, [cliPath, '--help'], {
      cwd: projectRoot,
    });
    for (const flag of ['--collection', '--athlete', '--limit', '--runId', '--json']) {
      assert.ok(stdout.includes(flag), `expected help output to include ${flag}`);
    }
  });

  it('exits non-zero for invalid --limit 0 and reserved Firestore IDs (., .., __*__)', async () => {
    await assert.rejects(
      execFileAsync(process.execPath, [cliPath, '--limit', '0'], {
        cwd: projectRoot,
      }),
      (err) => err && typeof err.code === 'number' && err.code !== 0
    );

    for (const args of [
      ['--collection', '..'],
      ['--athlete', '.'],
      ['--runId', '__bad__'],
    ]) {
      await assert.rejects(
        execFileAsync(process.execPath, [cliPath, ...args], {
          cwd: projectRoot,
        }),
        (err) => err && typeof err.code === 'number' && err.code !== 0
      );
    }
  });

  it('queries seeded run in sports_prime_test via --json list and --runId', async () => {
    await setDoc(doc(db, 'sports_prime_test', athleteId, 'runs', runId), {
      schemaVersion: 1,
      id: runId,
      source: 'gps_pwa',
      sport: 'running',
      status: 'completed',
      title: 'Carrera GPS - 2.00 km',
      startedAt: '2026-11-20T10:00:00.000Z',
      endedAt: '2026-11-20T10:15:00.000Z',
      dateLocal: '2026-11-20',
      distanceMeters: 2000,
      distanceKm: 2.0,
      activeDurationSec: 800,
      elapsedDurationSec: 900,
      pausedDurationSec: 100,
      avgPaceMinPerKm: 6.67,
      avgPaceFormatted: '6:40 /km',
      avgSpeedKmh: 9.0,
      pointCount: 2,
      bounds: { minLat: 4.60163, maxLat: 4.60523, minLng: -74.22268, maxLng: -74.22268 },
      splitsKm: [],
      segments: [
        {
          index: 0,
          points: [
            { lat: 4.60163, lng: -74.22268, ts: 1795133700000, elapsedSec: 0, acc: 5 },
            { lat: 4.60523, lng: -74.22268, ts: 1795134500000, elapsedSec: 800, acc: 5 },
          ],
        },
      ],
      notes: 'CLI test',
    });

    const listRes = await execFileAsync(
      process.execPath,
      [
        cliPath,
        '--collection',
        'sports_prime_test',
        '--athlete',
        athleteId,
        '--limit',
        '5',
        '--json',
      ],
      { cwd: projectRoot }
    );
    const listJson = JSON.parse(listRes.stdout);
    assert.equal(listJson.target.collection, 'sports_prime_test');
    assert.equal(listJson.target.athlete, athleteId);
    assert.equal(listJson.count, 1);
    assert.equal(listJson.runs[0].id, runId);

    const detailRes = await execFileAsync(
      process.execPath,
      [
        cliPath,
        '--collection',
        'sports_prime_test',
        '--athlete',
        athleteId,
        '--runId',
        runId,
        '--json',
      ],
      { cwd: projectRoot }
    );
    const detailJson = JSON.parse(detailRes.stdout);
    assert.equal(detailJson.found, true);
    assert.equal(detailJson.run.id, runId);

    // Nonexistent runId should exit non-zero with found: false
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [
          cliPath,
          '--collection',
          'sports_prime_test',
          '--athlete',
          athleteId,
          '--runId',
          'nonexistent_run_id',
          '--json',
        ],
        { cwd: projectRoot }
      ),
      (err) => {
        if (!err || err.code === 0) return false;
        const parsed = JSON.parse(err.stdout);
        return parsed.found === false && parsed.run === null;
      }
    );
  });
});
