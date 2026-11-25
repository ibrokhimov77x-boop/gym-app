// Machine batch "chest_shoulders": map machineKey → factory(opts) returning { group, parts, anchors, update? }.
// Contract: machines/index.js; geometry conventions: ../README.md (metres, Y up, the lifter faces +Z, left = +X).
//
// Style: commercial selectorized / plate-loaded line in an Impulse-like finish: red powder-coated main frame,
// graphite levers and shrouds, brushed steel / chrome moving parts, black upholstery.
//
// Rotating arms. The engine's movers only translate a part along an axis, so a machine arm cannot follow a hand
// directly. Every machine here therefore owns three invisible probe parts (`drive_x/y/z`). The spec binds them to
// the driving hand with `driveMovers('hand_L')` (one mover per axis) and passes that hand's TOP-pose position as
// `machineOpts.hand` (and its BOTTOM-pose position as `machineOpts.handRest`, where the weight rests). In update()
// the machine rebuilds the live hand position = hand + probe offsets and turns its arms/levers to match; the stack
// rises with the arm angle. Iso-lateral arms move together, so one hand drives both sides (mirrored).
//
// Spec-facing exports (single source of truth for poses): SEAT helpers, CHEST_PRESS / chestPressHand,
// PEC_DECK / pecDeckHand, SHOULDER_PRESS / shoulderPressHand, LATERAL_RAISE / lateralRaiseHand, SMITH_INCLINE.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { getMaterials } from '../materials.js';
import { stretchBetween, lathe, discProfile } from '../geo.js';
import { buildPlate } from '../props.js';
import common, { BENCH_FLAT, rbox, beam, rod, cylX } from './common.js';

const D2R = Math.PI / 180;

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const mesh = (geo, mat) => new THREE.Mesh(geo, mat);
const cylZ = (r, len, seg = 20) => new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2);

/** Rubber floor pad under a frame foot. */
const foot = (x, z, M, w = 0.08, d = 0.1) => rbox(w, 0.016, d, M.rubber, x, 0.008, z, 0.005);

/**
 * Upholstered pad: cushion (w × h × t) with its face towards local +Z and a graphite backing board behind it.
 * Returned group's origin = centre of the cushion.
 */
function pad(w, h, t, M) {
  const g = new THREE.Group();
  g.add(rbox(w, h, t, M.upholstery, 0, 0, 0, Math.min(0.03, t * 0.45)));
  g.add(rbox(w - 0.03, h - 0.03, 0.018, M.frame, 0, 0, -t / 2 - 0.009, 0.005));
  return g;
}

// ── Seated lifter geometry (shared by the seated machines and their specs) ─────────────────────────────────────
// Measured on the figure: the shoulder joint sits (0.46 up, 0.035 back) from the hip-joint centre in the trunk
// frame; the back surface is 0.11 behind the hip joint; the hip joint is 0.105 above the seat cushion.
export const SEAT = { hipToShoulder: [0.46, -0.035], backOffset: 0.11, hipAboveSeat: 0.105 };

/** Trunk frame of a seated lifter: recline (deg, + = leaning back) → unit up / forward vectors. */
function trunk(recline) {
  const a = recline * D2R;
  return { up: V(0, Math.cos(a), -Math.sin(a)), fwd: V(0, Math.sin(a), Math.cos(a)) };
}
/** Shoulder joint (left, +X) of a lifter seated with hip-joint centre `pelvis` and trunk recline (deg). */
export function seatedShoulder(pelvis, recline = 0) {
  const { up, fwd } = trunk(recline);
  const [u, f] = SEAT.hipToShoulder;
  const p = V(...pelvis).addScaledVector(up, u).addScaledVector(fwd, f);
  return [0.2, +p.y.toFixed(4), +p.z.toFixed(4)];
}

/** Seat cushion (top surface at y, from z0 to z1) on a post with a pop-pin, plus a back pad along the trunk. */
function seatAndBack(g, M, R, { pelvis, recline = 0, seatZ = [-0.12, 0.3], back = [0.1, 0.72], seatW = 0.38, backW = 0.34 }) {
  const P = V(...pelvis), top = P.y - SEAT.hipAboveSeat;
  const [z0, z1] = seatZ, t = 0.075;
  const seat = pad(seatW, z1 - z0, t, M);
  seat.rotation.x = -Math.PI / 2;
  seat.position.set(0, top - t / 2, (z0 + z1) / 2);
  g.add(seat);
  const zp = (z0 + z1) / 2 - 0.04;
  g.add(rbox(0.09, 0.05, 0.22, M.frame, 0, top - t - 0.03, zp, 0.008));               // seat carriage
  g.add(beam(V(0, 0.05, zp), V(0, top - t - 0.05, zp), 0.07, R));                      // seat post
  g.add(rbox(0.03, 0.03, 0.05, M.accent, 0, top - t - 0.16, zp + 0.05, 0.008));       // height pop-pin
  if (!back) return { seatTop: top, zPost: zp };
  const { up, fwd } = trunk(recline);
  const [b0, b1] = back, bt = 0.08;
  const bp = pad(backW, b1 - b0, bt, M);
  bp.rotation.x = -recline * D2R;
  bp.position.copy(P).addScaledVector(fwd, -(SEAT.backOffset + bt / 2)).addScaledVector(up, (b0 + b1) / 2);
  g.add(bp);
  // Anchor of the back pad's rear face (centre) for the frame to attach to.
  const backRear = bp.position.clone().addScaledVector(fwd, -bt / 2 - 0.02);
  return { seatTop: top, zPost: zp, backRear, up, fwd };
}

