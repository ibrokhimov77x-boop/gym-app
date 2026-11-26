// Machine batch "posterior_core": lying_leg_curl, seated_leg_curl, captains_chair, hip_thrust_smith (+ exercise_mat).
// Style: Impulse-like selectorized line — dark powder-coated frames, RED levers / shrouds / caps, brushed steel and
// chrome, black upholstery. All coordinates are world metres (figure faces +Z, its left side is +X), see README.md.
//
// Leg-curl levers rotate about the knee axis. The engine's movers only translate parts, so each curl machine exposes
// two invisible "probe" parts that the spec binds to `feetMid` (one mover along Y, one along Z). The probes then hold
// the current sole position in the sagittal plane; update() turns it into the lever angle, swings the lever, lifts
// the weight stack (cam radius × angle) and re-stretches the stack's lift cable. No allocations per frame.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { getMaterials } from '../materials.js';
import { stretchBetween, lathe, discProfile } from '../geo.js';
import common, { BENCH_FLAT, rbox, beam, rod, cylX } from './common.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const D2R = Math.PI / 180;

// ── Small geometry helpers (same conventions as common.js) ──────────────────────────────────────────────────────
const mesh = (geo, mat) => new THREE.Mesh(geo, mat);
/** Rubber floor pad under a frame foot. */
const floorPad = (x, z, w = 0.07, d = 0.07) => rbox(w, 0.02, d, getMaterials().rubber, x, 0.01, z, 0.006);

const _X = V(1, 0, 0);
/** Pulley wheel centred at p, axle along `axle` (unit, default X). */
function pulley(p, M, r = 0.045, axle = _X) {
  const w = mesh(lathe(discProfile(r, 0.022, 0.006, 0.012), 22).rotateZ(Math.PI / 2), M.chrome);
  w.position.copy(p);
  w.quaternion.setFromUnitVectors(_X, axle);
  return w;
}

/**
 * Bend of a cable around a pulley: incoming direction a, outgoing b (unit). Writes the wheel axle (normal of the
 * cable plane) to `axle` and returns it; the cable touches the wheel on the outside of the bend, at
 * centre − r·(axle × dir) for either run. Collinear runs keep the X axle.
 */
function bendAxle(a, b, axle) {
  axle.crossVectors(a, b);
  return axle.lengthSq() < 1e-8 ? axle.copy(_X) : axle.normalize();
}
const tangent = (centre, axle, dir, r) => centre.clone().addScaledVector(V(0, 0, 0).crossVectors(axle, dir), -r);

/**
 * Cable through pulleys: pts = [start, ...pulley centres, end], radii per pulley. Each wheel is turned into its
 * cable plane and the runs join the tangent points, so the cable wraps the wheels instead of piercing their hubs.
 * Wheels low above the floor (y < 0.3) get a floor bracket (cheek plates + axle pin + base plate). The first run
 * (start → first wheel) moves with the stack, so it is left to the caller; returns its wheel-side end.
 */
function cableRoute(g, M, pts, radii) {
  const a = V(0, 0, 0), b = V(0, 0, 0), axle = V(0, 0, 0);
  let from = null, entry = null;
  for (let i = 1; i < pts.length - 1; i++) {
    const c = pts[i], r = radii[i - 1];
    a.subVectors(c, pts[i - 1]).normalize(); b.subVectors(pts[i + 1], c).normalize();
    bendAxle(a, b, axle);
    const t = tangent(c, axle, a, r);
    if (from) g.add(rod(from, t, 0.005, M.cable, 6));
    entry ||= t;
    g.add(pulley(c, M, r, axle));
    if (c.y < 0.3) floorBracket(g, M, c, axle);
    from = tangent(c, axle, b, r);
  }
  g.add(rod(from, pts[pts.length - 1], 0.005, M.cable, 6));
  return entry;
}

