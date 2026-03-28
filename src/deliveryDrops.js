/**
 * Delivery drop markers in Kowloon — motion matches drones: open path + ping-pong (see droneSim).
 */

import { corridorHeightAtPosition } from "./corridor3d.js";
import {
  pathMayIntersectNfz,
  pointInAnyNfz,
  positionOnOpenPathAvoidingNfz,
} from "./nfzGeometry.js";
import {
  MAP_DETAIL_BATTERY_PCT,
  nominalPathSpeedMps,
  pingPongOpenT,
  pointOnOpenPath,
} from "./droneSim.js";
import { fleetHexColor } from "./fleetVisual.js";
import {
  deliveryLandBoxesForBBox,
  pointInLandBoxes,
  randomLandPointOutsideNfz,
} from "./landSampling.js";
import {
  planRouteFromTo,
  polylineClear,
  segmentViolatesNfz,
} from "./routePlanner.js";

/** Urban Kowloon + margin — wider box so longer corridors fit before edge clamp. */
export const KOWLOON_DELIVERY_BBOX = [114.150, 22.280, 114.220, 22.345];

/** One style for every delivery dot (lines, circles, 3D corridors, popups). */
const DROP_VISUAL = { status: "normal", altM: 112, speedMps: 13 };

const DROP_SPEED_DT_MS = 110;

function dropLngLatAt(nowMs, route, nfzContext) {
  const t = nowMs / route.periodMs + route.phase;
  const along = pingPongOpenT(t);
  if (nfzContext && pathMayIntersectNfz(route.path, nfzContext)) {
    return positionOnOpenPathAvoidingNfz(route.path, along, nfzContext);
  }
  return pointOnOpenPath(route.path, along);
}

function dropGroundSpeedMps(nowMs, route, nfzContext) {
  const p1 = dropLngLatAt(nowMs, route, nfzContext);
  const t0 = Math.max(0, nowMs - DROP_SPEED_DT_MS);
  const p0 = dropLngLatAt(t0, route, nfzContext);
  const latRef = (p0[1] + p1[1]) / 2;
  const d = distM(p0, p1, latRef);
  const dtSec = (nowMs - t0) / 1000;
  let v = dtSec > 1e-6 ? d / dtSec : 0;
  if (v < 0.35 && nowMs < DROP_SPEED_DT_MS * 2) {
    v = nominalPathSpeedMps(route);
  }
  return v;
}

/** Shared leg cycle; phase spread by index so markers are not in sync. */
const DROP_PERIOD_MS = 82000;

function distM(a, b, latRef) {
  const mPerLat = 111320;
  const mPerLng = mPerLat * Math.cos((latRef * Math.PI) / 180);
  const dx = (b[0] - a[0]) * mPerLng;
  const dy = (b[1] - a[1]) * mPerLat;
  return Math.hypot(dx, dy);
}

function offsetFrom(from, distMeters, bearingRad, latRef) {
  const mPerLat = 111320;
  const mPerLng = mPerLat * Math.cos((latRef * Math.PI) / 180);
  const dxm = Math.sin(bearingRad) * distMeters;
  const dym = Math.cos(bearingRad) * distMeters;
  return [from[0] + dxm / mPerLng, from[1] + dym / mPerLat];
}

function clampToBBox(p, bbox) {
  return [
    Math.min(bbox[2], Math.max(bbox[0], p[0])),
    Math.min(bbox[3], Math.max(bbox[1], p[1])),
  ];
}

function chordInMeters(a, b) {
  const latRef = (a[1] + b[1]) / 2;
  const mPerLat = 111320;
  const mPerLng = mPerLat * Math.cos((latRef * Math.PI) / 180);
  const dxm = (b[0] - a[0]) * mPerLng;
  const dym = (b[1] - a[1]) * mPerLat;
  const len = Math.hypot(dxm, dym);
  return { latRef, mPerLng, mPerLat, dxm, dym, len };
}

function dedupeConsecutiveVertices(path) {
  const out = [];
  for (const p of path) {
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) {
      out.push([p[0], p[1]]);
    }
  }
  return out;
}

/** True if the polyline is a single straight run (or duplicate verts). */
function isSingleSegmentOpenPath(path) {
  const d = dedupeConsecutiveVertices(path);
  return d.length <= 2;
}

