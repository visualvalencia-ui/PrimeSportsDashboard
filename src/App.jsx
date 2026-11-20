import React, { useState, useEffect, useMemo } from 'react';
import { db, getTargetContext } from './firebase';
import { doc, setDoc, onSnapshot } from 'firebase/firestore';
import { Activity, Dumbbell, Navigation, Plus, History, Trash2 } from 'lucide-react';
import { useRunTracker } from './hooks/useRunTracker.js';
import { subscribeRuns, deleteRun } from './services/runsService.js';
import { formatDuration } from './utils/gpsMath.js';
import RunTrackerView from './components/RunTrackerView.jsx';
import RunDetailModal from './components/RunDetailModal.jsx';
import ExerciseGoalsSection, {
  DEFAULT_EXERCISES,
} from './components/ExerciseGoalsSection.jsx';

export default function App() {
  const targetCtx = useMemo(() => getTargetContext(), []);
  const tracker = useRunTracker(
    targetCtx.isTestMode
      ? {}
      : { filterOptions: { maxAccuracyMeters: 120, minJitterMeters: 1.2 } }
  );

  const [activeTab, setActiveTab] = useState('dashboard');
  const [data, setData] = useState({ logs: [] });
  const [gpsRuns, setGpsRuns] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);

  const [type, setType] = useState('cardio');
  const [value1, setValue1] = useState('');
  const [value2, setValue2] = useState('');
  const [installPrompt, setInstallPrompt] = useState(null);
  const [shareFlash, setShareFlash] = useState('');

  useEffect(() => {
    window.__PRIME_RUN_ACTIVE__ =
      tracker.status === 'recording' || tracker.status === 'paused';
  }, [tracker.status]);

  useEffect(() => {
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  const handleInstallOrShare = async () => {
    if (installPrompt) {
      try {
        installPrompt.prompt();
        await installPrompt.userChoice;
        setInstallPrompt(null);
        return;
      } catch (_) {}
    }
    const cleanUrl = window.location.origin + window.location.pathname;
    const msg = `🏃‍♂️ PRIME · Tracker Deportivo GPS: ${cleanUrl}`;
    const flash = (txt) => {
      setShareFlash(txt);
      setTimeout(() => setShareFlash(''), 2400);
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(cleanUrl);
      }
    } catch (_) {}
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'PRIME · Tracker Deportivo GPS',
          text: 'Mi app personal de running y entrenamiento 🔥',
          url: cleanUrl,
        });
        flash('✅ Guardado');
        return;
      } catch (_) {}
    }
    try {
      window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
      flash('✅ Link copiado');
    } catch (_) {
      flash('✅ Link copiado');
    }
  };

  const handleForceUpdate = async () => {
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
    } catch (_) {}
    try {
      sessionStorage.clear();
    } catch (_) {}
    window.location.href =
      window.location.origin + window.location.pathname + '?v=' + Date.now();
  };

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

  const handleDeleteGpsRun = async (runId, e = null) => {
    if (e) e.stopPropagation();
    if (!runId) return;
    try {
      await deleteRun(runId, targetCtx);
      if (selectedRun?.id === runId) {
        setSelectedRun(null);
      }
    } catch (_) {}
  };

  const handleDeleteManualLog = async (logId) => {
    if (!logId) return;
    const nextLogs = (data.logs || []).filter((l) => l.id !== logId);
    await setDoc(
      doc(db, targetCtx.collectionName, targetCtx.athleteId),
      { logs: nextLogs },
      { merge: true }
    );
  };

  const handleUpdateExercise = async (exerciseId, patch) => {
    const currentList =
      Array.isArray(data.exercises) && data.exercises.length > 0
        ? data.exercises
        : DEFAULT_EXERCISES;

    const updatedExercises = currentList.map((ex) =>
      ex.id === exerciseId ? { ...ex, ...patch } : ex
    );

    const payload = { exercises: updatedExercises };

    if (Number.isFinite(patch.currentKg) && patch.currentKg > 0) {
      const targetEx = currentList.find((e) => e.id === exerciseId);
      const newLog = {
        id: Date.now().toString(),
        date: new Date().toISOString(),
        type:
          targetEx?.category === 'Tronco Superior' &&
          exerciseId === 'lat_pulldown'
            ? 'pull'
            : 'push',
        v1: patch.currentKg,
        v2: 15,
        notes: `${targetEx?.name || exerciseId}: ${patch.currentKg} kg`,
      };
      payload.logs = [newLog, ...(data.logs || [])];
    }

    await setDoc(
      doc(db, targetCtx.collectionName, targetCtx.athleteId),
      payload,
      { merge: true }
    );
  };

  const logs = data.logs || [];
  const manualLogs = logs.filter((l) => l?.source !== 'gps_pwa' && !l?.runId);

  const bestKm = Math.max(
    0,
    ...logs.filter((l) => l.type === 'cardio').map((l) => Number(l.v1) || 0),
    ...gpsRuns.map((r) => Number(r.distanceKm) || 0)
  );
  const exerciseKgs = Array.isArray(data.exercises)
    ? data.exercises
        .filter((e) => (e.unit || 'kg') === 'kg')
        .map((e) => Number(e.currentKg) || 0)
    : [];
  const bestKg = Math.max(
    0,
    ...logs.filter((l) => l.type === 'pull').map((l) => Number(l.v1) || 0),
    ...(targetCtx.isTestMode ? [] : exerciseKgs)
  );

  // Lógica de Fases Dinámicas (Gamificación: Meta 1 = 8 km -> Meta Final Prime = 19.6 km)
  let runTarget = targetCtx.isTestMode ? 5 : 8;
  let runPhase = targetCtx.isTestMode
    ? 'Fase 1 (Readaptación)'
    : 'Fase 1 (1er Objetivo: 8 km · Prime Final: 19.6 km)';
  if (targetCtx.isTestMode) {
    if (bestKm >= 5) {
      runTarget = 10;
      runPhase = 'Fase 2 (Normalización)';
    }
    if (bestKm >= 10) {
      runTarget = 19.6;
      runPhase = 'Fase 3 (El Prime)';
    }
  } else {
    if (bestKm >= 8) {
      runTarget = 19.6;
      runPhase = 'Fase Final (Rumbo al Prime: 19.6 km)';
    }
  }

  let pullTarget = targetCtx.isTestMode ? 40 : 60;
  let pullPhase = targetCtx.isTestMode
    ? 'Fase 1 (Readaptación)'
    : 'Fase 1.5 (Base 45 kg ➔ Meta 60-70 kg)';
  if (targetCtx.isTestMode) {
    if (bestKg >= 40) {
      pullTarget = 60;
      pullPhase = 'Fase 2 (Normalización)';
    }
    if (bestKg >= 60) {
      pullTarget = 80;
      pullPhase = 'Fase 3 (El Prime)';
    }
  } else {
    if (bestKg >= 60) {
      pullTarget = 85;
      pullPhase = 'Fase 2 (Rumbo al Prime: 85-100 kg)';
    }
  }

  const runPercent = Math.min((bestKm / runTarget) * 100, 100).toFixed(1);
  const pullPercent = Math.min((bestKg / pullTarget) * 100, 100).toFixed(1);

  return (
    <div className="container">
      <div className="header">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
          }}
        >
          <h1 data-testid="app-header" style={{ margin: 0 }}>
            Prime Tracker
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {targetCtx.isTestMode && (
              <span className="test-mode-badge" data-testid="test-mode-badge">
                TEST MODE
              </span>
            )}
            <button
              type="button"
              onClick={handleInstallOrShare}
              data-testid="pwa-share-install-btn"
              title="Instalar App o enviar a WhatsApp"
              style={{
                background: 'rgba(57, 255, 20, 0.14)',
                border: '1px solid rgba(57, 255, 20, 0.45)',
                color: '#39ff14',
                borderRadius: '10px',
                padding: '6px 10px',
                fontSize: '12px',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {shareFlash || (installPrompt ? '📲 Instalar' : '📲 App')}
            </button>
            <button
              type="button"
              onClick={handleForceUpdate}
              data-testid="pwa-force-update-btn"
              title="Recargar última versión limpia"
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.16)',
                color: '#fff',
                borderRadius: '10px',
                width: '32px',
                height: '32px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              🔄
            </button>
          </div>
        </div>
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

          <ExerciseGoalsSection
            exercises={data.exercises}
            onUpdateExercise={handleUpdateExercise}
          />
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
                  <div
                    key={run.id}
                    role="button"
                    tabIndex={0}
                    className="history-run-row"
                    data-testid={`history-run-item-${run.id}`}
                    onClick={() => setSelectedRun(run)}
                  >
                    <div className="history-run-top">
                      <span className="history-run-title">{run.title || 'Carrera GPS'}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="history-run-date">{dateLabel}</span>
                        <button
                          type="button"
                          aria-label="Eliminar carrera"
                          data-testid={`delete-run-btn-${run.id}`}
                          onClick={(e) => handleDeleteGpsRun(run.id, e)}
                          style={{
                            background: 'rgba(255, 51, 51, 0.14)',
                            border: '1px solid rgba(255, 51, 51, 0.45)',
                            color: '#ff4d4d',
                            borderRadius: '8px',
                            padding: '4px 8px',
                            fontSize: '11px',
                            fontWeight: 800,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <Trash2 size={13} />
                          Borrar
                        </button>
                      </div>
                    </div>
                    <div className="history-run-metrics">
                      <span className="history-run-dist">
                        {`${Number(run.distanceKm || 0).toFixed(2)} km`}
                      </span>
                      <span>{formatDuration(run.activeDurationSec || 0)}</span>
                      <span>{run.avgPaceFormatted || '--:-- /km'}</span>
                    </div>
                  </div>
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
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                  }}
                >
                  <div>
                    <span style={{ color: 'var(--primary)', textTransform: 'capitalize' }}>
                      {`${log.type}: `}
                    </span>
                    {`${log.v1} ${log.type === 'cardio' ? 'km' : 'kg'}`}
                  </div>
                  <button
                    type="button"
                    aria-label="Eliminar registro"
                    data-testid={`delete-log-btn-${log.id}`}
                    onClick={() => handleDeleteManualLog(log.id)}
                    style={{
                      background: 'rgba(255, 51, 51, 0.12)',
                      border: '1px solid rgba(255, 51, 51, 0.35)',
                      color: '#ff4d4d',
                      borderRadius: '8px',
                      padding: '4px 8px',
                      fontSize: '11px',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <Trash2 size={12} />
                    Borrar
                  </button>
                </div>
              ))}
            </div>
          )}

          {gpsRuns.length === 0 && manualLogs.length === 0 && (
            <div className="history-empty">Sin actividades registradas aún.</div>
          )}
        </div>
      )}

      <RunDetailModal
        run={selectedRun}
        onClose={() => setSelectedRun(null)}
        onDelete={(runId) => handleDeleteGpsRun(runId)}
      />

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