/** Floor bracket for a low pulley at c with a horizontal axle: two cheek plates, axle pin, base plate. */
function floorBracket(g, M, c, axle) {
  const yaw = Math.atan2(-axle.z, axle.x);       // rotates local X onto the (horizontal) axle
  for (const s of [1, -1]) {
    const cheek = rbox(0.008, c.y + 0.02, 0.06, M.frame, 0, 0, 0, 0.003);
    cheek.position.copy(c).addScaledVector(axle, s * 0.02).setY((c.y + 0.02) / 2);
    cheek.rotation.y = yaw;
    g.add(cheek);
  }
  const base = rbox(0.07, 0.012, 0.09, M.frame, c.x, 0.006, c.z, 0.004);
  base.rotation.y = yaw;
  g.add(base, rod(V(0, 0, 0).copy(c).addScaledVector(axle, -0.028), V(0, 0, 0).copy(c).addScaledVector(axle, 0.028), 0.006, M.steel, 8));
}

// ── Weight-stack tower ──────────────────────────────────────────────────────────────────────────────────────────
/**
 * Selectorized stack in a tower at (x, z): rubber base, 2 chrome guide rods, n plates (long side along Z), the top
 * `pinned` plates + top plate + selector rod + pin ride in the moving group. Outer side (towards `side` · X) has a red
 * shroud, the top a red cap with the head pulley. Cable: stack top → head wheel → return wheel → floor wheel (inside
 * the tower, return run on the `toward` · Z side) → along the floor → turning wheel → straight up to `cam` (the point
 * where the cable meets the cam). Wheel centres are placed so every vertical run is plumb.
 * Returns { stack, lift(y) } — lift(y) raises the stack by y metres and re-stretches the lift cable.
 */
function weightTower(g, M, { x, z, side, toward, cam, H = 1.62, n = 13, pinned = 5 }) {
  const R = M.frameRed, pitch = 0.033, y0 = 0.075;
  g.add(rbox(0.2, 0.05, 0.4, M.rubber, x, 0.025, z, 0.01));                        // base / buffer
  for (const dz of [0.1, -0.1]) g.add(rod(V(x, 0.05, z + dz), V(x, H - 0.08, z + dz), 0.009, M.chrome, 10));
  for (const dz of [0.22, -0.22]) g.add(beam(V(x, 0.0, z + dz), V(x, H, z + dz), 0.06, M.frame, 0.05));
  g.add(rbox(0.22, 0.07, 0.56, R, x, H + 0.03, z, 0.012));                         // top cap
  g.add(rbox(0.012, H - 0.32, 0.46, R, x + side * 0.1, 0.16 + (H - 0.32) / 2, z, 0.004)); // outer shroud
  g.add(rbox(0.006, 0.12, 0.3, M.frame, x + side * 0.108, H - 0.32, z, 0.002));          // dark badge on the shroud
  g.add(rbox(0.22, 0.05, 0.08, M.frame, x, 0.03, z + 0.24, 0.006), rbox(0.22, 0.05, 0.08, M.frame, x, 0.03, z - 0.24, 0.006));
  const plateGeo = new RoundedBoxGeometry(0.13, pitch - 0.003, 0.28, 1, 0.004);
  const stack = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const p = mesh(plateGeo, M.stack);
    p.position.set(x, y0 + 0.015 + i * pitch, z);
    (i >= n - pinned ? stack : g).add(p);
  }
  const topY = y0 + n * pitch;
  stack.add(rbox(0.12, 0.035, 0.26, M.frame, x, topY + 0.018, z, 0.006));          // top plate
  const selY = y0 + (n - pinned) * pitch;
  stack.add(rod(V(x, selY, z), V(x, topY + 0.04, z), 0.007, M.chrome, 8));          // selector rod
  const pin = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 8).rotateZ(Math.PI / 2), M.steel);
  pin.position.set(x - side * 0.05, selY + 0.016, z);
  stack.add(pin, rbox(0.03, 0.026, 0.026, M.accent, x - side * 0.115, selY + 0.016, z, 0.008));
  g.add(stack);
  // Cable: stack top ↑ head wheel → return wheel on the inner side (−side·X, `toward`·Z: clear of the plates, the
  // selector pin and the guide rods) ↓ plumb to a floor wheel → turning wheel → up to the cam. Only the lift run moves.
  const yTop = H - 0.06, yFloor = 0.13, up = V(0, 1, 0), axle = V(0, 0, 0), dir = V(0, 0, 0);
  const plumb = V(x, yTop, z), rodTop = V(x, topY + 0.04, z), ret = V(x - side * 0.09, yTop, z + toward * 0.1);
  const head = plumb.clone().sub(tangent(V(0, 0, 0), bendAxle(up, dir.subVectors(ret, plumb).normalize(), axle), up, 0.045));
  const down = ret.clone().addScaledVector(dir.subVectors(ret, head).normalize(), 0.035).setY(yFloor); // plumb below ret
  const h = dir.subVectors(cam, down).setY(0).normalize();                  // floor run direction
  const floor = down.clone().addScaledVector(h, 0.035), turn = cam.clone().setY(yFloor).addScaledVector(h, -0.035);
  const entry = cableRoute(g, M, [rodTop, head, ret, floor, turn, cam], [0.045, 0.035, 0.035, 0.035]);
  const liftCable = rod(rodTop, entry, 0.005, M.cable, 6);
  g.add(liftCable);
  const from = V(0, 0, 0);
  return {
    stack,
    lift(y) {
      stack.position.y = y;
      stretchBetween(liftCable, from.set(x, topY + 0.04 + y, z), entry);
    },
  };
}

