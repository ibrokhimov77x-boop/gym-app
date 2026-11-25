// Procedural anatomical mannequin: bone hierarchy, smooth clay body, 18 muscle overlays, two-bone IK for limbs.
// Bone frames (rest = standing, arms hanging, palms facing the thighs): +Y up the chain (limbs point along −Y),
// +Z = anterior (front), so for the LEFT side +X is lateral. Figure faces +Z; its left side is +X.
import * as THREE from 'three';
import { loftGeometry, spindle } from './geo.js';
import { solveTwoBone, quatFromYZ, quatFromXY } from './ik.js';
import { getMaterials, createMuscleMaterial } from './materials.js';
import { resolvePose, createPose } from './pose.js';

export const DIM = {
  spine: 0.20, chest: 0.22, neck: 0.10, head: 0.24, upperArm: 0.30, foreArm: 0.27, hand: 0.09,
  thigh: 0.45, shin: 0.44, foot: 0.25, shoulderHalf: 0.20, hipHalf: 0.10, pelvisY: 0.98,
  ankleH: 0.085,       // ankle joint above the sole
  gripAlong: 0.075,    // fist centre: this far from the wrist along the hand…
  gripPalm: 0.022,     // …and this far towards the palm
};

export const MUSCLE_IDS = ['chest', 'front_delt', 'side_delt', 'rear_delt', 'traps', 'lats', 'mid_back', 'lower_back',
  'biceps', 'triceps', 'forearms', 'abs', 'obliques', 'glutes', 'quads', 'hamstrings', 'adductors', 'calves'];

/**
 * Muscle overlay layout (left side; right side is mirrored in X). Each entry: [bone, p0, p1, spindleOpts].
 * Points are bone-local metres. `s` placeholders are applied by mirror().
 */
