// Animation specs, batch "posterior_core" (hinges, hip thrusts, leg curls, core).
// REFERENCE SPEC: bb_rdl — hip hinge with a two-hand barbell and a `mid` keypose. Authoring guide: ../README.md.
// The machine geometry these poses are fitted to lives in ../machines/posterior_core.js (exported constants).
import { BENCH_FLAT } from '../machines/common.js';
import { LYING_CURL, SEATED_CURL, CAPTAIN, HIP_THRUST, MAT_TOP, curlFoot } from '../machines/posterior_core.js';

const D2R = Math.PI / 180;
const r4 = (v) => +v.toFixed(4);

// ── Leg curls ───────────────────────────────────────────────────────────────────────────────────────────────────
// The lever rotates about the knee axis. Two invisible probes follow the soles (one mover along Y, one along Z); the
// machine turns them into the lever angle and the stack lift. Feet are rotated about the knee (`pivot`), the ankle
// stays neutral (foot ⟂ shin), so the knee never leaves the machine axis.
const CURL_MOVERS = [
  { part: 'probeY', follow: 'feetMid', axis: [0, 1, 0] },
  { part: 'probeZ', follow: 'feetMid', axis: [0, 0, 1] },
];
const curlFeet = (cfg, deg) => ({ foot_L: curlFoot(cfg, 0.1, deg), foot_R: curlFoot(cfg, -0.1, deg) });

// ── Hip thrust ──────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The upper back pivots on the bench edge: the point of the back 0.33 m up the spine from the hip joints and 0.10 m
 * behind the spine axis (lower shoulder blades) stays on the edge (y = bench top, z = benchEdge).
 * alpha = pelvis rot.x (−90 = torso horizontal at lockout). In world: Rx(a)·(0,1,0) = (c, s) [y, z],
 * anterior Rx(a)·(0,0,1) = (−s, c). The padded bar rests in the hip crease, pelvis-local (0, −0.02, 0.15).
 * dz shifts the body along Z (the back slides on the pad) — used in the Smith to keep the bar on its vertical rails.
 */
function thrust(alpha, dz = 0) {
  const a = alpha * D2R, c = Math.cos(a), s = Math.sin(a);
  const y = BENCH_FLAT.top - 0.1 * s - 0.33 * c;
  const z = HIP_THRUST.benchEdge + 0.1 * c - 0.33 * s + dz;
  return { pelvis: [0, r4(y), r4(z)], rot: [alpha, 0, 0], bar: [r4(y - 0.02 * c - 0.15 * s), r4(z - 0.02 * s + 0.15 * c)] };
}
const THRUST_ANGLES = { top: -90, mid: -70, bottom: -50 };

/**
 * Hip-thrust key poses. smith = true keeps the bar at HIP_THRUST.barZ (vertical rails). Hands only steady the bar
 * (overhand, palms down, wrists straight), x = ±0.30 — just outside the hips.
 */
function thrustPoses(smith) {
  const out = {};
  for (const [k, ang] of Object.entries(THRUST_ANGLES)) {
    let t = thrust(ang);
    if (smith) t = thrust(ang, HIP_THRUST.barZ - t.bar[1]);
    const [by, bz] = t.bar;
    out[k] = {
      pelvis: { pos: t.pelvis, rot: t.rot },
      hand_L: { pos: [0.3, by, bz], palm: [0, -1, 0.2], hint: [0.62, by - 0.25, bz - 0.3] },
      hand_R: { pos: [-0.3, by, bz], palm: [0, -1, 0.2], hint: [-0.62, by - 0.25, bz - 0.3] },
    };
  }
  // Lockout: shins vertical (knee straight above the ankle), feet shoulder-width, chin tucked, ribs down.
  Object.assign(out.top, {
    spine: [4, 0, 0], chest: [0, 0, 0], neck: [26, 0, 0], head: [10, 0, 0],
    clavicle_L: [0, -4, 0], clavicle_R: [0, -4, 0],
    foot_L: { pos: [0.18, 0, 0.442], rot: [0, 8, 0], hint: [0.34, 1.0, 0.9] },
    foot_R: { pos: [-0.18, 0, 0.442], rot: [0, -8, 0], hint: [-0.34, 1.0, 0.9] },
  });
  Object.assign(out.bottom, { spine: [0, 0, 0], neck: [22, 0, 0], head: [8, 0, 0] });
  return out;
}