// ── Leg-curl geometry shared with the animation specs ───────────────────────────────────────────────────────────
/**
 * Leg-curl set-ups. knee = [y, z] of the machine pivot = the lifter's knee axis. s = +1: lying (legs towards −Z,
 * knee flexion lifts the shin), s = −1: seated (shins forward, flexion swings them down and under the seat).
 * Shin direction at knee flexion θ: d(θ) = s·(0, sin θ, −cos θ). With the ankle neutral (foot ⟂ shin) the sole point
 * sits on the shin line, SOLE_R from the knee — so a foot target rotated about the knee keeps the knee on the pivot.
 */
export const LYING_CURL = { s: 1, knee: [0.8, -0.448], pelvis: [0, 0.84, 0], tilt: 105, top: 110, bottom: 8 };
export const SEATED_CURL = { s: -1, knee: [0.625, 0.4493], pelvis: [0, 0.65, 0], tilt: 10, top: 112, bottom: 10 };
const SOLE_R = 0.44 + 0.085;   // shin + ankle height
const CAM_R = 0.085;           // stack lift per radian of lever travel
const HUB_X = -0.31;           // lever side arm (right side, −X) on both curl machines
const CAM_X = HUB_X - 0.035;   // cam disc just outside the arm; the lift cable hangs plumb under it
const PAD_ALONG = 0.36, PAD_OFF = 0.085, ROLLER_R = 0.045;

/** Foot target on the curl lever: knee flexion `deg`, leg at x. Returns spec fields { pos, rot, pivot, hint }. */
export function curlFoot(cfg, x, deg) {
  const th = deg * D2R, [ky, kz] = cfg.knee, s = cfg.s;
  const pos = [x, +(ky + s * SOLE_R * Math.sin(th)).toFixed(4), +(kz - s * SOLE_R * Math.cos(th)).toFixed(4)];
  return {
    pos, rot: [90 + deg - (s < 0 ? 180 : 0), 0, 0], pivot: [x, ky, kz],
    // Knee pole: knee cap towards the pad (lying: floor; seated: up/forward).
    hint: s > 0 ? [x, ky - 0.6, kz] : [x, ky + 0.6, kz + 0.2],
  };
}

/**
 * Lever group rotating about the X axis through the knee pivot. Built for θ = 0 in the lever frame:
 * d0 = shin direction, n0 = posterior normal (roller side). hubX = x of the side arm.
 */
