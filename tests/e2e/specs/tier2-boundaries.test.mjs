import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  assertProductionCamiloUnchanged,
  createCleanupTracker,
  extractTrackpointStats,
  generateTestAthleteId,
  snapshotProductionCamilo,
} from '../helpers/firestoreCleanup.mjs';
import {
  assertMobileLayout,
  assertNoAppErrors,
  attachErrorGuard,
  createDeniedGeoContext,
  createGpsContext,
  geoDriver,
  launchBrowser,
  startViteServer,
} from '../helpers/harness.mjs';
import {
  finishAndAwaitPersistence,
  openIsolatedApp,
  openRunTabAndStart,
  readRunSummaryMetrics,
  resumeRunAtFix,
  stepRouteSegment,
} from '../helpers/runActions.mjs';
import {
  clickNavTab,
  locatorFor,
  waitForSelectorKey,
} from '../helpers/selectors.mjs';
import {
  ROUTE_A_PAUSE_JUMP,
  ROUTE_A_SEG1,
  ROUTE_A_SEG2,
  ROUTE_C,
  haversineMeters,
  sumPathMeters,
} from '../helpers/waypoints.mjs';

describe('Tier 2 — Boundary Conditions, Error Paths & 390x844 Layout (T2-01..T2-08)', () => {
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

  async function withIsolatedPage(tag, initialGeo, fn) {
    const athleteId = tracker.register(generateTestAthleteId(tag));
    const context = await createGpsContext(browser, initialGeo ?? undefined);
    try {
      const page = await context.newPage();
      const errors = attachErrorGuard(page, { serverMode: server.mode });
      await openIsolatedApp(page, server.baseUrl, athleteId, initialGeo);
      await fn({ page, context, athleteId, errors });
      assertNoAppErrors(errors);
    } finally {
      await context.close();
      await tracker.cleanupOne(athleteId);
    }
  }

  it('T2-01: Rapid start and finish (0 m) yields 0.00 km, null pace, and "--:-- /km" without NaN', async () => {
    await withIsolatedPage('t2_01', ROUTE_A_SEG1[0], async ({ page, athleteId }) => {
      await openRunTabAndStart(page, ROUTE_A_SEG1[0]);
      await page.waitForTimeout(1100);
      const persisted = await finishAndAwaitPersistence(page, athleteId);
      const summary = await readRunSummaryMetrics(page);

      assert.equal(summary.distanceKm, 0);
      assert.match(summary.paceText, /--:--\s*\/km/);
      assert.doesNotMatch(summary.paceText, /NaN|Infinity/i);

      const run = persisted.runs[0].data;
      assert.equal(run.distanceMeters, 0);
      assert.equal(run.distanceKm, 0);
      assert.equal(run.avgPaceMinPerKm, null);
    });
  });

  it('T2-02: Sub-10m micro-run (5.004 m) keeps avgPaceMinPerKm null and displays "--:-- /km"', async () => {
    await withIsolatedPage('t2_02', ROUTE_C.c0, async ({ page, athleteId }) => {
      await openRunTabAndStart(page, ROUTE_C.c0);
      await page.waitForTimeout(1500);
      await geoDriver.stepAcceptedFix(page.context(), page, ROUTE_C.c_short, {
        stepDelayMs: 1000,
      });
      const persisted = await finishAndAwaitPersistence(page, athleteId);
      const summary = await readRunSummaryMetrics(page);

      const run = persisted.runs[0].data;
      assert.ok(
        run.distanceMeters >= 4.8 && run.distanceMeters <= 5.2,
        `Expected ~5.004 m, got ${run.distanceMeters}`
      );
      assert.equal(run.avgPaceMinPerKm, null);
      assert.match(summary.paceText, /--:--\s*\/km/);
    });
  });

  it('T2-03: Micro-jitter fix (0.711 m < 1.5 m) is rejected so distance stays 0 m', async () => {
    await withIsolatedPage('t2_03', ROUTE_C.c0, async ({ page, athleteId }) => {
      await openRunTabAndStart(page, ROUTE_C.c0);
      await geoDriver.stepIgnoredFix(page.context(), page, ROUTE_C.c_jitter, {
        settleMs: 1000,
      });
      const persisted = await finishAndAwaitPersistence(page, athleteId);
      const run = persisted.runs[0].data;
      assert.equal(run.distanceMeters, 0);
    });
  });

  it('T2-04: Accuracy boundary rejects acc=36 and acc=60 while accepting acc=35', async () => {
    await withIsolatedPage('t2_04', ROUTE_A_SEG1[0], async ({ page, athleteId }) => {
      await openRunTabAndStart(page, ROUTE_A_SEG1[0]);

      await geoDriver.stepIgnoredFix(
        page.context(),
        page,
        { ...ROUTE_A_SEG1[1], accuracy: 36 },
        { settleMs: 450 }
      );
      await geoDriver.stepIgnoredFix(
        page.context(),
        page,
        { ...ROUTE_A_SEG1[2], accuracy: 60 },
        { settleMs: 450 }
      );
      await geoDriver.stepAcceptedFix(
        page.context(),
        page,
        { ...ROUTE_A_SEG1[1], accuracy: 35 },
        { waitForDistanceChange: true, stepDelayMs: 450 }
      );

      const persisted = await finishAndAwaitPersistence(page, athleteId);
      const expectedMeters = haversineMeters(
        ROUTE_A_SEG1[0].lat,
        ROUTE_A_SEG1[0].lng,
        ROUTE_A_SEG1[1].lat,
        ROUTE_A_SEG1[1].lng
      );
      const actualMeters = persisted.runs[0].data.distanceMeters;
      assert.ok(
        Math.abs(actualMeters - expectedMeters) / expectedMeters <= 0.02,
        `Expected ~${expectedMeters.toFixed(2)} m (acc=35 only), got ${actualMeters}`
      );
    });
  });

  it('T2-05: Teleport filter rejects >12 m/s spike when dt >= 1s & acc=25, but accepts acc=8', async () => {
    await withIsolatedPage('t2_05', ROUTE_C.c0, async ({ page, athleteId }) => {
      await openRunTabAndStart(page, ROUTE_C.c0);
      await page.waitForTimeout(1500);

      await geoDriver.stepIgnoredFix(page.context(), page, ROUTE_C.c_teleport, {
        settleMs: 500,
      });

      const expectedA1 = haversineMeters(
        ROUTE_C.c0.lat,
        ROUTE_C.c0.lng,
        ROUTE_A_SEG1[1].lat,
        ROUTE_A_SEG1[1].lng
      );
      await geoDriver.stepAcceptedFix(page.context(), page, ROUTE_A_SEG1[1], {
        waitForDistanceChange: true,
        stepDelayMs: 450,
      });

      const persisted = await finishAndAwaitPersistence(page, athleteId);
      const actualMeters = persisted.runs[0].data.distanceMeters;
      assert.ok(
        Math.abs(actualMeters - expectedA1) / expectedA1 <= 0.02,
        `Expected ~${expectedA1.toFixed(2)} m (teleport acc=25 rejected), got ${actualMeters}`
      );
    });
  });

  it('T2-06: Multi-pause cycles isolate two spatial jumps and create 3 separate segments', async () => {
    await withIsolatedPage('t2_06', ROUTE_A_SEG1[0], async ({ page, athleteId }) => {
      const leg1 = ROUTE_A_SEG1.slice(0, 4); // A0..A3
      const leg2 = ROUTE_A_SEG2.slice(0, 3); // A6..A8
      const leg3 = ROUTE_A_SEG2.slice(3, 6); // A9..A11
      const expectedMeters = sumPathMeters(leg1) + sumPathMeters(leg2) + sumPathMeters(leg3);

      await openRunTabAndStart(page, leg1[0]);
      await stepRouteSegment(page, leg1, { skipFirst: true });

      // Pause 1 + jump 1
      await locatorFor(page, 'btnPauseRun').click();
      await waitForSelectorKey(page, 'btnResumeRun');
      await geoDriver.stepIgnoredFix(page.context(), page, ROUTE_A_PAUSE_JUMP, { settleMs: 2100 });

      await resumeRunAtFix(page, leg2[0]);
      await stepRouteSegment(page, leg2, { skipFirst: true, waitForDistanceChange: true });

      // Pause 2 + jump 2 back near A0
      await locatorFor(page, 'btnPauseRun').click();
      await waitForSelectorKey(page, 'btnResumeRun');
      await geoDriver.stepIgnoredFix(page.context(), page, ROUTE_A_SEG1[0], { settleMs: 2100 });

      await resumeRunAtFix(page, leg3[0]);
      await stepRouteSegment(page, leg3, { skipFirst: true, waitForDistanceChange: true });

      const persisted = await finishAndAwaitPersistence(page, athleteId);
      const run = persisted.runs[0].data;
      const stats = extractTrackpointStats(run);

      assert.equal(stats.segmentCount, 3, `Expected 3 segments, got ${stats.segmentCount}`);
      assert.ok(run.pausedDurationSec >= 4, `Expected pausedDurationSec >= 4, got ${run.pausedDurationSec}`);
      assert.ok(
        Math.abs(run.distanceMeters - expectedMeters) / expectedMeters <= 0.02,
        `Expected ~${expectedMeters.toFixed(2)} m, got ${run.distanceMeters}`
      );
    });
  });

  it('T2-07: Geolocation permission denied renders Spanish error banner without runaway timer', async () => {
    const athleteId = tracker.register(generateTestAthleteId('t2_07'));
    const context = await createDeniedGeoContext(browser);
    try {
      const page = await context.newPage();
      const errors = attachErrorGuard(page, { serverMode: server.mode, allowGeoErrors: true });
      await openIsolatedApp(page, server.baseUrl, athleteId, null);

      await clickNavTab(page, 'navRun');
      await waitForSelectorKey(page, 'btnStartRun');
      await locatorFor(page, 'btnStartRun').click();

      const banner = await waitForSelectorKey(page, 'gpsErrorBanner', { timeout: 8000 });
      assert.ok((await banner.textContent()).trim().length > 0, 'Expected non-empty GPS error banner');

      await page.waitForTimeout(1500);
      assert.equal(await locatorFor(page, 'btnStartRun').isVisible(), true);
      assert.match(
        await locatorFor(page, 'metricDuration').textContent(),
        /00:00/,
        'Duration timer must stay at 00:00 when geolocation permission is denied'
      );
      assertNoAppErrors(errors);
    } finally {
      await context.close();
      await tracker.cleanupOne(athleteId);
    }
  });

  it('T2-08: 390x844 mobile layout has zero horizontal overflow and thumb-zone controls above .nav-bar', async () => {
    await withIsolatedPage('t2_08', ROUTE_A_SEG1[0], async ({ page, athleteId }) => {
      // Dashboard
      await assertMobileLayout(page);

      // Registrar
      await clickNavTab(page, 'navAdd');
      await waitForSelectorKey(page, 'manualSaveBtn');
      await assertMobileLayout(page);

      // Correr idle
      await clickNavTab(page, 'navRun');
      await waitForSelectorKey(page, 'btnStartRun');
      await assertMobileLayout(page, { requireMap: true, requireControls: true });

      // Correr recording
      await locatorFor(page, 'btnStartRun').click();
      await waitForSelectorKey(page, 'btnPauseRun');
      await assertMobileLayout(page, { requireMap: true, requireControls: true });

      // Correr paused
      await locatorFor(page, 'btnPauseRun').click();
      await waitForSelectorKey(page, 'btnResumeRun');
      await assertMobileLayout(page, { requireMap: true, requireControls: true });

      // Correr summary
      await locatorFor(page, 'btnResumeRun').click();
      await waitForSelectorKey(page, 'btnPauseRun');
      await stepRouteSegment(page, ROUTE_A_SEG1.slice(0, 3), { skipFirst: true });
      await finishAndAwaitPersistence(page, athleteId);
      await assertMobileLayout(page, { requireMap: true });

      // Historial & RunDetailModal
      await clickNavTab(page, 'navHistory');
      await waitForSelectorKey(page, 'historyRunItem');
      await assertMobileLayout(page);
      await locatorFor(page, 'historyRunItem').click();
      await waitForSelectorKey(page, 'runDetailModal');
      await assertMobileLayout(page, { requireMap: true });
    });
  });
});
