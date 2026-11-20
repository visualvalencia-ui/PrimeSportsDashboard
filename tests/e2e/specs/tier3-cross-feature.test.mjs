import assert from 'node:assert/strict';
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
  recordQuickRun,
  resumeRunAtFix,
  stepRouteSegment,
  submitManualWorkout,
} from '../helpers/runActions.mjs';
import {
  clickNavTab,
  locatorFor,
  normalizePaceText,
  parseDurationSeconds,
  parseMetricNumber,
  parsePaceMinPerKm,
  waitForSelectorKey,
} from '../helpers/selectors.mjs';
import {
  ROUTE_A_ACTIVE_METERS,
  ROUTE_A_PAUSE_JUMP,
  ROUTE_A_SEG1,
  ROUTE_A_SEG2,
} from '../helpers/waypoints.mjs';

function formatExpectedDuration(totalSec) {
  const s = Math.max(0, Math.round(totalSec));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`;
}

describe('Tier 3 — Cross-Feature Integration, Reload & 3-Way Parity (T3-01..T3-06)', () => {
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

  async function executeSplitRouteA(page, athleteId) {
    const { startedAtMs } = await openRunTabAndStart(page, ROUTE_A_SEG1[0]);
    await stepRouteSegment(page, ROUTE_A_SEG1, { skipFirst: true, stepDelayMs: 450 });

    await locatorFor(page, 'btnPauseRun').click();
    await waitForSelectorKey(page, 'btnResumeRun');
    const pausedAtMs = Date.now();
    await geoDriver.stepIgnoredFix(page.context(), page, ROUTE_A_PAUSE_JUMP, {
      settleMs: 4500,
    });

    const { resumedAtMs } = await resumeRunAtFix(page, ROUTE_A_SEG2[0]);
    await stepRouteSegment(page, ROUTE_A_SEG2, {
      skipFirst: true,
      waitForDistanceChange: true,
      stepDelayMs: 450,
    });

    const persisted = await finishAndAwaitPersistence(page, athleteId);
    const summary = await readRunSummaryMetrics(page);
    const activeWallClockMs =
      (pausedAtMs - startedAtMs) + (persisted.finishedAtMs - resumedAtMs);
    return { summary, persisted, activeWallClockMs };
  }

  it('T3-01: GPS Route A updates Dashboard Base Aeróbica progress card', async () => {
    await withIsolatedPage('t3_01', ROUTE_A_SEG1[0], async ({ page, athleteId }) => {
      await executeSplitRouteA(page, athleteId);
      await clickNavTab(page, 'navDashboard');
      const aerobicText = await (await waitForSelectorKey(page, 'cardAerobic')).textContent();

      const actualKm = parseMetricNumber(
        await locatorFor(page, 'aerobicActual').textContent()
      );
      assert.ok(
        actualKm >= 1.13 && actualKm <= 1.19,
        `Expected Base Aeróbica Actual ~1.16 km, got ${actualKm} (${aerobicText})`
      );
      const pct = parseMetricNumber(await locatorFor(page, 'aerobicPercent').textContent());
      assert.ok(pct >= 22 && pct <= 24.5, `Expected ~23.1%, got ${pct}%`);
    });
  });

  it('T3-02: Combined >= 5.0 km cardio logs escalate Dashboard to Fase 2 (Normalización)', async () => {
    await withIsolatedPage('t3_02', ROUTE_A_SEG1[0], async ({ page, athleteId }) => {
      await submitManualWorkout(page, { type: 'cardio', value: '5.0' });
      await recordQuickRun(page, athleteId, ROUTE_A_SEG1.slice(0, 3), {
        minRuns: 1,
        expectLogCount: 2,
      });

      await clickNavTab(page, 'navDashboard');
      const aerobicText = await (await waitForSelectorKey(page, 'cardAerobic')).textContent();
      assert.match(aerobicText, /Fase 2 \(Normalización\)/);
      assert.match(aerobicText, /Meta:\s*10\s*km/);
    });
  });

  it('T3-03: Persisted GPS run survives page.reload() and renders in RunDetailModal', async () => {
    await withIsolatedPage('t3_03', ROUTE_A_SEG1[0], async ({ page, athleteId }) => {
      const { summary } = await executeSplitRouteA(page, athleteId);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForSelectorKey(page, 'appHeader');

      await clickNavTab(page, 'navHistory');
      const row = await waitForSelectorKey(page, 'historyRunItem');
      await row.click();

      await waitForSelectorKey(page, 'runDetailModal');
      await assertMobileLayout(page, { requireMap: true });
      await assertSvgPolylinesPresent(page, 2);

      const modalDist = parseMetricNumber(
        await locatorFor(page, 'modalDistance').textContent()
      );
      const modalDur = parseDurationSeconds(
        await locatorFor(page, 'modalDuration').textContent()
      );
      const modalPace = normalizePaceText(
        await locatorFor(page, 'modalPace').textContent()
      );

      assert.ok(Math.abs(modalDist - summary.distanceKm) <= 0.02);
      assert.equal(modalDur, summary.durationSec);
      assert.equal(modalPace, normalizePaceText(summary.paceText));
    });
  });

  it('T3-04: 3-way parity between UI Summary, Firestore REST, and query-runs.mjs --json', async () => {
    await withIsolatedPage('t3_04', ROUTE_A_SEG1[0], async ({ page, athleteId }) => {
      const { summary, persisted, activeWallClockMs } = await executeSplitRouteA(page, athleteId);
      const fsRun = persisted.runs[0].data;

      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForSelectorKey(page, 'appHeader');

      const { data: listJson } = await runQueryRunsCli({ athlete: athleteId, json: true });
      const cliFromList = extractSingleRun(listJson, fsRun.id);
      assert.ok(cliFromList, 'Expected run in query-runs.mjs --json list');

      const { data: singleJson } = await runQueryRunsCli({
        athlete: athleteId,
        runId: fsRun.id,
        json: true,
      });
      const cliRun = extractSingleRun(singleJson, fsRun.id);
      assert.ok(cliRun, 'Expected run from query-runs.mjs --runId --json');

      assert.equal(cliRun.id, fsRun.id);
      assert.ok(Math.abs(cliRun.distanceMeters - fsRun.distanceMeters) < 0.01);
      assert.ok(
        Math.abs(cliRun.distanceMeters - ROUTE_A_ACTIVE_METERS) / ROUTE_A_ACTIVE_METERS <= 0.02
      );
      assert.ok(Math.abs(cliRun.distanceKm - summary.distanceKm) <= 0.02);
      assert.equal(cliRun.activeDurationSec, fsRun.activeDurationSec);
      assert.equal(formatExpectedDuration(cliRun.activeDurationSec), summary.durationText);
      const maxExpectedActiveSec = Math.ceil(activeWallClockMs / 1000) + 2;
      assert.ok(
        cliRun.activeDurationSec <= maxExpectedActiveSec,
        `Active duration (${cliRun.activeDurationSec}s) exceeded wall-clock active bound (${maxExpectedActiveSec}s)`
      );
      assert.ok(cliRun.pausedDurationSec >= 4, `Expected pausedDurationSec >= 4, got ${cliRun.pausedDurationSec}`);
      assert.ok(
        cliRun.elapsedDurationSec >= cliRun.activeDurationSec + 4,
        `Elapsed (${cliRun.elapsedDurationSec}s) failed to exceed active (${cliRun.activeDurationSec}s) by >= 4s`
      );

      const expectedPace = (cliRun.activeDurationSec / 60) / (cliRun.distanceMeters / 1000);
      assert.ok(Math.abs(cliRun.avgPaceMinPerKm - expectedPace) <= 0.02);
      const parsedSummaryPace = parsePaceMinPerKm(summary.paceText);
      assert.ok(
        Number.isFinite(parsedSummaryPace) && Math.abs(parsedSummaryPace - expectedPace) <= 0.05,
        `Summary pace "${summary.paceText}" (${parsedSummaryPace}) != expected ${expectedPace.toFixed(3)} min/km`
      );
      assert.equal(
        normalizePaceText(cliRun.avgPaceFormatted),
        normalizePaceText(summary.paceText)
      );

      const trackStats = extractTrackpointStats(cliRun);
      assert.equal(trackStats.segmentCount, 2);
      assert.ok(trackStats.points.length >= 10);
    });
  });

  it('T3-05: Manual + GPS coexistence respects 1 MiB logs[] cap (no trackpoints/segments in logs[])', async () => {
    await withIsolatedPage('t3_05', ROUTE_A_SEG1[0], async ({ page, athleteId }) => {
      await submitManualWorkout(page, { type: 'pull', value: '45' });
      const { persisted } = await recordQuickRun(page, athleteId, ROUTE_A_SEG1.slice(0, 4), {
        minRuns: 1,
        expectLogCount: 2,
      });

      const logs = persisted.athleteDoc?.data?.logs || [];
      assert.equal(logs.length, 2);

      const runId = persisted.runs[0].id;
      const gpsLog = logs.find((l) => l.runId === runId);
      assert.ok(gpsLog, 'Expected lightweight GPS summary in athlete logs[]');
      assert.equal(gpsLog.type, 'cardio');
      assert.ok(typeof gpsLog.v1 === 'number' && gpsLog.v1 > 0);
      assert.equal('segments' in gpsLog, false, 'logs[] must NEVER embed segments');
      assert.equal('trackpoints' in gpsLog, false, 'logs[] must NEVER embed trackpoints');

      await clickNavTab(page, 'navDashboard');
      assert.match(await locatorFor(page, 'cardStrength').textContent(), /Actual:\s*45\s*kg/);
    });
  });

  it('T3-06: Production sports_prime/camilo snapshot remains strictly unchanged', async () => {
    await assertProductionCamiloUnchanged(prodBefore);
  });
});
