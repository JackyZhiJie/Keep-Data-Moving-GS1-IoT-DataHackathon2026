/**
 * Shortest obstacle-avoiding path on a lat/lng grid (Dijkstra).
 * "Best" = minimum total geodesic-ish edge length in the free graph (4-connected).
 */

import { pointInAnyNfz } from "./nfzGeometry.js";

function segmentSteps(a, b) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return Math.min(200, Math.max(40, Math.ceil(len / 0.00004)));
}

function segmentViolatesNfz(a, b, nfzContext) {
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

function polylineClear(path, nfzContext) {
  if (!nfzContext?.polygons?.length) return true;
  if (!path || path.length < 2) return true;
  for (let i = 0; i < path.length - 1; i++) {
    if (segmentViolatesNfz(path[i], path[i + 1], nfzContext)) return false;
  }
  return true;
}

function cellBlocked(
  i,
  j,
  minX,
  minY,
  cellW,
  cellH,
  nfzContext
) {
  const cx = minX + (i + 0.5) * cellW;
  const cy = minY + (j + 0.5) * cellH;
  if (pointInAnyNfz(cx, cy, nfzContext)) return true;
  const x0 = minX + i * cellW;
  const y0 = minY + j * cellH;
  const pts = [
    [x0 + 0.2 * cellW, y0 + 0.2 * cellH],
    [x0 + 0.8 * cellW, y0 + 0.2 * cellH],
    [x0 + 0.8 * cellW, y0 + 0.8 * cellH],
    [x0 + 0.2 * cellW, y0 + 0.8 * cellH],
  ];
  return pts.some((p) => pointInAnyNfz(p[0], p[1], nfzContext));
}

class MinHeap {
  constructor() {
    this.h = [];
  }
  push(n) {
    const a = this.h;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].g <= a[i].g) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.h;
    if (!a.length) return null;
    const out = a[0];
    const x = a.pop();
    if (a.length) {
      a[0] = x;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let s = i;
        if (l < a.length && a[l].g < a[s].g) s = l;
        if (r < a.length && a[r].g < a[s].g) s = r;
        if (s === i) break;
        [a[i], a[s]] = [a[s], a[i]];
        i = s;
      }
    }
    return out;
  }
  get length() {
    return this.h.length;
  }
}

const NEI4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function clampIJ(i, j, cols, rows) {
  return [
    Math.max(0, Math.min(cols - 1, i)),
    Math.max(0, Math.min(rows - 1, j)),
  ];
}

function toIJ(lng, lat, minX, minY, cellW, cellH, cols, rows) {
  let i = Math.floor((lng - minX) / cellW);
  let j = Math.floor((lat - minY) / cellH);
  return clampIJ(i, j, cols, rows);
}

function cellCenter(i, j, minX, minY, cellW, cellH) {
  return [minX + (i + 0.5) * cellW, minY + (j + 0.5) * cellH];
}

/**
 * Nearest free grid cell to (lng,lat) with a clear segment to `anchor` (from or to).
 */
function pickPortalCell(
  lng,
  lat,
  anchor,
  nfzContext,
  cols,
  rows,
  minX,
  minY,
  cellW,
  cellH,
  toAnchor
) {
  const [ci, cj] = toIJ(lng, lat, minX, minY, cellW, cellH, cols, rows);
  const maxR = Math.max(cols, rows) + 2;
  for (let r = 0; r < maxR; r++) {
    let best = null;
    let bestD = Infinity;
    for (let di = -r; di <= r; di++) {
      for (let dj = -r; dj <= r; dj++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || i >= cols || j < 0 || j >= rows) continue;
        if (cellBlocked(i, j, minX, minY, cellW, cellH, nfzContext)) continue;
        const c = cellCenter(i, j, minX, minY, cellW, cellH);
        const bad = toAnchor
          ? segmentViolatesNfz(c, anchor, nfzContext)
          : segmentViolatesNfz(anchor, c, nfzContext);
        if (bad) continue;
        const d = Math.hypot(c[0] - lng, c[1] - lat);
        if (d < bestD) {
          bestD = d;
          best = [i, j];
        }
      }
    }
    if (best) return best;
  }
  return null;
}

