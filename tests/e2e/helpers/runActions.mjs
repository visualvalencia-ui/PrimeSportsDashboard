import assert from 'node:assert/strict';
import { waitForRunPersistence } from './firestoreCleanup.mjs';
import {
  assertMobileLayout,
  buildAppUrl,
  geoDriver,
} from './harness.mjs';
import {
  clickNavTab,
  locatorFor,
  parseDurationSeconds,
  parseMetricNumber,
  waitForSelectorKey,
} from './selectors.mjs';

export async function openIsolatedApp(page, baseUrl, athleteId, initialGeo = null) {
  await page.goto(buildAppUrl(baseUrl, athleteId), {
    waitUntil: 'domcontentloaded',
  });
  await waitForSelectorKey(page, 'appHeader');
  if (initialGeo) {
    await geoDriver.setFix(page.context(), initialGeo);
  }
}

export async function submitManualWorkout(page, { type, value }) {
  await clickNavTab(page, 'navAdd');
  await waitForSelectorKey(page, 'manualTypeSelect');
  await locatorFor(page, 'manualTypeSelect').selectOption(type);
  await locatorFor(page, 'manualValueInput').fill(String(value));
  await locatorFor(page, 'manualSaveBtn').click();
  await waitForSelectorKey(page, 'cardAerobic');
}

export async function openRunTabAndStart(page, startFix) {
  if (startFix) {
    await geoDriver.setFix(page.context(), startFix);
  }
  await clickNavTab(page, 'navRun');
  await waitForSelectorKey(page, 'runTrackerView');
  const startBtn = await waitForSelectorKey(page, 'btnStartRun');
  const startedAtMs = Date.now();
  await startBtn.click();
  await waitForSelectorKey(page, 'btnPauseRun');
  await locatorFor(page, 'gpsStatusBadge')
    .filter({ hasText: /GPS Listo/i })
    .waitFor({ timeout: 5000 });
  return { startedAtMs };
}

export async function resumeRunAtFix(page, firstWaypoint) {
  if (firstWaypoint) {
    await geoDriver.setFix(page.context(), firstWaypoint);
  }
  const resumedAtMs = Date.now();
  await locatorFor(page, 'btnResumeRun').click();
  await waitForSelectorKey(page, 'btnPauseRun');
  await locatorFor(page, 'gpsStatusBadge')
    .filter({ hasText: /GPS Listo/i })
    .waitFor({ timeout: 5000 });
  return { resumedAtMs };
}

export async function stepRouteSegment(
  page,
  waypoints,
  { stepDelayMs = 450, waitForDistanceChange = true, skipFirst = false } = {}
) {
  const startIndex = skipFirst ? 1 : 0;
  for (let i = startIndex; i < waypoints.length; i += 1) {
    await geoDriver.stepAcceptedFix(page.context(), page, waypoints[i], {
      waitForDistanceChange: waitForDistanceChange && i > 0,
      stepDelayMs,
    });
  }
}

export async function finishAndAwaitPersistence(page, athleteId, { minRuns = 1, expectLogCount = 1 } = {}) {
  const finishBtn = await waitForSelectorKey(page, 'btnFinishRun');
  await finishBtn.click();
  await waitForSelectorKey(page, 'runSummaryCard');
  const finishedAtMs = Date.now();
  const persisted = await waitForRunPersistence(athleteId, { minRuns, expectLogCount });
  return { ...persisted, finishedAtMs };
}

export async function readRunSummaryMetrics(page) {
  const distText = await locatorFor(page, 'metricDistance').textContent();
  const durText = await locatorFor(page, 'metricDuration').textContent();
  const paceText = await locatorFor(page, 'metricPace').textContent();
  return {
    distanceText: distText?.trim() ?? '',
    distanceKm: parseMetricNumber(distText),
    durationText: durText?.trim() ?? '',
    durationSec: parseDurationSeconds(durText),
    paceText: paceText?.trim() ?? '',
  };
}

export async function assertSvgPolylinesPresent(page, minCount = 1) {
  const polylines = await page.evaluate(() =>
    [...document.querySelectorAll('.leaflet-overlay-pane svg path')]
      .filter((el) => {
        const fill = (el.getAttribute('fill') || '').trim().toLowerCase();
        const d = (el.getAttribute('d') || '').trim();
        return fill === 'none' && /L/i.test(d);
      })
      .map((el) => ({
        d: (el.getAttribute('d') || '').trim(),
      }))
  );
  assert.ok(
    polylines.length >= minCount,
    `Expected >= ${minCount} Leaflet SVG polyline path(s) (fill="none" with L segment), found ${polylines.length}`
  );
  for (let i = 0; i < polylines.length; i += 1) {
    assert.ok(polylines[i].d.length > 0, `Leaflet SVG polyline #${i} has empty "d" attribute`);
  }
  return polylines.length;
}

export async function recordQuickRun(page, athleteId, waypoints, { stepDelayMs = 450, minRuns = 1, expectLogCount = 1 } = {}) {
  await openRunTabAndStart(page, waypoints[0]);
  await stepRouteSegment(page, waypoints, { stepDelayMs, skipFirst: true });
  const persisted = await finishAndAwaitPersistence(page, athleteId, { minRuns, expectLogCount });
  await assertMobileLayout(page, { requireMap: true });
  const summary = await readRunSummaryMetrics(page);
  return { summary, persisted };
}
