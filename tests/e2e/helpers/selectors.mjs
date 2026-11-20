export const SELECTORS = Object.freeze({
  // App Shell & Navigation
  appHeader: {
    testId: 'app-header',
    fallback: '.header h1',
  },
  testModeBadge: {
    testId: 'test-mode-badge',
    fallback: 'text=/TEST MODE/i',
  },
  navBar: {
    testId: 'nav-bar',
    fallback: '.nav-bar',
  },
  navDashboard: {
    testId: 'nav-dashboard',
    fallback: '.nav-bar .nav-item:has-text("Dashboard")',
  },
  navRun: {
    testId: 'nav-run',
    fallback: '.nav-bar .nav-item:has-text("Correr")',
  },
  navAdd: {
    testId: 'nav-add',
    fallback: '.nav-bar .nav-item:has-text("Registrar")',
  },
  navHistory: {
    testId: 'nav-history',
    fallback: '.nav-bar .nav-item:has-text("Historial")',
  },

  // Dashboard Cards
  cardAerobic: {
    testId: 'card-aerobic',
    fallback: '.card:has-text("Base Aeróbica")',
  },
  aerobicPhase: {
    testId: 'aerobic-phase',
    fallback: '.card:has-text("Base Aeróbica") >> text=/Fase \\d/',
  },
  aerobicActual: {
    testId: 'aerobic-actual',
    fallback: '.card:has-text("Base Aeróbica") >> text=/Actual:/',
  },
  aerobicTarget: {
    testId: 'aerobic-target',
    fallback: '.card:has-text("Base Aeróbica") >> text=/Meta:/',
  },
  aerobicPercent: {
    testId: 'aerobic-percent',
    fallback: '.card:has-text("Base Aeróbica") >> text=/%$/',
  },
  cardStrength: {
    testId: 'card-strength',
    fallback: '.card:has-text("Fuerza Relativa")',
  },
  strengthPhase: {
    testId: 'strength-phase',
    fallback: '.card:has-text("Fuerza Relativa") >> text=/Fase \\d/',
  },
  strengthActual: {
    testId: 'strength-actual',
    fallback: '.card:has-text("Fuerza Relativa") >> text=/Actual:/',
  },
  strengthTarget: {
    testId: 'strength-target',
    fallback: '.card:has-text("Fuerza Relativa") >> text=/Meta:/',
  },
  strengthPercent: {
    testId: 'strength-percent',
    fallback: '.card:has-text("Fuerza Relativa") >> text=/%$/',
  },

  // Registrar Manual Form
  manualTypeSelect: {
    testId: 'manual-type-select',
    fallback: '.card:has-text("Registrar Actividad") select',
  },
  manualValueInput: {
    testId: 'manual-value-input',
    fallback: '.card:has-text("Registrar Actividad") input[type="number"]',
  },
  manualSaveBtn: {
    testId: 'manual-save-btn',
    fallback: '.card:has-text("Registrar Actividad") button.btn:has-text("Guardar")',
  },

  // RunTrackerView & RunMap
  runTrackerView: {
    testId: 'run-tracker-view',
    fallback: null,
  },
  gpsStatusBadge: {
    testId: 'gps-status-badge',
    fallback: 'text=/GPS Listo|Buscando GPS|Error GPS|Sin señal/i',
  },
  gpsErrorBanner: {
    testId: 'gps-error-banner',
    fallback: '[role="alert"]',
  },
  runStatusLabel: {
    testId: 'run-status-label',
    fallback: 'text=/Listo|Grabando|En pausa|Resumen/i',
  },
  metricDistance: {
    testId: 'metric-distance',
    fallback: null,
  },
  metricDuration: {
    testId: 'metric-duration',
    fallback: null,
  },
  metricPace: {
    testId: 'metric-pace',
    fallback: null,
  },
  btnStartRun: {
    testId: 'btn-start-run',
    fallback: 'button:has-text("Iniciar")',
  },
  btnPauseRun: {
    testId: 'btn-pause-run',
    fallback: 'button:has-text("Pausar")',
  },
  btnResumeRun: {
    testId: 'btn-resume-run',
    fallback: 'button:has-text("Reanudar")',
  },
  btnFinishRun: {
    testId: 'btn-finish-run',
    fallback: 'button:has-text("Finalizar")',
  },
  runSummaryCard: {
    testId: 'run-summary-card',
    fallback: null,
  },
  btnSummaryDone: {
    testId: 'btn-summary-done',
    fallback: 'button:has-text("Nueva Carrera"), button:has-text("Listo")',
  },
  runMap: {
    testId: 'run-map',
    fallback: '.leaflet-container',
  },

  // Historial & RunDetailModal
  historyView: {
    testId: 'history-view',
    fallback: '.card:has-text("Historial")',
  },
  historyRunItem: {
    testId: 'history-run-item',
    fallback: '[data-testid^="history-run-item"]',
  },
  historyLogItem: {
    testId: 'history-log-item',
    fallback: null,
  },
  runDetailModal: {
    testId: 'run-detail-modal',
    fallback: '[role="dialog"]',
  },
  modalCloseBtn: {
    testId: 'modal-close-btn',
    fallback: '[role="dialog"] button[aria-label="Cerrar"], [role="dialog"] button:has-text("Cerrar")',
  },
  modalDistance: {
    testId: 'modal-distance',
    fallback: null,
  },
  modalDuration: {
    testId: 'modal-duration',
    fallback: null,
  },
  modalPace: {
    testId: 'modal-pace',
    fallback: null,
  },
  modalSplits: {
    testId: 'modal-splits',
    fallback: null,
  },
});

