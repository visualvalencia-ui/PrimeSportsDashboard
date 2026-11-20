import React, { useState, useEffect, useMemo } from 'react';
import { db, getTargetContext } from './firebase';
import { doc, setDoc, onSnapshot } from 'firebase/firestore';
import { Activity, Dumbbell, Navigation, Plus, History } from 'lucide-react';
import { useRunTracker } from './hooks/useRunTracker.js';
import { subscribeRuns } from './services/runsService.js';
import { formatDuration } from './utils/gpsMath.js';
import RunTrackerView from './components/RunTrackerView.jsx';
import RunDetailModal from './components/RunDetailModal.jsx';

export default function App() {
  const targetCtx = useMemo(() => getTargetContext(), []);
  const tracker = useRunTracker();

  const [activeTab, setActiveTab] = useState('dashboard');
  const [data, setData] = useState({ logs: [] });
  const [gpsRuns, setGpsRuns] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);

  const [type, setType] = useState('cardio');
  const [value1, setValue1] = useState('');
  const [value2, setValue2] = useState('');

  useEffect(() => {
    const athleteRef = doc(db, targetCtx.collectionName, targetCtx.athleteId);
    const unsubDoc = onSnapshot(athleteRef, (docSnap) => {
      if (docSnap.exists()) {
        setData(docSnap.data());
      } else {
        setData({ logs: [] });
      }
    });

    const unsubRuns = subscribeRuns((runs) => {
      setGpsRuns(runs);
    }, targetCtx);

    return () => {
      unsubDoc();
      unsubRuns();
    };
  }, [targetCtx]);

  const handleSave = async () => {
    const num = parseFloat(value1);
    if (!Number.isFinite(num) || num <= 0) return;

    const newLog = {
      id: Date.now().toString(),
      date: new Date().toISOString(),
      type,
      v1: num,
      v2: value2 ? parseFloat(value2) : null,
    };
    const newLogs = [newLog, ...(data.logs || [])];
    await setDoc(
      doc(db, targetCtx.collectionName, targetCtx.athleteId),
      { logs: newLogs },
      { merge: true }
    );
    setValue1('');
    setValue2('');
    setActiveTab('dashboard');
  };

  const logs = data.logs || [];
  const manualLogs = logs.filter((l) => l?.source !== 'gps_pwa' && !l?.runId);

  const bestKm = Math.max(
    0,
    ...logs.filter((l) => l.type === 'cardio').map((l) => Number(l.v1) || 0),
    ...gpsRuns.map((r) => Number(r.distanceKm) || 0)
  );
  const bestKg = Math.max(
    0,
    ...logs.filter((l) => l.type === 'pull').map((l) => Number(l.v1) || 0)
  );

  // Lógica de Fases Dinámicas (Gamificación)
  let runTarget = 5;
  let runPhase = 'Fase 1 (Readaptación)';
  if (bestKm >= 5) {
    runTarget = 10;
    runPhase = 'Fase 2 (Normalización)';
  }
  if (bestKm >= 10) {
    runTarget = 19.6;
    runPhase = 'Fase 3 (El Prime)';
  }

  let pullTarget = 40;
  let pullPhase = 'Fase 1 (Readaptación)';
  if (bestKg >= 40) {
    pullTarget = 60;
    pullPhase = 'Fase 2 (Normalización)';
  }
  if (bestKg >= 60) {
    pullTarget = 80;
    pullPhase = 'Fase 3 (El Prime)';
  }

  const runPercent = Math.min((bestKm / runTarget) * 100, 100).toFixed(1);
  const pullPercent = Math.min((bestKg / pullTarget) * 100, 100).toFixed(1);

  return (
    <div className="container">
      <div className="header">
        <h1 data-testid="app-header">Prime Tracker</h1>
        {targetCtx.isTestMode && (
          <span className="test-mode-badge" data-testid="test-mode-badge">
            TEST MODE
          </span>
        )}
      </div>

      {activeTab === 'dashboard' && (
        <>
          <div className="card" data-testid="card-aerobic">
            <div className="card-title">
              <Activity size={20} /> Base Aeróbica
            </div>
            <div
              data-testid="aerobic-phase"
              style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}
            >
              {runPhase}
            </div>
            <div className="stat-row">
              <span data-testid="aerobic-actual">{`Actual: ${bestKm} km`}</span>
              <span data-testid="aerobic-target" style={{ color: 'var(--primary)' }}>
                {`Meta: ${runTarget} km`}
              </span>
            </div>
            <div className="progress-container">
              <div className="progress-bar" style={{ width: `${runPercent}%` }}></div>
            </div>
            <div
              data-testid="aerobic-percent"
              style={{ textAlign: 'right', fontSize: 12, marginTop: 4, color: 'var(--primary)' }}
            >
              {`${runPercent}%`}
            </div>
          </div>

          <div className="card" data-testid="card-strength">
            <div className="card-title">
              <Dumbbell size={20} /> Fuerza Relativa
            </div>
            <div
              data-testid="strength-phase"
              style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}
            >
              {pullPhase}
            </div>
            <div className="stat-row">
              <span data-testid="strength-actual">{`Actual: ${bestKg} kg`}</span>
              <span data-testid="strength-target" style={{ color: 'var(--primary)' }}>
                {`Meta: ${pullTarget} kg`}
              </span>
            </div>
            <div className="progress-container">
              <div className="progress-bar" style={{ width: `${pullPercent}%` }}></div>
            </div>
            <div
              data-testid="strength-percent"
              style={{ textAlign: 'right', fontSize: 12, marginTop: 4, color: 'var(--primary)' }}
            >
              {`${pullPercent}%`}
            </div>
          </div>
        </>
      )}

      {activeTab === 'run' && (
        <RunTrackerView tracker={tracker} targetCtx={targetCtx} />
      )}

      {activeTab === 'add' && (
        <div className="card">
          <div className="card-title">
            <Plus size={20} /> Registrar Actividad
          </div>
          <div className="input-group">
            <select
              data-testid="manual-type-select"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="cardio">Cardio (Kilómetros)</option>
              <option value="pull">Hale Polea (KG)</option>
              <option value="push">Prensa/Empuje (KG)</option>
            </select>
          </div>
          <div className="input-group">
            <input
              data-testid="manual-value-input"
              type="number"
              step="0.1"
              value={value1}
              onChange={(e) => setValue1(e.target.value)}
              placeholder="Ej: 5.5"
            />
          </div>
          <button
            type="button"
            className="btn"
            data-testid="manual-save-btn"
            onClick={handleSave}
          >
            Guardar
          </button>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="card" data-testid="history-view">
          <div className="card-title">
            <History size={20} /> Historial
          </div>

          {gpsRuns.length > 0 && (
            <div className="history-section">
              {gpsRuns.map((run) => {
                const dateLabel = run.startedAt
                  ? new Date(run.startedAt).toLocaleDateString('es-CO', {
                      month: 'short',
                      day: 'numeric',
                    })
                  : run.dateLocal || '';
                return (
                  <button
                    key={run.id}
                    type="button"
                    className="history-run-row"
                    data-testid={`history-run-item-${run.id}`}
                    onClick={() => setSelectedRun(run)}
                  >
                    <div className="history-run-top">
                      <span className="history-run-title">{run.title || 'Carrera GPS'}</span>
                      <span className="history-run-date">{dateLabel}</span>
                    </div>
                    <div className="history-run-metrics">
                      <span className="history-run-dist">
                        {`${Number(run.distanceKm || 0).toFixed(2)} km`}
                      </span>
                      <span>{formatDuration(run.activeDurationSec || 0)}</span>
                      <span>{run.avgPaceFormatted || '--:-- /km'}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {manualLogs.length > 0 && (
            <div className="history-section">
              {manualLogs.map((log) => (
                <div
                  key={log.id}
                  className="history-log-row"
                  data-testid="history-log-item"
                >
                  <span style={{ color: 'var(--primary)', textTransform: 'capitalize' }}>
                    {`${log.type}: `}
                  </span>
                  {`${log.v1} ${log.type === 'cardio' ? 'km' : 'kg'}`}
                </div>
              ))}
            </div>
          )}

          {gpsRuns.length === 0 && manualLogs.length === 0 && (
            <div className="history-empty">Sin actividades registradas aún.</div>
          )}
        </div>
      )}

      <RunDetailModal run={selectedRun} onClose={() => setSelectedRun(null)} />

      <div className="nav-bar" data-testid="nav-bar">
        <button
          type="button"
          className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
          data-testid="nav-dashboard"
          onClick={() => setActiveTab('dashboard')}
        >
          <Activity size={18} />
          <span>Dashboard</span>
        </button>
        <button
          type="button"
          className={`nav-item ${activeTab === 'run' ? 'active' : ''}`}
          data-testid="nav-run"
          onClick={() => setActiveTab('run')}
        >
          <Navigation size={18} />
          <span>Correr</span>
        </button>
        <button
          type="button"
          className={`nav-item ${activeTab === 'add' ? 'active' : ''}`}
          data-testid="nav-add"
          onClick={() => setActiveTab('add')}
        >
          <Plus size={18} />
          <span>Registrar</span>
        </button>
        <button
          type="button"
          className={`nav-item ${activeTab === 'history' ? 'active' : ''}`}
          data-testid="nav-history"
          onClick={() => setActiveTab('history')}
        >
          <History size={18} />
          <span>Historial</span>
        </button>
      </div>
    </div>
  );
}