function polylineClearLocal(path, nfzContext) {
  if (!path || path.length < 2) return false;
  if (!nfzContext?.polygons?.length) return true;
  for (let i = 0; i < path.length - 1; i++) {
    if (segmentViolatesNfz(path[i], path[i + 1], nfzContext)) return false;
  }
  return true;
}

/**
 * Turn a straight chord into a 2-corner corridor inside bbox (like NFZ-detour polylines).
 */
function tryDoubleBendPath(a, b, bbox, nfzContext, rand) {
  const { mPerLng, mPerLat, dxm, dym, len } = chordInMeters(a, b);
  if (len < 110) return null;
  const ux = dxm / len;
  const uy = dym / len;
  const px = -uy;
  const py = ux;
  for (let attempt = 0; attempt < 48; attempt++) {
    const s1 = attempt % 2 === 0 ? 1 : -1;
    const s2 = attempt % 4 < 2 ? 1 : -1;
    const o1 = (28 + rand() * 95) * s1;
    const o2 = (35 + rand() * 95) * s2 * -1;
    const t1 = 0.32 + rand() * 0.1;
    const t2 = 0.62 + rand() * 0.1;
    const m1x = dxm * t1 + px * o1;
    const m1y = dym * t1 + py * o1;
    const m2x = dxm * t2 + px * o2;
    const m2y = dym * t2 + py * o2;
    const p1 = clampToBBox(
      [a[0] + m1x / mPerLng, a[1] + m1y / mPerLat],
      bbox
    );
    const p2 = clampToBBox(
      [a[0] + m2x / mPerLng, a[1] + m2y / mPerLat],
      bbox
    );
    if (nfzContext?.polygons?.length) {
      if (pointInAnyNfz(p1[0], p1[1], nfzContext)) continue;
      if (pointInAnyNfz(p2[0], p2[1], nfzContext)) continue;
    }
    const path = [
      [a[0], a[1]],
      [p1[0], p1[1]],
      [p2[0], p2[1]],
      [b[0], b[1]],
    ];
    if (!polylineClearLocal(path, nfzContext)) continue;
    return path;
  }
  return null;
}

function trySingleBendPath(a, b, bbox, nfzContext, rand, minLenM = 55) {
  const { mPerLng, mPerLat, dxm, dym, len } = chordInMeters(a, b);
  if (len < minLenM) return null;
  const ux = dxm / len;
  const uy = dym / len;
  const px = -uy;
  const py = ux;
  for (let attempt = 0; attempt < 40; attempt++) {
    const side = attempt % 2 === 0 ? 1 : -1;
    const off = (22 + rand() * 110) * side;
    const m1x = dxm * 0.5 + px * off;
    const m1y = dym * 0.5 + py * off;
    const mid = clampToBBox(
      [a[0] + m1x / mPerLng, a[1] + m1y / mPerLat],
      bbox
    );
    if (nfzContext?.polygons?.length && pointInAnyNfz(mid[0], mid[1], nfzContext)) {
      continue;
    }
    const path = [
      [a[0], a[1]],
      [mid[0], mid[1]],
      [b[0], b[1]],
    ];
    if (!polylineClearLocal(path, nfzContext)) continue;
    return path;
  }
  return null;
}

/**
 * Prefer planner polylines; if the route is one straight span, add in-bounds bends
 * so it matches multi-leg drone corridors visually.
 */
function finalizeCorridorPath(path, from, to, bbox, nfzContext, rand) {
  const a = [from[0], from[1]];
  const b = [to[0], to[1]];
  let pts = (path || []).map((c) => [c[0], c[1]]);
  if (pts.length < 2) return null;
  pts[0] = [...a];
  pts[pts.length - 1] = [...b];

  if (!polylineClear(pts, nfzContext)) return null;

  if (!isSingleSegmentOpenPath(pts)) {
    return pts;
  }

  const bent =
    tryDoubleBendPath(a, b, bbox, nfzContext, rand) ||
    trySingleBendPath(a, b, bbox, nfzContext, rand, 55) ||
    trySingleBendPath(a, b, bbox, nfzContext, rand, 35);

  if (bent) return bent;

  return pts.length >= 2 ? pts : null;
}

