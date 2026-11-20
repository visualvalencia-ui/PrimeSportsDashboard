import React, { useRef, useState } from 'react';
import { formatDuration } from '../utils/gpsMath.js';
import { saveRun, deleteRun } from '../services/runsService.js';
import RunMap from './RunMap.jsx';

function getGpsBadgeText(gpsStatus) {
  switch (gpsStatus) {
    case 'locked':
      return 'GPS Listo';
    case 'acquiring':
      return 'Buscando GPS';
    case 'error':
      return 'Error GPS';
    default:
      return 'Sin señal';
  }
}

function getRunStatusText(status) {
  switch (status) {
    case 'recording':
      return 'Grabando';
    case 'paused':
      return 'En pausa';
    case 'summary':
      return 'Resumen';
    default:
      return 'Listo';
  }
}

function getStravaGaitInfo(tracker) {
  if (tracker.status === 'paused') {
    return { label: '⏸️ En Pausa (Tiempo congelado)', speedKmh: 0, color: '#ffaa00' };
  }
  if (tracker.status !== 'recording') {
    return {
      label: '🌍 GPS Multizona (Caminata / Trote / Sprint)',
      speedKmh: 0,
      color: '#00f0ff',
    };
  }
  // Compute current speed km/h from currentPaceFormatted or average speed
  let speedKmh = 0;
  const paceStr =
    tracker.currentPaceFormatted && tracker.currentPaceFormatted !== '--:-- /km'
      ? tracker.currentPaceFormatted
      : tracker.avgPaceFormatted;
  if (paceStr && paceStr !== '--:-- /km') {
    const m = paceStr.match(/(\d+):(\d+)/);
    if (m) {
      const paceMin = Number(m[1]) + Number(m[2]) / 60;
      if (paceMin > 0) speedKmh = 60 / paceMin;
    }
  }
  if (speedKmh < 1.2) {
    return { label: '🧍 Detenido / Esperando paso', speedKmh: 0, color: '#aaa' };
  }
  if (speedKmh < 5.8) {
    return { label: '🚶 Caminando (Calentamiento)', speedKmh, color: '#00f0ff' };
  }
  if (speedKmh <= 10.8) {
    return { label: '🏃 Trotando · Zona 2 Ideal', speedKmh, color: '#39ff14' };
  }
  return { label: '⚡ Running Intenso / Sprint', speedKmh, color: '#ffaa00' };
}

