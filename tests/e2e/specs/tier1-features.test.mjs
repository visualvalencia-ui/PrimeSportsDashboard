import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { extractRunsList, extractSingleRun, runQueryRunsCli } from '../helpers/cliVerifier.mjs';
import {
  assertProductionCamiloUnchanged,
  createCleanupTracker,
  generateTestAthleteId,
  getAthleteDoc,
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
  recordQuickRun,
  resumeRunAtFix,
  stepRouteSegment,
  submitManualWorkout,
} from '../helpers/runActions.mjs';
import {
  allLocatorFor,
  clickNavTab,
  locatorFor,
  normalizePaceText,
  parseDurationSeconds,
  parseKmFromText,
  parseMetricNumber,
  waitForSelectorKey,
} from '../helpers/selectors.mjs';
import {
  ROUTE_A_PAUSE_JUMP,
  ROUTE_A_SEG1,
  ROUTE_A_SEG2,
} from '../helpers/waypoints.mjs';

describe('Tier 1 — Isolated Feature Coverage (T1-A1..T1-E5)', () => {
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

  // --- Group A: Existing PWA Preservation ---
  it('T1-A1: App boot renders Prime Tracker, TEST MODE badge, and 4-tab nav shell', async () => {
    await withIsolatedPage('t1_a1', null, async ({ page }) => {
      const header = await waitForSelectorKey(page, 'appHeader');
      assert.match(await header.textContent(), /Prime Tracker/i);

      const badge = await waitForSelectorKey(page, 'testModeBadge');
      assert.match(await badge.textContent(), /TEST MODE/i);

      await waitForSelectorKey(page, 'navDashboard');
      await waitForSelectorKey(page, 'navRun');
      await waitForSelectorKey(page, 'navAdd');
      await waitForSelectorKey(page, 'navHistory');

      const dashClass = await locatorFor(page, 'navDashboard').getAttribute('class');
      assert.match(dashClass || '', /\bactive\b/);
    });
  });

  it('T1-A2: Empty Dashboard shows Fase 1 (Readaptación) targets at 0%', async () => {
    await withIsolatedPage('t1_a2', null, async ({ page }) => {
      const aerobicCard = await waitForSelectorKey(page, 'cardAerobic');
      const aerobicText = await aerobicCard.textContent();
      assert.match(aerobicText, /Fase 1 \(Readaptación\)/);
      assert.match(aerobicText, /Actual:\s*0\s*km/);
      assert.match(aerobicText, /Meta:\s*5\s*km/);
      assert.match(aerobicText, /0\.0%/);

      const strengthCard = await waitForSelectorKey(page, 'cardStrength');
      const strengthText = await strengthCard.textContent();
      assert.match(strengthText, /Actual:\s*0\s*kg/);
      assert.match(strengthText, /Meta:\s*40\s*kg/);
      assert.match(strengthText, /0\.0%/);
    });
  });

  it('T1-A3: Manual cardio log updates Base Aeróbica to 3.5 km (70.0%)', async () => {
    await withIsolatedPage('t1_a3', null, async ({ page }) => {
      await submitManualWorkout(page, { type: 'cardio', value: '3.5' });
      const aerobicText = await locatorFor(page, 'cardAerobic').textContent();
      assert.match(aerobicText, /Actual:\s*3\.5\s*km/);
      assert.match(aerobicText, /70\.0%/);
    });
  });

  it('T1-A4: Manual pull log >= 40 kg escalates Fuerza Relativa to Fase 2 (60 kg)', async () => {
    await withIsolatedPage('t1_a4', null, async ({ page }) => {
      await submitManualWorkout(page, { type: 'pull', value: '45' });
      const strengthText = await locatorFor(page, 'cardStrength').textContent();
      assert.match(strengthText, /Fase 2 \(Normalización\)/);
      assert.match(strengthText, /Actual:\s*45\s*kg/);
      assert.match(strengthText, /Meta:\s*60\s*kg/);
      assert.match(strengthText, /75\.0%/);
    });
  });

  it('T1-A5: Manual push log appears in Historial without altering cardio/pull cards', async () => {
    await withIsolatedPage('t1_a5', null, async ({ page }) => {
      await submitManualWorkout(page, { type: 'push', value: '50' });
      const aerobicText = await locatorFor(page, 'cardAerobic').textContent();
      const strengthText = await locatorFor(page, 'cardStrength').textContent();
      assert.match(aerobicText, /Actual:\s*0\s*km/);
      assert.match(strengthText, /Actual:\s*0\s*kg/);

      await clickNavTab(page, 'navHistory');
      const historyText = await (await waitForSelectorKey(page, 'historyView')).textContent();
      assert.match(historyText, /push:\s*50\s*kg/i);
    });
  });

  it('T1-A6: Empty manual submit stays on Registrar with zero Firestore writes', async () => {
    await withIsolatedPage('t1_a6', null, async ({ page, athleteId }) => {
      await clickNavTab(page, 'navAdd');
      await waitForSelectorKey(page, 'manualSaveBtn');
      await locatorFor(page, 'manualSaveBtn').click();
      await page.waitForTimeout(400);

      assert.equal(await locatorFor(page, 'manualSaveBtn').isVisible(), true);
      const doc = await getAthleteDoc(athleteId);
      assert.equal(doc, null);
    });
  });

  // --- Group B: Correr Tab & Live GPS State Machine ---
  it('T1-B1: Correr tab idle state shows 0.00 km, 00:00, --:-- /km, Iniciar & map', async () => {
    await withIsolatedPage('t1_b1', ROUTE_A_SEG1[0], async ({ page }) => {
      await clickNavTab(page, 'navRun');
      await waitForSelectorKey(page, 'runTrackerView');

      assert.equal(parseMetricNumber(await locatorFor(page, 'metricDistance').textContent()), 0);
      assert.match(await locatorFor(page, 'metricDuration').textContent(), /00:00/);
      assert.match(await locatorFor(page, 'metricPace').textContent(), /--:--\s*\/km/);
      assert.equal(await locatorFor(page, 'btnStartRun').isVisible(), true);
      assert.equal(await page.locator('.leaflet-container').first().isVisible(), true);
    });
  });

  it('T1-B2: Start recording transitions idle -> recording and increments timer', async () => {
    await withIsolatedPage('t1_b2', ROUTE_A_SEG1[0], async ({ page }) => {
      await openRunTabAndStart(page, ROUTE_A_SEG1[0]);
      assert.equal(await locatorFor(page, 'btnPauseRun').isVisible(), true);
      assert.equal(await locatorFor(page, 'btnFinishRun').isVisible(), true);
      assert.equal(await locatorFor(page, 'btnStartRun').isVisible(), false);

      await page.waitForTimeout(2200);
      const durSec = parseDurationSeconds(await locatorFor(page, 'metricDuration').textContent());
      assert.ok(durSec >= 1, `Expected active duration >= 1s, got ${durSec}`);
    });
  });

  it('T1-B3: Pause recording freezes active timer during paused wait', async () => {
    await withIsolatedPage('t1_b3', ROUTE_A_SEG1[0], async ({ page }) => {
      await openRunTabAndStart(page, ROUTE_A_SEG1[0]);
      await page.waitForTimeout(1500);
      await locatorFor(page, 'btnPauseRun').click();
      await waitForSelectorKey(page, 'btnResumeRun');

      assert.equal(await locatorFor(page, 'btnPauseRun').isVisible(), false);
      assert.equal(await locatorFor(page, 'btnFinishRun').isVisible(), true);

      const pausedAt = parseDurationSeconds(await locatorFor(page, 'metricDuration').textContent());
      await page.waitForTimeout(2500);
      const afterWait = parseDurationSeconds(await locatorFor(page, 'metricDuration').textContent());
      assert.equal(afterWait, pausedAt, 'Active duration must remain frozen while paused');
    });
  });

  it('T1-B4: Resume recording transitions paused -> recording and resumes active timer', async () => {
    await withIsolatedPage('t1_b4', ROUTE_A_SEG1[0], async ({ page }) => {
      await openRunTabAndStart(page, ROUTE_A_SEG1[0]);
      await page.waitForTimeout(1200);
      await locatorFor(page, 'btnPauseRun').click();
      await waitForSelectorKey(page, 'btnResumeRun');
      const pausedAt = parseDurationSeconds(await locatorFor(page, 'metricDuration').textContent());

      await locatorFor(page, 'btnResumeRun').click();
      await waitForSelectorKey(page, 'btnPauseRun');
      await page.waitForTimeout(2100);
      const resumedAt = parseDurationSeconds(await locatorFor(page, 'metricDuration').textContent());
      assert.ok(resumedAt > pausedAt, `Expected active duration to advance past ${pausedAt}s, got ${resumedAt}s`);
    });
  });

  it('T1-B5: Finish run renders summary card, map, and persists Firestore run doc', async () => {
    await withIsolatedPage('t1_b5', ROUTE_A_SEG1[0], async ({ page, athleteId }) => {
      const { summary, persisted } = await recordQuickRun(page, athleteId, ROUTE_A_SEG1.slice(0, 3));
      assert.ok(
        Math.abs(summary.distanceKm - 0.22) <= 0.03,
        `Expected ~0.22 km summary distance, got ${summary.distanceKm}`
      );
      assert.ok(summary.durationSec >= 1);
      assert.match(summary.paceText, /\d+:\d{2}\s*\/km/);
      assert.equal(persisted.runs.length, 1);
    });
  });

  it('T1-B6: Summary done/new-run button resets view cleanly to idle', async () => {
    await withIsolatedPage('t1_b6', ROUTE_A_SEG1[0], async ({ page, athleteId }) => {
      await recordQuickRun(page, athleteId, ROUTE_A_SEG1.slice(0, 3));
      const doneBtn = await waitForSelectorKey(page, 'btnSummaryDone');
      await doneBtn.click();

      await waitForSelectorKey(page, 'btnStartRun');
      assert.equal(parseMetricNumber(await locatorFor(page, 'metricDistance').textContent()), 0);
      assert.match(await locatorFor(page, 'metricDuration').textContent(), /00:00/);
    });
  });

  // --- Group C: Interactive Leaflet Map ---
  it('T1-C1: Leaflet map initializes at mobile dimensions on Correr idle', async () => {
    await withIsolatedPage('t1_c1', ROUTE_A_SEG1[0], async ({ page }) => {
      await clickNavTab(page, 'navRun');
      await waitForSelectorKey(page, 'runMap');
      const box = await page.locator('.leaflet-container').first().boundingBox();
      assert.ok(box && box.height >= 200 && box.width >= 300, `Unexpected map dimensions: ${JSON.stringify(box)}`);
    });
  });

  it('T1-C2: Live polyline renders in #39ff14 while recording waypoints', async () => {
    await withIsolatedPage('t1_c2', ROUTE_A_SEG1[0], async ({ page }) => {
      await openRunTabAndStart(page, ROUTE_A_SEG1[0]);
      await stepRouteSegment(page, ROUTE_A_SEG1.slice(0, 5), { skipFirst: true });
      await assertSvgPolylinesPresent(page, 1);

      const strokes = await page.evaluate(() =>
        [...document.querySelectorAll('.leaflet-overlay-pane svg path')]
          .filter((el) => {
            const fill = (el.getAttribute('fill') || '').trim().toLowerCase();
            const d = (el.getAttribute('d') || '').trim();
            return fill === 'none' && /L/i.test(d);
          })
          .map((el) => getComputedStyle(el).stroke)
      );
      assert.ok(strokes.length >= 1, 'Expected at least 1 Leaflet SVG route polyline');
      for (const stroke of strokes) {
        assert.ok(
          stroke === 'rgb(57, 255, 20)' || stroke.toLowerCase() === '#39ff14',
          `Expected neon green polyline stroke, got "${stroke}"`
        );
      }
    });
  });

  it('T1-C3: Pause/resume across spatial jump renders >= 2 separate SVG polyline segments', async () => {
    await withIsolatedPage('t1_c3', ROUTE_A_SEG1[0], async ({ page, athleteId }) => {
      const seg2Partial = ROUTE_A_SEG2.slice(0, 3);
      await openRunTabAndStart(page, ROUTE_A_SEG1[0]);
      await stepRouteSegment(page, ROUTE_A_SEG1.slice(0, 3), { skipFirst: true });

      await locatorFor(page, 'btnPauseRun').click();
      await waitForSelectorKey(page, 'btnResumeRun');
      await geoDriver.stepIgnoredFix(page.context(), page, ROUTE_A_PAUSE_JUMP, { settleMs: 400 });

      await resumeRunAtFix(page, seg2Partial[0]);
      await stepRouteSegment(page, seg2Partial, {
        skipFirst: true,
        waitForDistanceChange: true,
      });

      await finishAndAwaitPersistence(page, athleteId);
      await assertSvgPolylinesPresent(page, 2);
    });
  });

  it('T1-C4: Summary map renders markers without broken non-tile <img> assets', async () => {
    await withIsolatedPage('t1_c4', ROUTE_A_SEG1[0], async ({ page, athleteId }) => {
      await recordQuickRun(page, athleteId, ROUTE_A_SEG1);
      const markerCount = await page.evaluate(() => {
        const paneMarkers = document.querySelectorAll('.leaflet-marker-pane > *').length;
        const svgCircles = document.querySelectorAll('.leaflet-overlay-pane svg circle').length;
        const filledSvgPaths = [...document.querySelectorAll('.leaflet-overlay-pane svg path')].filter(
          (el) => {
            const fill = (el.getAttribute('fill') || '').trim().toLowerCase();
            return fill !== '' && fill !== 'none';
          }
        ).length;
        return paneMarkers + svgCircles + filledSvgPaths;
      });
      assert.ok(markerCount >= 2, `Expected >= 2 map markers (start + end), got ${markerCount}`);

      const brokenImages = await page.evaluate(() =>
        [...document.querySelectorAll('.leaflet-container img')]
          .filter((img) => !img.classList.contains('leaflet-tile'))
          .filter((img) => img.complete && img.naturalWidth === 0).length
      );
      assert.equal(brokenImages, 0, 'Found broken non-tile marker images');
    });
  });

  it('T1-C5: History tap opens RunDetailModal with interactive Leaflet map and close button', async () => {
    await withIsolatedPage('t1_c5', ROUTE_A_SEG1[0], async ({ page, athleteId }) => {
      await recordQuickRun(page, athleteId, ROUTE_A_SEG1);
      await clickNavTab(page, 'navHistory');
      const runRow = await waitForSelectorKey(page, 'historyRunItem');
      await runRow.click();

      await waitForSelectorKey(page, 'runDetailModal');
      await assertMobileLayout(page, { requireMap: true });
      await assertSvgPolylinesPresent(page, 1);

      await locatorFor(page, 'modalCloseBtn').click();
      await locatorFor(page, 'runDetailModal').waitFor({ state: 'hidden', timeout: 5000 });
    });
  });

  // --- Group D: Historial View ---
  it('T1-D1: Historial GPS run entry shows distance (km), duration, and pace', async () => {
    await withIsolatedPage('t1_d1', ROUTE_A_SEG1[0], async ({ page, athleteId }) => {
      await recordQuickRun(page, athleteId, ROUTE_A_SEG1);
      await clickNavTab(page, 'navHistory');
      const rowText = await (await waitForSelectorKey(page, 'historyRunItem')).textContent();
      assert.match(rowText, /0\.5\d\s*km/);
      assert.match(rowText, /\d{1,2}:\d{2}/);
      assert.match(rowText, /\d+:\d{2}\s*\/km/);
    });
  });

  it('T1-D2: Historial lists GPS runs newest-first', async () => {
    await withIsolatedPage('t1_d2', ROUTE_A_SEG1[0], async ({ page, athleteId }) => {
      await recordQuickRun(page, athleteId, ROUTE_A_SEG1.slice(0, 3), {
        minRuns: 1,
        expectLogCount: 1,
      });
      await locatorFor(page, 'btnSummaryDone').click();
      await waitForSelectorKey(page, 'btnStartRun');

      await recordQuickRun(page, athleteId, ROUTE_A_SEG1, {
        minRuns: 2,
        expectLogCount: 2,
      });
      await clickNavTab(page, 'navHistory');
      await waitForSelectorKey(page, 'historyRunItem');

      const items = allLocatorFor(page, 'historyRunItem');
      assert.ok((await items.count()) >= 2, 'Expected at least 2 GPS run rows');
      const firstRow = await items.nth(0).textContent();
      const secondRow = await items.nth(1).textContent();
      assert.ok(
        parseKmFromText(firstRow) > parseKmFromText(secondRow),
        `Expected newest run (~0.57 km) above older run (~0.22 km): "${firstRow}" vs "${secondRow}"`
      );
    });
  });

  it('T1-D3: Historial displays mixed manual workouts and GPS runs cleanly', async () => {
    await withIsolatedPage('t1_d3', ROUTE_A_SEG1[0], async ({ page, athleteId }) => {
      await submitManualWorkout(page, { type: 'pull', value: '40' });
      await recordQuickRun(page, athleteId, ROUTE_A_SEG1.slice(0, 3), {
        minRuns: 1,
        expectLogCount: 2,
      });
      await clickNavTab(page, 'navHistory');
      const historyText = await (await waitForSelectorKey(page, 'historyView')).textContent();
      assert.match(historyText, /pull:\s*40\s*kg/i);
      assert.match(historyText, /0\.2\d\s*km/);
    });
  });

  it('T1-D4: Tapping a non-GPS manual log row does not open broken map modal or crash', async () => {
    await withIsolatedPage('t1_d4', null, async ({ page }) => {
      await submitManualWorkout(page, { type: 'pull', value: '40' });
      await clickNavTab(page, 'navHistory');
      const manualRow = locatorFor(page, 'historyLogItem').or(
        locatorFor(page, 'historyView').locator('text=/pull:\\s*40\\s*kg/i')
      ).first();
      await manualRow.waitFor({ state: 'visible', timeout: 8000 });
      await manualRow.click();
      await page.waitForTimeout(300);

      assert.equal(await locatorFor(page, 'runDetailModal').isVisible(), false);
    });
  });

  it('T1-D5: GPS run remains visible in Historial beyond 5 total workout logs', async () => {
    await withIsolatedPage('t1_d5', ROUTE_A_SEG1[0], async ({ page, athleteId }) => {
      await recordQuickRun(page, athleteId, ROUTE_A_SEG1.slice(0, 3), {
        minRuns: 1,
        expectLogCount: 1,
      });
      for (let i = 1; i <= 5; i += 1) {
        await submitManualWorkout(page, { type: 'push', value: String(30 + i) });
      }
      await clickNavTab(page, 'navHistory');
      const runRow = await waitForSelectorKey(page, 'historyRunItem');
      assert.equal(await runRow.isVisible(), true);
    });
  });

  // --- Group E: Workspace Query CLI (query-runs.mjs) ---
  it('T1-E1: query-runs.mjs --json returns structured array with required RunActivity fields', async () => {
    await withIsolatedPage('t1_e1', ROUTE_A_SEG1[0], async ({ page, athleteId }) => {
      await recordQuickRun(page, athleteId, ROUTE_A_SEG1.slice(0, 3));
      const { data } = await runQueryRunsCli({ athlete: athleteId, json: true });
      const runs = extractRunsList(data);
      assert.ok(runs.length >= 1, 'Expected >= 1 run from query-runs.mjs --json');
      const r = runs[0];
      for (const key of [
        'id',
        'distanceMeters',
        'distanceKm',
        'activeDurationSec',
        'avgPaceMinPerKm',
        'avgPaceFormatted',
        'startedAt',
        'endedAt',
        'segments',
        'splitsKm',
      ]) {
        assert.ok(key in r, `Missing CLI JSON field "${key}"`);
      }
    });
  });

  it('T1-E2: query-runs.mjs --runId <id> --json returns exact matching run', async () => {
    await withIsolatedPage('t1_e2', ROUTE_A_SEG1[0], async ({ page, athleteId }) => {
      const { persisted } = await recordQuickRun(page, athleteId, ROUTE_A_SEG1.slice(0, 3));
      const runId = persisted.runs[0].id;
      const { data } = await runQueryRunsCli({ athlete: athleteId, runId, json: true });
      const run = extractSingleRun(data, runId);
      assert.ok(run, 'Expected run object for --runId');
      assert.equal(run.id, runId);
    });
  });

  it('T1-E3: query-runs.mjs --limit 1 --json returns only the newest run', async () => {
    await withIsolatedPage('t1_e3', ROUTE_A_SEG1[0], async ({ page, athleteId }) => {
      await recordQuickRun(page, athleteId, ROUTE_A_SEG1.slice(0, 3), {
        minRuns: 1,
        expectLogCount: 1,
      });
      await locatorFor(page, 'btnSummaryDone').click();
      await waitForSelectorKey(page, 'btnStartRun');

      const { persisted } = await recordQuickRun(page, athleteId, ROUTE_A_SEG1, {
        minRuns: 2,
        expectLogCount: 2,
      });
      const newestId = persisted.runs[0].id;

      const { data } = await runQueryRunsCli({ athlete: athleteId, limit: 1, json: true });
      const runs = extractRunsList(data);
      assert.equal(runs.length, 1);
      assert.equal(runs[0].id, newestId);
    });
  });

  it('T1-E4: query-runs.mjs human-readable output prints distance, duration, and pace', async () => {
    await withIsolatedPage('t1_e4', ROUTE_A_SEG1[0], async ({ page, athleteId }) => {
      const { summary } = await recordQuickRun(page, athleteId, ROUTE_A_SEG1.slice(0, 3));
      const { stdout } = await runQueryRunsCli({ athlete: athleteId, json: false });
      assert.ok(stdout.trim().length > 0, 'Expected non-empty human-readable CLI output');
      assert.match(stdout, /km/i);
      assert.match(stdout, /\/km/i);
      assert.ok(
        stdout.includes(normalizePaceText(summary.paceText).split(' ')[0]) ||
          /\d+:\d{2}/.test(stdout),
        'Expected formatted duration/pace in human-readable CLI output'
      );
    });
  });

  it('T1-E5: query-runs.mjs handles empty/nonexistent test athlete cleanly', async () => {
    const missingAthlete = generateTestAthleteId('empty_cli');
    const { data } = await runQueryRunsCli({ athlete: missingAthlete, json: true });
    const runs = extractRunsList(data);
    assert.deepStrictEqual(runs, []);
  });
});
