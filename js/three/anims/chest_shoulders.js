// Animation specs, batch "chest_shoulders" (presses, flyes, raises on benches/machines for chest & delts).
// REFERENCE SPEC: db_bench_press — copy its structure. Authoring guide with all numbers: ../README.md.
// Machine geometry (pivots, seats, handle paths) comes from ../machines/chest_shoulders.js so poses and moving parts
// share one source of truth. Machines with rotating arms are driven by the left hand: `movers: driveMovers()` +
// `machineOpts.hand` (= the left fist at the top pose) and `handRest` (= at the bottom pose, where the stack rests).
// Wrist care everywhere: straight wrists (the IK keeps the hand in line with the forearm), neutral or semi-neutral
// grips wherever the equipment allows; barbell/Smith presses use a pronated grip with the bar over the forearm.
import { BENCH_FLAT, adjustableBenchPelvis } from '../machines/common.js';
import {
  SMITH_INCLINE, CHEST_PRESS, chestPressHand, PEC_DECK, pecDeckHand, SHOULDER_PRESS, shoulderPressHand,
  LATERAL_RAISE, lateralRaiseHand, seatedShoulder, driveMovers,
} from '../machines/chest_shoulders.js';

const BT = BENCH_FLAT.top; // 0.45 — top surface of the flat-bench pad

/** Mirror a left-side point to the right side (x → −x). */
const mx = ([x, y, z]) => [-x, y, z];
/** Shift a point along Z. */
const dz = ([x, y, z], d) => [x, y, z + d];

// Lying on a flat bench (README "lying"): shoulder joints ≈ (±0.20, 0.524, −0.248) with the pelvis at z = 0.2.
const LYING = {
  pelvis: { pos: [0, BT + 0.12, 0.2], rot: [-84, 0, 0] },
  spine: [-6, 0, 0], chest: [0, 0, 0], neck: [-6, 0, 0], head: [0, 0, 0],
  clavicle_L: [0, -6, -4], clavicle_R: [0, -6, -4],            // shoulder blades pinned: retracted & down
  foot_L: { pos: [0.3, 0, 0.74], rot: [0, 12, 0], hint: [0.55, 1.1, 0.95] },
  foot_R: { pos: [-0.3, 0, 0.74], rot: [0, -12, 0], hint: [-0.55, 1.1, 0.95] },
};
/** The lying base pose moved along Z (benches shifted under a Smith bar). */
function lyingAt(d) {
  return {
    ...LYING,
    pelvis: { ...LYING.pelvis, pos: dz(LYING.pelvis.pos, d) },
    foot_L: { ...LYING.foot_L, pos: dz(LYING.foot_L.pos, d) },
    foot_R: { ...LYING.foot_R, pos: dz(LYING.foot_R.pos, d) },
  };
}
/** Seated base pose: hip joint at `pelvis`, trunk reclined by `recline` degrees, feet flat in front. */
function seatedBase(pelvis, recline, feetZ, feetX = 0.2) {
  return {
    pelvis: { pos: pelvis, rot: [-recline, 0, 0] },
    spine: [0, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0],
    foot_L: { pos: [feetX, 0, feetZ], rot: [0, 8, 0], hint: [feetX + 0.1, 0.5, 1.2] },
    foot_R: { pos: [-feetX, 0, feetZ], rot: [0, -8, 0], hint: [-feetX - 0.1, 0.5, 1.2] },
  };
}

// ── Barbell bench press: bar over the shoulders → touching the lower chest. ───────────────────────────────────────
// Grip ±0.34 (≈ 1.5 × shoulder width): the narrowest grip at which the forearms stay vertical in the front view
// at the bottom ("bar over the elbows") with the elbows ~45° from the torso. Measured on the lying figure: the
// sternum surface is at y ≈ 0.695 at z = −0.12, so the bar (r 0.014) touches it at y = 0.71. The bottom elbow
// pole points down and towards the feet so the elbow ends up right under the bar.
const BB_X = 0.34;
const BB_TOP = [BB_X, 1.13, -0.25], BB_BOTTOM = [BB_X, 0.71, -0.12];
const BB_HINT_BOTTOM = [0.48, -0.1, 0.28];

