// Animation specs, batch "legs": machine squats and presses, split squats, leg extension, calf raises.
// Structure follows the reference specs (db_bench_press, bb_rdl); authoring guide: ../README.md.
// Poses are COMPUTED from the machine geometry exported by ../machines/legs.js (and BENCH_FLAT), so the figure sits
// exactly on the pads and plates and every hand/foot target is reachable. Conventions used below:
//   • foot `pitch` = foot rot.x (deg): + = toes down / heel up; foot-local frame: ankle = origin, sole at −ANKLE_H.
//   • `lean` = pelvis rot.x: + = torso forward, − = reclined. Spine/chest stay neutral, so torso-local points map to
//     the world with onTorso().
// Wrist care: every grip is neutral or on a bar resting on the traps — the IK keeps the wrists straight.
import {
  v3, trackMovers, HACK, hackWorld, hackDown, hackPlatform, LEG_PRESS, legPressDirs, legPressPlate, LEG_EXT,
  CALF_STAND, SEATED_CALF, seatedCalfWorld,
} from '../machines/legs.js';
import { BENCH_FLAT } from '../machines/common.js';

const D2R = Math.PI / 180;
const THIGH = 0.45, SHIN = 0.44, ANKLE_H = 0.085;    // figure.js DIM
const BALL = [0, -ANKLE_H, 0.14];                     // ball of the foot, foot-local
const INSTEP = [0, -0.052, 0.15];                     // top of the forefoot (laces), foot-local
const SHOULDER = [0.2, 0.46, -0.035];                 // left shoulder joint, pelvis-local
const TRAPS = [0, 0.515, -0.105];                     // bar centre resting on the upper traps (high bar), pelvis-local
const r = v3.round;

/** Ankle joint above a sole point for a foot pitch. */
const ankleOf = (sole, pitch) => v3.add(sole, v3.rotX([0, ANKLE_H, 0], pitch));
/** Sole point (foot `pos`) that puts the foot-local point `local` (BALL, INSTEP…) at world `at`. */
const footAt = (at, local, pitch) => v3.add(at, v3.rotX(v3.sub([0, -ANKLE_H, 0], local), pitch));
/** Pelvis-local point → world for a pelvis at `pelvis` with forward lean `lean` (neutral spine). */
const onTorso = (pelvis, lean, local) => v3.add(pelvis, v3.rotX(local, lean));
/** Hip → ankle distance for a knee flexion (deg). */
const legSpan = (flex) => Math.sqrt(THIGH ** 2 + SHIN ** 2 + 2 * THIGH * SHIN * Math.cos(flex * D2R));
/** Signed travel s along unit `dir` from p0 that puts p0 + s·dir at distance L from q (root closest to 0). */
function travelTo(p0, dir, q, L) {
  const w = v3.sub(p0, q), b = v3.dot(w, dir), disc = b * b - (v3.dot(w, w) - L * L);
  const s1 = -b - Math.sqrt(disc), s2 = -b + Math.sqrt(disc);
  return Math.abs(s1) < Math.abs(s2) ? s1 : s2;
}
/** Root of f on [a, b] (f(a), f(b) of opposite sign) by bisection. */
function bisect(f, a, b) {
  let fa = f(a);
  for (let i = 0; i < 48; i++) {
    const m = (a + b) / 2, fm = f(m);
    if ((fm > 0) === (fa > 0)) { a = m; fa = fm; } else b = m;
  }
  return (a + b) / 2;
}
/** Hip height that puts the hip (x = ±0.1, z = pz) at distance L from an ankle. */
const hipHeight = (ankle, pz, L) => ankle[1] + Math.sqrt(L * L - (Math.abs(ankle[0]) - 0.1) ** 2 - (ankle[2] - pz) ** 2);
/** Both sides of a hand/foot entry: fn(s) with s = 1 (left, +X) / −1 (right). */
const both = (name, fn) => ({ [name + '_L']: fn(1), [name + '_R']: fn(-1) });