function muscleLayout(s) {
  const A = (p) => [s * p[0], p[1], p[2]];
  const o = (opts) => ({ ...opts, out: opts.out ? A(opts.out) : [0, 0, 1] });
  const abs = [];
  for (const [y, z] of [[0.035, 0.094], [0.1, 0.102], [0.165, 0.108]]) {
    abs.push(['spine', A([0.031, y - 0.027, z]), A([0.031, y + 0.027, z + 0.003]),
      o({ w: 0.025, t: 0.008, back: 0.008, n: 2.6, ends: [0.75, 0.75], sharp: 0.4, out: [0.15, 0, 1] })]);
  }
  abs.push(['pelvis', A([0.029, 0.02, 0.088]), A([0.03, 0.1, 0.094]), o({ w: 0.024, t: 0.008, back: 0.008, n: 2.6, ends: [0.45, 0.75], sharp: 0.45, out: [0.15, 0, 1] })]);
  return {
    chest: [
      ['chest', A([0.012, 0.1, 0.124]), A([0.178, 0.142, 0.045]), o({ w: 0.062, t: 0.026, out: [0.25, -0.05, 1], peak: 0.35, bow: 0.014, ends: [0.85, 0.25], n: 2.4 })],
      ['chest', A([0.03, 0.172, 0.1]), A([0.172, 0.155, 0.042]), o({ w: 0.034, t: 0.016, out: [0.15, 0.45, 1], peak: 0.4, bow: 0.008, ends: [0.6, 0.3] })],
    ],
    front_delt: [['upperArm', A([0.012, 0.018, 0.04]), A([0.036, -0.14, 0.024]), o({ w: 0.036, t: 0.019, back: 0.03, out: [0.3, 0.15, 1], peak: 0.32, bow: 0.008, ends: [0.55, 0.2] })]],
    side_delt: [['upperArm', A([0.04, 0.022, 0.0]), A([0.044, -0.15, 0.0]), o({ w: 0.04, t: 0.021, back: 0.03, out: [1, 0.25, 0], peak: 0.32, bow: 0.008, ends: [0.55, 0.2] })]],
    rear_delt: [['upperArm', A([0.012, 0.016, -0.042]), A([0.036, -0.135, -0.022]), o({ w: 0.034, t: 0.017, back: 0.03, out: [0.3, 0.15, -1], peak: 0.32, bow: 0.008, ends: [0.55, 0.2] })]],
    traps: [
      ['chest', A([0.02, 0.27, -0.06]), A([0.17, 0.2, -0.045]), o({ w: 0.045, t: 0.012, back: 0.022, out: [0.2, 0.8, -1], peak: 0.3, ends: [0.6, 0.3] })],
      ['chest', A([0.006, 0.205, -0.098]), A([0.15, 0.192, -0.078]), o({ w: 0.03, t: 0.012, out: [0, 0.25, -1] })],
      ['chest', A([0.008, -0.01, -0.098]), A([0.1, 0.165, -0.104]), o({ w: 0.026, t: 0.01, out: [0, 0, -1], ends: [0.2, 0.5] })],
    ],
    mid_back: [
      ['chest', A([0.012, 0.165, -0.106]), A([0.088, 0.065, -0.11]), o({ w: 0.028, t: 0.012, out: [0, 0, -1] })],
      ['chest', A([0.09, 0.075, -0.1]), A([0.172, 0.13, -0.05]), o({ w: 0.02, t: 0.015, out: [0.6, 0, -0.8] })],
    ],
    lats: [
      ['chest', A([0.168, 0.13, -0.045]), A([0.06, -0.13, -0.088]), o({ w: 0.05, t: 0.018, out: [0.65, 0, -0.75], peak: 0.3, bow: 0.012 })],
      ['chest', A([0.15, 0.06, -0.07]), A([0.03, -0.1, -0.096]), o({ w: 0.035, t: 0.012, out: [0.3, 0, -1], peak: 0.35 })],
    ],
    lower_back: [['spine', A([0.034, -0.06, -0.078]), A([0.036, 0.22, -0.09]), o({ w: 0.022, t: 0.016, out: [0, 0, -1], peak: 0.45 })]],
    biceps: [
      ['upperArm', A([0.0, -0.07, 0.036]), A([0.0, -0.272, 0.028]), o({ w: 0.028, t: 0.021, out: [0, 0, 1], peak: 0.55, ends: [0.3, 0.25] })],
      ['upperArm', A([0.03, -0.15, 0.018]), A([0.02, -0.272, 0.018]), o({ w: 0.018, t: 0.01, out: [0.8, 0, 0.6] })],
    ],
    triceps: [
      ['upperArm', A([-0.01, -0.04, -0.04]), A([0.0, -0.262, -0.03]), o({ w: 0.026, t: 0.02, out: [0, 0, -1], peak: 0.45 })],
      ['upperArm', A([0.03, -0.06, -0.024]), A([0.012, -0.215, -0.032]), o({ w: 0.02, t: 0.015, out: [0.7, 0, -0.7], peak: 0.4 })],
    ],
    forearms: [
      ['foreArm', A([0.012, 0.03, 0.03]), A([0.0, -0.17, 0.024]), o({ w: 0.02, t: 0.015, out: [0.2, 0, 1], peak: 0.3 })],
      ['foreArm', A([-0.026, 0.0, 0.006]), A([-0.016, -0.18, 0.0]), o({ w: 0.022, t: 0.015, out: [-1, 0, 0.1], peak: 0.3 })],
      ['foreArm', A([0.026, 0.0, -0.01]), A([0.016, -0.18, -0.006]), o({ w: 0.02, t: 0.013, out: [1, 0, -0.1], peak: 0.3 })],
    ],
    abs,
    obliques: [['spine', A([0.118, 0.17, 0.05]), A([0.128, -0.04, 0.03]), o({ w: 0.034, t: 0.014, out: [0.85, 0, 0.45], peak: 0.5 })]],
    glutes: [
      ['pelvis', A([0.035, 0.075, -0.098]), A([0.13, -0.105, -0.062]), o({ w: 0.068, t: 0.034, out: [0.25, -0.1, -1], peak: 0.45, bow: 0.016 })],
      ['pelvis', A([0.11, 0.105, -0.05]), A([0.168, 0.0, -0.02]), o({ w: 0.04, t: 0.015, out: [0.8, 0, -0.5] })],
    ],
    quads: [
      ['thigh', A([0.0, -0.06, 0.072]), A([0.0, -0.4, 0.047]), o({ w: 0.034, t: 0.022, out: [0, 0, 1], peak: 0.45, bow: 0.006 })],
      ['thigh', A([0.062, -0.05, 0.022]), A([0.045, -0.4, 0.028]), o({ w: 0.04, t: 0.022, out: [1, 0, 0.35], peak: 0.45 })],
      ['thigh', A([-0.036, -0.24, 0.045]), A([-0.026, -0.43, 0.04]), o({ w: 0.034, t: 0.022, out: [-0.6, 0, 0.8], peak: 0.65 })],
    ],
    hamstrings: [
      ['thigh', A([0.03, -0.07, -0.062]), A([0.04, -0.4, -0.03]), o({ w: 0.032, t: 0.02, out: [0.3, 0, -1] })],
      ['thigh', A([-0.026, -0.07, -0.064]), A([-0.03, -0.4, -0.03]), o({ w: 0.03, t: 0.02, out: [-0.3, 0, -1] })],
    ],
    adductors: [['thigh', A([-0.056, -0.02, 0.005]), A([-0.036, -0.3, 0.005]), o({ w: 0.04, t: 0.02, out: [-1, 0, 0.1], peak: 0.3 })]],
    calves: [
      ['shin', A([-0.022, -0.03, -0.046]), A([-0.01, -0.25, -0.03]), o({ w: 0.03, t: 0.024, out: [-0.3, 0, -1], peak: 0.35 })],
      ['shin', A([0.025, -0.03, -0.046]), A([0.012, -0.23, -0.03]), o({ w: 0.026, t: 0.02, out: [0.3, 0, -1], peak: 0.35 })],
    ],
  };
}

