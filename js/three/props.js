// Free equipment: dumbbell, barbell, ez_bar, triceps_rope, d_handle, v_handle, lat_bar, plate, hip_pad.
// Local frames: a hand-held prop is centred on the fist centre with its grip axis along local Z (the thumb axis of the
// hand). A two-handed prop ("attach: 'handsMid'") has local X along left-hand → right-hand… reversed (X points to the
// figure's LEFT hand), local Y towards its cable anchor (or world up). See README.md.
import * as THREE from 'three';
import { getMaterials, rimMaterial } from './materials.js';
import { lathe, discProfile, unitCylinder, stretchBetween } from './geo.js';

// Plate catalogue: kg → [diameter, thickness, rim colour]. Bumper-style: all ≥10 kg plates share the 45 cm diameter.
const PLATES = [[25, 0.45, 0.07, 0xd6342c], [20, 0.45, 0.06, 0x2a5bd7], [15, 0.45, 0.05, 0xf2c12e], [10, 0.45, 0.04, 0x2f9e44],
  [5, 0.23, 0.03, 0xe8e8e8], [2.5, 0.19, 0.022, 0xd6342c], [1.25, 0.16, 0.016, 0xc0c4ca]];

/** Greedy split of kg per side into plates (heaviest inside). */
export function platesFor(kg) {
  const out = [];
  let rest = kg;
  for (const p of PLATES) while (rest >= p[0] - 1e-6) { out.push(p); rest -= p[0]; }
  return out;
}

/** A plate (axis Y, centred): black body with recessed hub, coloured rim band. */
export function buildPlate(kg) {
  const [, dia, th, rimCol] = PLATES.find((p) => p[0] === kg) || PLATES[1];
  const M = getMaterials(), r = dia / 2, g = new THREE.Group();
  const body = new THREE.Mesh(lathe([
    [0.026, -th * 0.5], [0.045, -th * 0.5], [0.05, -th * 0.36], [r * 0.82, -th * 0.36], [r * 0.86, -th * 0.5],
    [r - 0.006, -th * 0.5], [r - 0.006, th * 0.5], [r * 0.86, th * 0.5], [r * 0.82, th * 0.36], [0.05, th * 0.36],
    [0.045, th * 0.5], [0.026, th * 0.5], [0.026, -th * 0.5],
  ], 40), M.plate);
  const rim = new THREE.Mesh(lathe(discProfile(r, th * 0.96, Math.min(0.006, th * 0.25), r - 0.008), 40), rimMaterial(rimCol));
  const hub = new THREE.Mesh(lathe(discProfile(0.05, th * 1.02, 0.004, 0.026), 24), M.steel);
  for (const m of [body, rim, hub]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
  g.userData.thickness = th;
  return g;
}

const mesh = (geo, mat, shadow = true) => {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
};
const cylX = (r, len, seg = 20) => new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2);
const cylZ = (r, len, seg = 20) => new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2);

/** Sleeve with plates along +X from x0 (mirrored with dir = −1). */
function loadSleeve(group, x0, dir, kg) {
  let x = x0;
  for (const p of platesFor(kg)) {
    const plate = buildPlate(p[0]);
    plate.rotation.z = Math.PI / 2;
    plate.position.x = dir * (x + p[2] / 2);
    group.add(plate);
    x += p[2] + 0.002;
  }
  const clip = mesh(cylX(0.034, 0.028), getMaterials().accent);
  clip.position.x = dir * (x + 0.016);
  group.add(clip);
}

