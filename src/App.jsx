import React, { useState, useEffect } from 'react';
import { db } from './firebase';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { Activity, Dumbbell, BedDouble, Plus, History, Flame } from 'lucide-react';

const TARGET_RUN_KM = 19.6;
const TARGET_PULL_KG = 80; // Su peso corporal para hacer dominadas

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [data, setData] = useState({ logs: [] });
  
  // Form State
  const [type, setType] = useState('cardio');
  const [value1, setValue1] = useState('');
  const [value2, setValue2] = useState('');
  
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "sports_prime", "camilo"), (docSnap) => {
      if (docSnap.exists()) {
        setData(docSnap.data());
      }
    });
    return () => unsub();
  }, []);

  const handleSave = async () => {
    if (!value1) return;
    
    const newLog = {
      id: Date.now().toString(),
      date: new Date().toISOString(),
      type,
      v1: parseFloat(value1),
      v2: value2 ? parseFloat(value2) : null
    };

    const newLogs = [newLog, ...(data.logs || [])];
    
    await setDoc(doc(db, "sports_prime", "camilo"), { logs: newLogs }, { merge: true });
    
    setValue1('');
    setValue2('');
    setActiveTab('dashboard');
  };

  // Calculations
  const logs = data.logs || [];
  
  const getBestCardio = () => {
    const cardioLogs = logs.filter(l => l.type === 'cardio');
    if (!cardioLogs.length) return 0;
    return Math.max(...cardioLogs.map(l => l.v1)); // km
  };

  const getBestPull = () => {
    const pullLogs = logs.filter(l => l.type === 'pull');
    if (!pullLogs.length) return 0;
    return Math.max(...pullLogs.map(l => l.v1)); // kg
  };

  const bestKm = getBestCardio();
  const bestKg = getBestPull();
  
  const runPercent = Math.min((bestKm / TARGET_RUN_KM) * 100, 100).toFixed(1);
  const pullPercent = Math.min((bestKg / TARGET_PULL_KG) * 100, 100).toFixed(1);

  return (
    <div className="container">
      <div className="header">
        <h1>Prime Tracker</h1>
      </div>

      {activeTab === 'dashboard' && (
        <>
          <div className="card">
            <div className="card-title">
              <Activity size={20} /> Base Aeróbica (Running)
            </div>
            <div className="stat-row">
              <span>Actual: {bestKm} km</span>
              <span style={{color: 'var(--primary)'}}>Meta: {TARGET_RUN_KM} km</span>
            </div>
            <div className="progress-container">
              <div className="progress-bar" style={{width: `${runPercent}%`}}></div>
            </div>
            <div style={{textAlign: 'right', fontSize: 12, marginTop: 4, color: 'var(--primary)'}}>{runPercent}%</div>
          </div>

          <div className="card">
            <div className="card-title">
              <Dumbbell size={20} /> Fuerza Relativa (Polea / Dominadas)
            </div>
            <div className="stat-row">
              <span>Actual: {bestKg} kg</span>
              <span style={{color: 'var(--primary)'}}>Meta: {TARGET_PULL_KG} kg</span>
            </div>
            <div className="progress-container">
              <div className="progress-bar" style={{width: `${pullPercent}%`}}></div>
            </div>
            <div style={{textAlign: 'right', fontSize: 12, marginTop: 4, color: 'var(--primary)'}}>{pullPercent}%</div>
          </div>
          
          <div className="card">
            <div className="card-title">
              <Flame size={20} /> Racha Actual
            </div>
            <h2 style={{color: 'var(--primary)', fontSize: '32px'}}>{logs.length} <span style={{fontSize: '16px', color: '#888'}}>entrenamientos</span></h2>
          </div>
        </>
      )}

      {activeTab === 'add' && (
        <div className="card">
          <div className="card-title"><Plus size={20}/> Registrar Actividad</div>
          
          <div className="input-group">
            <label>Tipo de Entrenamiento</label>
            <select value={type} onChange={e => setType(e.target.value)}>
              <option value="cardio">Cardio / Correr</option>
              <option value="pull">Fuerza Hale (Polea Pecho)</option>
              <option value="push">Fuerza Empuje (Prensa/Pecho)</option>
              <option value="recovery">Recuperación (Horas Sueño)</option>
            </select>
          </div>

          <div className="input-group">
            <label>
              {type === 'cardio' ? 'Distancia (Kilómetros)' : 
               type === 'recovery' ? 'Horas de Sueño' : 'Peso Levantado (KG)'}
            </label>
            <input type="number" step="0.1" value={value1} onChange={e => setValue1(e.target.value)} placeholder="Ej: 5.5" />
          </div>

          {(type === 'cardio' || type === 'pull' || type === 'push') && (
            <div className="input-group">
              <label>
                {type === 'cardio' ? 'Tiempo (Minutos)' : 'Repeticiones Max'}
              </label>
              <input type="number" value={value2} onChange={e => setValue2(e.target.value)} placeholder="Ej: 45" />
            </div>
          )}

          <button className="btn" onClick={handleSave}>Guardar Registro</button>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="card">
          <div className="card-title"><History size={20}/> Historial Reciente</div>
          {logs.slice(0,10).map(log => (
            <div key={log.id} style={{borderBottom: '1px solid #333', padding: '10px 0'}}>
              <div style={{color: 'var(--primary)', fontSize: '14px', textTransform: 'capitalize'}}>{log.type}</div>
              <div style={{fontSize: '18px'}}>
                {log.v1} {log.type === 'cardio' ? 'km' : log.type === 'recovery' ? 'horas' : 'kg'} 
                {log.v2 && <span style={{color: '#888', fontSize: '14px'}}> ({log.v2} {log.type === 'cardio' ? 'min' : 'reps'})</span>}
              </div>
              <div style={{fontSize: '12px', color: '#666'}}>{new Date(log.date).toLocaleDateString()}</div>
            </div>
          ))}
        </div>
      )}

      {/* Navegación Inferior */}
      <div className="nav-bar">
        <div className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
          <Activity size={24} /> Dashboard
        </div>
        <div className={`nav-item ${activeTab === 'add' ? 'active' : ''}`} onClick={() => setActiveTab('add')}>
          <Plus size={24} /> Registrar
        </div>
        <div className={`nav-item ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
          <History size={24} /> Historial
        </div>
      </div>
    </div>
  );
}
