import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { extractSingleRun } from './helpers/cliVerifier.mjs';
import {
  TEST_COLLECTION,
  assertProductionCamiloUnchanged,
  assertSafeTestTarget,
  cleanupTestAthlete,
  createCleanupTracker,
  extractTrackpointStats,
  generateTestAthleteId,
  getAthleteDoc,
  getRunDoc,
  listRuns,
  snapshotProductionCamilo,
  writeTestAthleteDoc,
  writeTestRunDoc,
} from './helpers/firestoreCleanup.mjs';
import {
  assertMobileLayout,
  assertNoAppErrors,
  attachErrorGuard,
  buildAppUrl,
  createGpsContext,
  launchBrowser,
  startViteServer,
} from './helpers/harness.mjs';
import { clickNavTab, locatorFor, waitForSelectorKey } from './helpers/selectors.mjs';
import {
  ROUTE_A_ACTIVE_METERS,
  ROUTE_A_JUMP_FROM_A5_METERS,
  ROUTE_B_METERS,
  ROUTE_C_JITTER_METERS,
  ROUTE_C_SHORT_METERS,
  ROUTE_C_TELEPORT_METERS,
} from './helpers/waypoints.mjs';

describe('E2E Smoke Suite (Harness, Safety Guards & Current PWA)', () => {
  const tracker = createCleanupTracker();
  let prodBefore;
  let server;
  let browser;

  before(async () => {
    prodBefore = await snapshotProductionCamilo();
    server = await startViteServer();
    browser = await launchBrowser();
  });

  after(async () => {
    await tracker.cleanupAll();
    if (browser) await browser.close();
    if (server) await server.stop();
    if (prodBefore) await assertProductionCamiloUnchanged(prodBefore);
  });

  it('enforces hard safety guards against sports_prime, camilo, whitespace, and invalid IDs, and verifies extractors', () => {
    assert.throws(() => assertSafeTestTarget('sports_prime', 'e2e_test_1'), /SAFETY GUARD/);
    assert.throws(() => assertSafeTestTarget('sports_prime_test', 'camilo'), /SAFETY GUARD/);
    assert.throws(() => assertSafeTestTarget('sports_prime_test', 'bad_id'), /SAFETY GUARD/);
    assert.throws(() => assertSafeTestTarget('sports_prime_test', 'e2e_test_a/b'), /SAFETY GUARD/);
    assert.throws(() => assertSafeTestTarget('sports_prime_test', ' e2e_test_1 '), /SAFETY GUARD/);
    assert.throws(() => assertSafeTestTarget('sports_prime_test ', 'e2e_test_1'), /SAFETY GUARD/);
    assert.throws(() => assertSafeTestTarget(' sports_prime ', 'e2e_test_1'), /SAFETY GUARD/);
    assert.doesNotThrow(() => assertSafeTestTarget(TEST_COLLECTION, 'e2e_test_valid_1'));

    // cliVerifier.extractSingleRun contract
    assert.deepStrictEqual(
      extractSingleRun({ items: [{ id: 'r1' }, { id: 'r2' }] }, 'r2'),
      { id: 'r2' }
    );
    assert.equal(extractSingleRun({ items: [{ id: 'r1' }, { id: 'r2' }] }, 'r_missing'), null);
    assert.equal(extractSingleRun([{ id: 'r1' }], 'r_missing'), null);
    assert.equal(extractSingleRun({ runs: [{ id: 'r1' }] }, 'r_missing'), null);
    assert.equal(extractSingleRun({}), null);
    assert.equal(extractSingleRun({ found: false }), null);
    assert.equal(extractSingleRun({ found: false, run: null }), null);

    // firestoreCleanup.extractTrackpointStats fallback & ordering
    const tpFallbackStats = extractTrackpointStats({
      segments: [],
      trackpoints: [
        { lat: 4.62, lng: -74.22, segmentIndex: 1 },
        { lat: 4.6, lng: -74.2, segmentIndex: 0 },
        { lat: 4.61, lng: -74.21, segmentIndex: 0 },
      ],
    });
    assert.equal(tpFallbackStats.segmentCount, 2);
    assert.equal(tpFallbackStats.segmentsNormalized[0].length, 2);
    assert.equal(tpFallbackStats.segmentsNormalized[1].length, 1);
    assert.deepStrictEqual(
      tpFallbackStats.points.map((p) => p.segmentIndex),
      [0, 0, 1]
    );

    const wrappedOrderStats = extractTrackpointStats({
      segments: [
        { index: 1, points: [{ lat: 4.62, lng: -74.22 }] },
        { index: 0, points: [{ lat: 4.6, lng: -74.2 }] },
      ],
    });
    assert.equal(wrappedOrderStats.segmentCount, 2);
    assert.deepStrictEqual(
      wrappedOrderStats.points.map((p) => p.lat),
      [4.6, 4.62]
    );
  });

  it('verifies Ciudad Verde ground-truth Haversine distances', () => {
    assert.ok(Math.abs(ROUTE_A_ACTIVE_METERS - 1155.63) < 0.2);
    assert.ok(Math.abs(ROUTE_A_JUMP_FROM_A5_METERS - 505.90) < 0.2);
    assert.ok(Math.abs(ROUTE_B_METERS - 3260.45) < 0.2);
    assert.ok(Math.abs(ROUTE_C_JITTER_METERS - 0.711) < 0.05);
    assert.ok(Math.abs(ROUTE_C_SHORT_METERS - 5.004) < 0.05);
    assert.ok(Math.abs(ROUTE_C_TELEPORT_METERS - 63.381) < 0.05);
  });

  it('renders current PWA cleanly at 390x844 in local Chrome with zero app errors', async () => {
    const athleteId = tracker.register(generateTestAthleteId('smoke_ui'));
    const context = await createGpsContext(browser);
    try {
      const page = await context.newPage();
      const errors = attachErrorGuard(page, { serverMode: server.mode });

      await page.goto(buildAppUrl(server.baseUrl, athleteId), {
        waitUntil: 'domcontentloaded',
      });

      const header = await waitForSelectorKey(page, 'appHeader');
      assert.match(await header.textContent(), /Prime Tracker/i);

      await waitForSelectorKey(page, 'navBar');
      await waitForSelectorKey(page, 'cardAerobic');
      await waitForSelectorKey(page, 'cardStrength');
      await assertMobileLayout(page);

      // Navigate Registrar (verify form renders; do NOT submit until M1/M2 isolates App.jsx)
      await clickNavTab(page, 'navAdd');
      await waitForSelectorKey(page, 'manualTypeSelect');
      await waitForSelectorKey(page, 'manualValueInput');
      await waitForSelectorKey(page, 'manualSaveBtn');
      await assertMobileLayout(page);

      // Navigate Historial
      await clickNavTab(page, 'navHistory');
      await waitForSelectorKey(page, 'historyView');
      await assertMobileLayout(page);

      // Return Dashboard
      await clickNavTab(page, 'navDashboard');
      await assert.ok(await locatorFor(page, 'cardAerobic').isVisible());

      assertNoAppErrors(errors);
    } finally {
      await context.close();
      await tracker.cleanupOne(athleteId);
    }
  });

  it('performs isolated Firestore REST write/list/cleanup roundtrip in sports_prime_test', async () => {
    const athleteId = tracker.register(generateTestAthleteId('smoke_fs'));
    const runId = 'run_smoke_1';

    try {
      await writeTestAthleteDoc(athleteId, {
        logs: [
          {
            id: runId,
            runId,
            date: '2026-11-20T00:00:00.000Z',
            type: 'cardio',
            source: 'gps_pwa',
            v1: 1.16,
            v2: 8.5,
          },
        ],
      });

      await writeTestRunDoc(athleteId, runId, {
        schemaVersion: 1,
        id: runId,
        source: 'gps_pwa',
        sport: 'running',
        status: 'completed',
        distanceMeters: 1155.63,
        distanceKm: 1.16,
        activeDurationSec: 510,
        pausedDurationSec: 5,
        avgPaceMinPerKm: 7.35,
        avgPaceFormatted: '7:21 /km',
        pointCount: 2,
        segments: [
          {
            index: 0,
            points: [
              { lat: 4.60163, lng: -74.222679, ts: 1795133700000, elapsedSec: 0, acc: 8 },
            ],
          },
          {
            index: 1,
            points: [
              { lat: 4.6075, lng: -74.22915, ts: 1795133710000, elapsedSec: 10, acc: 8 },
            ],
          },
        ],
      });

      const athleteDoc = await getAthleteDoc(athleteId);
      assert.ok(athleteDoc, 'Expected test athlete doc to exist');
      assert.equal(athleteDoc.data.logs.length, 1);

      const runs = await listRuns(athleteId);
      assert.equal(runs.length, 1);
      assert.equal(runs[0].id, runId);

      const single = await getRunDoc(athleteId, runId);
      assert.ok(single);
      const stats = extractTrackpointStats(single.data);
      assert.equal(stats.segmentCount, 2);
      assert.equal(stats.points.length, 2);

      const cleanupSummary = await cleanupTestAthlete(athleteId);
      assert.equal(cleanupSummary.deletedRunsCount, 1);
      assert.equal(cleanupSummary.deletedParentDoc, true);
      assert.equal((await listRuns(athleteId)).length, 0);
      assert.equal(await getAthleteDoc(athleteId), null);
    } finally {
      await tracker.cleanupOne(athleteId);
    }
  });
});
