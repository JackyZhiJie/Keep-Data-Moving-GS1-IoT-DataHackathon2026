import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./App.css";

const DRONE_GEOJSON = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { status: "normal", id: "D-01" },
      geometry: { type: "Point", coordinates: [114.1694, 22.2818] },
    },
    {
      type: "Feature",
      properties: { status: "warning", id: "D-02" },
      geometry: { type: "Point", coordinates: [114.172, 22.2835] },
    },
    {
      type: "Feature",
      properties: { status: "alert", id: "D-03" },
      geometry: { type: "Point", coordinates: [114.165, 22.28] },
    },
    {
      type: "Feature",
      properties: { status: "normal", id: "D-04" },
      geometry: { type: "Point", coordinates: [114.168, 22.278] },
    },
  ],
};

function App() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const [leftTab, setLeftTab] = useState("overview");
  const [dateTime, setDateTime] = useState("");
  const [is3D, setIs3D] = useState(false);

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
    const el = mapContainerRef.current;
    if (!el) return;

    let cancelled = false;
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

      map.addSource("drones", { type: "geojson", data: DRONE_GEOJSON });

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

      const onDroneClick = (e) => {
        if (!e.features?.length) return;
        const feat = e.features[0];
        const coordinates = feat.geometry.coordinates.slice();
        const id = feat.properties.id;

        new maplibregl.Popup()
          .setLngLat(coordinates)
          .setHTML(
            `<strong>Drone ID: ${id}</strong><br>Alt: 120m<br>Speed: 15m/s`
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
                <strong>Location:</strong> Cyberport, HK
              </p>
              <p className="hkt-card-block">
                <strong>Wind:</strong> 12 km/h NE
              </p>
              <p className="hkt-card-block">
                <strong>Visibility:</strong> 8.5 km (Good)
              </p>
              <p className="hkt-card-block">
                <strong>Temp:</strong> 24°C
              </p>
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
