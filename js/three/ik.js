// Analytic two-bone IK (law of cosines) + basis helpers. All math is allocation-free (module scratch vectors).
import * as THREE from 'three';

const _d = new THREE.Vector3(), _p = new THREE.Vector3(), _m = new THREE.Matrix4();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();

/**
 * Solve a two-segment chain root → mid → end.
 * root, target, pole: world Vector3. a, b: segment lengths.
 * Writes outMid (elbow/knee), outEnd (reached end, clamped to reach), outPole (unit vector ⟂ root→end, towards pole).
 * Returns how far the target was out of reach (metres, 0 when reachable).
 */
export function solveTwoBone(root, target, pole, a, b, outMid, outEnd, outPole) {
  _d.subVectors(target, root);
  let d = _d.length();
  if (d < 1e-6) { _d.set(0, -1, 0); d = 1e-6; } else _d.multiplyScalar(1 / d);
  const maxR = (a + b) * 0.9995, minR = Math.abs(a - b) + 0.02;
  const dc = Math.min(Math.max(d, minR), maxR);
  const cosA = THREE.MathUtils.clamp((a * a + dc * dc - b * b) / (2 * a * dc), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _p.subVectors(pole, root);
  _p.addScaledVector(_d, -_p.dot(_d));
  if (_p.lengthSq() < 1e-10) { // pole on the line: pick any perpendicular
    _p.set(0, 0, 1).addScaledVector(_d, -_d.z);
    if (_p.lengthSq() < 1e-6) _p.set(1, 0, 0).addScaledVector(_d, -_d.x);
  }
  _p.normalize();
  outPole.copy(_p);
  outMid.copy(root).addScaledVector(_d, a * cosA).addScaledVector(_p, a * sinA);
  outEnd.copy(root).addScaledVector(_d, dc);
  return Math.max(0, d - maxR);
}

/** Quaternion whose local +Y maps to `yAxis` and local +Z points as close as possible to `zHint`. */
export function quatFromYZ(yAxis, zHint, out) {
  _y.copy(yAxis).normalize();
  _z.copy(zHint).addScaledVector(_y, -zHint.dot(_y));
  if (_z.lengthSq() < 1e-10) { _z.set(0, 0, 1).addScaledVector(_y, -_y.z); if (_z.lengthSq() < 1e-6) _z.set(1, 0, 0).addScaledVector(_y, -_y.x); }
  _z.normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

/** Quaternion from an orthonormal-ish X and Y (Z = X × Y, X re-orthogonalised). */
export function quatFromXY(xAxis, yAxis, out) {
  _y.copy(yAxis).normalize();
  _x.copy(xAxis).addScaledVector(_y, -xAxis.dot(_y)).normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}
