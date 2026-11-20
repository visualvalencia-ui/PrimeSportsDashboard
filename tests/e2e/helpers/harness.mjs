import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { TEST_COLLECTION, assertSafeTestTarget } from './firestoreCleanup.mjs';
import { locatorFor, parseMetricNumber } from './selectors.mjs';

export const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
export const VITE_BIN = path.join(REPO_ROOT, 'node_modules/vite/bin/vite.js');
export const CHROME_PATH =
  process.env.E2E_CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const DEFAULT_SCREENSHOT_DIR =
  process.env.E2E_SCREENSHOT_DIR || '/tmp/prime_e2e_screenshots';

let didBuildDist = false;

export async function launchBrowser() {
  return chromium.launch({
    executablePath: CHROME_PATH,
    headless: process.env.E2E_HEADLESS !== '0',
  });
}

export async function createGpsContext(
  browser,
  initialGeo = { latitude: 4.60163, longitude: -74.222679, accuracy: 8 }
) {
  const normalizedGeo = initialGeo
    ? {
        latitude: initialGeo.latitude ?? initialGeo.lat ?? 4.60163,
        longitude: initialGeo.longitude ?? initialGeo.lng ?? -74.222679,
        accuracy: initialGeo.accuracy ?? 8,
      }
    : { latitude: 4.60163, longitude: -74.222679, accuracy: 8 };
  return browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
    permissions: ['geolocation'],
    geolocation: normalizedGeo,
    serviceWorkers: 'block',
  });
}

export async function createDeniedGeoContext(browser) {
  return browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
    permissions: [],
    serviceWorkers: 'block',
  });
}

export function attachErrorGuard(
  page,
  { serverMode = 'dev', allowGeoErrors = false } = {}
) {
  const errors = [];

  const isAllowedSwNoise = (text) =>
    serverMode === 'preview' &&
    /serviceWorker|sw\.js|navigator\.serviceWorker/i.test(text);

  const isAllowedGeoNoise = (text) =>
    allowGeoErrors && /geolocation|permission denied|position unavailable/i.test(text);

  page.on('pageerror', (err) => {
    const msg = err?.stack || err?.message || String(err);
    if (!isAllowedSwNoise(msg)) {
      errors.push(`pageerror: ${msg}`);
    }
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      const locUrl = msg.location()?.url || '';
      const isFavicon404 =
        /404 \(Not Found\)/i.test(text) && /\/favicon\.ico(?:$|\?)/i.test(locUrl);
      if (!isFavicon404 && !isAllowedSwNoise(text) && !isAllowedGeoNoise(text)) {
        errors.push(`console.error: ${text}${locUrl ? ` (${locUrl})` : ''}`);
      }
    }
  });

  return errors;
}

