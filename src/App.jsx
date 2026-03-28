import React, { useEffect, useRef, useState } from "react";
import "./App.css";

// Drone Class
class Drone {
  constructor(id, targetSpeed) {
    this.id = id;
    this.pathIndex = 0;
    this.baseSpeed = targetSpeed;
    this.currentSpeed = targetSpeed;
    this.color = "#3b82f6";
    this.bubbleColor = "rgba(16, 185, 129, 0.15)";
    this.state = "cruising";
    this.bubbleRadius = 30;
    this.jitterX = 0;
    this.jitterY = 0;
  }

  update(railPath, totalPathLen, config) {
    this.pathIndex += this.currentSpeed;

    if (this.pathIndex >= totalPathLen) {
      this.pathIndex -= totalPathLen;
    }

    const idx = Math.floor(this.pathIndex);
    if (railPath[idx]) {
      this.x = railPath[idx].x + this.jitterX;
      this.y = railPath[idx].y + this.jitterY;
    }

    let margin = config.isPlatoonMode ? config.platoonMargin : config.baseSafetyMargin;
    const latencyExpand = config.latency / 10;
    this.bubbleRadius = margin + this.currentSpeed * 12 + latencyExpand;

    this.jitterX = 0;
    this.jitterY = 0;
  }

  draw(ctx, config) {
    if (!this.x) return;

    ctx.beginPath();
    ctx.arc(this.x, this.y, this.bubbleRadius, 0, Math.PI * 2);

    if (this.state === "emergency_brake") {
      let alpha = Date.now() % 500 < 250 ? 0.5 : 0.2;
      ctx.fillStyle = `rgba(239, 68, 68, ${alpha})`;
      ctx.strokeStyle = "#ef4444";
    } else if (this.state === "caution") {
      ctx.fillStyle = "rgba(250, 204, 21, 0.3)";
      ctx.strokeStyle = "#eab308";
    } else if (this.state === "braking") {
      ctx.fillStyle = "rgba(239, 68, 68, 0.2)";
      ctx.strokeStyle = "#ef4444";
    } else if (this.state === "emi_warning") {
      ctx.fillStyle = "rgba(245, 158, 11, 0.2)";
      ctx.strokeStyle = "#f59e0b";
    } else {
      ctx.fillStyle = this.bubbleColor;
      ctx.strokeStyle = "#10b981";
    }

    ctx.fill();
    ctx.lineWidth = 1;
    ctx.setLineDash(this.state === "emi_warning" ? [5, 5] : []);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(this.x, this.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = this.color;
    ctx.fill();

    ctx.fillStyle = "#fff";
    ctx.font = "10px Arial";
    ctx.fillText(this.id, this.x - 10, this.y - 12);

    if (this.state === "emergency_brake") {
      ctx.fillStyle = "#ef4444";
      ctx.font = "bold 10px Arial";
      ctx.fillText("! STOP !", this.x - 20, this.y + 20);
    } else if (this.state === "caution") {
      ctx.fillStyle = "#facc15";
      ctx.font = "bold 10px Arial";
      ctx.fillText("CAUTION", this.x - 20, this.y + 20);
    } else if (this.state === "braking") {
      ctx.fillStyle = "#ef4444";
      ctx.font = "bold 10px Arial";
      ctx.fillText("BRAKE", this.x - 15, this.y + 20);
    }
  }
}

class RogueDrone {
  constructor(canvasWidth = 800) {
    this.x = Math.random() * canvasWidth;
    this.y = 50;
    this.vx = (Math.random() - 0.5) * 3;
    this.vy = 1 + Math.random();
    this.detected = false;
  }