/**
 * @param {object|null} nfzContext
 * @param {[number,number,number,number]} [bbox]
 * @param {() => number} [rand]
 * @param {number} [count]
 */
function dropEndpointOk(cand, landBoxes, nfzContext) {
  if (!pointInLandBoxes(cand[0], cand[1], landBoxes)) return false;
  if (nfzContext?.polygons?.length && pointInAnyNfz(cand[0], cand[1], nfzContext)) {
    return false;
  }
  return true;
}

export function generateDeliveryDropRoutes(
  nfzContext,
  bbox = KOWLOON_DELIVERY_BBOX,
  rand = Math.random,
  count = 10
) {
  const landBoxes = deliveryLandBoxesForBBox(bbox);
  const routes = [];
  const minApartM = 130;
  const maxTries = 6000;
  let tries = 0;

  while (routes.length < count && tries < maxTries) {
    tries++;
    const from = randomLandPointOutsideNfz(landBoxes, nfzContext, rand);
    const okApart = routes.every(
      (r) => distM(from, r.from, from[1]) >= minApartM
    );
    if (!okApart) continue;

    let to = null;
    let path = null;
    for (let k = 0; k < 32; k++) {
      const cand = randomLandPointOutsideNfz(landBoxes, nfzContext, rand);
      if (distM(from, cand, from[1]) < 340) continue;
      const p = planRouteFromTo(from, cand, nfzContext, rand, bbox);
      if (p && polylineClear(p, nfzContext)) {
        to = cand;
        path = p;
        break;
      }
    }

    if (!path) {
      for (let k = 0; k < 42; k++) {
        const dist = 220 + rand() * 520;
        const br = rand() * Math.PI * 2;
        const cand = clampToBBox(offsetFrom(from, dist, br, from[1]), bbox);
        if (!dropEndpointOk(cand, landBoxes, nfzContext)) continue;
        const p = planRouteFromTo(from, cand, nfzContext, rand, bbox);
        if (p && polylineClear(p, nfzContext)) {
          to = cand;
          path = p;
          break;
        }
      }
    }

    if (!path) {
      for (let k = 0; k < 40; k++) {
        const dist = 120 + rand() * 220;
        const br = rand() * Math.PI * 2;
        const cand = clampToBBox(offsetFrom(from, dist, br, from[1]), bbox);
        if (!dropEndpointOk(cand, landBoxes, nfzContext)) continue;
        const p = planRouteFromTo(from, cand, nfzContext, rand, bbox);
        if (p && polylineClear(p, nfzContext)) {
          to = cand;
          path = p;
          break;
        }
      }
    }

    if (!path || !to) continue;

    path = finalizeCorridorPath(path, from, to, bbox, nfzContext, rand);
    if (!path || !polylineClear(path, nfzContext)) continue;

    const n = routes.length;
    routes.push({
      id: `DROP-${String(n + 1).padStart(2, "0")}`,
      label: `Drop ${n + 1}`,
      color: fleetHexColor(4 + n),
      status: DROP_VISUAL.status,
      altM: DROP_VISUAL.altM,
      speedMps: DROP_VISUAL.speedMps,
      closed: false,
      from: [...from],
      to: [...to],
      path: path.map((c) => [...c]),
      periodMs: DROP_PERIOD_MS,
      phase: (n * 0.6180339887498949) % 1,
    });
  }

  tries = 0;
  while (routes.length < count && tries < maxTries) {
    tries++;
    const from = randomLandPointOutsideNfz(landBoxes, nfzContext, rand);
    let to = null;
    let path = null;
    for (let k = 0; k < 26; k++) {
      const cand = randomLandPointOutsideNfz(landBoxes, nfzContext, rand);
      if (distM(from, cand, from[1]) < 240) continue;
      const p = planRouteFromTo(from, cand, nfzContext, rand, bbox);
      if (p && polylineClear(p, nfzContext)) {
        to = cand;
        path = p;
        break;
      }
    }
    if (!path) {
      for (let k = 0; k < 34; k++) {
        const dist = 140 + rand() * 340;
        const br = rand() * Math.PI * 2;
        const cand = clampToBBox(offsetFrom(from, dist, br, from[1]), bbox);
        if (!dropEndpointOk(cand, landBoxes, nfzContext)) continue;
        const p = planRouteFromTo(from, cand, nfzContext, rand, bbox);
        if (p && polylineClear(p, nfzContext)) {
          to = cand;
          path = p;
          break;
        }
      }
    }
    if (!path || !to) continue;

    path = finalizeCorridorPath(path, from, to, bbox, nfzContext, rand);
    if (!path || !polylineClear(path, nfzContext)) continue;

    const n = routes.length;
    routes.push({
      id: `DROP-${String(n + 1).padStart(2, "0")}`,
      label: `Drop ${n + 1}`,
      color: fleetHexColor(4 + n),
      status: DROP_VISUAL.status,
      altM: DROP_VISUAL.altM,
      speedMps: DROP_VISUAL.speedMps,
      closed: false,
      from: [...from],
      to: [...to],
      path: path.map((c) => [...c]),
      periodMs: DROP_PERIOD_MS,
      phase: (n * 0.6180339887498949) % 1,
    });
  }

  return routes;
}

