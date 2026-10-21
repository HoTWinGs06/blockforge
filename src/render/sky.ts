/**
 * BlockForge — sky.
 *
 * A vertical gradient on an inverted sphere plus a sun disc that agrees with
 * the scene's directional light. Everything here is generated in code - there
 * is no skybox image in the repository.
 *
 * The gradient is drawn into a small canvas and used as the sphere's texture,
 * which keeps it cheap and lets the palette live in one place.
 */

import * as THREE from "three";
import { FOG_FAR } from "./viewDistance.js";

/** The sky's palette, top to horizon. BlockForge's own colours. */
const SKY_TOP = "#3f6fb0";
const SKY_MID = "#7ea8dc";
const SKY_HORIZON = "#c9dcef";
const SKY_BELOW = "#8a8478";

/** The radius of the sky sphere. It must enclose the far plane. */
const SKY_RADIUS = 400;

/**
 * Draw the sky gradient into a canvas.
 *
 * Exported so a test can assert it produced real pixels - a sky that renders
 * as a flat colour is a bug that is very hard to see in a screenshot.
 */
export function buildSkyCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas context unavailable - cannot build the sky");
  }

  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, SKY_TOP);
  gradient.addColorStop(0.45, SKY_MID);
  gradient.addColorStop(0.52, SKY_HORIZON);
  gradient.addColorStop(0.56, SKY_BELOW);
  gradient.addColorStop(1, SKY_BELOW);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  return canvas;
}

/**
 * Build the sky: a gradient dome plus a sun disc.
 *
 * The dome is an inverted sphere (BackSide) with depth writing off, so it
 * always sits behind everything. The sun is a billboarded sprite that is
 * placed in the same direction as the scene's directional light, so the
 * bright spot in the sky and the lit side of the blocks agree.
 */
export function buildSky(sunDirection: THREE.Vector3): THREE.Group {
  const group = new THREE.Group();
  group.name = "sky";

  const texture = new THREE.CanvasTexture(buildSkyCanvas());
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(SKY_RADIUS, 24, 16),
    new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    }),
  );
  dome.name = "sky-dome";
  group.add(dome);

  // The sun disc. It sits far away in the light's direction.
  const sunTexture = new THREE.CanvasTexture(buildSunCanvas());
  sunTexture.colorSpace = THREE.SRGBColorSpace;
  const sunMaterial = new THREE.SpriteMaterial({
    map: sunTexture,
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const sun = new THREE.Sprite(sunMaterial);
  sun.name = "sky-sun";
  const dir = sunDirection.clone().normalize().multiplyScalar(SKY_RADIUS * 0.8);
  sun.position.copy(dir);
  sun.scale.setScalar(90);
  group.add(sun);

  return group;
}

/** Draw the sun disc into a canvas. */
function buildSunCanvas(): HTMLCanvasElement {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas context unavailable - cannot build the sun");
  }

  const centre = size / 2;
  const glow = ctx.createRadialGradient(centre, centre, 0, centre, centre, centre);
  glow.addColorStop(0, "rgba(255,255,255,1)");
  glow.addColorStop(0.25, "rgba(255,246,214,0.95)");
  glow.addColorStop(0.45, "rgba(255,235,180,0.35)");
  glow.addColorStop(1, "rgba(255,235,180,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  return canvas;
}

/** The distance the sky is visible through, matching the scene fog. */
export const SKY_FAR = FOG_FAR;
