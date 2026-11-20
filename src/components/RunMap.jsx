import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { normalizeSegments } from '../utils/gpsMath.js';

const DEFAULT_CENTER = [4.6016, -74.2227]; // Ciudad Verde, Soacha
const TILE_STREETS =
  'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const TILE_SATELLITE =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

function createDivIcon(innerClass, size) {
  const half = Math.round(size / 2);
  return L.divIcon({
    className: 'run-div-icon',
    html: `<span class="${innerClass}"></span>`,
    iconSize: [size, size],
    iconAnchor: [half, half],
  });
}

export default function RunMap({
  segments = [],
  currentPosition = null,
  mode = 'idle',
  height = '240px',
  className = '',
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const tileLayerRef = useRef(null);
  const layerGroupRef = useRef(null);
  const svgRendererRef = useRef(null);
  const [followUser, setFollowUser] = useState(true);
  const [mapStyle, setMapStyle] = useState('streets');
  const [idleGpsPos, setIdleGpsPos] = useState(null);

  // Re-enable auto-follow whenever entering live or idle tracking mode
  useEffect(() => {
    if (mode === 'live' || mode === 'idle') {
      setFollowUser(true);
    }
  }, [mode]);

  // Auto-locate user on idle when opening the "Correr" tab so map shows their real street anywhere
  useEffect(() => {
    if (
      mode !== 'idle' ||
      currentPosition ||
      typeof navigator === 'undefined' ||
      !navigator.geolocation ||
      new URLSearchParams(window.location.search).get('testCollection')
    ) {
      return undefined;
    }
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled || !pos?.coords) return;
        const { latitude, longitude, accuracy } = pos.coords;
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          setIdleGpsPos({ lat: latitude, lng: longitude, acc: accuracy });
        }
      },
      () => {},
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 }
    );
    return () => {
      cancelled = true;
    };
  }, [mode, currentPosition]);

  // Initialize Leaflet map once (React 18 StrictMode-safe cleanup)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const svgRenderer = L.svg({ padding: 0.5 });
    const map = L.map(el, {
      center: DEFAULT_CENTER,
      zoom: 16,
      zoomControl: false,
      attributionControl: true,
      preferCanvas: false,
      renderer: svgRenderer,
    });

    const tileLayer = L.tileLayer(TILE_STREETS, {
      subdomains: 'abcd',
      maxZoom: 19,
      attribution: '&copy; OSM &copy; CARTO',
    }).addTo(map);

    const layerGroup = L.layerGroup().addTo(map);

    mapRef.current = map;
    tileLayerRef.current = tileLayer;
    layerGroupRef.current = layerGroup;
    svgRendererRef.current = svgRenderer;

    const handleDragStart = () => {
      setFollowUser(false);
    };
    map.on('dragstart', handleDragStart);

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        if (mapRef.current) {
          mapRef.current.invalidateSize({ animate: false });
        }
      });
      resizeObserver.observe(el);
    }

    const initRaf = requestAnimationFrame(() => {
      if (mapRef.current) {
        mapRef.current.invalidateSize({ animate: false });
      }
    });
    const initTimer = setTimeout(() => {
      if (mapRef.current) {
        mapRef.current.invalidateSize({ animate: false });
      }
    }, 220);

    return () => {
      cancelAnimationFrame(initRaf);
      clearTimeout(initTimer);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      map.off('dragstart', handleDragStart);
      map.off();
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      layerGroupRef.current = null;
      svgRendererRef.current = null;
    };
  }, []);

  // Switch between High-Contrast Streets and Satellite
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }
    const url = mapStyle === 'satellite' ? TILE_SATELLITE : TILE_STREETS;
    const nextLayer = L.tileLayer(
      url,
      mapStyle === 'satellite'
        ? { maxZoom: 19, attribution: '&copy; Esri' }
        : { subdomains: 'abcd', maxZoom: 19, attribution: '&copy; OSM &copy; CARTO' }
    ).addTo(map);
    tileLayerRef.current = nextLayer;
  }, [mapStyle]);

  // Sync polylines, markers, and camera framing
  useEffect(() => {
    const map = mapRef.current;
    const layerGroup = layerGroupRef.current;
    const svgRenderer = svgRendererRef.current;
    if (!map || !layerGroup) return undefined;

    layerGroup.clearLayers();

    const normalizedSegments = normalizeSegments(segments);
    const allPoints = [];

    for (const seg of normalizedSegments) {
      for (const pt of seg) {
        allPoints.push(pt);
      }
      if (seg.length >= 2) {
        L.polyline(
          seg.map((pt) => [pt.lat, pt.lng]),
          {
            color: '#39ff14',
            weight: 5,
            opacity: 0.96,
            lineCap: 'round',
            lineJoin: 'round',
            fill: false,
            renderer: svgRenderer || undefined,
          }
        ).addTo(layerGroup);
      }
    }

    if (allPoints.length >= 1) {
      const startPt = allPoints[0];
      L.marker([startPt.lat, startPt.lng], {
        icon: createDivIcon('run-marker-start', 14),
        interactive: false,
      }).addTo(layerGroup);
    }

    if ((mode === 'summary' || mode === 'detail') && allPoints.length >= 2) {
      const endPt = allPoints[allPoints.length - 1];
      L.marker([endPt.lat, endPt.lng], {
        icon: createDivIcon('run-marker-end', 14),
        interactive: false,
      }).addTo(layerGroup);
    }

    const effectivePos =
      currentPosition &&
      Number.isFinite(currentPosition.lat) &&
      Number.isFinite(currentPosition.lng)
        ? currentPosition
        : idleGpsPos;

    if (mode === 'live' || mode === 'idle') {
      const livePt =
        effectivePos
          ? effectivePos
          : allPoints.length > 0
            ? allPoints[allPoints.length - 1]
            : null;

      if (livePt) {
        L.marker([livePt.lat, livePt.lng], {
          icon: createDivIcon('run-marker-live', 16),
          interactive: false,
        }).addTo(layerGroup);
      }
    }

    let rafId = null;
    let timerId = null;

    if (mode === 'summary' || mode === 'detail') {
      const fitRoute = () => {
        if (!mapRef.current) return;
        mapRef.current.invalidateSize({ animate: false });
        if (allPoints.length >= 2) {
          const bounds = L.latLngBounds(allPoints.map((p) => [p.lat, p.lng]));
          if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
            mapRef.current.setView(bounds.getCenter(), 16, { animate: false });
          } else {
            mapRef.current.fitBounds(bounds, {
              padding: [28, 28],
              maxZoom: 17,
              animate: false,
            });
          }
        } else if (allPoints.length === 1) {
          mapRef.current.setView([allPoints[0].lat, allPoints[0].lng], 16, {
            animate: false,
          });
        } else {
          mapRef.current.setView(DEFAULT_CENTER, 15, { animate: false });
        }
      };

      fitRoute();
      rafId = requestAnimationFrame(fitRoute);
      timerId = setTimeout(fitRoute, 120);
    } else if (followUser) {
      const target =
        effectivePos
          ? [effectivePos.lat, effectivePos.lng]
          : allPoints.length > 0
            ? [allPoints[allPoints.length - 1].lat, allPoints[allPoints.length - 1].lng]
            : DEFAULT_CENTER;

      const currentZoom = map.getZoom();
      map.setView(target, currentZoom >= 15 ? currentZoom : 16, { animate: false });
    }

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (timerId !== null) clearTimeout(timerId);
    };
  }, [segments, currentPosition, idleGpsPos, mode, followUser]);

  const handleRecenter = () => {
    setFollowUser(true);
    if (
      typeof navigator !== 'undefined' &&
      navigator.geolocation &&
      !new URLSearchParams(window.location.search).get('testCollection')
    ) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (pos?.coords) {
            setIdleGpsPos({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              acc: pos.coords.accuracy,
            });
          }
        },
        () => {},
        { enableHighAccuracy: true, timeout: 6000 }
      );
    }
  };

  const showRecenter = (mode === 'live' || mode === 'idle') && !followUser;

  return (
    <div
      className={`run-map-wrapper ${className}`.trim()}
      data-testid="run-map"
      style={{ height, minHeight: '240px', isolation: 'isolate', zIndex: 1 }}
    >
      <div
        ref={containerRef}
        className="run-map-canvas"
        style={{ width: '100%', height: height || '240px', minHeight: '240px' }}
      />
      <button
        type="button"
        onClick={() =>
          setMapStyle((prev) => (prev === 'streets' ? 'satellite' : 'streets'))
        }
        style={{
          position: 'absolute',
          top: '10px',
          left: '10px',
          zIndex: 500,
          background: 'rgba(13, 13, 16, 0.88)',
          border: '1px solid rgba(255,255,255,0.22)',
          color: '#fff',
          borderRadius: '8px',
          padding: '5px 10px',
          fontSize: '11px',
          fontWeight: 800,
          cursor: 'pointer',
        }}
      >
        {mapStyle === 'streets' ? '🛰️ Satélite' : '🗺️ Calles'}
      </button>
      {showRecenter && (
        <button
          type="button"
          className="map-recenter-btn"
          data-testid="map-recenter-btn"
          aria-label="Centrar mapa"
          onClick={handleRecenter}
        >
          Centrar
        </button>
      )}
    </div>
  );
}