// ── Barbell / Smith squat patterns ────────────────────────────────────────────────────────────────────────────────
/** Pelvis that puts the bar (on the traps) at depth barZ for a given lean and hip height. */
const pelvisUnderBar = (lean, y, barZ) => [0, y, barZ - v3.rotX(TRAPS, lean)[2]];
/** Wide overhand grip on a bar lying on the traps: palms forward/down, elbows down and back (wrist-neutral). */
const barHands = (pelvis, lean, width = 0.42) => both('hand', (s) => ({
  pos: r(v3.add(onTorso(pelvis, lean, TRAPS), [s * width, 0, 0])),
  palm: r(v3.rotX([0, -0.35, 1], lean)),
  hint: r(onTorso(pelvis, lean, [s * 0.5, 0.12, -0.34])),
}));

function backSquat({ foot, barZ, top, mid, bottom }) {
  const pzTop = pelvisUnderBar(top.lean, 0, barZ)[2];
  const ankle = ankleOf(foot, 0);
  const pelTop = pelvisUnderBar(top.lean, hipHeight(ankle, pzTop, legSpan(top.knee)), barZ);
  const pelMid = pelvisUnderBar(mid.lean, mid.y, barZ);
  const pelBot = pelvisUnderBar(bottom.lean, bottom.y, barZ);
  const feet = both('foot', (s) => ({ pos: [s * foot[0], 0, foot[2]], rot: [0, s * foot.toesOut, 0], hint: [s * 0.42, 0.5, 1.2] }));
  return {
    barTop: onTorso(pelTop, top.lean, TRAPS)[1], barBottom: onTorso(pelBot, bottom.lean, TRAPS)[1],
    poses: {
      top: {
        pelvis: { pos: r(pelTop), rot: [top.lean, 0, 0] },
        spine: [0, 0, 0], chest: [0, 0, 0], neck: [-top.lean * 0.6, 0, 0], head: [0, 0, 0],
        clavicle_L: [0, -6, -2], clavicle_R: [0, -6, -2],               // shoulder blades squeezed: shelf for the bar
        ...barHands(pelTop, top.lean), ...feet,
      },
      // Half-way: the hips already travelled back (lean leads), so the knees do not drift past the toes.
      mid: { pelvis: { pos: r(pelMid), rot: [mid.lean, 0, 0] }, neck: [-mid.lean * 0.6, 0, 0], ...barHands(pelMid, mid.lean) },
      bottom: {
        pelvis: { pos: r(pelBot), rot: [bottom.lean, 0, 0] },
        neck: [-bottom.lean * 0.6, 0, 0],                                 // gaze stays ~forward
        ...barHands(pelBot, bottom.lean),
      },
    },
  };
}

// ── Split squats (front = left leg, rear = right leg) ─────────────────────────────────────────────────────────────
/**
 * Vertical split squat ("down like an elevator"): the pelvis only moves up/down at z = pz. `rear` = { sole, pitch }
 * of the rear foot (fixed). Top hip height is limited by both legs (front knee soft, rear knee bent).
 */
function splitLegs({ front, rear, pz, yBottom, frontFlex = 12, rearFlex = 25 }) {
  const fAnk = ankleOf(front, 0), rAnk = ankleOf(rear.sole, rear.pitch);
  const yTop = Math.min(hipHeight(fAnk, pz, legSpan(frontFlex)), hipHeight(rAnk, pz, legSpan(rearFlex)));
  return {
    yTop, yBottom,
    feet: {
      foot_L: { pos: r(front), rot: [0, 5, 0], hint: [0.2, 0.5, 1.4] },
      foot_R: { pos: r(rear.sole), rot: [rear.pitch, 0, 0], hint: [-0.14, -0.4, 0.35] }, // rear knee points down
    },
  };
}

