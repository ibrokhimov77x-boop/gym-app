// Common free-weight stations and cable/smith machines. All coordinates are world metres (figure at the origin,
// facing +Z). Exported constants (BENCH_FLAT, adjustableBenchFrame) let animation authors line poses up exactly.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { getMaterials } from '../materials.js';
import { unitCylinder, stretchBetween, lathe, discProfile } from '../geo.js';
import { buildPlate, platesFor } from '../props.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _up = V(0, 1, 0), _d = V(0, 0, 0);

const mesh = (geo, mat) => new THREE.Mesh(geo, mat);
/** Rounded box centred at (x, y, z). These geometry helpers are shared by every machine batch file. */
export function rbox(w, h, d, mat, x = 0, y = 0, z = 0, r = 0.008) {
  const m = mesh(new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2.2, h / 2.2, d / 2.2)), mat);
  m.position.set(x, y, z);
  return m;
}
/** Square tube between two points (`depth` ≠ size gives a rectangular section). */
export function beam(a, b, size, mat, depth = size) {
  const m = mesh(new RoundedBoxGeometry(size, a.distanceTo(b), depth, 1, Math.min(0.006, size / 3, depth / 3)), mat);
  m.position.addVectors(a, b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(_up, _d.subVectors(b, a).normalize());
  return m;
}
/** Round rod between two points. */
export function rod(a, b, r, mat, seg = 14) {
  const m = mesh(unitCylinder(r, seg), mat);
  stretchBetween(m, a, b);
  return m;
}
/** Cylinder along X. */
export const cylX = (r, len, seg = 20) => new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2);

/** Rubber-capped T-foot across X at height y (floor contact). */
function tFoot(g, z, halfW, M, y = 0.035) {
  g.add(beam(V(-halfW, y, z), V(halfW, y, z), 0.07, M.frame, 0.05));
  for (const s of [1, -1]) g.add(rbox(0.05, 0.02, 0.07, M.rubber, s * (halfW - 0.02), 0.01, z, 0.006));
}

// ── Flat bench ──────────────────────────────────────────────────────────────────────────────────────────────────
/** Flat bench along Z: head end at zHead, feet end at zFoot, pad top surface at `top`. */
export const BENCH_FLAT = { top: 0.45, zHead: -0.75, zFoot: 0.45, width: 0.28 };

function bench_flat(opts = {}) {
  const M = getMaterials(), g = new THREE.Group();
  const top = opts.height ?? BENCH_FLAT.top, z0 = opts.zHead ?? BENCH_FLAT.zHead, len = opts.length ?? 1.2, w = BENCH_FLAT.width;
  const z1 = z0 + len, zc = (z0 + z1) / 2;
  g.add(rbox(w, 0.07, len, M.upholstery, 0, top - 0.035, zc, 0.028));
  g.add(rbox(w - 0.03, 0.016, len - 0.04, M.frame, 0, top - 0.078, zc, 0.004));
  const yb = top - 0.12;
  g.add(beam(V(0, yb, z0 + 0.12), V(0, yb, z1 - 0.1), 0.075, M.frame, 0.05));
  for (const [z, hw] of [[z1 - 0.16, 0.24], [z0 + 0.16, 0.26]]) {
    g.add(beam(V(0, 0.06, z), V(0, yb, z), 0.07, M.frame, 0.05));
    tFoot(g, z, hw, M);
  }
  // Transport wheels + handle at the head end (detail that reads "real bench").
  for (const s of [1, -1]) {
    const wheel = mesh(cylX(0.035, 0.025), M.rubber); wheel.position.set(s * 0.29, 0.035, z0 + 0.16); g.add(wheel);
  }
  return {
    group: g, parts: {},
    anchors: { padTop: V(0, top, zc), headEnd: V(0, top, z0), footEnd: V(0, top, z1) },
  };
}

