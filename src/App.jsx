import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { fetchCyberportEnvironment } from "./environmentWeather.js";
import {
  buildDroneGeoJSON,
  DRONE_ROUTES,
  getDroneCameraLookPair,
  getDroneLiveState,
  routesToPathLineCollection,
} from "./droneSim.js";
import { buildNfzContext } from "./nfzGeometry.js";
import {
  buildDeliveryDropsGeoJSON,
  deliveryDropRoutesToLineCollection,
  generateDeliveryDropRoutes,
  getDeliveryDropLiveState,
} from "./deliveryDrops.js";
import { buildCorridorExtrusionCollection } from "./corridor3d.js";
import { disableMap3D, enableMap3D } from "./map3d.js";
import { generatePlannedDroneRoutes } from "./routePlanner.js";
import "./App.css";

const BASEMAP_STYLE_URL =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

function mapPopupLegsHtml(from, to) {
  if (
    from &&
    to &&
    from.length >= 2 &&
    to.length >= 2
  ) {
    return `<div class="hkt-map-popup-legs"><small>From: ${Number(from[0]).toFixed(5)}, ${Number(from[1]).toFixed(5)}<br>To: ${Number(to[0]).toFixed(5)}, ${Number(to[1]).toFixed(5)}</small></div>`;
  }
  return "";
}

