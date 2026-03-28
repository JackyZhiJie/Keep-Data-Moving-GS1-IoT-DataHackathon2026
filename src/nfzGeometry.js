/**
 * No-fly zones: point-in-polygon + decimated rings for huge GeoJSON files.
 * Coordinates are [lng, lat] (GeoJSON order); Z is stripped if present.
 */

function stripZ(c) {
  return [Number(c[0]), Number(c[1])];
}

/** Keep at most maxPts vertices (evenly spaced) for fast PIP checks. */
function decimateRing(ring, maxPts = 350) {
  if (!ring?.length) return [];
  const flat = ring.map(stripZ).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (flat.length <= maxPts) return flat;
  const out = [];
  const step = (flat.length - 1) / maxPts;
  for (let i = 0; i < maxPts; i++) {
    out.push(flat[Math.min(flat.length - 1, Math.floor(i * step))]);
  }
  const first = flat[0];
  const last = out[out.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    out.push([first[0], first[1]]);
  }
  return out;
}

function ringBBox(ring) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  return [minX, minY, maxX, maxY];
}

/** Ray-casting; ring closed (first == last ok). */
export function pointInRing(lng, lat, ring) {
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-20) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function inBBox(lng, lat, bbox) {
  return (
    lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]
  );
}

/** Exterior + optional holes (GeoJSON polygon rings). */
function pointInPolygonRings(lng, lat, exterior, holes) {
  if (!inBBox(lng, lat, ringBBox(exterior))) return false;
  if (!pointInRing(lng, lat, exterior)) return false;
  for (const h of holes) {
    if (inBBox(lng, lat, ringBBox(h)) && pointInRing(lng, lat, h)) {
      return false;
    }
  }
  return true;
}

/**
 * @returns {null | { polygons: { exterior: [][], holes: [][], bbox }[] }}
 */
export function buildNfzContext(geojson, maxRingPts = 350) {
  if (!geojson) return null;

  const polygons = [];

  function pushPolygon(coordArrays) {
    if (!coordArrays?.length) return;
    const exterior = decimateRing(coordArrays[0], maxRingPts);
    if (exterior.length < 3) return;
    const holes = [];
    for (let i = 1; i < coordArrays.length; i++) {
      const h = decimateRing(coordArrays[i], Math.min(maxRingPts, 200));
      if (h.length >= 3) holes.push(h);
    }
    polygons.push({
      exterior,
      holes,
      bbox: ringBBox(exterior),
    });
  }

  if (geojson.type === "FeatureCollection" && Array.isArray(geojson.features)) {
    for (const f of geojson.features) {
      const g = f?.geometry;
      if (!g) continue;
      if (g.type === "Polygon") {
        pushPolygon(g.coordinates);
      } else if (g.type === "MultiPolygon") {
        for (const poly of g.coordinates) {
          pushPolygon(poly);
        }
      }
    }
  } else if (geojson.type === "Feature" && geojson.geometry) {
    const g = geojson.geometry;
    if (g.type === "Polygon") {
      pushPolygon(g.coordinates);
    } else if (g.type === "MultiPolygon") {
      for (const poly of g.coordinates) {
        pushPolygon(poly);
      }
    }
  } else if (geojson.type === "Polygon") {
    pushPolygon(geojson.coordinates);
  } else if (geojson.type === "MultiPolygon") {
    for (const poly of geojson.coordinates) {
      pushPolygon(poly);
    }
  }

  if (polygons.length === 0) return null;
  return { polygons };
}

export function pointInAnyNfz(lng, lat, ctx) {
  if (!ctx?.polygons?.length) return false;
  for (const poly of ctx.polygons) {
    if (!inBBox(lng, lat, poly.bbox)) continue;
    if (pointInPolygonRings(lng, lat, poly.exterior, poly.holes)) {
      return true;
    }
  }
  return false;
}

function pathBBox(path) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of path) {
    if (!p?.length) continue;
    const x = p[0];
    const y = p[1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return null;
  return [minX, minY, maxX, maxY];
}

function bboxesIntersect(a, b) {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

/** Skip PIP when the route loop cannot overlap any NFZ polygon (major perf win). */
export function pathMayIntersectNfz(path, ctx) {
  if (!ctx?.polygons?.length || !path?.length) return false;
  const pb = pathBBox(path);
  if (!pb) return false;
  return ctx.polygons.some((poly) => bboxesIntersect(pb, poly.bbox));
}

/** Open polyline only; t in [0, 1] maps start → end. */
function pointOnOpenPathInternal(coords, t) {
  const n = coords.length;
  if (n < 2) return coords[0] ? [...coords[0]] : [0, 0];

  let total = 0;
  const lens = [];
  for (let i = 0; i < n - 1; i++) {
    const len = Math.hypot(
      coords[i + 1][0] - coords[i][0],
      coords[i + 1][1] - coords[i][1]
    );
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

/**
 * If sample at t lies in NFZ, march forward toward t=1 to exit (open path only).
 */
export function positionOnOpenPathAvoidingNfz(path, t, ctx, resolution = 320) {
  const t0 = ((t % 1) + 1) % 1;
  let p = pointOnOpenPathInternal(path, t0);
  if (!ctx?.polygons?.length || !pointInAnyNfz(p[0], p[1], ctx)) return p;

  for (let k = 1; k <= resolution; k++) {
    const tn = t0 + (k / resolution) * (1 - t0);
    if (tn >= 1) break;
    const q = pointOnOpenPathInternal(path, tn);
    if (!pointInAnyNfz(q[0], q[1], ctx)) return q;
  }
  return p;
}

/**
 * Walk forward along closed path parameter t until outside all NFZ (or full lap).
 */
export function positionOnPathAvoidingNfz(path, t, ctx, resolution = 480) {
  const t0 = ((t % 1) + 1) % 1;
  let lngLat = pointOnClosedPathInternal(path, t0);
  if (!ctx?.polygons?.length) return lngLat;
  if (!pointInAnyNfz(lngLat[0], lngLat[1], ctx)) return lngLat;

  for (let k = 1; k <= resolution; k++) {
    const tn = (t0 + k / resolution) % 1;
    const p = pointOnClosedPathInternal(path, tn);
    if (!pointInAnyNfz(p[0], p[1], ctx)) return p;
  }
  return lngLat;
}

/** Same geometry as droneSim.pointOnClosedPath (no cross-import). */
function pointOnClosedPathInternal(coords, t) {
  const n = coords.length;
  if (n < 2) return coords[0] ? [...coords[0]] : [0, 0];

  let total = 0;
  const lens = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = coords[i];
    const b = coords[j];
    const len = Math.hypot(a[0] - b[0], a[1] - b[1]);
    lens.push(len);
    total += len;
  }
  if (total <= 0) return [...coords[0]];

  let u = (((t % 1) + 1) % 1) * total;
  for (let i = 0; i < n; i++) {
    const len = lens[i];
    if (len <= 0) continue;
    if (u <= len) {
      const f = u / len;
      const a = coords[i];
      const b = coords[(i + 1) % n];
      return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])];
    }
    u -= len;
  }
  return [...coords[0]];
}
