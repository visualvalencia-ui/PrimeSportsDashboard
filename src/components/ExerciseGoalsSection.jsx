import React, { useState } from 'react';
import { Camera, Dumbbell, Check, ChevronDown, ChevronUp, Shield, Flame } from 'lucide-react';

export const DEFAULT_EXERCISES = [
  {
    id: 'leg_press',
    name: 'Prensa / Extensión de Cuádriceps (90°)',
    category: 'Tren Inferior',
    unit: 'kg',
    currentKg: 45,
    targetKg: 70,
    primeKg: 100,
    reps: '3x15',
    machinePhoto: './machines/leg_press.jpg',
    weightPhoto: './machines/leg_extension.jpg',
  },
  {
    id: 'leg_curl',
    name: 'Curl de Isquios Sentado (Hacia Abajo)',
    category: 'Tren Inferior',
    unit: 'kg',
    currentKg: 45,
    targetKg: 60,
    primeKg: 80,
    reps: '3x15',
    machinePhoto: './machines/leg_curl.jpg',
    weightPhoto: null,
  },
  {
    id: 'chest_press',
    name: 'Prensa de Pecho Sentada (Palmas)',
    category: 'Tren Superior',
    unit: 'kg',
    currentKg: 45,
    targetKg: 60,
    primeKg: 80,
    reps: '3x12',
    machinePhoto: './machines/chest_press.jpg',
    weightPhoto: null,
  },
  {
    id: 'lat_pulldown',
    name: 'Jalón al Pecho (Barra Larga)',
    category: 'Tren Superior',
    unit: 'kg',
    currentKg: 45,
    targetKg: 60,
    primeKg: 75,
    reps: '3x12',
    machinePhoto: './machines/lat_pulldown_wide.jpg',
    weightPhoto: null,
  },
  {
    id: 'triceps_pushdown',
    name: 'Tríceps en Polea Alta',
    category: 'Tren Superior',
    unit: 'kg',
    currentKg: 25,
    targetKg: 35,
    primeKg: 45,
    reps: '3x15',
    machinePhoto: './machines/triceps_polea.jpg',
    weightPhoto: null,
  },
  {
    id: 'biceps_cable',
    name: 'Bíceps en Polea Baja',
    category: 'Tren Superior',
    unit: 'kg',
    currentKg: 25,
    targetKg: 35,
    primeKg: 45,
    reps: '3x12',
    machinePhoto: './machines/biceps_polea.jpg',
    weightPhoto: null,
  },
  {
    id: 'farmers_walk',
    name: 'Paseo del Granjero (16m Ida y Vuelta)',
    category: 'Funcional & Agarre',
    unit: 'lbs',
    currentKg: 30,
    targetKg: 45,
    primeKg: 65,
    repsCount: 7,
    targetRepsCount: 10,
    repsUnitLabel: 'Vueltas (16m ida/vuelta)',
    reps: '7 vueltas × 16m',
    machinePhoto: './machines/farmers_walk.jpg',
    weightPhoto: null,
  },
  {
    id: 'dead_hang',
    name: 'Dead Hang (Colgado en Barra)',
    category: 'Funcional & Agarre',
    unit: 'seg',
    currentKg: 60,
    targetKg: 90,
    primeKg: 120,
    repsCount: 3,
    targetRepsCount: 4,
    repsUnitLabel: 'Series (Veces)',
    reps: '1 min (60s) × 3 veces',
    machinePhoto: './machines/dead_hang.jpg',
    weightPhoto: null,
  },
];

