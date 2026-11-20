import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { extractSingleRun, runQueryRunsCli } from '../helpers/cliVerifier.mjs';
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
  captureScreenshot,
  createGpsContext,
  geoDriver,
  launchBrowser,
  startViteServer,
} from '../helpers/harness.mjs';
import {
  assertSvgPolylinesPresent,
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
  normalizePaceText,
  parseMetricNumber,
  parsePaceMinPerKm,
  waitForSelectorKey,
} from '../helpers/selectors.mjs';
import {
  ROUTE_A_ACTIVE_METERS,
  ROUTE_A_PAUSE_JUMP,
  ROUTE_A_SEG1,
  ROUTE_A_SEG2,
  ROUTE_B,
  ROUTE_B_METERS,
} from '../helpers/waypoints.mjs';

describe('Tier 4 — Real-World Ciudad Verde Running Scenarios (T4-01..T4-02)', () => {
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

  it('T4-01: Ciudad Verde split loop (Route A) with >=4s pause, 505.90m jump isolation, reload, CLI & 6 PNGs', async () => {
    const athleteId = tracker.register(generateTestAthleteId('t4_route_a'));
    const context = await createGpsContext(browser, ROUTE_A_SEG1[0]);

    try {
      const page = await context.newPage();
      const errors = attachErrorGuard(page, { serverMode: server.mode });

      await openIsolatedApp(page, server.baseUrl, athleteId, ROUTE_A_SEG1[0]);
      const { startedAtMs } = await openRunTabAndStart(page, ROUTE_A_SEG1[0]);

      // Seg 1: A0..A5 (567.79 m)
      await stepRouteSegment(page, ROUTE_A_SEG1, { skipFirst: true, stepDelayMs: 900 });
      await assertMobileLayout(page, { requireMap: true, requireControls: true });
      const shot1 = await captureScreenshot(page, '01_live_recording.png');
      assert.ok(fs.existsSync(shot1) && fs.statSync(shot1).size > 1000, 'Expected non-empty 01_live_recording.png');

      // Pause + 505.90m spatial jump + >= 4.5s wait
      await locatorFor(page, 'btnPauseRun').click();
      await waitForSelectorKey(page, 'btnResumeRun');
      const pausedAtMs = Date.now();
      await geoDriver.stepIgnoredFix(context, page, ROUTE_A_PAUSE_JUMP, { settleMs: 4500 });
      await assertMobileLayout(page, { requireMap: true, requireControls: true });
      const shot2 = await captureScreenshot(page, '02_paused.png');
      assert.ok(fs.existsSync(shot2) && fs.statSync(shot2).size > 1000, 'Expected non-empty 02_paused.png');

      // Resume + Seg 2: A6..A11 (587.84 m)
      const { resumedAtMs } = await resumeRunAtFix(page, ROUTE_A_SEG2[0]);
      await stepRouteSegment(page, ROUTE_A_SEG2, {
        skipFirst: true,
        waitForDistanceChange: true,
        stepDelayMs: 900,
      });

      // Finish & verify summary map
      const persisted = await finishAndAwaitPersistence(page, athleteId);
      const activeWallClockMs =
        (pausedAtMs - startedAtMs) + (persisted.finishedAtMs - resumedAtMs);
      await assertMobileLayout(page, { requireMap: true });
      await assertSvgPolylinesPresent(page, 2);
      const summary = await readRunSummaryMetrics(page);
      const shot3 = await captureScreenshot(page, '03_summary_map.png');
      assert.ok(fs.existsSync(shot3) && fs.statSync(shot3).size > 1000, 'Expected non-empty 03_summary_map.png');

      // Precision assertions on Firestore doc
      const fsRun = persisted.runs[0].data;
      const distErrPct =
        Math.abs(fsRun.distanceMeters - ROUTE_A_ACTIVE_METERS) / ROUTE_A_ACTIVE_METERS;
      assert.ok(
        distErrPct <= 0.02,
        `Distance ${fsRun.distanceMeters} m outside 2% of ${ROUTE_A_ACTIVE_METERS.toFixed(2)} m`
      );
      assert.ok(
        fsRun.distanceMeters < 1300,
        `Paused jump (~506m) leaked into distance: ${fsRun.distanceMeters} m`
      );
      assert.ok(
        fsRun.pausedDurationSec >= 4,
        `Expected pausedDurationSec >= 4, got ${fsRun.pausedDurationSec}`
      );
      const maxExpectedActiveSec = Math.ceil(activeWallClockMs / 1000) + 2;
      assert.ok(
        fsRun.activeDurationSec <= maxExpectedActiveSec,
        `Active duration (${fsRun.activeDurationSec}s) exceeded wall-clock active bound (${maxExpectedActiveSec}s)`
      );
      assert.ok(
        fsRun.elapsedDurationSec >= fsRun.activeDurationSec + 4,
        `Active time (${fsRun.activeDurationSec}s) failed to exclude pause (elapsed=${fsRun.elapsedDurationSec}s)`
      );

      const expectedPace = (fsRun.activeDurationSec / 60) / (fsRun.distanceMeters / 1000);
      assert.ok(
        Math.abs(fsRun.avgPaceMinPerKm - expectedPace) / expectedPace <= 0.02,
        `Pace mismatch: stored=${fsRun.avgPaceMinPerKm}, expected=${expectedPace}`
      );
      const parsedSummaryPace = parsePaceMinPerKm(summary.paceText);
      assert.ok(
        Number.isFinite(parsedSummaryPace) && Math.abs(parsedSummaryPace - expectedPace) <= 0.05,
        `Summary pace "${summary.paceText}" (${parsedSummaryPace}) != expected ${expectedPace.toFixed(3)} min/km`
      );

      const stats = extractTrackpointStats(fsRun);
      assert.equal(stats.segmentCount, 2);

      // Historial list & detail modal
      await clickNavTab(page, 'navHistory');
      const runRow = await waitForSelectorKey(page, 'historyRunItem');
      await assertMobileLayout(page);
      const shot4 = await captureScreenshot(page, '04_history_list.png');
      assert.ok(fs.existsSync(shot4) && fs.statSync(shot4).size > 1000, 'Expected non-empty 04_history_list.png');

      await runRow.click();
      await waitForSelectorKey(page, 'runDetailModal');
      await assertMobileLayout(page, { requireMap: true });
      await assertSvgPolylinesPresent(page, 2);
      const shot5 = await captureScreenshot(page, '05_history_detail_map.png');
      assert.ok(fs.existsSync(shot5) && fs.statSync(shot5).size > 1000, 'Expected non-empty 05_history_detail_map.png');

      await locatorFor(page, 'modalCloseBtn').click();
      await locatorFor(page, 'runDetailModal').waitFor({ state: 'hidden', timeout: 5000 });

      // Reload & confirm persistence + Dashboard update
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForSelectorKey(page, 'appHeader');
      await clickNavTab(page, 'navHistory');
      await waitForSelectorKey(page, 'historyRunItem');

      await clickNavTab(page, 'navDashboard');
      await waitForSelectorKey(page, 'cardAerobic');
      const dashDeadline = Date.now() + 5000;
      let dashKm = NaN;
      while (Date.now() <= dashDeadline) {
        dashKm = parseMetricNumber(
          await locatorFor(page, 'aerobicActual').textContent()
        );
        if (Number.isFinite(dashKm) && dashKm >= 1.13) break;
        await page.waitForTimeout(150);
      }
      assert.ok(dashKm >= 1.13 && dashKm <= 1.19, `Unexpected Dashboard km: ${dashKm}`);
      await assertMobileLayout(page);
      const shot6 = await captureScreenshot(page, '06_dashboard_updated.png');
      assert.ok(fs.existsSync(shot6) && fs.statSync(shot6).size > 1000, 'Expected non-empty 06_dashboard_updated.png');

      // Workspace CLI check
      const { data } = await runQueryRunsCli({ athlete: athleteId, json: true });
      const cliRun = extractSingleRun(data, fsRun.id);
      assert.ok(cliRun);
      assert.equal(cliRun.id, fsRun.id);
      assert.equal(
        normalizePaceText(cliRun.avgPaceFormatted),
        normalizePaceText(summary.paceText)
      );

      assertNoAppErrors(errors);
    } finally {
      await context.close();
      await tracker.cleanupOne(athleteId);
    }
  });

  it('T4-02: Ciudad Verde 21-point "Semana 1" loop (Route B = 3260.45 m) produces 3 splits & Dashboard update', async () => {
    const athleteId = tracker.register(generateTestAthleteId('t4_route_b'));
    const context = await createGpsContext(browser, ROUTE_B[0]);

    try {
      const page = await context.newPage();
      const errors = attachErrorGuard(page, { serverMode: server.mode });

      await openIsolatedApp(page, server.baseUrl, athleteId, ROUTE_B[0]);
      await openRunTabAndStart(page, ROUTE_B[0]);
      await stepRouteSegment(page, ROUTE_B, { skipFirst: true, stepDelayMs: 600 });

      const persisted = await finishAndAwaitPersistence(page, athleteId);
      await assertMobileLayout(page, { requireMap: true });
      await assertSvgPolylinesPresent(page, 1);

      const fsRun = persisted.runs[0].data;
      const errPct = Math.abs(fsRun.distanceMeters - ROUTE_B_METERS) / ROUTE_B_METERS;
      assert.ok(
        errPct <= 0.02,
        `Route B distance ${fsRun.distanceMeters} m outside 2% of ${ROUTE_B_METERS.toFixed(2)} m`
      );

      assert.ok(Array.isArray(fsRun.splitsKm), 'Expected splitsKm array');
      assert.equal(fsRun.splitsKm.length, 3, `Expected 3 km splits, got ${fsRun.splitsKm.length}`);
      assert.deepStrictEqual(
        fsRun.splitsKm.map((s) => s.km),
        [1, 2, 3]
      );

      assert.ok(fsRun.bounds, 'Expected bounds object on Route B');
      assert.ok(fsRun.bounds.minLat <= 4.60165 && fsRun.bounds.maxLat >= 4.61030);
      assert.ok(fsRun.bounds.minLng <= -74.23030 && fsRun.bounds.maxLng >= -74.22220);

      await clickNavTab(page, 'navDashboard');
      const dashKm = parseMetricNumber(
        await locatorFor(page, 'aerobicActual').textContent()
      );
      assert.ok(dashKm >= 3.19 && dashKm <= 3.33, `Expected ~3.26 km on Dashboard, got ${dashKm}`);

      const { data } = await runQueryRunsCli({
        athlete: athleteId,
        runId: fsRun.id,
        json: true,
      });
      const cliRun = extractSingleRun(data, fsRun.id);
      assert.ok(cliRun && cliRun.splitsKm.length === 3);

      assertNoAppErrors(errors);
    } finally {
      await context.close();
      await tracker.cleanupOne(athleteId);
    }
  });
});