  update(canvas, towers, addLog) {
    this.x += this.vx;
    this.y += this.vy;

    let isTracked = false;
    towers.forEach((t) => {
      const dist = Math.hypot(this.x - t.x, this.y - t.y);
      if (dist < t.range) {
        isTracked = true;
        const ctx = canvas.getContext("2d");
        ctx.beginPath();
        ctx.moveTo(t.x, t.y);
        ctx.lineTo(this.x, this.y);
        ctx.strokeStyle = "rgba(239, 68, 68, 0.6)";
        ctx.lineWidth = 2;
        ctx.stroke();

        if (!this.detected) {
          this.detected = true;
          addLog(`ISAC ALERT: Intruder tracked at ${this.x.toFixed(0)}m`, "alert");
        }
      }
    });

    return this.y < canvas.height && this.x > 0 && this.x < canvas.width;
  }

  draw(ctx) {
    ctx.beginPath();
    ctx.moveTo(this.x, this.y - 10);
    ctx.lineTo(this.x - 10, this.y + 10);
    ctx.lineTo(this.x + 10, this.y + 10);
    ctx.fillStyle = "#ef4444";
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText("ROGUE", this.x - 15, this.y - 15);
  }
}

function App() {
  const canvasRef = useRef(null);
  const logPanelRef = useRef(null);
  const [config, setConfig] = useState({
    latency: 10,
    wind: 5,
    baseSafetyMargin: 40,
    platoonMargin: 15,
    isPlatoonMode: false,
    showEMI: false,
    isacRange: 150,
  });
  const [stats, setStats] = useState({
    droneCount: 0,
    headway: "-- s",
    efficiency: "100%",
  });
  const [logs, setLogs] = useState([
    { time: "12:00:01", type: "sys", msg: "System Init: MTR East Rail Corridor" },
    { time: "12:00:02", type: "sys", msg: "Moving Block Safety Logic: Active" },
  ]);

  // Simulation state
  const simulationRef = useRef({
    railPath: [],
    totalPathLen: 0,
    drones: [],
    towers: [],
    substations: [],
    rogues: [],
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const sim = simulationRef.current;

    // Initialize simulation
    resize();
    initSimulation();

    function resize() {
      const isMobile = window.innerWidth <= 768;
      if (isMobile) {
        canvas.width = window.innerWidth;
        canvas.height = Math.max(400, window.innerHeight - 300); // Account for sidebar height
      } else {
        canvas.width = window.innerWidth - 320;
        canvas.height = window.innerHeight;
      }
      generateRailPath();
      generateInfrastructure();
    }

    function generateRailPath() {
      sim.railPath = [];
      const w = canvas.width;
      const h = canvas.height;
      for (let x = 0; x <= w; x += 4) {
        const y = h / 2 + Math.sin(x * 0.005) * (h * 0.3);
        sim.railPath.push({ x, y });
      }
      sim.totalPathLen = sim.railPath.length;
    }

    function generateInfrastructure() {
      sim.towers = [];
      sim.substations = [];
      const w = canvas.width;

      for (let x = 100; x < w; x += 250) {
        const y = canvas.height / 2 + Math.sin(x * 0.005) * (canvas.height * 0.3) - 60;
        sim.towers.push({ x, y, range: config.isacRange });

        if (Math.random() > 0.5) {
          sim.substations.push({ x: x, y: y + 80, radius: 120, strength: 0.8 });
        }
      }
    }

    function initSimulation() {
      // Initial Fleet
      for (let i = 0; i < 3; i++) {
        let d = new Drone(`SF-${100 + i}`, 1.5);
        d.pathIndex = i * Math.min(250, canvas.width / 4); // Responsive spacing
        sim.drones.push(d);
      }
    }

    function checkSeparation() {
      let sortedDrones = [...sim.drones].sort((a, b) => b.pathIndex - a.pathIndex);

      for (let i = 0; i < sortedDrones.length; i++) {
        let follower = sortedDrones[i];
        let leader = i === 0 ? sortedDrones[sortedDrones.length - 1] : sortedDrones[i - 1];

        if (follower === leader) continue;

        let dist = leader.pathIndex - follower.pathIndex;
        if (dist < 0) dist += sim.totalPathLen;

        let requiredSep = follower.bubbleRadius + leader.bubbleRadius;

        if (dist < requiredSep) {
          follower.currentSpeed *= 0.9;
          if (follower.currentSpeed < 0.1) follower.currentSpeed = 0;
          follower.state = "braking";
        } else if (dist < requiredSep * 1.5) {
          follower.currentSpeed = Math.min(follower.currentSpeed, leader.currentSpeed);
          follower.state = "cruising";
        } else {
          if (follower.currentSpeed < follower.baseSpeed) {
            follower.currentSpeed += 0.05;
          }
          follower.state = "cruising";
        }
      }
    }

    function checkThreats() {
      sim.drones.forEach((d) => {
        let threatDetected = false;
        let criticalThreat = false;

        sim.rogues.forEach((r) => {
          const dx = d.x - r.x;
          const dy = d.y - r.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < d.bubbleRadius) {
            criticalThreat = true;
          } else if (dist < d.bubbleRadius * 2.5) {
            threatDetected = true;
          }
        });

        if (criticalThreat) {
          d.currentSpeed = 0;
          d.state = "emergency_brake";
        } else if (threatDetected) {
          d.currentSpeed *= 0.3;
          d.state = "caution";
        }
      });
    }

    function applyEMI() {
      sim.drones.forEach((d) => {
        let inZone = false;
        sim.substations.forEach((sub) => {
          const dx = d.x - sub.x;
          const dy = d.y - sub.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < sub.radius) {
            inZone = true;
            d.bubbleRadius *= 1.3;
            if (config.showEMI) {
              d.jitterX = (Math.random() - 0.5) * 4;
              d.jitterY = (Math.random() - 0.5) * 4;
            }
            if (d.state !== "emergency_brake" && d.state !== "caution") {
              d.state = "emi_warning";
            }
          }
        });
      });
    }

    function updateStats() {
      const droneCount = sim.drones.length;
      let totalSpeed = sim.drones.reduce((sum, d) => sum + d.currentSpeed, 0);
      let totalBase = sim.drones.reduce((sum, d) => sum + d.baseSpeed, 0);
      let eff = totalBase > 0 ? Math.round((totalSpeed / totalBase) * 100) : 100;

      setStats({
        droneCount,
        headway: "-- s",
        efficiency: `${eff}%`,
      });
    }

    function addLog(msg, type = "normal") {
      const time = new Date().toLocaleTimeString("en-GB");
      setLogs((prev) => [...prev, { time, type, msg }]);
    }

    function loop() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw Infrastructure
      ctx.beginPath();
      ctx.strokeStyle = "#334155";
      ctx.lineWidth = 4;
      for (let p of sim.railPath) ctx.lineTo(p.x, p.y);
      ctx.stroke();

      if (config.showEMI) {
        sim.substations.forEach((s) => {
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(245, 158, 11, 0.1)";
          ctx.fill();
          ctx.strokeStyle = "rgba(245, 158, 11, 0.3)";
          ctx.setLineDash([4, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = "#f59e0b";
          ctx.fillText("⚡ 25kV EMI", s.x - 25, s.y);
        });
      }

      sim.towers.forEach((t) => {
        ctx.fillStyle = "#475569";
        ctx.fillRect(t.x - 4, t.y, 8, 15);
        ctx.beginPath();
        ctx.arc(t.x, t.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = "#3b82f6";
        ctx.fill();
        let scale = (Date.now() % 2000) / 2000;
        ctx.beginPath();
        ctx.arc(t.x, t.y, scale * t.range, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(59, 130, 246, ${0.3 - scale * 0.3})`;
        ctx.stroke();
      });

      // LOGIC STEPS
      checkSeparation();
      applyEMI();
      checkThreats();

      // UPDATE & DRAW DRONES
      sim.drones.forEach((d) => {
        d.update(sim.railPath, sim.totalPathLen, config);
        d.draw(ctx, config);
      });

      // ROGUES
      sim.rogues = sim.rogues.filter((r) => r.update(canvas, sim.towers, addLog));
      sim.rogues.forEach((r) => r.draw(ctx));

      updateStats();
      requestAnimationFrame(loop);
    }

    loop();

    window.addEventListener("resize", resize);

    return () => {
      window.removeEventListener("resize", resize);
    };
  }, [config]);

  const handleLatencyChange = (e) => {
    setConfig((prev) => ({ ...prev, latency: parseInt(e.target.value) }));
  };

  const handleEMIToggle = (e) => {
    setConfig((prev) => ({ ...prev, showEMI: e.target.checked }));
  };

  const handlePlatoonToggle = (e) => {
    setConfig((prev) => ({ ...prev, isPlatoonMode: e.target.checked }));
  };

  const addDrone = () => {
    const sim = simulationRef.current;
    let speed = 1.0 + Math.random();
    let d = new Drone(`SF-${100 + sim.drones.length}`, speed);
    d.pathIndex = 0;
    sim.drones.push(d);
  };

  const spawnRogue = () => {
    const sim = simulationRef.current;
    const canvas = canvasRef.current;
    const canvasWidth = canvas ? canvas.width : 800;
    sim.rogues.push(new RogueDrone(canvasWidth));
  };

  return (
    <div className="app">
      <div className="sidebar">
        <div className="brand">UAV GUARD UTM</div>
        <div className="sub-brand">East Rail Line Corridor • Sector 4</div>

        <div className="control-group">
          <div className="control-label">
            <span>5G Network Latency</span>
            <span className="metric-value">{config.latency} ms</span>
          </div>
          <input type="range" min="1" max="500" value={config.latency} onChange={handleLatencyChange} />
          <div className="control-note">Affects reaction time and bubble size (Equation 1).</div>
        </div>

        <div className="control-group">
          <div className="control-label">
            <span>Environment</span>
          </div>
          <div className="toggle-row">
            <span>Show EMI Zones (25kV)</span>
            <label className="switch">
              <input type="checkbox" checked={config.showEMI} onChange={handleEMIToggle} />
              <span className="slider"></span>
            </label>
          </div>
          <div className="toggle-row">
            <span>Platoon Mode (V2V)</span>
            <label className="switch">
              <input type="checkbox" checked={config.isPlatoonMode} onChange={handlePlatoonToggle} />
              <span className="slider"></span>
            </label>
          </div>
          <div className="control-note">EMI Zones cause sensor jitter. Platoon mode enables tight virtual coupling.</div>
        </div>

        <div className="control-group">
          <div className="control-label">
            <span>Operations</span>
          </div>
          <button className="btn-blue" onClick={addDrone}>
            Launch Logistics Drone
          </button>
          <button onClick={spawnRogue}>Spawn Intruder</button>
        </div>

        <div className="log-panel" ref={logPanelRef}>
          {logs.map((log, index) => (
            <div key={index} className="log-entry">
              <span className="log-time">{log.time}</span> <span className={`log-${log.type}`}>{log.msg}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="main-view">
        <canvas ref={canvasRef}></canvas>

        <div className="overlay-stats">
          <div className="stats-title">CORRIDOR STATUS</div>
          <div className="stat-row">
            <span>Active Drones:</span>
            <span>{stats.droneCount}</span>
          </div>
          <div className="stat-row">
            <span>Avg Headway:</span>
            <span>{stats.headway}</span>
          </div>
          <div className="stat-row">
            <span>Efficiency:</span>
            <span>{stats.efficiency}</span>
          </div>
          <div className="badge-container">
            <span className="badge badge-secure">MB-Active</span>
            {config.isPlatoonMode && <span className="badge badge-emi">V2V-PLATOON</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
