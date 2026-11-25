# 3D explainer engine — authoring guide

Contract: `docs/3D_CONTRACT.md`. This file is the practical guide for writing **animation specs**
(`anims/*.js`) and **machines** (`machines/*.js`). All numbers below are measured on the real figure.

## Files

| file | what |
|---|---|
| `explainer.js` | public API (`createExplainer`), render loop, camera views, cables/movers/arrow wiring |
| `figure.js` | mannequin, bones, 18 muscle overlays, two-bone IK (`DIM` = body dimensions) |
| `pose.js` | spec pose → numeric pose, interpolation (`mid`, `pivot`) |
| `animator.js` | rep timeline (tempo, easing, phases, glow activation, freeze) |
| `ik.js`, `geo.js` | IK math; loft/spindle/lathe geometry helpers |
| `props.js` | dumbbell, barbell, ez_bar, triceps_rope, d_handle, v_handle, lat_bar, plate, hip_pad |
| `machines/index.js` | registry; `machines/common.js` = bench_flat, bench_adjustable, rack, cable_crossover, smith |
| `machines/{chest_shoulders,back,legs,posterior_core}.js` | batch files for new machines (`export default { key: factory }`) |
| `anims/index.js` | registry; batch files `anims/{chest_shoulders,back,cables_arms,legs,posterior_core}.js` |
| `scene.js`, `overlay.js`, `materials.js` | studio lights/floor, motion arrow, shared materials |

Reference specs to copy: **`db_bench_press`** (lying on a bench, dumbbells), **`db_lateral_raise`** (standing,
arc motion with `pivot`), **`bb_rdl`** (two-hand barbell, hip hinge, `mid` keypose).

## Preview while authoring

- `dev/3d.html?ex=<id>` — live loop. `&t=0..1` freezes (0 = top pose, 1 = bottom pose), `&view=front|side|threeQuarter|back|top`,
  `&q=low`, `&theme=light`, `&body=1` (heat map). Console errors appear in a red box.
- `dev/sheet.html?ex=<id>` — 2×2 stills (top/bottom × front/side). `?exs=a,b,c` = one row per exercise.
  Extra: `&views=front,side,back&ts=0,0.5,1&size=420`.
- Screenshot: `node tools/shots.mjs "/dev/sheet.html?ex=<id>" "C:\...\tmp\x.png" 6000 900 900`, then look at the PNG.
- Unregistered spec: `await __explainer.loadSpec({ id: 'x', ...spec })` in the console (or `--eval` of shots.mjs).
- **Reach warnings**: on load the engine samples one rep and logs
  `[explainer] <id>: hand_L target out of reach by N cm (u=…)` when a hand/foot target is > 2 cm beyond the limb.
  A reference-quality spec has **no warnings** (feet that cannot reach float above the floor!).

## Coordinates

Metres, **Y up, floor y = 0**, the figure faces **+Z**, its **left side is +X**. Angles in specs are **degrees**.
Machines are built in world coordinates around the origin; the figure is posed into them.

### Body dimensions (`DIM` in figure.js)

| | value |
|---|---|
| height | ≈ 1.78 (top of head) |
| pelvis (hip-joint centre) standing | **y = 0.965–0.97** (0.98 = locked knees) |
| hip joints | pelvis ± 0.10 in X |
| shoulder joint, standing | ≈ **(±0.20, 1.43, −0.035)** |
| upper arm / forearm / grip offset | 0.30 / 0.27 / 0.075 (wrist → fist centre) |
| hands hanging relaxed (fist centre) | ≈ (±0.245, 0.81, 0.05) |
| arm reach shoulder → fist centre | 0.645 straight; use ≤ 0.63 for a soft elbow |
| thigh / shin | 0.45 / 0.44, ankle 0.085 above the sole |
| body thickness | back surface ≈ 0.10–0.11 behind the spine axis, chest front ≈ 0.13 in front |

## Spec format

```js
{
  id: 'db_bench_press',            // = exercise id in js/data/exercises.js
  machine: 'bench_flat',           // registry key or null
  machineOpts: { incline: 30 },    // passed to the factory; generic: at: [x,y,z], yaw: degrees
  props: [{ type, attach, opts, pos, rot, offset }],
  cables: [{ from: 'pulley_L_high', to: 'hand_L', stack?, ratio? }],
  movers: [{ part: 'bar', follow: 'handsMid', axis: [0, 1, 0], scale?: 1 }],
  camera: { target, front, side, back?, threeQuarter?, top? },   // world points
  tempo: { eccentric: 2, bottom: 0.4, concentric: 1, top: 0.6 }, // seconds
  arrow: { effector: 'hand_L', offset: [0.14, 0, 0], color? } | false,
  muscles?: { primary: [...], secondary: [...] },  // optional override of exercises.js
  poses: { top: Pose, bottom: Pose, mid?: Pose },
}
```

