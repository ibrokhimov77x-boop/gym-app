// Animation specs, batch "cables_arms" (cable work, curls, extensions, raises with dumbbells).
// REFERENCE SPEC: db_lateral_raise — standing exercise + arc motion (`pivot`). Authoring guide: ../README.md.

// Shoulder joint of the standing figure with the small forward lean used below (pelvis rot.x = 6°).
const SHOULDER_L = [0.2, 1.43, 0.04];
const SHOULDER_R = [-0.2, 1.43, 0.04];

// Single-column exercises turn the cable crossover by 90° so that one column stands in front of the figure (+Z)
// and the other behind it (−Z); the figure keeps facing +Z. After `yaw: 90` the machine's right column is the
// FRONT one (its pulley exits at x ≈ 0.02, z ≈ 0.73 + at.z) and the left column is the BACK one (z ≈ −0.73 + at.z).
const FRONT_COLUMN = (dz) => ({ yaw: 90, at: [0, 0, dz] });

const mirror = ([x, y, z]) => [-x, y, z];
/** Left/right hand entries from the left-hand one (x of pos/hint/pivot and palm mirrored). */
function hands(L) {
  const R = { ...L, pos: mirror(L.pos) };
  if (L.palm) R.palm = mirror(L.palm);
  if (L.hint) R.hint = mirror(L.hint);
  if (L.pivot) R.pivot = mirror(L.pivot);
  return { hand_L: L, hand_R: R };
}