// ── Hack squat ────────────────────────────────────────────────────────────────────────────────────────────────────
function hackSquat() {
  const down = hackDown(), lean = HACK.rail - 90, pitch = -HACK.tilt;
  // Depth: the sled travels until the knees reach ~112° flexion (thighs slightly below parallel to the platform).
  const s = travelTo(v3.add(HACK.hip, [0.1, 0, 0]), down, ankleOf(hackPlatform(0, 0.16), pitch), legSpan(112));
  const moved = (p, k) => r(v3.add(p, v3.mul(down, k)));
  const hand = (k) => both('hand', (sx) => ({
    pos: moved(hackWorld([sx * HACK.grip[0], HACK.grip[1], HACK.grip[2]]), k),
    palm: [-sx, 0, 0],                                                    // neutral grip on the forward horns
    hint: moved(hackWorld([sx * 0.42, 0.14, -0.02]), k),                  // elbows down and out
  }));
  return {
    id: 'hack_squat',
    machine: 'hack_squat',
    movers: [{ part: 'sled', follow: 'pelvis', axis: down }],
    camera: { target: [0, 0.82, -0.12], front: [2.55, 1.75, 2.25], side: [3.15, 1.2, 1.15] },
    tempo: { eccentric: 2.5, bottom: 0.3, concentric: 1.2, top: 0.5 },
    arrow: { effector: 'pelvis', offset: [0.36, 0.06, 0.12] },
    poses: {
      top: {
        // Back and hips flat on the pad, shoulders under the pads, knees soft (~15°) at lockout.
        pelvis: { pos: HACK.hip, rot: [lean, 0, 0] },
        spine: [0, 0, 0], chest: [0, 0, 0], neck: [4, 0, 0], head: [2, 0, 0],
        clavicle_L: [0, 0, -2], clavicle_R: [0, 0, -2],
        ...hand(0),
        // Feet shoulder-width in the middle of the platform, toes slightly out; knees track over the toes.
        ...both('foot', (sx) => ({ pos: r(hackPlatform(0, sx * 0.16)), rot: [pitch, sx * 8, 0], hint: [sx * 0.42, 1.0, 1.35] })),
      },
      bottom: { pelvis: { pos: moved(HACK.hip, s) }, ...hand(s) },
    },
  };
}

// ── Smith squat ───────────────────────────────────────────────────────────────────────────────────────────────────
function smithSquat() {
  // Feet ~13 cm in front of the bar line (z = 0), so the torso stays fairly upright; bar path is vertical.
  const foot = Object.assign([0.17, 0, 0.13], { toesOut: 8 });
  const sq = backSquat({ foot, barZ: 0, top: { lean: 4, knee: 14 }, mid: { lean: 15, y: 0.74 }, bottom: { lean: 22, y: 0.5 } });
  return {
    id: 'smith_squat',
    machine: 'smith',
    machineOpts: { barHeight: +sq.barTop.toFixed(3), kgPerSide: 20, safetyHeight: +(sq.barBottom - 0.12).toFixed(3) },
    movers: [{ part: 'bar', follow: 'handsMid', axis: [0, 1, 0] }],
    // threeQuarter: front-left, between the front upright and the plate, so the frame does not hide the body.
    camera: { target: [0, 0.98, 0.0], front: [1.4, 1.45, 3.35], side: [2.6, 1.45, -2.2], threeQuarter: [2.5, 1.65, 2.75] },
    tempo: { eccentric: 2.5, bottom: 0.4, concentric: 1.1, top: 0.6 },
    arrow: { effector: 'pelvis', offset: [0.34, 0, 0.12] },
    poses: sq.poses,
  };
}

// ── Barbell back squat (inside a power rack, safeties just under the bottom position) ────────────────────────────
function bbBackSquat() {
  // Bar stays over the mid-foot (z ≈ 0.04); hips travel back, torso leans ~40° at parallel.
  const foot = Object.assign([0.18, 0, -0.02], { toesOut: 14 });
  const sq = backSquat({ foot, barZ: 0.04, top: { lean: 6, knee: 12 }, mid: { lean: 29, y: 0.73 }, bottom: { lean: 40, y: 0.47 } });
  return {
    id: 'bb_back_squat',
    machine: 'rack',
    machineOpts: { jHeight: +(sq.barTop - 0.09).toFixed(3), safetyHeight: +(sq.barBottom - 0.1).toFixed(3) },
    props: [{ type: 'barbell', attach: 'handsMid', opts: { kgPerSide: 20 } }],
    // threeQuarter: in front of the front-left upright (the derived one looked through it).
    camera: { target: [0, 0.95, -0.05], front: [0.85, 1.45, 3.45], side: [2.8, 1.45, -2.0], threeQuarter: [1.7, 1.65, 3.1] },
    tempo: { eccentric: 2.5, bottom: 0.3, concentric: 1.2, top: 0.6 },
    arrow: { effector: 'pelvis', offset: [0.36, 0, 0.12] },
    poses: sq.poses,
  };
}