// ── Smith flat: bench shifted so the vertical bar path meets the lower chest (bar rails at z = 0). ───────────────
const SMITH_FLAT_DZ = 0.12;
const SM_TOP = [BB_X, 1.12, 0], SM_BOTTOM = [BB_X, 0.71, 0];

// ── Incline (30°) on the adjustable bench; the Smith version shifts bench + lifter by SMITH_INCLINE.benchZ. ──────
// Bar on the upper chest (surface y ≈ 0.875 at z = 0) → touch at 0.89; grip ±0.37 keeps the forearms vertical
// under the bar with the elbows ~40° from the inclined torso; lockout at 0.62 m from the shoulder (soft elbows).
const INC = adjustableBenchPelvis(30);                         // hip joint; shoulders ≈ (±0.2, 0.758, −0.38)
const SI_X = 0.37;
const SI_TOP = [SI_X, 1.33, 0], SI_BOTTOM = [SI_X, 0.89, 0];

// ── Seated upright (85°) for the dumbbell shoulder press; shoulders ≈ (±0.2, 1.063, 0.062). ────────────────────
const UPRIGHT = adjustableBenchPelvis(85);

// ── Machines ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Bottom (−5°): the handles just in front of the chest line, elbows a little behind the torso (light stretch, not
// the elbows driven behind the back pad); top (18°): 0.60 m from the shoulder, soft elbows.
const CP_TOP = chestPressHand(18), CP_BOTTOM = chestPressHand(-5);
const CP_PIVOT = [CHEST_PRESS.handX, CHEST_PRESS.pivotY, CHEST_PRESS.pivotZ];

// Arm radius 0.61 with the handles 8 cm below the shoulders → fist 0.615 m from the shoulder = elbows bent ~35°
// and fixed ("hug a tree"). Top: fists 12 cm apart in front of the chest; bottom: arms ~78° out (moderate stretch).
const PD_SH = seatedShoulder(PEC_DECK.pelvis, PEC_DECK.recline);
const PD = { pivotZ: PD_SH[2], r: 0.61, handY: 0.96 };
const PD_TOP = pecDeckHand(-13.3, 1, PD), PD_BOTTOM = pecDeckHand(78, 1, PD);

// Rear-delt fly: the lifter faces −Z with the chest on the pad, so its LEFT hand is on the −X side. Long arms:
// radius 0.625 at shoulder height = elbows bent only ~25°. Bottom: handles straight ahead of the shoulders (ψ 180°),
// top: arms in line with the body (ψ 90°).
const RPD_PELVIS = [0, PEC_DECK.pelvis[1], 0.045], RPD_LEAN = 8;
const RPD = { pivotZ: 0.017, r: 0.625, handY: 1.0 };
const RPD_TOP = pecDeckHand(90, -1, RPD), RPD_BOTTOM = pecDeckHand(180, -1, RPD);

// Bottom (−8.5°): handles at chin height; top (26°): 0.63 m from the shoulder = almost straight arms.
const SP_TOP = shoulderPressHand(26), SP_BOTTOM = shoulderPressHand(-8.5);
const SP_PIVOT = [SHOULDER_PRESS.handX, SHOULDER_PRESS.pivotY, SHOULDER_PRESS.pivotZ];

const LR_SH = seatedShoulder(LATERAL_RAISE.pelvis, 0);
const LR_TOP = lateralRaiseHand(88), LR_BOTTOM = lateralRaiseHand(15);
const LR_PIVOT = [0.2, LR_SH[1], LR_TOP[2]];                    // on the arm axis, level with the fists
/** Palm of the left hand at abduction α: medial at 0°, turning down as the arm rises (rotates with the arm). */
const lrPalm = (a) => [-Math.cos(a * Math.PI / 180), -Math.sin(a * Math.PI / 180), 0];
/** Elbow pole for the left arm at abduction α: below/behind the elbow, in the plane of rotation. */
const lrHint = (a) => {
  const r = a * Math.PI / 180;
  return [0.2 + 0.6 * Math.sin(r), LR_SH[1] - 0.6 * Math.cos(r), LR_SH[2] - 0.2];
};