const BLOCK_THEMES = [
  {
    key: 'Tren Inferior',
    aliases: ['Tren Inferior', 'Pierna'],
    title: '🦵 Tren Inferior (Pierna)',
    subtitle: 'Cuádriceps e Isquiotibiales · Soporte para Running y Skate',
    accent: '#00f0ff',
    bgTint: 'rgba(0, 240, 255, 0.12)',
    borderTint: 'rgba(0, 240, 255, 0.38)',
    Icon: Shield,
  },
  {
    key: 'Tren Superior',
    aliases: ['Tren Superior', 'Tronco Superior'],
    title: '💪 Tren Superior (Torso y Poleas)',
    subtitle: 'Pecho, Espalda con Barra Larga, Tríceps y Bíceps',
    accent: '#39ff14',
    bgTint: 'rgba(57, 255, 20, 0.12)',
    borderTint: 'rgba(57, 255, 20, 0.38)',
    Icon: Dumbbell,
  },
  {
    key: 'Funcional & Agarre',
    aliases: ['Funcional & Agarre', 'Funcional'],
    title: '🔥 Funcional & Agarre (Granjero & Hang)',
    subtitle: 'Fuerza de agarre, trapecios y descompresión lumbar',
    accent: '#ffaa00',
    bgTint: 'rgba(255, 170, 0, 0.14)',
    borderTint: 'rgba(255, 170, 0, 0.42)',
    Icon: Flame,
  },
];