const BUILDERS = {
  /** Round pro-style dumbbell; head size scales with kg. Grip axis = local Z. */
  dumbbell({ kg = 10 } = {}) {
    const M = getMaterials(), g = new THREE.Group();
    const R = 0.045 + 0.002 * kg, L = 0.035 + 0.0016 * kg, half = 0.0675;
    g.add(mesh(cylZ(0.0155, half * 2 + 0.01), M.knurl));
    for (const s of [1, -1]) {
      const collar = mesh(cylZ(0.024, 0.012), M.chrome); collar.position.z = s * (half + 0.006); g.add(collar);
      const head = mesh(lathe(discProfile(R, L, Math.min(0.012, L * 0.3)), 32).rotateX(Math.PI / 2), M.rubber);
      head.position.z = s * (half + 0.012 + L / 2); g.add(head);
      const cap = mesh(cylZ(R * 0.42, 0.004), M.chrome); cap.position.z = s * (half + 0.012 + L + 0.001); g.add(cap);
    }
    return { object: g };
  },

  /** Olympic bar 2.2 m (shaft 1.31 m between collars), opts.kgPerSide plates, opts.pad = hip-thrust pad. Axis = X. */
  barbell({ kgPerSide = 20, pad = false } = {}) {
    const M = getMaterials(), g = new THREE.Group();
    g.add(mesh(cylX(0.014, 1.31, 18), M.knurl));
    for (const s of [1, -1]) {
      const collar = mesh(cylX(0.031, 0.03), M.chrome); collar.position.x = s * 0.67; g.add(collar);
      const sleeve = mesh(cylX(0.025, 0.415), M.chrome); sleeve.position.x = s * 0.8925; g.add(sleeve);
      const cap = mesh(cylX(0.027, 0.01), M.steel); cap.position.x = s * 1.095; g.add(cap);
      loadSleeve(g, 0.69, s, kgPerSide);
    }
    if (pad) g.add(BUILDERS.hip_pad().object);
    return { object: g };
  },

  /** EZ curl bar (W-bends in the horizontal plane), 1.2 m. Hands go at x = ±0.13. */
  ez_bar({ kgPerSide = 5 } = {}) {
    const M = getMaterials(), g = new THREE.Group();
    const pts = [[-0.39, 0], [-0.22, 0], [-0.16, 0.022], [-0.1, -0.018], [-0.04, 0.012], [0, 0.012]];
    const all = [...pts, ...pts.slice(0, -1).reverse().map(([x, z]) => [-x, z])].map(([x, z]) => new THREE.Vector3(x, 0, z));
    const curve = new THREE.CatmullRomCurve3(all, false, 'centripetal');
    g.add(mesh(new THREE.TubeGeometry(curve, 80, 0.0135, 10, false), M.knurl));
    for (const s of [1, -1]) {
      const collar = mesh(cylX(0.03, 0.025), M.chrome); collar.position.x = s * 0.4; g.add(collar);
      const sleeve = mesh(cylX(0.025, 0.19), M.chrome); sleeve.position.x = s * 0.51; g.add(sleeve);
      loadSleeve(g, 0.415, s, kgPerSide);
    }
    return { object: g };
  },

  /** Hip-thrust foam pad (sleeve around the bar), axis X. */
  hip_pad() {
    const M = getMaterials(), g = new THREE.Group();
    g.add(mesh(lathe(discProfile(0.055, 0.4, 0.02, 0.016), 28).rotateZ(Math.PI / 2), M.foam));
    return { object: g };
  },

  /** Single plate (axis Y): standalone or held. */
  plate({ kg = 20 } = {}) { return { object: buildPlate(kg) }; },

  /** Stirrup handle: grip along Z; the stirrup swings about the grip to point at its cable anchor. */
  d_handle() {
    const M = getMaterials(), g = new THREE.Group(), swing = new THREE.Group();
    g.add(mesh(cylZ(0.017, 0.115), M.rubber));
    const strapGeo = unitCylinder(0.0045, 8);
    for (const s of [1, -1]) {
      const strap = mesh(strapGeo, M.chrome);
      stretchBetween(strap, new THREE.Vector3(0, 0, s * 0.062), new THREE.Vector3(0.095, 0, s * 0.012));
      swing.add(strap);
      const end = mesh(cylZ(0.006, 0.012), M.chrome); end.position.z = s * 0.062; swing.add(end);
    }
    const ring = mesh(new THREE.TorusGeometry(0.014, 0.004, 8, 20), M.chrome);
    ring.position.set(0.108, 0, 0); ring.rotation.x = Math.PI / 2; swing.add(ring);
    g.add(swing);
    const cableLocal = new THREE.Vector3(0.122, 0, 0);
    const _a = new THREE.Vector3();
    return {
      object: g, cableLocal, cableParent: swing,
      update(api) {
        if (!api.anchor) return;
        g.worldToLocal(_a.copy(api.anchor));
        swing.rotation.z = Math.atan2(_a.y, _a.x);
      },
    };
  },

  /** Close-grip (V) row handle: two parallel grips at the hands, apex towards the anchor. */
  v_handle() {
    const M = getMaterials(), g = new THREE.Group();
    const grips = [mesh(cylZ(0.016, 0.12), M.rubber), mesh(cylZ(0.016, 0.12), M.rubber)];
    const barGeo = unitCylinder(0.009, 10);
    const bars = [mesh(barGeo, M.chrome), mesh(barGeo, M.chrome)];
    const apex = new THREE.Vector3(0, 0.13, 0), _p = new THREE.Vector3();
    g.add(...grips, ...bars);
    const ring = mesh(new THREE.TorusGeometry(0.014, 0.004, 8, 20), M.chrome);
    ring.position.copy(apex).y += 0.012; g.add(ring);
    return {
      object: g, cableLocal: new THREE.Vector3(0, 0.15, 0),
      update(api) { // grips follow the actual hand spacing (keeps the handle in both fists)
        const half = api.handSpan / 2;
        grips[0].position.x = half; grips[1].position.x = -half;
        stretchBetween(bars[0], _p.set(half, 0, 0), apex);
        stretchBetween(bars[1], _p.set(-half, 0, 0), apex);
      },
    };
  },

  /** Lat-pulldown bar 1.2 m with angled ends; rubber grips at |x| 0.41–0.58. Ring on top (local +Y). */
  lat_bar() {
    const M = getMaterials(), g = new THREE.Group();
    const pts = [[-0.6, -0.055], [-0.4, 0], [0.4, 0], [0.6, -0.055]].map(([x, y]) => new THREE.Vector3(x, y, 0));
    const path = new THREE.CurvePath();
    for (let i = 0; i < 3; i++) path.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
    g.add(mesh(new THREE.TubeGeometry(path, 60, 0.0135, 10, false), M.chrome));
    for (const s of [1, -1]) {
      const grip = mesh(cylX(0.018, 0.17), M.rubber);
      grip.position.set(s * 0.495, -0.026, 0); grip.rotation.z = s * Math.atan2(0.055, 0.2); g.add(grip);
    }
    const ring = mesh(new THREE.TorusGeometry(0.016, 0.0045, 8, 20), M.chrome);
    ring.position.y = 0.03; g.add(ring);
    return { object: g, cableLocal: new THREE.Vector3(0, 0.045, 0) };
  },

  /** Triceps rope: two strands from a clip to both fists, rubber stoppers below the hands. */
  triceps_rope() {
    const M = getMaterials(), g = new THREE.Group();
    const strandGeo = unitCylinder(0.011, 10);
    const strands = [mesh(strandGeo, M.rope), mesh(strandGeo, M.rope)];
    const stopperGeo = lathe(discProfile(0.021, 0.045, 0.008), 16);
    const stoppers = [mesh(stopperGeo, M.rubber), mesh(stopperGeo, M.rubber)];
    const clip = mesh(new THREE.TorusGeometry(0.018, 0.005, 8, 18), M.chrome);
    g.add(...strands, ...stoppers, clip);
    const _dir = new THREE.Vector3(), _e = new THREE.Vector3(), _end = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
    const cablePoint = new THREE.Vector3();
    return {
      object: g, worldSpace: true, cablePoint,
      update(api) {
        // Clip sits between the hands, pulled towards the pulley; strands run clip → fist → stopper.
        _dir.copy(api.anchor || _e.copy(api.mid).add(_up)).sub(api.mid).normalize();
        clip.position.copy(api.mid).addScaledVector(_dir, 0.17);
        clip.quaternion.setFromUnitVectors(_up, _dir);
        cablePoint.copy(clip.position).addScaledVector(_dir, 0.02);
        for (let i = 0; i < 2; i++) {
          const gp = api.grips[i];
          _e.subVectors(gp, clip.position).normalize();
          stretchBetween(strands[i], clip.position, _end.copy(gp).addScaledVector(_e, 0.05));
          stoppers[i].position.copy(gp).addScaledVector(_e, 0.075);
          stoppers[i].quaternion.setFromUnitVectors(_up, _e);
        }
      },
    };
  },
};