// ── Weight stack (selectorized machines) ───────────────────────────────────────────────────────────────────────
/**
 * Guide rods, rubber base, n plates; the top `pinned` plates + top plate + selector stem + pin form the moving part.
 * Returns { stack (Group to raise), attach (Vector3: cable point at rest, world), topRod }.
 */
function weightStack(g, M, R, { x = 0, z, n = 14, pinned = 5, w = 0.27, d = 0.13, pitch = 0.033, rodTop = 1.55 }) {
  const y0 = 0.1, plateGeo = new RoundedBoxGeometry(w, pitch - 0.004, d, 1, 0.004);
  for (const dx of [w * 0.36, -w * 0.36]) g.add(rod(V(x + dx, 0.04, z), V(x + dx, rodTop, z), 0.008, M.chrome, 10));
  g.add(rbox(w + 0.06, 0.04, d + 0.06, M.rubber, x, 0.07, z, 0.01));
  const stack = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const p = mesh(plateGeo, M.stack);
    p.position.set(x, y0 + (pitch - 0.004) / 2 + i * pitch, z);
    (i >= n - pinned ? stack : g).add(p);
  }
  const topY = y0 + n * pitch;
  stack.add(rbox(w - 0.02, 0.035, d + 0.01, R, x, topY + 0.018, z, 0.006));
  stack.add(rod(V(x, y0 + (n - pinned) * pitch - 0.01, z), V(x, topY + 0.05, z), 0.007, M.chrome, 10));
  const pinY = y0 + (n - pinned) * pitch + pitch / 2;
  const pin = mesh(cylZ(0.006, 0.1, 10), M.steel); pin.position.set(x, pinY, z + d / 2 + 0.03);
  stack.add(pin, rbox(0.026, 0.026, 0.03, M.accent, x, pinY, z + d / 2 + 0.085, 0.008));
  g.add(stack);
  return { stack, attach: V(x, topY + 0.05, z) };
}

/** Pulley wheel (axis along X by default) at p. */
const pulleyGeo = () => lathe(discProfile(0.05, 0.024, 0.006, 0.012), 24).rotateZ(Math.PI / 2);

/**
 * Internal cable from the moving stack top over fixed points. Returns update(lift) that re-stretches the first
 * (moving) segment without allocating.
 */
function stackCable(g, M, attach, path) {
  for (let i = 0; i < path.length - 1; i++) g.add(rod(path[i], path[i + 1], 0.005, M.cable, 6));
  const lift = rod(attach, path[0], 0.005, M.cable, 6);
  g.add(lift);
  const from = V(0, 0, 0);
  return (dy) => { from.copy(attach).y += dy; stretchBetween(lift, from, path[0]); };
}

// ── Hand drive (see header) ────────────────────────────────────────────────────────────────────────────────────
/** Spec helper: movers that feed an effector's displacement into the machine's probe parts. */
export const driveMovers = (follow = 'hand_L') => [
  { part: 'drive_x', follow, axis: [1, 0, 0] },
  { part: 'drive_y', follow, axis: [0, 1, 0] },
  { part: 'drive_z', follow, axis: [0, 0, 1] },
];
/** Machine side: probe parts + a function returning the live hand position (world). */
function makeDrive(g, parts, rest = [0, 0, 0]) {
  const probes = ['x', 'y', 'z'].map((a) => {
    const o = new THREE.Object3D(); o.name = 'drive_' + a; g.add(o); parts['drive_' + a] = o; return o;
  });
  const out = V(0, 0, 0);
  return () => out.set(rest[0] + probes[0].position.x, rest[1] + probes[1].position.y, rest[2] + probes[2].position.z);
}

// ── Olympic flat bench with uprights ───────────────────────────────────────────────────────────────────────────
/**
 * Pad identical to bench_flat (top y = 0.45, z −0.75 … +0.45). Uprights at x = ±0.56 behind the head (z = −0.56)
 * with J-cups at opts.hookHeight (1.10) that hold the bar over the eyes (z ≈ −0.47), lower spotter catches,
 * plate-storage horns at the back. Static (the bar is the barbell prop).
 */