// ── 45° leg press ─────────────────────────────────────────────────────────────────────────────────────────────────
const LP_FLAT = -(90 + LEG_PRESS.face); // foot pitch with the sole flat on the foot plate
const lpHip = v3.add(LEG_PRESS.hip, [0.1, 0, 0]);
const lpBody = {
  // Hips and lower back pressed into the reclined back pad, head relaxed on it, chin slightly tucked.
  pelvis: { pos: LEG_PRESS.hip, rot: [-LEG_PRESS.recline, 0, 0] },
  spine: [0, 0, 0], chest: [0, 0, 0], neck: [12, 0, 0], head: [6, 0, 0],
  clavicle_L: [0, 0, 0], clavicle_R: [0, 0, 0],
  // Hands on the seat handles beside the hips (neutral grip, wrists unloaded).
  ...both('hand', (s) => ({ pos: [s * LEG_PRESS.grip[0], LEG_PRESS.grip[1], LEG_PRESS.grip[2]], palm: [-s, 0, 0], hint: [s * 0.42, 0.75, -0.35] })),
};

function legPress() {
  const { e } = legPressDirs();
  const sole = (s, travel) => r(legPressPlate(travel, 0, s * 0.15));
  // Lower until the knees reach ~95° (hips stay on the pad: hip flexion ≈ 120°).
  const s = travelTo(ankleOf(legPressPlate(0, 0, 0.15), LP_FLAT), v3.mul(e, -1), lpHip, legSpan(95));
  const feet = (travel) => both('foot', (sx) => ({ pos: sole(sx, travel), rot: [LP_FLAT, sx * 8, 0], hint: [sx * 0.3, 1.45, 0.05] }));
  return {
    id: 'leg_press',
    machine: 'leg_press',
    movers: [{ part: 'sled', follow: 'feetMid', axis: e }],
    camera: { target: [0, 0.82, 0.3], front: [2.75, 2.15, -1.55], side: [3.9, 1.15, 0.3] },
    tempo: { eccentric: 2.5, bottom: 0.3, concentric: 1.1, top: 0.5 },
    arrow: { effector: 'feetMid', offset: [0.36, 0, 0] },
    poses: {
      top: { ...lpBody, ...feet(0) },          // legs extended, knees soft (~17°), feet shoulder-width mid-plate
      bottom: { ...feet(-s) },
    },
  };
}

