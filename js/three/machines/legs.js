// Machine batch "legs": hack_squat, leg_press, leg_extension, calf_raise (standing), seated_calf.
// Commercial-gym look (Impulse-style, see docs/GYM_RESEARCH.md): red powder-coated main frames, black secondary
// frames and upholstery, brushed-steel rails and plate horns, chrome guide rods, real plates / weight stacks.
// World metres, figure at the origin facing +Z (left = +X). Every machine exports its key geometry (HACK, LEG_PRESS,
// …) so anims/legs.js poses the figure into exactly the same numbers.
//
// Rotating levers. Movers only TRANSLATE parts, so a lever that must rotate with the figure (leg-extension arm,
// seated-calf lever) reads the figure through two empty tracker parts: the spec drags them with movers along world
// Y and Z after one effector (trackMovers below), and the machine's update() turns that displacement into the lever
// angle. The spec moves that effector on an arc around the lever axis (pose `pivot`), so the angle is exact.
// Such machines take opts { angle: lever angle at the top pose (deg), tracked: [x,y,z] of the tracked effector at
// the top pose }.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { getMaterials } from '../materials.js';
import { stretchBetween, lathe, discProfile } from '../geo.js';
import { buildPlate } from '../props.js';
import { rbox, beam, rod, cylX } from './common.js';

const D2R = Math.PI / 180;

// ── Plain-array vector helpers (shared with anims/legs.js so specs stay JSON-like) ────────────────────────────────
export const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  /** Rotate about world X by `deg` (three.js sense: +deg tips +Y towards +Z, like pelvis rot.x). */
  rotX(a, deg) {
    const r = deg * D2R, c = Math.cos(r), s = Math.sin(r);
    return [a[0], a[1] * c - a[2] * s, a[1] * s + a[2] * c];
  },
  round: (a) => a.map((x) => Math.round(x * 1000) / 1000),
};

/** Movers for the two tracker parts (see the header): the machine reads `effector`'s (dy, dz) displacement. */
export const trackMovers = (effector) => [
  { part: 'track_y', follow: effector, axis: [0, 1, 0] },
  { part: 'track_z', follow: effector, axis: [0, 0, 1] },
];

/**
 * Lever angle from the trackers: the tracked point started at `tracked` (top pose, lever at `angle0`) and moves on
 * an arc about the X-parallel axis through `pivot`. `ang(v)` measures the angle of v = point − pivot (deg).
 */
function makeTracker(g, parts, opts, pivot, ang) {
  const ty = new THREE.Object3D(), tz = new THREE.Object3D();
  g.add(ty, tz);
  parts.track_y = ty; parts.track_z = tz;
  const t0 = opts.tracked || null, a0 = opts.angle ?? 0;
  const ref = t0 ? ang(t0[1] - pivot[1], t0[2] - pivot[2]) : 0;
  return () => (t0 ? a0 + ang(t0[1] + ty.position.y - pivot[1], t0[2] + tz.position.z - pivot[2]) - ref : a0);
}

// ── Mesh helpers (same patterns as common.js) ─────────────────────────────────────────────────────────────────────
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const VA = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const _up = V(0, 1, 0);
const mesh = (geo, mat) => new THREE.Mesh(geo, mat);
/** Pulley / cam wheel with its axle along X. */
const wheelX = (r, w, mat) => mesh(lathe(discProfile(r, w, Math.min(0.006, w * 0.3)), 24).rotateZ(Math.PI / 2), mat);
/** Rubber floor pad under a frame foot. */
const footPad = (M, x, z, w = 0.09, d = 0.09) => rbox(w, 0.016, d, M.rubber, x, 0.008, z, 0.005);

/** Steel plate horn from `base` along unit `dir` with plates (kg list) threaded on, heaviest first. */
function plateHorn(g, base, dir, len, kgs, M) {
  const d = VA(dir).normalize(), b = VA(base);
  g.add(rod(b, b.clone().addScaledVector(d, len), 0.025, M.steel, 18));
  const stop = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.012, 20), M.chrome);
  stop.quaternion.setFromUnitVectors(_up, d); stop.position.copy(b).addScaledVector(d, 0.02); g.add(stop);
  let s = 0.03;
  for (const kg of kgs) {
    const p = buildPlate(kg), th = p.userData.thickness;
    p.quaternion.setFromUnitVectors(_up, d);
    p.position.copy(b).addScaledVector(d, s + th / 2);
    g.add(p);
    s += th + 0.003;
  }
}

/**
 * Handle: steel bar along `dir` through the grip centre `grip` (rubber sleeve ±7 cm), braced back to `mount`.
 * `dir` = the hand's grip (thumb) axis in that pose, so the fist closes around the bar with a straight wrist.
 */
function handle(g, grip, dir, mount, M) {
  const d = dir.clone().normalize();
  const a = grip.clone().addScaledVector(d, -0.12), b = grip.clone().addScaledVector(d, 0.085);
  g.add(rod(mount, a, 0.016, M.steel), rod(a, b, 0.016, M.steel));
  g.add(rod(grip.clone().addScaledVector(d, -0.07), grip.clone().addScaledVector(d, 0.075), 0.0165, M.rubber));   // (step 05) r 16.5 mm (was 21): inside the fist's tunnel
  const cap = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.012, 16), M.rubber);
  cap.quaternion.setFromUnitVectors(_up, d); cap.position.copy(b); g.add(cap);
}

