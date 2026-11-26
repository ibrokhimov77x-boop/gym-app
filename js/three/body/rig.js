// Rig layout shared by figure.js (three.js bones), the body loader and the offline body generator (tools/body/).
// Plain math: no three.js, no DOM — it is imported by Node scripts as well.
// Bone frames: +Y up the chain (limbs point along −Y), +Z anterior; for the LEFT side +X is lateral.
// The baked body (webapp/assets/body/) is generated around this rig: after ANY change in this file run
// `npm run bake:body` — the loader rejects an asset whose rigSignature() differs.

/** Muscle regions of the body mesh; the `muscle` vertex attribute stores indices into this list (contract ids). */
export const MUSCLE_IDS = ['chest', 'front_delt', 'side_delt', 'rear_delt', 'traps', 'lats', 'mid_back', 'lower_back',
  'biceps', 'triceps', 'forearms', 'abs', 'obliques', 'glutes', 'quads', 'hamstrings', 'adductors', 'calves'];

export const DIM = {
  spine: 0.20, chest: 0.22, neck: 0.10, head: 0.24, upperArm: 0.30, foreArm: 0.27, hand: 0.09,
  thigh: 0.45, shin: 0.44, foot: 0.25, pelvisY: 0.98,
  // Joint CENTRES, half the distance between left and right (a 1.78 m man: shoulder joints 0.36–0.38 m apart, hip
  // joints 0.17–0.19 m). The pivots sit on the centre of the humeral head / of the femoral head, not on the acromion
  // or the trochanter: 0.20 and 0.10 (the values until 2026-11) put them 14 and 7 mm too far out.
  shoulderHalf: 0.186, hipHalf: 0.093,
  ankleH: 0.085,       // ankle joint above the sole
  gripAlong: 0.075,    // fist centre: this far from the wrist along the hand…
  gripPalm: 0.022,     // …and this far towards the palm
};

// the shoulder joint in the clavicle bone's space: the clavicle starts 25 mm from the midline
const SHOULDER_X = 0.161;   // = DIM.shoulderHalf − 0.025 (written out: the rig signature hashes these numbers)

/** [name, parent, offset] in parent space (rest pose = all local rotations identity). */
export function rigLayout() {
  const L = [
    ['pelvis', null, [0, DIM.pelvisY, 0]],
    ['spine', 'pelvis', [0, 0.07, -0.01]],
    ['chest', 'spine', [0, DIM.spine, 0]],
    ['neck', 'chest', [0, DIM.chest, -0.015]],
    ['head', 'neck', [0, DIM.neck, 0.01]],
  ];
  for (const [S, s] of [['L', 1], ['R', -1]]) {
    L.push(['clavicle_' + S, 'chest', [s * 0.025, 0.19, 0]]);
    L.push(['upperArm_' + S, 'clavicle_' + S, [s * SHOULDER_X, 0, -0.025]]);
    L.push(['foreArm_' + S, 'upperArm_' + S, [0, -DIM.upperArm, 0]]);
    L.push(['hand_' + S, 'foreArm_' + S, [0, -DIM.foreArm, 0]]);
    L.push(['thigh_' + S, 'pelvis', [s * DIM.hipHalf, 0, 0]]);
    L.push(['shin_' + S, 'thigh_' + S, [0, -DIM.thigh, 0]]);
    L.push(['foot_' + S, 'shin_' + S, [0, -DIM.shin, 0]]);
  }
  return L;
}