/** Same detail layout for drone and delivery dots (only live fields differ). */
function formatFleetDotPopupHtml(st, opts = {}) {
  const kind = st.dotKind === "drop" ? "Drop" : "Drone";
  const legs = st.isOpenLeg
    ? mapPopupLegsHtml(st.from, st.to)
    : `<div class="hkt-map-popup-legs"><small>Closed patrol route</small></div>`;

  const fpvNote =
    opts.showDroneFpvNote && st.dotKind === "drone"
      ? `<div class="hkt-fpv-popup-hint"><small>Live drone camera opens in the <strong>picture window</strong> (2D or 3D map). Press <kbd>Esc</kbd> or <strong>Close</strong> on that window to stop.</small></div>`
      : "";

  const clock = st.updatedAt.toLocaleTimeString("en-GB", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const ms = String(st.updatedAt.getMilliseconds()).padStart(3, "0");
  const progLabel = st.isOpenLeg ? "Leg progress" : "Route position";

  const spd = typeof st.speedMps === "number" ? st.speedMps.toFixed(1) : "—";
  const kmh = typeof st.speedKmh === "number" ? st.speedKmh.toFixed(1) : "—";
  const plan =
    typeof st.nominalSpeedMps === "number" ? st.nominalSpeedMps.toFixed(1) : "—";
  const batt =
    typeof st.batteryPct === "number" ? `${st.batteryPct}%` : "—";

  const top = `<div class="hkt-map-popup-top">
    <strong>${kind} ID: ${st.id}</strong>
    <div class="hkt-map-popup-meta">Alt: ${st.altM ?? "—"}m AGL · Battery: ${batt}</div>
    ${fpvNote}
    ${legs}
  </div>`;

  return `${top}<div class="hkt-map-popup-live hkt-drop-popup">
    <div class="hkt-drop-popup-time">${clock}.${ms}</div>
    <div class="hkt-drop-popup-row"><span>Position</span><span>${st.lng.toFixed(5)}, ${st.lat.toFixed(5)}</span></div>
    <div class="hkt-drop-popup-row"><span>Ground speed</span><span>${spd} m/s (${kmh} km/h) <small>· plan ${plan} m/s</small></span></div>
    <div class="hkt-drop-popup-row"><span>Battery</span><span>${batt}</span></div>
    <div class="hkt-drop-popup-row"><span>${progLabel}</span><span>${st.alongPct}%</span></div>
    <div class="hkt-drop-popup-row"><span>Motion</span><span>${st.motionLabel}</span></div>
    <div class="hkt-drop-popup-row"><span>3D corridor</span><span>${st.corridorAltM ?? "—"}m AGL <small>(zone + wave)</small></span></div>
    <div class="hkt-drop-popup-foot">Cycle ${(st.periodMs / 1000).toFixed(1)}s · live</div>
  </div>`;
}

function cloneRoutes(routes) {
  return routes.map((r) => ({
    ...r,
    path: r.path.map((c) => [...c]),
    ...(r.from ? { from: [...r.from] } : {}),
    ...(r.to ? { to: [...r.to] } : {}),
  }));
}

function App() {
  const mapContainerRef = useRef(null);
  const pipContainerRef = useRef(null);
  const pipMapRef = useRef(null);
  const mapRef = useRef(null);
  const droneRoutesRef = useRef(cloneRoutes(DRONE_ROUTES));
  const nfzContextRef = useRef(null);
  const deliveryDropRoutesRef = useRef([]);
  const dropSelectionRef = useRef(null);
  const droneSelectionRef = useRef(null);
  const mapFleetLayersReadyRef = useRef(false);
  const is3DRef = useRef(false);
  const droneFpvIdRef = useRef(null);
  const exitDroneFpvRef = useRef(() => {});
  const [leftTab, setLeftTab] = useState("overview");
  const [dateTime, setDateTime] = useState("");
  const [is3D, setIs3D] = useState(false);
  const [fpvDroneId, setFpvDroneId] = useState(null);
  const [env, setEnv] = useState(null);
  const [envLoading, setEnvLoading] = useState(true);
  const [envError, setEnvError] = useState(null);

  useEffect(() => {
    const tick = () => {
      setDateTime(
        new Date().toLocaleString("en-US", {
          weekday: "short",
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadEnv() {
      setEnvLoading(true);
      setEnvError(null);
      try {
        const data = await fetchCyberportEnvironment();
        if (cancelled) return;
        setEnv(data);
        const allMissing = data.tempC == null && !data.windText && !data.visibilityText;
        if (allMissing && data.errors.length > 0) {
          setEnvError(data.errors.join(" "));
        }
      } catch (e) {
        if (!cancelled) {
          setEnvError(e?.message || "Weather request failed.");
        }
      } finally {
        if (!cancelled) setEnvLoading(false);
      }
    }

    loadEnv();
    const intervalMs = 10 * 60 * 1000;
    const id = setInterval(loadEnv, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const exitDroneFpv = useCallback(() => {
    droneFpvIdRef.current = null;
    setFpvDroneId(null);
    const pip = pipMapRef.current;
    if (pip) {
      try {
        disableMap3D(pip);
      } catch {
        /* ignore */
      }
      try {
        pip.remove();
      } catch {
        /* ignore */
      }
      pipMapRef.current = null;
    }
  }, []);

  useEffect(() => {
    exitDroneFpvRef.current = exitDroneFpv;
  }, [exitDroneFpv]);

  /** Second MapLibre map: inset only, not full-screen. */
  useEffect(() => {
    if (!fpvDroneId) return;
    const el = pipContainerRef.current;
    if (!el) return;

    if (pipMapRef.current) {
      const id = requestAnimationFrame(() => pipMapRef.current?.resize());
      return () => cancelAnimationFrame(id);
    }

    const pip = new maplibregl.Map({
      container: el,
      style: BASEMAP_STYLE_URL,
      interactive: false,
      attributionControl: false,
      maxPitch: 85,
      renderWorldCopies: false,
      canvasContextAttributes: { antialias: false, powerPreference: "high-performance" },
    });
    pipMapRef.current = pip;

    const onPipLoad = () => {
      if (is3DRef.current) {
        try {
          enableMap3D(pip);
        } catch {
          /* ignore */
        }
      }
      pip.resize();
    };
    pip.on("load", onPipLoad);

    return () => {
      try {
        pip.off("load", onPipLoad);
      } catch {
        /* map may already be removed */
      }
    };
  }, [fpvDroneId]);

  /** Match inset 3D buildings to main map mode. */
  useEffect(() => {
    const pip = pipMapRef.current;
    if (!pip || !fpvDroneId) return;
    if (!pip.loaded()) return;
    try {
      if (is3D) {
        enableMap3D(pip);
      } else {
        disableMap3D(pip);
      }
      requestAnimationFrame(() => pip.resize());
    } catch {
      /* ignore */
    }
  }, [is3D, fpvDroneId]);

  /** Drone camera → inset map only (main map unchanged). */
  useEffect(() => {
    if (!fpvDroneId) return;
    let raf = 0;
    const loop = () => {
      const pip = pipMapRef.current;
      if (
        pip &&
        pip.loaded() &&
        typeof pip.calculateCameraOptionsFromTo === "function"
      ) {
        const pair = getDroneCameraLookPair(
          performance.now(),
          fpvDroneId,
          droneRoutesRef.current,
          nfzContextRef.current
        );
        if (pair) {
          try {
            const opts = pip.calculateCameraOptionsFromTo(
              new maplibregl.LngLat(pair.camLng, pair.camLat),
              pair.camAltM,
              new maplibregl.LngLat(pair.lookLng, pair.lookLat),
              pair.lookAtAltM
            );
            const pitch = Math.min(60, Math.max(26, opts.pitch ?? 50));
            const zoom = Math.min(18.4, Math.max(14.2, opts.zoom ?? 16));
            pip.jumpTo({ ...opts, pitch, zoom, essential: true });
          } catch {
            /* degenerate from/to */
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [fpvDroneId]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape" || !droneFpvIdRef.current) return;
      exitDroneFpvRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const replotMs = 75 * 1000;

    function replotRoutes() {
      if (cancelled) return;
      droneRoutesRef.current = cloneRoutes(
        generatePlannedDroneRoutes(nfzContextRef.current)
      );
      const pathSrc = mapRef.current?.getSource?.("drone-paths");
      if (pathSrc) {
        pathSrc.setData(routesToPathLineCollection(droneRoutesRef.current));
      }
      const t = performance.now();
      const dc = mapRef.current?.getSource?.("drone-corridors-3d");
      if (dc) {
        dc.setData(
          buildCorridorExtrusionCollection(droneRoutesRef.current, t)
        );
      }
      const dpc = mapRef.current?.getSource?.("drop-corridors-3d");
      if (dpc) {
        dpc.setData(
          buildCorridorExtrusionCollection(
            deliveryDropRoutesRef.current,
            t
          )
        );
      }
    }

    const pathId = setInterval(replotRoutes, replotMs);
    return () => {
      cancelled = true;
      clearInterval(pathId);
    };
  }, []);

  useEffect(() => {
    const el = mapContainerRef.current;
    if (!el) return;

    let cancelled = false;
    let rafId = 0;
    const map = new maplibregl.Map({
      container: el,
      style: BASEMAP_STYLE_URL,
      center: [114.176, 22.298],
      zoom: 12.6,
      pitch: 0,
      bearing: 0,
      maxPitch: 85,
      renderWorldCopies: false,
      canvasContextAttributes: { antialias: false, powerPreference: "high-performance" },
    });

    mapRef.current = map;
    mapFleetLayersReadyRef.current = false;

    const onLoad = () => {
      if (cancelled) return;

      const base = import.meta.env.BASE_URL || "/";
      const nfzUrl = `${base.replace(/\/?$/, "/")}no-fly-zones.geojson`;

      void (async () => {
        try {
          const res = await fetch(nfzUrl, { cache: "no-store" });
          if (!cancelled && res.ok) {
            const geojson = await res.json();
            if (!cancelled && !map.getSource("no-fly-zones")) {
              nfzContextRef.current = buildNfzContext(geojson, 900);
              droneRoutesRef.current = cloneRoutes(
                generatePlannedDroneRoutes(nfzContextRef.current)
              );
              map.addSource("no-fly-zones", {
                type: "geojson",
                data: geojson,
              });

              map.addLayer({
                id: "no-fly-zones-fill",
                type: "fill",
                source: "no-fly-zones",
                paint: {
                  "fill-color": "#ef4444",
                  "fill-opacity": 0.35,
                },
              });

              map.addLayer({
                id: "no-fly-zones-outline",
                type: "line",
                source: "no-fly-zones",
                paint: {
                  "line-color": "#dc2626",
                  "line-width": 2,
                  "line-opacity": 0.9,
                },
              });
            }
          }
        } catch (e) {
          console.warn("No-fly zones GeoJSON:", e);
        }

        if (cancelled) return;

        if (map.getSource("drone-paths")) {
          mapFleetLayersReadyRef.current = true;
          return;
        }

        if (!nfzContextRef.current) {
          droneRoutesRef.current = cloneRoutes(
            generatePlannedDroneRoutes(null)
          );
        }

        deliveryDropRoutesRef.current = generateDeliveryDropRoutes(
          nfzContextRef.current
        );

      map.addSource("delivery-drops", {
        type: "geojson",
        data: buildDeliveryDropsGeoJSON(
          performance.now(),
          deliveryDropRoutesRef.current,
          nfzContextRef.current
        ),
      });

      map.addSource("delivery-drop-paths", {
        type: "geojson",
        data: deliveryDropRoutesToLineCollection(
          deliveryDropRoutesRef.current
        ),
      });

      map.addSource("drop-corridors-3d", {
        type: "geojson",
        data: buildCorridorExtrusionCollection(
          deliveryDropRoutesRef.current,
          performance.now()
        ),
      });

      map.addSource("drone-paths", {
        type: "geojson",
        data: routesToPathLineCollection(droneRoutesRef.current),
      });

      map.addSource("drone-corridors-3d", {
        type: "geojson",
        data: buildCorridorExtrusionCollection(
          droneRoutesRef.current,
          performance.now()
        ),
      });

      map.addSource("drones", {
        type: "geojson",
        data: buildDroneGeoJSON(
          performance.now(),
          droneRoutesRef.current,
          nfzContextRef.current
        ),
      });

      map.addLayer({
        id: "drones-layer",
        type: "circle",
        source: "drones",
        paint: {
          "circle-radius": 8,
          "circle-color": ["coalesce", ["get", "color"], "#94a3b8"],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff",
          "circle-opacity": 0.9,
        },
      });

      const corridorExtrusionPaint = {
        "fill-extrusion-height": ["get", "h"],
        "fill-extrusion-base": 0,
        "fill-extrusion-color": ["coalesce", ["get", "color"], "#94a3b8"],
        "fill-extrusion-opacity": 0.46,
        "fill-extrusion-vertical-gradient": false,
      };

      map.addLayer(
        {
          id: "delivery-drop-paths-line",
          type: "line",
          source: "delivery-drop-paths",
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-color": ["coalesce", ["get", "color"], "#64748b"],
            "line-width": 2.5,
            "line-opacity": 0.7,
          },
        },
        "drones-layer"
      );

      map.addLayer(
        {
          id: "hkt-drop-corridors-3d",
          type: "fill-extrusion",
          source: "drop-corridors-3d",
          minzoom: 11,
          layout: { visibility: "none" },
          paint: corridorExtrusionPaint,
        },
        "delivery-drop-paths-line"
      );

      map.addLayer(
        {
          id: "delivery-drops-layer",
          type: "circle",
          source: "delivery-drops",
          paint: {
            "circle-radius": 8,
            "circle-color": ["coalesce", ["get", "color"], "#94a3b8"],
            "circle-stroke-width": 2,
            "circle-stroke-color": "#fff",
            "circle-opacity": 0.9,
          },
        },
        "drones-layer"
      );

      map.addLayer(
        {
          id: "drone-paths-line",
          type: "line",
          source: "drone-paths",
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-color": ["coalesce", ["get", "color"], "#64748b"],
            "line-width": 2.5,
            "line-opacity": 0.7,
          },
        },
        "drones-layer"
      );

      map.addLayer(
        {
          id: "hkt-drone-corridors-3d",
          type: "fill-extrusion",
          source: "drone-corridors-3d",
          minzoom: 11,
          layout: { visibility: "none" },
          paint: corridorExtrusionPaint,
        },
        "drone-paths-line"
      );

      const ANIM_MS = 50;
      let lastAnimT = 0;

      const animateDrones = (time) => {
        if (cancelled) return;
        const tick = time - lastAnimT >= ANIM_MS;
        if (tick) {
          lastAnimT = time;
        }

        if (tick) {
          const src = map.getSource("drones");
          if (src) {
            src.setData(
              buildDroneGeoJSON(
                time,
                droneRoutesRef.current,
                nfzContextRef.current
              )
            );
          }
          const dropsSrc = map.getSource("delivery-drops");
          const dropRoutes = deliveryDropRoutesRef.current;
          if (dropsSrc && dropRoutes?.length) {
            dropsSrc.setData(
              buildDeliveryDropsGeoJSON(
                time,
                dropRoutes,
                nfzContextRef.current
              )
            );
          }
          if (is3DRef.current) {
            const dCor = map.getSource("drone-corridors-3d");
            if (dCor) {
              dCor.setData(
                buildCorridorExtrusionCollection(
                  droneRoutesRef.current,
                  time
                )
              );
            }
            const pCor = map.getSource("drop-corridors-3d");
            if (pCor) {
              pCor.setData(
                buildCorridorExtrusionCollection(
                  deliveryDropRoutesRef.current,
                  time
                )
              );
            }
          }
        }

        if (tick) {
          const dropRoutes = deliveryDropRoutesRef.current;
          const dropSel = dropSelectionRef.current;
          if (dropSel?.popup && dropSel.dropId && dropRoutes?.length) {
            const route = dropRoutes.find((r) => r.id === dropSel.dropId);
            if (route) {
              const st = getDeliveryDropLiveState(
                time,
                route,
                nfzContextRef.current
              );
              dropSel.popup.setLngLat([st.lng, st.lat]);
              dropSel.popup.setHTML(formatFleetDotPopupHtml(st, {}));
            }
          }
          const droneSel = droneSelectionRef.current;
          if (droneSel?.popup && droneSel.droneId) {
            const st = getDroneLiveState(
              time,
              droneSel.droneId,
              droneRoutesRef.current,
              nfzContextRef.current
            );
            if (st) {
              droneSel.popup.setLngLat([st.lng, st.lat]);
              droneSel.popup.setHTML(
                formatFleetDotPopupHtml(st, { showDroneFpvNote: true })
              );
            }
          }
        }

        rafId = requestAnimationFrame(animateDrones);
      };
      rafId = requestAnimationFrame(animateDrones);

      const onDroneClick = (e) => {
        if (!e.features?.length) return;
        const feat = e.features[0];
        const id = feat.properties.id;
        dropSelectionRef.current?.popup?.remove();
        dropSelectionRef.current = null;
        droneSelectionRef.current?.popup?.remove();
        const st = getDroneLiveState(
          performance.now(),
          id,
          droneRoutesRef.current,
          nfzContextRef.current
        );
        if (!st) return;
        droneFpvIdRef.current = id;
        setFpvDroneId(id);
        const popup = new maplibregl.Popup({
          closeOnClick: false,
          maxWidth: "300px",
          className: "hkt-map-popup-anchor",
        })
          .setLngLat(feat.geometry.coordinates.slice())
          .setHTML(formatFleetDotPopupHtml(st, { showDroneFpvNote: true }))
          .addTo(map);
        popup.on("close", () => {
          if (droneSelectionRef.current?.popup === popup) {
            droneSelectionRef.current = null;
          }
          if (droneFpvIdRef.current === id) {
            exitDroneFpvRef.current();
          }
        });
        droneSelectionRef.current = { popup, droneId: id };
      };

      const onEnter = () => {
        map.getCanvas().style.cursor = "pointer";
      };
      const onLeave = () => {
        map.getCanvas().style.cursor = "";
      };

      const onDropClick = (e) => {
        if (!e.features?.length) return;
        const feat = e.features[0];
        const id = feat.properties.id;
        const routes = deliveryDropRoutesRef.current;
        const route = routes.find((r) => r.id === id);
        if (!route) return;
        droneSelectionRef.current?.popup?.remove();
        droneSelectionRef.current = null;
        dropSelectionRef.current?.popup?.remove();
        exitDroneFpvRef.current();
        const popup = new maplibregl.Popup({
          closeOnClick: false,
          maxWidth: "300px",
          className: "hkt-map-popup-anchor",
        })
          .setLngLat(feat.geometry.coordinates.slice())
          .setHTML(
            formatFleetDotPopupHtml(
              getDeliveryDropLiveState(
                performance.now(),
                route,
                nfzContextRef.current
              ),
              {}
            )
          )
          .addTo(map);
        popup.on("close", () => {
          if (dropSelectionRef.current?.popup === popup) {
            dropSelectionRef.current = null;
          }
        });
        dropSelectionRef.current = { popup, dropId: id };
      };

      map.on("click", "drones-layer", onDroneClick);
      map.on("mouseenter", "drones-layer", onEnter);
      map.on("mouseleave", "drones-layer", onLeave);
      map.on("click", "delivery-drops-layer", onDropClick);
      map.on("mouseenter", "delivery-drops-layer", onEnter);
      map.on("mouseleave", "delivery-drops-layer", onLeave);

      mapFleetLayersReadyRef.current = true;
      })();
    };

    map.on("load", onLoad);

    return () => {
      cancelled = true;
      exitDroneFpvRef.current();
      dropSelectionRef.current?.popup?.remove();
      dropSelectionRef.current = null;
      droneSelectionRef.current?.popup?.remove();
      droneSelectionRef.current = null;
      cancelAnimationFrame(rafId);
      map.off("load", onLoad);
      try {
        disableMap3D(map);
      } catch (_) {
        /* ignore */
      }
      map.remove();
      mapRef.current = null;
      mapFleetLayersReadyRef.current = false;
    };
  }, []);

  const toggle3D = useCallback(() => {
    const map = mapRef.current;
    if (!map || !mapFleetLayersReadyRef.current) return;

    setIs3D((prev) => {
      const next = !prev;
      is3DRef.current = next;
      if (next) {
        enableMap3D(map);
        map.easeTo({
          pitch: 68,
          bearing: -32,
          zoom: Math.min(map.getZoom() + 0.45, 16.4),
          duration: 1400,
          essential: true,
        });
      } else {
        disableMap3D(map);
        map.easeTo({
          pitch: 0,
          bearing: 0,
          duration: 1200,
          essential: true,
        });
      }
      return next;
    });
  }, []);

  return (
    <div className="hkt-dashboard">
      {fpvDroneId ? (
        <div
          className="hkt-drone-pip-wrap panel"
          role="region"
          aria-label={`Live drone camera ${fpvDroneId}`}
        >
          <div className="hkt-drone-pip-chrome">
            <span className="hkt-drone-pip-chrome__title">Drone camera</span>
            <span className="hkt-drone-pip-chrome__id">{fpvDroneId}</span>
            <button
              type="button"
              className="hkt-drone-pip-chrome__close"
              onClick={() => exitDroneFpv()}
            >
              Close
            </button>
            <span className="hkt-drone-pip-chrome__hint">Esc</span>
          </div>
          <div ref={pipContainerRef} className="hkt-drone-pip-canvas" />
        </div>
      ) : null}
      <div ref={mapContainerRef} className="hkt-map" aria-hidden />

      <header className="panel hkt-top-panel">
        <h2>HKT UAV Traffic Control</h2>
        <div className="hkt-datetime">{dateTime}</div>
      </header>

      <aside className="panel hkt-left-panel">
        <div className="tabs tabs--three" role="tablist" aria-label="Fleet sections">
          <button type="button" role="tab" aria-selected={leftTab === "overview"} className={`tab-btn${leftTab === "overview" ? " active" : ""}`} onClick={() => setLeftTab("overview")}>
            Overview
          </button>
          <button type="button" role="tab" aria-selected={leftTab === "logistics"} className={`tab-btn${leftTab === "logistics" ? " active" : ""}`} onClick={() => setLeftTab("logistics")}>
            Parking
          </button>
          <button type="button" role="tab" aria-selected={leftTab === "advisory"} className={`tab-btn${leftTab === "advisory" ? " active" : ""}`} onClick={() => setLeftTab("advisory")}>
            Advisory
          </button>
        </div>

        {leftTab === "overview" && (
          <div className="tab-content" role="tabpanel">
            <h3>Fleet Overview</h3>
            <div className="card">
              <p>
                Total Active Drones: <span className="hkt-stat-green">42</span>
              </p>
              <p>
                Grounded / Standby: <span>8</span>
              </p>
              <p>
                In Mission: <span>34</span>
              </p>
            </div>

            <h3>Operator Breakdown</h3>
            <div className="card">
              <p>
                Delivery Co. (HK): <span>18</span>
              </p>
              <p>
                Inspection Corp: <span>12</span>
              </p>
              <p>
                Gov Services: <span>4</span>
              </p>
            </div>

            <h3>Environment (HK Observatory)</h3>
            <div className="card alert-green">
              <p className="hkt-card-block">
                <strong>Location:</strong> {env?.locationLabel ?? "Cyberport, HK"}
              </p>
              <p className="hkt-card-block">
                <strong>Wind:</strong> {envLoading ? "…" : env?.windText ?? "—"}
              </p>
              <p className="hkt-card-block">
                <strong>Visibility:</strong> {envLoading ? "…" : env?.visibilityText ?? "—"}
              </p>
              <p className="hkt-card-block">
                <strong>Temp:</strong> {envLoading ? "…" : env?.tempC != null ? `${env.tempC}°C` : "—"}
              </p>
              {env?.tempStation && !envLoading && env?.tempC != null && (
                <p className="hkt-env-meta">
                  Air temperature from HKO station: {env.tempStation}
                  {env.humidityPct != null && (
                    <>
                      {" "}
                      · Humidity {env.humidityPct}%{env.humidityPlace ? ` (${env.humidityPlace})` : ""}
                    </>
                  )}
                </p>
              )}
              {(env?.hkoForecastDesc || env?.hkoForecastPeriod) && !envLoading && (
                <div className="hkt-hko-forecast">
                  {env.hkoForecastPeriod && (
                    <p className="hkt-hko-forecast-title">
                      <strong>{env.hkoForecastPeriod}</strong>
                      {env.hkoForecastUpdateTime && <span className="hkt-hko-forecast-time"> · {env.hkoForecastUpdateTime}</span>}
                    </p>
                  )}
                  {env.hkoForecastDesc && <p className="hkt-hko-forecast-desc">{env.hkoForecastDesc}</p>}
                  <p className="hkt-env-inline-src">
                    Source: Hong Kong Observatory Open Data API (<code>flw</code>) via{" "}
                    <a href="https://data.gov.hk/" target="_blank" rel="noopener noreferrer">
                      DATA.GOV.HK
                    </a>
                    .
                  </p>
                </div>
              )}
              <p className="hkt-env-sources">
                Regional temperature/humidity: HKO <code>rhrread</code>. Wind &amp; visibility:{" "}
                <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">
                  Open-Meteo
                </a>{" "}
                (grid over Cyberport). Refreshed every 10 min.
              </p>
              {envError && (
                <p className="hkt-env-error" role="alert">
                  {envError}
                </p>
              )}
            </div>
          </div>
        )}

        {leftTab === "logistics" && (
          <div className="tab-content" role="tabpanel">
            <h3>Vertiport &amp; Parking Status</h3>
            <div className="card">
              <p>
                Available Spots: <span className="hkt-stat-bold">7 / 10</span>
              </p>
              <hr className="hkt-divider" />
              <p>
                Central Hub (Pad A): <span className="hkt-text-green">Available</span>
              </p>
              <p>
                Cyberport Hub (Pad B): <span className="hkt-text-amber">Occupied (Charging)</span>
              </p>
              <p>
                Kwun Tong (Pad C): <span className="hkt-text-red">Maintenance</span>
              </p>
              <p>
                TKO Hub (Pad D): <span className="hkt-text-green">Available</span>
              </p>
            </div>

            <h3>Fleet Battery Health</h3>
            <div className="card">
              <p>
                Avg Fleet Battery: <span className="hkt-stat-green">78%</span>
              </p>
              <p>
                Critical (&lt; 20%): <span className="hkt-text-red">2 Drones</span>
              </p>
              <p>
                Currently Charging: <span className="hkt-text-blue">5 Drones</span>
              </p>

              <hr className="hkt-divider hkt-divider-lg" />

              <div className="hkt-battery-row">
                <span className="hkt-battery-label">Drone D-01 (Normal) - 85%</span>
                <div className="progress-bg">
                  <div className="progress-fill fill-green" style={{ width: "85%" }} />
                </div>
              </div>
              <div className="hkt-battery-row">
                <span className="hkt-battery-label">Drone D-02 (Warning) - 30%</span>
                <div className="progress-bg">
                  <div className="progress-fill fill-yellow" style={{ width: "30%" }} />
                </div>
              </div>
              <div className="hkt-battery-row hkt-battery-row-last">
                <span className="hkt-battery-label">Drone D-03 (Critical) - 12%</span>
                <div className="progress-bg">
                  <div className="progress-fill fill-red" style={{ width: "12%" }} />
                </div>
              </div>
            </div>
          </div>
        )}

        {leftTab === "advisory" && (
          <div className="tab-content" role="tabpanel">
            <h3>AI Advisory</h3>
            <div className="card">
              {env?.hkoForecastDesc && !envLoading && (
                <p className="hkt-advisory-context">
                  <span className="hkt-advisory-label">HKO context</span>
                  {env.hkoForecastDesc}
                </p>
              )}
              <p className="hkt-advisory">&quot;Airspace congestion predicted over Central district in 15 minutes. Suggest rerouting non-critical flights.&quot;</p>
            </div>

            <h3>Active Alarms</h3>
            <div className="card alert-red">
              <p className="hkt-alarm-title">
                <strong>[10:14 AM] ⚠️ Collision Risk</strong>
              </p>
              <p className="hkt-alarm-body">Drone-A &amp; Drone-B proximity breach in Sector 4 (Altitude: 120m).</p>
              <button type="button" className="btn btn-action">
                Force RTH (Return to Home)
              </button>
            </div>

            <div className="card alert-yellow">
              <p className="hkt-alarm-title">
                <strong>[10:12 AM] ⚠️ Strong Wind Warning</strong>
              </p>
              <p className="hkt-alarm-body">Gusts up to 35 km/h detected near Victoria Peak. Check drone stability.</p>
            </div>

            <div className="card alert-yellow">
              <p className="hkt-alarm-title">
                <strong>[10:05 AM] 🔋 Low Battery</strong>
              </p>
              <p className="hkt-alarm-body">Drone ID-892 battery at 15%. Initiating auto-landing protocol to Cyberport Hub.</p>
            </div>
          </div>
        )}
      </aside>

      <button
        type="button"
        id="toggle3dBtn"
        className={`btn hkt-toggle-3d${is3D ? " hkt-toggle-3d--active" : ""}`}
        onClick={toggle3D}
        aria-pressed={is3D}
      >
        {is3D ? "2D map" : "3D view (buildings + corridors)"}
      </button>
    </div>
  );
}

export default App;