- **top** = end of the concentric (lockout / contracted), **bottom** = end of the eccentric (stretch).
  Loop: top → eccentric → bottom hold → concentric → top hold. The primary muscles pulse red with the concentric.
  **Pulls:** `top` has the handle *at the body* (pulldown: hands low at the upper chest), `bottom` = arms extended.
  Do not read "top" as "arms up". `node tools/test/anims.test.mjs` fails on an inverted push/pull and on reach errors.
- `bottom` and `mid` inherit everything they don't specify from `top` (mid: from the halfway blend), so only
  write what changes.
- `mid` is hit exactly at the half-way point (quadratic Bézier for positions, two-step slerp for rotations).
  Use it to bend a path around the body (RDL bar around the knees) or to make the hips lead.

### Pose

```js
{
  pelvis: { pos: [x, y, z], rot: [x, y, z] },  // WORLD. rot.x > 0 tips the torso forward; −90 = lying on the back
  spine: [x, y, z], chest: [...], neck: [...], head: [...],  // local: x > 0 flexion (forward), x < 0 extension
  clavicle_L: [0, protraction, elevation],      // same numbers for both sides (mirrored internally); −y = retract
  hand_L: { pos, palm?, rot?, hint?, pivot? },  // pos = FIST CENTRE (= where the handle is), world
  foot_L: { pos, rot?, hint? },                 // pos = point on the SOLE under the ankle, world (y = 0 on floor)
}
```

**Hands.** `pos` is the fist centre; any held prop's handle passes through it. Wrist care is built in: the hand
always continues the forearm (straight wrist) and `palm` only rotates hand+forearm so the palm faces that world
direction. Typical palms: neutral grip `[-1,0,0]` (left) / `[1,0,0]` (right); overhand on a bar at the thighs
`[0,0,-1]`; bench press semi-neutral `[-0.7,0,0.7]` / `[0.7,0,0.7]`; palms down `[0,-1,0]`.
The handle axis through the fist = the thumb direction = perpendicular to both palm and forearm — e.g. for a
barbell the bar axis is ±X, so pick palms ⟂ X. `rot` (world euler) instead of `palm` sets the hand
orientation fully (the wrist may then bend — avoid for this user).
**`hint`** = elbow pole (world point the elbow points towards): behind/outside the body for pressing and rows,
below the bench for lying presses, up/back for raises. Default: behind and outside the shoulder.
**`pivot`** (world point, usually the shoulder) makes the hand travel on an arc around it instead of a straight line.

**Feet.** Default `rot` = `[0,0,0]` (flat, toes +Z). Toes out: left `[0, 6, 0]`, right `[0, -6, 0]`.
`hint` = knee pole, in front of the knee (e.g. `[±0.18, 0.5, 1]`); for lying with knees up `[±0.55, 1.1, 0.95]`.

### Effectors (cables, movers, arrow, attach)

`hand_L`, `hand_R` (fist centres), `handsMid`, `foot_L`, `foot_R` (sole under the ankle), `feetMid`, `pelvis`
(hip-joint centre), `chest` (sternum surface).

## Props

| type | frame / notes | opts |
|---|---|---|
| `dumbbell` | handle along local Z (the grip axis), centred in the fist; head size scales with kg | `kg` |
| `barbell` | 2.2 m Olympic, axis X; plates per side (25/20/15/10 kg = Ø 45 cm, 5 = 23 cm, 2.5, 1.25) | `kgPerSide`, `pad` |
| `ez_bar` | 1.2 m, W-bends; put the hands at x = ±0.13 | `kgPerSide` |
| `triceps_rope` | `attach: 'handsMid'`; strands run clip → each fist; the clip points at the cable anchor | — |
| `d_handle` | hand-held; the stirrup swings to point at its cable's anchor; cable ends at its ring | — |
| `v_handle` | `handsMid`; two parallel grips follow the hand spacing (keep ~0.12 m) | — |
| `lat_bar` | `handsMid`; 1.2 m with angled ends, grips at \|x\| 0.41–0.58 | — |
| `plate`, `hip_pad` | standalone (`attach: null`, `pos`, `rot`) or held | `kg` |

