// Procedural anatomical figure: bone hierarchy, one smooth skinned body with sculpted muscle relief, 18 muscle regions
// that glow per id, two-bone IK for the limbs. The body mesh is generated offline from a signed-distance anatomy
// (tools/body/, `npm run bake:body`) and loaded as a baked asset (body/loader.js → webapp/assets/body/).
// Bone frames (rest = standing, arms hanging, palms facing the thighs): +Y up the chain (limbs point along −Y),
// +Z = anterior (front), so for the LEFT side +X is lateral. Figure faces +Z; its left side is +X.
import * as THREE from 'three';
import { solveTwoBone, quatFromYZ, quatFromXY } from './ik.js';
import { resolvePose, createPose } from './pose.js';
import { DIM, MUSCLE_IDS, rigLayout, helperLayout, SKIN_BONES, bindRotations, HELPER_DRIVE } from './body/rig.js';
import { getBodyData } from './body/loader.js';
import { createBodyMaterial, createBodyDepthMaterial } from './body/material.js';

export { DIM, MUSCLE_IDS };

const HIGHLIGHT = {
  primary: { color: new THREE.Color(0xff3b30), emissive: new THREE.Color(0xff2414), rim: new THREE.Color(0xff6a4a), base: 0.3, amp: 0.6, rimBase: 0.5, rimAmp: 1.1, act: 1 },
  secondary: { color: new THREE.Color(0xffb020), emissive: new THREE.Color(0xff8c00), rim: new THREE.Color(0xffc060), base: 0.1, amp: 0.2, rimBase: 0.25, rimAmp: 0.35, act: 0.55 },
};
// Heat-map gradient stops (contract): 0 = clay, 0.1 teal → 0.5 yellow → 1 red.
const HEAT = [[0.1, new THREE.Color(0x2ec4b6)], [0.5, new THREE.Color(0xffd23f)], [1.0, new THREE.Color(0xff3b30)]];
const CLAY = 0xc9c2b9;

export function heatColor(v, out) {
  if (v <= HEAT[0][0]) return out.copy(HEAT[0][1]);
  for (let i = 1; i < HEAT.length; i++) {
    if (v <= HEAT[i][0]) return out.lerpColors(HEAT[i - 1][1], HEAT[i][1], (v - HEAT[i - 1][0]) / (HEAT[i][0] - HEAT[i - 1][0]));
  }
  return out.copy(HEAT[HEAT.length - 1][1]);
}

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _f = new THREE.Vector3(), _pp = new THREE.Vector3();
const _S = new THREE.Vector3(), _E = new THREE.Vector3(), _W = new THREE.Vector3(), _T = new THREE.Vector3();
const _pole = new THREE.Vector3(), _hint = new THREE.Vector3(), _ax = new THREE.Vector3(), _ay = new THREE.Vector3();
const _qU = new THREE.Quaternion(), _qF = new THREE.Quaternion(), _qH = new THREE.Quaternion(), _qP = new THREE.Quaternion();
const _qi = new THREE.Quaternion(), _qt = new THREE.Quaternion(), _qs = new THREE.Quaternion(), _qh = new THREE.Quaternion();
const _ID = new THREE.Quaternion();
const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _p4 = new THREE.Vector3(), _s4 = new THREE.Vector3();
const D2R = Math.PI / 180;