const HIGHLIGHT = {
  primary: { color: new THREE.Color(0xff3b30), emissive: new THREE.Color(0xff2414), rim: new THREE.Color(0xff6a4a), base: 0.3, amp: 0.6, rimBase: 0.5, rimAmp: 1.1 },
  secondary: { color: new THREE.Color(0xffb020), emissive: new THREE.Color(0xff8c00), rim: new THREE.Color(0xffc060), base: 0.1, amp: 0.2, rimBase: 0.25, rimAmp: 0.35 },
};
// Heat-map gradient stops (contract): 0 = clay, 0.1 teal → 0.5 yellow → 1 red.
const HEAT = [[0.1, new THREE.Color(0x2ec4b6)], [0.5, new THREE.Color(0xffd23f)], [1.0, new THREE.Color(0xff3b30)]];

export function heatColor(v, out) {
  if (v <= HEAT[0][0]) return out.copy(HEAT[0][1]);
  for (let i = 1; i < HEAT.length; i++) {
    if (v <= HEAT[i][0]) return out.lerpColors(HEAT[i - 1][1], HEAT[i][1], (v - HEAT[i - 1][0]) / (HEAT[i][0] - HEAT[i - 1][0]));
  }
  return out.copy(HEAT[HEAT.length - 1][1]);
}

/**
 * Torso as ONE skinned loft (crotch → neck base) so pelvis, waist and ribcage blend without seams.
 * Built in rest-pose world coordinates; each vertex is weighted to pelvis / spine / chest by height.
 */
function torsoGeometry() {
  const P = DIM.pelvisY;
  const g = loftGeometry([
    { y: P - 0.1, w: 0.135, f: 0.075, b: 0.085 }, { y: P - 0.05, w: 0.163, f: 0.09, b: 0.108, z: -0.004 },
    { y: P, w: 0.17, f: 0.095, b: 0.112 }, { y: P + 0.05, w: 0.162, f: 0.095, b: 0.1, z: -0.003 },
    { y: P + 0.11, w: 0.148, f: 0.098, b: 0.086, z: -0.008 }, { y: P + 0.17, w: 0.148, f: 0.104, b: 0.088, z: -0.01 },
    { y: P + 0.235, w: 0.149, f: 0.11, b: 0.091, z: -0.01 }, { y: P + 0.3, w: 0.162, f: 0.124, b: 0.103, z: -0.01 },
    { y: P + 0.37, w: 0.168, f: 0.128, b: 0.106, z: -0.01 }, { y: P + 0.43, w: 0.165, f: 0.118, b: 0.104, z: -0.01 },
    { y: P + 0.475, w: 0.148, f: 0.096, b: 0.096, z: -0.01 }, { y: P + 0.505, w: 0.105, f: 0.068, b: 0.078, z: -0.01 },
  ], { radial: 36, sub: 3, domeStart: 0.05, domeEnd: 0.03 });
  // Blend zones (world y in rest pose): pelvis → spine around the spine joint, spine → chest around the chest joint.
  const ySpine = P + 0.07, yChest = ySpine + DIM.spine;
  const pos = g.attributes.position, n = pos.count;
  const idx = new Uint16Array(n * 4), wts = new Float32Array(n * 4);
  const ramp = (y, c, h) => Math.min(1, Math.max(0, (y - (c - h)) / (2 * h)));
  for (let i = 0; i < n; i++) {
    const y = pos.getY(i);
    const a = ramp(y, ySpine, 0.05), b = ramp(y, yChest, 0.06);
    idx.set([0, 1, 2, 0], i * 4);
    wts.set([1 - a, a * (1 - b), a * b, 0], i * 4);
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wts, 4));
  return g;
}