/**
 * Selectorised weight stack centred at (x, z): `n` plates, the top `pinned` ride on the selector pin. Static plates
 * and guide rods go into `g`; returns { part (the moving plates + top plate + pin), top (cable point at rest) }.
 */
function weightStack(g, x, z, M, { n = 14, pinned = 6, w = 0.3, d = 0.13, y0 = 0.1 } = {}) {
  const plateGeo = new RoundedBoxGeometry(w, 0.03, d, 1, 0.004), pitch = 0.033;
  const part = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const p = mesh(plateGeo, M.stack);
    p.position.set(x, y0 + 0.015 + i * pitch, z);
    (i >= n - pinned ? part : g).add(p);
  }
  const topY = y0 + n * pitch;
  part.add(rbox(w + 0.02, 0.04, d + 0.01, M.frame, x, topY + 0.02, z, 0.006));
  part.add(rod(V(x, y0 + (n - pinned) * pitch, z), V(x, topY + 0.05, z), 0.007, M.chrome));
  const pinY = y0 + (n - pinned) * pitch + 0.015;
  part.add(rod(V(x, pinY, z), V(x, pinY, z + d / 2 + 0.05), 0.006, M.steel));
  part.add(rbox(0.03, 0.03, 0.03, M.accent, x, pinY, z + d / 2 + 0.06, 0.008));
  g.add(rbox(w + 0.06, 0.04, d + 0.06, M.rubber, x, y0 - 0.02, z, 0.01));
  return { part, top: V(x, topY + 0.05, z), guideX: [x - w * 0.36, x + w * 0.36] };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Hack squat (plate-loaded, linear). The sled — back pad, head pad, shoulder pads, handles, plate horns — rides on
// two chrome rails parallel to the back pad. Sled-local frame = the lifter's torso frame: origin at the hip joint
// with the sled at its top stop, +Y up the rails, +Z out of the pad (towards the chest).
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
export const HACK = {
  rail: 55,                    // rails / back pad, degrees above the floor → torso reclined 35°
  hip: [0, 0.936, -0.25],      // hip-joint centre at the top stop (= pelvis of the top pose)
  back: 0.12,                  // hip joint → back-pad surface (glutes, upper back)
  tilt: 15,                    // foot platform, toes-up tilt
  sole: [0, 0.18, 0.338],      // platform surface point on the line under the ankles (x = 0)
  grip: [0.26, 0.4, 0.25],     // left handle grip centre, sled-local
  gripDir: [-0.02, -0.81, 0.59],// left handle axis (= grip axis of the fist), sled-local
};
/** Sled-local → world (sled at the top stop). */
export const hackWorld = (p) => v3.add(HACK.hip, v3.rotX(p, HACK.rail - 90));
/** Unit vector of the sled travel, downwards along the rails. */
export const hackDown = () => v3.rotX([0, -1, 0], HACK.rail - 90);
/** Platform surface point `along` metres forward (up the slope) of the ankle line, at lateral x. */
export const hackPlatform = (along, x) => v3.add(v3.add(HACK.sole, [x, 0, 0]), v3.rotX([0, 0, along], -HACK.tilt));