function curlLever(g, M, cfg, hubX) {
  const R = M.frameRed, s = cfg.s, [ky, kz] = cfg.knee;
  const lever = new THREE.Group();
  lever.position.set(0, ky, kz);
  const d0 = V(0, 0, -s), n0 = V(0, s, 0);
  const padC = d0.clone().multiplyScalar(PAD_ALONG).addScaledVector(n0, PAD_OFF);
  const sx = Math.sign(hubX);
  // Cam + hub on the pivot.
  const cam = mesh(lathe(discProfile(CAM_R + 0.01, 0.03, 0.006), 28).rotateZ(Math.PI / 2), R);
  cam.position.x = hubX + sx * Math.abs(CAM_X - HUB_X); lever.add(cam);
  const hub = mesh(cylX(0.034, 0.1, 20), M.steel); hub.position.x = hubX; lever.add(hub);
  const cap = mesh(cylX(0.022, 0.012, 16), M.accent); cap.position.x = hubX - sx * 0.056; lever.add(cap);
  // Side arm (red tube) from the hub down the shin to the roller axle, with a ROM adjuster plate.
  const armStart = V(hubX, 0, 0).addScaledVector(d0, 0.03);
  lever.add(beam(armStart, V(hubX, padC.y, padC.z), 0.05, R, 0.035));
  lever.add(rbox(0.012, 0.11, 0.11, M.steel, hubX - sx * 0.03, 0, 0, 0.004));
  // Axle + single long roller pad across both legs (+ end caps).
  const xIn = -sx * 0.22;
  lever.add(rod(V(hubX, padC.y, padC.z), V(xIn, padC.y, padC.z), 0.013, M.steel, 12));
  const roller = mesh(cylX(ROLLER_R, 0.4, 24), M.upholstery); roller.position.set(0, padC.y, padC.z); lever.add(roller);
  for (const e of [0.205, -0.205]) {
    const c = mesh(cylX(ROLLER_R * 0.7, 0.012, 16), M.frame); c.position.set(e, padC.y, padC.z); lever.add(c);
  }
  g.add(lever);
  return lever;
}

/**
 * Probes for the feetMid effector (bound by two movers in the spec) and the lever/stack driver.
 * Returns { parts, update }.
 */
function curlDriver(g, cfg, lever, tower) {
  const [ky, kz] = cfg.knee, s = cfg.s;
  const rest = curlFoot(cfg, 0, cfg.top).pos;               // probes start where the top pose puts the soles
  const probeY = new THREE.Object3D(), probeZ = new THREE.Object3D();
  probeY.position.set(0, rest[1], 0); probeZ.position.set(0, 0, rest[2]);
  g.add(probeY, probeZ);
  const lo = (cfg.bottom - 6) * D2R, hi = (cfg.top + 6) * D2R, th0 = cfg.bottom * D2R;
  return {
    parts: { probeY, probeZ, lever, stack: tower.stack },
    update() {
      const vy = probeY.position.y - ky, vz = probeZ.position.z - kz;
      const th = THREE.MathUtils.clamp(Math.atan2(s * vy, -s * vz), lo, hi);
      lever.rotation.x = th;
      tower.lift(Math.max(0, (th - th0) * CAM_R));
    },
  };
}

// ── Lying leg curl ──────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Prone leg curl with a hip "hump": flat thigh pad (top y 0.75, z −0.40…0) ending just above the knees, chest pad
 * sloping down 21° towards the head, vertical neutral handles at the front. Lever + cam + stack on the right (−X).
 */