/** Body segment meshes (bone-local). Returned as [boneName, geometry]. */
function bodyParts() {
  const parts = [];
  const add = (bone, g) => parts.push([bone, g]);
  add('neck', loftGeometry([
    { y: -0.05, w: 0.062, f: 0.056, b: 0.066, z: -0.006 }, { y: 0.03, w: 0.053, f: 0.05, b: 0.055 },
    { y: 0.1, w: 0.051, f: 0.05, b: 0.05, z: 0.01 }, { y: 0.13, w: 0.048, f: 0.046, b: 0.046, z: 0.015 },
  ], { radial: 20, domeStart: 0.01, domeEnd: 0.01 }));
  add('head', loftGeometry([
    { y: -0.065, w: 0.045, f: 0.05, b: 0.035, z: 0.045 }, { y: -0.035, w: 0.066, f: 0.08, b: 0.056, z: 0.025 },
    { y: 0.02, w: 0.077, f: 0.094, b: 0.084, z: 0.012 }, { y: 0.08, w: 0.08, f: 0.097, b: 0.098, z: 0.005 },
    { y: 0.13, w: 0.075, f: 0.09, b: 0.095 }, { y: 0.17, w: 0.058, f: 0.07, b: 0.075 },
  ], { radial: 28, domeStart: 0.02, domeEnd: 0.04 }));
  // Face cues (nose, ears) so the viewer always knows where the figure looks.
  add('head', spindle([0, 0.07, 0.098], [0, 0.028, 0.114], { w: 0.011, t: 0.012, back: 0.006, out: [0, -0.2, 1], peak: 0.7, ends: [0.4, 0.6] }));
  for (const s of [1, -1]) add('head', spindle([s * 0.078, 0.075, -0.01], [s * 0.078, 0.025, -0.004], { w: 0.016, t: 0.008, back: 0.005, out: [s, 0, -0.2], ends: [0.6, 0.4] }));

  for (const [S, s] of [['L', 1], ['R', -1]]) {
    // Shoulder girdle bar (clavicle) — hidden under traps/delts, closes the gap neck → arm.
    const cl = new THREE.CapsuleGeometry(0.038, 0.15, 4, 12); cl.rotateZ(Math.PI / 2); cl.translate(s * 0.09, 0, -0.012);
    add('clavicle_' + S, cl);
    const shoulder = new THREE.SphereGeometry(0.05, 20, 14);
    add('upperArm_' + S, shoulder);
    add('upperArm_' + S, loftGeometry([
      { y: 0.03, w: 0.052, f: 0.052, b: 0.052 }, { y: -0.04, w: 0.051, f: 0.048, b: 0.051 },
      { y: -0.14, w: 0.046, f: 0.044, b: 0.047 }, { y: -0.24, w: 0.04, f: 0.037, b: 0.04 }, { y: -0.3, w: 0.037, f: 0.033, b: 0.036 },
    ], { radial: 20, domeStart: 0.02, domeEnd: 0.02 }));
    add('foreArm_' + S, new THREE.SphereGeometry(0.037, 16, 12));
    add('foreArm_' + S, loftGeometry([
      { y: 0.02, w: 0.039, f: 0.037, b: 0.039 }, { y: -0.05, w: 0.045, f: 0.042, b: 0.039 },
      { y: -0.14, w: 0.037, f: 0.035, b: 0.032 }, { y: -0.23, w: 0.023, f: 0.03, b: 0.028 }, { y: -0.27, w: 0.019, f: 0.029, b: 0.027 },
    ], { radial: 18, domeStart: 0.015, domeEnd: 0.015 }));
    // Fist: palm block + curled fingers wrapped around the grip axis (local Z) + thumb.
    const palm = new THREE.CapsuleGeometry(0.016, 0.05, 4, 12); palm.scale(1, 1, 2.3); palm.translate(0, -0.042, 0);
    add('hand_' + S, palm);
    const fingers = new THREE.TorusGeometry(0.027, 0.0125, 10, 20); fingers.scale(1, 1, 3.0);
    fingers.translate(-s * DIM.gripPalm, -DIM.gripAlong, 0);
    add('hand_' + S, fingers);
    add('hand_' + S, spindle([-s * 0.012, -0.022, 0.034], [-s * 0.046, -0.07, 0.042], { w: 0.011, t: 0.011, back: 0.011, out: [-s, 0, 0.3], ends: [0.8, 0.7], sharp: 0.3 }));
    // Leg
    add('thigh_' + S, loftGeometry([
      { y: 0.05, w: 0.08, f: 0.08, b: 0.085 }, { y: -0.04, w: 0.088, f: 0.085, b: 0.088, x: s * 0.008 },
      { y: -0.15, w: 0.08, f: 0.08, b: 0.075, x: s * 0.008 }, { y: -0.28, w: 0.066, f: 0.066, b: 0.06, x: s * 0.004 },
      { y: -0.39, w: 0.054, f: 0.054, b: 0.05 }, { y: -0.45, w: 0.05, f: 0.05, b: 0.046 },
    ], { radial: 26, domeStart: 0.03, domeEnd: 0.02 }));
    add('shin_' + S, new THREE.SphereGeometry(0.05, 18, 12));
    add('shin_' + S, spindle([0, 0.04, 0.042], [0, -0.035, 0.046], { w: 0.026, t: 0.012, back: 0.012, out: [0, 0, 1], ends: [0.5, 0.5] }));
    add('shin_' + S, loftGeometry([
      { y: 0.03, w: 0.05, f: 0.05, b: 0.045 }, { y: -0.07, w: 0.048, f: 0.042, b: 0.055 },
      { y: -0.14, w: 0.05, f: 0.038, b: 0.058 }, { y: -0.26, w: 0.04, f: 0.034, b: 0.042 },
      { y: -0.38, w: 0.029, f: 0.03, b: 0.03 }, { y: -0.44, w: 0.032, f: 0.032, b: 0.03 },
    ], { radial: 22, domeStart: 0.02, domeEnd: 0.02 }));
    add('foot_' + S, new THREE.SphereGeometry(0.034, 14, 10));
    // Foot lofted heel → toe along +Y, then rotated so +Y → +Z. Ring z (= −height) puts the sole at y = −ankleH.
    const foot = loftGeometry([
      { y: -0.06, w: 0.03, f: 0.03, b: 0.03, z: 0.055 }, { y: -0.025, w: 0.035, f: 0.032, b: 0.045, z: 0.053 },
      { y: 0.04, w: 0.04, f: 0.03, b: 0.038, z: 0.055, x: -s * 0.004 }, { y: 0.11, w: 0.046, f: 0.025, b: 0.022, z: 0.06, x: -s * 0.008 },
      { y: 0.155, w: 0.045, f: 0.02, b: 0.014, z: 0.065, x: -s * 0.01 }, { y: 0.185, w: 0.038, f: 0.016, b: 0.01, z: 0.069, x: -s * 0.01 },
    ], { radial: 20, domeStart: 0.02, domeEnd: 0.018 });
    foot.rotateX(Math.PI / 2);
    add('foot_' + S, foot);
  }
  return parts;
}

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _f = new THREE.Vector3(), _pp = new THREE.Vector3();
const _S = new THREE.Vector3(), _E = new THREE.Vector3(), _W = new THREE.Vector3(), _T = new THREE.Vector3();
const _pole = new THREE.Vector3(), _hint = new THREE.Vector3(), _ax = new THREE.Vector3(), _ay = new THREE.Vector3();
const _qU = new THREE.Quaternion(), _qF = new THREE.Quaternion(), _qH = new THREE.Quaternion(), _qP = new THREE.Quaternion();
const _qi = new THREE.Quaternion(), _m = new THREE.Matrix4();

