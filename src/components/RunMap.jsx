import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { normalizeSegments } from '../utils/gpsMath.js';

const DEFAULT_CENTER = [4.6016, -74.2227]; // Ciudad Verde, Soacha
const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

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
  const layerGroupRef = useRef(null);
  const svgRendererRef = useRef(null);
  const [followUser, setFollowUser] = useState(true);

  // Re-enable auto-follow whenever entering live or idle tracking mode
  useEffect(() => {
    if (mode === 'live' || mode === 'idle') {
      setFollowUser(true);
    }
  }, [mode]);

  // Initialize Leaflet map once (React 18 StrictMode-safe cleanup)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const svgRenderer = L.svg({ padding: 0.5 });
    const map = L.map(el, {
      center: DEFAULT_CENTER,
      zoom: 15,
      zoomControl: false,
      attributionControl: true,
      preferCanvas: false,
      renderer: svgRenderer,
    });

    L.tileLayer(TILE_URL, {
      subdomains: 'abcd',
      maxZoom: 19,
      attribution: '&copy; OSM &copy; CARTO',
    }).addTo(map);

    const layerGroup = L.layerGroup().addTo(map);

    mapRef.current = map;
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

    return () => {
      cancelAnimationFrame(initRaf);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      map.off('dragstart', handleDragStart);
      map.off();
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
      svgRendererRef.current = null;
    };
  }, []);

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
            weight: 4,
            opacity: 0.95,
            lineCap: 'round',
            lineJoin: 'round',
            fill: false,
            renderer: svgRenderer || undefined,
          }
        ).addTo(layerGroup);
      }
    }

    // Inline divIcon markers (zero external <img> marker URLs)
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

    if (mode === 'live' || mode === 'idle') {
      const livePt =
        currentPosition &&
        Number.isFinite(currentPosition.lat) &&
        Number.isFinite(currentPosition.lng)
          ? currentPosition
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
        currentPosition &&
        Number.isFinite(currentPosition.lat) &&
        Number.isFinite(currentPosition.lng)
          ? [currentPosition.lat, currentPosition.lng]
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
  }, [segments, currentPosition, mode, followUser]);

  const handleRecenter = () => {
    setFollowUser(true);
  };

  const showRecenter = (mode === 'live' || mode === 'idle') && !followUser;

  return (
    <div
      className={`run-map-wrapper ${className}`.trim()}
      data-testid="run-map"
      style={{ height, minHeight: '240px', isolation: 'isolate', zIndex: 1 }}
    >
      <div ref={containerRef} className="run-map-canvas" />
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