function lying_leg_curl() {
  const M = getMaterials(), R = M.frameRed, g = new THREE.Group();
  const cfg = LYING_CURL, [ky, kz] = cfg.knee;
  // Pads: thigh pad (flat) + chest pad tilted so the torso is supported along its length.
  g.add(rbox(0.3, 0.08, 0.42, M.upholstery, 0, 0.685, -0.19, 0.03));   // (step 05) 25 mm lower: the thighs sank 40 mm
  const chest = rbox(0.34, 0.08, 0.54, M.upholstery, 0, 0, 0, 0.03);
  chest.rotation.x = 21 * D2R;
  chest.position.set(0, 0.6176, 0.2036);
  g.add(chest);
  const board = rbox(0.3, 0.016, 0.5, M.frame, 0, 0, 0, 0.004);
  board.rotation.x = 21 * D2R; board.position.set(0, 0.565, 0.19); g.add(board);
  g.add(rbox(0.26, 0.016, 0.38, M.frame, 0, 0.637, -0.19, 0.004));
  // Frame: spine beam under the pads, front & rear legs, floor rail with cross feet.
  g.add(beam(V(0, 0.63, -0.4), V(0, 0.63, 0.0), 0.08, M.frame, 0.06));
  g.add(beam(V(0, 0.63, 0.0), V(0, 0.48, 0.42), 0.08, M.frame, 0.06));
  g.add(beam(V(0, 0.05, -0.32), V(0, 0.63, -0.32), 0.08, M.frame, 0.06));
  g.add(beam(V(0, 0.05, 0.58), V(0, 0.48, 0.42), 0.08, R, 0.06));
  g.add(beam(V(0, 0.04, -0.62), V(0, 0.04, 0.86), 0.09, M.frame, 0.06));
  for (const [zz, hw] of [[-0.6, 0.42], [0.82, 0.36]]) {
    g.add(beam(V(-hw, 0.035, zz), V(hw, 0.035, zz), 0.07, M.frame, 0.05));
    g.add(floorPad(hw - 0.03, zz), floorPad(-hw + 0.03, zz));
  }
  // Pivot tower on the right (−X): post + bearing housing on the knee axis.
  const px = -0.4;
  g.add(beam(V(px, 0.05, -0.6), V(px, ky, kz), 0.07, M.frame, 0.06));
  g.add(beam(V(px, 0.05, -0.6), V(0, 0.05, -0.6), 0.07, M.frame, 0.06));
  g.add(beam(V(px, ky - 0.18, kz + 0.06), V(0, 0.63, -0.3), 0.05, M.frame, 0.04));
  const bearing = mesh(cylX(0.05, 0.06, 20), R); bearing.position.set(px, ky, kz); g.add(bearing);
  // Neutral (vertical) handles in front of the head, on a red crossbar.
  const hz = 0.74, hx = 0.27;
  g.add(beam(V(0, 0.48, 0.42), V(0, 0.42, hz), 0.06, M.frame, 0.05));
  g.add(rod(V(-hx, 0.42, hz), V(hx, 0.42, hz), 0.02, R));
  for (const sx of [1, -1]) {
    g.add(rod(V(sx * hx, 0.42, hz), V(sx * hx, 0.69, hz), 0.016, M.steel));
    g.add(rod(V(sx * hx, 0.47, hz), V(sx * hx, 0.65, hz), 0.0165, M.rubber));   // (step 05) grip r 16.5 mm
  }
  const lever = curlLever(g, M, cfg, HUB_X);
  // Stack tower beside the chest pad (right side); cable: down the tower → along the floor → up to the cam.
  const tx = -0.66, tz = 0.32;
  const tower = weightTower(g, M, { x: tx, z: tz, side: -1, toward: -1, cam: V(CAM_X, ky - CAM_R, kz) });
  g.add(beam(V(tx, 0.04, tz - 0.22), V(0, 0.04, 0.32), 0.07, M.frame, 0.05));
  const drv = curlDriver(g, cfg, lever, tower);
  return { group: g, parts: drv.parts, anchors: { knee: V(0, ky, kz), handle_L: V(hx, 0.56, hz), handle_R: V(-hx, 0.56, hz) }, update: drv.update };
}