function bench_rack(opts = {}) {
  const M = getMaterials(), R = M.frameRed, g = new THREE.Group();
  const top = BENCH_FLAT.top, z0 = BENCH_FLAT.zHead, z1 = BENCH_FLAT.zFoot, w = BENCH_FLAT.width;
  const X = 0.56, zU = -0.56, hookY = opts.hookHeight ?? 1.1, catchY = opts.catchHeight ?? 0.86;
  // Pad + board.
  g.add(rbox(w, 0.07, z1 - z0, M.upholstery, 0, top - 0.035, (z0 + z1) / 2, 0.028));
  g.add(rbox(w - 0.03, 0.016, z1 - z0 - 0.04, M.frame, 0, top - 0.078, (z0 + z1) / 2, 0.004));
  // Spine beam, foot-end leg with T-foot, head end rests on the upright cross-member.
  const yb = top - 0.12;
  g.add(beam(V(0, yb, zU), V(0, yb, z1 - 0.12), 0.08, M.frame, 0.06));
  g.add(beam(V(0, 0.06, z1 - 0.16), V(0, yb, z1 - 0.16), 0.07, M.frame, 0.06));
  g.add(beam(V(-0.25, 0.035, z1 - 0.16), V(0.25, 0.035, z1 - 0.16), 0.07, M.frame, 0.05));
  for (const s of [1, -1]) g.add(foot(s * 0.23, z1 - 0.16, M, 0.06, 0.08));
  // Upright frame: floor H-base, two red posts, cross-member under the pad.
  g.add(beam(V(-X - 0.06, 0.035, zU), V(X + 0.06, 0.035, zU), 0.07, M.frame, 0.06));
  g.add(beam(V(-X, yb, zU), V(X, yb, zU), 0.06, R));
  for (const s of [1, -1]) {
    const x = s * X;
    g.add(beam(V(x, 0.035, zU - 0.3), V(x, 0.035, zU + 0.22), 0.08, M.frame, 0.06));
    g.add(foot(x, zU - 0.26, M), foot(x, zU + 0.18, M));
    g.add(beam(V(x, 0.06, zU), V(x, hookY + 0.2, zU), 0.075, R));
    g.add(rbox(0.085, 0.02, 0.085, M.frame, x, hookY + 0.21, zU, 0.006));             // post cap
    // J-cup: steel bracket on the post face + UHMW-lined cup + front lip.
    for (const [y, big] of [[hookY, true], [catchY, false]]) {
      g.add(rbox(0.08, big ? 0.14 : 0.1, 0.02, M.steel, x, y, zU + 0.048, 0.005));
      g.add(rbox(0.07, 0.016, 0.075, M.rubber, x, y - 0.02, zU + 0.095, 0.005));
      g.add(rbox(0.07, 0.05, 0.014, M.steel, x, y + 0.005, zU + 0.135, 0.005));
    }
    // Plate-storage horn at the back of each post with a 20 kg plate.
    g.add(rod(V(x, 0.3, zU - 0.035), V(x, 0.3, zU - 0.2), 0.024, M.steel));
    const plate = buildPlate(20); plate.rotation.x = Math.PI / 2; plate.position.set(x, 0.3, zU - 0.12); g.add(plate);
  }
  return {
    group: g, parts: {},
    anchors: { padTop: V(0, top, (z0 + z1) / 2), bar_rest: V(0, hookY - 0.012 + 0.014, zU + 0.095) },
  };
}

// ── Smith combos (Smith machine + bench in one station) ────────────────────────────────────────────────────────
/** Smith machine + flat bench. opts.benchZ shifts the bench (+ lifter) along Z; others go to smith(). */
function smith_bench(opts = {}) {
  const smith = common.smith(opts), bench = common.bench_flat({ zHead: BENCH_FLAT.zHead + (opts.benchZ ?? 0) });
  const g = new THREE.Group();
  g.add(smith.group, bench.group);
  return { group: g, parts: smith.parts, anchors: { ...bench.anchors, ...smith.anchors } };
}

/** Smith incline: the adjustable bench at 30° shifted by SMITH_INCLINE.benchZ so the bar meets the upper chest. */
export const SMITH_INCLINE = { incline: 30, benchZ: 0.3 };
function smith_incline(opts = {}) {
  const smith = common.smith(opts);
  const bench = common.bench_adjustable({ incline: opts.incline ?? SMITH_INCLINE.incline });
  bench.group.position.z = opts.benchZ ?? SMITH_INCLINE.benchZ;
  const g = new THREE.Group();
  g.add(smith.group, bench.group);
  return { group: g, parts: { ...bench.parts, ...smith.parts }, anchors: smith.anchors };
}

