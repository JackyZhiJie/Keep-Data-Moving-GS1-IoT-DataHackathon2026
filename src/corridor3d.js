/**
 * 3D corridor volumes: buffered route polygons + animated AGL height (urban clearance heuristic).
 */

import { buffer } from "@turf/buffer";
import { centroid } from "@turf/centroid";
import { lineString } from "@turf/helpers";

/** Extra simulated clearance (m) where building extrusions are densest on the map. */
export function buildingClearanceBonusM(lng, lat) {
  if (lng > 114.148 && lng < 114.195 && lat > 22.27 && lat < 22.298) {
    return 34;
  }
  if (lng > 114.155 && lng < 114.218 && lat > 22.282 && lat < 22.34) {
    return 28;
  }
  return 12;
}

/**
 * Simulated corridor ceiling at a point: fleet cruise altitude + zone clearance + slow wave
 * (moves up/down over time and with denser “building” areas).
 */
export function corridorHeightAtPosition(route, nowMs, lng, lat) {
  const base = route.altM ?? 100;
  const bonus = buildingClearanceBonusM(lng, lat);
  const phase = (route.id || "").split("").reduce((s, c) => s + c.charCodeAt(0), 0);
  const wave = 16 * Math.sin(nowMs / 5800 + phase * 0.015);
  const h = base * 0.7 + bonus + wave;
  return Math.max(38, Math.round(h * 10) / 10);
}

const BUFFER_RADIUS_M = 22;

/**
 * @param {Array<{ path: [number,number][], id: string, status: string, altM?: number }>} routes
 */
export function buildCorridorExtrusionCollection(routes, nowMs) {
  const features = [];
  const list = Array.isArray(routes) ? routes : [];
  for (const r of list) {
    if (!r.path || r.path.length < 2) continue;
    const coords = r.path.map((p) => [p[0], p[1]]);
    try {
      const line = lineString(coords);
      const poly = buffer(line, BUFFER_RADIUS_M, { units: "meters" });
      if (!poly?.geometry) continue;
      const c = centroid(poly);
      const [lng, lat] = c.geometry.coordinates;
      const h = corridorHeightAtPosition(r, nowMs, lng, lat);
      features.push({
        type: "Feature",
        properties: {
          id: r.id,
          status: r.status,
          color: r.color,
          h,
        },
        geometry: poly.geometry,
      });
    } catch {
      /* skip degenerate geometry */
    }
  }
  return { type: "FeatureCollection", features };
}