// ── Seated leg curl ─────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Seated leg curl: seat top 0.555 (z −0.13…0.37), back pad tilted 10° forward (torso leans in), thigh hold-down
 * roller above the knees, side handles along Z at x = ±0.31. Lever, cam and stack on the right (−X).
 */
function seated_leg_curl() {
  const M = getMaterials(), R = M.frameRed, g = new THREE.Group();
  const cfg = SEATED_CURL, [ky, kz] = cfg.knee, tilt = cfg.tilt * D2R;
  // (step 05) seat top 0.548: the thighs and buttocks rest ≈ 10 mm deep in the cushion (was 0.555; with the glute drive)
  g.add(rbox(0.4, 0.08, 0.5, M.upholstery, 0, 0.508, 0.12, 0.03));
  g.add(rbox(0.34, 0.016, 0.44, M.frame, 0, 0.46, 0.12, 0.004));
  // Back pad parallel to the torso (pelvis tilt 10°), 0.115 behind the spine axis.
  const back = rbox(0.36, 0.56, 0.07, M.upholstery, 0, 0, 0, 0.03);
  back.rotation.x = tilt; back.position.set(0, 0.991, -0.092); g.add(back);
  const backBoard = rbox(0.3, 0.52, 0.016, M.frame, 0, 0, 0, 0.004);
  backBoard.rotation.x = tilt; backBoard.position.set(0, 0.985, -0.135); g.add(backBoard);
  // Frame: floor rail, seat post, back-pad post, cross feet.
  g.add(beam(V(0, 0.04, -0.55), V(0, 0.04, 0.62), 0.09, M.frame, 0.06));
  g.add(beam(V(0, 0.05, 0.02), V(0, 0.46, 0.02), 0.08, M.frame, 0.06));
  // Back-pad post: rises from the rear of the floor rail, then runs parallel to the pad (10°) behind the board.
  g.add(beam(V(0, 0.05, -0.36), V(0, 0.47, -0.272), 0.08, M.frame, 0.06));
  g.add(beam(V(0, 0.47, -0.272), V(0, 1.15, -0.152), 0.08, R, 0.05));
  g.add(beam(V(0, 0.45, -0.27), V(0, 0.46, 0.05), 0.06, M.frame, 0.05));
  for (const [zz, hw] of [[-0.52, 0.4], [0.6, 0.46]]) {
    g.add(beam(V(-hw, 0.035, zz), V(hw, 0.035, zz), 0.07, M.frame, 0.05));
    g.add(floorPad(hw - 0.03, zz), floorPad(-hw + 0.03, zz));
  }
  // Pivot tower (right): post to the knee axis + bearing.
  const px = -0.42;
  g.add(beam(V(px, 0.05, 0.6), V(px, ky, kz), 0.07, M.frame, 0.06));
  const bearing = mesh(cylX(0.05, 0.06, 20), R); bearing.position.set(px, ky, kz); g.add(bearing);
  // Thigh hold-down roller above the knees, on an arm from the pivot tower.
  const tY = 0.765, tZ = 0.33;   // (step 05) resting on the thighs (was 0.742: 30 mm into them)
  g.add(beam(V(px, ky + 0.03, kz - 0.02), V(px, tY, tZ), 0.05, R, 0.04));
  g.add(rod(V(px, tY, tZ), V(0.2, tY, tZ), 0.013, M.steel));
  const tRoll = mesh(cylX(0.048, 0.4, 24), M.upholstery); tRoll.position.set(0, tY, tZ); g.add(tRoll);
  // Side handles (neutral grip, along Z) on brackets from the seat frame; the post meets the bare rear end of the bar,
  // so the fist (at z 0.12) wraps a free grip.
  const hx = 0.31, hy = 0.645, postZ = -0.035;
  for (const sx of [1, -1]) {
    g.add(beam(V(sx * 0.12, 0.455, postZ), V(sx * hx, 0.455, postZ), 0.04, M.frame, 0.03));
    g.add(beam(V(sx * hx, 0.455, postZ), V(sx * hx, hy, postZ), 0.03, M.frame, 0.03));
    g.add(rod(V(sx * hx, hy, -0.05), V(sx * hx, hy, 0.24), 0.016, M.steel));
    g.add(rod(V(sx * hx, hy, 0.0), V(sx * hx, hy, 0.2), 0.0165, M.rubber));   // (step 05) grip r 16.5 mm
  }
  const lever = curlLever(g, M, cfg, HUB_X);
  // Stack tower behind the seat on the right; cable: down the tower → forward along the floor → up to the cam.
  const tx = -0.62, tz = -0.3;
  const tower = weightTower(g, M, { x: tx, z: tz, side: -1, toward: 1, cam: V(CAM_X, ky - CAM_R, kz) });
  g.add(beam(V(tx, 0.04, tz + 0.22), V(px, 0.04, 0.6), 0.07, M.frame, 0.05));
  const drv = curlDriver(g, cfg, lever, tower);
  return { group: g, parts: drv.parts, anchors: { knee: V(0, ky, kz), handle_L: V(hx, hy, 0.12), handle_R: V(-hx, hy, 0.12) }, update: drv.update };
}