export const PROP_TYPES = Object.keys(BUILDERS);

const _gl = new THREE.Vector3(), _gr = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3();
const _z = new THREE.Vector3(), _o = new THREE.Vector3(), _m = new THREE.Matrix4();
const HANDS = ['hand_L', 'hand_R'];

/**
 * Create a prop from a spec entry { type, attach, opts, pos, rot }.
 *   attach 'hand_L' | 'hand_R'  → parented to the hand bone at the fist centre (moves with the hand)
 *   attach 'handsMid'           → centred between both fists every frame (bars, ropes, two-hand handles)
 *   attach other effector       → follows that effector's position (e.g. 'pelvis' for a belt)
 *   attach null                 → static at pos/rot (world, degrees)
 * ctx = { figure, parent (scene group for world-space props), anchors }
 */
export function createProp(spec, ctx) {
  const build = BUILDERS[spec.type];
  if (!build) { console.warn(`[explainer] unknown prop type "${spec.type}"`); return null; }
  const b = build(spec.opts || {});
  const { figure, parent } = ctx;
  const attach = spec.attach || null;
  const obj = b.object;
  obj.name = `prop:${spec.type}`;
  const api = { anchor: null, mid: new THREE.Vector3(), grips: [new THREE.Vector3(), new THREE.Vector3()], handSpan: 0.12 };
  const cablePoint = b.cablePoint || (b.cableLocal ? new THREE.Vector3() : null);
  const offset = spec.offset ? new THREE.Vector3().fromArray(spec.offset) : null;

  if (HANDS.includes(attach)) {
    const side = attach === 'hand_L' ? 0 : 1;
    obj.position.set(side === 0 ? -figure.dims.gripPalm : figure.dims.gripPalm, -figure.dims.gripAlong, 0);
    if (spec.rot) obj.rotation.set(...spec.rot.map(THREE.MathUtils.degToRad));
    figure.bones[attach].add(obj);
  } else {
    parent.add(obj);
    if (!attach) {
      if (spec.pos) obj.position.fromArray(spec.pos);
      if (spec.rot) obj.rotation.set(...spec.rot.map(THREE.MathUtils.degToRad));
    }
  }

  function update() {
    if (attach === 'handsMid' || b.worldSpace) {
      figure.getEffector('hand_L', _gl); figure.getEffector('hand_R', _gr);
      api.grips[0].copy(_gl); api.grips[1].copy(_gr);
      api.mid.addVectors(_gl, _gr).multiplyScalar(0.5);
      api.handSpan = _gl.distanceTo(_gr);
      if (!b.worldSpace) {
        // Frame: X towards the left fist, Y towards the anchor (or up), Z = X × Y.
        _x.subVectors(_gl, _gr).normalize();
        if (api.anchor) _y.subVectors(api.anchor, api.mid); else _y.set(0, 1, 0);
        _y.addScaledVector(_x, -_y.dot(_x));
        if (_y.lengthSq() < 1e-8) _y.set(0, 1, 0).addScaledVector(_x, -_x.y);
        _y.normalize(); _z.crossVectors(_x, _y);
        obj.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
        obj.position.copy(api.mid);
        if (offset) obj.position.add(_o.copy(offset).applyQuaternion(obj.quaternion));
      }
    } else if (attach && !HANDS.includes(attach)) {
      figure.getEffector(attach, obj.position);
      if (offset) obj.position.add(offset);
    }
    if (b.update) b.update(api);
    if (b.cableLocal) {
      (b.cableParent || obj).updateMatrixWorld(true);
      (b.cableParent || obj).localToWorld(cablePoint.copy(b.cableLocal));
    }
  }

  return {
    type: spec.type, attach, object: obj, cablePoint,
    /** World position of the cable attachment (or null). Set by the explainer from the cables spec. */
    setAnchor(v) { api.anchor = v; },
    update,
    dispose() {
      obj.removeFromParent();
      obj.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    },
  };
}
