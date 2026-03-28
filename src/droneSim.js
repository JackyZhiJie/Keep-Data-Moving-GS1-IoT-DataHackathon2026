/**
 * Drone motion: closed patrol loops or open from→to legs (ping-pong).
 */

import {
  pathMayIntersectNfz,
  positionOnOpenPathAvoidingNfz,
  positionOnPathAvoidingNfz,
} from "./nfzGeometry.js";
import { generatePlannedDroneRoutes } from "./routePlanner.js";

function segmentLength(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

/** Push drone positions apart in meter space (few iterations; keeps overlaps rare on crossing paths). */
function separateLngLatPairs(positions, minSepM, latRef) {
  const mPerLat = 111320;
  const mPerLng = mPerLat * Math.cos((latRef * Math.PI) / 180);
  const work = positions.map((p) => [...p]);
  const n = work.length;
  const iters = 5;
  for (let iter = 0; iter < iters; iter++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = (work[j][0] - work[i][0]) * mPerLng;
        const dy = (work[j][1] - work[i][1]) * mPerLat;
        const d = Math.hypot(dx, dy);
        if (d >= minSepM || d < 1e-9) continue;
        const half = (minSepM - d) / 2 / d;
        const fx = dx * half;
        const fy = dy * half;
        work[i][0] -= fx / mPerLng;
        work[i][1] -= fy / mPerLat;
        work[j][0] += fx / mPerLng;
        work[j][1] += fy / mPerLat;
      }
    }
  }
  return work;
}

/** Closed loop; t in [0, 1). */
export function pointOnClosedPath(coords, t) {
  const n = coords.length;
  if (n < 2) return coords[0] ? [...coords[0]] : [0, 0];

  const segs = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const len = segmentLength(coords[i], coords[j]);
    segs.push({ i, j, len });
    total += len;
  }
  if (total <= 0) return [...coords[0]];

  let u = (((t % 1) + 1) % 1) * total;
  for (const s of segs) {
    if (s.len <= 0) continue;
    if (u <= s.len) {
      const f = u / s.len;
      const a = coords[s.i];
      const b = coords[s.j];
      return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])];
    }
    u -= s.len;
  }
  return [...coords[0]];
}

/** Open polyline start → end; t in [0, 1]. */
export function pointOnOpenPath(coords, t) {
  const n = coords.length;
  if (n < 2) return coords[0] ? [...coords[0]] : [0, 0];

  let total = 0;
  const lens = [];
  for (let i = 0; i < n - 1; i++) {
    const len = segmentLength(coords[i], coords[i + 1]);
    lens.push(len);
    total += len;
  }
  if (total <= 0) return [...coords[0]];

  let u = (((t % 1) + 1) % 1) * total;
  for (let i = 0; i < n - 1; i++) {
    const len = lens[i];
    if (len <= 0) continue;
    if (u <= len) {
      const f = u / len;
      const a = coords[i];
      const b = coords[i + 1];
      return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])];
    }
    u -= len;
  }
  return [...coords[n - 1]];
}

/** 0→1→0 along one leg (linear), using fractional time. */
export function pingPongOpenT(globalT) {
  const x = ((globalT % 1) + 1) % 1;
  return x < 0.5 ? x * 2 : 2 - x * 2;
}

/** Default routes before NFZ loads (straight-ish random legs). */
export const DRONE_ROUTES = generatePlannedDroneRoutes(null);

function rawDronePositions(nowMs, list, nfzContext) {
  return list.map((r) => {
    const t = nowMs / r.periodMs + r.phase;
    let lng;
    let lat;

    if (r.closed === false) {
      const along = pingPongOpenT(t);
      if (nfzContext && pathMayIntersectNfz(r.path, nfzContext)) {
        [lng, lat] = positionOnOpenPathAvoidingNfz(r.path, along, nfzContext);
      } else {
        [lng, lat] = pointOnOpenPath(r.path, along);
      }
    } else if (nfzContext && pathMayIntersectNfz(r.path, nfzContext)) {
      [lng, lat] = positionOnPathAvoidingNfz(r.path, t, nfzContext);
    } else {
      [lng, lat] = pointOnClosedPath(r.path, t);
    }

    return [lng, lat];
  });
}

/**
 * Live map position / motion for one drone (includes fleet separation, same as markers).
 */
export function getDroneLiveState(nowMs, droneId, routes, nfzContext) {
  const list = Array.isArray(routes) && routes.length > 0 ? routes : DRONE_ROUTES;
  const idx = list.findIndex((r) => r.id === droneId);
  if (idx < 0) return null;

  const raw = rawDronePositions(nowMs, list, nfzContext);
  const latRef =
    raw.reduce((s, p) => s + p[1], 0) / Math.max(1, raw.length);
  const separated = separateLngLatPairs(raw, 26, latRef);
  const [lng, lat] = separated[idx];
  const r = list[idx];
  const t = nowMs / r.periodMs + r.phase;

  let alongPct;
  let motionLabel;
  if (r.closed === false) {
    const along = pingPongOpenT(t);
    alongPct = Math.round(along * 100);
    const cycleT = (((nowMs / r.periodMs + r.phase) % 1) + 1) % 1;
    motionLabel = cycleT < 0.5 ? "→ Toward end" : "← Toward start";
  } else {
    const u = ((t % 1) + 1) % 1;
    alongPct = Math.round(u * 100);
    motionLabel = "↻ Patrol loop";
  }

  return {
    id: r.id,
    altM: r.altM,
    speedMps: r.speedMps,
    status: r.status,
    from: r.from,
    to: r.to,
    lng,
    lat,
    alongPct,
    motionLabel,
    periodMs: r.periodMs,
    isOpenLeg: r.closed === false,
    updatedAt: new Date(),
  };
}

export function buildDroneGeoJSON(nowMs, routes = DRONE_ROUTES, nfzContext = null) {
  const list = Array.isArray(routes) && routes.length > 0 ? routes : DRONE_ROUTES;
  const raw = rawDronePositions(nowMs, list, nfzContext);

  const latRef =
    raw.reduce((s, p) => s + p[1], 0) / Math.max(1, raw.length);
  const separated = separateLngLatPairs(raw, 26, latRef);

  const features = list.map((r, idx) => {
    const [lng, lat] = separated[idx];
    const props = {
      status: r.status,
      id: r.id,
      alt_m: r.altM,
      speed_mps: r.speedMps,
    };

    if (r.closed === false && r.from && r.to) {
      props.from_lng = r.from[0];
      props.from_lat = r.from[1];
      props.to_lng = r.to[0];
      props.to_lat = r.to[1];
    }

    return {
      type: "Feature",
      properties: props,
      geometry: { type: "Point", coordinates: [lng, lat] },
    };
  });

  return { type: "FeatureCollection", features };
}

export function routesToPathLineCollection(routes) {
  const list = Array.isArray(routes) && routes.length > 0 ? routes : DRONE_ROUTES;
  return {
    type: "FeatureCollection",
    features: list.map((r) => {
      const isClosed = r.closed !== false;
      const coords =
        isClosed && r.path.length > 0
          ? [...r.path, r.path[0]]
          : [...r.path];
      return {
        type: "Feature",
        properties: { id: r.id, status: r.status },
        geometry: { type: "LineString", coordinates: coords },
      };
    }),
  };
}
