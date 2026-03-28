import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { fetchCyberportEnvironment } from "./environmentWeather.js";
import { fetchDroneRoutesWithFallback } from "./dronePathsApi.js";
import {
  buildDroneGeoJSON,
  DRONE_ROUTES,
  routesToPathLineCollection,
} from "./droneSim.js";
import "./App.css";

function App() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const droneRoutesRef = useRef(DRONE_ROUTES);
  const [leftTab, setLeftTab] = useState("overview");
  const [dateTime, setDateTime] = useState("");
  const [is3D, setIs3D] = useState(false);
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
        const allMissing =
          data.tempC == null &&
          !data.windText &&
          !data.visibilityText;
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

  useEffect(() => {
    let cancelled = false;

    async function syncPaths() {
      const next = await fetchDroneRoutesWithFallback();
      if (cancelled) return;
      droneRoutesRef.current = next;
      const m = mapRef.current;
      const pathSrc = m?.getSource?.("drone-paths");
      if (pathSrc) {
        pathSrc.setData(routesToPathLineCollection(next));
      }
    }

    syncPaths();
    const pathIntervalMs = 2 * 60 * 1000;
    const pathId = setInterval(syncPaths, pathIntervalMs);
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
      style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
      center: [114.1694, 22.2818],
      zoom: 15,
      pitch: 0,
      bearing: 0,
    });

    mapRef.current = map;

    const onLoad = () => {
      if (cancelled) return;

      map.addSource("drone-paths", {
        type: "geojson",
        data: routesToPathLineCollection(droneRoutesRef.current),
      });

      map.addSource("drones", {
        type: "geojson",
        data: buildDroneGeoJSON(
          performance.now(),
          droneRoutesRef.current
        ),
      });

      map.addLayer({
        id: "drones-layer",
        type: "circle",
        source: "drones",
        paint: {
          "circle-radius": 8,
          "circle-color": [
            "match",
            ["get", "status"],
            "normal",
            "#10b981",
            "warning",
            "#f59e0b",
            "alert",
            "#ef4444",
            "#ffffff",
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff",
          "circle-opacity": 0.9,
        },
      });

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
            "line-color": [
              "match",
              ["get", "status"],
              "normal",
              "#10b981",
              "warning",
              "#f59e0b",
              "alert",
              "#ef4444",
              "#64748b",
            ],
            "line-width": 2.5,
            "line-opacity": 0.7,
          },
        },
        "drones-layer"
      );

      const animateDrones = (time) => {
        if (cancelled) return;
        const src = map.getSource("drones");
        if (src) {
          src.setData(
            buildDroneGeoJSON(time, droneRoutesRef.current)
          );
        }
        rafId = requestAnimationFrame(animateDrones);
      };
      rafId = requestAnimationFrame(animateDrones);

      const onDroneClick = (e) => {
        if (!e.features?.length) return;
        const feat = e.features[0];
        const coordinates = feat.geometry.coordinates.slice();
        const id = feat.properties.id;
        const alt = feat.properties.alt_m ?? "—";
        const spd = feat.properties.speed_mps ?? "—";

        new maplibregl.Popup()
          .setLngLat(coordinates)
          .setHTML(
            `<strong>Drone ID: ${id}</strong><br>Alt: ${alt}m AGL<br>Speed: ${spd}m/s`
          )
          .addTo(map);
      };

      const onEnter = () => {
        map.getCanvas().style.cursor = "pointer";
      };
      const onLeave = () => {
        map.getCanvas().style.cursor = "";
      };

      map.on("click", "drones-layer", onDroneClick);
      map.on("mouseenter", "drones-layer", onEnter);
      map.on("mouseleave", "drones-layer", onLeave);
    };

    map.on("load", onLoad);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      map.off("load", onLoad);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  const toggle3D = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.loaded()) return;

    setIs3D((prev) => {
      const next = !prev;
      if (next) {
        map.easeTo({ pitch: 60, bearing: -15, duration: 1200 });
      } else {
        map.easeTo({ pitch: 0, bearing: 0, duration: 1200 });
      }
      return next;
    });
  }, []);

  return (
    <div className="hkt-dashboard">
      <div ref={mapContainerRef} className="hkt-map" aria-hidden />

      <header className="panel hkt-top-panel">
        <h2>HKT UAV Traffic Control</h2>
        <div className="hkt-datetime">{dateTime}</div>
      </header>

      <aside className="panel hkt-left-panel">
        <div className="tabs" role="tablist" aria-label="Fleet sections">
          <button
            type="button"
            role="tab"
            aria-selected={leftTab === "overview"}
            className={`tab-btn${leftTab === "overview" ? " active" : ""}`}
            onClick={() => setLeftTab("overview")}
          >
            Overview
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={leftTab === "logistics"}
            className={`tab-btn${leftTab === "logistics" ? " active" : ""}`}
            onClick={() => setLeftTab("logistics")}
          >
            Parking &amp; Battery
          </button>
        </div>

        {leftTab === "overview" && (
          <div className="tab-content" role="tabpanel">
            <h3>Fleet Overview</h3>
            <div className="card">
              <p>
                Total Active Drones:{" "}
                <span className="hkt-stat-green">42</span>
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
                <strong>Location:</strong>{" "}
                {env?.locationLabel ?? "Cyberport, HK"}
              </p>
              <p className="hkt-card-block">
                <strong>Wind:</strong>{" "}
                {envLoading
                  ? "…"
                  : env?.windText ?? "—"}
              </p>
              <p className="hkt-card-block">
                <strong>Visibility:</strong>{" "}
                {envLoading
                  ? "…"
                  : env?.visibilityText ?? "—"}
              </p>
              <p className="hkt-card-block">
                <strong>Temp:</strong>{" "}
                {envLoading
                  ? "…"
                  : env?.tempC != null
                    ? `${env.tempC}°C`
                    : "—"}
              </p>
              {env?.tempStation && !envLoading && env?.tempC != null && (
                <p className="hkt-env-meta">
                  Air temperature from HKO station: {env.tempStation}
                  {env.humidityPct != null && (
                    <>
                      {" "}
                      · Humidity {env.humidityPct}%
                      {env.humidityPlace ? ` (${env.humidityPlace})` : ""}
                    </>
                  )}
                </p>
              )}
              {(env?.hkoForecastDesc || env?.hkoForecastPeriod) &&
                !envLoading && (
                  <div className="hkt-hko-forecast">
                    {env.hkoForecastPeriod && (
                      <p className="hkt-hko-forecast-title">
                        <strong>{env.hkoForecastPeriod}</strong>
                        {env.hkoForecastUpdateTime && (
                          <span className="hkt-hko-forecast-time">
                            {" "}
                            · {env.hkoForecastUpdateTime}
                          </span>
                        )}
                      </p>
                    )}
                    {env.hkoForecastDesc && (
                      <p className="hkt-hko-forecast-desc">
                        {env.hkoForecastDesc}
                      </p>
                    )}
                    <p className="hkt-env-inline-src">
                      Source: Hong Kong Observatory Open Data API (
                      <code>flw</code>) via{" "}
                      <a
                        href="https://data.gov.hk/"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        DATA.GOV.HK
                      </a>
                      .
                    </p>
                  </div>
                )}
              <p className="hkt-env-sources">
                Regional temperature/humidity: HKO <code>rhrread</code>. Wind
                &amp; visibility:{" "}
                <a
                  href="https://open-meteo.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
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
                Available Spots:{" "}
                <span className="hkt-stat-bold">14 / 20</span>
              </p>
              <hr className="hkt-divider" />
              <p>
                Central Hub (Pad A):{" "}
                <span className="hkt-text-green">Available</span>
              </p>
              <p>
                Cyberport Hub (Pad B):{" "}
                <span className="hkt-text-amber">Occupied (Charging)</span>
              </p>
              <p>
                Kwun Tong (Pad C):{" "}
                <span className="hkt-text-red">Maintenance</span>
              </p>
              <p>
                TKO Hub (Pad D):{" "}
                <span className="hkt-text-green">Available</span>
              </p>
            </div>

            <h3>Fleet Battery Health</h3>
            <div className="card">
              <p>
                Avg Fleet Battery:{" "}
                <span className="hkt-stat-green">78%</span>
              </p>
              <p>
                Critical (&lt; 20%):{" "}
                <span className="hkt-text-red">2 Drones</span>
              </p>
              <p>
                Currently Charging:{" "}
                <span className="hkt-text-blue">5 Drones</span>
              </p>

              <hr className="hkt-divider hkt-divider-lg" />

              <div className="hkt-battery-row">
                <span className="hkt-battery-label">
                  Drone D-01 (Normal) - 85%
                </span>
                <div className="progress-bg">
                  <div
                    className="progress-fill fill-green"
                    style={{ width: "85%" }}
                  />
                </div>
              </div>
              <div className="hkt-battery-row">
                <span className="hkt-battery-label">
                  Drone D-02 (Warning) - 30%
                </span>
                <div className="progress-bg">
                  <div
                    className="progress-fill fill-yellow"
                    style={{ width: "30%" }}
                  />
                </div>
              </div>
              <div className="hkt-battery-row hkt-battery-row-last">
                <span className="hkt-battery-label">
                  Drone D-03 (Critical) - 12%
                </span>
                <div className="progress-bg">
                  <div
                    className="progress-fill fill-red"
                    style={{ width: "12%" }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </aside>

      <aside className="panel hkt-right-panel">
        <h3>AI Advisory</h3>
        <div className="card">
          {env?.hkoForecastDesc && !envLoading && (
            <p className="hkt-advisory-context">
              <span className="hkt-advisory-label">HKO context</span>
              {env.hkoForecastDesc}
            </p>
          )}
          <p className="hkt-advisory">
            &quot;Airspace congestion predicted over Central district in 15
            minutes. Suggest rerouting non-critical flights.&quot;
          </p>
        </div>

        <h3>Active Alarms</h3>
        <div className="card alert-red">
          <p className="hkt-alarm-title">
            <strong>[10:14 AM] ⚠️ Collision Risk</strong>
          </p>
          <p className="hkt-alarm-body">
            Drone-A &amp; Drone-B proximity breach in Sector 4 (Altitude:
            120m).
          </p>
          <button type="button" className="btn btn-action">
            Force RTH (Return to Home)
          </button>
        </div>

        <div className="card alert-yellow">
          <p className="hkt-alarm-title">
            <strong>[10:12 AM] ⚠️ Strong Wind Warning</strong>
          </p>
          <p className="hkt-alarm-body">
            Gusts up to 35 km/h detected near Victoria Peak. Check drone
            stability.
          </p>
        </div>

        <div className="card alert-yellow">
          <p className="hkt-alarm-title">
            <strong>[10:05 AM] 🔋 Low Battery</strong>
          </p>
          <p className="hkt-alarm-body">
            Drone ID-892 battery at 15%. Initiating auto-landing protocol to
            Cyberport Hub.
          </p>
        </div>
      </aside>

      <button
        type="button"
        id="toggle3dBtn"
        className={`btn hkt-toggle-3d${is3D ? " hkt-toggle-3d--active" : ""}`}
        onClick={toggle3D}
      >
        {is3D
          ? "Switch to 2D View (Top-Down)"
          : "Switch to 3D View (Buildings)"}
      </button>
    </div>
  );
}

export default App;
