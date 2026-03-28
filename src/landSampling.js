/**
 * Land-only sampling: Victoria Harbour sits between HK Island north shore and Kowloon;
 * we draw only from land boxes so route endpoints are not in the water.
 */

import { pointInAnyNfz } from "./nfzGeometry.js";

function randomInBBox(bbox, rand) {
  return [
    bbox[0] + rand() * (bbox[2] - bbox[0]),
    bbox[1] + rand() * (bbox[3] - bbox[1]),
  ];
}

export function clipBoxToBBox(inner, outer) {
  const out = [
    Math.max(inner[0], outer[0]),
    Math.max(inner[1], outer[1]),
    Math.min(inner[2], outer[2]),
    Math.min(inner[3], outer[3]),
  ];
  return out[0] < out[2] && out[1] < out[3] ? out : null;
}

/**
 * Two strips inside the drone flight bbox: south (HK Island) and north (Kowloon),
 * with a lat gap so samples avoid harbour water.
 */
export function droneLandBoxesForBBox(flightBbox) {
  const island = clipBoxToBBox([114.136, 22.262, 114.200, 22.288], flightBbox);
  const kowloon = clipBoxToBBox([114.158, 22.292, 114.200, 22.304], flightBbox);
  const boxes = [];
  if (island) boxes.push(island);
  if (kowloon) boxes.push(kowloon);
  return boxes.length ? boxes : [flightBbox];
}

/** Kowloon urban core (trimmed south) — delivery bbox is already mostly land. */
export function deliveryLandBoxesForBBox(deliveryBbox) {
  const land = clipBoxToBBox([114.152, 22.288, 114.220, 22.345], deliveryBbox);
  return land ? [land] : [deliveryBbox];
}

export function randomPointInLandBoxes(landBoxes, rand) {
  const b = landBoxes[Math.floor(rand() * landBoxes.length)];
  return randomInBBox(b, rand);
}

/** Endpoint sample: inside land boxes and outside NFZ (red zones). */
export function randomLandPointOutsideNfz(landBoxes, nfzContext, rand, maxTries = 200) {
  for (let i = 0; i < maxTries; i++) {
    const p = randomPointInLandBoxes(landBoxes, rand);
    if (!nfzContext?.polygons?.length || !pointInAnyNfz(p[0], p[1], nfzContext)) {
      return p;
    }
  }
  return randomPointInLandBoxes(landBoxes, rand);
}

export function pointInLandBoxes(lng, lat, landBoxes) {
  return landBoxes.some(
    (b) => lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3]
  );
}
