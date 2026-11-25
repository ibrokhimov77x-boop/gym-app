// Machine batch "back": lat pulldown, plate-loaded iso-lateral high row, gravitron (assisted pull-up), seated cable
// row, chest-supported plate-loaded row, 45° back extension. Commercial-gym look (Impulse-style red/black frames,
// brushed steel, black upholstery). World metres, figure at the origin facing +Z (see ../README.md).
//
// The exported constants/functions (LAT_PULLDOWN, HIGH_ROW, …, leverHandle) are the single source of truth for pads,
// handles and pivots: anims/back.js builds its poses from them, so body and machine always line up.
//
// Lever machines (high_row, row) need the hand positions to rotate their levers, but `update()` gets no arguments.
// Workaround: four empty "tracker" parts are bound to the hands with movers (LEVER_MOVERS, one mover per hand and
// axis); update() reads their offsets, reconstructs each hand's position and turns the lever to it. Do not move these
// machines with opts.at / opts.yaw (the trackers assume the machine frame = world frame).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { getMaterials } from '../materials.js';
import { stretchBetween, lathe, discProfile } from '../geo.js';
import { buildPlate } from '../props.js';
import { rbox, beam, rod, cylX } from './common.js';

const D2R = Math.PI / 180;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _up = V(0, 1, 0);

// ── Geometry helpers ────────────────────────────────────────────────────────────────────────────────────────────
const mesh = (geo, mat) => new THREE.Mesh(geo, mat);
/** Set an object's position and return it (for one-line add()). */
const at = (o, x, y, z) => { o.position.set(x, y, z); return o; };
/** Smooth bent tube through points (levers, curved frames). */
const tube = (pts, r, mat, seg = 48) =>
  mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), seg, r, 10, false), mat);
/** Impulse-style red powder coat (cached + disposed together with the plate-rim materials). */
const red = () => getMaterials().frameRed;

/** Rubber-capped floor foot across X at z. */
function tFoot(g, M, z, halfW, x = 0) {
  g.add(beam(V(x - halfW, 0.035, z), V(x + halfW, 0.035, z), 0.07, M.frame, 0.05));
  for (const s of [1, -1]) g.add(rbox(0.05, 0.02, 0.08, M.rubber, x + s * (halfW - 0.025), 0.01, z, 0.006));
}
/** Upholstered pad (black leather on a dark backing board), centred at (x, y, z), thickness along local Y. */
function pad(w, t, d, M, x, y, z, r = 0.03) {
  const g = new THREE.Group();
  g.add(rbox(w, t, d, M.upholstery, 0, 0, 0, r));
  g.add(rbox(w - 0.03, 0.014, d - 0.03, M.frame, 0, -t / 2 - 0.006, 0, 0.004));
  g.position.set(x, y, z);
  return g;
}
/** Thin rubber tread on top (local +Y) of a foot plate mesh, offset `up` along its normal. */
function gripStrip(plate, w, d, up, M) {
  const s = rbox(w, 0.004, d, M.rubber, 0, 0, 0, 0.002);
  s.position.copy(plate.position); s.quaternion.copy(plate.quaternion);
  return s.translateY(up);
}
/** Foam roller along X (length len, radius r) centred at (x, y, z) on a steel axle stub. */
function roller(len, r, M, x, y, z) {
  const m = mesh(lathe(discProfile(r, len, Math.min(0.02, r * 0.4)), 24).rotateZ(Math.PI / 2), M.foam);
  m.position.set(x, y, z);
  return m;
}
/** Pulley wheel (axis X) with side plates. */
function pulleyX(M, r = 0.055) {
  const g = new THREE.Group();
  g.add(mesh(lathe(discProfile(r, 0.024, 0.006, 0.012), 24).rotateZ(Math.PI / 2), M.chrome));
  for (const s of [1, -1]) g.add(rbox(0.006, r * 2 + 0.03, r * 2 + 0.03, M.frame, s * 0.02, 0, 0, 0.004));
  return g;
}
/** Plate horn: sleeve along X pointing outwards (side = ±1) from the group origin, loaded with plates `kgs`. */
function plateHorn(M, side, kgs = [20], len = 0.22) {
  const g = new THREE.Group();
  const sleeve = mesh(cylX(0.025, len, 16), M.chrome); sleeve.position.x = side * len / 2; g.add(sleeve);
  g.add(at(mesh(cylX(0.04, 0.02, 16), M.steel), side * 0.01, 0, 0));
  let x = 0.03;
  for (const kg of kgs) {
    const plate = buildPlate(kg), th = plate.userData.thickness;
    plate.rotation.z = Math.PI / 2;
    plate.position.x = side * (x + th / 2);
    g.add(plate);
    x += th + 0.002;
  }
  return g;
}

/**
 * Selectorised weight stack at (x, z), plates across X. The top `pinned` plates + top plate + selector rod + pin form
 * the moving group (at the origin, so `position.y` = lift). Returns { stack, top } — top = cable point at rest.
 */