function shortcutPolyline(pts, nfzContext) {
  if (pts.length < 3) return pts;
  const out = [...pts];
  let guard = 0;
  while (out.length >= 3 && guard < out.length * out.length) {
    guard += 1;
    let cut = false;
    for (let i = 0; i < out.length - 2; i++) {
      if (!segmentViolatesNfz(out[i], out[i + 2], nfzContext)) {
        out.splice(i + 1, 1);
        cut = true;
        break;
      }
    }
    if (!cut) break;
  }
  return out;
}

/**
 * @returns {[number, number][] | null} polyline [from, ..., to] or null
 */
export function findBestGridPath(from, to, nfzContext, bbox) {
  if (!nfzContext?.polygons?.length) return [from, to];
  if (!segmentViolatesNfz(from, to, nfzContext)) return [from, to];

  const pad = 0.0035;
  let minX = Math.min(bbox[0], from[0], to[0]) - pad;
  let minY = Math.min(bbox[1], from[1], to[1]) - pad;
  let maxX = Math.max(bbox[2], from[0], to[0]) + pad;
  let maxY = Math.max(bbox[3], from[1], to[1]) + pad;

  const midLat = (minY + maxY) / 2;
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((midLat * Math.PI) / 180);
  const wM = (maxX - minX) * mPerDegLng;
  const hM = (maxY - minY) * mPerDegLat;
  const targetM = 38;
  let cols = Math.ceil(wM / targetM);
  let rows = Math.ceil(hM / targetM);
  cols = Math.min(96, Math.max(20, cols));
  rows = Math.min(96, Math.max(20, rows));

  const cellW = (maxX - minX) / cols;
  const cellH = (maxY - minY) / rows;

  const blocked = (i, j) =>
    cellBlocked(i, j, minX, minY, cellW, cellH, nfzContext);

  const start = pickPortalCell(
    from[0],
    from[1],
    from,
    nfzContext,
    cols,
    rows,
    minX,
    minY,
    cellW,
    cellH,
    false
  );
  const goal = pickPortalCell(
    to[0],
    to[1],
    to,
    nfzContext,
    cols,
    rows,
    minX,
    minY,
    cellW,
    cellH,
    true
  );

  if (!start || !goal) return null;

  const [si, sj] = start;
  const [gi, gj] = goal;

  const dist = new Map();
  const parent = new Map();
  const heap = new MinHeap();
  const sk = `${si},${sj}`;
  dist.set(sk, 0);
  heap.push({ i: si, j: sj, g: 0 });

  while (heap.length) {
    const { i, j, g } = heap.pop();
    const k = `${i},${j}`;
    if (g !== dist.get(k)) continue;
    if (i === gi && j === gj) {
      const centers = [];
      let cur = k;
      while (cur) {
        const [ci, cj] = cur.split(",").map(Number);
        centers.push(cellCenter(ci, cj, minX, minY, cellW, cellH));
        cur = parent.get(cur) ?? null;
      }
      centers.reverse();

      let path = [from, ...centers, to];
      if (!polylineClear(path, nfzContext)) return null;
      path = shortcutPolyline(path, nfzContext);
      if (!polylineClear(path, nfzContext)) return null;
      return path;
    }

    const c0 = cellCenter(i, j, minX, minY, cellW, cellH);
    for (const [di, dj] of NEI4) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || ni >= cols || nj < 0 || nj >= rows) continue;
      if (blocked(ni, nj)) continue;
      const c1 = cellCenter(ni, nj, minX, minY, cellW, cellH);
      const w = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]);
      const ng = g + w;
      const nk = `${ni},${nj}`;
      if (!dist.has(nk) || ng < dist.get(nk)) {
        dist.set(nk, ng);
        parent.set(nk, k);
        heap.push({ i: ni, j: nj, g: ng });
      }
    }
  }

  return null;
}