export default [
  {
    // ── Dumbbell lateral raise (REFERENCE) ──────────────────────────────────────────────────────────────────────
    // Standing, feet hip-width, soft knees, ~6° forward lean from the hips. Arms rise in the scapular plane
    // (slightly in front of the body) to shoulder height with a slight, constant elbow bend. The hand travels on
    // an ARC around the shoulder: `pivot` makes the animator rotate the hand around that point instead of moving
    // it in a straight line. Palms turn from facing the thighs to facing the floor; no shrug (clavicles neutral).
    id: 'db_lateral_raise',
    machine: null,
    props: [
      { type: 'dumbbell', attach: 'hand_L', opts: { kg: 8 } },
      { type: 'dumbbell', attach: 'hand_R', opts: { kg: 8 } },
    ],
    camera: { target: [0, 1.05, 0], front: [0, 1.35, 3.3], side: [3.2, 1.3, 0.6] },
    tempo: { eccentric: 2.2, bottom: 0.3, concentric: 1.1, top: 0.35 },
    arrow: { effector: 'hand_L', offset: [0.11, 0.06, 0] },
    poses: {
      top: {
        pelvis: { pos: [0, 0.962, -0.01], rot: [6, 0, 0] },
        spine: [2, 0, 0], chest: [0, 0, 0], neck: [-6, 0, 0], head: [-2, 0, 0],
        clavicle_L: [0, 0, 2], clavicle_R: [0, 0, 2],
        // Hands just below shoulder height, ~20° in front of the frontal plane, elbows soft (~20° bend).
        hand_L: { pos: [0.8, 1.39, 0.2], palm: [0, -1, 0.1], hint: [0.55, 1.75, -0.25], pivot: SHOULDER_L },
        hand_R: { pos: [-0.8, 1.39, 0.2], palm: [0, -1, 0.1], hint: [-0.55, 1.75, -0.25], pivot: SHOULDER_R },
        foot_L: { pos: [0.12, 0, 0.0], rot: [0, 6, 0], hint: [0.15, 0.5, 1] },
        foot_R: { pos: [-0.12, 0, 0.0], rot: [0, -6, 0], hint: [-0.15, 0.5, 1] },
      },
      bottom: {
        clavicle_L: [0, 0, 0], clavicle_R: [0, 0, 0],
        // Dumbbells hang beside / slightly in front of the thighs, palms facing in.
        hand_L: { pos: [0.21, 0.83, 0.13], palm: [-1, 0, 0.15], hint: [0.55, 1.05, -0.35], pivot: SHOULDER_L },
        hand_R: { pos: [-0.21, 0.83, 0.13], palm: [1, 0, 0.15], hint: [-0.55, 1.05, -0.35], pivot: SHOULDER_R },
      },
    },
  },

  {
    // ── Cable crossover fly ──
    // Pulleys a little above shoulder height (1.7 m), the figure takes a short step forward from the pulley line into a
    // split stance and leans ~14° forward. Elbows keep the SAME soft bend all rep ("arms are hooks"): both keyposes put
    // the fist 0.60 m from the shoulder and `pivot` = shoulder, so the hand sweeps an arc and the elbow angle never
    // changes; elbows point out and slightly down. Bottom = stretch (arms open, hands level with the shoulder line);
    // top = hands meet in front of the lower chest. Wrists straight all rep. Palms turn from forward-in at the stretch to
    // down-in at the finish: the D-handle stirrup swings about the grip, so with fully neutral palms it would lie along
    // the forearm and the cable would run through it — the slight pronation puts the stirrup over the back of the hand
    // and the cable above the forearm, as on the real machine.
    id: 'cable_fly',
    machine: 'cable_crossover',
    machineOpts: { height: 1.7 },
    props: [{ type: 'd_handle', attach: 'hand_L' }, { type: 'd_handle', attach: 'hand_R' }],
    cables: [{ from: 'pulley_L', to: 'hand_L' }, { from: 'pulley_R', to: 'hand_R' }],
    camera: { target: [0, 1.05, 0.2], front: [0, 1.45, 3.95], side: [3.3, 1.3, 1.05] },
    tempo: { eccentric: 2.5, bottom: 0.35, concentric: 1.1, top: 0.5 },
    arrow: { effector: 'hand_L', offset: [0, 0.1, 0] },
    poses: {
      top: {
        pelvis: { pos: [0, 0.94, 0.2], rot: [14, 0, 0] },
        spine: [2, 0, 0], chest: [0, 0, 0], neck: [-10, 0, 0],
        clavicle_L: [0, 4, 0], clavicle_R: [0, 4, 0],
        ...hands({ pos: [0.06, 1.16, 0.83], palm: [-0.5, -0.85, -0.15], hint: [0.5, 0.6, 0.2], pivot: [0.2, 1.4, 0.28] }),
        foot_L: { pos: [0.15, 0, 0.43], rot: [0, 6, 0], hint: [0.18, 0.5, 1.35] },
        foot_R: { pos: [-0.15, 0, 0.03], rot: [0, -6, 0], hint: [-0.18, 0.5, 1.05] },
      },
      bottom: {
        clavicle_L: [0, -4, 0], clavicle_R: [0, -4, 0],
        ...hands({ pos: [0.73, 1.26, 0.55], palm: [-0.42, -0.05, 0.9], hint: [0.5, 1.1, -0.15], pivot: [0.2, 1.4, 0.28] }),
      },
    },
  },

  {
    // ── One-arm cable lateral raise ──
    // The figure stands with its right side to the right column (low pulley) and works the FAR (left) arm; the cable
    // crosses in front of the body. The right hand holds the column's chrome track (the track passes through the fist
    // like a vertical handle). Torso stays upright (no lean away from the stack). The hand arcs around the shoulder up to
    // shoulder height in the scapular plane, elbow slightly above the hand ("the elbow leads"), palm ends facing down.
    // The station is shifted 0.15 m forward (the figure stands a little behind the column) so the cable from the low
    // pulley passes IN FRONT of the near (right) thigh instead of through it.
    id: 'cable_lateral_raise',
    machine: 'cable_crossover',
    machineOpts: { at: [0, 0, 0.15] },
    props: [{ type: 'd_handle', attach: 'hand_L' }],
    cables: [{ from: 'pulley_R_low', to: 'hand_L' }],
    camera: { target: [-0.2, 1.05, 0], front: [-0.2, 1.4, 3.6], side: [2.9, 1.3, 1.7] },
    tempo: { eccentric: 2.5, bottom: 0.3, concentric: 1.1, top: 0.4 },
    arrow: { effector: 'hand_L', offset: [0.08, 0.08, 0] },
    poses: {
      top: {
        pelvis: { pos: [-0.36, 0.962, -0.05], rot: [3, 0, 0] },
        spine: [0, 0, 0], neck: [-4, 0, 0],
        clavicle_L: [0, 0, 2], clavicle_R: [0, 0, 0],
        hand_L: { pos: [0.4, 1.4, 0.21], palm: [0, -1, 0.1], hint: [0.19, 1.75, -0.25], pivot: [-0.16, 1.43, -0.05] },
        hand_R: { pos: [-0.85, 1.2, 0.15], palm: [0.15, 0, 1], hint: [-0.6, 1.0, -0.5] },
        foot_L: { pos: [-0.24, 0, -0.04], rot: [0, 6, 0], hint: [-0.21, 0.5, 1] },
        foot_R: { pos: [-0.48, 0, -0.04], rot: [0, -6, 0], hint: [-0.51, 0.5, 1] },
      },
      bottom: {
        clavicle_L: [0, 0, 0],
        hand_L: { pos: [-0.29, 0.88, 0.2], palm: [-1, 0, -0.2], hint: [0.19, 1.05, -0.35], pivot: [-0.16, 1.43, -0.05] },
      },
    },
  },

  {
    // ── Face pull ──
    // Single column: the crossover is turned 90° so the right column stands in front of the figure, pulley at forehead
    // height (1.7 m). Step back, slight backward lean (−4°). Rope, overhand grip: at the start (arms straight) palms
    // face down; the pull ends in the "double biceps" position — elbows high and wide at shoulder height, forearms
    // vertical, fists beside the head at ear/forehead level with the palms facing the head and thumbs pointing back
    // (external rotation), shoulder blades retracted (clavicle −y). The rope stays in front of the face.
    id: 'face_pull',
    machine: 'cable_crossover',
    machineOpts: { ...FRONT_COLUMN(0.35), heightR: 1.7 },
    props: [{ type: 'triceps_rope', attach: 'handsMid' }],
    cables: [{ from: 'pulley_R', to: 'handsMid' }],
    camera: { target: [0, 1.2, 0.25], front: [2.4, 1.5, 3.3], side: [3.4, 1.3, 0.3] },
    tempo: { eccentric: 2.3, bottom: 0.3, concentric: 1.0, top: 0.6 },
    arrow: { effector: 'hand_L', offset: [0.1, 0.06, 0] },
    poses: {
      top: {
        pelvis: { pos: [0, 0.962, 0], rot: [-4, 0, 0] },
        spine: [0, 0, 0], neck: [2, 0, 0],
        clavicle_L: [0, -8, 2], clavicle_R: [0, -8, 2],
        ...hands({ pos: [0.3, 1.67, 0.0], palm: [-1, 0, 0], hint: [0.9, 1.45, -0.12] }),
        foot_L: { pos: [0.12, 0, 0.1], rot: [0, 6, 0], hint: [0.15, 0.5, 1] },
        foot_R: { pos: [-0.12, 0, -0.12], rot: [0, -6, 0], hint: [-0.15, 0.5, 1] },
      },
      bottom: {
        clavicle_L: [0, 6, 0], clavicle_R: [0, 6, 0],
        ...hands({ pos: [0.1, 1.55, 0.52], palm: [0, -1, 0], hint: [0.6, 1.2, 0.2] }),
      },
    },
  },

  {
    // ── Dumbbell hammer curl ──
    // Standing, neutral grip (palms face each other) for both keyposes — the most wrist-friendly curl. Elbows stay
    // pinned at the sides: `pivot` is the elbow, placed in the same sagittal plane as the fist so the dumbbell travels
    // a clean arc, and the elbow hint lies below/behind/inside so the elbow does not flare. Full extension at the bottom.
    id: 'db_hammer_curl',
    machine: null,
    props: [
      { type: 'dumbbell', attach: 'hand_L', opts: { kg: 12 } },
      { type: 'dumbbell', attach: 'hand_R', opts: { kg: 12 } },
    ],
    camera: { target: [0, 1.05, 0], front: [0, 1.35, 3.3], side: [3.2, 1.3, 0.6] },
    tempo: { eccentric: 2.0, bottom: 0.3, concentric: 1.0, top: 0.4 },
    arrow: { effector: 'hand_L', offset: [0.1, 0, 0] },
    poses: {
      top: {
        pelvis: { pos: [0, 0.965, 0], rot: [2, 0, 0] },
        spine: [0, 0, 0], neck: [-2, 0, 0],
        clavicle_L: [0, -3, -2], clavicle_R: [0, -3, -2],
        ...hands({ pos: [0.24, 1.38, 0.2], palm: [-1, 0, 0], hint: [0.12, 0.85, -0.5], pivot: [0.245, 1.13, -0.02] }),
        foot_L: { pos: [0.12, 0, 0.0], rot: [0, 6, 0], hint: [0.15, 0.5, 1] },
        foot_R: { pos: [-0.12, 0, 0.0], rot: [0, -6, 0], hint: [-0.15, 0.5, 1] },
      },
      bottom: {
        ...hands({ pos: [0.25, 0.8, 0.03], palm: [-1, 0, 0], hint: [0.12, 0.85, -0.5], pivot: [0.245, 1.13, -0.02] }),
      },
    },
  },

  {
    // ── Low-pulley rope curl ──
    // Front column turned towards the figure, low pulley ~0.6 m ahead of the toes; one step back, upright. Rope =
    // neutral grip. Elbows pinned (pivot at elbow height, in the plane of the fists); the rope ends spread apart a little
    // at the top (fists 0.28 m apart vs 0.18 m at the bottom). Weight stack rises with the cable travel.
    id: 'cable_rope_curl',
    machine: 'cable_crossover',
    machineOpts: FRONT_COLUMN(-0.15),
    props: [{ type: 'triceps_rope', attach: 'handsMid' }],
    cables: [{ from: 'pulley_R_low', to: 'handsMid' }],
    camera: { target: [0, 0.95, 0.15], front: [2.6, 1.35, 2.3], side: [3.2, 1.15, 0.35] },
    tempo: { eccentric: 2.2, bottom: 0.3, concentric: 1.0, top: 0.5 },
    arrow: { effector: 'hand_L', offset: [0.1, 0, 0] },
    poses: {
      top: {
        pelvis: { pos: [0, 0.965, -0.02], rot: [0, 0, 0] },
        clavicle_L: [0, -3, -2], clavicle_R: [0, -3, -2],
        ...hands({ pos: [0.14, 1.36, 0.2], palm: [-1, 0, 0], hint: [0.35, 0.9, -0.6], pivot: [0.115, 1.13, -0.02] }),
        foot_L: { pos: [0.12, 0, 0.0], rot: [0, 6, 0], hint: [0.15, 0.5, 1] },
        foot_R: { pos: [-0.12, 0, 0.0], rot: [0, -6, 0], hint: [-0.15, 0.5, 1] },
      },
      bottom: {
        ...hands({ pos: [0.09, 0.84, 0.165], palm: [-1, 0, 0.1], hint: [0.35, 0.9, -0.6], pivot: [0.115, 1.13, -0.02] }),   // (step 05) fists 4–5 cm clear of the thighs
      },
    },
  },

  {
    // ── EZ-bar curl ──
    // Hands on the inner angled grips (x = ±0.13): semi-supinated palms (~30° short of full supination) match the EZ
    // bend, which is the point of the EZ bar for a sensitive wrist. The palm vector is turned with the forearm (bottom:
    // forward-in, mid: up-in, top: back-up-in) so the wrist stays neutral relative to the bar all the way; the `mid`
    // keypose only fixes that palm rotation (hand positions follow the elbow pivot). Elbows stay at the sides, no swing.
    id: 'ez_curl',
    machine: null,
    props: [{ type: 'ez_bar', attach: 'handsMid', opts: { kgPerSide: 5 } }],
    camera: { target: [0, 1.05, 0], front: [0, 1.35, 3.3], side: [3.0, 1.25, 1.45] },
    tempo: { eccentric: 2.0, bottom: 0.3, concentric: 1.0, top: 0.4 },
    arrow: { effector: 'handsMid', offset: [0.36, 0, 0] },
    poses: {
      top: {
        pelvis: { pos: [0, 0.965, 0], rot: [2, 0, 0] },
        neck: [-2, 0, 0],
        clavicle_L: [0, -3, -2], clavicle_R: [0, -3, -2],
        ...hands({ pos: [0.13, 1.37, 0.2], palm: [-0.5, 0.56, -0.67], hint: [0.42, 0.85, -0.6], pivot: [0.13, 1.13, -0.02] }),
        foot_L: { pos: [0.12, 0, 0.0], rot: [0, 6, 0], hint: [0.15, 0.5, 1] },
        foot_R: { pos: [-0.12, 0, 0.0], rot: [0, -6, 0], hint: [-0.15, 0.5, 1] },
      },
      mid: {
        ...hands({ pos: [0.13, 1.1, 0.33], palm: [-0.5, 0.87, 0], hint: [0.42, 0.85, -0.6] }),
      },
      bottom: {
        ...hands({ pos: [0.13, 0.83, 0.165], palm: [-0.5, 0, 0.87], hint: [0.42, 0.85, -0.6], pivot: [0.13, 1.13, -0.02] }),   // (step 05) fists clear of the thighs
      },
    },
  },

  {
    // ── Rope triceps pushdown ──
    // Front column, high pulley; figure close to the column with a ~12° forward lean, elbows pinned to the sides
    // (pivot at the elbow). Top (end of concentric) = arms straight, rope ends pulled apart beside the thighs; bottom =
    // forearms about horizontal (~90° at the elbow). Neutral grip turning slightly at lockout. The cable runs down in
    // front of the face and chest without touching them.
    id: 'triceps_rope_pushdown',
    machine: 'cable_crossover',
    machineOpts: FRONT_COLUMN(-0.25),
    props: [{ type: 'triceps_rope', attach: 'handsMid' }],
    cables: [{ from: 'pulley_R_high', to: 'handsMid' }],
    camera: { target: [0, 1.15, 0.15], front: [2.2, 1.5, 2.8], side: [3.3, 1.3, 0.35] },
    tempo: { eccentric: 2.2, bottom: 0.3, concentric: 1.0, top: 0.5 },
    arrow: { effector: 'hand_L', offset: [0.1, 0, 0] },
    poses: {
      top: {
        pelvis: { pos: [0, 0.955, -0.05], rot: [12, 0, 0] },
        neck: [-8, 0, 0],
        clavicle_L: [0, -3, -2], clavicle_R: [0, -3, -2],
        ...hands({ pos: [0.17, 0.8, 0.135], palm: [-0.85, 0, -0.5], hint: [0.36, 0.9, -0.7], pivot: [0.155, 1.12, -0.04] }),   // (step 05) fists in front of the thighs, elbows off the flanks
        foot_L: { pos: [0.13, 0, 0.02], rot: [0, 6, 0], hint: [0.16, 0.5, 1] },
        foot_R: { pos: [-0.13, 0, -0.06], rot: [0, -6, 0], hint: [-0.16, 0.5, 1] },
      },
      bottom: {
        ...hands({ pos: [0.115, 1.14, 0.3], palm: [-1, 0, 0], hint: [0.36, 0.9, -0.7], pivot: [0.155, 1.12, -0.04] }),
      },
    },
  },

  {
    // ── Overhead rope extension (back to the pulley) ──
    // The BACK column's pulley is set to chest height (1.4 m); the figure faces away from it, steps forward into a split
    // stance and leans ~35° forward. Upper arms stay by the head pointing forward-up (pivot = elbow region, elbow hint in
    // front of the head so the elbows do not flare). Bottom = deep stretch with the fists behind the head; top = arms
    // extended in line with the torso. At lockout the cable clears the top of the head.
    id: 'overhead_cable_ext',
    machine: 'cable_crossover',
    machineOpts: { ...FRONT_COLUMN(0.28), heightL: 1.4 },
    props: [{ type: 'triceps_rope', attach: 'handsMid' }],
    cables: [{ from: 'pulley_L', to: 'handsMid' }],
    camera: { target: [0, 1.1, 0.15], front: [2.0, 1.45, 3.1], side: [3.4, 1.3, 0.25] },
    tempo: { eccentric: 2.5, bottom: 0.35, concentric: 1.0, top: 0.5 },
    arrow: { effector: 'hand_L', offset: [0.1, 0, 0] },
    poses: {
      top: {
        pelvis: { pos: [0, 0.9, -0.02], rot: [35, 0, 0] },
        spine: [2, 0, 0], neck: [-14, 0, 0],
        clavicle_L: [0, 0, 6], clavicle_R: [0, 0, 6],
        ...hands({ pos: [0.1, 1.74, 0.66], palm: [-1, 0, 0], hint: [0.3, 1.3, 0.9], pivot: [0.1, 1.51, 0.43] }),
        foot_L: { pos: [0.14, 0, 0.3], rot: [0, 6, 0], hint: [0.17, 0.5, 1.2] },
        foot_R: { pos: [-0.14, 0, -0.25], rot: [0, -6, 0], hint: [-0.17, 0.5, 1] },
      },
      bottom: {
        ...hands({ pos: [0.12, 1.54, 0.1], palm: [-1, 0, 0], hint: [0.16, 1.9, 0.7], pivot: [0.1, 1.51, 0.43] }),
      },
    },
  },

  {
    // ── Kneeling cable crunch ──
    // Kneeling on both knees facing the front column (high pulley), shins flat on the floor behind (feet rot.x = 180°:
    // soles up, foot tops on the floor). The pelvis does NOT move between keyposes — the crunch is pure spinal flexion
    // (spine + chest + neck), ribs towards the pelvis, elbows travel to the thighs. The rope is held beside the temples:
    // hand targets follow the head, and the `mid` keypose keeps them there half-way (the head moves on a curve).
    id: 'cable_crunch',
    machine: 'cable_crossover',
    machineOpts: FRONT_COLUMN(-0.18),
    props: [{ type: 'triceps_rope', attach: 'handsMid' }],
    cables: [{ from: 'pulley_R_high', to: 'handsMid' }],
    camera: { target: [0, 0.75, 0.1], front: [2.6, 1.25, 1.9], side: [3.2, 1.0, 0.2] },
    tempo: { eccentric: 2.3, bottom: 0.35, concentric: 1.0, top: 0.6 },
    arrow: { effector: 'chest', offset: [0.3, 0, 0] },
    poses: {
      top: {
        pelvis: { pos: [0, 0.5, 0], rot: [10, 0, 0] },
        spine: [30, 0, 0], chest: [28, 0, 0], neck: [14, 0, 0],
        ...hands({ pos: [0.115, 0.85, 0.5], palm: [-1, 0, 0], hint: [0.18, 0.2, 0.6] }),
        foot_L: { pos: [0.12, 0.155, -0.36], rot: [180, 0, 0], hint: [0.12, -0.3, 0.6] },
        foot_R: { pos: [-0.12, 0.155, -0.36], rot: [180, 0, 0], hint: [-0.12, -0.3, 0.6] },
      },
      bottom: {
        spine: [-4, 0, 0], chest: [-4, 0, 0], neck: [0, 0, 0],
        ...hands({ pos: [0.115, 1.19, 0.06], palm: [-1, 0, 0], hint: [0.25, 0.7, 0.6] }),
      },
      mid: {
        ...hands({ pos: [0.115, 1.08, 0.35], palm: [-1, 0, 0], hint: [0.22, 0.45, 0.6] }),
      },
    },
  },
];