function weightStack(g, M, { x = 0, z, n = 16, pinned = 7, w = 0.3, d = 0.14, rodTop = 1.8 }) {
  const y0 = 0.1, pitch = 0.034;
  const plateGeo = new RoundedBoxGeometry(w, 0.03, d, 1, 0.004);
  for (const dx of [w / 2 - 0.04, -(w / 2 - 0.04)]) g.add(rod(V(x + dx, 0.05, z), V(x + dx, rodTop, z), 0.009, M.chrome));
  g.add(rbox(w + 0.06, 0.04, d + 0.06, M.rubber, x, 0.07, z, 0.01));
  g.add(rbox(w + 0.1, 0.04, d + 0.1, M.frame, x, rodTop + 0.02, z, 0.008)); // rod cap
  const stack = new THREE.Group(); stack.name = 'stack';
  for (let i = 0; i < n; i++) {
    const p = mesh(plateGeo, M.stack);
    p.position.set(x, y0 + 0.015 + i * pitch, z);
    (i >= n - pinned ? stack : g).add(p);
  }
  const topY = y0 + n * pitch;
  stack.add(rbox(w + 0.02, 0.045, d, red(), x, topY + 0.022, z, 0.008));
  stack.add(rod(V(x, y0 + (n - pinned) * pitch, z), V(x, topY + 0.05, z), 0.007, M.chrome));
  const pinY = y0 + (n - pinned) * pitch + 0.015;
  const pin = mesh(cylX(0.007, 0.12), M.steel); pin.rotation.y = Math.PI / 2; pin.position.set(x, pinY, z - d / 2 - 0.02);
  stack.add(pin, rbox(0.03, 0.03, 0.03, M.accent, x, pinY, z - d / 2 - 0.08, 0.008));
  g.add(stack);
  return { stack, top: V(x, topY + 0.05, z) };
}

// ── Lever machines: shared handle + tracker logic ───────────────────────────────────────────────────────────────
/**
 * Movers that bind the tracker parts to the hands — put them in the spec of every lever machine (`movers:`).
 * A mover only translates a part along one axis, so each hand gets one tracker per axis (Y and Z).
 */
export const LEVER_MOVERS = [
  { part: 'trk_L_y', follow: 'hand_L', axis: [0, 1, 0] }, { part: 'trk_L_z', follow: 'hand_L', axis: [0, 0, 1] },
  { part: 'trk_R_y', follow: 'hand_R', axis: [0, 1, 0] }, { part: 'trk_R_z', follow: 'hand_R', axis: [0, 0, 1] },
];

/**
 * Fist centre (world) on a lever handle: lever L about the pivot (axis X) at angle `deg`, measured in the Z–Y plane
 * as atan2(y − pivotY, z − pivotZ) (0° = handle straight in front of the pivot, 90° = above, −90° = below).
 * side = +1 left hand, −1 right hand.
 */
export function leverHandle(cfg, deg, side = 1) {
  const a = deg * D2R;
  return [side * cfg.handX, +(cfg.pivotY + cfg.L * Math.sin(a)).toFixed(4), +(cfg.pivotZ + cfg.L * Math.cos(a)).toFixed(4)];
}
/** Lever pivot point for the hand of `side` (use as the hand's `pivot` so it travels on the lever arc). */
export const leverPivot = (cfg, side = 1) => [side * cfg.handX, cfg.pivotY, cfg.pivotZ];

/**
 * Neutral handle on a swivel about X through the fist centre: grip along local Y, C-bracket out to the lever plane
 * (dx = lever x − hand x). Returns the handle group (place it at the fist centre).
 */
function swivelHandle(M, dx) {
  const g = new THREE.Group(), half = 0.085;
  g.add(mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.15, 16), M.rubber));
  for (const s of [1, -1]) {
    g.add(rbox(0.02, 0.012, 0.03, M.steel, 0, s * half, 0, 0.004)); // end caps
    g.add(beam(V(0, s * half, 0), V(dx, s * half, 0), 0.022, M.steel, 0.03));
  }
  g.add(beam(V(dx, -half, 0), V(dx, half, 0), 0.03, M.steel, 0.034));
  g.add(at(mesh(cylX(0.026, 0.05, 16), M.chrome), dx, 0, 0)); // swivel hub
  return g;
}

/**
 * Two independent levers about X. cfg: { pivotY, pivotZ, L, handX, leverX, angleTop, angleBottom, gripTop,
 * gripBottom } (angles in degrees, see leverHandle). buildLever(side, group) draws one lever in its TOP configuration
 * relative to the pivot (group origin = pivot at x = side·leverX). gripTop/Mid/Bottom = handle tilt about X (deg,
 * + tips the top of the grip forwards) at the top / half-way / bottom of the rep, measured from the figure's forearm
 * so the grip stays square to it (the figure always holds a straight wrist): the handles swivel on their hubs.
 */