// ── Adjustable bench ────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Geometry of the adjustable bench for a given back-pad incline (degrees, 0 = flat … 85 = seated upright).
 * The figure sits facing +Z with the back pad behind it (towards −Z). Returns world points/directions:
 *   hinge   — top surface point where seat meets back pad
 *   dir     — unit vector up the back pad surface (from hinge towards the head end)
 *   normal  — back-pad top surface normal (points out of the pad, towards the lifter's back)
 *   seatTop — centre of the seat top surface; seatTilt — seat front lift (degrees)
 */
export function adjustableBenchFrame(incline = 30) {
  const th = THREE.MathUtils.degToRad(Math.min(Math.max(incline, 0), 85));
  const seatTilt = incline > 5 ? Math.min(14, incline * 0.22) : 0;
  const hinge = V(0, 0.46, 0.04);
  const dir = V(0, Math.sin(th), -Math.cos(th));
  const normal = V(0, Math.cos(th), Math.sin(th));
  const a = THREE.MathUtils.degToRad(seatTilt);
  const seatTop = V(0, 0.46 + Math.sin(a) * 0.2, 0.04 + Math.cos(a) * 0.2);
  return { hinge, dir, normal, seatTop, seatTilt, incline };
}

/**
 * Pelvis pose that sits/lies the figure on the adjustable bench: hip joints 0.11 off the back pad, nestled at its
 * base (and ≥ 0.10 above the seat); torso parallel to the pad (rot.x = −(90 − incline)). Add spine/chest bends on top for an arch.
 */
export function adjustableBenchPelvis(incline = 30) {
  const F = adjustableBenchFrame(incline);
  const p = F.hinge.clone().addScaledVector(F.normal, 0.11).addScaledVector(F.dir, 0.04);
  // Upright settings: keep the hip joints ≥ 0.10 above the seat by sliding up along the back pad.
  const minY = F.seatTop.y + 0.1;
  if (p.y < minY && F.dir.y > 0.3) p.addScaledVector(F.dir, (minY - p.y) / F.dir.y);
  return { pos: [0, +p.y.toFixed(3), +p.z.toFixed(3)], rot: [-(90 - F.incline), 0, 0] };
}

function bench_adjustable(opts = {}) {
  const M = getMaterials(), g = new THREE.Group();
  const F = adjustableBenchFrame(opts.incline ?? 30);
  const th = THREE.MathUtils.degToRad(F.incline), a = THREE.MathUtils.degToRad(F.seatTilt);
  const backLen = 0.8, w = 0.27, t = 0.07;
  // Back pad: rotate about X by the incline so its −Z end rises.
  const back = rbox(w, t, backLen, M.upholstery, 0, 0, 0, 0.028);
  back.rotation.x = th;
  back.position.copy(F.hinge).addScaledVector(F.dir, 0.02 + backLen / 2).addScaledVector(F.normal, -t / 2);
  g.add(back);
  const backBoard = rbox(w - 0.03, 0.016, backLen - 0.04, M.frame, 0, 0, 0, 0.004);
  backBoard.rotation.x = th;
  backBoard.position.copy(back.position).addScaledVector(F.normal, -t / 2 - 0.008);
  g.add(backBoard);
  // Seat (front edge lifted when inclined so the lifter does not slide).
  const seatN = V(0, Math.cos(a), -Math.sin(a)), seatD = V(0, Math.sin(a), Math.cos(a));
  const seat = rbox(w, t, 0.38, M.upholstery, 0, 0, 0, 0.028);
  seat.rotation.x = -a;
  seat.position.copy(F.hinge).addScaledVector(seatD, 0.2).addScaledVector(seatN, -t / 2);
  g.add(seat);
  // Frame: floor rail, seat post, adjustment strut + ladder under the back pad.
  g.add(beam(V(0, 0.1, -0.6), V(0, 0.1, 0.42), 0.075, M.frame, 0.05));
  g.add(beam(V(0, 0.1, 0.18), V(0, 0.36, 0.2), 0.065, M.frame, 0.05));
  const strutTop = F.hinge.clone().addScaledVector(F.dir, 0.42).addScaledVector(F.normal, -0.09);
  g.add(beam(V(0, 0.12, -0.5), strutTop, 0.05, M.frame, 0.04));
  g.add(beam(V(0, 0.12, -0.56), V(0, 0.12, -0.2), 0.04, M.steel, 0.07)); // ladder rack
  tFoot(g, 0.4, 0.24, M);
  tFoot(g, -0.6, 0.26, M);
  return {
    group: g, parts: { back, seat },
    anchors: {
      hinge: F.hinge.clone(), seatTop: F.seatTop.clone(),
      backTop: F.hinge.clone().addScaledVector(F.dir, backLen + 0.02),
    },
    frame: F,
  };
}

// ── Power rack ──────────────────────────────────────────────────────────────────────────────────────────────────
/** Power rack around the lifter: front uprights at z = +0.30 (J-hooks), back at z = −0.85, x = ±0.62. */
function rack(opts = {}) {
  const M = getMaterials(), g = new THREE.Group();
  const H = opts.height ?? 2.3, X = 0.62, zF = 0.3, zB = -0.85, s = 0.075;
  const jH = opts.jHeight ?? 1.35, safeH = opts.safetyHeight ?? 0.55;
  for (const x of [X, -X]) for (const z of [zF, zB]) {
    const up = mesh(new THREE.BoxGeometry(s, H, s), M.holes);
    up.position.set(x, H / 2, z); g.add(up);
    g.add(rbox(0.12, 0.012, 0.12, M.frame, x, 0.006, z, 0.003)); // base plate
  }
  for (const x of [X, -X]) {
    g.add(beam(V(x, 0.04, zF + 0.1), V(x, 0.04, zB - 0.1), 0.08, M.frame, 0.05)); // floor rails
    g.add(beam(V(x, H - 0.04, zF), V(x, H - 0.04, zB), s, M.frame));              // top rails
    // Pipe safety arms through both uprights.
    g.add(rod(V(x * 0.97, safeH, zF + 0.12), V(x * 0.97, safeH, zB - 0.12), 0.022, M.steel));
    // J-hooks on the front uprights: bracket + UHMW-lined cup facing the lifter.
    g.add(rbox(0.09, 0.13, 0.03, M.steel, x, jH, zF - s / 2 - 0.015, 0.006));
    g.add(rbox(0.08, 0.018, 0.075, M.rubber, x * 0.985, jH - 0.02, zF - s / 2 - 0.05, 0.006));
    g.add(rbox(0.08, 0.05, 0.016, M.steel, x * 0.985, jH + 0.005, zF - s / 2 - 0.09, 0.005));
  }
  g.add(beam(V(-X, 0.04, zB), V(X, 0.04, zB), 0.08, M.frame, 0.05));
  g.add(beam(V(-X, H - 0.04, zB), V(X, H - 0.04, zB), s, M.frame));
  const pull = mesh(cylX(0.016, 2 * X + 0.08), M.knurl); pull.position.set(0, H - 0.06, zF + 0.06); g.add(pull);
  return {
    group: g, parts: {},
    anchors: {
      bar_rest: V(0, jH + 0.025, zF - s / 2 - 0.05),
      jhook_L: V(X, jH, zF - s / 2 - 0.05), jhook_R: V(-X, jH, zF - s / 2 - 0.05),
      safety_L: V(X, safeH + 0.022, 0), safety_R: V(-X, safeH + 0.022, 0),
    },
  };
}

// ── Cable crossover / functional trainer ────────────────────────────────────────────────────────────────────────
const PULLEY_HEIGHTS = { high: 2.0, mid: 1.3, low: 0.2 };

/**
 * Two columns at x = ±0.85 with sliding pulley carriages and weight stacks behind them (z ≈ −0.32).
 * opts.heightL / heightR / height: number (m) or 'high' | 'mid' | 'low'. If not set, inferred from
 * opts.anchorsWanted (e.g. a cable from 'pulley_L_low' puts the left carriage low). Defaults to 'high'.
 * Anchors: pulley_L, pulley_R (+ aliases pulley_L_<preset> for the configured preset), stack tops.
 * Moving parts: stack_L, stack_R (selected plates + top plate + pin), raised by cable travel × stackRatio.
 */
function cable_crossover(opts = {}) {
  const M = getMaterials(), g = new THREE.Group();
  const wanted = opts.anchorsWanted || [];
  const heightFor = (S) => {
    let h = opts['height' + S] ?? opts.height;
    if (h == null) { const hit = wanted.map((n) => n.match(new RegExp(`^pulley_${S}_(high|mid|low)$`))).find(Boolean); h = hit ? hit[1] : 'high'; }
    return { h: typeof h === 'number' ? h : PULLEY_HEIGHTS[h] ?? PULLEY_HEIGHTS.high, preset: typeof h === 'string' ? h : null };
  };
  const H = 2.3, XC = 0.85;
  const parts = {}, anchors = {}, cableStacks = {}, dynamic = [];
  const plateGeo = new RoundedBoxGeometry(0.3, 0.03, 0.14, 1, 0.004);
  const wheelGeo = lathe(discProfile(0.045, 0.022, 0.006, 0.012), 24).rotateZ(Math.PI / 2);
  for (const [S, s] of [['L', 1], ['R', -1]]) {
    const x = s * XC, xs = s * (XC + 0.05);
    const { h, preset } = heightFor(S);
    // Column: main post + chrome track the carriage rides on.
    g.add(beam(V(s * (XC + 0.06), 0.05, -0.06), V(s * (XC + 0.06), H, -0.06), 0.09, M.frame));
    g.add(rod(V(x, 0.1, 0.0), V(x, H - 0.08, 0.0), 0.016, M.chrome));
    g.add(rbox(0.07, 0.03, 0.07, M.frame, x, 0.1, 0.0, 0.006));
    g.add(rbox(0.07, 0.03, 0.07, M.frame, x, H - 0.08, 0.0, 0.006));
    // Carriage with swivel pulley facing the centre.
    g.add(rbox(0.08, 0.16, 0.09, M.frame, x, h, 0.0, 0.01));
    g.add(rbox(0.03, 0.03, 0.03, M.accent, s * (XC + 0.045), h + 0.05, 0.03, 0.006)); // pop-pin knob
    const housing = new THREE.Group(); housing.position.set(x - s * 0.075, h, 0.02);
    for (const z of [0.018, -0.018]) housing.add(rbox(0.11, 0.1, 0.008, M.steel, 0, 0, z, 0.004));
    const wheel = mesh(wheelGeo, M.chrome); wheel.rotation.y = Math.PI / 2; housing.add(wheel);
    g.add(housing);
    const exit = V(x - s * 0.12, h, 0.02);
    anchors['pulley_' + S] = exit;
    if (preset) anchors[`pulley_${S}_${preset}`] = exit.clone();
    cableStacks['pulley_' + S] = 'stack_' + S;
    if (preset) cableStacks[`pulley_${S}_${preset}`] = 'stack_' + S;
    // Weight stack behind the column: 15 plates, pinned at 6 → the top 6 move.
    const zS = -0.34, y0 = 0.12, pitch = 0.034, n = 15, pinned = 6;
    for (const dx of [0.11, -0.11]) g.add(rod(V(xs + dx, 0.05, zS), V(xs + dx, H - 0.12, zS), 0.009, M.chrome));
    g.add(rbox(0.36, 0.04, 0.2, M.rubber, xs, 0.07, zS, 0.01));
    const stack = new THREE.Group(); stack.name = 'stack_' + S;
    for (let i = 0; i < n; i++) {
      const p = mesh(plateGeo, M.stack);
      p.position.set(xs, y0 + 0.015 + i * pitch, zS);
      (i >= n - pinned ? stack : g).add(p);
    }
    const topY = y0 + n * pitch;
    stack.add(rbox(0.32, 0.04, 0.15, M.frame, xs, topY + 0.02, zS, 0.006));
    stack.add(rod(V(xs, y0 + (n - pinned) * pitch, zS), V(xs, topY + 0.04, zS), 0.007, M.chrome));
    const pin = mesh(cylX(0.007, 0.12), M.steel); pin.rotation.y = Math.PI / 2; pin.position.set(xs, y0 + (n - pinned) * pitch + 0.015, zS + 0.09);
    stack.add(pin, rbox(0.03, 0.03, 0.03, M.accent, xs, pin.position.y, zS + 0.15, 0.008));
    g.add(stack); parts['stack_' + S] = stack;
    anchors['stack_' + S] = V(xs, topY + 0.04, zS);
    // Cable routing: stack top ↑ top wheel → over to the column → down the track to the carriage.
    const topWheel = V(xs, H - 0.1, zS), colTop = V(x, H - 0.1, 0.0);
    for (const c of [[topWheel, colTop], [colTop, V(x, h + 0.08, 0.0)]]) g.add(rod(c[0], c[1], 0.005, M.cable, 6));
    for (const c of [topWheel, colTop]) { const w = mesh(wheelGeo, M.steel); w.position.copy(c); w.rotation.y = s * Math.PI / 2; g.add(w); }
    const lift = rod(V(xs, topY, zS), topWheel, 0.005, M.cable, 6);
    g.add(lift);
    const liftFrom = V(0, 0, 0);
    dynamic.push(() => { liftFrom.set(xs, topY + 0.04 + stack.position.y, zS); stretchBetween(lift, liftFrom, topWheel); });
  }
  // Top cross-member with pull-up bar, floor frame.
  g.add(beam(V(-XC - 0.06, H, -0.06), V(XC + 0.06, H, -0.06), 0.09, M.frame));
  g.add(beam(V(-XC - 0.06, H, -0.34), V(XC + 0.06, H, -0.34), 0.07, M.frame));
  for (const s of [1, -1]) g.add(beam(V(s * (XC + 0.06), H, -0.06), V(s * (XC + 0.06), H, -0.34), 0.07, M.frame));
  const pull = mesh(cylX(0.017, 1.1), M.knurl); pull.position.set(0, H - 0.05, 0.12); g.add(pull);
  for (const s of [1, -1]) g.add(beam(V(s * 0.55, H - 0.05, 0.12), V(s * 0.55, H, -0.06), 0.04, M.frame));
  g.add(beam(V(-XC - 0.15, 0.03, -0.45), V(XC + 0.15, 0.03, -0.45), 0.08, M.frame, 0.06));
  for (const s of [1, -1]) g.add(beam(V(s * (XC + 0.1), 0.03, 0.12), V(s * (XC + 0.1), 0.03, -0.5), 0.08, M.frame, 0.06));
  return { group: g, parts, anchors, cableStacks, stackRatio: 0.5, update() { for (const f of dynamic) f(); } };
}

// ── Smith machine ───────────────────────────────────────────────────────────────────────────────────────────────
/** Vertical-rail Smith machine. Guide rods at x = ±0.62, z = 0. Part 'bar' (at opts.barHeight) moves along Y. */
function smith(opts = {}) {
  const M = getMaterials(), g = new THREE.Group();
  const H = 2.2, XR = 0.62, barY = opts.barHeight ?? 1.0;
  for (const x of [0.78, -0.78]) for (const z of [0.42, -0.42]) g.add(beam(V(x, 0.04, z), V(x, H, z), 0.08, M.frame));
  for (const x of [0.78, -0.78]) {
    g.add(beam(V(x, 0.04, 0.5), V(x, 0.04, -0.5), 0.08, M.frame, 0.05));
    g.add(beam(V(x, H, 0.42), V(x, H, -0.42), 0.08, M.frame));
    g.add(beam(V(x, 0.12, 0), V(x * 0.8, 0.12, 0), 0.05, M.frame));
    g.add(beam(V(x, H - 0.08, 0), V(x * 0.8, H - 0.08, 0), 0.05, M.frame));
  }
  for (const z of [0.42, -0.42]) g.add(beam(V(-0.78, H, z), V(0.78, H, z), 0.08, M.frame));
  for (const x of [XR, -XR]) {
    g.add(rod(V(x, 0.08, 0), V(x, H - 0.06, 0), 0.018, M.chrome));
    g.add(rbox(0.07, 0.05, 0.07, M.rubber, x, opts.safetyHeight ?? 0.32, 0, 0.01)); // safety stopper
  }
  const bar = new THREE.Group(); bar.position.y = barY; bar.name = 'bar';
  const shaft = mesh(cylX(0.014, 1.12, 18), M.knurl); bar.add(shaft);
  for (const s of [1, -1]) {
    bar.add(rbox(0.07, 0.12, 0.08, M.frame, s * XR, 0, 0, 0.01));              // carriage around the rod
    bar.add(rbox(0.02, 0.02, 0.06, M.steel, s * XR, -0.03, 0.06, 0.005));      // rack hook
    const sleeve = mesh(cylX(0.025, 0.36), M.chrome); sleeve.position.x = s * (XR + 0.22); bar.add(sleeve);
    const collar = mesh(cylX(0.03, 0.02), M.chrome); collar.position.x = s * (XR + 0.05); bar.add(collar);
    let xp = XR + 0.065;
    for (const p of platesFor(opts.kgPerSide ?? 10)) {
      const pl = buildPlate(p[0]); pl.rotation.z = Math.PI / 2; pl.position.x = s * (xp + p[2] / 2); bar.add(pl); xp += p[2] + 0.002;
    }
  }
  g.add(bar);
  return { group: g, parts: { bar }, anchors: { bar: V(0, barY, 0) } };
}

export default { bench_flat, bench_adjustable, rack, cable_crossover, smith };
