import React, { useEffect } from 'react';
import { formatDuration } from '../utils/gpsMath.js';
import RunMap from './RunMap.jsx';

export default function RunDetailModal({ run, onClose }) {
  useEffect(() => {
    if (!run) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [run, onClose]);

  if (!run) return null;

  const formattedDate = run.startedAt
    ? new Date(run.startedAt).toLocaleDateString('es-CO', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : run.dateLocal || '';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="run-detail-title"
        data-testid="run-detail-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 id="run-detail-title">{run.title || 'Detalle de Carrera'}</h2>
            {formattedDate && <div className="modal-date">{formattedDate}</div>}
          </div>
          <button
            type="button"
            className="modal-close-btn"
            data-testid="modal-close-btn"
            aria-label="Cerrar"
            onClick={onClose}
          >
            Cerrar
          </button>
        </div>

        <RunMap segments={run.segments} mode="detail" height="240px" />

        <div className="summary-metrics-grid">
          <div className="summary-metric-box">
            <span className="metric-label">Distancia</span>
            <span className="metric-value-accent" data-testid="modal-distance">
              {`${Number(run.distanceKm || 0).toFixed(2)} km`}
            </span>
          </div>
          <div className="summary-metric-box">
            <span className="metric-label">Tiempo Activo</span>
            <span className="metric-value" data-testid="modal-duration">
              {formatDuration(run.activeDurationSec || 0)}
            </span>
          </div>
          <div className="summary-metric-box">
            <span className="metric-label">Ritmo Prom.</span>
            <span className="metric-value-accent" data-testid="modal-pace">
              {run.avgPaceFormatted || '--:-- /km'}
            </span>
          </div>
        </div>

        <div className="run-submetrics">
          <span>{`En pausa: ${formatDuration(run.pausedDurationSec || 0)}`}</span>
          <span>{`Vel.: ${Number(run.avgSpeedKmh || 0).toFixed(1)} km/h`}</span>
          <span>{`Puntos: ${run.pointCount || 0}`}</span>
        </div>

        <div className="splits-list" data-testid="modal-splits">
          <div className="splits-title">Parciales por km</div>
          {Array.isArray(run.splitsKm) && run.splitsKm.length > 0 ? (
            run.splitsKm.map((split) => (
              <div key={split.km} className="split-row">
                <span>{`Km ${split.km}`}</span>
                <span>{formatDuration(split.durationSec)}</span>
                <span className="split-pace">{split.paceFormatted}</span>
              </div>
            ))
          ) : (
            <div className="splits-empty">Sin parciales de 1 km completos</div>
          )}
        </div>
      </div>
    </div>
  );
}
