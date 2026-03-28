/**
 * Auto-plot low-altitude routes from random from/to, staying out of NFZ (with detours).
 */

import { findBestGridPath } from "./pathfindingGrid.js";
import { pointInAnyNfz } from "./nfzGeometry.js";

/** Operational box: Victoria Harbour / Central–Wan Chai (slightly wider for longer legs). */
export const DEFAULT_FLIGHT_BBOX = [114.136, 22.262, 114.200, 22.304];

function distApproxM(a, b) {
  const latRef = (a[1] + b[1]) / 2;
  const mPerLat = 111320;
  const mPerLng = mPerLat * Math.cos((latRef * Math.PI) / 180);
  return Math.hypot((b[0] - a[0]) * mPerLng, (b[1] - a[1]) * mPerLat);
}

function randomInBBox(bbox, rand) {
  return [
    bbox[0] + rand() * (bbox[2] - bbox[0]),
    bbox[1] + rand() * (bbox[3] - bbox[1]),
  ];
}

export function randomPointOutsideNfz(bbox, nfzContext, rand, maxTries = 100) {
  for (let i = 0; i < maxTries; i++) {
    const p = randomInBBox(bbox, rand);
    if (!nfzContext?.polygons?.length || !pointInAnyNfz(p[0], p[1], nfzContext)) {
      return p;
    }
  }
  return randomInBBox(bbox, rand);
}

function segmentSteps(a, b) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return Math.min(200, Math.max(48, Math.ceil(len / 0.00004)));
}

/** Sample segment [a,b] for NFZ interior. */
export function segmentViolatesNfz(a, b, nfzContext) {
  if (!nfzContext?.polygons?.length) return false;
  const steps = segmentSteps(a, b);
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const x = a[0] + f * (b[0] - a[0]);
    const y = a[1] + f * (b[1] - a[1]);
    if (pointInAnyNfz(x, y, nfzContext)) return true;
  }
  return false;
}

export function polylineClear(path, nfzContext) {
  if (!nfzContext?.polygons?.length) return true;
  if (!path || path.length < 2) return true;
  for (let i = 0; i < path.length - 1; i++) {
    if (segmentViolatesNfz(path[i], path[i + 1], nfzContext)) return false;
  }
  return true;
}

function addUniqueSafePoint(pts, seen, p, nfzContext) {
  const key = `${p[0].toFixed(4)}_${p[1].toFixed(4)}`;
  if (seen.has(key)) return;
  if (pointInAnyNfz(p[0], p[1], nfzContext)) return;
  seen.add(key);
  pts.push(p);
}

/**
 * Deterministic detour anchors: padded corners around each NFZ bbox + flight-area border.
 */
function collectDetourCandidates(nfzContext, bbox, pad = 0.0012) {
  const pts = [];
  const seen = new Set();

  for (const poly of nfzContext.polygons) {
    const [minX, minY, maxX, maxY] = poly.bbox;
    const corners = [
      [minX - pad, minY - pad],
      [maxX + pad, minY - pad],
      [maxX + pad, maxY + pad],
      [minX - pad, maxY + pad],
    ];
    corners.forEach((c) => addUniqueSafePoint(pts, seen, c, nfzContext));

    const mx = (minX + maxX) / 2;
    const my = (minY + maxY) / 2;
    addUniqueSafePoint(pts, seen, [mx, minY - pad], nfzContext);
    addUniqueSafePoint(pts, seen, [mx, maxY + pad], nfzContext);
    addUniqueSafePoint(pts, seen, [minX - pad, my], nfzContext);
    addUniqueSafePoint(pts, seen, [maxX + pad, my], nfzContext);
  }

  const [bx0, by0, bx1, by1] = bbox;
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    addUniqueSafePoint(pts, seen, [bx0 + t * (bx1 - bx0), by0], nfzContext);
    addUniqueSafePoint(pts, seen, [bx0 + t * (bx1 - bx0), by1], nfzContext);
    addUniqueSafePoint(pts, seen, [bx0, by0 + t * (by1 - by0)], nfzContext);
    addUniqueSafePoint(pts, seen, [bx1, by0 + t * (by1 - by0)], nfzContext);
  }

  return pts;
}

/**
 * Returns a polyline from → to with all segments clear of NFZ, or null if not found.
 * Never returns a knowingly violating straight segment.
 */
