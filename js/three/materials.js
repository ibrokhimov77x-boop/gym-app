// Shared materials and procedural textures for the 3D explainer.
// Materials are cached per module (one set for all explainers on the page) — three.js compiles them per renderer,
// and disposing them only frees GPU programs, so `disposeMaterials()` is safe even if another explainer re-uses them.
import * as THREE from 'three';

let cache = null;

/** Canvas helper (textures are generated once, no network). */
function canvasTexture(w, h, draw, { repeat = null, srgb = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.anisotropy = 4;
  return t;
}

/** Fine horizontal streaks → brushed-metal roughness variation. */
function brushedRoughness() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = 'rgb(120,120,120)'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const y = Math.random() * h, v = 90 + Math.random() * 80;
      g.strokeStyle = `rgba(${v},${v},${v},0.35)`;
      g.lineWidth = 0.5 + Math.random();
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + (Math.random() - 0.5) * 2); g.stroke();
    }
  }, { repeat: [1, 1] });
}

/** Diamond knurl pattern used as a bump map on bar/dumbbell handles. */
function knurlBump() {
  return canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#000'; g.lineWidth = 3;
    for (let i = -w; i < w * 2; i += 8) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke();
      g.beginPath(); g.moveTo(i, h); g.lineTo(i + h, 0); g.stroke();
    }
  }, { repeat: [12, 3] });
}

/** Hole pattern for rack uprights (dark round holes every 5 cm, on a steel-coloured strip). */
function rackHoles() {
  return canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#151515';
    g.beginPath(); g.arc(w / 2, h / 2, w * 0.17, 0, Math.PI * 2); g.fill();
  }, { repeat: [1, 46], srgb: true });
}

/** Subtle stitched upholstery: faint quilting lines across the pad. */
function upholsteryBump() {
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2500; i++) { // leather grain
      const v = 110 + Math.random() * 40;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
    }
  }, { repeat: [4, 8] });
}

/**
 * Muscle material: clay when inactive; glowing red / amber when working. A Fresnel rim term is injected into the
 * emissive so active muscles get a soft "glow" outline even without post-processing. Driven per frame through
 * `material.userData.rim.value` (no allocations).
 */
export function createMuscleMaterial(base) {
  const m = new THREE.MeshPhysicalMaterial({
    color: base.color.clone(), roughness: 0.5, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.45,
    sheen: base.sheen, sheenRoughness: base.sheenRoughness, sheenColor: base.sheenColor.clone(),
    emissive: new THREE.Color(0x000000), emissiveIntensity: 1,
  });
  m.userData.rim = { value: 0 };
  m.userData.rimColor = { value: new THREE.Color(0xff5a3c) };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = m.userData.rim;
    shader.uniforms.uRimColor = m.userData.rimColor;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uRim;\nuniform vec3 uRimColor;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float fres = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 2.2);
        totalEmissiveRadiance += uRimColor * fres * uRim;`);
  };
  m.customProgramCacheKey = () => 'muscle-rim';
  return m;
}

export function getMaterials() {
  if (cache) return cache;
  const brushed = brushedRoughness();
  const knurl = knurlBump();
  const holes = rackHoles();
  const leather = upholsteryBump();
  const M = {
    // Figure: warm light-grey clay with a soft velvet sheen (reads as a sculpted mannequin).
    clay: new THREE.MeshPhysicalMaterial({
      color: 0xc9c2b9, roughness: 0.58, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.45,
      sheen: 0.5, sheenRoughness: 0.55, sheenColor: new THREE.Color(0xfff4ea),
    }),
    // Equipment
    steel: new THREE.MeshStandardMaterial({ color: 0xb9bec6, metalness: 0.8, roughness: 0.35, roughnessMap: brushed }),
    frame: new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.55, roughness: 0.42 }),  // powder-coated frame
    chrome: new THREE.MeshStandardMaterial({ color: 0xe6e9ee, metalness: 1.0, roughness: 0.16 }),
    knurl: new THREE.MeshStandardMaterial({ color: 0xc9cdd3, metalness: 0.9, roughness: 0.38, bumpMap: knurl, bumpScale: 1.2 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x1c1d20, metalness: 0, roughness: 0.82 }),
    upholstery: new THREE.MeshPhysicalMaterial({
      color: 0x1d1f24, roughness: 0.6, metalness: 0, bumpMap: leather, bumpScale: 0.6,
      sheen: 0.6, sheenRoughness: 0.4, sheenColor: new THREE.Color(0x56607a), clearcoat: 0.15, clearcoatRoughness: 0.5,
    }),
    plate: new THREE.MeshStandardMaterial({ color: 0x18191c, metalness: 0.25, roughness: 0.55 }),
    stack: new THREE.MeshStandardMaterial({ color: 0x3a3e45, metalness: 0.6, roughness: 0.4 }),
    cable: new THREE.MeshStandardMaterial({ color: 0x15161a, metalness: 0.3, roughness: 0.5 }),
    rope: new THREE.MeshStandardMaterial({ color: 0x23252b, metalness: 0, roughness: 0.9 }),
    accent: new THREE.MeshStandardMaterial({ color: 0xff5a1f, metalness: 0.2, roughness: 0.4 }), // pins, knobs
    frameRed: new THREE.MeshStandardMaterial({ color: 0xb5131c, metalness: 0.35, roughness: 0.42 }), // red powder coat (selectorized/plate-loaded machines)
    foam: new THREE.MeshStandardMaterial({ color: 0x24262c, metalness: 0, roughness: 0.95 }),
    holes: new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.55, roughness: 0.42, map: holes }),
    rims: new Map(),
  };
  M.textures = [brushed, knurl, holes, leather];
  cache = M;
  return M;
}

/** Coloured plate rim material (cached by colour). */
export function rimMaterial(hex) {
  const M = getMaterials();
  if (!M.rims.has(hex)) M.rims.set(hex, new THREE.MeshStandardMaterial({ color: hex, metalness: 0.2, roughness: 0.45 }));
  return M.rims.get(hex);
}

/** Free GPU resources of the shared set (they are re-created lazily on next use). */
export function disposeMaterials() {
  if (!cache) return;
  for (const [k, v] of Object.entries(cache)) {
    if (v && v.isMaterial) v.dispose();
    if (k === 'rims') v.forEach((m) => m.dispose());
  }
  cache.textures.forEach((t) => t.dispose());
  cache = null;
}
