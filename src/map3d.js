/**
 * 3D view: extruded buildings only (no raster terrain — avoids GPU/network load and map.loaded() churn).
 */

const CARTO_SOURCE_ID = "carto";
const BUILDINGS_3D_LAYER_ID = "hkt-buildings-3d";

function findInsertBeforeId(map) {
  const preferred = [
    "boundary_country_outline",
    "boundary_country_inner",
    "place_city",
    "place_town",
  ];
  for (const id of preferred) {
    if (map.getLayer(id)) return id;
  }
  const layers = map.getStyle()?.layers ?? [];
  const idx = layers.findIndex((l) => l.id === "building-top");
  if (idx >= 0 && idx + 1 < layers.length) {
    return layers[idx + 1].id;
  }
  return undefined;
}

function showFlatBuildings(map, visible) {
  const v = visible ? "visible" : "none";
  for (const id of ["building", "building-top"]) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, "visibility", v);
    }
  }
}

/**
 * @param {import('maplibre-gl').Map} map
 */
export function enableMap3D(map) {
  if (!map?.getSource) return;

  if (!map.getSource(CARTO_SOURCE_ID)) {
    return;
  }

  showFlatBuildings(map, false);

  if (!map.getLayer(BUILDINGS_3D_LAYER_ID)) {
    const beforeId = findInsertBeforeId(map);
    try {
      map.addLayer(
        {
          id: BUILDINGS_3D_LAYER_ID,
          type: "fill-extrusion",
          source: CARTO_SOURCE_ID,
          "source-layer": "building",
          minzoom: 13,
          paint: {
            "fill-extrusion-color": "#3d4d63",
            "fill-extrusion-opacity": 0.88,
            "fill-extrusion-height": [
              "case",
              [">", ["to-number", ["get", "render_height"], 0], 0.5],
              ["to-number", ["get", "render_height"], 0],
              [">", ["to-number", ["get", "height"], 0], 0],
              ["*", ["to-number", ["get", "height"], 0], 3.28],
              15,
            ],
            "fill-extrusion-base": [
              "to-number",
              ["get", "render_min_height"],
              0,
            ],
            "fill-extrusion-vertical-gradient": false,
          },
        },
        beforeId
      );
    } catch (e) {
      console.warn("[3D] extrusion layer:", e);
      showFlatBuildings(map, true);
    }
  } else {
    map.setLayoutProperty(BUILDINGS_3D_LAYER_ID, "visibility", "visible");
  }
}

/**
 * @param {import('maplibre-gl').Map} map
 */
export function disableMap3D(map) {
  if (!map?.getSource) return;

  try {
    map.setTerrain(null);
  } catch (_) {
    /* ignore */
  }

  if (map.getLayer(BUILDINGS_3D_LAYER_ID)) {
    try {
      map.setLayoutProperty(BUILDINGS_3D_LAYER_ID, "visibility", "none");
    } catch (_) {
      /* ignore */
    }
  }

  showFlatBuildings(map, true);
}