export function deliveryDropRoutesToLineCollection(routes) {
  const list = Array.isArray(routes) && routes.length > 0 ? routes : [];
  return {
    type: "FeatureCollection",
    features: list.map((r) => ({
      type: "Feature",
      properties: { id: r.id, status: r.status, color: r.color },
      geometry: { type: "LineString", coordinates: [...r.path] },
    })),
  };
}

/**
 * Live position and UI fields for a selected drop (same math as buildDeliveryDropsGeoJSON).
 */
export function getDeliveryDropLiveState(nowMs, route, nfzContext) {
  const t = nowMs / route.periodMs + route.phase;
  const along = pingPongOpenT(t);
  const [lng, lat] = dropLngLatAt(nowMs, route, nfzContext);
  const cycleT = (((nowMs / route.periodMs + route.phase) % 1) + 1) % 1;
  const motionLabel =
    cycleT < 0.5 ? "→ Toward end" : "← Toward start";
  const speedGroundMps = dropGroundSpeedMps(nowMs, route, nfzContext);
  const nominalSpeedMps = nominalPathSpeedMps(route);
  return {
    dotKind: "drop",
    lng,
    lat,
    along,
    alongPct: Math.round(along * 100),
    motionLabel,
    periodMs: route.periodMs,
    label: route.label,
    id: route.id,
    status: route.status,
    altM: route.altM,
    speedMps: speedGroundMps,
    speedKmh: speedGroundMps * 3.6,
    nominalSpeedMps,
    batteryPct: MAP_DETAIL_BATTERY_PCT,
    isOpenLeg: true,
    from: route.from,
    to: route.to,
    corridorAltM: corridorHeightAtPosition(route, nowMs, lng, lat),
    updatedAt: new Date(),
  };
}

/**
 * Same motion as buildDroneGeoJSON for open routes (no inter-drone separation).
 */
export function buildDeliveryDropsGeoJSON(nowMs, routes, nfzContext) {
  const list = Array.isArray(routes) && routes.length > 0 ? routes : [];
  const features = list.map((r) => {
    const t = nowMs / r.periodMs + r.phase;
    const along = pingPongOpenT(t);
    let lng;
    let lat;
    if (nfzContext && pathMayIntersectNfz(r.path, nfzContext)) {
      [lng, lat] = positionOnOpenPathAvoidingNfz(r.path, along, nfzContext);
    } else {
      [lng, lat] = pointOnOpenPath(r.path, along);
    }
    const v = dropGroundSpeedMps(nowMs, r, nfzContext);
    return {
      type: "Feature",
      properties: {
        id: r.id,
        label: r.label,
        status: r.status,
        color: r.color,
        alt_m: r.altM,
        speed_mps: v,
        speed_kmh: v * 3.6,
        nominal_speed_mps: nominalPathSpeedMps(r),
        spec_speed_mps: r.speedMps,
        battery_pct: MAP_DETAIL_BATTERY_PCT,
        from_lng: r.from[0],
        from_lat: r.from[1],
        to_lng: r.to[0],
        to_lat: r.to[1],
      },
      geometry: { type: "Point", coordinates: [lng, lat] },
    };
  });
  return { type: "FeatureCollection", features };
}