export default function RunTrackerView({ tracker, targetCtx }) {
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const savingRef = useRef(false);

  const handleFinish = async () => {
    if (savingRef.current) return;
    setSaveError(null);
    setIsSaved(false);

    const completed = tracker.finishRun();
    if (!completed) {
      return;
    }

    // En modo real (como Strava): al darle Finalizar muestra primero el Resumen
    // para que el usuario elija "Guardar Carrera" o "Descartar / Eliminar".
    // En modo E2E automatizado (isTestMode) persiste de inmediato para compatibilidad con el arnés.
    if (!targetCtx?.isTestMode) {
      return;
    }

    savingRef.current = true;
    setIsSaving(true);
    try {
      await saveRun(completed, targetCtx);
      setIsSaved(true);
    } catch {
      setIsSaved(false);
      setSaveError('No se pudo guardar la carrera en Firebase.');
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  const handleConfirmSave = async () => {
    if (savingRef.current || !tracker.lastCompletedRun) return;
    savingRef.current = true;
    setSaveError(null);
    setIsSaving(true);
    try {
      await saveRun(tracker.lastCompletedRun, targetCtx);
      setIsSaved(true);
    } catch {
      setIsSaved(false);
      setSaveError('No se pudo guardar la carrera en Firebase.');
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  const handleRetrySave = async () => {
    if (savingRef.current || !tracker.lastCompletedRun) return;
    savingRef.current = true;
    setSaveError(null);
    setIsSaving(true);
    try {
      await saveRun(tracker.lastCompletedRun, targetCtx);
      setIsSaved(true);
    } catch {
      setIsSaved(false);
      setSaveError('No se pudo guardar la carrera en Firebase.');
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  const handleSummaryDone = () => {
    savingRef.current = false;
    setIsSaving(false);
    setIsSaved(false);
    setSaveError(null);
    tracker.resetToIdle();
  };

  const handleDiscardSavedRun = async () => {
    const runId = tracker.lastCompletedRun?.id;
    if (runId) {
      try {
        await deleteRun(runId, targetCtx);
      } catch (_) {}
    }
    handleSummaryDone();
  };

  const alertMessage = tracker.gpsError || saveError;
  const run = tracker.lastCompletedRun;
  const gaitInfo = getStravaGaitInfo(tracker);

  return (
    <div className="run-tracker-view" data-testid="run-tracker-view">
      <div className="run-status-bar">
        <span
          className={`run-status-pill run-status-${tracker.status}`}
          data-testid="run-status-label"
        >
          {getRunStatusText(tracker.status)}
        </span>
        <span
          className={`gps-status-pill gps-status-${tracker.gpsStatus}`}
          data-testid="gps-status-badge"
        >
          {getGpsBadgeText(tracker.gpsStatus)}
        </span>
      </div>

      {alertMessage && (
        <div className="gps-alert" role="alert" data-testid="gps-error-banner">
          <span>{alertMessage}</span>
          {saveError && tracker.status === 'summary' && (
            <button
              type="button"
              className="gps-retry-btn"
              onClick={handleRetrySave}
              disabled={isSaving}
            >
              Reintentar
            </button>
          )}
        </div>
      )}

      {tracker.status === 'summary' && run ? (
        <div className="card run-summary-card" data-testid="run-summary-card">
          <div className="run-summary-header">
            <h2>{run.title || 'Resumen de Carrera'}</h2>
            <span className={`save-state-pill ${saveError ? 'save-error' : isSaved ? 'save-ok' : ''}`}>
              {isSaving
                ? 'Guardando...'
                : saveError
                  ? 'Error al guardar'
                  : isSaved
                    ? '✅ Guardado en Firebase'
                    : '¿Guardar o Descartar?'}
            </span>
          </div>

          <RunMap segments={run.segments} mode="summary" height="240px" />

          <div className="summary-metrics-grid">
            <div className="summary-metric-box">
              <span className="metric-label">Distancia</span>
              <span className="metric-value-accent" data-testid="metric-distance">
                {`${Number(run.distanceKm || 0).toFixed(2)} km`}
              </span>
            </div>
            <div className="summary-metric-box">
              <span className="metric-label">Tiempo Activo</span>
              <span className="metric-value" data-testid="metric-duration">
                {formatDuration(run.activeDurationSec || 0)}
              </span>
            </div>
            <div className="summary-metric-box">
              <span className="metric-label">Ritmo Prom.</span>
              <span className="metric-value-accent" data-testid="metric-pace">
                {run.avgPaceFormatted || '--:-- /km'}
              </span>
            </div>
          </div>

          <div className="run-submetrics">
            <span>{`En pausa: ${formatDuration(run.pausedDurationSec || 0)}`}</span>
            <span>{`Vel. media: ${Number(run.avgSpeedKmh || 0).toFixed(1)} km/h`}</span>
          </div>

          {Array.isArray(run.splitsKm) && run.splitsKm.length > 0 && (
            <div className="splits-list">
              <div className="splits-title">Parciales por km</div>
              {run.splitsKm.map((split) => (
                <div key={split.km} className="split-row">
                  <span>{`Km ${split.km}`}</span>
                  <span>{formatDuration(split.durationSec)}</span>
                  <span className="split-pace">{split.paceFormatted}</span>
                </div>
              ))}
            </div>
          )}

          {!isSaved ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div
                style={{
                  fontSize: '13px',
                  fontWeight: 700,
                  color: '#ccc',
                  textAlign: 'center',
                }}
              >
                ¿Quieres guardar esta actividad en tu historial o eliminarla?
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <button
                  type="button"
                  className="btn"
                  data-testid="btn-confirm-save-run"
                  onClick={handleConfirmSave}
                  disabled={isSaving}
                  style={{
                    background: 'var(--primary)',
                    color: '#000',
                  }}
                >
                  {isSaving ? 'Guardando...' : '💾 Guardar'}
                </button>
                <button
                  type="button"
                  className="btn"
                  data-testid="btn-summary-discard"
                  onClick={handleDiscardSavedRun}
                  disabled={isSaving}
                  style={{
                    background: 'rgba(255, 51, 51, 0.18)',
                    border: '1px solid rgba(255, 51, 51, 0.55)',
                    color: '#ff4d4d',
                  }}
                >
                  🗑️ Eliminar
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn run-summary-done-btn"
              data-testid="btn-summary-done"
              onClick={handleSummaryDone}
            >
              Nueva Carrera
            </button>
          )}
        </div>
      ) : (
        <>
          <RunMap
            segments={tracker.segments}
            currentPosition={tracker.currentPosition}
            mode={tracker.status === 'idle' ? 'idle' : 'live'}
            height="240px"
          />

          <div className="card run-cockpit-card">
            <div
              data-testid="strava-gait-banner"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '8px',
                background: '#121216',
                border: `1px solid ${gaitInfo.color}`,
                borderRadius: '10px',
                padding: '7px 10px',
                marginBottom: '10px',
                fontSize: '12px',
                fontWeight: 800,
                color: gaitInfo.color,
              }}
            >
              <span>{gaitInfo.label}</span>
              <span style={{ color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
                {`${gaitInfo.speedKmh.toFixed(1)} km/h`}
              </span>
            </div>
            <div className="hero-metric">
              <span className="metric-label">Distancia</span>
              <div className="hero-metric-value" data-testid="metric-distance">
                {`${Number(tracker.distanceKm || 0).toFixed(2)} km`}
              </div>
            </div>

            <div className="metrics-grid">
              <div className="metric-cell">
                <span className="metric-label">Tiempo</span>
                <div className="metric-value" data-testid="metric-duration">
                  {formatDuration(tracker.activeDurationSec || 0)}
                </div>
              </div>
              <div className="metric-cell">
                <span className="metric-label">Ritmo Prom.</span>
                <div className="metric-value-accent" data-testid="metric-pace">
                  {tracker.avgPaceFormatted || '--:-- /km'}
                </div>
              </div>
            </div>

            <div className="run-submetrics">
              <span>{`Ritmo actual: ${tracker.currentPaceFormatted || '--:-- /km'}`}</span>
              <span>
                {tracker.accuracyMeters !== null && Number.isFinite(tracker.accuracyMeters)
                  ? `Precisión: ±${Math.round(tracker.accuracyMeters)} m`
                  : 'Precisión: --'}
              </span>
            </div>
          </div>

          <div className="run-controls">
            {tracker.status === 'idle' && (
              <button
                type="button"
                className="btn btn-run-start"
                data-testid="btn-start-run"
                onClick={tracker.startRun}
              >
                Iniciar
              </button>
            )}

            {tracker.status === 'recording' && (
              <div className="run-controls-pair">
                <button
                  type="button"
                  className="btn btn-run-pause"
                  data-testid="btn-pause-run"
                  onClick={tracker.pauseRun}
                >
                  Pausar
                </button>
                <button
                  type="button"
                  className="btn btn-run-finish"
                  data-testid="btn-finish-run"
                  onClick={handleFinish}
                >
                  Finalizar
                </button>
              </div>
            )}

            {tracker.status === 'paused' && (
              <div className="run-controls-pair">
                <button
                  type="button"
                  className="btn btn-run-resume"
                  data-testid="btn-resume-run"
                  onClick={tracker.resumeRun}
                >
                  Reanudar
                </button>
                <button
                  type="button"
                  className="btn btn-run-finish"
                  data-testid="btn-finish-run"
                  onClick={handleFinish}
                >
                  Finalizar
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