function compressImageFile(file, maxDim = 640, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Formato de imagen inválido'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function ExerciseGoalsSection({ exercises, onUpdateExercise }) {
  const list =
    Array.isArray(exercises) && exercises.length > 0
      ? exercises
      : DEFAULT_EXERCISES;

  const [expandedId, setExpandedId] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [zoomPhoto, setZoomPhoto] = useState(null);

  const getEdit = (ex) =>
    editValues[ex.id] || {
      currentKg: ex.currentKg,
      targetKg: ex.targetKg,
      repsCount: ex.repsCount ?? '',
    };

  const handleFieldChange = (ex, field, val) => {
    const current = getEdit(ex);
    setEditValues((prev) => ({
      ...prev,
      [ex.id]: {
        ...current,
        [field]: val,
      },
    }));
  };

  const handlePhotoUpload = async (ex, slot, file) => {
    if (!file) return;
    setSavingId(`${ex.id}_${slot}`);
    try {
      const dataUrl = await compressImageFile(file);
      await onUpdateExercise(ex.id, {
        [slot]: dataUrl,
        updatedAt: new Date().toISOString(),
      });
    } catch (_) {
      // ignore invalid file
    } finally {
      setSavingId(null);
    }
  };

  const handleSaveNumbers = async (ex) => {
    const current = getEdit(ex);
    const curNum = parseFloat(current.currentKg);
    const tarNum = parseFloat(current.targetKg);
    if (!Number.isFinite(curNum) || curNum <= 0) return;

    const patch = {
      currentKg: curNum,
      targetKg: Number.isFinite(tarNum) && tarNum > 0 ? tarNum : ex.targetKg,
      updatedAt: new Date().toISOString(),
    };

    if (ex.repsUnitLabel && current.repsCount !== '') {
      const rNum = parseInt(current.repsCount, 10);
      if (Number.isFinite(rNum) && rNum > 0) {
        patch.repsCount = rNum;
        if (ex.id === 'farmers_walk') {
          patch.reps = `${rNum} vueltas × 16m`;
        } else if (ex.id === 'dead_hang') {
          patch.reps = `${curNum}s × ${rNum} veces`;
        }
      }
    }

    setSavingId(ex.id);
    try {
      await onUpdateExercise(ex.id, patch);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div data-testid="card-exercise-goals">
      {BLOCK_THEMES.map((block) => {
        const blockExercises = list.filter((ex) =>
          block.aliases.includes(ex.category)
        );
        if (blockExercises.length === 0) return null;

        const blockAvgPct = (
          blockExercises.reduce((acc, ex) => {
            const p = Math.min(
              100,
              Math.max(0, ((Number(ex.currentKg) || 0) / (Number(ex.targetKg) || 1)) * 100)
            );
            return acc + p;
          }, 0) / blockExercises.length
        ).toFixed(1);

        return (
          <div
            key={block.key}
            className="card"
            style={{
              border: `1px solid ${block.borderTint}`,
              marginBottom: '16px',
            }}
          >
            {/* Cabecera del Bloque con su propia barra de progreso general */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '4px',
              }}
            >
              <div
                style={{
                  fontSize: '16px',
                  fontWeight: 900,
                  color: block.accent,
                }}
              >
                {block.title}
              </div>
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 900,
                  color: block.accent,
                  background: block.bgTint,
                  border: `1px solid ${block.borderTint}`,
                  padding: '3px 9px',
                  borderRadius: '999px',
                }}
              >
                {`${blockAvgPct}%`}
              </span>
            </div>
            <div style={{ fontSize: '11.5px', color: '#999', marginBottom: '8px' }}>
              {block.subtitle}
            </div>
            <div
              className="progress-container"
              style={{ height: '10px', marginBottom: '14px' }}
            >
              <div
                className="progress-bar"
                style={{
                  width: `${blockAvgPct}%`,
                  backgroundColor: block.accent,
                }}
              ></div>
            </div>

            {/* Ejercicios dentro de este bloque */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {blockExercises.map((ex) => {
                const unit = ex.unit || 'kg';
                const pct = Math.min(
                  100,
                  Math.max(
                    0,
                    ((Number(ex.currentKg) || 0) / (Number(ex.targetKg) || 1)) * 100
                  )
                ).toFixed(0);
                const isOpen = expandedId === ex.id;
                const edit = getEdit(ex);

                const primaryLabel =
                  unit === 'seg'
                    ? 'Tiempo (seg)'
                    : unit === 'lbs'
                      ? 'Peso (lbs)'
                      : 'Peso Actual (kg)';
                const targetLabel =
                  unit === 'seg'
                    ? 'Meta (seg)'
                    : unit === 'lbs'
                      ? 'Meta (lbs)'
                      : 'Meta Fase (kg)';

                return (
                  <div
                    key={ex.id}
                    data-testid={`exercise-goal-${ex.id}`}
                    style={{
                      background: '#131317',
                      border: isOpen
                        ? `1px solid ${block.accent}`
                        : '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '13px',
                      padding: '11px',
                    }}
                  >
                    <div
                      onClick={() => setExpandedId(isOpen ? null : ex.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '8px',
                          marginBottom: '5px',
                        }}
                      >
                        <div>
                          <span
                            style={{
                              fontSize: '10px',
                              textTransform: 'uppercase',
                              letterSpacing: '0.6px',
                              color: block.accent,
                              fontWeight: 800,
                              display: 'block',
                            }}
                          >
                            {ex.reps}
                          </span>
                          <div
                            style={{
                              fontSize: '14px',
                              fontWeight: 800,
                              color: '#fff',
                            }}
                          >
                            {ex.name}
                          </div>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          <span
                            style={{
                              fontSize: '11.5px',
                              fontWeight: 800,
                              color: block.accent,
                              background: block.bgTint,
                              padding: '3px 8px',
                              borderRadius: '8px',
                            }}
                          >
                            {pct}%
                          </span>
                          {isOpen ? (
                            <ChevronUp size={16} color="#888" />
                          ) : (
                            <ChevronDown size={16} color="#888" />
                          )}
                        </div>
                      </div>

                      <div
                        className="stat-row"
                        style={{ fontSize: '12px', marginBottom: '4px' }}
                      >
                        <span>
                          Actual:{' '}
                          <b style={{ color: '#fff' }}>
                            {ex.currentKg} {unit}
                            {ex.repsCount
                              ? ` · ${ex.repsCount} ${
                                  ex.id === 'farmers_walk' ? 'vueltas' : 'veces'
                                }`
                              : ''}
                          </b>
                        </span>
                        <span style={{ color: block.accent }}>
                          Meta:{' '}
                          <b>
                            {ex.targetKg} {unit}
                          </b>{' '}
                          <span style={{ color: '#777', fontSize: '11px' }}>
                            (Prime: {ex.primeKg} {unit})
                          </span>
                        </span>
                      </div>
                      <div
                        className="progress-container"
                        style={{ height: '6px' }}
                      >
                        <div
                          className="progress-bar"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: block.accent,
                          }}
                        ></div>
                      </div>
                    </div>

                    {isOpen && (
                      <div
                        style={{
                          marginTop: '12px',
                          paddingTop: '12px',
                          borderTop: '1px solid rgba(255,255,255,0.08)',
                        }}
                      >
                        {/* 2 Slots de Fotos: 1. Máquina/Ejercicio y 2. Peso/Registro */}
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
                            gap: '10px',
                            marginBottom: '12px',
                          }}
                        >
                          {/* FOTO 1: LA MÁQUINA / EJERCICIO */}
                          <div
                            style={{
                              background: '#0d0d10',
                              border: '1px solid rgba(255,255,255,0.12)',
                              borderRadius: '10px',
                              padding: '8px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '6px',
                            }}
                          >
                            <div
                              style={{
                                fontSize: '11px',
                                fontWeight: 800,
                                color: '#00f0ff',
                              }}
                            >
                              1. Foto Máquina
                            </div>
                            {ex.machinePhoto ? (
                              <img
                                src={ex.machinePhoto}
                                alt={ex.name}
                                onClick={() => setZoomPhoto(ex.machinePhoto)}
                                style={{
                                  width: '100%',
                                  height: '110px',
                                  objectFit: 'cover',
                                  borderRadius: '8px',
                                  cursor: 'pointer',
                                }}
                              />
                            ) : (
                              <div
                                style={{
                                  height: '110px',
                                  borderRadius: '8px',
                                  background: '#18181c',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  color: '#666',
                                  fontSize: '11px',
                                  textAlign: 'center',
                                  padding: '6px',
                                }}
                              >
                                Sin foto
                              </div>
                            )}
                            <label
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '5px',
                                background: 'rgba(0, 240, 255, 0.14)',
                                border: '1px solid rgba(0, 240, 255, 0.35)',
                                color: '#00f0ff',
                                borderRadius: '8px',
                                padding: '6px',
                                fontSize: '11px',
                                fontWeight: 800,
                                cursor: 'pointer',
                              }}
                            >
                              <Camera size={13} />
                              {savingId === `${ex.id}_machinePhoto`
                                ? 'Guardando...'
                                : 'Cambiar Foto'}
                              <input
                                type="file"
                                accept="image/*"
                                style={{ display: 'none' }}
                                onChange={(e) =>
                                  handlePhotoUpload(
                                    ex,
                                    'machinePhoto',
                                    e.target.files?.[0]
                                  )
                                }
                              />
                            </label>
                          </div>

                          {/* FOTO 2: EL PESO EN LA TORRE / MANCUERNA */}
                          <div
                            style={{
                              background: '#0d0d10',
                              border: `1px solid ${block.borderTint}`,
                              borderRadius: '10px',
                              padding: '8px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '6px',
                            }}
                          >
                            <div
                              style={{
                                fontSize: '11px',
                                fontWeight: 800,
                                color: block.accent,
                              }}
                            >
                              2. Foto Peso ({ex.currentKg} {unit})
                            </div>
                            {ex.weightPhoto ? (
                              <img
                                src={ex.weightPhoto}
                                alt={`Peso ${ex.name}`}
                                onClick={() => setZoomPhoto(ex.weightPhoto)}
                                style={{
                                  width: '100%',
                                  height: '110px',
                                  objectFit: 'cover',
                                  borderRadius: '8px',
                                  cursor: 'pointer',
                                }}
                              />
                            ) : (
                              <div
                                style={{
                                  height: '110px',
                                  borderRadius: '8px',
                                  background: '#18181c',
                                  border: `1px dashed ${block.borderTint}`,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  color: '#999',
                                  fontSize: '11px',
                                  textAlign: 'center',
                                  padding: '8px',
                                }}
                              >
                                <b style={{ color: '#fff', fontSize: '15px' }}>
                                  {ex.currentKg} {unit}
                                </b>
                                <span>
                                  {ex.repsCount
                                    ? `${ex.repsCount} ${
                                        ex.id === 'farmers_walk'
                                          ? 'vueltas (16m)'
                                          : 'series'
                                      }`
                                    : 'Sube foto de discos / pin'}
                                </span>
                              </div>
                            )}
                            <label
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '5px',
                                background: block.bgTint,
                                border: `1px solid ${block.borderTint}`,
                                color: block.accent,
                                borderRadius: '8px',
                                padding: '6px',
                                fontSize: '11px',
                                fontWeight: 800,
                                cursor: 'pointer',
                              }}
                            >
                              <Camera size={13} />
                              {savingId === `${ex.id}_weightPhoto`
                                ? 'Guardando...'
                                : 'Subir Foto Peso'}
                              <input
                                type="file"
                                accept="image/*"
                                style={{ display: 'none' }}
                                onChange={(e) =>
                                  handlePhotoUpload(
                                    ex,
                                    'weightPhoto',
                                    e.target.files?.[0]
                                  )
                                }
                              />
                            </label>
                          </div>
                        </div>

                        {/* Controles rápidos de Peso/Tiempo, Vueltas/Series y Meta */}
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: ex.repsUnitLabel
                              ? 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) auto'
                              : 'minmax(0, 1fr) minmax(0, 1fr) auto',
                            gap: '8px',
                            alignItems: 'end',
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <label
                              style={{
                                fontSize: '10.5px',
                                color: '#aaa',
                                display: 'block',
                                marginBottom: '3px',
                              }}
                            >
                              {primaryLabel}
                            </label>
                            <input
                              type="number"
                              step="0.5"
                              value={edit.currentKg}
                              onChange={(e) =>
                                handleFieldChange(ex, 'currentKg', e.target.value)
                              }
                              style={{
                                width: '100%',
                                minWidth: 0,
                                boxSizing: 'border-box',
                                padding: '8px 10px',
                                fontSize: '13px',
                                fontWeight: 800,
                              }}
                            />
                          </div>

                          {ex.repsUnitLabel && (
                            <div style={{ minWidth: 0 }}>
                              <label
                                style={{
                                  fontSize: '10.5px',
                                  color: block.accent,
                                  display: 'block',
                                  marginBottom: '3px',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                {ex.id === 'farmers_walk'
                                  ? 'Vueltas (16m)'
                                  : 'Series (Veces)'}
                              </label>
                              <input
                                type="number"
                                step="1"
                                value={edit.repsCount}
                                onChange={(e) =>
                                  handleFieldChange(ex, 'repsCount', e.target.value)
                                }
                                style={{
                                  width: '100%',
                                  minWidth: 0,
                                  boxSizing: 'border-box',
                                  padding: '8px 10px',
                                  fontSize: '13px',
                                  fontWeight: 800,
                                }}
                              />
                            </div>
                          )}

                          <div style={{ minWidth: 0 }}>
                            <label
                              style={{
                                fontSize: '10.5px',
                                color: '#aaa',
                                display: 'block',
                                marginBottom: '3px',
                              }}
                            >
                              {targetLabel}
                            </label>
                            <input
                              type="number"
                              step="0.5"
                              value={edit.targetKg}
                              onChange={(e) =>
                                handleFieldChange(ex, 'targetKg', e.target.value)
                              }
                              style={{
                                width: '100%',
                                minWidth: 0,
                                boxSizing: 'border-box',
                                padding: '8px 10px',
                                fontSize: '13px',
                                fontWeight: 800,
                              }}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => handleSaveNumbers(ex)}
                            style={{
                              background: block.accent,
                              color: '#000',
                              border: 'none',
                              borderRadius: '10px',
                              padding: '9px 12px',
                              fontWeight: 900,
                              fontSize: '12px',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <Check size={14} />
                            {savingId === ex.id ? '...' : 'OK'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Modal para ver foto ampliada */}
      {zoomPhoto && (
        <div
          onClick={() => setZoomPhoto(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.88)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <img
            src={zoomPhoto}
            alt="Vista ampliada"
            style={{
              maxWidth: '100%',
              maxHeight: '80vh',
              borderRadius: '14px',
              border: '2px solid var(--primary)',
            }}
          />
          <button
            type="button"
            onClick={() => setZoomPhoto(null)}
            style={{
              marginTop: '14px',
              background: 'var(--primary)',
              color: '#000',
              border: 'none',
              borderRadius: '999px',
              padding: '10px 24px',
              fontWeight: 900,
              cursor: 'pointer',
            }}
          >
            Cerrar Vista
          </button>
        </div>
      )}
    </div>
  );
}