function leverPair(g, M, cfg, buildLever) {
  const parts = {}, levers = [];
  for (const [S, side] of [['L', 1], ['R', -1]]) {
    const lever = new THREE.Group();
    lever.position.set(side * cfg.leverX, cfg.pivotY, cfg.pivotZ);
    buildLever(side, lever);
    const [hx, hy, hz] = leverHandle(cfg, cfg.angleTop, side);
    const handle = swivelHandle(M, side * (cfg.leverX - cfg.handX));
    handle.position.set(hx - lever.position.x, hy - cfg.pivotY, hz - cfg.pivotZ);
    lever.add(handle);
    g.add(lever);
    const ty = new THREE.Group(), tz = new THREE.Group();
    g.add(ty, tz);
    parts[`trk_${S}_y`] = ty; parts[`trk_${S}_z`] = tz;
    parts['lever_' + S] = lever;
    levers.push({ lever, handle, ty, tz, rest: V(hx, hy, hz) });
  }
  const span = cfg.angleBottom - cfg.angleTop;
  // Grip tilt along the rep: linear top → bottom, or a quadratic Bézier through gripMid at half-way when given.
  const g0 = cfg.gripTop, g1 = cfg.gripBottom, gc = cfg.gripMid == null ? (g0 + g1) / 2 : 2 * cfg.gripMid - (g0 + g1) / 2;
  const grip = (k) => (1 - k) * (1 - k) * g0 + 2 * k * (1 - k) * gc + k * k * g1;
  function update() {
    for (const L of levers) {
      // Hand = its top-pose position + tracked offsets; lever angle = direction pivot → hand.
      const y = L.rest.y + L.ty.position.y, z = L.rest.z + L.tz.position.z;
      let a = Math.atan2(y - cfg.pivotY, z - cfg.pivotZ) / D2R;
      a += Math.round((cfg.angleTop - a) / 360) * 360; // unwrap next to angleTop
      L.lever.rotation.x = (cfg.angleTop - a) * D2R;
      const k = span ? (a - cfg.angleTop) / span : 0;
      L.handle.rotation.x = grip(k) * D2R - L.lever.rotation.x;
    }
  }
  return { parts, update };
}

// ── Lat pulldown ────────────────────────────────────────────────────────────────────────────────────────────────
/** Seat top, thigh rollers and the head-pulley cable exit (world). The weight stack stands in front of the lifter. */
export const LAT_PULLDOWN = { seatTop: 0.47, seatZ: 0.0, roller: { y: 0.685, z: 0.31, r: 0.055 }, pulley: [0, 2.2, 0.06] };

function lat_pulldown() {
  const M = getMaterials(), R = red(), g = new THREE.Group();
  const C = LAT_PULLDOWN, zc = 1.2, zs = 0.97, yBoom = 2.36, [, py, pz] = C.pulley;
  // Base: spine rail under the seat → column, two floor feet.
  g.add(beam(V(0, 0.035, -0.32), V(0, 0.035, zc + 0.1), 0.1, M.frame, 0.06));
  tFoot(g, M, -0.26, 0.3); tFoot(g, M, zc + 0.02, 0.42);
  // Column + boom over the lifter (red), gusset plates.
  g.add(beam(V(0, 0.06, zc), V(0, yBoom + 0.05, zc), 0.12, R, 0.1));
  g.add(beam(V(0, yBoom, zc + 0.05), V(0, yBoom, pz - 0.08), 0.09, R, 0.07));
  g.add(beam(V(0, yBoom - 0.32, zc), V(0, yBoom - 0.03, zc - 0.32), 0.06, M.frame, 0.05));
  // Weight stack (front, facing the lifter) and its top wheel under the boom.
  const { stack, top } = weightStack(g, M, { z: zs, n: 16, pinned: 7, rodTop: 1.95 });
  g.add(beam(V(-0.19, 1.97, zs), V(-0.19, yBoom, zs), 0.04, M.frame), beam(V(0.19, 1.97, zs), V(0.19, yBoom, zs), 0.04, M.frame));
  const wStack = pulleyX(M); wStack.position.set(0, yBoom - 0.09, zs); g.add(wStack);
  // Head pulley above the lifter.
  const head = pulleyX(M); head.position.set(0, py + 0.055, pz); g.add(head);
  g.add(beam(V(0, py + 0.07, pz), V(0, yBoom - 0.03, pz), 0.05, M.frame, 0.06));
  // Static cable along the boom, dynamic one down to the stack.
  g.add(rod(V(0, py + 0.11, pz), V(0, yBoom - 0.035, zs), 0.0045, M.cable, 6));
  const lift = rod(top, V(0, yBoom - 0.09, zs), 0.0045, M.cable, 6); g.add(lift);
  // Seat on a post, adjustment knob.
  g.add(beam(V(0, 0.06, C.seatZ - 0.04), V(0, C.seatTop - 0.08, C.seatZ - 0.04), 0.07, M.frame, 0.07));
  g.add(pad(0.4, 0.075, 0.38, M, 0, C.seatTop - 0.0375, C.seatZ + 0.02, 0.03));
  g.add(rbox(0.035, 0.035, 0.035, M.accent, 0.06, 0.25, C.seatZ - 0.04, 0.008));
  // Thigh-pad post between the shins: up from the base, then back over the knees to the roller axle.
  const ro = C.roller, zPost = 0.6;
  g.add(beam(V(0, 0.06, zPost), V(0, ro.y + 0.04, zPost), 0.05, R, 0.05));
  g.add(beam(V(0, ro.y + 0.04, zPost), V(0, ro.y, ro.z), 0.045, R, 0.045));
  g.add(mesh(cylX(0.014, 0.54), M.steel).translateY(ro.y).translateZ(ro.z));
  for (const s of [1, -1]) g.add(roller(0.22, ro.r, M, s * 0.14, ro.y, ro.z));
  const topY0 = top.y, liftFrom = V(0, 0, 0), wheel = V(0, yBoom - 0.09, zs);
  return {
    group: g, parts: { stack }, anchors: { pulley: V(0, py, pz), stack: top.clone() },
    cableStacks: { pulley: 'stack' }, stackRatio: 1,
    update() { liftFrom.set(0, topY0 + stack.position.y, zs); stretchBetween(lift, liftFrom, wheel); },
  };
}

