// Animation specs, batch "back" (vertical & horizontal pulls, back extension).
// Machines and their geometry constants live in ../machines/back.js — every pad, handle and pivot used below comes
// from there, so the figure and the equipment stay in sync. Authoring guide: ../README.md.
// Wrist care (old fracture): neutral grips wherever the exercise allows, straight wrists (the IK keeps the hand in
// line with the forearm), the support hand of the dumbbell row rests on a FIST, arms crossed on the back extension.
import { BENCH_FLAT } from '../machines/common.js';
import {
  LAT_PULLDOWN as LP, HIGH_ROW as HR, ASSIST, SEATED_ROW as SR, ROW, HYPER,
  hyperFrame, LEVER_MOVERS, leverHandle, leverPivot,
} from '../machines/back.js';

const D2R = Math.PI / 180;
const r3 = (v) => v.map((x) => +x.toFixed(3));
/** Rotate point p about the X axis through `c` by `deg` (positive = tips +Y towards +Z, like pelvis rot.x). */
function rotX(p, c, deg) {
  const a = deg * D2R, y = p[1] - c[1], z = p[2] - c[2];
  return r3([p[0], c[1] + y * Math.cos(a) - z * Math.sin(a), c[2] + y * Math.sin(a) + z * Math.cos(a)]);
}
/** Mirror a left-side point/vector to the right side. */
const mx = (v) => [-v[0], v[1], v[2]];

// ── Lat pulldown (shared body set-up) ───────────────────────────────────────────────────────────────────────────
// Seated, hip joints 0.10 above the seat, thighs under the rollers, feet flat a little in front of the knees.
const PD_PELVIS = [0, LP.seatTop + 0.1, LP.seatZ];
const PD_FEET = {
  foot_L: { pos: [0.16, 0, 0.5], rot: [0, 8, 0], hint: [0.22, 0.6, 1.2] },
  foot_R: { pos: [-0.16, 0, 0.5], rot: [0, -8, 0], hint: [-0.22, 0.6, 1.2] },
};
const PD_CAMERA = { target: [0, 1.15, 0.2], front: [3.3, 1.9, 2.25], side: [3.7, 1.45, 0.2] };
// Torso + shoulder girdle of both pulldowns. `top` = end of the pull (contracted): leaned back ~15°, chest up, shoulder
// blades down and back. `bottom` = full stretch overhead: ~8° lean, blades allowed to rise. `mid`: the shoulders are
// already depressed half-way, so the pull starts with the blades ("сначала опусти плечи"), not with the arms.
const PD_TORSO_TOP = {
  pelvis: { pos: PD_PELVIS, rot: [-15, 0, 0] },
  spine: [0, 0, 0], chest: [-7, 0, 0], neck: [6, 0, 0], head: [6, 0, 0],
};
const PD_TORSO_BOTTOM = {
  pelvis: { pos: PD_PELVIS, rot: [-8, 0, 0] },
  spine: [0, 0, 0], chest: [-3, 0, 0], neck: [-4, 0, 0], head: [-6, 0, 0],
};

// ── Iso-lateral high row: lever angle half-way through the rep (hands stay on the lever arc via `pivot`) ─────────
const HR_MID = (HR.angleTop + HR.angleBottom) / 2;

// ── Gravitron: pelvis at the top (chin clearly over the handles) and at the bottom (dead hang: shoulder → fist
// 0.63 m, i.e. straight arms with a soft elbow) ───────────────────────────────────────────────────────────────────
const PU_TOP = [0, 1.66, 0.06], PU_BOTTOM = [0, 1.05, 0.1];
/**
 * Kneeling on the gravitron pad: thighs vertical, shins along the pad, feet hanging relaxed off its back end (toes
 * pointing back and ~35° down, instep towards the floor). foot rot.x = 180 would be toes straight back, sole up; the
 * sole point sits 0.085 from the ankle along the foot's own up axis, which is rotated with the foot.
 */