// ── Captain's chair (vertical knee raise) ───────────────────────────────────────────────────────────────────────
/**
 * Knee-raise station: back pad (front surface z = −0.12, y 1.14…1.86), forearm pads (top y = CAPTAIN.padTop,
 * x = ±CAPTAIN.padX, z −0.12…0.25) with vertical neutral handles at their front ends (axis through
 * CAPTAIN.handle), red uprights, side foot steps for mounting. The lifter's feet hang ~0.3 m above the floor.
 */
export const CAPTAIN = { padTop: 1.392, padX: 0.262, handle: [0.245, 1.435, 0.31] };

function captains_chair() {
  const M = getMaterials(), R = M.frameRed, g = new THREE.Group();
  const { padTop, padX, handle } = CAPTAIN;
  const ux = 0.36, uz = -0.27, H = 2.12, backY = 1.5;
  // Uprights (red) on floor rails, rear cross members.
  for (const sx of [1, -1]) {
    g.add(beam(V(sx * ux, 0.06, uz), V(sx * ux, H, uz), 0.08, R, 0.08));
    g.add(beam(V(sx * ux, 0.04, -0.55), V(sx * ux, 0.04, 0.5), 0.09, M.frame, 0.06));
    g.add(floorPad(sx * ux, 0.46, 0.09, 0.08), floorPad(sx * ux, -0.51, 0.09, 0.08));
    g.add(rbox(0.1, 0.03, 0.1, M.frame, sx * ux, H + 0.01, uz, 0.008));
    // Foot step: bracket + rubber-topped tread beside the hanging legs.
    g.add(beam(V(sx * ux, 0.5, uz), V(sx * (ux + 0.02), 0.5, -0.02), 0.05, M.frame, 0.04));
    g.add(rbox(0.16, 0.035, 0.22, M.frame, sx * (ux + 0.04), 0.52, 0.02, 0.006));
    g.add(rbox(0.15, 0.012, 0.2, M.rubber, sx * (ux + 0.04), 0.542, 0.02, 0.004));
  }
  for (const y of [0.1, 1.18, 1.98]) g.add(beam(V(-ux, y, uz), V(ux, y, uz), 0.07, M.frame, 0.06));
  g.add(beam(V(0, 1.12, uz), V(0, 1.92, uz), 0.08, M.frame, 0.05));
  // Back pad on a mounting plate.
  g.add(rbox(0.36, 0.72, 0.07, M.upholstery, 0, backY, -0.155, 0.03));
  g.add(rbox(0.3, 0.66, 0.016, M.frame, 0, backY, -0.198, 0.004));
  g.add(beam(V(0, backY, -0.2), V(0, backY, uz), 0.1, M.frame, 0.04));
  // Forearm pads + handles.
  for (const sx of [1, -1]) {
    const x = sx * padX, yb = padTop - 0.06;
    g.add(beam(V(sx * ux, yb - 0.02, uz), V(x, yb - 0.02, -0.1), 0.06, R, 0.05));
    g.add(beam(V(x, yb - 0.02, -0.12), V(x, yb - 0.02, 0.3), 0.05, M.frame, 0.04));
    g.add(rbox(0.11, 0.06, 0.38, M.upholstery, x, padTop - 0.03, 0.065, 0.025));
    g.add(rbox(0.09, 0.012, 0.36, M.frame, x, yb - 0.004, 0.065, 0.003));
    const hx = sx * handle[0], hz = handle[2];
    g.add(beam(V(x, yb - 0.02, 0.3), V(hx, yb - 0.02, hz), 0.05, M.frame, 0.04));
    g.add(rod(V(hx, yb - 0.04, hz), V(hx, handle[1] + 0.13, hz), 0.015, M.steel));
    g.add(rod(V(hx, handle[1] - 0.07, hz), V(hx, handle[1] + 0.1, hz), 0.0165, M.rubber));   // (step 05) grip r 16.5 mm
    const knob = mesh(new THREE.SphereGeometry(0.024, 14, 10), R); knob.position.set(hx, handle[1] + 0.14, hz); g.add(knob);
  }
  return { group: g, parts: {}, anchors: { handle_L: V(handle[0], handle[1], handle[2]), handle_R: V(-handle[0], handle[1], handle[2]) } };
}