export function createFigure() {
  const root = new THREE.Group();
  root.name = 'figure';
  const bones = {};
  const mk = (name, parent, x, y, z) => {
    const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z);
    (parent ? bones[parent] : root).add(b); bones[name] = b;
  };
  mk('pelvis', null, 0, DIM.pelvisY, 0);
  mk('spine', 'pelvis', 0, 0.07, -0.01);
  mk('chest', 'spine', 0, DIM.spine, 0);
  mk('neck', 'chest', 0, DIM.chest, -0.015);
  mk('head', 'neck', 0, DIM.neck, 0.01);
  for (const [S, s] of [['L', 1], ['R', -1]]) {
    mk('clavicle_' + S, 'chest', s * 0.025, 0.19, 0);
    mk('upperArm_' + S, 'clavicle_' + S, s * 0.175, 0, -0.025);
    mk('foreArm_' + S, 'upperArm_' + S, 0, -DIM.upperArm, 0);
    mk('hand_' + S, 'foreArm_' + S, 0, -DIM.foreArm, 0);
    mk('thigh_' + S, 'pelvis', s * DIM.hipHalf, 0, 0);
    mk('shin_' + S, 'thigh_' + S, 0, -DIM.thigh, 0);
    mk('foot_' + S, 'shin_' + S, 0, -DIM.shin, 0);
  }

  const M = getMaterials();
  const meshes = [];
  root.updateMatrixWorld(true); // rest pose = bind pose
  const torso = new THREE.SkinnedMesh(torsoGeometry(), M.clay);
  torso.castShadow = true; torso.receiveShadow = true; torso.frustumCulled = false;
  root.add(torso);
  torso.bind(new THREE.Skeleton([bones.pelvis, bones.spine, bones.chest]));
  meshes.push(torso);
  for (const [bone, g] of bodyParts()) {
    const mesh = new THREE.Mesh(g, M.clay);
    mesh.castShadow = true; mesh.receiveShadow = true;
    bones[bone].add(mesh); meshes.push(mesh);
  }

  // Muscles: one material per muscle id so each can glow independently.
  const muscles = {};
  for (const id of MUSCLE_IDS) muscles[id] = { id, meshes: [], material: createMuscleMaterial(M.clay), state: null, heat: 0 };
  for (const [S, s] of [['L', 1], ['R', -1]]) {
    const layout = muscleLayout(s);
    for (const id of MUSCLE_IDS) {
      for (const [bone, p0, p1, opts] of layout[id]) {
        const boneName = ['pelvis', 'spine', 'chest'].includes(bone) ? bone : `${bone}_${S}`;
        const mesh = new THREE.Mesh(spindle(p0, p1, opts), muscles[id].material);
        mesh.receiveShadow = true; mesh.castShadow = false;
        mesh.userData.muscle = id;
        bones[boneName].add(mesh); muscles[id].meshes.push(mesh); meshes.push(mesh);
      }
    }
  }

  const sides = [
    { S: 'L', s: 1, clav: bones.clavicle_L, upper: bones.upperArm_L, fore: bones.foreArm_L, hand: bones.hand_L, thigh: bones.thigh_L, shin: bones.shin_L, foot: bones.foot_L },
    { S: 'R', s: -1, clav: bones.clavicle_R, upper: bones.upperArm_R, fore: bones.foreArm_R, hand: bones.hand_R, thigh: bones.thigh_R, shin: bones.shin_R, foot: bones.foot_R },
  ];
  const gripLocal = [new THREE.Vector3(-DIM.gripPalm, -DIM.gripAlong, 0), new THREE.Vector3(DIM.gripPalm, -DIM.gripAlong, 0)];
  const reachError = [0, 0, 0, 0];
  let current = createPose();

  function solveArm(i, H) {
    const sd = sides[i];
    sd.upper.getWorldPosition(_S);
    sd.clav.getWorldQuaternion(_qP);
    // Default elbow pole: behind and outside the shoulder→grip midpoint (relative to the chest).
    if (H.hasHint) _hint.copy(H.hint);
    else {
      bones.chest.getWorldQuaternion(_qi);
      _hint.addVectors(_S, H.pos).multiplyScalar(0.5)
        .add(_v.set(sd.s * 0.25, -0.05, -0.4).applyQuaternion(_qi));
    }
    if (H.hasQ) {
      // Explicit hand orientation: wrist target follows from the grip offset in that orientation.
      _qH.copy(H.q);
      _T.copy(gripLocal[i]).applyQuaternion(_qH).negate().add(H.pos);
      reachError[i] = solveTwoBone(_S, _T, _hint, DIM.upperArm, DIM.foreArm, _E, _W, _pole);
    } else {
      // Straight wrist: hand continues the forearm, rotated about it so the palm faces H.palm.
      _f.subVectors(H.pos, _S).normalize();
      for (let it = 0; it < 3; it++) {
        _pp.copy(H.palm).addScaledVector(_f, -H.palm.dot(_f));
        if (_pp.lengthSq() < 1e-8) _pp.set(0, 0, 1).addScaledVector(_f, -_f.z);
        _pp.normalize();
        _T.copy(H.pos).addScaledVector(_f, -DIM.gripAlong).addScaledVector(_pp, -DIM.gripPalm);
        reachError[i] = solveTwoBone(_S, _T, _hint, DIM.upperArm, DIM.foreArm, _E, _W, _pole);
        _f.subVectors(_W, _E).normalize();
      }
      // Hand basis: −Y along the fingers (= forearm), palm normal = −X (left) / +X (right).
      _ay.copy(_f).negate();
      _ax.copy(_pp).multiplyScalar(-sd.s);
      quatFromXY(_ax, _ay, _qH);
    }
    // Upper arm: +Y back to the shoulder, +Z (biceps side) away from the elbow pole.
    quatFromYZ(_v.subVectors(_S, _E), _v2.copy(_pole).negate(), _qU);
    // Forearm: along elbow→wrist, twisted to match the hand (pronation/supination lives in the forearm).
    quatFromYZ(_v.subVectors(_E, _W), _v2.set(0, 0, 1).applyQuaternion(_qH), _qF);
    sd.upper.quaternion.copy(_qP).invert().multiply(_qU);
    sd.fore.quaternion.copy(_qU).invert().multiply(_qF);
    sd.hand.quaternion.copy(_qF).invert().multiply(_qH);
  }

  function solveLeg(i, F) {
    const sd = sides[i];
    sd.thigh.getWorldPosition(_S);
    bones.pelvis.getWorldQuaternion(_qP);
    _T.set(0, DIM.ankleH, 0).applyQuaternion(F.q).add(F.pos); // ankle above the sole point
    if (F.hasHint) _hint.copy(F.hint);
    else _hint.addVectors(_S, _T).multiplyScalar(0.5).add(_v.set(0, 0, 0.6).applyQuaternion(_qP));
    reachError[2 + i] = solveTwoBone(_S, _T, _hint, DIM.thigh, DIM.shin, _E, _W, _pole);
    quatFromYZ(_v.subVectors(_S, _E), _pole, _qU); // knee cap towards the pole
    quatFromYZ(_v.subVectors(_E, _W), _pole, _qF);
    sd.thigh.quaternion.copy(_qP).invert().multiply(_qU);
    sd.shin.quaternion.copy(_qU).invert().multiply(_qF);
    sd.foot.quaternion.copy(_qF).invert().multiply(F.q);
  }

  /** Apply a resolved pose (see pose.js): trunk rotations first, then IK for the four limbs. */
  function applyPose(rp) {
    current = rp;
    bones.pelvis.position.copy(rp.pelvisPos);
    bones.pelvis.quaternion.copy(rp.pelvisQ);
    for (const b of ['spine', 'chest', 'neck', 'head', 'clavicle_L', 'clavicle_R']) bones[b].quaternion.copy(rp[b]);
    solve();
  }

  function solve() {
    root.updateMatrixWorld(true);
    solveArm(0, current.hands[0]); solveArm(1, current.hands[1]);
    solveLeg(0, current.feet[0]); solveLeg(1, current.feet[1]);
    root.updateMatrixWorld(true);
  }

  /** World position of an effector: hand_L/R (fist centre), handsMid, foot_L/R (sole under ankle), feetMid, pelvis, chest. */
  function getEffector(name, out) {
    switch (name) {
      case 'hand_L': return sides[0].hand.localToWorld(out.copy(gripLocal[0]));
      case 'hand_R': return sides[1].hand.localToWorld(out.copy(gripLocal[1]));
      case 'handsMid': getEffector('hand_L', out); return out.add(getEffector('hand_R', _v)).multiplyScalar(0.5);
      case 'foot_L': return sides[0].foot.localToWorld(out.set(0, -DIM.ankleH, 0));
      case 'foot_R': return sides[1].foot.localToWorld(out.set(0, -DIM.ankleH, 0));
      case 'feetMid': getEffector('foot_L', out); return out.add(getEffector('foot_R', _v)).multiplyScalar(0.5);
      case 'pelvis': return bones.pelvis.getWorldPosition(out);
      case 'chest': return bones.chest.localToWorld(out.set(0, 0.1, 0.13)); // sternum surface
      default: return null;
    }
  }

  // ── Muscle colouring ──────────────────────────────────────────────────────────────────────────────────────────
  const clayColor = M.clay.color.clone();
  const _c = new THREE.Color();
  /** states: { muscleId: 'primary' | 'secondary' } — everything else returns to clay. */
  function setHighlight(states = {}) {
    for (const id of MUSCLE_IDS) {
      const mu = muscles[id], st = states[id] || null;
      mu.state = st; mu.heat = 0;
      const h = HIGHLIGHT[st];
      mu.material.color.copy(h ? h.color : clayColor);
      mu.material.sheenColor.copy(h ? h.color : clayColor);
      mu.material.emissive.copy(h ? h.emissive : _c.set(0));
      mu.material.userData.rimColor.value.copy(h ? h.rim : _c.set(0));
      mu.material.userData.rim.value = 0;
      mu.material.emissiveIntensity = h ? h.base : 0;
    }
  }
  /** a ∈ [0, 1] — current activation (0 relaxed, 1 peak of the concentric) drives the glow pulse. */
  function setActivation(a) {
    for (const id of MUSCLE_IDS) {
      const mu = muscles[id], h = HIGHLIGHT[mu.state];
      if (!h) continue;
      mu.material.emissiveIntensity = h.base + h.amp * a;
      mu.material.userData.rim.value = h.rimBase + h.rimAmp * a;
    }
  }
  /** Heat-map mode: heat = { muscleId: 0..1 }. */
  function setHeat(heat = {}) {
    for (const id of MUSCLE_IDS) {
      const mu = muscles[id], v = Math.max(0, Math.min(1, heat[id] || 0));
      mu.state = null; mu.heat = v;
      if (v <= 0.001) {
        mu.material.color.copy(clayColor); mu.material.sheenColor.copy(clayColor);
        mu.material.emissive.set(0); mu.material.userData.rim.value = 0;
      } else {
        heatColor(v, mu.material.color);
        mu.material.sheenColor.copy(mu.material.color);
        mu.material.emissive.copy(mu.material.color);
        mu.material.emissiveIntensity = 0.08 + 0.22 * v;
        mu.material.userData.rimColor.value.copy(mu.material.color);
        mu.material.userData.rim.value = 0.25 + 0.6 * v;
      }
    }
  }

  function dispose() {
    torso.skeleton.dispose();
    root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    for (const id of MUSCLE_IDS) muscles[id].material.dispose();
  }

  const figure = {
    root, bones, muscles, meshes, dims: DIM, reachError,
    applyPose, solve, getEffector, setHighlight, setActivation, setHeat, dispose,
    /** Convenience: resolve + apply a spec pose (plain JSON). */
    setPose(specPose) { applyPose(resolvePose(specPose)); },
    get pose() { return current; },
  };
  figure.setPose({});
  return figure;
}
