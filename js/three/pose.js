// Pose resolution and interpolation.
// A spec Pose (plain JSON, degrees — see docs/3D_CONTRACT.md and README.md) is resolved once into numeric form
// (Vector3 / Quaternion). The animator then blends resolved poses every frame without allocating.
import * as THREE from 'three';

const D2R = Math.PI / 180;
const _e = new THREE.Euler(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion(), _ca = new THREE.Vector3(), _cb = new THREE.Vector3();

export const BENDS = ['spine', 'chest', 'neck', 'head', 'clavicle_L', 'clavicle_R'];
export const STAND_PELVIS_Y = 0.97;

const makeEff = () => ({
  pos: new THREE.Vector3(), hint: new THREE.Vector3(), hasHint: false,
  palm: new THREE.Vector3(), hasPalm: false, q: new THREE.Quaternion(), hasQ: false,
  pivot: new THREE.Vector3(), hasPivot: false,
});

export function createPose() {
  const p = { pelvisPos: new THREE.Vector3(), pelvisQ: new THREE.Quaternion(), hands: [makeEff(), makeEff()], feet: [makeEff(), makeEff()] };
  for (const b of BENDS) p[b] = new THREE.Quaternion();
  return p;
}

function copyEff(s, d) {
  d.pos.copy(s.pos); d.hint.copy(s.hint); d.hasHint = s.hasHint; d.palm.copy(s.palm); d.hasPalm = s.hasPalm;
  d.q.copy(s.q); d.hasQ = s.hasQ; d.pivot.copy(s.pivot); d.hasPivot = s.hasPivot;
}

export function copyPose(s, d) {
  d.pelvisPos.copy(s.pelvisPos); d.pelvisQ.copy(s.pelvisQ);
  for (const b of BENDS) d[b].copy(s[b]);
  for (let i = 0; i < 2; i++) { copyEff(s.hands[i], d.hands[i]); copyEff(s.feet[i], d.feet[i]); }
  return d;
}

const eulerQ = (a, out) => out.setFromEuler(_e.set(a[0] * D2R, a[1] * D2R, a[2] * D2R, 'XYZ'));

/**
 * Resolve a spec pose. Missing fields come from `base` (a resolved pose) when given, otherwise from a relaxed
 * standing default (hands hang at the sides, feet under the hips, all relative to the pelvis).
 */
export function resolvePose(spec = {}, out = createPose(), base = null) {
  if (base) copyPose(base, out);
  const pel = spec.pelvis;
  if (pel?.pos) out.pelvisPos.fromArray(pel.pos); else if (!base) out.pelvisPos.set(0, STAND_PELVIS_Y, 0);
  if (pel?.rot) eulerQ(pel.rot, out.pelvisQ); else if (!base) out.pelvisQ.identity();

  for (const b of BENDS) {
    const a = spec[b];
    if (a) {
      // Clavicles use anatomical values for both sides: [x, protraction(+fwd), elevation(+up)] — mirrored here.
      if (b === 'clavicle_L') eulerQ([a[0], -a[1], a[2]], out[b]);
      else if (b === 'clavicle_R') eulerQ([a[0], a[1], -a[2]], out[b]);
      else eulerQ(a, out[b]);
    } else if (!base) out[b].identity();
  }

  ['L', 'R'].forEach((S, i) => {
    const s = i === 0 ? 1 : -1;
    const h = spec['hand_' + S], H = out.hands[i];
    if (h || !base) {
      if (h?.pos) H.pos.fromArray(h.pos);
      else H.pos.set(s * 0.25, -0.17, 0.04).applyQuaternion(out.pelvisQ).add(out.pelvisPos);
      H.hasHint = !!h?.hint; if (h?.hint) H.hint.fromArray(h.hint);
      H.hasQ = !!h?.rot; if (h?.rot) eulerQ(h.rot, H.q);
      H.hasPalm = !H.hasQ;
      if (h?.palm) H.palm.fromArray(h.palm).normalize();
      else H.palm.set(-s, 0, 0).applyQuaternion(out.pelvisQ); // palms face the thighs
      H.hasPivot = !!h?.pivot; if (h?.pivot) H.pivot.fromArray(h.pivot);
    }
    const f = spec['foot_' + S], F = out.feet[i];
    if (f || !base) {
      if (f?.pos) F.pos.fromArray(f.pos);
      else F.pos.set(s * 0.11, -0.975, 0.0).applyQuaternion(out.pelvisQ).add(out.pelvisPos);
      F.hasHint = !!f?.hint; if (f?.hint) F.hint.fromArray(f.hint);
      F.hasQ = true;
      if (f?.rot) eulerQ(f.rot, F.q); else if (f?.pos) F.q.identity(); else F.q.copy(out.pelvisQ);
      F.hasPivot = !!f?.pivot; if (f?.pivot) F.pivot.fromArray(f.pivot);
    }
  });
  return out;
}

/** Quadratic Bézier through m at u = 0.5 (so `mid` keyposes are actually hit). */
function bez(a, b, m, u, out) {
  _v.copy(m).multiplyScalar(2).addScaledVector(a, -0.5).addScaledVector(b, -0.5); // control point
  const k0 = (1 - u) * (1 - u), k1 = 2 * u * (1 - u), k2 = u * u;
  return out.copy(a).multiplyScalar(k0).addScaledVector(_v, k1).addScaledVector(b, k2);
}
function lerpV(a, b, m, u, out) { return m ? bez(a, b, m, u, out) : out.lerpVectors(a, b, u); }
function slerpQ(a, b, m, u, out) {
  if (!m) return out.slerpQuaternions(a, b, u);
  return u < 0.5 ? out.slerpQuaternions(a, m, u * 2) : out.slerpQuaternions(m, b, u * 2 - 1);
}

function lerpEff(A, B, M, u, O) {
  if (A.hasPivot || B.hasPivot) {
    // Arc around a pivot (e.g. shoulder for a lateral raise): rotate the offset vector, lerp its length.
    const pv = A.hasPivot ? A.pivot : B.pivot;
    _ca.subVectors(A.pos, pv); _cb.subVectors(B.pos, pv);
    const la = _ca.length(), lb = _cb.length();
    _ca.multiplyScalar(1 / la); _cb.multiplyScalar(1 / lb);
    _q.setFromUnitVectors(_ca, _cb);
    _qi.identity().slerp(_q, u);
    O.pos.copy(_ca).applyQuaternion(_qi).multiplyScalar(la + (lb - la) * u).add(pv);
    O.pivot.copy(pv); O.hasPivot = true;
  } else {
    lerpV(A.pos, B.pos, M?.pos, u, O.pos); O.hasPivot = false;
  }
  O.hasHint = A.hasHint || B.hasHint;
  if (A.hasHint && B.hasHint) lerpV(A.hint, B.hint, M?.hasHint ? M.hint : null, u, O.hint);
  else if (O.hasHint) O.hint.copy(A.hasHint ? A.hint : B.hint);
  O.hasQ = A.hasQ && B.hasQ;
  if (O.hasQ) slerpQ(A.q, B.q, M?.hasQ ? M.q : null, u, O.q);
  O.hasPalm = !O.hasQ;
  if (O.hasPalm) {
    const pa = A.hasPalm ? A.palm : _v2.set(0, 0, 0), pb = B.hasPalm ? B.palm : pa;
    if (M?.hasPalm) {
      if (u < 0.5) O.palm.lerpVectors(pa, M.palm, u * 2); else O.palm.lerpVectors(M.palm, pb, u * 2 - 1);
    } else O.palm.lerpVectors(pa, pb, u);
    if (O.palm.lengthSq() < 1e-6) O.palm.copy(pb);
    O.palm.normalize();
  }
}

/** out = blend(A → B) at u ∈ [0, 1], optionally passing through M at u = 0.5. */
export function lerpPose(A, B, M, u, out) {
  lerpV(A.pelvisPos, B.pelvisPos, M?.pelvisPos, u, out.pelvisPos);
  slerpQ(A.pelvisQ, B.pelvisQ, M?.pelvisQ, u, out.pelvisQ);
  for (const b of BENDS) slerpQ(A[b], B[b], M?.[b], u, out[b]);
  for (let i = 0; i < 2; i++) {
    lerpEff(A.hands[i], B.hands[i], M?.hands[i], u, out.hands[i]);
    lerpEff(A.feet[i], B.feet[i], M?.feet[i], u, out.feet[i]);
  }
  return out;
}