export function createFigure() {
  const root = new THREE.Group();
  root.name = 'figure';
  const bones = {}, helpers = {};
  for (const [name, parent, off] of rigLayout()) {
    const b = new THREE.Bone(); b.name = name; b.position.fromArray(off);
    (parent ? bones[parent] : root).add(b); bones[name] = b;
  }
  for (const [name, parent, off] of helperLayout()) {
    const b = new THREE.Bone(); b.name = name; b.position.fromArray(off);
    bones[parent].add(b); helpers[name] = b;
  }
  const allBones = { ...bones, ...helpers };
  const bindQ = {};
  for (const [name, r] of Object.entries(bindRotations())) {
    bindQ[name] = new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0] * D2R, r[1] * D2R, r[2] * D2R, 'XYZ'));
  }

  const meshes = [];
  const muscles = {};
  for (const id of MUSCLE_IDS) muscles[id] = { id, meshes, state: null, heat: 0 };
  const material = createBodyMaterial({ clay: CLAY, bones: SKIN_BONES.length });
  const U = material.userData.uniforms;
  let body = null, skeleton = null, bodyData = null, depthMaterial = null, disposed = false;

  const sides = [['L', 1], ['R', -1]].map(([S, s]) => ({
    S, s, clav: bones['clavicle_' + S], upper: bones['upperArm_' + S], fore: bones['foreArm_' + S], hand: bones['hand_' + S],
    thigh: bones['thigh_' + S], shin: bones['shin_' + S], foot: bones['foot_' + S],
    sh: helpers['sh_' + S], sq: helpers['sq_' + S], ua: helpers['ua_' + S], el: helpers['el_' + S], fr: helpers['fr_' + S], fm: helpers['fm_' + S],
    hp: helpers['hp_' + S], kn: helpers['kn_' + S], toe: helpers['toe_' + S], bi: helpers['bi_' + S], biRest: helpers['bi_' + S].position.clone(),
    rd: helpers['rd_' + S], rdRest: helpers['rd_' + S].position.clone(), hpRest: helpers['hp_' + S].position.clone(),
    bindUA: bindQ['upperArm_' + S], bindUAi: bindQ['upperArm_' + S].clone().invert(), bindTH: bindQ['thigh_' + S], bindTHi: bindQ['thigh_' + S].clone().invert(),
  }));
  const gripLocal = [new THREE.Vector3(-DIM.gripPalm, -DIM.gripAlong, 0), new THREE.Vector3(DIM.gripPalm, -DIM.gripAlong, 0)];
  const reachError = [0, 0, 0, 0];
  let current = createPose();

  function solveArm(i, H) {
    const sd = sides[i];
    sd.upper.getWorldPosition(_S);
    sd.clav.getWorldQuaternion(_qP);
    // Default elbow pole: behind and outside the shoulder→grip midpoint (relative to the chest).
    if (H.hasHint) _hint.copy(H.hint);
    else {
      bones.chest.getWorldQuaternion(_qi);
      _hint.addVectors(_S, H.pos).multiplyScalar(0.5)
        .add(_v.set(sd.s * 0.25, -0.05, -0.4).applyQuaternion(_qi));
    }
    if (H.hasQ) {
      // Explicit hand orientation: wrist target follows from the grip offset in that orientation.
      _qH.copy(H.q);
      _T.copy(gripLocal[i]).applyQuaternion(_qH).negate().add(H.pos);
      reachError[i] = solveTwoBone(_S, _T, _hint, DIM.upperArm, DIM.foreArm, _E, _W, _pole);
    } else {
      // Straight wrist: hand continues the forearm, rotated about it so the palm faces H.palm.
      _f.subVectors(H.pos, _S).normalize();
      for (let it = 0; it < 3; it++) {
        _pp.copy(H.palm).addScaledVector(_f, -H.palm.dot(_f));
        if (_pp.lengthSq() < 1e-8) _pp.set(0, 0, 1).addScaledVector(_f, -_f.z);
        _pp.normalize();
        _T.copy(H.pos).addScaledVector(_f, -DIM.gripAlong).addScaledVector(_pp, -DIM.gripPalm);
        reachError[i] = solveTwoBone(_S, _T, _hint, DIM.upperArm, DIM.foreArm, _E, _W, _pole);
        _f.subVectors(_W, _E).normalize();
      }
      // Hand basis: −Y along the fingers (= forearm), palm normal = −X (left) / +X (right).
      _ay.copy(_f).negate();
      _ax.copy(_pp).multiplyScalar(-sd.s);
      quatFromXY(_ax, _ay, _qH);
    }
    // Upper arm: +Y back to the shoulder, +Z (biceps side) away from the elbow pole.
    quatFromYZ(_v.subVectors(_S, _E), _v2.copy(_pole).negate(), _qU);
    // Forearm: along elbow→wrist, twisted to match the hand (pronation/supination lives in the forearm).
    quatFromYZ(_v.subVectors(_E, _W), _v2.set(0, 0, 1).applyQuaternion(_qH), _qF);
    sd.upper.quaternion.copy(_qP).invert().multiply(_qU);
    sd.fore.quaternion.copy(_qU).invert().multiply(_qF);
    sd.hand.quaternion.copy(_qF).invert().multiply(_qH);
  }

  function solveLeg(i, F) {
    const sd = sides[i];
    sd.thigh.getWorldPosition(_S);
    bones.pelvis.getWorldQuaternion(_qP);
    _T.set(0, DIM.ankleH, 0).applyQuaternion(F.q).add(F.pos); // ankle above the sole point
    if (F.hasHint) _hint.copy(F.hint);
    else _hint.addVectors(_S, _T).multiplyScalar(0.5).add(_v.set(0, 0, 0.6).applyQuaternion(_qP));
    reachError[2 + i] = solveTwoBone(_S, _T, _hint, DIM.thigh, DIM.shin, _E, _W, _pole);
    quatFromYZ(_v.subVectors(_S, _E), _pole, _qU); // knee cap towards the pole
    quatFromYZ(_v.subVectors(_E, _W), _pole, _qF);
    sd.thigh.quaternion.copy(_qP).invert().multiply(_qU);
    sd.shin.quaternion.copy(_qU).invert().multiply(_qF);
    sd.foot.quaternion.copy(_qF).invert().multiply(F.q);
    sd.toe.quaternion.setFromAxisAngle(_v.set(1, 0, 0), -(F.toes || 0) * D2R);   // toes bent up by the pose's angle
  }

  /**
   * Swing of a bone out of its bind rotation, without the twist about its own axis (local Y): q = bind · swing · twist.
   * Writes the swing (relative to the bind rotation) into the third argument.
   */
  function swingFromBind(q, bindInv, out) {
    out.copy(bindInv).multiply(q);
    const l = Math.hypot(out.y, out.w);
    if (l > 1e-6) { _qt.set(0, -out.y / l, 0, out.w / l); out.multiply(_qt); }   // · twist⁻¹
    return out;
  }

  /**
   * Skin-only helper bones follow the solved limbs (see body/rig.js helperLayout): shares of the upper arm's and the
   * thigh's SWING for the skin round shoulder and hip — never their twist —, half the elbow and knee flexion, the
   * forearm's pronation spread along the forearm. No allocation.
   */
  function updateHelpers() {
    for (const sd of sides) {
      swingFromBind(sd.upper.quaternion, sd.bindUAi, _qs);
      sd.ua.quaternion.copy(sd.bindUA).multiply(_qs);
      sd.sh.quaternion.copy(sd.bindUA).multiply(_qh.slerpQuaternions(_ID, _qs, 0.5));
      sd.sq.quaternion.copy(sd.bindUA).multiply(_qh.slerpQuaternions(_ID, _qs, 0.25));
      // rear deltoid: turns with sh; pushed into the arm (its local +Z = the biceps side) as the arm points forward
      sd.rd.quaternion.copy(sd.sh.quaternion);
      const fz = _v.set(0, -1, 0).applyQuaternion(sd.upper.quaternion).z;   // forward component of the arm's direction (clavicle frame)
      let fw = (fz - HELPER_DRIVE.rearDeltFwd[0]) / (HELPER_DRIVE.rearDeltFwd[1] - HELPER_DRIVE.rearDeltFwd[0]);
      fw = fw <= 0 ? 0 : fw >= 1 ? 1 : fw * fw * (3 - 2 * fw);
      sd.rd.position.copy(sd.rdRest).add(_v2.set(0, 0, HELPER_DRIVE.rearDelt * fw).applyQuaternion(sd.rd.quaternion));
      swingFromBind(sd.thigh.quaternion, sd.bindTHi, _qs);
      sd.hp.quaternion.copy(sd.bindTH).multiply(_qh.slerpQuaternions(_ID, _qs, 0.5));
      // (step 05) gluteal stretch: as the hip flexes, the buttock and the fold are drawn up and forward (pelvis frame)
      _v.set(0, -1, 0).applyQuaternion(sd.thigh.quaternion);                 // thigh direction in the pelvis frame
      let gf = (Math.atan2(_v.z, -_v.y) / D2R - HELPER_DRIVE.gluteFlex[0]) / (HELPER_DRIVE.gluteFlex[1] - HELPER_DRIVE.gluteFlex[0]);
      gf = gf <= 0 ? 0 : gf >= 1 ? 1 : gf * gf * (3 - 2 * gf);
      sd.hp.position.copy(sd.hpRest); sd.hp.position.y += HELPER_DRIVE.glute[0] * gf; sd.hp.position.z += HELPER_DRIVE.glute[1] * gf;
      const q = sd.fore.quaternion;
      // swing–twist about the forearm axis (local Y)
      _qt.set(0, q.y, 0, q.w);
      const l = Math.hypot(q.y, q.w);
      if (l < 1e-6) _qt.identity(); else _qt.set(0, q.y / l, 0, q.w / l);
      _qs.copy(_qt).invert().premultiply(q);        // swing = q · twist⁻¹
      sd.fr.quaternion.copy(_qs);
      _qh.slerpQuaternions(_ID, _qt, 0.5);
      sd.fm.quaternion.copy(_qs).multiply(_qh);
      sd.el.quaternion.slerpQuaternions(_ID, _qs, 0.5);
      // biceps: its belly rises as the elbow bends (the bone only slides forward and a little up the arm)
      const bend = 2 * Math.acos(Math.min(1, Math.abs(_qs.w))) / D2R;
      let b = (bend - HELPER_DRIVE.bicepsFlex[0]) / (HELPER_DRIVE.bicepsFlex[1] - HELPER_DRIVE.bicepsFlex[0]);
      b = b <= 0 ? 0 : b >= 1 ? 1 : b * b * (3 - 2 * b);
      sd.bi.position.copy(sd.biRest); sd.bi.position.z += HELPER_DRIVE.biceps * b; sd.bi.position.y += 0.35 * HELPER_DRIVE.biceps * b;
      // knee: half the flexion, and the cap pushed out along the bisector by sin²(flexion / 2)
      const k = sd.kn.quaternion.slerpQuaternions(_ID, sd.shin.quaternion, 0.5);
      const push = HELPER_DRIVE.kneecap * (1 - sd.shin.quaternion.w * sd.shin.quaternion.w);
      sd.kn.position.set(0, 0, push).applyQuaternion(k); sd.kn.position.y -= DIM.thigh;
    }
  }

  /** Apply a resolved pose (see pose.js): trunk rotations first, then IK for the four limbs. */
  function applyPose(rp) {
    current = rp;
    bones.pelvis.position.copy(rp.pelvisPos);
    bones.pelvis.quaternion.copy(rp.pelvisQ);
    for (const b of ['spine', 'chest', 'neck', 'head', 'clavicle_L', 'clavicle_R']) bones[b].quaternion.copy(rp[b]);
    solve();
  }

  function solve() {
    root.updateMatrixWorld(true);
    solveArm(0, current.hands[0]); solveArm(1, current.hands[1]);
    solveLeg(0, current.feet[0]); solveLeg(1, current.feet[1]);
    updateHelpers();
    root.updateMatrixWorld(true);
  }

  /** World position of an effector: hand_L/R (fist centre), handsMid, foot_L/R (sole under ankle), feetMid, pelvis, chest. */
  function getEffector(name, out) {
    switch (name) {
      case 'hand_L': return sides[0].hand.localToWorld(out.copy(gripLocal[0]));
      case 'hand_R': return sides[1].hand.localToWorld(out.copy(gripLocal[1]));
      case 'handsMid': getEffector('hand_L', out); return out.add(getEffector('hand_R', _v)).multiplyScalar(0.5);
      case 'foot_L': return sides[0].foot.localToWorld(out.set(0, -DIM.ankleH, 0));
      case 'foot_R': return sides[1].foot.localToWorld(out.set(0, -DIM.ankleH, 0));
      case 'feetMid': getEffector('foot_L', out); return out.add(getEffector('foot_R', _v)).multiplyScalar(0.5);
      case 'pelvis': return bones.pelvis.getWorldPosition(out);
      case 'chest': return bones.chest.localToWorld(out.set(0, 0.1, 0.13)); // sternum surface
      default: return null;
    }
  }

  // ── Body mesh ────────────────────────────────────────────────────────────────────────────────────────────────
  /**
   * Load the baked body (downloaded and decoded once per page and quality, see body/loader.js) and bind it to the
   * skeleton. Resolves when the figure is drawable; rejects when the asset is missing or was baked for another rig.
   */
  async function loadBody({ quality = 'high' } = {}) {
    const d = await getBodyData(quality);
    if (body || disposed) return figure;
    bodyData = d;
    // The typed arrays belong to the loader and are shared by every figure on the page; a figure only owns the
    // GPU buffers of its own geometry. Attribute names / sizes come from the asset header.
    const g = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(d.attributes)) g.setAttribute(name, new THREE.BufferAttribute(a.array, a.itemSize, a.normalized));
    g.setIndex(new THREE.BufferAttribute(d.index, 1));
    body = new THREE.SkinnedMesh(g, material);
    body.name = 'body';
    // Shadow pass: same dual-quaternion skinning as the colour pass (shared uniforms), see body/material.js.
    depthMaterial = createBodyDepthMaterial(U, { bones: SKIN_BONES.length });
    body.customDepthMaterial = depthMaterial;
    body.castShadow = true; body.receiveShadow = true; body.frustumCulled = false;
    root.add(body);
    // Bind in the A-pose: put every bone in its bind rotation, bind, then restore the current pose.
    const saved = Object.values(allBones).map((b) => [b, b.quaternion.clone(), b.position.clone()]);
    for (const b of Object.values(allBones)) b.quaternion.copy(bindQ[b.name] || _ID);
    bones.pelvis.position.set(0, DIM.pelvisY, 0);
    root.updateMatrixWorld(true);
    skeleton = new THREE.Skeleton(SKIN_BONES.map((n) => allBones[n]));
    body.bind(skeleton);
    for (const [b, q, p] of saved) { b.quaternion.copy(q); b.position.copy(p); }
    solve();
    body.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2.4);
    // Dual quaternions of the bone transforms for the DQ skinning of both passes (no allocation per frame).
    // three.js updates skeleton.boneMatrices before the shadow pass; whichever pass draws the body first in a frame
    // refreshes the uniforms, so the shadow never lags a frame behind the lit surface.
    const dq = U.uDQ.value;
    let dqFrame = -1;
    const updateDQ = (renderer) => {
      const frame = renderer?.info ? renderer.info.render.frame : -1;
      if (frame >= 0 && frame === dqFrame) return;
      dqFrame = frame;
      const bm = skeleton.boneMatrices;
      for (let i = 0; i < SKIN_BONES.length; i++) {
        _m4.fromArray(bm, i * 16).premultiply(body.bindMatrixInverse).multiply(body.bindMatrix);
        _m4.decompose(_p4, _q4, _s4);
        const qx = _q4.x, qy = _q4.y, qz = _q4.z, qw = _q4.w, tx = _p4.x, ty = _p4.y, tz = _p4.z, o = i * 8;
        dq[o] = qx; dq[o + 1] = qy; dq[o + 2] = qz; dq[o + 3] = qw;
        dq[o + 4] = 0.5 * (tx * qw + ty * qz - tz * qy);
        dq[o + 5] = 0.5 * (-tx * qz + ty * qw + tz * qx);
        dq[o + 6] = 0.5 * (tx * qy - ty * qx + tz * qw);
        dq[o + 7] = -0.5 * (tx * qx + ty * qy + tz * qz);
      }
    };
    body.onBeforeShadow = updateDQ;
    body.onBeforeRender = updateDQ;
    meshes.push(body);
    return figure;
  }

  /** Muscle id at a raycast hit on the body (null when the skin there is not a muscle). */
  function muscleAt(hit) {
    if (!hit || hit.object !== body || !hit.face) return null;
    const M = bodyData.attributes.muscle.array;
    let best = null, bw = 0.35;
    for (const v of [hit.face.a, hit.face.b, hit.face.c]) {
      for (const k of [0, 2]) {
        const id = M[4 * v + k], w = M[4 * v + k + 1];
        if (id >= 0 && w > bw) { bw = w; best = MUSCLE_IDS[id]; }
      }
    }
    return best;
  }
  /** Keep the raycast bounding sphere around the current pose (called before picking). */
  function updatePickBounds() {
    if (body) bones.pelvis.getWorldPosition(body.boundingSphere.center);
  }

  // ── Muscle colouring (uniform arrays, no allocation per frame) ─────────────────────────────────────────────────
  const clayColor = new THREE.Color(CLAY);
  const _c = new THREE.Color();
  const setV = (arr, i, c, k = 1) => arr[i].set(c.r * k, c.g * k, c.b * k);
  /** states: { muscleId: 'primary' | 'secondary' } — everything else returns to clay. */
  function setHighlight(states = {}) {
    MUSCLE_IDS.forEach((id, i) => {
      const mu = muscles[id], st = states[id] || null;
      mu.state = st; mu.heat = 0;
      const h = HIGHLIGHT[st];
      setV(U.uTint.value, i, h ? h.color : clayColor);
      setV(U.uGlow.value, i, h ? h.emissive : _c.set(0), h ? h.base : 0);
      setV(U.uRimC.value, i, _c.set(0));
      U.uAct.value[i] = h ? h.act : 0;
      U.uPump.value[i] = 0;
    });
  }
  /** a ∈ [0, 1] — current activation (0 relaxed, 1 peak of the concentric) drives the glow pulse. */
  function setActivation(a) {
    for (let i = 0; i < MUSCLE_IDS.length; i++) {
      const h = HIGHLIGHT[muscles[MUSCLE_IDS[i]].state];
      if (!h) continue;
      setV(U.uGlow.value, i, h.emissive, h.base + h.amp * a);
      setV(U.uRimC.value, i, h.rim, h.rimBase + h.rimAmp * a);
      U.uPump.value[i] = h.act * a;   // (step 04d) the working muscle swells with the pulse (material.js uPump / uSwell)
    }
  }
  /** Heat-map mode: heat = { muscleId: 0..1 }. */
  function setHeat(heat = {}) {
    MUSCLE_IDS.forEach((id, i) => {
      const mu = muscles[id], v = Math.max(0, Math.min(1, heat[id] || 0));
      mu.state = null; mu.heat = v;
      if (v <= 0.001) {
        setV(U.uTint.value, i, clayColor); setV(U.uGlow.value, i, _c.set(0)); setV(U.uRimC.value, i, _c.set(0));
        U.uAct.value[i] = 0; U.uPump.value[i] = 0;
      } else {
        heatColor(v, _c);
        setV(U.uTint.value, i, _c);
        setV(U.uGlow.value, i, _c, 0.08 + 0.22 * v);
        setV(U.uRimC.value, i, _c, 0.25 + 0.6 * v);
        U.uAct.value[i] = 0.35 * v; U.uPump.value[i] = 0;
      }
    });
  }

  function dispose() {
    disposed = true;
    skeleton?.dispose();
    body?.geometry.dispose();   // frees this figure's GPU buffers; the decoded arrays stay cached in the loader
    depthMaterial?.dispose();
    material.dispose();
  }

  const figure = {
    root, bones, helpers, muscles, meshes, dims: DIM, reachError, material,
    applyPose, solve, getEffector, setHighlight, setActivation, setHeat, dispose, loadBody, muscleAt, updatePickBounds,
    /** Convenience: resolve + apply a spec pose (plain JSON). */
    setPose(specPose) { applyPose(resolvePose(specPose)); },
    get pose() { return current; },
    get body() { return body; },
    get bodyStats() { return bodyData?.stats || null; },
  };
  figure.setPose({});
  setHighlight({});
  return figure;
}