`attach`: `'hand_L' | 'hand_R'` (moves with the hand bone), `'handsMid'` (centred between the fists, local X towards
the left fist, local Y towards its cable anchor or up), any other effector (follows its position), `null` (static at
`pos`/`rot`). A cable whose `to` is an effector that holds a prop with a cable point (rope, handles, lat bar) ends
on that prop automatically; `to: 'prop:<index>'` addresses a prop explicitly.

## Machines (common.js)

| key | geometry (world) | anchors / parts |
|---|---|---|
| `bench_flat` | pad top **y = 0.45**, along Z from **z = −0.75 (head)** to **+0.45 (feet)**, width 0.28 (`BENCH_FLAT`) | `padTop`, `headEnd`, `footEnd` |
| `bench_adjustable` | `opts.incline` 0–85°; seat top y ≈ 0.46 at z 0.04…0.42, back pad hinged at (0, 0.46, 0.04) towards −Z. `adjustableBenchFrame(incline)` → `{hinge, dir, normal, seatTop}`; **`adjustableBenchPelvis(incline)` → ready pelvis `{pos, rot}`** (verified 0°, 30°, 45°, 85°) | `hinge`, `seatTop`, `backTop`; parts `back`, `seat` |
| `rack` | uprights x = ±0.62, front z = +0.30 (J-hooks), back z = −0.85; `opts.jHeight` (1.35), `safetyHeight` (0.55) | `bar_rest` (0, jH+0.025, 0.2125), `jhook_L/R`, `safety_L/R` |
| `cable_crossover` | columns x = ±0.85; pulley exits at **x = ±0.73, z = 0.02**, y = high 2.0 / mid 1.3 / low 0.2 (or a number). Heights from `opts.heightL/heightR/height`, else inferred from cable anchors like `pulley_L_low` | `pulley_L`, `pulley_R`, `pulley_<L/R>_<preset>`; parts `stack_L/R` (rise by cable travel × 0.5) |
| `smith` | guide rods x = ±0.62, z = 0; `opts.barHeight` (1.0), `kgPerSide` (10) | part **`bar`** (use a mover), anchor `bar` |

New machine: add `key: (opts) => ({ group, parts, anchors, cableStacks?, stackRatio?, update? })` to a batch file.
Anchors are world `Vector3`s. Reuse materials from `getMaterials()` (steel/frame/chrome/upholstery/rubber/stack/
cable/accent, and `frameRed` for red machine frames) and import the geometry helpers `rbox, beam, rod, cylX` from
`machines/common.js`. Unknown keys only warn — the exercise is shown without the machine.

**Levers.** Movers only translate parts. Plate-loaded/selectorized levers are turned in `update()` from invisible
tracker parts that movers bind to an effector (`LEVER_MOVERS` in back.js, `trackMovers()` in legs.js, the two probes
in posterior_core.js, `driveMovers()` in chest_shoulders.js). Such machines must not be moved with `machineOpts.at/yaw`.

## Machines (batch files)

Each batch exports its geometry so poses and moving parts come from the same numbers.

| file | keys | exported geometry |
|---|---|---|
| `chest_shoulders.js` | `bench_rack`, `smith_bench` (`benchZ` + smith opts), `smith_incline`, `chest_press`, `pec_deck` (`pivotZ, r, handY, hand, handRest`), `shoulder_press`, `lateral_raise` | `SEAT`, `seatedShoulder()`, `CHEST_PRESS`, `chestPressHand()`, `PEC_DECK`, `pecDeckHand()`, `SHOULDER_PRESS`, `shoulderPressHand()`, `LATERAL_RAISE`, `lateralRaiseHand()`, `SMITH_INCLINE` |
| `back.js` | `lat_pulldown`, `high_row`, `assisted_pullup` (`padTop`), `seated_row`, `row`, `hyperextension` | `LAT_PULLDOWN`, `HIGH_ROW`, `ASSIST`, `SEATED_ROW`, `ROW`, `HYPER`, `hyperFrame()`, `leverHandle()`, `LEVER_MOVERS` |
| `legs.js` | `hack_squat`, `leg_press`, `leg_extension`, `calf_raise`, `seated_calf` | `HACK`, `LEG_PRESS`, `legPressPlate()`, `LEG_EXT`, `CALF_STAND`, `SEATED_CALF` |
| `posterior_core.js` | `lying_leg_curl`, `seated_leg_curl`, `captains_chair`, `hip_thrust_bench`, `hip_thrust_smith`, `exercise_mat` | `LYING_CURL`, `SEATED_CURL`, `curlFoot()`, `CAPTAIN`, `HIP_THRUST`, `MAT_TOP` |