const KNEEL_FOOT = 145;
function kneel(pelvis) {
  const feet = {}, a = KNEEL_FOOT * D2R;
  for (const [S, s] of [['L', 1], ['R', -1]]) {
    const ankle = [s * 0.1, pelvis[1] - 0.45, pelvis[2] - 0.43];
    const sole = [ankle[0], ankle[1] - 0.085 * Math.cos(a), ankle[2] - 0.085 * Math.sin(a)];
    feet['foot_' + S] = { pos: r3(sole), rot: [KNEEL_FOOT, 0, 0], hint: [s * 0.1, pelvis[1] - 0.5, pelvis[2] + 1] };
  }
  return feet;
}

// ── 45° back extension: arms crossed on the chest, everything rotates about the hip joint ───────────────────────
const HX = hyperFrame();
const HIP = HYPER.hip;
const HYPER_FLEX = 82; // hip flexion at the bottom (torso ~37° below horizontal)
// Sole point under the ankle on the foot platform (tilted HYPER.footTilt, same frame as the machine).
const HYPER_SOLE = [HX.ankle.y - 0.085 * Math.cos(HYPER.footTilt * D2R), HX.ankle.z - 0.085 * Math.sin(HYPER.footTilt * D2R)];
const HYPER_TOP = {
  // Arms crossed: each fist rests on the opposite upper chest, forearms across the chest (left forearm against the
  // chest, right one just outside it so they do not intersect).
  hand_L: { pos: [-0.1, 1.2, 0.43], palm: [0, 0.7, -0.7], hint: [0.35, 0.8, 0.5] },
  hand_R: { pos: [0.1, 1.18, 0.465], palm: [0, 0.7, -0.7], hint: [-0.35, 0.78, 0.52] },
};
function hyperHands(deg) {
  const out = {};
  for (const k of ['hand_L', 'hand_R']) {
    const h = HYPER_TOP[k];
    out[k] = { pos: rotX(h.pos, HIP, deg), palm: rotX(h.palm, [0, 0, 0], deg), hint: rotX(h.hint, HIP, deg), pivot: HIP };
  }
  return out;
}