// ── Plate-loaded iso-lateral high row ───────────────────────────────────────────────────────────────────────────
/**
 * Seated facing +Z, thighs under a roller; tall red levers pivot in front (pivot axle at y 1.12, z 0.98) and reach up
 * and back to neutral handles above-front of the lifter. Handles travel on the lever arc (leverHandle).
 * angleTop = end of the pull (handles at the lower chest), angleBottom = stretch (handles up and forward).
 */
export const HIGH_ROW = {
  seatTop: 0.49, seatZ: 0.0, roller: { y: 0.705, z: 0.34, r: 0.055 },
  pivotY: 1.12, pivotZ: 0.98, L: 0.74, handX: 0.25, leverX: 0.43,
  angleTop: 199, angleBottom: 143, gripTop: -20, gripMid: -88, gripBottom: -65,
};

function high_row() {
  const M = getMaterials(), R = red(), g = new THREE.Group(), C = HIGH_ROW;
  const zT = C.pivotZ + 0.08; // front tower
  // Base frame: centre rail, front cross member, feet.
  g.add(beam(V(0, 0.035, -0.3), V(0, 0.035, zT + 0.1), 0.1, M.frame, 0.06));
  tFoot(g, M, -0.24, 0.3); tFoot(g, M, zT, 0.55);
  // Front tower carrying the pivot axle.
  for (const s of [1, -1]) {
    g.add(beam(V(s * 0.3, 0.06, zT), V(s * 0.3, C.pivotY + 0.06, zT), 0.08, M.frame, 0.1));
    g.add(beam(V(s * 0.3, C.pivotY, zT), V(s * 0.3, C.pivotY, C.pivotZ), 0.07, M.frame, 0.07));
    g.add(at(mesh(cylX(0.06, 0.1, 24), R), s * 0.36, C.pivotY, C.pivotZ)); // bearing housing
  }
  g.add(beam(V(-0.3, C.pivotY - 0.25, zT), V(0.3, C.pivotY - 0.25, zT), 0.06, M.frame, 0.08));
  g.add(mesh(cylX(0.022, 0.9), M.steel).translateY(C.pivotY).translateZ(C.pivotZ));
  // Seat, thigh roller, foot bar.
  g.add(beam(V(0, 0.06, C.seatZ - 0.05), V(0, C.seatTop - 0.08, C.seatZ - 0.05), 0.07, M.frame, 0.07));
  g.add(pad(0.38, 0.075, 0.36, M, 0, C.seatTop - 0.0375, C.seatZ + 0.02));
  const ro = C.roller, zPost = 0.62;
  g.add(beam(V(0, 0.06, zPost), V(0, ro.y + 0.04, zPost), 0.05, R, 0.05));
  g.add(beam(V(0, ro.y + 0.04, zPost), V(0, ro.y, ro.z), 0.045, R, 0.045));
  g.add(mesh(cylX(0.014, 0.54), M.steel).translateY(ro.y).translateZ(ro.z));
  for (const s of [1, -1]) g.add(roller(0.22, ro.r, M, s * 0.14, ro.y, ro.z));
  // Levers: an arched arm rising up and back over the lifter's knees to the handle, and a short counter-arm forward to
  // the plate horn — the plate is in FRONT of the pivot, so it rises when the handle is pulled down. The arm is drawn
  // in the stretch configuration (handle at angleBottom, where its shape reads best) inside `arm`, which is turned so
  // the handle sits at angleTop, the rest angle leverPair expects.
  const [, hy, hz] = leverHandle(C, C.angleBottom);
  const hY = hy - C.pivotY, hZ = hz - C.pivotZ;
  const { parts, update } = leverPair(g, M, C, (side, lever) => {
    const arm = new THREE.Group();
    arm.rotation.x = (C.angleBottom - C.angleTop) * D2R;
    const pts = [V(0, -0.12, 0.4), V(0, 0, 0), V(0, 0.3, -0.1), V(0, 0.48, -0.3), V(0, 0.5, -0.47), V(0, hY, hZ)];
    arm.add(tube(pts, 0.034, R, 60));
    arm.add(mesh(cylX(0.055, 0.07, 24), R)); // hub on the axle
    const horn = plateHorn(M, side, [20]); horn.position.set(0, -0.12, 0.4); arm.add(horn);
    lever.add(arm);
  });
  return { group: g, parts, anchors: {}, update };
}