function legPressCalf() {
  const { e } = legPressDirs();
  // Balls of the feet on the lower edge of the plate, heels hang off; knees almost straight and fixed (~10°).
  // The sled position follows from the ankle angle: for heel pitch φ, find the travel that keeps the leg length.
  const ball = (s, travel) => legPressPlate(travel, -0.2, s * 0.12);
  const at = (phi) => {
    const pitch = LP_FLAT + phi;
    const tr = travelTo(ankleOf(footAt(ball(1, 0), BALL, pitch), pitch), e, lpHip, legSpan(10));
    return { pitch, tr, sole: (s) => footAt(ball(s, tr), BALL, pitch) };
  };
  const top = at(26), bot = at(-16);
  // The sled follows feetMid (sole points under the ankles) along the rails with a constant `scale`: the ball — not
  // the sole point — pushes the plate, so plate travel ≠ sole travel. Exact at both ends by construction…
  const scale = (bot.tr - top.tr) / v3.dot(v3.sub(bot.sole(1), top.sole(1)), e);
  // …and at the half-way keypose (φ = 5°): the ankle stays on the leg-length circle around the hip, at the angle
  // where the ball touches the plate at exactly the travel this linear mapping produces.
  const mid = (() => {
    const pitch = LP_FLAT + 5, toAnkle = v3.rotX([0, ANKLE_H, 0], pitch);
    const toBall = v3.rotX(v3.sub(BALL, [0, -ANKLE_H, 0]), pitch), R = Math.sqrt(legSpan(10) ** 2 - 0.02 ** 2);
    const soleAt = (ang) => v3.sub([0.12, lpHip[1] + R * Math.sin(ang), lpHip[2] + R * Math.cos(ang)], toAnkle);
    const travelOf = (sole) => top.tr + scale * v3.dot(v3.sub(sole, top.sole(1)), e);
    const gap = (ang) => { const sl = soleAt(ang); return v3.dot(v3.sub(v3.add(sl, toBall), ball(1, travelOf(sl))), legPressDirs().n); };
    const angOf = (st) => { const a = ankleOf(st.sole(1), st.pitch); return Math.atan2(a[1] - lpHip[1], a[2] - lpHip[2]); };
    const sl = soleAt(bisect(gap, angOf(bot), angOf(top)));
    return { pitch, sole: (s) => [s * sl[0], sl[1], sl[2]] };
  })();
  const feet = (st) => both('foot', (s) => ({ pos: r(st.sole(s)), rot: [st.pitch, 0, 0], hint: [s * 0.2, 1.45, 0.05] }));
  return {
    id: 'leg_press_calf',
    machine: 'leg_press',
    machineOpts: { travel: +top.tr.toFixed(4) },
    movers: [{ part: 'sled', follow: 'feetMid', axis: e, scale: +scale.toFixed(4) }],
    camera: { target: [0, 0.8, 0.38], front: [2.7, 2.05, -1.45], side: [3.7, 1.1, 0.38] },
    tempo: { eccentric: 2.0, bottom: 1.0, concentric: 1.0, top: 0.8 },  // pause in the stretch
    arrow: { effector: 'feetMid', offset: [0.34, 0, 0] },
    poses: { top: { ...lpBody, ...feet(top) }, mid: feet(mid), bottom: feet(bot) },
  };
}

// ── Leg extension ─────────────────────────────────────────────────────────────────────────────────────────────────
function legExtension() {
  const TOP = 85, BOTTOM = LEG_EXT.start;          // shin angle: almost straight ↔ knees ~93°
  // The ankle travels on an arc around the knee (= machine axis): `pivot` keeps the thigh still. Toes pulled up.
  const foot = (s, phi) => {
    const knee = v3.add(LEG_EXT.knee, [s * 0.1, 0, 0]);
    const ankle = v3.add(knee, [0, -SHIN * Math.cos(phi * D2R), SHIN * Math.sin(phi * D2R)]);
    const pitch = -phi - 12;
    return { pos: r(v3.sub(ankle, v3.rotX([0, ANKLE_H, 0], pitch))), rot: [pitch, 0, 0], hint: [s * 0.12, 1.3, 0.62], pivot: r(knee) };
  };
  return {
    id: 'leg_extension',
    machine: 'leg_extension',
    machineOpts: { angle: TOP, tracked: foot(1, TOP).pos },
    movers: trackMovers('foot_L'),
    camera: { target: [0, 0.72, 0.22], front: [2.15, 1.56, 2.45], side: [3.0, 1.06, 0.25] },
    tempo: { eccentric: 2.5, bottom: 0.3, concentric: 1.0, top: 1.0 },  // 1 s squeeze at the top
    arrow: { effector: 'foot_L', offset: [0.16, 0, 0] },
    poses: {
      top: {
        // Seated, back on the pad, knee joints on the machine axis, hands on the seat handles.
        pelvis: { pos: LEG_EXT.hip, rot: [-LEG_EXT.recline, 0, 0] },
        spine: [0, 0, 0], chest: [0, 0, 0], neck: [8, 0, 0], head: [2, 0, 0],
        ...both('hand', (s) => ({ pos: [s * LEG_EXT.grip[0], LEG_EXT.grip[1], LEG_EXT.grip[2]], palm: [-s, 0, 0], hint: [s * 0.4, 0.85, -0.35] })),
        foot_L: foot(1, TOP), foot_R: foot(-1, TOP),
      },
      bottom: { foot_L: foot(1, BOTTOM), foot_R: foot(-1, BOTTOM) },
    },
  };
}

