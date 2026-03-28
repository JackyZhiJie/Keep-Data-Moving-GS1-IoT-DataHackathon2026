/**
 * Low-altitude patrol loops (lng, lat) around the map focus — Victoria Harbour /
 * Central–Wan Chai–Tsim Sha Tsui corridor (typical urban UTM visualization).
 */

function segmentLength(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

/** Position on a closed polyline; t in [0, 1). */
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

/**
 * Each drone: closed route, orbit period (ms), phase [0,1), display props.
 */
export const DRONE_ROUTES = [
  {
    id: "D-01",
    status: "normal",
    periodMs: 88000,
    phase: 0,
    altM: 118,
    speedMps: 14,
    path: [
      [114.158, 22.284],
      [114.166, 22.289],
      [114.174, 22.286],
      [114.172, 22.279],
      [114.163, 22.276],
      [114.155, 22.28],
    ],
  },
  {
    id: "D-02",
    status: "warning",
    periodMs: 102000,
    phase: 0.22,
    altM: 95,
    speedMps: 11,
    path: [
      [114.168, 22.292],
      [114.178, 22.29],
      [114.181, 22.282],
      [114.175, 22.275],
      [114.165, 22.277],
      [114.162, 22.285],
    ],
  },
  {
    id: "D-03",
    status: "alert",
    periodMs: 72000,
    phase: 0.55,
    altM: 132,
    speedMps: 16,
    path: [
      [114.152, 22.281],
      [114.158, 22.287],
      [114.169, 22.288],
      [114.171, 22.279],
      [114.16, 22.274],
      [114.148, 22.278],
    ],
  },
  {
    id: "D-04",
    status: "normal",
    periodMs: 95000,
    phase: 0.08,
    altM: 105,
    speedMps: 13,
    path: [
      [114.175, 22.278],
      [114.182, 22.275],
      [114.185, 22.268],
      [114.178, 22.265],
      [114.17, 22.268],
      [114.168, 22.274],
    ],
  },
];

export function buildDroneGeoJSON(nowMs, routes = DRONE_ROUTES) {
  const list = Array.isArray(routes) && routes.length > 0 ? routes : DRONE_ROUTES;
  const features = list.map((r) => {
    const t = nowMs / r.periodMs + r.phase;
    const [lng, lat] = pointOnClosedPath(r.path, t);
    return {
      type: "Feature",
      properties: {
        status: r.status,
        id: r.id,
        alt_m: r.altM,
        speed_mps: r.speedMps,
      },
      geometry: { type: "Point", coordinates: [lng, lat] },
    };
  });

  return { type: "FeatureCollection", features };
}

/** LineStrings for map overlay (explicit closing segment for visibility). */
export function routesToPathLineCollection(routes) {
  const list = Array.isArray(routes) && routes.length > 0 ? routes : DRONE_ROUTES;
  return {
    type: "FeatureCollection",
    features: list.map((r) => {
      const ring =
        r.path.length > 0 ? [...r.path, r.path[0]] : [];
      return {
        type: "Feature",
        properties: { id: r.id, status: r.status },
        geometry: { type: "LineString", coordinates: ring },
      };
    }),
  };
}