// ── Plate-loaded iso-lateral chest press ───────────────────────────────────────────────────────────────────────
/**
 * Lifter seated (hip joint at `pelvis`, back pad reclined 10°). Each lever hangs from an overhead pivot
 * (y = pivotY, z = pivotZ) like a pendulum; its vertical (neutral) handle sits `r` below the pivot at x = ±handX.
 * Pressing swings the levers forward on a shallow arc and lifts the plates loaded on horns at their lower ends.
 * Lever angle θ: 0 = hanging straight down, + = swung forward (towards +Z).
 */
export const CHEST_PRESS = { pelvis: [0, 0.56, 0], recline: 10, pivotY: 1.85, pivotZ: 0.17, r: 0.97, handX: 0.25, leverX: 0.47 };
/** Fist centre on the handle of side s (+1 = left/+X) at lever angle `deg`. */
export function chestPressHand(deg, s = 1) {
  const C = CHEST_PRESS, a = deg * D2R;
  return [s * C.handX, +(C.pivotY - C.r * Math.cos(a)).toFixed(4), +(C.pivotZ + C.r * Math.sin(a)).toFixed(4)];
}

function chest_press(opts = {}) {
  const M = getMaterials(), R = M.frameRed, g = new THREE.Group(), parts = {};
  const C = CHEST_PRESS, hand = makeDrive(g, parts, opts.hand);
  const { backRear } = seatAndBack(g, M, R, { pelvis: C.pelvis, recline: C.recline, seatZ: [-0.12, 0.3], back: [0.08, 0.7] });
  const zT = -0.5, XT = C.leverX, H = C.pivotY + 0.1;
  // Frame: floor rectangle, rear posts, overhead beams to the pivots, cross-tube.
  for (const s of [1, -1]) {
    g.add(beam(V(s * 0.36, 0.035, zT - 0.12), V(s * 0.36, 0.035, 0.3), 0.08, M.frame, 0.06));
    g.add(foot(s * 0.36, zT - 0.08, M), foot(s * 0.36, 0.26, M));
    g.add(beam(V(s * 0.36, 0.06, zT), V(s * XT, H, zT), 0.09, R, 0.07));
    g.add(beam(V(s * XT, H, zT - 0.04), V(s * XT, H, C.pivotZ + 0.08), 0.09, R, 0.07));
    g.add(rbox(0.1, 0.12, 0.12, M.frame, s * XT, C.pivotY + 0.02, C.pivotZ, 0.012));   // bearing block
  }
  g.add(beam(V(-0.4, 0.035, zT - 0.12), V(0.4, 0.035, zT - 0.12), 0.08, M.frame, 0.06));
  g.add(beam(V(-0.4, 0.035, 0.3), V(0.4, 0.035, 0.3), 0.07, M.frame, 0.05));
  g.add(beam(V(0, 0.035, zT - 0.12), V(0, 0.035, 0.3), 0.07, M.frame, 0.05));
  g.add(beam(V(-XT, H, zT), V(XT, H, zT), 0.08, R, 0.07));
  g.add(beam(V(-XT, H, C.pivotZ + 0.04), V(XT, H, C.pivotZ + 0.04), 0.07, R, 0.06));
  // Back pad bracket to the rear cross-tube.
  g.add(beam(backRear, V(0, backRear.y, zT), 0.06, M.frame, 0.05));
  g.add(beam(V(-0.36, backRear.y, zT), V(0.36, backRear.y, zT), 0.06, R, 0.05));
  // Levers (pivot at the group origin, built hanging straight down; rotation.x = −θ swings them forward).
  const grip = new THREE.CylinderGeometry(0.018, 0.018, 0.17, 16), stubGeo = cylX(0.013, C.leverX - C.handX + 0.02, 12);
  const levers = [1, -1].map((s) => {
    const L = new THREE.Group();
    L.position.set(0, C.pivotY, C.pivotZ);
    const xl = s * C.leverX, hx = s * C.handX, yh = -C.r;
    L.add(mesh(cylX(0.05, 0.12, 20), M.steel).translateX(xl));                        // hub
    L.add(beam(V(xl, 0, 0), V(xl, yh + 0.2, 0.05), 0.075, M.frame, 0.055));
    L.add(beam(V(xl, yh + 0.2, 0.05), V(xl, yh - 0.37, 0), 0.075, M.frame, 0.055));
    for (const dy of [0.105, -0.105]) {
      const stub = mesh(stubGeo, M.chrome); stub.position.set((xl + hx) / 2, yh + dy, 0); L.add(stub);
    }
    const g1 = mesh(grip, M.rubber); g1.position.set(hx, yh, 0); L.add(g1);
    // Loading horn at the lower end with 20 + 10 kg, low enough (plate top below the handles) that the plates never
    // hide the hands and chest from the side.
    const yHorn = yh - 0.33;
    const horn = mesh(cylX(0.025, 0.26, 18), M.steel); horn.position.set(xl + s * 0.15, yHorn, 0); L.add(horn);
    let xp = Math.abs(xl) + 0.05;
    for (const kg of [20, 10]) {
      const p = buildPlate(kg), th = p.userData.thickness;
      p.rotation.z = Math.PI / 2; p.position.set(s * (xp + th / 2), yHorn, 0); L.add(p); xp += th + 0.003;
    }
    L.add(rbox(0.03, 0.05, 0.05, M.rubber, xl, yh - 0.385, -0.02, 0.008));             // bumper on the stop
    g.add(L);
    return L;
  });
  return {
    group: g, parts, anchors: { pivot_L: V(C.leverX, C.pivotY, C.pivotZ), pivot_R: V(-C.leverX, C.pivotY, C.pivotZ) },
    update() {
      const h = hand();
      const th = Math.atan2(h.z - C.pivotZ, C.pivotY - h.y);
      for (const L of levers) L.rotation.x = -th;
    },
  };
}

