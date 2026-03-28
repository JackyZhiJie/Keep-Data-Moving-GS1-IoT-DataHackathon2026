import { fleetHexColor } from "./fleetVisual.js";
import { generatePlannedDroneRoutes } from "./routePlanner.js";

function featureToRoute(feature) {
  if (!feature || feature.type !== "Feature") return null;
  const g = feature.geometry;
  if (!g || g.type !== "LineString" || !Array.isArray(g.coordinates)) {
    return null;
  }
  const coords = g.coordinates
    .filter((c) => Array.isArray(c) && c.length >= 2)
    .map((c) => [Number(c[0]), Number(c[1])])
    .filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));

  if (coords.length < 2) return null;

  const p = feature.properties || {};
  const id = String(p.id || "").trim() || "D-00";
  const status = ["normal", "warning", "alert"].includes(p.status)
    ? p.status
    : "normal";
  const color =
    typeof p.color === "string" && /^#[0-9a-fA-F]{6}$/.test(p.color)
      ? p.color
      : undefined;

  const first = coords[0];
  const last = coords[coords.length - 1];
  const ringLike =
    coords.length >= 4 &&
    first[0] === last[0] &&
    first[1] === last[1];

  let path = coords;
  let closed = false;
  if (ringLike) {
    path = stripClosingDuplicate(coords);
    closed = p.closed !== false;
  } else {
    path = coords;
    closed = p.closed === true;
  }

  return {
    id,
    status,
    ...(color ? { color } : {}),
    periodMs: Math.max(5000, Number(p.periodMs) || 90000),
    phase: Number.isFinite(Number(p.phase)) ? Number(p.phase) : 0,
    altM: Number.isFinite(Number(p.altM)) ? Number(p.altM) : 120,
    speedMps: Number.isFinite(Number(p.speedMps)) ? Number(p.speedMps) : 14,
    path,
    closed,
    ...(p.from && p.to
      ? {
          from: [Number(p.from[0]), Number(p.from[1])],
          to: [Number(p.to[0]), Number(p.to[1])],
        }
      : {}),
  };
}

function stripClosingDuplicate(coords) {
  if (coords.length < 2) return coords;
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) {
    return coords.slice(0, -1);
  }
  return coords;
}

export function parseRoutesFromPayload(data) {
  let features = [];
  if (data?.type === "FeatureCollection" && Array.isArray(data.features)) {
    features = data.features;
  } else if (Array.isArray(data?.features)) {
    features = data.features;
  } else if (Array.isArray(data?.routes)) {
    return data.routes
      .map((r, i) => {
        if (!r?.path?.length) return null;
        const col =
          typeof r.color === "string" && /^#[0-9a-fA-F]{6}$/.test(r.color)
            ? r.color
            : fleetHexColor(i);
        return {
          id: String(r.id || "D-00"),
          status: r.status || "normal",
          color: col,
          periodMs: Math.max(5000, Number(r.periodMs) || 90000),
          phase: Number(r.phase) || 0,
          altM: Number(r.altM) || 120,
          speedMps: Number(r.speedMps) || 14,
          path: r.path.map((c) => [Number(c[0]), Number(c[1])]),
          closed: r.closed !== false,
          ...(r.from && r.to
            ? {
                from: [Number(r.from[0]), Number(r.from[1])],
                to: [Number(r.to[0]), Number(r.to[1])],
              }
            : {}),
        };
      })
      .filter(Boolean);
  }

  const routes = features
    .map((feature, i) => {
      const r = featureToRoute(feature);
      if (!r) return null;
      if (r.color) return r;
      return { ...r, color: fleetHexColor(i) };
    })
    .filter(Boolean);
  return routes.length > 0 ? routes : null;
}

function pathsUrl() {
  const envUrl = import.meta.env.VITE_DRONE_PATHS_URL;
  if (envUrl && String(envUrl).trim()) {
    return String(envUrl).trim();
  }
  const base = import.meta.env.BASE_URL || "/";
  return `${base.replace(/\/?$/, "/")}drone-corridors.json`;
}

export async function fetchDroneRoutes() {
  const url = pathsUrl();
  const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Paths HTTP ${res.status}`);
  }
  const data = await res.json();
  const routes = parseRoutesFromPayload(data);
  if (!routes) {
    throw new Error("Paths: no valid routes in response");
  }
  return routes;
}

export async function fetchDroneRoutesWithFallback() {
  try {
    return await fetchDroneRoutes();
  } catch (e) {
    console.warn("[drone paths] using auto-planned routes:", e?.message || e);
    return generatePlannedDroneRoutes(null).map((r) => ({
      ...r,
      path: r.path.map((c) => [...c]),
    }));
  }
}