// ── Bulgarian split squat (dumbbells, rear foot on a flat bench) ─────────────────────────────────────────────────
function bulgarianSplitSquat() {
  const zEnd = -0.56;                                  // foot end of the bench, behind the lifter
  const rear = { pitch: 172, sole: null };
  rear.sole = footAt([-0.11, BENCH_FLAT.top, zEnd - 0.09], INSTEP, rear.pitch);  // laces on the pad
  const pz = 0.0;
  const legs = splitLegs({ front: [0.12, 0, 0.36], rear, pz, yBottom: 0.56, frontFlex: 14, rearFlex: 60 });
  const lean = { top: 10, bottom: 16 };                // trunk slightly forward
  // Dumbbells hang straight under the shoulders, neutral grip (palms to the thighs), arms long.
  const hands = (pel, ln) => both('hand', (s) => {
    const sh = onTorso(pel, ln, [s * SHOULDER[0], SHOULDER[1], SHOULDER[2]]);
    return { pos: r(v3.add(sh, [s * 0.085, -0.625, 0.02])), palm: [-s, 0, 0], hint: r(v3.add(sh, [s * 0.22, -0.3, -0.45])) };
  });
  const pelTop = [0, legs.yTop, pz], pelBot = [0, legs.yBottom, pz];
  return {
    id: 'bulgarian_split_squat',
    machine: 'bench_flat',
    machineOpts: { at: [-0.11, 0, zEnd - BENCH_FLAT.zFoot] },
    props: [
      { type: 'dumbbell', attach: 'hand_L', opts: { kg: 12 } },
      { type: 'dumbbell', attach: 'hand_R', opts: { kg: 12 } },
    ],
    camera: { target: [0, 0.82, -0.12], front: [2.1, 1.45, 2.75], side: [3.4, 1.05, -0.12] },
    tempo: { eccentric: 2.5, bottom: 0.3, concentric: 1.1, top: 0.5 },
    arrow: { effector: 'pelvis', offset: [0.34, 0, 0.1] },
    poses: {
      top: {
        pelvis: { pos: r(pelTop), rot: [lean.top, 0, 0] },
        spine: [0, 0, 0], chest: [-2, 0, 0], neck: [-6, 0, 0], head: [0, 0, 0],
        clavicle_L: [0, -4, -2], clavicle_R: [0, -4, -2],
        ...hands(pelTop, lean.top), ...legs.feet,
      },
      bottom: { pelvis: { pos: r(pelBot), rot: [lean.bottom, 0, 0] }, ...hands(pelBot, lean.bottom) },
    },
  };
}

// ── Smith split squat ─────────────────────────────────────────────────────────────────────────────────────────────
function smithSplitSquat() {
  const lean = { top: 3, bottom: 6 };                 // upright trunk under the vertical bar (z = 0)
  const pz = pelvisUnderBar(lean.top, 0, 0)[2];
  const rear = { pitch: 48, sole: null };
  rear.sole = footAt([-0.12, 0, pz - 0.47], BALL, rear.pitch);    // rear foot on the ball, heel up
  const legs = splitLegs({ front: [0.12, 0, pz + 0.3], rear, pz, yBottom: 0.55, frontFlex: 14, rearFlex: 10 });
  const pelTop = pelvisUnderBar(lean.top, legs.yTop, 0), pelBot = pelvisUnderBar(lean.bottom, legs.yBottom, 0);
  return {
    id: 'smith_split_squat',
    machine: 'smith',
    machineOpts: { barHeight: +onTorso(pelTop, lean.top, TRAPS)[1].toFixed(3), kgPerSide: 15, safetyHeight: 0.62 },
    movers: [{ part: 'bar', follow: 'handsMid', axis: [0, 1, 0] }],
    camera: { target: [0, 0.92, 0.0], front: [1.4, 1.45, 3.35], side: [2.6, 1.4, -2.2], threeQuarter: [2.5, 1.6, 2.75] },
    tempo: { eccentric: 2.5, bottom: 0.3, concentric: 1.1, top: 0.5 },
    arrow: { effector: 'pelvis', offset: [0.34, 0, 0.12] },
    poses: {
      top: {
        pelvis: { pos: r(pelTop), rot: [lean.top, 0, 0] },
        spine: [0, 0, 0], chest: [0, 0, 0], neck: [-2, 0, 0], head: [0, 0, 0],
        clavicle_L: [0, -6, -2], clavicle_R: [0, -6, -2],
        ...barHands(pelTop, lean.top, 0.44), ...legs.feet,
      },
      bottom: { pelvis: { pos: r(pelBot), rot: [lean.bottom, 0, 0] }, ...barHands(pelBot, lean.bottom, 0.44) },
    },
  };
}