// ── Gravitron (assisted pull-up / dip) ──────────────────────────────────────────────────────────────────────────
/**
 * Lifter kneels on a pad facing +Z, holds neutral handles (grip along Z) at ASSIST.handle. The knee pad slides on
 * two chrome rods; the counterweight stack (in front) rises when the pad goes down. opts.padTop = pad surface height
 * at the top of the rep (where the machine is built); the spec moves `platform` with the pelvis and `stack` against it.
 */
// padZ: the pad ends just in front of the ankles, so the shins lie on it and the relaxed feet hang off its back end.
export const ASSIST = { handle: [0.25, 2.16, 0.12], padZ: [-0.32, 0.24], padTopDefault: 1.0 };

function assisted_pullup(opts = {}) {
  const M = getMaterials(), R = red(), g = new THREE.Group(), C = ASSIST;
  const padTop = opts.padTop ?? C.padTopDefault, xc = 0.44, zc = 0.62, H = 2.42, zs = 0.84;
  const [hx, hy, hz] = C.handle;
  // Base: side rails + front/back cross members.
  for (const s of [1, -1]) g.add(beam(V(s * xc, 0.035, -0.5), V(s * xc, 0.035, 1.02), 0.08, M.frame, 0.06));
  for (const z of [-0.46, 0.98]) tFoot(g, M, z, xc + 0.06);
  // Columns + top frame (red), cross bar, wide chin bar.
  for (const s of [1, -1]) {
    g.add(beam(V(s * xc, 0.06, zc), V(s * xc, H, zc), 0.09, R, 0.11));
    g.add(beam(V(s * xc, H - 0.04, zc + 0.12), V(s * xc, H - 0.04, hz - 0.1), 0.08, R, 0.09));
  }
  g.add(beam(V(-xc, H - 0.04, zc), V(xc, H - 0.04, zc), 0.08, M.frame, 0.09));
  g.add(beam(V(-xc, 1.02, zc), V(xc, 1.02, zc), 0.06, M.frame, 0.07));
  const chin = [V(-0.56, H - 0.2, 0.36), V(-0.4, H - 0.12, 0.36), V(0.4, H - 0.12, 0.36), V(0.56, H - 0.2, 0.36)];
  g.add(tube(chin, 0.016, M.chrome, 40));
  for (const s of [1, -1]) g.add(beam(V(s * 0.4, H - 0.12, 0.36), V(s * xc, H - 0.04, 0.36), 0.03, M.frame));
  // Neutral handles: grip along Z under a bracket from the top rail.
  for (const s of [1, -1]) {
    const x = s * hx;
    g.add(beam(V(s * xc, H - 0.08, hz), V(x, H - 0.08, hz), 0.05, M.frame, 0.05));
    for (const dz of [-0.09, 0.09]) g.add(beam(V(x, H - 0.08, hz + dz), V(x, hy, hz + dz), 0.03, M.steel, 0.025));
    g.add(beam(V(x, H - 0.08, hz - 0.1), V(x, H - 0.08, hz + 0.1), 0.04, M.frame, 0.04));
    const grip = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.17, 16).rotateX(Math.PI / 2), M.rubber);
    grip.position.set(x, hy, hz); g.add(grip);
  }
  // Counterweight stack between the columns (front); stack part starts 2 cm lifted (cable under tension at the top).
  const { stack, top } = weightStack(g, M, { z: zs, n: 14, pinned: 6, rodTop: 1.9 });
  stack.position.y = 0.02;
  // Knee-pad carriage on two chrome rods in front of the knees, cantilever arms back to the pad.
  const zr = 0.44, padT = 0.08, [pz0, pz1] = C.padZ;
  for (const s of [1, -1]) g.add(rod(V(s * 0.17, 0.08, zr), V(s * 0.17, 1.32, zr), 0.016, M.chrome));
  g.add(beam(V(-0.25, 1.34, zr), V(0.25, 1.34, zr), 0.05, M.frame), beam(V(-0.25, 0.08, zr), V(0.25, 0.08, zr), 0.05, M.frame));
  for (const s of [1, -1]) g.add(beam(V(s * 0.25, 1.34, zr), V(s * xc, 1.34, zc), 0.05, M.frame));
  const platform = new THREE.Group(); platform.name = 'platform';
  const yC = padTop - padT - 0.03; // carriage / arm height under the pad
  platform.add(rbox(0.46, 0.12, 0.08, R, 0, yC, zr, 0.01));
  for (const s of [1, -1]) platform.add(rbox(0.05, 0.13, 0.06, M.steel, s * 0.17, yC, zr, 0.008)); // bushings
  platform.add(beam(V(0, yC, zr), V(0, yC, pz0 + 0.05), 0.06, R, 0.05));
  platform.add(pad(0.42, padT, pz1 - pz0, M, 0, padTop - padT / 2, (pz0 + pz1) / 2, 0.035));
  g.add(platform);
  // Linkage cable: carriage → floor pulley → top wheel → stack (dynamic ends).
  const floorW = V(0, 0.12, zr + 0.06), topW = V(0, 2.2, zs);
  for (const w of [floorW, topW]) { const p = pulleyX(M, 0.05); p.position.copy(w); g.add(p); }
  g.add(rod(V(0, 0.12, zr + 0.11), V(0, 2.2, zr + 0.11), 0.0045, M.cable, 6)); // floor wheel → up the frame
  g.add(rod(V(0, 2.25, zr + 0.11), V(0, 2.25, zs), 0.0045, M.cable, 6));
  const down = rod(V(0, yC, zr + 0.04), floorW, 0.0045, M.cable, 6), up = rod(top, topW, 0.0045, M.cable, 6);
  g.add(down, up);
  const _a = V(0, 0, 0), _b = V(0, 0, 0), topY0 = top.y;
  return {
    group: g, parts: { platform, stack }, anchors: { handle_L: V(hx, hy, hz), handle_R: V(-hx, hy, hz) },
    update() {
      stretchBetween(down, _a.set(0, yC - 0.06 + platform.position.y, zr + 0.06), floorW);
      stretchBetween(up, _b.set(0, topY0 + stack.position.y, zs), topW);
    },
  };
}