Single-column cable exercises: `cable_crossover` with `machineOpts { yaw: 90, at: [0, 0, dz] }` puts the right
column in front of the figure (pulley exit ≈ (0.02, h, 0.73 + dz)) and the left one behind it. Put a hand `pivot`
in the same plane as both hand keyposes, otherwise the arc swings sideways at mid-rep.

## Typical positions (copy these)

- **Standing**: `pelvis.pos [0, 0.965, 0]`; feet `[±0.12, 0, 0]` (hip width) to `[±0.18, 0, 0.05]` (squat stance).
  Forward lean of the trunk = `pelvis.rot.x` (6° for raises, 30–45° bent-over, 80° RDL bottom).
- **Lying on the flat bench**: `pelvis.pos [0, 0.45 + 0.12, 0.2]`, `rot [-84, 0, 0]` + `spine [-6,0,0]` (small arch),
  `neck [-6,0,0]`. Shoulder joints end up at ≈ (±0.20, 0.53, −0.25); presses lock out at y ≈ 1.15 over the
  shoulders, the bottom is beside the chest at y ≈ 0.70. Feet `[±0.30, 0, 0.74]`.
- **Inclined / seated on the adjustable bench**: `pelvis: adjustableBenchPelvis(incline)`; feet ≈ `[±0.25, 0, 0.6]`.
- **Hands at a barbell on the thighs**: `[±0.235, 0.80, 0.12]`, palms `[0,0,-1]`.
- **Cable station**: the figure stands at the origin between the columns (or steps forward, z ≈ 0.3).
  Facing a single column: `pelvis.rot [x, 90, 0]` faces +X (towards the left column), stand at x ≈ 0.4–0.5.

## Worked example — dumbbell lateral raise (cables_arms.js)

```js
const SHOULDER_L = [0.2, 1.43, 0.04];   // shoulder joint with a 6° forward lean
{
  id: 'db_lateral_raise', machine: null,
  props: [{ type: 'dumbbell', attach: 'hand_L', opts: { kg: 8 } }, { type: 'dumbbell', attach: 'hand_R', opts: { kg: 8 } }],
  camera: { target: [0, 1.05, 0], front: [0, 1.35, 3.3], side: [3.2, 1.3, 0.6] },
  tempo: { eccentric: 2.2, bottom: 0.3, concentric: 1.1, top: 0.35 },
  arrow: { effector: 'hand_L', offset: [0.11, 0.06, 0] },
  poses: {
    top: {                                    // arms at shoulder height (end of the concentric)
      pelvis: { pos: [0, 0.962, -0.01], rot: [6, 0, 0] },
      hand_L: { pos: [0.8, 1.39, 0.2], palm: [0, -1, 0.1], hint: [0.55, 1.75, -0.25], pivot: SHOULDER_L },
      foot_L: { pos: [0.12, 0, 0], rot: [0, 6, 0] },   // …and the mirrored _R entries
    },
    bottom: {                                 // only what changes: hands at the thighs, palms in
      hand_L: { pos: [0.21, 0.83, 0.13], palm: [-1, 0, 0.15], hint: [0.55, 1.05, -0.35], pivot: SHOULDER_L },
    },
  },
}
```

Steps: (1) put the pelvis and feet; (2) place the fists where the handles must be at the top and bottom, checking
the distance to the shoulder (≤ 0.63 for a soft elbow); (3) set palms and elbow hints; (4) open
`dev/sheet.html?ex=<id>` — check no reach warnings, feet on the floor, body on the pad, hands on the handles;
(5) add `mid` or `pivot` if the path cuts through the body.

## Performance budget

Figure ≈ 50k triangles (muscles do not cast shadows); `renderer.info.render.triangles` incl. the shadow pass:
79–83k for the reference specs, 86–109k with the rack / Smith / cable station (limit 150k). Keep machines under ~15k triangles; reuse geometries within a
factory; never allocate in per-frame `update()`.