// ── Standing calf raise (machine) ─────────────────────────────────────────────────────────────────────────────────
function standingCalfRaise() {
  // Balls of the feet on the rear edge of the step, heels hang. Heel pitch: −22° (deep stretch) ↔ +32° (high on the
  // toes). Knees stay almost straight (~10°); the body rises straight up under the shoulder pads.
  const ball = (s) => [s * 0.11, CALF_STAND.step, CALF_STAND.edge + 0.015];
  const span = legSpan(10), TOP = 32, BOTTOM = -22, lean = 3;
  const ankle = (phi) => ankleOf(footAt(ball(1), BALL, phi), phi);
  const pz = (ankle(TOP)[2] + ankle(BOTTOM)[2]) / 2;   // legs sway ±2–3° around vertical
  const pelvisAt = (phi) => [0, hipHeight(ankle(phi), pz, span), pz];
  const pelTop = pelvisAt(TOP), pelBot = pelvisAt(BOTTOM), pelMid = pelvisAt((TOP + BOTTOM) / 2);
  const pad = onTorso(pelTop, lean, [0, 0.525, -0.02]);  // shoulder-pad underside on top of the shoulders
  const rise = pelTop[1] - pelBot[1];
  const grip = (s, dy) => r([s * CALF_STAND.grip[0], pad[1] + CALF_STAND.grip[1] + dy, pad[2] + CALF_STAND.grip[2]]);
  const hands = (dy) => both('hand', (s) => ({ pos: grip(s, dy), palm: [-s, 0, 0], hint: r([s * 0.45, pad[1] - 0.45 + dy, pad[2] - 0.1]) }));
  // The foot rolls over the ball (`pivot` = ball), so the ball stays planted on the step edge all the way.
  const feet = (phi) => both('foot', (s) => ({ pos: r(footAt(ball(s), BALL, phi)), rot: [phi, 0, 0], hint: [s * 0.14, 0.6, 1.2], pivot: ball(s) }));
  return {
    id: 'standing_calf_raise',
    machine: 'calf_raise',
    machineOpts: { padY: +pad[1].toFixed(3), padZ: +pad[2].toFixed(3), rise: +rise.toFixed(3) },
    movers: [{ part: 'carriage', follow: 'pelvis', axis: [0, 1, 0] }],
    camera: { target: [0, 1.0, 0.1], front: [2.45, 1.6, -2.85], side: [3.85, 1.15, 0.12] },
    tempo: { eccentric: 1.6, bottom: 1.0, concentric: 1.0, top: 1.0 },  // 1 s pause in the stretch and at the top
    arrow: { effector: 'pelvis', offset: [0.32, 0, 0.1] },
    poses: {
      top: {
        pelvis: { pos: r(pelTop), rot: [lean, 0, 0] },
        spine: [0, 0, 0], chest: [0, 0, 0], neck: [-3, 0, 0], head: [0, 0, 0],
        clavicle_L: [0, -2, -2], clavicle_R: [0, -2, -2],
        ...hands(0), ...feet(TOP),
      },
      // Knees keep the same bend half-way (the ankle path is an arc); hands ride up with the carriage.
      mid: { pelvis: { pos: r(pelMid) }, ...hands(pelMid[1] - pelTop[1]) },
      bottom: { pelvis: { pos: r(pelBot) }, ...hands(-rise), ...feet(BOTTOM) },
    },
  };
}