// ── Pec deck / rear-delt fly (one machine, two seating directions) ─────────────────────────────────────────────
/**
 * Arms swing about vertical axes through the lifter's shoulder joints (x = ±0.2, z = opts.pivotZ). Each arm hangs
 * from a hub at hubY: a horizontal beam of length r, then a drop rod to a vertical (neutral) handle at handY.
 * Arm angle ψ (deg): 0 = handle straight in front of the pivot (+Z), + = swung outwards. Pec fly: the lifter sits
 * with the back on the pad (faces +Z). Rear-delt fly: the lifter turns round and sits with the chest on the same
 * pad face (faces −Z), straddling the column; the handles then work on the −Z side (ψ ≈ 150–180°).
 * Tower with the weight stack behind (z ≈ −0.85); the back pad is cantilevered from it.
 */
export const PEC_DECK = { pelvis: [0, 0.58, 0], recline: 3, padFaceZ: -0.115, hubY: 1.66, zTower: -0.85 };
/** Fist centre for side s at arm angle ψ (deg) for a given pivot z, radius and handle height. */
export function pecDeckHand(psi, s, { pivotZ, r, handY }) {
  const a = psi * D2R;
  return [+(s * (0.2 + r * Math.sin(a))).toFixed(4), handY, +(pivotZ + r * Math.cos(a)).toFixed(4)];
}

function pec_deck(opts = {}) {
  const M = getMaterials(), R = M.frameRed, g = new THREE.Group(), parts = {};
  const P = PEC_DECK, hand = makeDrive(g, parts, opts.hand);
  const pivotZ = opts.pivotZ ?? -0.06, r = opts.r ?? 0.56, handY = opts.handY ?? 0.96, zT = P.zTower;
  // Seat + back pad (face 0.11 behind the seated hip joint, reclined 3°), the pad cantilevered from the tower.
  const { backRear } = seatAndBack(g, M, R, { pelvis: P.pelvis, recline: P.recline, seatZ: [-0.1, 0.32], back: [0.14, 0.86], backW: 0.3 });
  // Base: spine beam under the seat to the tower, tower feet.
  g.add(beam(V(0, 0.035, 0.32), V(0, 0.035, zT), 0.08, M.frame, 0.06));
  g.add(beam(V(-0.3, 0.035, 0.32), V(0.3, 0.035, 0.32), 0.07, M.frame, 0.05));
  g.add(beam(V(-0.42, 0.035, zT), V(0.42, 0.035, zT), 0.08, M.frame, 0.06));
  for (const s of [1, -1]) g.add(foot(s * 0.27, 0.32, M), foot(s * 0.38, zT, M));
  // Tower: two red posts, top cross-beam, overhead beam forward to the pivot bearings.
  const HT = 1.92;
  for (const s of [1, -1]) {
    g.add(beam(V(s * 0.24, 0.06, zT), V(s * 0.24, HT, zT), 0.08, R, 0.07));
    g.add(beam(V(s * 0.24, HT, zT), V(s * 0.2, HT, pivotZ), 0.07, R, 0.06));
    g.add(rod(V(s * 0.2, HT, pivotZ), V(s * 0.2, P.hubY + 0.05, pivotZ), 0.022, M.steel));   // axle
    g.add(rbox(0.08, 0.06, 0.08, M.frame, s * 0.2, HT - 0.02, pivotZ, 0.01));                // bearing
  }
  g.add(beam(V(-0.28, HT + 0.02, zT), V(0.28, HT + 0.02, zT), 0.08, R, 0.07));
  g.add(beam(V(-0.22, HT, pivotZ), V(0.22, HT, pivotZ), 0.06, R, 0.06));
  // Back pad brackets from the tower (high enough for the reversed lifter's knees to pass below).
  for (const y of [backRear.y - 0.18, backRear.y + 0.2]) {
    const zb = backRear.z + (y - backRear.y) * Math.tan(P.recline * D2R) * -1;
    g.add(beam(V(0, y, zb), V(0, y, zT), 0.06, M.frame, 0.05));
  }
  // Stack between the posts + cable: stack top → top pulley → forward to the cam between the axles.
  const { stack, attach } = weightStack(g, M, R, { z: zT, rodTop: HT - 0.06, w: 0.3 });
  parts.stack = stack;
  const pulleys = [V(0, HT - 0.12, zT), V(0, HT - 0.12, pivotZ + 0.1)];
  for (const p of pulleys) { const w = mesh(pulleyGeo(), M.steel); w.position.copy(p); w.rotation.y = Math.PI / 2; g.add(w); }
  const setCable = stackCable(g, M, attach, [V(0, HT - 0.07, zT), ...pulleys.slice(1).map((p) => p.clone().setY(p.y + 0.05))]);
  // Arms (built at ψ = 0 pointing +Z; rotation.y = ±ψ).
  const gripGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.17, 16);
  const arms = [1, -1].map((s) => {
    const A = new THREE.Group();
    A.position.set(s * 0.2, P.hubY, pivotZ);
    A.add(mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.12, 20), M.steel));
    A.add(beam(V(0, 0, 0), V(0, 0, r + 0.02), 0.07, M.frame, 0.06));
    A.add(rod(V(0, -0.02, r), V(0, handY - P.hubY + 0.085, r), 0.014, M.chrome));
    const gr = mesh(gripGeo, M.rubber); gr.position.set(0, handY - P.hubY, r); A.add(gr);
    A.add(rbox(0.04, 0.02, 0.04, M.frame, 0, handY - P.hubY - 0.095, r, 0.006));       // grip end cap
    g.add(A);
    return { A, s };
  });
  const psiOf = (h) => Math.atan2(Math.abs(h.x) - 0.2, h.z - pivotZ);
  const rest = opts.handRest ? psiOf(V(...opts.handRest)) : 0;
  return {
    group: g, parts, anchors: { pivot_L: V(0.2, P.hubY, pivotZ), pivot_R: V(-0.2, P.hubY, pivotZ) },
    update() {
      const psi = psiOf(hand());
      for (const { A, s } of arms) A.rotation.y = s * psi;
      const lift = Math.abs(psi - rest) * 0.12;
      stack.position.y = lift;
      setCable(lift);
    },
  };
}