/**
 * Skin-only helper bones (not part of the public rig). Their local rotation is derived every frame from the IK
 * result (figure.js → updateHelpers). The upper arm's and the thigh's rotation out of the bind pose is split into a
 * SWING (the bone points somewhere else) and a TWIST about the bone's own axis; the skin round the joint follows a
 * share of the swing and none of the twist — the twist is taken up along the limb, as skin does over muscle.
 *   sq  shoulder: a quarter of the upper arm's swing (acromion, axillary folds of pec / lats)
 *   sh  shoulder: half of the swing (deltoid cap / armpit volume)
 *   ua  upper arm: the whole swing, no twist (deltoid down to its insertion; the twist sets in below it)
 *   rd  rear deltoid: turns like sh and is pushed INTO the arm from behind as the arm reaches forward — the back of
 *       the shoulder (posterior deltoid, long head of the triceps) is stretched thin then; rigid skin kept its
 *       bind-pose bulk and stood out as a ball behind the shoulder
 *   el  elbow: half of the elbow flexion (olecranon, inner elbow)
 *   bi  biceps: rides on the upper arm and is pushed forward as the elbow bends — the belly of the biceps thickens
 *   fr  forearm roll: forearm swing without pronation (skin near the elbow does not twist)
 *   fm  forearm mid: swing + half the pronation (spreads the twist along the forearm)
 *   hp  hip: half of the thigh's swing, no twist (glutes, groin)
 *   toe the toes: turn about the balls of the foot by the pose's `toes` angle (a foot entry of a spec pose:
 *       degrees the toes are bent up; calf raises keep them flat on the step while the heel rises)
 *   kn  knee: half of the knee flexion, pushed forward along the bisector as the knee bends (the kneecap rides
 *       over the end of the femur: a bent knee has a cap, it is not a bent tube)
 */
export function helperLayout() {
  const L = [];
  for (const [S, s] of [['L', 1], ['R', -1]]) {
    L.push(['sq_' + S, 'clavicle_' + S, [s * SHOULDER_X, 0, -0.025]]);
    L.push(['sh_' + S, 'clavicle_' + S, [s * SHOULDER_X, 0, -0.025]]);
    L.push(['ua_' + S, 'clavicle_' + S, [s * SHOULDER_X, 0, -0.025]]);
    L.push(['rd_' + S, 'clavicle_' + S, [s * SHOULDER_X, 0, -0.025]]);
    L.push(['el_' + S, 'upperArm_' + S, [0, -DIM.upperArm, 0]]);
    L.push(['bi_' + S, 'upperArm_' + S, [0, -0.6 * DIM.upperArm, 0.03]]);
    L.push(['fr_' + S, 'upperArm_' + S, [0, -DIM.upperArm, 0]]);
    L.push(['fm_' + S, 'upperArm_' + S, [0, -DIM.upperArm, 0]]);
    L.push(['hp_' + S, 'pelvis', [s * DIM.hipHalf, 0, 0]]);
    L.push(['kn_' + S, 'thigh_' + S, [0, -DIM.thigh, 0]]);
    L.push(['toe_' + S, 'foot_' + S, [0, -0.058, 0.138]]);   // the line through the five toe joints (57 mm of toes in front)
  }
  return L;
}

/** Order of bones in the skinned mesh's skeleton (skinIndex values). */
export const SKIN_BONES = [
  'pelvis', 'spine', 'chest', 'neck', 'head',
  'clavicle_L', 'upperArm_L', 'foreArm_L', 'hand_L', 'clavicle_R', 'upperArm_R', 'foreArm_R', 'hand_R',
  'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R',
  'sh_L', 'el_L', 'fr_L', 'fm_L', 'hp_L', 'kn_L',
  'sh_R', 'el_R', 'fr_R', 'fm_R', 'hp_R', 'kn_R',
  'sq_L', 'sq_R', 'ua_L', 'ua_R', 'bi_L', 'bi_R', 'toe_L', 'toe_R', 'rd_L', 'rd_R',
];

/**
 * How far the driven helpers travel (metres; figure.js updateHelpers): the kneecap at a fully bent knee, the belly of
 * the biceps at a fully bent elbow (reached at `bicepsFlex[1]` degrees of flexion, nothing below `bicepsFlex[0]`).
 */