export function assertNoAppErrors(errors) {
  assert.deepStrictEqual(
    errors,
    [],
    `Unexpected browser errors detected:\n${errors.join('\n')}`
  );
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function waitForHttp200(url, child, stderrRef, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (child && child.exitCode !== null) {
      throw new Error(
        `Vite server exited prematurely with code ${child.exitCode}. STDERR:\n${stderrRef.value}`
      );
    }
    try {
      const res = await fetch(url);
      if (res.status === 200) return;
    } catch {
      // Server still booting
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ${url}. STDERR:\n${stderrRef.value}`
  );
}

export async function startViteServer() {
  if (process.env.E2E_BASE_URL) {
    const baseUrl = process.env.E2E_BASE_URL.replace(/\/+$/, '');
    await waitForHttp200(`${baseUrl}/`, null, { value: '' }, 10000);
    return {
      baseUrl,
      mode: process.env.E2E_SERVER_MODE || 'external',
      stop: async () => {},
    };
  }

  const mode = process.env.E2E_SERVER_MODE === 'preview' ? 'preview' : 'dev';
  const distIndexPath = path.join(REPO_ROOT, 'dist', 'index.html');

  if (mode === 'preview' && process.env.E2E_BUILD === '1' && !didBuildDist) {
    execFileSync(process.execPath, [VITE_BIN, 'build'], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    });
    didBuildDist = true;
  }

  if (mode === 'preview' && !fs.existsSync(distIndexPath)) {
    throw new Error(
      `E2E_SERVER_MODE=preview requires ${distIndexPath} to exist (run "npm run build" or set E2E_BUILD=1).`
    );
  }

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const args = [
    VITE_BIN,
    ...(mode === 'preview' ? ['preview'] : []),
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
  ];

  const child = spawn(process.execPath, args, {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stderrRef = { value: '' };
  child.stderr.on('data', (chunk) => {
    stderrRef.value += chunk.toString();
  });

  try {
    await waitForHttp200(`${baseUrl}/`, child, stderrRef, 15000);
  } catch (err) {
    try {
      child.kill('SIGKILL');
    } catch {
      // ignore
    }
    throw err;
  }

  const stop = async () => {
    if (child.exitCode !== null) return;
    await new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      child.once('exit', done);
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null) {
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
        }
        done();
      }, 2000).unref();
    });
  };

  return { baseUrl, mode, stop };
}

export function buildAppUrl(baseUrl, athleteId, collection = TEST_COLLECTION) {
  assertSafeTestTarget(collection, athleteId);
  const qs = new URLSearchParams({
    testCollection: collection,
    athlete: athleteId,
  });
  return `${baseUrl}/?${qs.toString()}`;
}

export const geoDriver = {
  async setFix(context, { lat, lng, accuracy = 8 }) {
    await context.setGeolocation({
      latitude: lat,
      longitude: lng,
      accuracy,
    });
  },

  async stepAcceptedFix(
    context,
    page,
    fix,
    { waitForDistanceChange = false, timeoutMs = 4000, stepDelayMs = 450 } = {}
  ) {
    let beforeDistance = null;
    if (waitForDistanceChange) {
      const distText = await locatorFor(page, 'metricDistance').textContent();
      beforeDistance = parseMetricNumber(distText);
    }

    await geoDriver.setFix(context, fix);

    if (waitForDistanceChange && Number.isFinite(beforeDistance)) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() <= deadline) {
        const curText = await locatorFor(page, 'metricDistance').textContent();
        const curVal = parseMetricNumber(curText);
        if (Number.isFinite(curVal) && Math.abs(curVal - beforeDistance) >= 0.005) {
          break;
        }
        await page.waitForTimeout(100);
      }
    }

    if (stepDelayMs > 0) {
      await page.waitForTimeout(stepDelayMs);
    }
  },

  async stepIgnoredFix(context, page, fix, { settleMs = 350 } = {}) {
    await geoDriver.setFix(context, fix);
    if (settleMs > 0) {
      await page.waitForTimeout(settleMs);
    }
  },
};

export async function assertMobileLayout(
  page,
  { requireMap = false, requireControls = false } = {}
) {
  const layout = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    docScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));

  assert.equal(layout.innerWidth, 390, `Expected innerWidth 390, got ${layout.innerWidth}`);
  assert.ok(
    layout.docScrollWidth <= 390,
    `Horizontal overflow: documentElement.scrollWidth=${layout.docScrollWidth} (> 390)`
  );
  assert.ok(
    layout.bodyScrollWidth <= 390,
    `Horizontal overflow: body.scrollWidth=${layout.bodyScrollWidth} (> 390)`
  );

  if (requireMap) {
    const mapBox = await page.locator('.leaflet-container').first().boundingBox();
    assert.ok(mapBox, 'Expected visible .leaflet-container');
    assert.ok(
      mapBox.width > 0 && mapBox.width <= 390,
      `Map width out of mobile bounds: ${mapBox.width}`
    );
    assert.ok(mapBox.height >= 180, `Map height too small: ${mapBox.height}`);

    // Wait briefly for external CartoDB Dark Matter tiles (warn-only if offline)
    try {
      await page
        .locator('.leaflet-tile-loaded')
        .first()
        .waitFor({ state: 'attached', timeout: 2500 });
    } catch {
      // Tile CDN lag/offline should not fail deterministic SVG polyline verification
    }
  }

  if (requireControls) {
    const navBarBox = await locatorFor(page, 'navBar').boundingBox();
    assert.ok(navBarBox, 'Expected .nav-bar bounding box');

    for (const key of ['btnStartRun', 'btnPauseRun', 'btnResumeRun', 'btnFinishRun']) {
      const btn = locatorFor(page, key);
      if ((await btn.count()) > 0 && (await btn.isVisible())) {
        const box = await btn.boundingBox();
        assert.ok(box, `Expected bounding box for ${key}`);
        assert.ok(box.height >= 40, `Touch target ${key} height ${box.height} < 40px`);
        assert.ok(box.x >= 0 && box.x + box.width <= 390.5, `${key} clipped horizontally`);
        assert.ok(
          box.y + box.height <= navBarBox.y + 2,
          `${key} overlaps fixed .nav-bar (btnBottom=${box.y + box.height}, navTop=${navBarBox.y})`
        );
      }
    }
  }
}

export async function captureScreenshot(page, filename) {
  const dir = process.env.E2E_SCREENSHOT_DIR || DEFAULT_SCREENSHOT_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const targetPath = path.join(dir, filename);
  await page.screenshot({ path: targetPath, fullPage: false });
  return targetPath;
}