// ── Selectorized seated shoulder press (neutral handles) ───────────────────────────────────────────────────────
/**
 * Lifter seated, back pad reclined 8°. Levers pivot on a tower behind the seat (y = pivotY, z = pivotZ) and run
 * forward past the head at x = ±leverX to horizontal neutral handles (along Z) at x = ±handX, radius r.
 * Lever angle θ (deg): 0 = horizontal forward, + = raised. Stack behind the tower.
 */
export const SHOULDER_PRESS = { pelvis: [0, 0.57, 0], recline: 8, pivotY: 1.29, pivotZ: -0.85, r: 0.84, handX: 0.27, leverX: 0.44 };
export function shoulderPressHand(deg, s = 1) {
  const C = SHOULDER_PRESS, a = deg * D2R;
  return [s * C.handX, +(C.pivotY + C.r * Math.sin(a)).toFixed(4), +(C.pivotZ + C.r * Math.cos(a)).toFixed(4)];
}

function shoulder_press(opts = {}) {
  const M = getMaterials(), R = M.frameRed, g = new THREE.Group(), parts = {};
  const C = SHOULDER_PRESS, hand = makeDrive(g, parts, opts.hand);
  const { backRear } = seatAndBack(g, M, R, { pelvis: C.pelvis, recline: C.recline, seatZ: [-0.12, 0.3], back: [0.1, 0.78] });
  const zT = C.pivotZ, XT = C.leverX + 0.07, zS = zT - 0.2;
  // Base.
  g.add(beam(V(0, 0.035, 0.3), V(0, 0.035, zS), 0.08, M.frame, 0.06));
  g.add(beam(V(-0.3, 0.035, 0.3), V(0.3, 0.035, 0.3), 0.07, M.frame, 0.05));
  g.add(beam(V(-XT - 0.04, 0.035, zT), V(XT + 0.04, 0.035, zT), 0.08, M.frame, 0.06));
  for (const s of [1, -1]) {
    g.add(foot(s * 0.27, 0.3, M), foot(s * XT, zT, M));
    // Red tower posts carrying the lever bearings, braced to the stack frame.
    g.add(beam(V(s * XT, 0.06, zT), V(s * XT, C.pivotY + 0.12, zT), 0.08, R, 0.07));
    g.add(rbox(0.06, 0.12, 0.12, M.frame, s * (XT - 0.06), C.pivotY, zT, 0.01));        // bearing
    g.add(beam(V(s * 0.2, 0.06, zS), V(s * 0.2, 1.62, zS), 0.07, R, 0.06));
    g.add(beam(V(s * XT, C.pivotY + 0.12, zT), V(s * 0.2, 1.62, zS), 0.06, R, 0.05));
  }
  g.add(beam(V(-0.24, 1.64, zS), V(0.24, 1.64, zS), 0.07, R, 0.06));
  g.add(beam(V(-0.2, 0.035, zS), V(0.2, 0.035, zS), 0.07, M.frame, 0.05));
  // Back pad bracket.
  g.add(beam(backRear, V(0, backRear.y, zT), 0.06, M.frame, 0.05));
  g.add(beam(V(-XT, backRear.y, zT), V(XT, backRear.y, zT), 0.06, R, 0.05));
  // Stack + cable (stack top → top pulley → cam on the lever axle).
  const { stack, attach } = weightStack(g, M, R, { z: zS, rodTop: 1.58, w: 0.28 });
  parts.stack = stack;
  const pw = mesh(pulleyGeo(), M.steel); pw.position.set(0, 1.55, zS); pw.rotation.y = Math.PI / 2; g.add(pw);
  const setCable = stackCable(g, M, attach, [V(0, 1.6, zS), V(0, 1.6, zS + 0.05), V(0, C.pivotY + 0.07, zT)]);
  g.add(mesh(cylX(0.012, 2 * XT - 0.1, 12), M.steel).translateY(C.pivotY).translateZ(zT)); // axle
  const cam = mesh(lathe(discProfile(0.07, 0.03, 0.008, 0.014), 24).rotateZ(Math.PI / 2), M.frame);
  cam.position.set(0, C.pivotY, zT);
  g.add(cam);
  // Levers (group at the pivot, built horizontal pointing +Z; rotation.x = −θ raises them).
  const gripGeo = cylZ(0.018, 0.14, 16), stubGeo = cylX(0.013, C.leverX - C.handX + 0.02, 12);
  const levers = [1, -1].map((s) => {
    const L = new THREE.Group();
    L.position.set(0, C.pivotY, zT);
    const xl = s * C.leverX, hx = s * C.handX;
    L.add(mesh(cylX(0.05, 0.1, 20), M.steel).translateX(xl));
    L.add(beam(V(xl, 0, 0), V(xl, 0.02, C.r + 0.09), 0.07, M.frame, 0.055));
    for (const dz of [0.085, -0.085]) {
      const stub = mesh(stubGeo, M.chrome); stub.position.set((xl + hx) / 2, 0, C.r + dz); L.add(stub);
    }
    const gr = mesh(gripGeo, M.rubber); gr.position.set(hx, 0, C.r); L.add(gr);
    g.add(L);
    return L;
  });
  const thOf = (h) => Math.atan2(h.y - C.pivotY, h.z - C.pivotZ);
  const rest = opts.handRest ? thOf(V(...opts.handRest)) : 0;
  return {
    group: g, parts, anchors: { pivot_L: V(C.leverX, C.pivotY, zT), pivot_R: V(-C.leverX, C.pivotY, zT) },
    update() {
      const th = thOf(hand());
      for (const L of levers) L.rotation.x = -th;
      cam.rotation.x = -th;
      const lift = Math.max(0, th - rest) * 0.4;
      stack.position.y = lift;
      setCable(lift);
    },
  };
}

