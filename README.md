# UAV Guard

**Team:** MTR - Keep Data Moving  
**Hackathon Track:** Challenge 4: Empowering Low-Altitude Economic Growth through UAV Traffic Management for Enterprise Applications  

![Keep Data Moving Demo](./public/P038_Keep%20Data%20Moving%20Demo.png)

## Overview
Unmanned Aerial Vehicle (UAV) management in Hong Kong is highly challenging due to the lack of a centralised Unmanned Aircraft System Traffic management (UTM), difficulties in drone monitoring and silent (uncooperative) drone detection, and uncertain commercial returns. 

**UAV Guard** is our solution: a centralised, high-performance UTM platform designed to serve different stakeholders through a Service + Data (S+D) Model.

## Key Innovations

### 1. Centralised Management
* **Fixed Routes:** We provide fixed commercial corridors (like highways) with dedicated Up-Track, Down-Track, and No-Fly Zones to prevent collisions.
* **Moving Block Navigation:** For UAVs without fixed routes, we use a "Moving Block" Performance-Based Navigation (PBN) system, allocating varying "sensor bubbles" based on drone capabilities.
* **AI Advisory:** The system generates AI flight suggestions and Risk Indices for safe operation.

### 2. Registration System & Security Gatekeeper
* **Universal Registration:** Integrated system for both drone owners and the drones themselves, covering Natural Persons, Government Agencies, Manufacturers, and Foreigners.
* **Zero-Trust Multi-Layered Enforcement:**
  * **Layer 1 (Software):** Mandatory continuous 5G Network Remote ID broadcasting acting as an encrypted "Digital License Plate".
  * **Layer 2 (Hardware):** Fusing UTM software with physical Counter-UAS sensors (IoT detection).
  * **Automated Response:** The system spots "invisible" drones instantly, reroutes commercial traffic, and hands off data to law enforcement.

### 3. UTM Dual Portal
* **Public Portal:** An accessible hub visualizing permanent No-Fly Zones and temporary flight restrictions (TFRs) to prevent accidental airspace incursions.
* **Enterprise Portal:** A secure environment for commercial operators allowing seamless ID verification, third-party liability insurance validation, and instant approval for pre-defined low-risk flight plans.

### 4. Service + Data (S+D) Business Model
#### Service 
* **B2G SaaS:** Providing regulators with a "God’s-eye view" dashboard and automated audit trails.
* **B2B SaaS:** Premium "Priority Time Slot" or subscriptions for logistics giants.
* **API Tolls:** "Pay-Per-Flight" microtransactions for SMEs to lower the barrier to entry.
#### Data
* **InsurTech Partnerships:** Selling flight data and "Risk Heatmaps" to enable dynamic Usage-Based Insurance (UBI).
* **Environmental DaaS:** Selling 3D micro-climate telemetry to the HK Observatory and urban planners.

## Minimum Viable Product (MVP) & Tech Stack
The entire UTM is Open-Source and available on GitHub.

* **Frontend:** ReactJS, HTML5, CSS3, JavaScript.
* **Tools:** Visual Studio Code, GitHub.
* **Data Sources:** * Environmental Data: Hong Kong Observatory
  * 2D & 3D Maps: OpenStreetMap
  * No Fly Zones: CAD Electronic Portal for Small Unmanned Aircraft (eSUA)

## ESG Vision
* **Environmental:** Replaces fossil-fuel fleets for cargo transport with electric energy for deep decarbonisation, and uses 3D point-to-point routing to eliminate idling.
* **Social:** Replaces high-altitude physical labor with drones to eliminate fatal fall risks.
* **Governance:** Fully digitises flight plans for immutable audit trails, verifies pilot licenses/insurance to prevent "dark flights," and offers 4D incident replays for objective liability claims.

## Ecosystem Roles
* **System Owner & Regulator:** Hong Kong Government Civil Aviation Department (CAD).
* **Platform Provider:** HKT Limited (for technical implementation and maintenance).
* **Drones Owner & UTM User:** Enterprises.

---

## 🏗️ Build & Deploy

```bash
# Build for production
npm run build

# Preview production build
npm run preview

# Deploy to GitHub Pages
npm run deploy
```

---

## 📚 Project Team

**MTR - Team Keep Data Moving**
- GS1 IoT Data Hackathon 2026
- Focus: Safe autonomous drone operations in critical infrastructure

---

## 📄 License

This project is for educational and demonstration purposes.
Made by Team Keep Data Moving - GS1 - IoT - Data - Hackathon - 2026

**Status**: Initial Submission --> Hack Day --> Pitch Day (GS1 IoT Data Hackathon 2026)

---

## 🔗 Related Technologies

- **5G-A**: 5G Advanced for ultra-reliable low-latency communication
- **UTM Systems**: FAA-compliant drone traffic management
- **ISAC**: Integrated Sensing and Communication for dual-use networks

---
*Built with passion for safer skies and smarter UAV* ✈️🚀