export default [
  {
    // ── Dumbbell bench press (REFERENCE) ────────────────────────────────────────────────────────────────────────
    // Lying supine on a flat bench (bench runs along Z, head towards −Z). Pelvis rot.x = −90° turns the standing
    // figure onto its back: head → −Z, chest faces +Y. A small lumbar arch = pelvis −84° and spine −6° (extension),
    // so the hips and upper back touch the pad and the lower back lifts slightly. Feet flat on the floor, knees
    // ~90° and pushed out. Wrist care: semi-neutral grip (palms 45° towards each other), wrists stay straight —
    // the IK keeps the hand in line with the forearm, `palm` only rotates it.
    id: 'db_bench_press',
    machine: 'bench_flat',
    props: [
      { type: 'dumbbell', attach: 'hand_L', opts: { kg: 20 } },
      { type: 'dumbbell', attach: 'hand_R', opts: { kg: 20 } },
    ],
    camera: { target: [0, 0.7, -0.05], front: [2.0, 1.55, 1.6], side: [2.75, 0.95, -0.05] },
    tempo: { eccentric: 2.2, bottom: 0.35, concentric: 1.0, top: 0.6 },
    arrow: { effector: 'hand_L', offset: [0.14, 0, 0] },
    poses: {
      top: {
        // Hip joint 0.12 above the pad: lying pelvis height = BT + 0.12 (see README "lying").
        pelvis: { pos: [0, BT + 0.12, 0.2], rot: [-84, 0, 0] },
        spine: [-6, 0, 0], chest: [0, 0, 0], neck: [-6, 0, 0], head: [0, 0, 0],
        clavicle_L: [0, -6, -4], clavicle_R: [0, -6, -4],            // shoulder blades pinned: retracted & down
        // Dumbbells over the shoulders, not touching; elbows almost locked (soft).
        hand_L: { pos: [0.15, 1.15, -0.27], palm: [-0.7, 0, 0.7], hint: [0.6, 0.55, -0.1] },
        hand_R: { pos: [-0.15, 1.15, -0.27], palm: [0.7, 0, 0.7], hint: [-0.6, 0.55, -0.1] },
        foot_L: { pos: [0.3, 0, 0.74], rot: [0, 12, 0], hint: [0.55, 1.1, 0.95] },
        foot_R: { pos: [-0.3, 0, 0.74], rot: [0, -12, 0], hint: [-0.55, 1.1, 0.95] },
      },
      bottom: {
        // Handles level with the lower chest (sternum surface y ≈ 0.695 at z = −0.12), forearms vertical in the front
        // view, elbows ~50° from the torso and a little below the bench top. The elbow pole points down and towards
        // the feet so the elbow lands right under the dumbbell (not flared to 70°+).
        hand_L: { pos: [0.36, 0.7, -0.12], palm: [-0.7, 0, 0.7], hint: [0.52, -0.08, 0.21] },
        hand_R: { pos: [-0.36, 0.7, -0.12], palm: [0.7, 0, 0.7], hint: [-0.52, -0.08, 0.21] },
      },
    },
  },

  {
    // ── Barbell bench press ─────────────────────────────────────────────────────────────────────────────────────
    // Olympic bench with uprights: eyes under the racked bar, shoulder blades pinned, small arch, feet planted.
    // Pronated grip a little wider than the shoulders; the bar sits on the heel of the palm over the forearm bones
    // (straight wrist, palms face the feet). Lowered in 2.5 s to the lower chest with the forearms vertical and the
    // elbows ~45° from the torso, light touch without a bounce, pressed up and slightly back over the shoulders.
    id: 'bb_bench_press',
    machine: 'bench_rack',
    props: [{ type: 'barbell', attach: 'handsMid', opts: { kgPerSide: 20 } }],
    // Side camera high enough to look over the 20 kg plate at the bar touching the chest.
    camera: { target: [0, 0.78, -0.15], front: [2.1, 1.6, 1.65], side: [2.35, 2.3, 0.85] },
    tempo: { eccentric: 2.5, bottom: 0.3, concentric: 1.0, top: 0.6 },
    arrow: { effector: 'hand_L', offset: [0.1, 0, 0.06] },
    poses: {
      top: {
        ...LYING,
        hand_L: { pos: BB_TOP, palm: [0, 0, 1], hint: [0.6, 0.5, -0.1] },
        hand_R: { pos: mx(BB_TOP), palm: [0, 0, 1], hint: [-0.6, 0.5, -0.1] },
      },
      bottom: {
        hand_L: { pos: BB_BOTTOM, palm: [0, 0, 1], hint: BB_HINT_BOTTOM },
        hand_R: { pos: mx(BB_BOTTOM), palm: [0, 0, 1], hint: mx(BB_HINT_BOTTOM) },
      },
    },
  },

  {
    // ── Smith machine bench press ───────────────────────────────────────────────────────────────────────────────
    // The bench is placed so the fixed vertical bar path ends on the lower chest (not the neck); at lockout the
    // bar is therefore a little in front of the shoulders. Same lying set-up and pronated straight-wrist grip as
    // the barbell press. The Smith bar is a machine part moved by the hands (mover on handsMid).
    id: 'smith_bench_press',
    machine: 'smith_bench',
    machineOpts: { benchZ: SMITH_FLAT_DZ, barHeight: SM_TOP[1], kgPerSide: 7.5, safetyHeight: 0.6 },
    movers: [{ part: 'bar', follow: 'handsMid', axis: [0, 1, 0] }],
    // Side camera off the rail plane (z = 0) so the guide rod does not hide the bar touching the chest.
    camera: { target: [0, 0.8, -0.05], front: [1.3, 2.2, 3.0], side: [2.45, 1.65, 0.75], threeQuarter: [1.6, 2.4, 2.1] },
    tempo: { eccentric: 2.5, bottom: 0.3, concentric: 1.0, top: 0.6 },
    arrow: { effector: 'hand_L', offset: [0.1, 0, 0.07] },
    poses: {
      top: {
        ...lyingAt(SMITH_FLAT_DZ),
        hand_L: { pos: SM_TOP, palm: [0, 0, 1], hint: [0.6, 0.5, 0.02] },
        hand_R: { pos: mx(SM_TOP), palm: [0, 0, 1], hint: [-0.6, 0.5, 0.02] },
      },
      bottom: {
        hand_L: { pos: SM_BOTTOM, palm: [0, 0, 1], hint: dz(BB_HINT_BOTTOM, SMITH_FLAT_DZ) },
        hand_R: { pos: mx(SM_BOTTOM), palm: [0, 0, 1], hint: mx(dz(BB_HINT_BOTTOM, SMITH_FLAT_DZ)) },
      },
    },
  },

  {
    // ── Incline dumbbell press (30°) ────────────────────────────────────────────────────────────────────────────
    // Back pad at 30°, hips at the base of the pad, shoulder blades pinned, feet flat. Semi-neutral grip (~45°).
    // Dumbbells pressed to over the collarbones, lowered in 2.5 s to beside the upper chest with the forearms
    // vertical and the elbows ~45° from the torso.
    id: 'incline_db_press',
    machine: 'bench_adjustable',
    machineOpts: { incline: 30 },
    props: [
      { type: 'dumbbell', attach: 'hand_L', opts: { kg: 16 } },
      { type: 'dumbbell', attach: 'hand_R', opts: { kg: 16 } },
    ],
    camera: { target: [0, 0.82, -0.1], front: [2.35, 1.8, 2.0], side: [2.9, 1.1, -0.05] },
    tempo: { eccentric: 2.5, bottom: 0.3, concentric: 1.0, top: 0.6 },
    arrow: { effector: 'hand_L', offset: [0.14, 0, 0] },
    poses: {
      top: {
        pelvis: INC, spine: [-4, 0, 0], chest: [0, 0, 0], neck: [-4, 0, 0], head: [0, 0, 0],
        clavicle_L: [0, -5, -4], clavicle_R: [0, -5, -4],
        hand_L: { pos: [0.15, 1.36, -0.35], palm: [-0.7, 0, 0.7], hint: [0.6, 0.75, -0.3] },
        hand_R: { pos: [-0.15, 1.36, -0.35], palm: [0.7, 0, 0.7], hint: [-0.6, 0.75, -0.3] },
        foot_L: { pos: [0.27, 0, 0.6], rot: [0, 10, 0], hint: [0.4, 0.6, 1.2] },
        foot_R: { pos: [-0.27, 0, 0.6], rot: [0, -10, 0], hint: [-0.4, 0.6, 1.2] },
      },
      bottom: {
        // Handles level with the upper chest (surface y ≈ 0.875 at z = −0.30); forearms vertical under the bells,
        // elbows ~45° from the inclined torso.
        hand_L: { pos: [0.38, 0.89, -0.3], palm: [-0.7, 0, 0.7], hint: [0.56, 0.03, -0.03] },
        hand_R: { pos: [-0.38, 0.89, -0.3], palm: [0.7, 0, 0.7], hint: [-0.56, 0.03, -0.03] },
      },
    },
  },

  {
    // ── Smith incline press (30°) ───────────────────────────────────────────────────────────────────────────────
    // Adjustable bench at 30° shifted under the Smith so the vertical bar path meets the upper chest just below the
    // collarbones (never the neck). Pronated straight-wrist grip a bit wider than the shoulders, elbows under the bar.
    id: 'smith_incline_press',
    machine: 'smith_incline',
    machineOpts: { barHeight: SI_TOP[1], kgPerSide: 7.5, safetyHeight: 0.8 },
    movers: [{ part: 'bar', follow: 'handsMid', axis: [0, 1, 0] }],
    camera: { target: [0, 0.98, 0.0], front: [1.3, 2.3, 3.1], side: [2.5, 1.85, 0.75], threeQuarter: [1.6, 2.6, 2.1] },
    tempo: { eccentric: 2.5, bottom: 0.3, concentric: 1.0, top: 0.6 },
    arrow: { effector: 'hand_L', offset: [0.1, 0, 0.07] },
    poses: {
      top: {
        pelvis: { pos: dz(INC.pos, SMITH_INCLINE.benchZ), rot: INC.rot },
        spine: [-4, 0, 0], chest: [0, 0, 0], neck: [-4, 0, 0], head: [0, 0, 0],
        clavicle_L: [0, -5, -4], clavicle_R: [0, -5, -4],
        hand_L: { pos: SI_TOP, palm: [0, 0, 1], hint: [0.65, 0.75, 0.0] },
        hand_R: { pos: mx(SI_TOP), palm: [0, 0, 1], hint: [-0.65, 0.75, 0.0] },
        foot_L: { pos: [0.27, 0, 0.6 + SMITH_INCLINE.benchZ], rot: [0, 10, 0], hint: [0.4, 0.6, 1.5] },
        foot_R: { pos: [-0.27, 0, 0.6 + SMITH_INCLINE.benchZ], rot: [0, -10, 0], hint: [-0.4, 0.6, 1.5] },
      },
      bottom: {
        // Elbow pole down and towards the feet: the elbow lands right under the bar (vertical forearm).
        hand_L: { pos: SI_BOTTOM, palm: [0, 0, 1], hint: [0.54, 0.04, 0.33] },
        hand_R: { pos: mx(SI_BOTTOM), palm: [0, 0, 1], hint: [-0.54, 0.04, 0.33] },
      },
    },
  },

  {
    // ── Plate-loaded chest press (iso-lateral, neutral handles) ─────────────────────────────────────────────────
    // Seat set so the vertical handles are at mid-chest; back and shoulder blades stay on the reclined pad.
    // Neutral grip (palms face each other) — the most wrist-friendly press. The levers swing on a shallow arc
    // around their overhead pivots: from beside the chest (light stretch) to almost straight arms, 2.5 s back.
    id: 'machine_chest_press',
    machine: 'chest_press',
    machineOpts: { hand: CP_TOP, handRest: CP_BOTTOM },
    movers: driveMovers('hand_L'),
    // Side camera above the plates (they hang at knee height) so the handles and arms stay visible.
    camera: { target: [0, 1.0, 0.1], front: [2.3, 2.0, 2.9], side: [3.0, 2.25, 0.9] },
    tempo: { eccentric: 2.5, bottom: 0.3, concentric: 1.0, top: 0.5 },
    arrow: { effector: 'hand_L', offset: [0.1, 0.1, 0] },
    poses: {
      top: {
        ...seatedBase(CHEST_PRESS.pelvis, CHEST_PRESS.recline, 0.5),
        clavicle_L: [0, -4, -3], clavicle_R: [0, -4, -3],          // chest up, shoulders back
        hand_L: { pos: CP_TOP, palm: [-1, 0, 0], hint: [0.6, 0.55, -0.2], pivot: CP_PIVOT },
        hand_R: { pos: mx(CP_TOP), palm: [1, 0, 0], hint: [-0.6, 0.55, -0.2], pivot: mx(CP_PIVOT) },
      },
      bottom: {
        hand_L: { pos: CP_BOTTOM, palm: [-1, 0, 0], hint: [0.6, 0.65, -0.3], pivot: CP_PIVOT },
        hand_R: { pos: mx(CP_BOTTOM), palm: [1, 0, 0], hint: [-0.6, 0.65, -0.3], pivot: mx(CP_PIVOT) },
      },
    },
  },

  {
    // ── Pec deck (seated fly, vertical handles) ─────────────────────────────────────────────────────────────────
    // Back on the pad, chest open, handles at chest height, elbows slightly bent and FIXED (a hug, not a press).
    // The arms turn about vertical axes through the shoulder joints: hands sweep on a horizontal arc from beside
    // the body (moderate stretch, palms forward) to almost touching in front of the chest (palms facing).
    id: 'pec_deck',
    machine: 'pec_deck',
    machineOpts: { ...PD, hand: PD_TOP, handRest: PD_BOTTOM },
    movers: driveMovers('hand_L'),
    camera: { target: [0, 1.0, 0.1], front: [1.5, 1.9, 2.8], side: [3.1, 1.35, 0.3] },
    tempo: { eccentric: 2.5, bottom: 0.3, concentric: 1.2, top: 0.8 },
    arrow: { effector: 'hand_L', offset: [0, 0.12, 0] },
    poses: {
      top: {
        ...seatedBase(PEC_DECK.pelvis, PEC_DECK.recline, 0.5, 0.22),
        clavicle_L: [0, -2, -3], clavicle_R: [0, -2, -3],
        hand_L: { pos: PD_TOP, palm: [-0.97, 0, -0.25], hint: [0.75, 0.88, 0.2], pivot: [0.2, PD.handY, PD.pivotZ] },
        hand_R: { pos: mx(PD_TOP), palm: [0.97, 0, -0.25], hint: [-0.75, 0.88, 0.2], pivot: [-0.2, PD.handY, PD.pivotZ] },
      },
      bottom: {
        clavicle_L: [0, -6, -3], clavicle_R: [0, -6, -3],
        hand_L: { pos: PD_BOTTOM, palm: [-0.21, 0, 0.98], hint: [0.55, 0.88, -0.6], pivot: [0.2, PD.handY, PD.pivotZ] },
        hand_R: { pos: mx(PD_BOTTOM), palm: [0.21, 0, 0.98], hint: [-0.55, 0.88, -0.6], pivot: [-0.2, PD.handY, PD.pivotZ] },
      },
    },
  },

  {
    // ── Reverse pec deck (rear-delt fly) ────────────────────────────────────────────────────────────────────────
    // Same machine, lifter turned round: sits facing the pad (−Z) with the chest against it, legs straddling the
    // column, handles at shoulder height. Long arms with a soft, fixed elbow sweep from straight ahead back to the
    // line of the body; the shoulder blades move only a little (rear delts, not the mid back, do the work).
    id: 'reverse_pec_deck',
    machine: 'pec_deck',
    machineOpts: { ...RPD, hand: RPD_TOP, handRest: RPD_BOTTOM, back: [0.14, 0.52] },   // chest pad ends at the upper sternum
    movers: driveMovers('hand_L'),
    // Default view from behind and above: both arms visible over the head and shoulders.
    camera: { target: [0, 1.0, -0.2], front: [0.35, 2.75, 2.65], side: [3.1, 1.7, -0.25], threeQuarter: [1.75, 3.0, 1.55] },
    tempo: { eccentric: 2.5, bottom: 0.3, concentric: 1.2, top: 0.6 },
    arrow: { effector: 'hand_L', offset: [0, 0.12, 0] },
    poses: {
      top: {
        pelvis: { pos: RPD_PELVIS, rot: [-RPD_LEAN, 180, 0] },
        spine: [0, 0, 0], chest: [0, 0, 0], neck: [-4, 0, 0], head: [0, 0, 0],
        clavicle_L: [0, -3, -2], clavicle_R: [0, -3, -2],
        hand_L: { pos: RPD_TOP, palm: [0, 0, -1], hint: [-0.55, 1.2, 0.45], pivot: [-0.2, RPD.handY, RPD.pivotZ] },
        hand_R: { pos: mx(RPD_TOP), palm: [0, 0, -1], hint: [0.55, 1.2, 0.45], pivot: [0.2, RPD.handY, RPD.pivotZ] },
        foot_L: { pos: [-0.25, 0, -0.38], rot: [0, -172, 0], hint: [-0.35, 0.5, -1.2] },
        foot_R: { pos: [0.25, 0, -0.38], rot: [0, 172, 0], hint: [0.35, 0.5, -1.2] },
      },
      bottom: {
        clavicle_L: [0, 3, -2], clavicle_R: [0, 3, -2],
        hand_L: { pos: RPD_BOTTOM, palm: [1, 0, 0], hint: [-0.65, 1.15, -0.25], pivot: [-0.2, RPD.handY, RPD.pivotZ] },
        hand_R: { pos: mx(RPD_BOTTOM), palm: [-1, 0, 0], hint: [0.65, 1.15, -0.25], pivot: [0.2, RPD.handY, RPD.pivotZ] },
      },
    },
  },

  {
    // ── Machine shoulder press (neutral handles) ────────────────────────────────────────────────────────────────
    // Back on the slightly reclined pad, ribs down, abs braced. Neutral handles (palms facing) with the hands over
    // the elbows. Levers rise on an arc around the rear pivots: from chin height to almost straight arms over the
    // shoulders; 2 s down.
    id: 'machine_shoulder_press',
    machine: 'shoulder_press',
    machineOpts: { hand: SP_TOP, handRest: SP_BOTTOM },
    movers: driveMovers('hand_L'),
    camera: { target: [0, 1.15, -0.1], front: [1.9, 1.75, 2.6], side: [3.1, 1.35, -0.1] },
    tempo: { eccentric: 2.0, bottom: 0.3, concentric: 1.0, top: 0.5 },
    arrow: { effector: 'hand_L', offset: [0.12, 0, 0] },
    poses: {
      top: {
        ...seatedBase(SHOULDER_PRESS.pelvis, SHOULDER_PRESS.recline, 0.5),
        clavicle_L: [0, 0, 4], clavicle_R: [0, 0, 4],               // natural upward rotation at lockout
        hand_L: { pos: SP_TOP, palm: [-1, 0, 0], hint: [0.75, 1.2, 0.0], pivot: SP_PIVOT },
        hand_R: { pos: mx(SP_TOP), palm: [1, 0, 0], hint: [-0.75, 1.2, 0.0], pivot: mx(SP_PIVOT) },
      },
      bottom: {
        clavicle_L: [0, -2, -2], clavicle_R: [0, -2, -2],
        hand_L: { pos: SP_BOTTOM, palm: [-1, 0, 0], hint: [0.6, 0.6, 0.25], pivot: SP_PIVOT },
        hand_R: { pos: mx(SP_BOTTOM), palm: [1, 0, 0], hint: [-0.6, 0.6, 0.25], pivot: mx(SP_PIVOT) },
      },
    },
  },

  {
    // ── Seated dumbbell shoulder press (neutral grip) ───────────────────────────────────────────────────────────
    // Adjustable bench almost upright (85°), back and shoulder blades on the pad, feet wide and flat. Neutral grip
    // (palms facing) unloads the wrist; forearms stay vertical under the dumbbells, elbows slightly in front of the
    // body. Pressed to almost straight arms without clashing the bells, lowered in 2 s to ear level.
    id: 'db_shoulder_press',
    machine: 'bench_adjustable',
    machineOpts: { incline: 85 },
    props: [
      { type: 'dumbbell', attach: 'hand_L', opts: { kg: 12 } },
      { type: 'dumbbell', attach: 'hand_R', opts: { kg: 12 } },
    ],
    camera: { target: [0, 1.1, 0.1], front: [1.4, 1.6, 2.9], side: [3.1, 1.3, 0.2] },
    tempo: { eccentric: 2.0, bottom: 0.3, concentric: 1.0, top: 0.5 },
    arrow: { effector: 'hand_L', offset: [0.12, 0, 0] },
    poses: {
      top: {
        pelvis: UPRIGHT, spine: [0, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0],
        clavicle_L: [0, 0, 4], clavicle_R: [0, 0, 4],
        hand_L: { pos: [0.15, 1.655, 0.1], palm: [-1, 0, 0], hint: [0.7, 1.2, 0.15] },
        hand_R: { pos: [-0.15, 1.655, 0.1], palm: [1, 0, 0], hint: [-0.7, 1.2, 0.15] },
        foot_L: { pos: [0.27, 0, 0.6], rot: [0, 10, 0], hint: [0.4, 0.6, 1.2] },
        foot_R: { pos: [-0.27, 0, 0.6], rot: [0, -10, 0], hint: [-0.4, 0.6, 1.2] },
      },
      bottom: {
        clavicle_L: [0, -2, -2], clavicle_R: [0, -2, -2],
        hand_L: { pos: [0.34, 1.25, 0.2], palm: [-1, 0, 0], hint: [0.7, 0.75, 0.35] },
        hand_R: { pos: [-0.34, 1.25, 0.2], palm: [1, 0, 0], hint: [-0.7, 0.75, 0.35] },
      },
    },
  },

  {
    // ── Machine lateral raise ───────────────────────────────────────────────────────────────────────────────────
    // Seated facing the machine, chest on the pad, shoulder joints on the arm axes. Elbows bent 90°, forearms
    // forward with their outer side on the rollers, hands relaxed (no grip load). The elbows lead the arms out to
    // shoulder height; no shrug (shoulders stay down); 2.5 s down.
    id: 'machine_lateral_raise',
    machine: 'lateral_raise',
    machineOpts: { hand: LR_TOP, handRest: LR_BOTTOM },
    movers: driveMovers('hand_L'),
    camera: { target: [0, 0.95, 0.1], front: [-1.9, 1.75, -2.4], side: [2.6, 1.75, 1.3] },
    tempo: { eccentric: 2.5, bottom: 0.3, concentric: 1.2, top: 0.5 },
    arrow: { effector: 'hand_L', offset: [0.06, 0.1, -0.3] },
    poses: {
      top: {
        ...seatedBase(LATERAL_RAISE.pelvis, 0, 0.4),
        clavicle_L: [0, 0, -2], clavicle_R: [0, 0, -2],
        hand_L: { pos: LR_TOP, palm: lrPalm(88), hint: lrHint(88), pivot: LR_PIVOT },
        hand_R: { pos: mx(LR_TOP), palm: mx(lrPalm(88)), hint: mx(lrHint(88)), pivot: mx(LR_PIVOT) },
      },
      bottom: {
        hand_L: { pos: LR_BOTTOM, palm: lrPalm(15), hint: lrHint(15), pivot: LR_PIVOT },
        hand_R: { pos: mx(LR_BOTTOM), palm: mx(lrPalm(15)), hint: mx(lrHint(15)), pivot: mx(LR_PIVOT) },
      },
    },
  },
];