// ── Smith machine + cross bench for the hip thrust ──────────────────────────────────────────────────────────────
/**
 * Hip-thrust station in the Smith machine: the Smith (bar along X at z = HIP_THRUST.barZ, moving part 'bar') and a
 * flat bench turned crosswise behind the lifter (pad top y 0.45, front edge at z = HIP_THRUST.benchEdge).
 * opts: barHeight (top of the thrust), kgPerSide.
 */
export const HIP_THRUST = { benchEdge: -0.33, barZ: 0.02 };

function crossBench() {
  // bench_flat turned 90° (its length along X, centred on x = 0), long edge at z = benchEdge.
  const b = common.bench_flat();
  b.group.rotation.y = Math.PI / 2;
  b.group.position.set(-(BENCH_FLAT.zHead + 0.6), 0, HIP_THRUST.benchEdge - BENCH_FLAT.width / 2);
  return b.group;
}

function hip_thrust_smith(opts = {}) {
  const s = common.smith({ barHeight: opts.barHeight ?? 0.7, kgPerSide: opts.kgPerSide ?? 20, safetyHeight: 0.3 });
  const g = new THREE.Group();
  s.group.position.z = HIP_THRUST.barZ;
  g.add(s.group, crossBench());
  return { group: g, parts: s.parts, anchors: { bar: s.anchors.bar.clone().setZ(HIP_THRUST.barZ) } };
}

/** Plain cross bench for the free-bar hip thrust (same placement as in the Smith station). */
function hip_thrust_bench() {
  const g = new THREE.Group();
  g.add(crossBench());
  return { group: g, parts: {}, anchors: {} };
}

// ── Exercise mat ────────────────────────────────────────────────────────────────────────────────────────────────
/** Floor mat (top surface y = MAT_TOP) along Z, centred at opts.z (default 0). */
export const MAT_TOP = 0.012;
function exercise_mat(opts = {}) {
  const M = getMaterials(), g = new THREE.Group();
  g.add(rbox(0.62, MAT_TOP, 1.85, M.foam, 0, MAT_TOP / 2, opts.z ?? 0, 0.005));
  g.add(rbox(0.6, 0.002, 0.03, M.frameRed, 0, MAT_TOP + 0.001, (opts.z ?? 0) + 0.88, 0.001));
  return { group: g, parts: {}, anchors: {} };
}

export default { lying_leg_curl, seated_leg_curl, captains_chair, hip_thrust_smith, hip_thrust_bench, exercise_mat };