// ── Selectorized seated lateral raise ──────────────────────────────────────────────────────────────────────────
/**
 * Lifter seated facing the machine, chest against a small pad, elbows bent 90° with the forearms pointing forward.
 * The arms turn about axes along Z through the shoulder joints (x = ±0.2, y = shoulder height); their hubs sit in
 * front of the hands (z = hubZ). Each arm carries a roller pad lying along the outside of the elbow + forearm.
 * Arm angle α (deg): abduction of the upper arm from hanging (0) to shoulder height (≈ 90).
 */
export const LATERAL_RAISE = { pelvis: [0, 0.56, 0], hubZ: 0.47, zTower: 0.86 };
const LAT_UPPER = 0.3, LAT_FORE = 0.345, LAT_PALM = 0.022; // elbow radius, wrist→fist along the forearm, palm offset
/** Fist centre for side s at abduction α (deg); the forearm points forward, palm faces medially at α = 0. */
export function lateralRaiseHand(alpha, s = 1) {
  const sh = seatedShoulder(LATERAL_RAISE.pelvis, 0), a = alpha * D2R;
  const lx = -LAT_PALM, ly = -LAT_UPPER; // local offsets in the plane of rotation (left side)
  const x = lx * Math.cos(a) - ly * Math.sin(a), y = lx * Math.sin(a) + ly * Math.cos(a);
  return [+(s * (0.2 + x)).toFixed(4), +(sh[1] + y).toFixed(4), +(sh[2] + LAT_FORE).toFixed(4)];
}