// ── Seated cable row ────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Long seat along Z, two angled foot plates (sole plane tilted `footTilt`° from the floor, toes up) and a low pulley
 * between them; column with the stack behind it. FOOT = sole point under the left ankle (mirror X for the right).
 */
export const SEATED_ROW = { seatTop: 0.42, footTilt: 60, foot: [0.14, 0.24, 0.8], pulley: [0, 0.36, 1.02] };

function seated_row() {
  const M = getMaterials(), R = red(), g = new THREE.Group(), C = SEATED_ROW;
  const zc = 1.14, zs = 1.38, Ht = 1.75, [, py, pz] = C.pulley;
  // Base rail from the seat to the column, feet.
  g.add(beam(V(0, 0.035, -0.6), V(0, 0.035, zs + 0.12), 0.1, M.frame, 0.06));
  tFoot(g, M, -0.55, 0.28); tFoot(g, M, zs + 0.02, 0.4);
  // Seat (long pad) on two posts.
  for (const z of [-0.38, 0.08]) g.add(beam(V(0, 0.06, z), V(0, C.seatTop - 0.08, z), 0.06, M.frame, 0.06));
  g.add(pad(0.32, 0.07, 0.62, M, 0, C.seatTop - 0.035, -0.12, 0.03));
  // Foot plates: plane through the sole points, normal up-back towards the lifter.
  const tilt = C.footTilt * D2R, [fx, fy, fz] = C.foot;
  const n = V(0, Math.cos(tilt), -Math.sin(tilt)), toe = V(0, Math.sin(tilt), Math.cos(tilt));
  for (const s of [1, -1]) {
    const plate = rbox(0.14, 0.022, 0.3, M.steel, 0, 0, 0, 0.006);
    plate.rotation.x = -tilt;
    plate.position.set(s * fx, fy, fz).addScaledVector(toe, 0.06).addScaledVector(n, -0.011);
    g.add(plate, gripStrip(plate, 0.12, 0.26, 0.013, M));
  }
  // Foot-plate frame (red): a tilted cross bar behind both plates on a post from the base rail.
  const bar = V(0, fy, fz).addScaledVector(toe, 0.06).addScaledVector(n, -0.04);
  g.add(beam(V(-fx - 0.05, bar.y, bar.z), V(fx + 0.05, bar.y, bar.z), 0.05, R, 0.05));
  g.add(beam(V(0, 0.06, bar.z + 0.06), V(0, bar.y, bar.z), 0.06, R, 0.06));
  // Low pulley between the plates, guide frame to the column.
  const low = pulleyX(M, 0.05); low.position.set(0, py - 0.05, pz); g.add(low);
  g.add(beam(V(0, 0.06, pz), V(0, py - 0.11, pz), 0.05, M.frame, 0.05));
  g.add(beam(V(0, py - 0.05, pz + 0.04), V(0, py - 0.05, zc), 0.04, M.frame, 0.03));
  // Column (red) + stack behind it, cable routing: low pulley → base wheel → up the column → over → down to the stack.
  g.add(beam(V(0, 0.06, zc), V(0, Ht, zc), 0.1, R, 0.1));
  g.add(beam(V(0, Ht, zc - 0.05), V(0, Ht, zs + 0.05), 0.08, R, 0.08));
  const { stack, top } = weightStack(g, M, { z: zs, n: 16, pinned: 6, rodTop: 1.6 });
  for (const s of [1, -1]) g.add(beam(V(s * 0.19, 1.62, zs), V(s * 0.19, Ht, zs), 0.04, M.frame));
  const wTop = V(0, Ht - 0.09, zs);
  for (const p of [V(0, 0.15, zc - 0.07), V(0, Ht - 0.09, zc - 0.07), wTop]) { const w = pulleyX(M, 0.05); w.position.copy(p); g.add(w); }
  g.add(rod(V(0, py - 0.1, pz), V(0, 0.1, zc - 0.07), 0.0045, M.cable, 6));
  g.add(rod(V(0, 0.15, zc - 0.12), V(0, Ht - 0.09, zc - 0.12), 0.0045, M.cable, 6));
  g.add(rod(V(0, Ht - 0.04, zc - 0.07), V(0, Ht - 0.04, zs), 0.0045, M.cable, 6));
  const lift = rod(top, wTop, 0.0045, M.cable, 6); g.add(lift);
  const topY0 = top.y, from = V(0, 0, 0);
  return {
    group: g, parts: { stack }, anchors: { pulley: V(0, py, pz) },
    cableStacks: { pulley: 'stack' }, stackRatio: 0.5,
    update() { stretchBetween(lift, from.set(0, topY0 + stack.position.y, zs), wTop); },
  };
}

