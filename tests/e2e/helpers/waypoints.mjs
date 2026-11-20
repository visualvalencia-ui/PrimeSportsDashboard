export const EARTH_RADIUS_METERS = 6371000;

export const CIUDAD_VERDE_DEFAULT_CENTER = Object.freeze({
  lat: 4.6016,
  lng: -74.2227,
});

export function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

export function haversineMeters(lat1, lon1, lat2, lon2) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

export function sumPathMeters(points) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += haversineMeters(
      points[i - 1].lat,
      points[i - 1].lng,
      points[i].lat,
      points[i].lng
    );
  }
  return total;
}

/**
 * Route A — Ciudad Verde Split Loop (1155.63 m active + 505.90 m / 507.90 m paused jump)
 * Derived from Agente_Deportivo/export_49092376/activities/10054908875.gpx
 */
export const ROUTE_A_SEG1 = Object.freeze([
  { id: 'A0', lat: 4.601630, lng: -74.222679, accuracy: 8 },
  { id: 'A1', lat: 4.602500, lng: -74.223100, accuracy: 8 },
  { id: 'A2', lat: 4.603356, lng: -74.223568, accuracy: 8 },
  { id: 'A3', lat: 4.603345, lng: -74.224600, accuracy: 8 },
  { id: 'A4', lat: 4.603332, lng: -74.225627, accuracy: 8 },
  { id: 'A5', lat: 4.603640, lng: -74.226700, accuracy: 8 },
]);

export const ROUTE_A_PAUSE_JUMP = Object.freeze({
  id: 'P_JUMP_1',
  lat: 4.607485,
  lng: -74.229140,
  accuracy: 8,
});

export const ROUTE_A_SEG2 = Object.freeze([
  { id: 'A6', lat: 4.607500, lng: -74.229150, accuracy: 8 },
  { id: 'A7', lat: 4.608700, lng: -74.229700, accuracy: 8 },
  { id: 'A8', lat: 4.609902, lng: -74.230134, accuracy: 8 },
  { id: 'A9', lat: 4.610000, lng: -74.229250, accuracy: 8 },
  { id: 'A10', lat: 4.610098, lng: -74.228382, accuracy: 8 },
  { id: 'A11', lat: 4.609940, lng: -74.227460, accuracy: 8 },
]);

export const ROUTE_A_SEG1_METERS = sumPathMeters(ROUTE_A_SEG1);
export const ROUTE_A_SEG2_METERS = sumPathMeters(ROUTE_A_SEG2);
export const ROUTE_A_ACTIVE_METERS = ROUTE_A_SEG1_METERS + ROUTE_A_SEG2_METERS; // 1155.63 m
export const ROUTE_A_JUMP_FROM_A5_METERS = haversineMeters(
  ROUTE_A_SEG1[ROUTE_A_SEG1.length - 1].lat,
  ROUTE_A_SEG1[ROUTE_A_SEG1.length - 1].lng,
  ROUTE_A_PAUSE_JUMP.lat,
  ROUTE_A_PAUSE_JUMP.lng
); // 505.90 m
export const ROUTE_A_A5_TO_A6_METERS = haversineMeters(
  ROUTE_A_SEG1[ROUTE_A_SEG1.length - 1].lat,
  ROUTE_A_SEG1[ROUTE_A_SEG1.length - 1].lng,
  ROUTE_A_SEG2[0].lat,
  ROUTE_A_SEG2[0].lng
); // 507.90 m

/**
 * Route B — Ciudad Verde 21-Point Full Loop (3260.45 m / 3.26 km, 3 splits)
 */
export const ROUTE_B = Object.freeze([
  { id: 'B00', lat: 4.601630, lng: -74.222679, accuracy: 8 },
  { id: 'B01', lat: 4.603335, lng: -74.223118, accuracy: 8 },
  { id: 'B02', lat: 4.603430, lng: -74.224720, accuracy: 8 },
  { id: 'B03', lat: 4.603436, lng: -74.226516, accuracy: 8 },
  { id: 'B04', lat: 4.604144, lng: -74.228194, accuracy: 8 },
  { id: 'B05', lat: 4.605211, lng: -74.229578, accuracy: 8 },
  { id: 'B06', lat: 4.607063, lng: -74.230271, accuracy: 8 },
  { id: 'B07', lat: 4.609104, lng: -74.230372, accuracy: 8 },
  { id: 'B08', lat: 4.610347, lng: -74.229486, accuracy: 8 },
  { id: 'B09', lat: 4.609723, lng: -74.228038, accuracy: 8 },
  { id: 'B10', lat: 4.609784, lng: -74.226501, accuracy: 8 },
  { id: 'B11', lat: 4.608733, lng: -74.225429, accuracy: 8 },
  { id: 'B12', lat: 4.608890, lng: -74.223631, accuracy: 8 },
  { id: 'B13', lat: 4.607674, lng: -74.222808, accuracy: 8 },
  { id: 'B14', lat: 4.606342, lng: -74.222168, accuracy: 8 },
  { id: 'B15', lat: 4.605138, lng: -74.222591, accuracy: 8 },
  { id: 'B16', lat: 4.605197, lng: -74.222750, accuracy: 8 },
  { id: 'B17', lat: 4.603642, lng: -74.222945, accuracy: 8 },
  { id: 'B18', lat: 4.601955, lng: -74.222915, accuracy: 8 },
  { id: 'B19', lat: 4.602780, lng: -74.223383, accuracy: 8 },
  { id: 'B20', lat: 4.602770, lng: -74.223311, accuracy: 8 },
]);

export const ROUTE_B_METERS = sumPathMeters(ROUTE_B); // 3260.45 m

/**
 * Route C — Micro-Edge Coordinates
 */
export const ROUTE_C = Object.freeze({
  c0: { id: 'c0', lat: 4.601630, lng: -74.222679, accuracy: 8 },
  c_jitter: { id: 'c_jitter', lat: 4.601635, lng: -74.222683, accuracy: 8 },     // 0.711 m (< 1.5 m)
  c_short: { id: 'c_short', lat: 4.601675, lng: -74.222679, accuracy: 8 },       // 5.004 m (< 10 m)
  c_teleport: { id: 'c_teleport', lat: 4.602200, lng: -74.222679, accuracy: 25 }, // 63.381 m (> 12 m/s at 1.5s, acc > 20)
  c_teleport_good_acc: { id: 'c_teleport_good_acc', lat: 4.602200, lng: -74.222679, accuracy: 8 },
});

export const ROUTE_C_JITTER_METERS = haversineMeters(
  ROUTE_C.c0.lat,
  ROUTE_C.c0.lng,
  ROUTE_C.c_jitter.lat,
  ROUTE_C.c_jitter.lng
);
export const ROUTE_C_SHORT_METERS = haversineMeters(
  ROUTE_C.c0.lat,
  ROUTE_C.c0.lng,
  ROUTE_C.c_short.lat,
  ROUTE_C.c_short.lng
);
export const ROUTE_C_TELEPORT_METERS = haversineMeters(
  ROUTE_C.c0.lat,
  ROUTE_C.c0.lng,
  ROUTE_C.c_teleport.lat,
  ROUTE_C.c_teleport.lng
);
