/**
 * 3D corridor volumes: buffered route polygons + extrusion height = route cruise altitude (altM).
 */

import { buffer } from "@turf/buffer";
import { centroid } from "@turf/centroid";
import { lineString } from "@turf/helpers";

/**
 * Corridor extrusion height (m AGL): matches each drone/drop route cruise alt (detail popup Alt line).
 */
export function corridorHeightAtPosition(route, _nowMs, _lng, _lat) {
  const h = route.altM ?? 100;
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