// ── Chest-supported plate-loaded row ────────────────────────────────────────────────────────────────────────────
/**
 * Seat + vertical chest pad; levers hang from an overhead pivot (y 1.86, z 0.25) to vertical (neutral) handles in
 * front of the lifter. Plates sit on horns low on the levers.
 */
export const ROW = {
  // chestPad.z = pad face, flush with the lifter's sternum; angleBottom = arms straight (shoulder → fist ≈ 0.62).
  seatTop: 0.48, seatZ: -0.02, chestPad: { y: 0.95, z: 0.165, t: 0.08, h: 0.38 },
  pivotY: 1.86, pivotZ: 0.25, L: 1.03, handX: 0.25, leverX: 0.41,
  angleTop: -98, angleBottom: -67, gripTop: 8, gripMid: -6, gripBottom: -6,
};

function row() {
  const M = getMaterials(), R = red(), g = new THREE.Group(), C = ROW;
  const zT = 1.0, yTop = C.pivotY + 0.12, xT = 0.56;
  // Base: side rails, cross members, centre rail under the seat.
  for (const s of [1, -1]) g.add(beam(V(s * xT, 0.035, -0.45), V(s * xT, 0.035, zT + 0.1), 0.08, M.frame, 0.06));
  tFoot(g, M, -0.42, xT + 0.05); tFoot(g, M, zT + 0.05, xT + 0.05);
  g.add(beam(V(0, 0.035, -0.42), V(0, 0.035, 0.62), 0.08, M.frame, 0.06));
  // Front towers + overhead beams (red) carrying the pivot hubs.
  for (const s of [1, -1]) {
    g.add(beam(V(s * xT, 0.06, zT), V(s * xT, yTop, zT), 0.09, R, 0.1));
    g.add(beam(V(s * xT, yTop, zT + 0.05), V(s * xT, yTop, C.pivotZ - 0.1), 0.09, R, 0.09));
    g.add(beam(V(s * xT, yTop - 0.03, C.pivotZ), V(s * (C.leverX + 0.04), C.pivotY, C.pivotZ), 0.06, M.frame, 0.07));
    g.add(at(mesh(cylX(0.06, 0.08, 24), M.steel), s * (C.leverX + 0.06), C.pivotY, C.pivotZ));
  }
  g.add(beam(V(-xT, yTop, zT), V(xT, yTop, zT), 0.08, M.frame, 0.09));
  g.add(beam(V(-xT, yTop, C.pivotZ - 0.05), V(xT, yTop, C.pivotZ - 0.05), 0.07, M.frame, 0.07));
  // Seat on a post.
  g.add(beam(V(0, 0.06, C.seatZ - 0.04), V(0, C.seatTop - 0.08, C.seatZ - 0.04), 0.07, M.frame, 0.07));
  g.add(pad(0.38, 0.075, 0.36, M, 0, C.seatTop - 0.0375, C.seatZ));
  // Chest pad: post between the shins, bracket up to the back of the pad.
  const cp = C.chestPad, zPost = 0.62, padBack = cp.z + cp.t;
  g.add(beam(V(0, 0.06, zPost), V(0, 0.78, zPost), 0.06, R, 0.06));
  g.add(beam(V(0, 0.78, zPost), V(0, cp.y - 0.05, padBack + 0.02), 0.055, R, 0.055));
  const chest = pad(0.32, cp.t, cp.h, M, 0, cp.y, cp.z + cp.t / 2, 0.035);
  chest.rotation.x = -Math.PI / 2; // pad face towards −Z (the lifter's chest)
  g.add(chest);
  // Levers hanging from the pivot (top configuration = handles back at the ribs).
  const [, hy, hz] = leverHandle(C, C.angleTop);
  const hY = hy - C.pivotY, hZ = hz - C.pivotZ;
  // Straight arm from the pivot through the handle hub, extended below it to the horn (small plates beside the hips,
  // clear of the arms; they swing back and up as the handles are pulled).
  const { parts, update } = leverPair(g, M, C, (side, lever) => {
    const ext = V(0, hY * 1.2, hZ * 1.2);
    lever.add(tube([V(0, 0, 0), V(0, hY * 0.5, hZ * 0.5 + 0.03), V(0, hY, hZ), ext], 0.034, R));
    lever.add(mesh(cylX(0.05, 0.07, 24), R));
    const horn = plateHorn(M, side, [5, 5, 2.5], 0.16); horn.position.copy(ext); lever.add(horn);
  });
  return { group: g, parts, anchors: {}, update };
}

