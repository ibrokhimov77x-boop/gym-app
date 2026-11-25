// Machine registry. A factory(opts) returns { group, parts: { name: Object3D }, anchors: { name: Vector3 (world) },
//   cableStacks?: { anchorName: stackPartName }, stackRatio?: number, update?(): void }.
// Batch files export `default { machineKey: factory }`; they are registered here in order.
import * as THREE from 'three';
import common from './common.js';
import chestShoulders from './chest_shoulders.js';
import back from './back.js';
import legs from './legs.js';
import posteriorCore from './posterior_core.js';

const registry = new Map();

export function registerMachine(key, factory) {
  if (registry.has(key)) console.warn(`[explainer] machine "${key}" registered twice — the later one wins`);
  registry.set(key, factory);
}

for (const batch of [common, chestShoulders, back, legs, posteriorCore]) {
  for (const [key, factory] of Object.entries(batch)) registerMachine(key, factory);
}

export const hasMachine = (key) => registry.has(key);
export const machineKeys = () => [...registry.keys()];

/**
 * Build a machine. Unknown key → console.warn and null (the exercise is shown without it); never throws.
 * Generic opts handled here for every machine: at: [x, y, z] (world offset), yaw: degrees about +Y.
 */
export function buildMachine(key, opts = {}) {
  if (!key) return null;
  const factory = registry.get(key);
  if (!factory) { console.warn(`[explainer] unknown machine "${key}" — showing the exercise without it`); return null; }
  let m;
  try { m = factory(opts); } catch (e) { console.error(`[explainer] machine "${key}" failed to build`, e); return null; }
  m.parts ||= {}; m.anchors ||= {};
  m.group.name = `machine:${key}`;
  if (opts.at || opts.yaw) {
    if (opts.at) m.group.position.fromArray(opts.at);
    if (opts.yaw) m.group.rotation.y = THREE.MathUtils.degToRad(opts.yaw);
    m.group.updateMatrixWorld(true);
    for (const a of Object.values(m.anchors)) a.applyMatrix4(m.group.matrixWorld);
  }
  m.group.traverse((o) => { if (o.isMesh) { o.castShadow = !o.userData.noShadow; o.receiveShadow = true; } });
  return m;
}