export const HELPER_DRIVE = { kneecap: 0.022, biceps: 0.014, bicepsFlex: [20, 135], rearDelt: 0.04, rearDeltFwd: [0.15, 0.85], glute: [0.07, 0.06], gluteFlex: [15, 95] };
// (step 05) kneecap 0.015 → 0.022 (a rounder cap in the deep squat), rearDelt 0.03 → 0.04 (forward reach).
// glute (step 05): the hp helper (half the thigh's swing: lower buttock, gluteal fold, groin) slides this far UP and
// FORWARD in the pelvis frame [y, z] (metres) as the hip flexes from gluteFlex[0] to gluteFlex[1] degrees — a real
// buttock is stretched flat over the ischium in a hinge, a squat or on a seat; rotating it rigidly about the hip joint
// (dual quaternions keep its radius) ballooned it into a sphere behind and below the pelvis.
// rearDelt: how far the back of the shoulder is pushed into the arm when the arm points straight forward; it sets in
// as the forward component of the upper arm's direction (clavicle frame) rises from rearDeltFwd[0] to rearDeltFwd[1]

/** Bind pose (degrees, local XYZ euler): A-pose arms, legs slightly apart. Everything else = rest. */
export const ARM_BIND = 45, LEG_BIND = 6;
export function bindRotations() {
  return {
    upperArm_L: [0, 0, ARM_BIND], upperArm_R: [0, 0, -ARM_BIND],
    sh_L: [0, 0, ARM_BIND], sh_R: [0, 0, -ARM_BIND], sq_L: [0, 0, ARM_BIND], sq_R: [0, 0, -ARM_BIND],
    ua_L: [0, 0, ARM_BIND], ua_R: [0, 0, -ARM_BIND], rd_L: [0, 0, ARM_BIND], rd_R: [0, 0, -ARM_BIND],   // rd turns like sh
    thigh_L: [0, 0, LEG_BIND], thigh_R: [0, 0, -LEG_BIND],
    hp_L: [0, 0, LEG_BIND], hp_R: [0, 0, -LEG_BIND],
  };
}

/**
 * Signature of everything the baked body depends on: bone order, muscle order, joint offsets, bind pose, DIM.
 * Stored in the asset header at bake time and compared by the loader, so a body baked for another rig is never
 * skinned with this one. 8 hex chars (FNV-1a over a canonical JSON string; identical in Node and browsers).
 */
export function rigSignature() {
  const s = JSON.stringify({ bones: SKIN_BONES, muscles: MUSCLE_IDS, rig: rigLayout(), helpers: helperLayout(), bind: bindRotations(), dim: DIM });
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ── plain 3×3 math for bind frames ─────────────────────────────────────────────────────────────────────────────
const D2R = Math.PI / 180;
function eulerXYZ([x, y, z]) {
  // three.js 'XYZ' order: R = Rx · Ry · Rz
  const a = x * D2R, b = y * D2R, c = z * D2R;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  // columns = images of local X, Y, Z
  return [
    [cb * cc, ca * sc + sa * sb * cc, sa * sc - ca * sb * cc],
    [-cb * sc, ca * cc - sa * sb * sc, sa * cc + ca * sb * sc],
    [sb, -sa * cb, ca * cb],
  ];
}
const mulCols = (A, B) => B.map((col) => [0, 1, 2].map((r) => A[0][r] * col[0] + A[1][r] * col[1] + A[2][r] * col[2]));
const apply = (A, v) => [0, 1, 2].map((r) => A[0][r] * v[0] + A[1][r] * v[1] + A[2][r] * v[2]);

/**
 * Bind-pose world frames: { name: { o: [x,y,z], X: [..], Y: [..], Z: [..] } } for rig + helper bones.
 */
export function bindFrames() {
  const rot = bindRotations();
  const frames = {};
  const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (const [name, parent, off] of [...rigLayout(), ...helperLayout()]) {
    const P = parent ? frames[parent] : { o: [0, 0, 0], cols: I };
    const o = P.o.map((v, i) => v + apply(P.cols, off)[i]);
    const cols = mulCols(P.cols, rot[name] ? eulerXYZ(rot[name]) : I);
    frames[name] = { o, cols, X: cols[0], Y: cols[1], Z: cols[2] };
  }
  return frames;
}