// ── Seated calf raise (plate-loaded) ──────────────────────────────────────────────────────────────────────────────
function seatedCalfRaise() {
  const H = SEATED_CALF.hip, TOP = 30, BOTTOM = -20;
  const ball = (s) => [s * 0.11, SEATED_CALF.plate, SEATED_CALF.edge + 0.015];
  // Knee for a heel pitch (sagittal plane): the thigh pivots at the fixed hip, the shin follows the ankle.
  const thigh = (phi) => {
    const a = ankleOf(footAt(ball(1), BALL, phi), phi);
    const dy = a[1] - H[1], dz = a[2] - H[2], d = Math.hypot(dy, dz);
    const ang = Math.atan2(dy, dz) + Math.acos((THIGH ** 2 + d * d - SHIN ** 2) / (2 * THIGH * d)); // knee above the line
    return { dir: [0, Math.sin(ang), Math.cos(ang)], up: [0, Math.cos(ang), -Math.sin(ang)] };
  };
  // Lever angle that rests the knee-pad underside on the quads ~8 cm behind the knee (thigh surface 5.8 cm up).
  const leverFor = (phi) => {
    const t = thigh(phi);
    const c = v3.add(v3.add(H, v3.mul(t.dir, 0.37)), v3.mul(t.up, 0.058));
    const [, A, Bn] = SEATED_CALF.pad, B = -Bn, R = Math.hypot(A, B);  // A·cosθ + B·sinθ = c.y − pivot.y
    return (Math.asin((c[1] - SEATED_CALF.pivot[1]) / R) - Math.atan2(A, B)) / D2R;
  };
  const thTop = leverFor(TOP), thBot = leverFor(BOTTOM);
  const grip = (s, th) => r(seatedCalfWorld([s * SEATED_CALF.grip[0], SEATED_CALF.grip[1], SEATED_CALF.grip[2]], th));
  const hands = (th) => both('hand', (s) => ({
    pos: grip(s, th), palm: [-s, 0, 0], hint: [s * 0.5, 0.75, -0.2],
    pivot: [s * SEATED_CALF.grip[0], SEATED_CALF.pivot[1], SEATED_CALF.pivot[2]],  // hands ride the lever arc
  }));
  const feet = (phi) => both('foot', (s) => ({ pos: r(footAt(ball(s), BALL, phi)), rot: [phi, 0, 0], hint: [s * 0.12, 1.2, 1.0], pivot: ball(s) }));
  return {
    id: 'seated_calf_raise',
    machine: 'seated_calf',
    machineOpts: { angle: +thTop.toFixed(3), tracked: grip(1, thTop) },
    movers: trackMovers('hand_L'),
    camera: { target: [0, 0.6, 0.35], front: [2.3, 1.5, -1.75], side: [3.1, 0.85, 0.4] },
    tempo: { eccentric: 2.2, bottom: 0.8, concentric: 1.0, top: 0.6 },
    arrow: { effector: 'foot_L', offset: [0.2, 0.05, -0.05] },
    poses: {
      top: {
        pelvis: { pos: H, rot: [6, 0, 0] },
        spine: [2, 0, 0], chest: [0, 0, 0], neck: [-4, 0, 0], head: [0, 0, 0],
        ...hands(thTop), ...feet(TOP),
      },
      bottom: { ...hands(thBot), ...feet(BOTTOM) },
    },
  };
}

export default [
  hackSquat(),
  smithSquat(),
  bbBackSquat(),
  legPress(),
  legPressCalf(),
  legExtension(),
  bulgarianSplitSquat(),
  smithSplitSquat(),
  standingCalfRaise(),
  seatedCalfRaise(),
];