// ── Captain's chair ─────────────────────────────────────────────────────────────────────────────────────────────
// Supported on the forearm pads: shoulder joints ≈ (±0.2, pelvis.y + 0.465, −0.035), upper arms vertical, forearms
// on the pads (pad top = elbow − 0.04), fists on the vertical handles.
const CC_PELVIS = [0, CAPTAIN.handle[1] - 0.165, 0];
// Posterior pelvic tilt at the top (pelvis −22°) is undone by lumbar/thoracic flexion (14° + 8°), so the chest keeps
// its place against the back pad; the pelvis shifts so the chest bone stays put: Δ = (0, +0.011, +0.053).
const CC_PELVIS_TOP = [0, r4(CC_PELVIS[1] + 0.0108), 0.0533];
const ccHand = (sx) => ({ pos: [sx * CAPTAIN.handle[0], CAPTAIN.handle[1], CAPTAIN.handle[2]], palm: [-sx, 0, 0], hint: [sx * 0.42, CC_PELVIS[1] - 0.3, -0.15] });
/** Top foot: thighs 32° above horizontal (knees towards the chest), shins hanging 10° back from vertical. */
const CC_SOLE_TOP = (() => {
  const t = 32 * D2R, sh = 10 * D2R, fb = 25 * D2R;
  const ky = CC_PELVIS_TOP[1] + 0.45 * Math.sin(t), kz = CC_PELVIS_TOP[2] + 0.45 * Math.cos(t);
  const ay = ky - 0.44 * Math.cos(sh), az = kz - 0.44 * Math.sin(sh);
  return [r4(ay - 0.085 * Math.cos(fb)), r4(az - 0.085 * Math.sin(fb))];
})();

// ── Plank ───────────────────────────────────────────────────────────────────────────────────────────────────────
// Forearms flat on a mat, elbows under the shoulders, fists loose and thumb-up (neutral, no wrist extension).
// Body line ankle → shoulder straight, ~4° above horizontal; toes tucked (ankle ≈ 0.22 m up, toe tips on the mat).
const PLANK = (() => {
  const shoulderY = MAT_TOP + 0.042 + 0.3;           // forearm resting on the mat + vertical upper arm
  const tilt = 4.1 * D2R, rx = 90 - 4.1, a = rx * D2R;
  // Shoulder joint in pelvis space ≈ (0.2, 0.465, −0.035) → world offset under Rx(rx).
  const sy = 0.465 * Math.cos(a) + 0.035 * Math.sin(a), sz = 0.465 * Math.sin(a) - 0.035 * Math.cos(a);
  const py = shoulderY - sy;
  const ankle = [py - 0.89 * Math.sin(tilt), -0.89 * Math.cos(tilt)];
  const fb = 80 * D2R;                                 // foot pitch: toes down, slightly tucked towards the head
  const sole = [ankle[0] - 0.085 * Math.cos(fb), ankle[1] - 0.085 * Math.sin(fb)];
  return { pelvisY: r4(py), rx, shoulderZ: r4(sz), sole: sole.map(r4), elbowY: MAT_TOP + 0.042 };
})();