function lateral_raise(opts = {}) {
  const M = getMaterials(), R = M.frameRed, g = new THREE.Group(), parts = {};
  const C = LATERAL_RAISE, hand = makeDrive(g, parts, opts.hand);
  const sh = seatedShoulder(C.pelvis, 0), zT = C.zTower;
  const { zPost } = seatAndBack(g, M, R, { pelvis: C.pelvis, seatZ: [-0.24, 0.17], back: null, seatW: 0.36 });
  // Chest pad (face at the sternum) on a beam from the tower.
  const padZ = 0.13, padY = sh[1] - 0.15;
  const cp = pad(0.22, 0.3, 0.07, M); cp.rotation.y = Math.PI; cp.position.set(0, padY, padZ + 0.035); g.add(cp);
  g.add(beam(V(0, padY - 0.06, padZ + 0.08), V(0, padY - 0.06, zT), 0.06, M.frame, 0.05));
  // Base + tower (posts either side of the stack), housings for the arm axles.
  g.add(beam(V(0, 0.035, zPost - 0.12), V(0, 0.035, zT), 0.08, M.frame, 0.06));
  g.add(beam(V(-0.3, 0.035, zPost - 0.12), V(0.3, 0.035, zPost - 0.12), 0.07, M.frame, 0.05));
  g.add(beam(V(-0.36, 0.035, zT), V(0.36, 0.035, zT), 0.08, M.frame, 0.06));
  for (const s of [1, -1]) {
    g.add(foot(s * 0.27, zPost - 0.12, M), foot(s * 0.33, zT, M));
    g.add(beam(V(s * 0.22, 0.06, zT), V(s * 0.22, 1.58, zT), 0.075, R, 0.07));
    g.add(rod(V(s * 0.2, sh[1], C.hubZ + 0.03), V(s * 0.2, sh[1], zT - 0.04), 0.024, M.steel));     // axle
    g.add(rbox(0.1, 0.1, 0.08, M.frame, s * 0.2, sh[1], zT - 0.06, 0.012));                      // bearing
  }
  g.add(beam(V(-0.26, 1.6, zT), V(0.26, 1.6, zT), 0.08, R, 0.07));
  const { stack, attach } = weightStack(g, M, R, { z: zT, rodTop: 1.54, w: 0.26, n: 12, pinned: 4 });
  parts.stack = stack;
  const pul = V(0, 1.5, zT + 0.02);
  const pw = mesh(pulleyGeo(), M.steel); pw.position.copy(pul); pw.rotation.y = Math.PI / 2; g.add(pw);
  const setCable = stackCable(g, M, attach, [pul.clone().setY(1.55), V(0, 1.55, zT - 0.08), V(0, sh[1] + 0.05, zT - 0.08)]);
  // Arms (group on the axis at the hub, built hanging straight down; rotation.z = ±angle).
  // The roller sits beside the elbow (outside the arm): angular lead PAD_LEAD over the elbow, radius padR. Along Z
  // it runs from just behind the elbow to the wrist (world z ≈ −0.07 … 0.27), so the pressure is on the elbow and
  // forearm, not on the hand; a chrome rod carries it from the arm beam at the hub.
  const PAD_LEAD = Math.atan2(0.09, LAT_UPPER), padR = Math.hypot(0.09, LAT_UPPER);
  const ROLL_LEN = 0.34, rollZ = sh[2] + 0.135 - C.hubZ;   // roller centre, local z (≈ mid-forearm)
  const rollerGeo = cylZ(0.042, ROLL_LEN, 18);
  const arms = [1, -1].map((s) => {
    const A = new THREE.Group();
    A.position.set(s * 0.2, sh[1], C.hubZ);
    A.add(mesh(cylZ(0.06, 0.06, 22), M.steel));
    A.add(beam(V(0, 0, 0.0), V(0, -padR - 0.02, 0.0), 0.07, M.frame, 0.05));
    A.add(rod(V(0, -padR, 0.0), V(0, -padR, rollZ + ROLL_LEN / 2), 0.012, M.chrome));
    const roller = mesh(rollerGeo, M.upholstery); roller.position.set(0, -padR, rollZ); A.add(roller);
    g.add(A);
    return { A, s };
  });
  // Live abduction from the fist (undo the palm offset of lateralRaiseHand).
  const palmLead = Math.atan2(LAT_PALM, LAT_UPPER);
  const alphaOf = (h) => Math.atan2(Math.abs(h.x) - 0.2, sh[1] - h.y) + palmLead;
  const rest = opts.handRest ? alphaOf(V(...opts.handRest)) : 0;
  return {
    group: g, parts, anchors: { axis_L: V(0.2, sh[1], C.hubZ), axis_R: V(-0.2, sh[1], C.hubZ) },
    update() {
      const al = alphaOf(hand());
      for (const { A, s } of arms) A.rotation.z = s * (al + PAD_LEAD);
      const lift = Math.max(0, al - rest) * 0.17;
      stack.position.y = lift;
      setCable(lift);
    },
  };
}

export default { bench_rack, smith_bench, smith_incline, chest_press, pec_deck, shoulder_press, lateral_raise };
