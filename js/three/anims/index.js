// Animation spec registry: aggregates the batch files (each `export default [ ...specs ]`).
// Spec format: docs/3D_CONTRACT.md + webapp/js/three/README.md (authoring guide with numbers and examples).
import chestShoulders from './chest_shoulders.js';
import back from './back.js';
import cablesArms from './cables_arms.js';
import legs from './legs.js';
import posteriorCore from './posterior_core.js';

const SPECS = new Map();
for (const batch of [chestShoulders, back, cablesArms, legs, posteriorCore]) {
  for (const spec of batch) {
    if (SPECS.has(spec.id)) console.warn(`[explainer] duplicate animation spec "${spec.id}" — the later one wins`);
    SPECS.set(spec.id, spec);
  }
}

/** Spec for an exercise id, or null (the explainer then shows a standing figure with the muscles lit). */
export const getSpec = (id) => SPECS.get(id) || null;
export const specIds = () => [...SPECS.keys()];