function hack_squat() {
  const M = getMaterials(), red = M.frameRed, g = new THREE.Group();
  const W = (p) => VA(hackWorld(p));
  // Floor frame and rear tower (static).
  const towerTop = W([0, 1.1, -0.33]);
  for (const s of [1, -1]) {
    g.add(beam(V(s * 0.34, 0.04, towerTop.z - 0.12), V(s * 0.34, 0.04, 0.74), 0.08, red, 0.06));
    g.add(footPad(M, s * 0.34, towerTop.z - 0.08), footPad(M, s * 0.34, 0.7));
    g.add(beam(V(s * 0.3, 0.06, towerTop.z), V(s * 0.3, towerTop.y + 0.02, towerTop.z), 0.08, red));
    // Chrome rail on a red spine; the spine is bolted to the tower top and to a floor bracket.
    const r0 = W([s * 0.22, -0.8, -0.27]), r1 = W([s * 0.22, 1.08, -0.27]);
    g.add(rod(r0, r1, 0.021, M.chrome));
    const b0 = W([s * 0.22, -0.82, -0.34]), b1 = W([s * 0.22, 1.12, -0.34]);
    g.add(beam(b0, b1, 0.08, red, 0.05));
    g.add(beam(V(s * 0.22, 0.04, b0.z), b0, 0.07, M.frame, 0.05));
    g.add(beam(b1, V(s * 0.3, b1.y, towerTop.z), 0.06, M.frame));
    // Rubber bumpers = bottom stop of the sled.
    g.add(rod(W([s * 0.22, -0.62, -0.27]), W([s * 0.22, -0.56, -0.27]), 0.034, M.rubber));
  }
  g.add(beam(V(-0.34, 0.04, towerTop.z - 0.06), V(0.34, 0.04, towerTop.z - 0.06), 0.08, M.frame, 0.06));
  g.add(beam(V(-0.34, towerTop.y, towerTop.z), V(0.34, towerTop.y, towerTop.z), 0.07, red));
  g.add(beam(V(-0.34, 0.04, 0.66), V(0.34, 0.04, 0.66), 0.08, M.frame, 0.06));
  // Foot platform: tilted plate with a rubber tread, on two posts and a front kick plate.
  const plat = new THREE.Group();
  plat.position.fromArray(hackPlatform(0.06, 0));
  plat.rotation.x = -HACK.tilt * D2R;
  plat.add(rbox(0.84, 0.012, 0.56, M.rubber, 0, -0.006, 0, 0.004));
  plat.add(rbox(0.86, 0.035, 0.58, M.steel, 0, -0.03, 0, 0.006));
  plat.add(rbox(0.86, 0.05, 0.03, red, 0, -0.02, 0.3, 0.008));
  g.add(plat);
  const pRear = VA(hackPlatform(-0.2, 0)), pFront = VA(hackPlatform(0.3, 0));
  for (const s of [1, -1]) {
    g.add(beam(V(s * 0.3, 0.06, pRear.z), V(s * 0.3, pRear.y - 0.04, pRear.z), 0.06, M.frame));
    g.add(beam(V(s * 0.3, 0.06, pFront.z), V(s * 0.3, pFront.y - 0.05, pFront.z), 0.06, M.frame));
  }

  // Sled (moving part): torso-frame group at the hip, rides on the rails.
  const sled = new THREE.Group();
  const t = new THREE.Group();
  t.position.fromArray(HACK.hip);
  t.rotation.x = (HACK.rail - 90) * D2R;
  sled.add(t);
  const zs = -HACK.back; // pad surface
  t.add(rbox(0.36, 0.7, 0.07, M.upholstery, 0, 0.17, zs - 0.035, 0.03));   // back pad (hips → shoulder blades)
  t.add(rbox(0.22, 0.2, 0.06, M.upholstery, 0, 0.68, zs - 0.025, 0.025));  // head pad
  t.add(rbox(0.33, 1.0, 0.02, M.frame, 0, 0.3, zs - 0.08, 0.005));          // backboard
  for (const s of [1, -1]) {
    t.add(beam(V(s * 0.22, -0.2, -0.23), V(s * 0.22, 0.84, -0.23), 0.06, red, 0.05));
    for (const y of [-0.1, 0.62]) t.add(rbox(0.085, 0.16, 0.085, M.frame, s * 0.22, y, -0.27, 0.01)); // bearing blocks
    // Shoulder pad on a bracket from the sled frame; handle horn under its outer edge.
    t.add(beam(V(s * 0.22, 0.7, -0.22), V(s * 0.16, 0.64, -0.1), 0.05, red));
    t.add(rbox(0.11, 0.02, 0.2, M.frame, s * 0.15, 0.615, -0.03, 0.005));
    t.add(rbox(0.1, 0.075, 0.22, M.upholstery, s * 0.145, 0.567, -0.02, 0.03));
    handle(t, V(s * HACK.grip[0], HACK.grip[1], HACK.grip[2]), V(s * HACK.gripDir[0], HACK.gripDir[1], HACK.gripDir[2]),
      V(s * 0.2, 0.6, -0.12), M);
    // Plate horn behind the shoulders, loaded with a 20 kg plate.
    t.add(beam(V(s * 0.22, 0.42, -0.27), V(s * 0.33, 0.42, -0.27), 0.06, red));
    plateHorn(t, [s * 0.33, 0.42, -0.27], [s, 0, 0], 0.3, [20], M);
  }
  for (const y of [-0.16, 0.42, 0.8]) t.add(beam(V(-0.22, y, -0.23), V(0.22, y, -0.23), 0.05, red));
  g.add(sled);
  return { group: g, parts: { sled }, anchors: { platform: VA(hackPlatform(0.06, 0)) } };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 45° leg press (plate-loaded). Fixed reclined seat; the foot plate rides up the 45° rails on a carriage with plate
// horns. The foot plate face is tilted towards the lifter (normal 28° below horizontal) so the ankles stay within a
// comfortable range at the bottom. `opts.travel` = sled position along the rails at the top pose (0 = lockout of
// the normal leg press; leg_press_calf starts further up).
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
export const LEG_PRESS = {
  rail: 45,                // sled travel, degrees above the floor
  face: 28,                // foot-plate normal (towards the lifter), degrees below horizontal
  recline: 55,             // back pad, degrees from vertical
  hip: [0, 0.55, 0],       // hip-joint centre (fixed)
  sole: [0, 1.21, 0.7],    // foot-plate surface point on the ankle line (x = 0) at travel 0
  grip: [0.29, 0.555, 0.07], // left seat-handle grip centre (world)
  gripDir: [0, 0.91, 0.415], // its axis (= grip axis of the fist)
};
/** Unit vectors: rail (up the sled travel), plate normal towards the lifter, plate "up" (heel → toes). */
export const legPressDirs = () => ({
  e: v3.rotX([0, 0, 1], -LEG_PRESS.rail),
  n: v3.rotX([0, 0, -1], -LEG_PRESS.face),
  t: v3.rotX([0, 1, 0], -LEG_PRESS.face),
});
/** Foot-plate surface point at sled `travel`, `along` metres up the plate from the ankle line, lateral x. */
export function legPressPlate(travel, along, x) {
  const { e, t } = legPressDirs();
  return v3.add(v3.add(v3.add(LEG_PRESS.sole, v3.mul(e, travel)), v3.mul(t, along)), [x, 0, 0]);
}

function leg_press(opts = {}) {
  const M = getMaterials(), red = M.frameRed, g = new THREE.Group();
  const { e } = legPressDirs(), E = VA(e);
  const travel = opts.travel ?? 0;
  // Rails: x = ±0.27, along e through a line 0.42 m below the foot-plate centre (perpendicular to the rails).
  const c0 = VA(legPressPlate(0, 0.06, 0));
  const rail0 = c0.clone().add(V(0, -0.297, 0.297));
  const railAt = (s, k) => rail0.clone().addScaledVector(E, k).setX(s * 0.27);
  for (const s of [1, -1]) {
    const a = railAt(s, -0.9), b = railAt(s, 0.62);
    g.add(rod(a, b, 0.022, M.chrome));
    const sa = a.clone().add(V(0, -0.05, 0.05)), sb = b.clone().add(V(0, -0.05, 0.05));
    g.add(beam(sa, sb, 0.08, red, 0.05));
    // Supports: rear post under the low end, front tower under the high end, diagonal brace.
    g.add(beam(V(s * 0.27, 0.05, sa.z), sa, 0.07, red));
    g.add(beam(V(s * 0.3, 0.05, sb.z + 0.02), sb.clone().setX(s * 0.3), 0.08, red));
    g.add(beam(V(s * 0.3, 0.05, sb.z - 0.55), railAt(s, 0.1).add(V(0, -0.05, 0.05)), 0.05, M.frame));
    g.add(rod(railAt(s, -0.72), railAt(s, -0.66), 0.036, M.rubber)); // bottom stop bumpers
    // Floor rails.
    g.add(beam(V(s * 0.34, 0.04, -0.95), V(s * 0.34, 0.04, sb.z + 0.16), 0.08, red, 0.06));
    g.add(footPad(M, s * 0.34, -0.9), footPad(M, s * 0.34, sb.z + 0.12));
  }
  g.add(beam(V(-0.34, 0.04, -0.9), V(0.34, 0.04, -0.9), 0.08, M.frame, 0.06));
  g.add(beam(V(-0.34, 0.04, 1.25), V(0.34, 0.04, 1.25), 0.08, M.frame, 0.06));

  // Seat: back pad (torso frame at the hip) + tilted seat pan, on a red frame.
  const seat = new THREE.Group();
  seat.position.fromArray(LEG_PRESS.hip);
  seat.rotation.x = -LEG_PRESS.recline * D2R;
  seat.add(rbox(0.42, 0.98, 0.07, M.upholstery, 0, 0.36, -0.155, 0.03));
  seat.add(rbox(0.38, 0.96, 0.02, M.frame, 0, 0.36, -0.2, 0.005));
  g.add(seat);
  const pan = new THREE.Group();
  pan.position.fromArray(LEG_PRESS.hip);
  pan.rotation.x = -40 * D2R;
  pan.add(rbox(0.42, 0.07, 0.34, M.upholstery, 0, -0.15, 0.05, 0.03));   // (step 05) 15 mm lower: the thighs sank 31 mm
  pan.add(rbox(0.38, 0.02, 0.3, M.frame, 0, -0.195, 0.05, 0.005));
  g.add(pan);
  const hip = VA(LEG_PRESS.hip);
  const backLow = hip.clone().add(V(0, -0.2, -0.28)), backHigh = hip.clone().add(V(0, 0.28, -0.72));
  for (const s of [1, -1]) {
    g.add(beam(V(s * 0.16, 0.05, -0.85), backHigh.clone().setX(s * 0.16), 0.06, red));
    g.add(beam(V(s * 0.16, 0.05, 0.12), hip.clone().add(V(s * 0.16, -0.2, 0.08)), 0.06, red));
    g.add(beam(backLow.clone().setX(s * 0.16), hip.clone().add(V(s * 0.16, -0.2, 0.08)), 0.05, M.frame));
    // Seat handle beside the hip.
    const gp = V(s * LEG_PRESS.grip[0], LEG_PRESS.grip[1], LEG_PRESS.grip[2]);
    handle(g, gp, V(s * LEG_PRESS.gripDir[0], LEG_PRESS.gripDir[1], LEG_PRESS.gripDir[2]), V(s * 0.16, gp.y - 0.2, gp.z - 0.12), M);
  }

  // Sled: foot plate (plate frame: +Y = heel → toes, +Z = away from the lifter), carriage, struts, plate horns.
  const sled = new THREE.Group();
  sled.position.copy(E).multiplyScalar(travel);
  const plate = new THREE.Group();
  plate.position.copy(c0);
  plate.rotation.x = -LEG_PRESS.face * D2R;
  plate.add(rbox(0.78, 0.6, 0.012, M.rubber, 0, 0, 0.006, 0.004));
  plate.add(rbox(0.82, 0.64, 0.035, M.frame, 0, 0, 0.03, 0.008));
  for (const s of [1, -1]) plate.add(rbox(0.03, 0.66, 0.08, red, s * 0.41, 0, 0.05, 0.008));
  sled.add(plate);
  const carriage = rail0.clone().addScaledVector(E, 0.0);
  for (const s of [1, -1]) {
    for (const k of [-0.16, 0.16]) {
      const c = carriage.clone().addScaledVector(E, k).setX(s * 0.27);
      sled.add(rbox(0.09, 0.09, 0.09, M.frame, c.x, c.y, c.z, 0.01));
    }
    const lo = carriage.clone().addScaledVector(E, -0.16).setX(s * 0.27);
    const hi = carriage.clone().addScaledVector(E, 0.16).setX(s * 0.27);
    sled.add(beam(lo, hi, 0.06, red, 0.07));
    // Struts carriage → back of the foot plate.
    const back = (along) => VA(legPressPlate(0, along, s * 0.27)).add(V(0, 0.469 * 0.06, 0.883 * 0.06));
    sled.add(beam(lo, back(-0.22), 0.05, red));
    sled.add(beam(hi, back(0.3), 0.05, red));
    // Plate horn on the upper end of the carriage (keeps the plates clear of the feet in profile).
    const hb = carriage.clone().addScaledVector(E, 0.26);
    sled.add(beam(hi, hb.clone().setX(s * 0.27), 0.05, red));
    sled.add(beam(hb.clone().setX(s * 0.27), hb.clone().setX(s * 0.36), 0.05, red));
    plateHorn(sled, [s * 0.36, hb.y, hb.z], [s, 0, 0], 0.32, [20, 10], M);
  }
  sled.add(beam(carriage.clone().setX(-0.27), carriage.clone().setX(0.27), 0.05, red));
  g.add(sled);
  return { group: g, parts: { sled }, anchors: { platform: c0.clone().addScaledVector(E, travel) } };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Leg extension (selectorised). Seat + reclined back pad; the lever arm pivots on the knee axis and carries the shin
// roller; a cam on the pivot winds the cable that lifts the weight stack (tower behind the seat, lifter's right).
// Arm angle φ = shin angle from hanging straight down (0) towards horizontal (90). opts: angle, tracked (foot_L).
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
export const LEG_EXT = {
  // Seat high enough that the feet hang ~10 cm clear of the base frame at the bottom of the rep.
  hip: [0, 0.715, 0],      // hip-joint centre (seated, thighs horizontal)
  recline: 12,             // back pad, degrees from vertical
  knee: [0, 0.715, 0.45],  // knee joint = machine pivot axis (x = 0 line)
  seat: 0.63,              // seat pad top
  pad: 0.37,               // shin roller: distance from the knee along the shin…
  padOff: 0.082,           // …and its centre this far in front of the shin axis
  start: -3,               // arm angle where the stack rests (bottom of the rep)
  cam: 0.1,                // cam radius → stack lift per radian
  grip: [0.27, 0.675, 0.08], // left seat-handle grip centre (world)
  gripDir: [0, 0.767, 0.642],// its axis (= grip axis of the fist)
};
const shinAngle = (dy, dz) => Math.atan2(dz, -dy) / D2R; // 0 = straight down, 90 = forward

function leg_extension(opts = {}) {
  const M = getMaterials(), red = M.frameRed, g = new THREE.Group(), parts = {};
  const K = LEG_EXT.knee, hip = VA(LEG_EXT.hip);
  const angleNow = makeTracker(g, parts, opts, K, shinAngle);
  // Base and seat.
  for (const s of [1, -1]) g.add(beam(V(s * 0.25, 0.04, -0.45), V(s * 0.25, 0.04, 0.62), 0.08, red, 0.06));
  for (const z of [-0.42, 0.58]) {
    g.add(beam(V(-0.62, 0.04, z), V(0.25, 0.04, z), 0.08, M.frame, 0.06));
    for (const x of [-0.6, 0.25]) g.add(footPad(M, x, z));
  }
  g.add(rbox(0.4, 0.08, 0.5, M.upholstery, 0, LEG_EXT.seat - 0.052, 0.11, 0.03));   // (step 05) top 12 mm under LEG_EXT.seat: 26 mm sink → ≈ 14
  g.add(rbox(0.34, 0.03, 0.44, M.frame, 0, LEG_EXT.seat - 0.095, 0.11, 0.006));
  g.add(beam(V(0, 0.06, 0.11), V(0, LEG_EXT.seat - 0.11, 0.11), 0.08, red));
  const back = new THREE.Group();
  back.position.copy(hip);
  back.rotation.x = -LEG_EXT.recline * D2R;
  back.add(rbox(0.38, 0.69, 0.07, M.upholstery, 0, 0.275, -0.155, 0.03));
  back.add(rbox(0.32, 0.64, 0.02, M.frame, 0, 0.275, -0.2, 0.005));
  back.add(beam(V(0, 0.0, -0.22), V(0, 0.55, -0.22), 0.06, red));
  g.add(back);
  // Post under the back pad, ending at the lower end of its red spine (local (0, 0, −0.22) rotated by the recline).
  g.add(beam(V(0, 0.06, -0.3), hip.clone().add(V(0, 0, -0.22).applyAxisAngle(V(1, 0, 0), -LEG_EXT.recline * D2R)), 0.07, red));
  // Seat handles beside the hips.
  for (const s of [1, -1]) {
    const gp = V(s * LEG_EXT.grip[0], LEG_EXT.grip[1], LEG_EXT.grip[2]);
    handle(g, gp, V(s * LEG_EXT.gripDir[0], LEG_EXT.gripDir[1], LEG_EXT.gripDir[2]), V(s * 0.17, LEG_EXT.seat - 0.07, gp.z - 0.1), M);
  }
  // Pivot tower on the lifter's right (−X), axle through the knee axis.
  const px = -0.43;
  g.add(beam(V(px - 0.02, 0.06, K[2] + 0.05), V(px - 0.02, K[1] - 0.06, K[2]), 0.08, red));
  g.add(beam(V(px - 0.02, 0.06, K[2] + 0.05), V(px - 0.02, 0.06, -0.42), 0.07, red, 0.06));
  g.add(rbox(0.06, 0.12, 0.12, M.frame, px - 0.02, K[1], K[2], 0.01));
  // Arm (moving part): pivots at the knee, −Y along the shin, +Z = shin front.
  const arm = new THREE.Group();
  arm.position.fromArray(K);
  const ax = -0.31, py = -LEG_EXT.pad, pz = LEG_EXT.padOff;
  const hub = mesh(cylX(0.045, 0.08), M.frame); hub.position.x = ax; arm.add(hub);
  arm.add(rod(V(px - 0.05, 0, 0), V(ax + 0.04, 0, 0), 0.02, M.chrome));
  const cam = wheelX(LEG_EXT.cam, 0.03, M.steel); cam.position.x = px + 0.06; arm.add(cam);
  arm.add(beam(V(ax, -0.02, 0.0), V(ax, py, pz * 0.5), 0.05, red, 0.04));
  arm.add(beam(V(ax, py, pz * 0.5), V(ax, py, pz), 0.05, red, 0.04));
  arm.add(rod(V(ax, py, pz), V(-0.22, py, pz), 0.014, M.steel));
  const roller = mesh(lathe(discProfile(0.05, 0.42, 0.02, 0.012), 24).rotateZ(Math.PI / 2), M.foam);
  roller.position.set(0, py, pz); arm.add(roller);
  g.add(arm);
  parts.arm = arm;
  // Weight stack tower behind the seat on the right; cable: cam → floor pulleys → top pulley → stack.
  const sx = px, sz = -0.33;
  const st = weightStack(g, sx, sz, M, { n: 14, pinned: 6 });
  g.add(st.part);
  parts.stack = st.part;
  for (const x of st.guideX) g.add(rod(V(x, 0.08, sz), V(x, 1.42, sz), 0.008, M.chrome));
  for (const dz of [-0.11, 0.11]) g.add(beam(V(sx, 0.04, sz + dz), V(sx, 1.5, sz + dz), 0.05, red));
  g.add(beam(V(sx - 0.03, 1.5, sz - 0.14), V(sx - 0.03, 1.5, sz + 0.14), 0.07, red));
  const camLow = V(px + 0.06, K[1] - LEG_EXT.cam, K[2]);
  const pulleys = [V(px + 0.06, 0.1, K[2]), V(px + 0.06, 0.1, sz + 0.1), V(px + 0.06, 1.42, sz + 0.05)];
  g.add(rod(camLow, pulleys[0], 0.005, M.cable, 6));
  g.add(rod(pulleys[0], pulleys[1], 0.005, M.cable, 6));
  g.add(rod(pulleys[1], V(pulleys[2].x, pulleys[2].y, sz + 0.1), 0.005, M.cable, 6));
  for (const p of pulleys) { const w = wheelX(0.045, 0.022, M.steel); w.position.copy(p); g.add(w); }
  const drop = rod(V(sx, 1.42, sz), st.top, 0.005, M.cable, 6);
  g.add(drop);
  const dropTop = V(sx, 1.42, sz), dropEnd = V(0, 0, 0);
  return {
    group: g, parts, anchors: { knee: VA(K) },
    update() {
      const phi = angleNow();
      arm.rotation.x = -phi * D2R;
      st.part.position.y = Math.max(0, (phi - LEG_EXT.start) * D2R * LEG_EXT.cam);
      stretchBetween(drop, dropTop, dropEnd.copy(st.top).setY(st.top.y + st.part.position.y));
    },
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Standing calf machine (selectorised). Step block for the balls of the feet (heels hang off its rear edge), a column
// in front with the weight stack, and a carriage on chrome guide rods carrying the shoulder pads and handles back over
// the lifter. Carriage and stack rise together (cable 1:1). opts.padY / padZ = underside / centre of the shoulder pads
// at the top pose (the spec computes them from the figure); opts.rise = carriage travel bottom → top.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
export const CALF_STAND = {
  step: 0.14,                 // step top
  edge: 0.085,                // rear edge of the step (z): the balls of the feet sit just in front of it
  grip: [0.27, -0.16, 0.25],  // left handle grip centre relative to (0, padY, padZ)
  gripDir: [0, -0.875, 0.484],// its axis (= grip axis of the fist), pointing down-forward away from the mount
};

function calf_raise(opts = {}) {
  const M = getMaterials(), red = M.frameRed, g = new THREE.Group();
  const padY = opts.padY ?? 1.7, padZ = opts.padZ ?? -0.04;
  const zc = 0.62; // column centre
  // Base + step: steel tread on a black box, red side rails.
  for (const s of [1, -1]) {
    g.add(beam(V(s * 0.36, 0.04, -0.12), V(s * 0.36, 0.04, zc + 0.22), 0.08, red, 0.06));
    g.add(footPad(M, s * 0.36, -0.08), footPad(M, s * 0.36, zc + 0.18));
  }
  const sd = 0.45, sz = CALF_STAND.edge + sd / 2, top = CALF_STAND.step;
  g.add(rbox(0.66, top - 0.02, sd, M.frame, 0, (top - 0.02) / 2, sz, 0.01));
  g.add(rbox(0.66, 0.02, sd, M.steel, 0, top - 0.01, sz, 0.004));
  g.add(rbox(0.66, 0.022, 0.035, M.rubber, 0, top - 0.008, CALF_STAND.edge + 0.02, 0.006)); // grip strip at the edge
  // Column: two red uprights, top beam, stack between them, carriage guide rods on the rear face.
  const H = 2.25;
  for (const s of [1, -1]) {
    g.add(beam(V(s * 0.26, 0.04, zc), V(s * 0.26, H, zc), 0.09, red));
    g.add(rod(V(s * 0.12, 0.3, zc - 0.13), V(s * 0.12, H - 0.06, zc - 0.13), 0.016, M.chrome));
  }
  g.add(beam(V(-0.31, H, zc), V(0.31, H, zc), 0.09, red));
  g.add(beam(V(-0.18, H - 0.05, zc - 0.13), V(0.18, H - 0.05, zc - 0.13), 0.05, M.frame));
  g.add(beam(V(-0.18, 0.28, zc - 0.13), V(0.18, 0.28, zc - 0.13), 0.05, M.frame));
  const st = weightStack(g, 0, zc + 0.02, M, { n: 16, pinned: 7, w: 0.3, d: 0.12, y0: 0.12 });
  g.add(st.part);
  for (const x of st.guideX) g.add(rod(V(x, 0.08, zc + 0.02), V(x, H - 0.1, zc + 0.02), 0.008, M.chrome));
  // Carriage (moving part): slider on the guide rods, arms back over the shoulders, pads, handles.
  const car = new THREE.Group();
  const yA = padY + 0.09; // arm height
  car.add(rbox(0.36, 0.3, 0.07, M.frame, 0, yA - 0.1, zc - 0.13, 0.012));
  for (const s of [1, -1]) {
    car.add(rbox(0.06, 0.1, 0.06, M.frame, s * 0.12, yA - 0.2, zc - 0.13, 0.01));
    car.add(rbox(0.06, 0.1, 0.06, M.frame, s * 0.12, yA + 0.02, zc - 0.13, 0.01));
    car.add(beam(V(s * 0.24, yA, zc - 0.13), V(s * 0.24, yA, padZ - 0.1), 0.065, red));
    car.add(beam(V(s * 0.17, yA - 0.1, zc - 0.13), V(s * 0.24, yA, zc - 0.25), 0.04, red));
    car.add(rbox(0.16, 0.02, 0.2, M.frame, s * 0.19, padY + 0.085, padZ, 0.005));
    car.add(rbox(0.11, 0.075, 0.22, M.upholstery, s * 0.145, padY + 0.0375, padZ, 0.03));
    // Handle hangs from the arm in front of the shoulder; rubber grip at CALF_STAND.grip.
    const gp = V(s * CALF_STAND.grip[0], padY + CALF_STAND.grip[1], padZ + CALF_STAND.grip[2]);
    handle(car, gp, V(s * CALF_STAND.gripDir[0], CALF_STAND.gripDir[1], CALF_STAND.gripDir[2]), V(s * 0.24, yA, padZ + 0.1), M);
  }
  // Cross brace well in front of the face (at padZ + 0.1 it sat at chin height and cut through the jaw).
  car.add(beam(V(-0.24, yA, padZ + 0.32), V(0.24, yA, padZ + 0.32), 0.045, red));
  g.add(car);
  // Cable: carriage bottom ↓ floor pulley → front floor pulley ↑ top pulley ↓ stack (carriage up = stack up).
  const p1 = V(0, 0.16, zc - 0.13), p2 = V(0, 0.16, zc + 0.12), p3 = V(0, H - 0.12, zc + 0.12);
  for (const p of [p1, p2, p3]) { const w = wheelX(0.045, 0.022, M.steel); w.rotation.y = Math.PI / 2; w.position.copy(p); g.add(w); }
  g.add(rod(p1, p2, 0.005, M.cable, 6), rod(p2, p3, 0.005, M.cable, 6));
  const carCable = rod(V(0, yA - 0.25, zc - 0.13), p1, 0.005, M.cable, 6);
  const stackCable = rod(V(0, H - 0.12, st.top.z), st.top, 0.005, M.cable, 6);
  g.add(carCable, stackCable);
  const carLow = V(0, yA - 0.25, zc - 0.13), stTop = V(0, H - 0.12, st.top.z), a = V(0, 0, 0);
  const rise = opts.rise ?? 0.12; // carriage travel from the stretched bottom (stack resting) to the top pose
  return {
    group: g, parts: { carriage: car, stack: st.part }, anchors: { step: V(0, top, CALF_STAND.edge) },
    update() {
      const lift = car.position.y; // ≤ 0: the carriage is built at the top pose and a mover lowers it
      st.part.position.y = Math.max(0, rise + lift);
      stretchBetween(carCable, a.copy(carLow).setY(carLow.y + lift), p1);
      stretchBetween(stackCable, stTop, a.copy(st.top).setY(st.top.y + st.part.position.y));
    },
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Seated calf raise (plate-loaded). Seat, raised foot plate (heels hang off its rear edge), and a lever pivoting at
// the front at knee-pad height: two side arms carry the knee pad (on the lower thighs), its handles and the plate
// horns. Lever angle θ > 0 lifts the pad. Lever-local frame: origin on the pivot axis, −Z back towards the lifter.
// opts: angle (θ at the top pose), tracked (hand_L at the top pose; the hands hold the pad handles).
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
export const SEATED_CALF = {
  hip: [0, 0.66, 0],          // hip-joint centre on the seat
  seat: 0.565,                // seat top
  plate: 0.14,                // foot-plate top
  edge: 0.575,                // foot-plate rear edge (z)
  pivot: [0, 0.76, 1.0],      // lever axis (x = 0 line)
  pad: [0, -0.065, -0.63],    // knee-pad contact point (underside centre), lever-local
  grip: [0.24, 0.1, -0.61],   // left handle grip centre, lever-local (vertical grip)
};
/** Lever-local point → world at lever angle θ (deg). */
export const seatedCalfWorld = (p, deg) => v3.add(SEATED_CALF.pivot, v3.rotX(p, deg));
const leverAngle = (dy, dz) => Math.atan2(dy, -dz) / D2R;

function seated_calf(opts = {}) {
  const M = getMaterials(), red = M.frameRed, g = new THREE.Group(), parts = {};
  const P = SEATED_CALF.pivot;
  const angleNow = makeTracker(g, parts, opts, P, leverAngle);
  // Base frame.
  for (const s of [1, -1]) {
    g.add(beam(V(s * 0.3, 0.04, -0.35), V(s * 0.3, 0.04, 1.12), 0.08, red, 0.06));
    g.add(footPad(M, s * 0.3, -0.3), footPad(M, s * 0.3, 1.08));
  }
  g.add(beam(V(-0.3, 0.04, -0.3), V(0.3, 0.04, -0.3), 0.08, M.frame, 0.06));
  // Seat on a post.
  g.add(rbox(0.38, 0.08, 0.42, M.upholstery, 0, SEATED_CALF.seat - 0.04, -0.02, 0.03));
  g.add(rbox(0.32, 0.03, 0.36, M.frame, 0, SEATED_CALF.seat - 0.095, -0.02, 0.006));
  g.add(beam(V(0, 0.06, -0.02), V(0, SEATED_CALF.seat - 0.11, -0.02), 0.09, red));
  g.add(beam(V(-0.3, 0.06, -0.02), V(0.3, 0.06, -0.02), 0.07, M.frame, 0.06));
  // Foot plate: steel tread on a black block, rubber strip on the rear edge.
  const fd = 0.3, fz = SEATED_CALF.edge + fd / 2, ft = SEATED_CALF.plate;
  g.add(rbox(0.62, ft - 0.02, fd, M.frame, 0, (ft - 0.02) / 2, fz, 0.01));
  g.add(rbox(0.62, 0.02, fd, M.steel, 0, ft - 0.01, fz, 0.004));
  g.add(rbox(0.62, 0.022, 0.035, M.rubber, 0, ft - 0.008, SEATED_CALF.edge + 0.02, 0.006));
  // Pivot uprights + axle.
  for (const s of [1, -1]) {
    g.add(beam(V(s * 0.33, 0.06, P[2] + 0.06), V(s * 0.33, P[1], P[2]), 0.08, red));
    g.add(rbox(0.05, 0.11, 0.11, M.frame, s * 0.33, P[1], P[2], 0.01));
  }
  // Lever (moving part).
  const lever = new THREE.Group();
  lever.position.fromArray(P);
  const axle = mesh(cylX(0.022, 0.62), M.chrome); lever.add(axle);
  const [, py, pz] = SEATED_CALF.pad;
  for (const s of [1, -1]) {
    const hub = mesh(cylX(0.04, 0.06), M.frame); hub.position.x = s * 0.27; lever.add(hub);
    lever.add(beam(V(s * 0.27, 0, 0), V(s * 0.27, 0.02, pz + 0.05), 0.06, red, 0.07));
    lever.add(beam(V(s * 0.27, 0.02, pz + 0.05), V(s * 0.2, 0.01, pz), 0.05, red, 0.06));
    // Handle: upright rubber grip standing on the pad end.
    const [gx, gy, gz] = SEATED_CALF.grip;
    handle(lever, V(s * gx, gy, gz), V(0, 1, 0), V(s * gx, py + 0.08, gz), M);
    // Plate horn near the pivot, outside the uprights (keeps shins and pad visible in profile).
    lever.add(beam(V(s * 0.27, 0.0, -0.12), V(s * 0.42, 0.0, -0.12), 0.05, red));
    plateHorn(lever, [s * 0.42, 0.0, -0.12], [s, 0, 0], 0.26, [20], M);
  }
  lever.add(beam(V(-0.27, 0.02, pz + 0.05), V(0.27, 0.02, pz + 0.05), 0.05, red));
  // Knee pad: two foam rolls across the lower thighs (contact = their underside at SEATED_CALF.pad).
  lever.add(rbox(0.46, 0.03, 0.15, M.frame, 0, py + 0.085, pz, 0.006));
  lever.add(rbox(0.44, 0.07, 0.15, M.upholstery, 0, py + 0.035, pz, 0.03));
  // Release lever of the safety catch (accent knob), next to the left handle.
  lever.add(rod(V(0.16, py + 0.1, pz + 0.05), V(0.16, py + 0.2, pz + 0.12), 0.01, M.steel));
  lever.add(rbox(0.03, 0.03, 0.03, M.accent, 0.16, py + 0.2, pz + 0.12, 0.008));
  g.add(lever);
  parts.lever = lever;
  return {
    group: g, parts, anchors: { pivot: VA(P) },
    update() { lever.rotation.x = angleNow() * D2R; },
  };
}

export default { hack_squat, leg_press, leg_extension, calf_raise, seated_calf };