// ── 45° back extension (hyperextension) ─────────────────────────────────────────────────────────────────────────
/**
 * Body line tilted `incline`° forward from vertical. `hip` = hip-joint centre on the bench; the hip pads support the
 * front of the upper thighs just below the hip crease, the ankle roller holds the lower calves, feet on an angled
 * platform. Helper hyperFrame() gives the leg direction / normals used by both machine and pose.
 */
// legLen 0.888 of the 0.89 thigh + shin: legs straight with soft knees (a shorter leg line bends the knees forward
// and pushes the thighs into the hip pads).
export const HYPER = { hip: [0, 1.02, 0], incline: 45, legLen: 0.888, footTilt: 30 };

/** d = unit vector hip → ankle along the legs, n = forward normal (towards the pads), plus the ankle point. */
export function hyperFrame() {
  const a = HYPER.incline * D2R, [x, y, z] = HYPER.hip;
  const d = V(0, -Math.cos(a), -Math.sin(a)), n = V(0, -Math.sin(a), Math.cos(a));
  const ankle = V(x, y, z).addScaledVector(d, HYPER.legLen);
  return { d, n, hip: V(x, y, z), ankle };
}

function hyperextension() {
  const M = getMaterials(), R = red(), g = new THREE.Group();
  const { d, n, hip, ankle } = hyperFrame();
  const along = (s, off) => hip.clone().addScaledVector(d, s).addScaledVector(n, off);
  // Hip pads (two, angled with the legs) — top edge just below the hip crease.
  const padC = along(0.17, 0.085 + 0.045);
  for (const s of [1, -1]) {
    const p = pad(0.17, 0.09, 0.3, M, 0, 0, 0, 0.04);
    p.position.copy(padC).setX(s * 0.1);
    p.quaternion.setFromUnitVectors(_up, n.clone().negate()); // pad face (local +Y) towards the thighs
    g.add(p);
  }
  // Ankle roller behind the lower calves, foot platform tilted `footTilt`.
  const rollC = ankle.clone().addScaledVector(d, -0.1).addScaledVector(n, -0.095);
  g.add(roller(0.3, 0.045, M, 0, rollC.y, rollC.z));
  g.add(mesh(cylX(0.012, 0.42), M.steel).translateY(rollC.y).translateZ(rollC.z));
  const ft = HYPER.footTilt * D2R, fn = V(0, Math.cos(ft), Math.sin(ft));
  const sole = ankle.clone().addScaledVector(fn, -0.085); // sole point under the ankle
  const plate = rbox(0.42, 0.03, 0.32, M.steel, 0, 0, 0, 0.006);
  plate.quaternion.setFromUnitVectors(_up, fn);
  plate.position.copy(sole).addScaledVector(fn, -0.015).add(V(0, -Math.sin(ft) * 0.06, Math.cos(ft) * 0.06));
  g.add(plate, gripStrip(plate, 0.4, 0.28, 0.017, M));
  // Frame: main spine along the legs under everything, floor base, uprights to the pads/roller/plate.
  const base0 = V(0, 0.06, ankle.z - 0.35), base1 = V(0, 0.06, hip.z + 0.55);
  g.add(beam(base0, base1, 0.1, M.frame, 0.06));
  tFoot(g, M, base0.z + 0.05, 0.34); tFoot(g, M, base1.z - 0.05, 0.36);
  const spineTop = along(0.18, 0.26), spineLow = V(0, 0.07, ankle.z - 0.2);
  g.add(beam(spineLow, spineTop, 0.09, R, 0.07));
  g.add(beam(V(0, 0.07, hip.z + 0.45), along(0.25, 0.25), 0.08, R, 0.07)); // front strut
  g.add(beam(along(0.25, 0.2), padC.clone().addScaledVector(n, 0.05), 0.06, M.frame)); // pad bracket
  g.add(beam(rollC, ankle.clone().addScaledVector(n, 0.2), 0.05, M.frame)); // roller post
  g.add(beam(sole.clone().addScaledVector(fn, -0.05), V(0, 0.07, sole.z + 0.05), 0.06, M.frame));
  // Mounting handles: a cross bar on the frame under the pads, grips at its ends pointing forward-down, out at the
  // sides and below the pads — clear of the torso and the crossed arms at the bottom of the rep.
  g.add(beam(along(0.4, 0.24).setX(0.3), along(0.4, 0.24).setX(-0.3), 0.035, M.frame));
  for (const s of [1, -1]) g.add(rod(along(0.4, 0.24).setX(s * 0.3), along(0.4, 0.38).setX(s * 0.31), 0.018, M.rubber));
  return { group: g, parts: {}, anchors: { hip: hip.clone() } };
}

export default { lat_pulldown, high_row, assisted_pullup, seated_row, row, hyperextension };