export default [
  {
    // ── Barbell Romanian deadlift (REFERENCE) ───────────────────────────────────────────────────────────────────
    // Hip hinge: the pelvis travels BACK and tilts forward (pelvis rot.x ≈ 84° at the bottom) while the spine stays
    // neutral (spine/chest ≈ 0, the neck a little extended so the gaze stays ~1 m ahead of the feet). Knees soft:
    // ~17° at the top, ≤ ~36° at mid, ~30° at the bottom with the shins vertical or slightly back — more bend turns
    // the hinge into a squat. The bar is held with `attach: 'handsMid'` — it is centred between both fists and its
    // axis follows the line between them. Arms hang long (elbows ~15° at the top and bottom; ~40° at mid is the
    // straightest the quadratic `mid` path allows without out-of-reach targets in the first quarter of the rep).
    // The bar slides along the thighs to just below the knees; the `mid` keypose bends its path around the knee caps
    // so it never cuts through the legs. Wrist care: overhand grip, straight wrists (straps per the exercise notes).
    id: 'bb_rdl',
    machine: null,
    props: [{ type: 'barbell', attach: 'handsMid', opts: { kgPerSide: 20 } }],
    // Side camera ~25° off the bar axis so the near plate does not hide the body.
    camera: { target: [0, 0.78, 0.05], front: [2.2, 1.35, 2.5], side: [3.0, 1.0, 1.35] },
    tempo: { eccentric: 2.5, bottom: 0.3, concentric: 1.2, top: 0.6 },
    arrow: { effector: 'handsMid', offset: [0.36, 0, 0.06] },
    poses: {
      top: {
        pelvis: { pos: [0, 0.965, 0], rot: [0, 0, 0] },
        spine: [0, 0, 0], chest: [-2, 0, 0], neck: [0, 0, 0],
        clavicle_L: [0, -4, -2], clavicle_R: [0, -4, -2],         // shoulders packed back & down
        // Bar on the upper thighs, overhand grip just outside the legs: palms face back (−Z).
        hand_L: { pos: [0.235, 0.8, 0.12], palm: [0, 0, -1], hint: [0.45, 1.0, -0.5] },
        hand_R: { pos: [-0.235, 0.8, 0.12], palm: [0, 0, -1], hint: [-0.45, 1.0, -0.5] },
        foot_L: { pos: [0.13, 0, 0.0], rot: [0, 6, 0], hint: [0.18, 0.5, 1] },
        foot_R: { pos: [-0.13, 0, 0.0], rot: [0, -6, 0], hint: [-0.18, 0.5, 1] },
      },
      mid: {
        // Half-way: the hips have already travelled back (hinge leads), bar just above and in front of the knee caps.
        pelvis: { pos: [0, 0.905, -0.21], rot: [60, 0, 0] },
        hand_L: { pos: [0.235, 0.585, 0.075], palm: [0, 0, -1], hint: [0.45, 0.8, -0.6] },
        hand_R: { pos: [-0.235, 0.585, 0.075], palm: [0, 0, -1], hint: [-0.45, 0.8, -0.6] },
      },
      bottom: {
        // Hips back ~27 cm, torso ~6° above horizontal, neutral spine, knees ~30°, shins slightly back; the bar
        // ~2 cm in front of the shins, below the knees, over the mid-foot.
        pelvis: { pos: [0, 0.9, -0.265], rot: [84, 0, 0] },
        spine: [-3, 0, 0], chest: [-3, 0, 0], neck: [-14, 0, 0], head: [-6, 0, 0],
        hand_L: { pos: [0.235, 0.39, 0.065], palm: [0, 0, -1], hint: [0.45, 0.6, -0.65] },
        hand_R: { pos: [-0.235, 0.39, 0.065], palm: [0, 0, -1], hint: [-0.45, 0.6, -0.65] },
      },
    },
  },
  {
    // ── Dumbbell Romanian deadlift ──────────────────────────────────────────────────────────────────────────────
    // Same hinge as bb_rdl (hips back, neutral spine, soft knees, long arms, bottom just below the knees).
    // Wrist care: NEUTRAL grip — palms face the legs, handles point forward, so the dumbbells hang beside the thighs
    // and slide down along the legs with straight wrists. Fists at x = ±0.27: the inner faces of the 16 kg heads
    // (r 0.077) stay ≥ 1 cm outside the thighs, knees and shins all the way down.
    id: 'db_rdl',
    machine: null,
    props: [
      { type: 'dumbbell', attach: 'hand_L', opts: { kg: 16 } },
      { type: 'dumbbell', attach: 'hand_R', opts: { kg: 16 } },
    ],
    camera: { target: [0, 0.78, 0.05], front: [2.2, 1.35, 2.5], side: [3.1, 1.05, 0.9] },
    tempo: { eccentric: 2.5, bottom: 0.3, concentric: 1.2, top: 0.6 },
    arrow: { effector: 'hand_L', offset: [0.14, 0, 0.04] },
    poses: {
      top: {
        pelvis: { pos: [0, 0.965, 0], rot: [0, 0, 0] },
        spine: [0, 0, 0], chest: [-2, 0, 0], neck: [0, 0, 0],
        clavicle_L: [0, -5, -2], clavicle_R: [0, -5, -2],         // shoulder blades together and down
        hand_L: { pos: [0.27, 0.8, 0.08], palm: [-1, 0, 0], hint: [0.5, 1.0, -0.45] },
        hand_R: { pos: [-0.27, 0.8, 0.08], palm: [1, 0, 0], hint: [-0.5, 1.0, -0.45] },
        foot_L: { pos: [0.12, 0, 0.0], rot: [0, 5, 0], hint: [0.16, 0.5, 1] },
        foot_R: { pos: [-0.12, 0, 0.0], rot: [0, -5, 0], hint: [-0.16, 0.5, 1] },
      },
      mid: {
        // Hips lead: they are already well back while the dumbbells pass the knees.
        pelvis: { pos: [0, 0.905, -0.21], rot: [60, 0, 0] },
        hand_L: { pos: [0.27, 0.595, 0.08], palm: [-1, 0, 0], hint: [0.45, 0.8, -0.6] },
        hand_R: { pos: [-0.27, 0.595, 0.08], palm: [1, 0, 0], hint: [-0.45, 0.8, -0.6] },
      },
      bottom: {
        // Strong hamstring stretch: torso ~6° above horizontal, knees ~30°, dumbbells beside the upper shins.
        pelvis: { pos: [0, 0.9, -0.265], rot: [84, 0, 0] },
        spine: [-3, 0, 0], chest: [-3, 0, 0], neck: [-14, 0, 0], head: [-6, 0, 0],
        hand_L: { pos: [0.27, 0.39, 0.07], palm: [-1, 0, 0], hint: [0.45, 0.6, -0.65] },
        hand_R: { pos: [-0.27, 0.39, 0.07], palm: [1, 0, 0], hint: [-0.45, 0.6, -0.65] },
      },
    },
  },
  {
    // ── Barbell hip thrust ──────────────────────────────────────────────────────────────────────────────────────
    // Shoulder blades on the edge of a flat bench placed crosswise, padded bar in the hip crease, feet shoulder-width.
    // Hips rise until shoulders–hips–knees form a straight horizontal line with vertical shins; the back pivots on
    // the bench edge (see thrust()). Chin tucked, ribs down: no lumbar hyperextension at the top (+4° spine
    // flexion). Free bar: it follows the hips on their small arc. Hands only steady the bar.
    id: 'hip_thrust',
    machine: 'hip_thrust_bench',
    props: [{ type: 'barbell', attach: 'handsMid', opts: { kgPerSide: 20, pad: true } }],
    camera: { target: [0, 0.45, -0.05], front: [0.8, 1.5, 3.1], side: [2.5, 0.95, 2.05] },
    tempo: { eccentric: 2.0, bottom: 0.3, concentric: 1.0, top: 1.0 },  // 1 s squeeze at the top, 2 s down
    arrow: { effector: 'pelvis', offset: [0.34, 0.02, 0.1] },
    poses: thrustPoses(false),
  },
  {
    // ── Smith machine hip thrust ────────────────────────────────────────────────────────────────────────────────
    // Same movement in the Smith: bench across the machine behind the lifter, bar on vertical rails, so the hips are
    // kept under the bar (the upper back slides a few cm on the pad instead of the bar drifting forward).
    // The Smith bar is a machine part moved by a mover that follows the hands holding it; the pad is a prop.
    id: 'smith_hip_thrust',
    machine: 'hip_thrust_smith',
    machineOpts: { barHeight: thrust(-90).bar[0], kgPerSide: 20 },
    props: [{ type: 'hip_pad', attach: 'handsMid' }],
    movers: [{ part: 'bar', follow: 'handsMid', axis: [0, 1, 0] }],
    camera: { target: [0, 0.5, -0.05], front: [0.6, 1.5, 3.2], side: [1.9, 1.05, 2.6] },
    tempo: { eccentric: 2.0, bottom: 0.3, concentric: 1.0, top: 1.0 },
    arrow: { effector: 'pelvis', offset: [0.34, 0.02, 0.1] },
    poses: thrustPoses(true),
  },
  {
    // ── Lying leg curl ──────────────────────────────────────────────────────────────────────────────────────────
    // Prone on the angled pad (hips ~15° flexed by the hump), knee caps just past the end of the thigh pad, the knee
    // axis on the machine pivot, roller above the heels (on the Achilles). Pelvis pressed into the pad (it never
    // moves). Curl from almost straight (8°) to ~110° of knee flexion, ankles neutral. Hands on vertical handles
    // (neutral grip, light hold). Eccentric 2.6 s.
    id: 'lying_leg_curl',
    machine: 'lying_leg_curl',
    movers: CURL_MOVERS,
    camera: { target: [0, 0.78, -0.1], front: [2.3, 1.75, -2.2], side: [3.1, 1.3, -0.1] },
    tempo: { eccentric: 2.6, bottom: 0.3, concentric: 1.0, top: 0.8 },
    arrow: { effector: 'feetMid', offset: [0.3, 0, 0] },
    poses: {
      top: {
        pelvis: { pos: LYING_CURL.pelvis, rot: [LYING_CURL.tilt, 0, 0] },
        spine: [0, 0, 0], chest: [0, 0, 0], neck: [-14, 0, 0], head: [-6, 0, 0],
        clavicle_L: [0, 4, 0], clavicle_R: [0, 4, 0],
        hand_L: { pos: [0.27, 0.56, 0.74], palm: [-1, 0, 0], hint: [0.6, 0.55, 0.42] },
        hand_R: { pos: [-0.27, 0.56, 0.74], palm: [1, 0, 0], hint: [-0.6, 0.55, 0.42] },
        ...curlFeet(LYING_CURL, LYING_CURL.top),
      },
      bottom: { ...curlFeet(LYING_CURL, LYING_CURL.bottom) },
    },
  },
  {
    // ── Seated leg curl ─────────────────────────────────────────────────────────────────────────────────────────
    // Knee axis on the machine pivot, thigh roller locked on just above the knees, lower-leg roller above the heels.
    // Torso leans ~10° forward against the tilted back pad (more hamstring stretch). Curl from straight legs (10°)
    // to ~112° — heels pulled under the seat — then return slowly (2.6 s) all the way. Neutral grip on side handles.
    id: 'seated_leg_curl',
    machine: 'seated_leg_curl',
    movers: CURL_MOVERS,
    camera: { target: [0, 0.78, 0.1], front: [2.3, 1.6, 2.9], side: [3.2, 1.2, 0.3] },
    tempo: { eccentric: 2.6, bottom: 0.3, concentric: 1.0, top: 0.6 },
    arrow: { effector: 'feetMid', offset: [0.3, 0, 0] },
    poses: {
      top: {
        pelvis: { pos: SEATED_CURL.pelvis, rot: [SEATED_CURL.tilt, 0, 0] },
        spine: [0, 0, 0], chest: [0, 0, 0], neck: [-6, 0, 0], head: [0, 0, 0],
        clavicle_L: [0, -2, -2], clavicle_R: [0, -2, -2],
        hand_L: { pos: [0.31, 0.645, 0.12], palm: [-1, 0, 0], hint: [0.55, 0.85, -0.25] },
        hand_R: { pos: [-0.31, 0.645, 0.12], palm: [1, 0, 0], hint: [-0.55, 0.85, -0.25] },
        ...curlFeet(SEATED_CURL, SEATED_CURL.top),
      },
      bottom: { ...curlFeet(SEATED_CURL, SEATED_CURL.bottom) },
    },
  },
  {
    // ── Hanging knee raise in the captain's chair ───────────────────────────────────────────────────────────────
    // Supported on the forearms (NOT hanging from the hands — wrist and grip stay unloaded), neutral vertical handles,
    // back against the pad, shoulders down. Knees rise to chest height while the pelvis curls up (posterior tilt,
    // lumbar flexion) — the abs do the work, not just the hip flexors. Lower slowly (2 s) without swinging.
    id: 'hanging_knee_raise',
    machine: 'captains_chair',
    camera: { target: [0, 1.1, 0.05], front: [2.0, 1.65, 2.9], side: [3.3, 1.35, 0.45] },
    tempo: { eccentric: 2.0, bottom: 0.4, concentric: 1.0, top: 0.5 },
    arrow: { effector: 'feetMid', offset: [0.32, 0, 0] },
    poses: {
      top: {
        pelvis: { pos: CC_PELVIS_TOP, rot: [-22, 0, 0] },
        spine: [14, 0, 0], chest: [8, 0, 0], neck: [4, 0, 0], head: [0, 0, 0],
        clavicle_L: [0, 0, -2], clavicle_R: [0, 0, -2],
        hand_L: ccHand(1), hand_R: ccHand(-1),
        // Knees up towards the chest (thighs ~32° above horizontal), shins hanging, feet relaxed.
        foot_L: { pos: [0.11, ...CC_SOLE_TOP], rot: [25, 0, 0], hint: [0.14, CC_PELVIS[1] + 0.75, 1.1] },
        foot_R: { pos: [-0.11, ...CC_SOLE_TOP], rot: [25, 0, 0], hint: [-0.14, CC_PELVIS[1] + 0.75, 1.1] },
      },
      bottom: {
        pelvis: { pos: CC_PELVIS, rot: [0, 0, 0] },
        spine: [0, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0],
        // Legs hang straight down (soft knees), toes slightly pointed.
        foot_L: { pos: [0.11, r4(CC_PELVIS[1] - 0.95), 0.06], rot: [20, 0, 0], hint: [0.13, 0.8, 1.0] },
        foot_R: { pos: [-0.11, r4(CC_PELVIS[1] - 0.95), 0.06], rot: [20, 0, 0], hint: [-0.13, 0.8, 1.0] },
      },
    },
  },
  {
    // ── Forearm plank ───────────────────────────────────────────────────────────────────────────────────────────
    // Isometric hold (reps = seconds). Elbows under the shoulders, forearms parallel on the mat, fists loose with the
    // thumbs up — no load on the wrist. Straight line head–hips–heels. The "rep" is a slow brace/breath cycle:
    // top = braced (glutes and abs squeezed: pelvis tucked 3°, tiny lift), bottom = relaxed but still straight.
    id: 'plank',
    machine: 'exercise_mat',
    machineOpts: { z: -0.075 },
    camera: { target: [0, 0.32, -0.05], front: [2.0, 1.1, 2.3], side: [3.2, 0.85, -0.05] },
    tempo: { eccentric: 1.8, bottom: 1.2, concentric: 1.2, top: 1.8 },
    arrow: false,
    poses: {
      top: {
        pelvis: { pos: [0, r4(PLANK.pelvisY + 0.006), 0], rot: [PLANK.rx - 3, 0, 0] },
        spine: [3, 0, 0], chest: [0, 0, 0], neck: [-4, 0, 0], head: [0, 0, 0],
        clavicle_L: [0, 3, 0], clavicle_R: [0, 3, 0],                 // push the floor away: slight protraction
        hand_L: { pos: [0.18, PLANK.elbowY, r4(PLANK.shoulderZ + 0.345)], palm: [-1, 0, 0], hint: [0.24, -0.4, PLANK.shoulderZ - 0.1] },
        hand_R: { pos: [-0.18, PLANK.elbowY, r4(PLANK.shoulderZ + 0.345)], palm: [1, 0, 0], hint: [-0.24, -0.4, PLANK.shoulderZ - 0.1] },
        foot_L: { pos: [0.1, PLANK.sole[0], PLANK.sole[1]], rot: [80, 0, 0], hint: [0.1, -0.6, -0.45] },
        foot_R: { pos: [-0.1, PLANK.sole[0], PLANK.sole[1]], rot: [80, 0, 0], hint: [-0.1, -0.6, -0.45] },
      },
      bottom: {
        pelvis: { pos: [0, PLANK.pelvisY, 0], rot: [PLANK.rx, 0, 0] },
        spine: [0, 0, 0],
      },
    },
  },
];