export function planRouteFromTo(from, to, nfzContext, rand, bbox = DEFAULT_FLIGHT_BBOX) {
  if (!nfzContext?.polygons?.length) {
    return [from, to];
  }

  if (!segmentViolatesNfz(from, to, nfzContext)) {
    return [from, to];
  }

  const gridPath = findBestGridPath(from, to, nfzContext, bbox);
  if (gridPath && gridPath.length >= 2 && polylineClear(gridPath, nfzContext)) {
    return gridPath;
  }

  const candidates = collectDetourCandidates(nfzContext, bbox);

  for (const w of candidates) {
    const one = [from, w, to];
    if (polylineClear(one, nfzContext)) return one;
  }

  const maxPairs = Math.min(candidates.length, 28);
  for (let i = 0; i < maxPairs; i++) {
    for (let j = i + 1; j < maxPairs; j++) {
      const two = [from, candidates[i], candidates[j], to];
      if (polylineClear(two, nfzContext)) return two;
    }
  }

  const mx = (from[0] + to[0]) / 2;
  const my = (from[1] + to[1]) / 2;

  for (let attempt = 0; attempt < 400; attempt++) {
    const ang = rand() * Math.PI * 2;
    const dist = 0.0002 + rand() * 0.012;
    const mid = [mx + Math.cos(ang) * dist, my + Math.sin(ang) * dist];
    if (pointInAnyNfz(mid[0], mid[1], nfzContext)) continue;
    const one = [from, mid, to];
    if (polylineClear(one, nfzContext)) return one;
  }

  for (let attempt = 0; attempt < 400; attempt++) {
    const a1 = rand() * Math.PI * 2;
    const a2 = rand() * Math.PI * 2;
    const d1 = 0.0003 + rand() * 0.01;
    const d2 = 0.0003 + rand() * 0.01;
    const q1 = [
      from[0] * 0.72 + to[0] * 0.28 + Math.cos(a1) * d1,
      from[1] * 0.72 + to[1] * 0.28 + Math.sin(a1) * d1,
    ];
    const q2 = [
      from[0] * 0.28 + to[0] * 0.72 + Math.cos(a2) * d2,
      from[1] * 0.28 + to[1] * 0.72 + Math.sin(a2) * d2,
    ];
    if (pointInAnyNfz(q1[0], q1[1], nfzContext)) continue;
    if (pointInAnyNfz(q2[0], q2[1], nfzContext)) continue;
    const two = [from, q1, q2, to];
    if (polylineClear(two, nfzContext)) return two;
  }

  return null;
}

const DRONE_META = [
  { id: "D-01", status: "normal", periodMs: 82000, phase: 0, altM: 118, speedMps: 14 },
  { id: "D-02", status: "warning", periodMs: 96000, phase: 0.17, altM: 95, speedMps: 11 },
  { id: "D-03", status: "alert", periodMs: 70000, phase: 0.41, altM: 132, speedMps: 16 },
  { id: "D-04", status: "normal", periodMs: 88000, phase: 0.08, altM: 105, speedMps: 13 },
];

/**
 * Planned open routes — only returns paths that pass polylineClear when NFZ exists.
 */
export function generatePlannedDroneRoutes(nfzContext, bbox = DEFAULT_FLIGHT_BBOX, rand = Math.random) {
  return DRONE_META.map((d) => {
    if (!nfzContext?.polygons?.length) {
      for (let i = 0; i < 72; i++) {
        const from = randomPointOutsideNfz(bbox, nfzContext, rand);
        const to = randomPointOutsideNfz(bbox, nfzContext, rand);
        if (distApproxM(from, to) < 380) continue;
        return { ...d, closed: false, from, to, path: [from, to] };
      }
      const from = randomPointOutsideNfz(bbox, nfzContext, rand);
      const to = randomPointOutsideNfz(bbox, nfzContext, rand);
      return { ...d, closed: false, from, to, path: [from, to] };
    }

    let from;
    let to;
    let path = null;

    for (let outer = 0; outer < 320; outer++) {
      from = randomPointOutsideNfz(bbox, nfzContext, rand);
      to = randomPointOutsideNfz(bbox, nfzContext, rand);
      if (distApproxM(from, to) < 420) continue;
      path = planRouteFromTo(from, to, nfzContext, rand, bbox);
      if (path && polylineClear(path, nfzContext)) {
        return { ...d, closed: false, from, to, path };
      }
    }

    for (let outer = 0; outer < 120; outer++) {
      from = randomPointOutsideNfz(bbox, nfzContext, rand);
      to = randomPointOutsideNfz(bbox, nfzContext, rand);
      path = planRouteFromTo(from, to, nfzContext, rand, bbox);
      if (path && polylineClear(path, nfzContext)) {
        return { ...d, closed: false, from, to, path };
      }
    }

    const cands = collectDetourCandidates(nfzContext, bbox);
    const cap = Math.min(cands.length, 32);
    for (let i = 0; i < cap; i++) {
      for (let j = 0; j < cap; j++) {
        if (i === j) continue;
        const a = cands[i];
        const b = cands[j];
        if (!segmentViolatesNfz(a, b, nfzContext)) {
          return { ...d, closed: false, from: a, to: b, path: [a, b] };
        }
        const p = planRouteFromTo(a, b, nfzContext, rand, bbox);
        if (p && polylineClear(p, nfzContext)) {
          return { ...d, closed: false, from: a, to: b, path: p };
        }
      }
    }

    const p0 = cands[0] ?? randomPointOutsideNfz(bbox, nfzContext, rand);
    const p1 = [p0[0] + 0.0002, p0[1] + 0.0002];
    if (!pointInAnyNfz(p1[0], p1[1], nfzContext)) {
      return { ...d, closed: false, from: p0, to: p1, path: [p0, p1] };
    }

    return { ...d, closed: false, from: p0, to: p0, path: [p0, [p0[0] + 1e-6, p0[1] + 1e-6]] };
  });
}