export default [
  {
    // ── Lat pulldown, close neutral V-grip ──────────────────────────────────────────────────────────────────────
    // Thighs locked under the rollers, torso leaned back ~10° (15° at the bottom), chest up. Start from a full stretch
    // (shoulder blades allowed to rise), first depress the shoulders, then drive the elbows down and back until the
    // handle reaches the upper chest. Neutral grip (palms facing) — the most wrist-friendly pulldown.
    id: 'lat_pulldown_neutral',
    machine: 'lat_pulldown',
    props: [{ type: 'v_handle', attach: 'handsMid' }],
    cables: [{ from: 'pulley', to: 'handsMid' }],
    camera: PD_CAMERA,
    tempo: { eccentric: 2.5, bottom: 0.5, concentric: 1.1, top: 0.5 },
    arrow: { effector: 'handsMid', offset: [0.3, 0, 0.05] },
    poses: {
      top: {
        // Handle at the upper chest, elbows down beside the ribs.
        ...PD_TORSO_TOP,
        clavicle_L: [0, -6, -4], clavicle_R: [0, -6, -4],
        hand_L: { pos: [0.06, 1.0, 0.065], palm: [-1, 0, 0], hint: [0.35, 0.7, -0.2] },
        hand_R: { pos: [-0.06, 1.0, 0.065], palm: [1, 0, 0], hint: [-0.35, 0.7, -0.2] },
        ...PD_FEET,
      },
      mid: { clavicle_L: [0, -3, -2], clavicle_R: [0, -3, -2] },
      bottom: {
        // Arms straight overhead under the pulley.
        ...PD_TORSO_BOTTOM,
        clavicle_L: [0, 4, 7], clavicle_R: [0, 4, 7],
        hand_L: { pos: [0.06, 1.66, 0.0], palm: [-1, 0, 0], hint: [0.45, 1.45, 0.35] },
        hand_R: { pos: [-0.06, 1.66, 0.0], palm: [1, 0, 0], hint: [-0.45, 1.45, 0.35] },
      },
    },
  },
  {
    // ── Lat pulldown, wide overhand bar ─────────────────────────────────────────────────────────────────────────
    // Overhand grip ~1.5× shoulder width (hands inside the bar's bends, not wider), wrists straight. Pull the bar to
    // the upper chest in front of the face, squeezing the shoulder blades; elbows travel down to the ribs.
    id: 'lat_pulldown_wide',
    machine: 'lat_pulldown',
    props: [{ type: 'lat_bar', attach: 'handsMid' }],
    cables: [{ from: 'pulley', to: 'handsMid' }],
    camera: PD_CAMERA,
    tempo: { eccentric: 2.5, bottom: 0.5, concentric: 1.1, top: 0.5 },
    arrow: { effector: 'hand_L', offset: [0.14, 0, 0] },
    poses: {
      top: {
        // Bar at the upper chest (in front of the collarbones, not the chin), forearms about vertical under it.
        ...PD_TORSO_TOP,
        clavicle_L: [0, -8, -4], clavicle_R: [0, -8, -4],
        hand_L: { pos: [0.34, 1.0, 0.06], palm: [0, 0, 1], hint: [0.6, 0.6, -0.15] },
        hand_R: { pos: [-0.34, 1.0, 0.06], palm: [0, 0, 1], hint: [-0.6, 0.6, -0.15] },
        ...PD_FEET,
      },
      mid: { clavicle_L: [0, -4, -2], clavicle_R: [0, -4, -2] },
      bottom: {
        ...PD_TORSO_BOTTOM,
        clavicle_L: [0, 2, 7], clavicle_R: [0, 2, 7],
        hand_L: { pos: [0.34, 1.63, -0.02], palm: [0, 0, 1], hint: [0.85, 1.45, -0.1] },
        hand_R: { pos: [-0.34, 1.63, -0.02], palm: [0, 0, 1], hint: [-0.85, 1.45, -0.1] },
      },
    },
  },
  {
    // ── Iso-lateral high row (plate-loaded) ─────────────────────────────────────────────────────────────────────
    // Seated, thighs under the roller, chest up with a slight forward lean. From a stretch with the arms reaching up
    // and forward, depress the shoulders and pull the neutral handles down and back on the lever arc, elbows to the
    // sides. Hands use `pivot` = lever pivot, so the fists stay on the handles through the whole arc.
    id: 'iso_high_row',
    machine: 'high_row',
    movers: LEVER_MOVERS,
    // Default view from behind-left: the levers and plates are in front of the lifter, the lats are on show.
    camera: { target: [0, 1.15, 0.35], front: [2.6, 2.0, -2.5], side: [4.0, 1.45, 0.45] },
    tempo: { eccentric: 2.5, bottom: 0.5, concentric: 1.1, top: 0.5 },
    arrow: { effector: 'hand_L', offset: [0.12, 0, 0] },
    poses: {
      top: {
        // End of the pull: handles beside the lower chest, elbows behind the torso, blades down and back.
        pelvis: { pos: [0, HR.seatTop + 0.1, HR.seatZ], rot: [6, 0, 0] },
        spine: [0, 0, 0], chest: [-7, 0, 0], neck: [-4, 0, 0], head: [-2, 0, 0],
        clavicle_L: [0, -8, -4], clavicle_R: [0, -8, -4],
        hand_L: { pos: leverHandle(HR, HR.angleTop, 1), palm: [-1, 0, 0], hint: [0.38, 0.65, -0.35], pivot: leverPivot(HR, 1) },
        hand_R: { pos: leverHandle(HR, HR.angleTop, -1), palm: [1, 0, 0], hint: [-0.38, 0.65, -0.35], pivot: leverPivot(HR, -1) },
        foot_L: { pos: [0.17, 0, 0.5], rot: [0, 8, 0], hint: [0.22, 0.6, 1.2] },
        foot_R: { pos: [-0.17, 0, 0.5], rot: [0, -8, 0], hint: [-0.22, 0.6, 1.2] },
      },
      mid: {
        // Half-way along the arc the elbows drive DOWN and slightly forward (not flared out to the sides).
        hand_L: { pos: leverHandle(HR, HR_MID, 1), palm: [-1, 0, 0], hint: [0.33, 0.75, 0.3], pivot: leverPivot(HR, 1) },
        hand_R: { pos: leverHandle(HR, HR_MID, -1), palm: [1, 0, 0], hint: [-0.33, 0.75, 0.3], pivot: leverPivot(HR, -1) },
      },
      bottom: {
        // Stretch: arms reaching up and forward to the handles, shoulder blades allowed to rise and spread.
        chest: [-4, 0, 0],
        clavicle_L: [0, 6, 6], clavicle_R: [0, 6, 6],
        hand_L: { pos: leverHandle(HR, HR.angleBottom, 1), palm: [-1, 0, 0], hint: [0.42, 1.3, 0.5], pivot: leverPivot(HR, 1) },
        hand_R: { pos: leverHandle(HR, HR.angleBottom, -1), palm: [1, 0, 0], hint: [-0.42, 1.3, 0.5], pivot: leverPivot(HR, -1) },
      },
    },
  },
  {
    // ── Assisted pull-up (gravitron) ────────────────────────────────────────────────────────────────────────────
    // Kneeling on the pad, neutral handles. The hands stay on the handles; the BODY moves: from a dead hang with
    // straight arms (2–3 s down) pull the chest up until the chin clears the handles, shoulders kept down, slight
    // lean back at the top. The pad follows the pelvis; the counterweight stack drops as the lifter rises.
    id: 'assisted_pullup',
    machine: 'assisted_pullup',
    machineOpts: { padTop: PU_TOP[1] - 0.45 - 0.052 }, // knee pad under the knees at the top pose
    movers: [
      { part: 'platform', follow: 'pelvis', axis: [0, 1, 0] },
      { part: 'stack', follow: 'pelvis', axis: [0, 1, 0], scale: -0.5 },
    ],
    // Default view from behind-left (the stack and columns are in front of the lifter; the lats are on show).
    camera: { target: [0, 1.5, 0.1], front: [2.6, 2.1, -2.95], side: [3.9, 1.6, 0.1] },
    tempo: { eccentric: 2.5, bottom: 0.4, concentric: 1.2, top: 0.5 },
    arrow: { effector: 'chest', offset: [0.32, 0, 0] },
    poses: {
      top: {
        pelvis: { pos: PU_TOP, rot: [-8, 0, 0] },
        spine: [-2, 0, 0], chest: [-4, 0, 0], neck: [-2, 0, 0], head: [0, 0, 0],
        clavicle_L: [0, -6, -4], clavicle_R: [0, -6, -4],
        hand_L: { pos: ASSIST.handle, palm: [-1, 0, 0], hint: [0.45, 1.6, 0.35] },
        hand_R: { pos: mx(ASSIST.handle), palm: [1, 0, 0], hint: [-0.45, 1.6, 0.35] },
        ...kneel(PU_TOP),
      },
      bottom: {
        pelvis: { pos: PU_BOTTOM, rot: [0, 0, 0] },
        spine: [0, 0, 0], chest: [0, 0, 0], neck: [-2, 0, 0], head: [0, 0, 0],
        clavicle_L: [0, 2, 6], clavicle_R: [0, 2, 6],
        hand_L: { pos: ASSIST.handle, palm: [-1, 0, 0], hint: [0.6, 1.9, 0.2] },
        hand_R: { pos: mx(ASSIST.handle), palm: [1, 0, 0], hint: [-0.6, 1.9, 0.2] },
        ...kneel(PU_BOTTOM),
      },
    },
  },
  {
    // ── Seated cable row, V-handle ──────────────────────────────────────────────────────────────────────────────
    // Feet on the plates, knees slightly bent, neutral spine. Pull the handle to the belly with the elbows along the
    // body and the shoulder blades squeezed; return slowly letting the blades spread and the torso tip ~10° forward
    // (no rounding, no swinging back).
    id: 'seated_cable_row',
    machine: 'seated_row',
    props: [{ type: 'v_handle', attach: 'handsMid' }],
    cables: [{ from: 'pulley', to: 'handsMid' }],
    camera: { target: [0, 0.75, 0.4], front: [3.1, 1.6, 1.75], side: [3.3, 1.15, 0.45] },
    tempo: { eccentric: 2.5, bottom: 0.4, concentric: 1.1, top: 0.6 },
    arrow: { effector: 'handsMid', offset: [0.28, 0, 0] },
    poses: {
      top: {
        pelvis: { pos: [0, SR.seatTop + 0.1, 0], rot: [-3, 0, 0] },
        spine: [0, 0, 0], chest: [-4, 0, 0], neck: [3, 0, 0], head: [4, 0, 0],
        clavicle_L: [0, -9, -3], clavicle_R: [0, -9, -3],
        hand_L: { pos: [0.06, 0.76, 0.2], palm: [-1, 0, 0], hint: [0.3, 0.75, -0.5] },
        hand_R: { pos: [-0.06, 0.76, 0.2], palm: [1, 0, 0], hint: [-0.3, 0.75, -0.5] },
        foot_L: { pos: SR.foot, rot: [-SR.footTilt, 0, 0], hint: [0.25, 1.1, 0.6] },
        foot_R: { pos: mx(SR.foot), rot: [-SR.footTilt, 0, 0], hint: [-0.25, 1.1, 0.6] },
      },
      bottom: {
        pelvis: { pos: [0, SR.seatTop + 0.1, 0], rot: [11, 0, 0] },
        chest: [-2, 0, 0], neck: [-4, 0, 0], head: [0, 0, 0],
        clavicle_L: [0, 10, 1], clavicle_R: [0, 10, 1],
        hand_L: { pos: [0.06, 0.8, 0.665], palm: [-1, 0, 0], hint: [0.45, 0.45, 0.45] },
        hand_R: { pos: [-0.06, 0.8, 0.665], palm: [1, 0, 0], hint: [-0.45, 0.45, 0.45] },
      },
    },
  },
  {
    // ── Chest-supported machine row (plate-loaded, vertical handles) ────────────────────────────────────────────
    // Chest stays on the pad the whole set. From straight arms with the shoulder blades spread, pull the vertical
    // handles back on the lever arc until the elbows pass the torso and the blades are squeezed.
    id: 'machine_row',
    machine: 'row',
    movers: LEVER_MOVERS,
    // Default view from behind-left (towers and levers are in front of the lifter).
    camera: { target: [0, 1.0, 0.2], front: [2.8, 2.05, -2.6], side: [3.7, 1.4, 0.25] },
    tempo: { eccentric: 2.5, bottom: 0.4, concentric: 1.1, top: 0.6 },
    arrow: { effector: 'hand_L', offset: [0.12, 0, 0] },
    poses: {
      top: {
        pelvis: { pos: [0, ROW.seatTop + 0.1, ROW.seatZ + 0.02], rot: [8, 0, 0] },
        spine: [0, 0, 0], chest: [-4, 0, 0], neck: [-6, 0, 0], head: [-2, 0, 0],
        clavicle_L: [0, -10, -3], clavicle_R: [0, -10, -3],
        hand_L: { pos: leverHandle(ROW, ROW.angleTop, 1), palm: [-1, 0, 0], hint: [0.45, 0.9, -0.5], pivot: leverPivot(ROW, 1) },
        hand_R: { pos: leverHandle(ROW, ROW.angleTop, -1), palm: [1, 0, 0], hint: [-0.45, 0.9, -0.5], pivot: leverPivot(ROW, -1) },
        foot_L: { pos: [0.17, 0, 0.45], rot: [0, 8, 0], hint: [0.22, 0.6, 1.2] },
        foot_R: { pos: [-0.17, 0, 0.45], rot: [0, -8, 0], hint: [-0.22, 0.6, 1.2] },
      },
      bottom: {
        clavicle_L: [0, 10, 0], clavicle_R: [0, 10, 0],
        hand_L: { pos: leverHandle(ROW, ROW.angleBottom, 1), palm: [-1, 0, 0], hint: [0.5, 0.6, 0.35], pivot: leverPivot(ROW, 1) },
        hand_R: { pos: leverHandle(ROW, ROW.angleBottom, -1), palm: [1, 0, 0], hint: [-0.5, 0.6, 0.35], pivot: leverPivot(ROW, -1) },
      },
    },
  },
  {
    // ── One-arm dumbbell row, supported ─────────────────────────────────────────────────────────────────────────
    // Right knee and right FIST on a flat bench (fist, not an open palm — keeps the old wrist fracture out of
    // extension), left foot on the floor, back flat and almost parallel to the floor, no twisting. The left hand rows
    // the dumbbell (neutral grip) along an arc towards the hip, elbow close to the body; 2 s down to a full stretch.
    id: 'db_row',
    machine: 'bench_flat',
    machineOpts: { at: [-0.16, 0, 0.32] },
    props: [{ type: 'dumbbell', attach: 'hand_L', opts: { kg: 22 } }],
    camera: { target: [0, 0.75, 0.2], front: [1.3, 1.5, 2.75], side: [3.1, 1.2, 0.85] },
    tempo: { eccentric: 2.0, bottom: 0.4, concentric: 1.0, top: 0.5 },
    arrow: { effector: 'hand_L', offset: [0.13, 0, 0] },
    poses: {
      top: {
        pelvis: { pos: [0.0, 0.945, 0.0], rot: [79, 0, 0] },
        spine: [-2, 0, 0], chest: [-2, 0, 0], neck: [-26, 0, 0], head: [-12, 0, 0],
        clavicle_L: [0, -10, -2], clavicle_R: [0, 0, 0],
        // Dumbbell beside the hip, just outside the thigh (the rear head must clear the hip and thigh).
        hand_L: { pos: [0.29, 0.9, 0.19], palm: [-1, 0, 0], hint: [0.35, 1.3, -0.25] },
        hand_R: { pos: [-0.2, BENCH_FLAT.top + 0.045, 0.58], palm: [1, 0, 0], hint: [-0.45, 0.8, 0.75] },
        foot_L: { pos: [0.3, 0, 0.0], rot: [0, 10, 0], hint: [0.4, 0.5, 1.1] },
        // Right shin lies along the pad, instep down, toes just past the bench end.
        foot_R: { pos: [-0.12, BENCH_FLAT.top + 0.125, -0.4], rot: [172, 0, 0], hint: [-0.12, 0.3, 1] },
      },
      mid: {
        hand_L: { pos: [0.26, 0.66, 0.4], palm: [-1, 0, 0], hint: [0.4, 1.0, -0.1] },
      },
      bottom: {
        clavicle_L: [0, 8, -4],
        hand_L: { pos: [0.22, 0.44, 0.5], palm: [-1, 0, 0], hint: [0.5, 0.6, 0.3] },
      },
    },
  },
  {
    // ── 45° back extension ──────────────────────────────────────────────────────────────────────────────────────
    // Hip pads under the hip bones (top edge at the crease so the hips can fold), heels under the roller, arms crossed
    // on the chest. Lower by flexing at the HIPS with a neutral spine; rise only to a straight line with the legs —
    // no lumbar hyperextension at the top. All upper-body points rotate about the hip joint (`pivot`).
    id: 'back_extension',
    machine: 'hyperextension',
    camera: { target: [0, 0.85, 0.15], front: [2.4, 1.6, 2.4], side: [3.4, 1.2, 0.15] },
    tempo: { eccentric: 2.2, bottom: 0.3, concentric: 1.2, top: 0.6 },
    arrow: { effector: 'chest', offset: [0.3, 0, 0] },
    poses: {
      top: {
        pelvis: { pos: HIP, rot: [HYPER.incline, 0, 0] },
        spine: [0, 0, 0], chest: [0, 0, 0], neck: [-4, 0, 0], head: [0, 0, 0],
        clavicle_L: [0, 4, 0], clavicle_R: [0, 4, 0],
        ...hyperHands(0),
        foot_L: { pos: r3([0.1, ...HYPER_SOLE]), rot: [HYPER.footTilt, 4, 0], hint: [0.12, 0.3, 1.2] },
        foot_R: { pos: r3([-0.1, ...HYPER_SOLE]), rot: [HYPER.footTilt, -4, 0], hint: [-0.12, 0.3, 1.2] },
      },
      bottom: {
        pelvis: { pos: HIP, rot: [HYPER.incline + HYPER_FLEX, 0, 0] },
        neck: [-2, 0, 0],
        ...hyperHands(HYPER_FLEX),
      },
    },
  },
];