export function getEntry(key) {
  const entry = SELECTORS[key];
  if (!entry) {
    throw new Error(`Unknown selector key "${key}"`);
  }
  return entry;
}

/**
 * Returns a Playwright locator preferring [data-testid="..."] and falling back
 * to the semantic/Spanish selector when available.
 */
export function locatorFor(page, key, { exactTestIdOnly = false } = {}) {
  const { testId, fallback } = getEntry(key);
  const tidLocator = page.locator(`[data-testid="${testId}"]`);
  if (exactTestIdOnly || !fallback) {
    return tidLocator.first();
  }
  if (key === 'historyRunItem') {
    return page.locator('[data-testid="history-run-item"], [data-testid^="history-run-item-"]').first();
  }
  return tidLocator.or(page.locator(fallback)).first();
}

export function allLocatorFor(page, key) {
  const { testId, fallback } = getEntry(key);
  if (key === 'historyRunItem') {
    return page.locator('[data-testid="history-run-item"], [data-testid^="history-run-item-"]');
  }
  const tidLocator = page.locator(`[data-testid="${testId}"]`);
  if (!fallback) return tidLocator;
  return tidLocator.or(page.locator(fallback));
}

export async function waitForSelectorKey(page, key, options = {}) {
  const loc = locatorFor(page, key, options);
  await loc.waitFor({ state: options.state || 'visible', timeout: options.timeout ?? 10000 });
  return loc;
}

export async function clickNavTab(page, tabKey) {
  const loc = await waitForSelectorKey(page, tabKey, { timeout: 10000 });
  await loc.click();
}

export function parseMetricNumber(text) {
  if (!text) return NaN;
  const cleaned = String(text).replace(/,/g, '.');
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  return match ? Number.parseFloat(match[0]) : NaN;
}

export function parseKmFromText(text) {
  if (!text) return NaN;
  const cleaned = String(text).replace(/,/g, '.');
  const match = cleaned.match(/(\d+(?:\.\d+)?)\s*km/i);
  return match ? Number.parseFloat(match[1]) : parseMetricNumber(cleaned);
}

export function parseDurationSeconds(text) {
  if (!text) return NaN;
  const match = String(text).trim().match(/(?:(\d+):)?(\d{1,2}):(\d{2})/);
  if (!match) return NaN;
  const hours = match[1] ? Number.parseInt(match[1], 10) : 0;
  const mins = Number.parseInt(match[2], 10);
  const secs = Number.parseInt(match[3], 10);
  return hours * 3600 + mins * 60 + secs;
}

export function normalizePaceText(text) {
  if (!text) return '';
  return String(text).replace(/\s+/g, ' ').trim();
}

export function parsePaceMinPerKm(text) {
  if (!text) return NaN;
  const match = String(text).trim().match(/(\d+):(\d{2})\s*\/km/i);
  if (!match) return NaN;
  const mins = Number.parseInt(match[1], 10);
  const secs = Number.parseInt(match[2], 10);
  if (secs >= 60) return NaN;
  return mins + secs / 60;
}
