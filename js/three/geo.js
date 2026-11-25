// Geometry helpers for the procedural mannequin and equipment.
// loftGeometry — smooth closed body segment from a few cross-section rings (Catmull-Rom between rings).
// spindle      — a muscle belly between two points (tapered "tendon" ends, flat on the body side).
import * as THREE from 'three';

const KEYS = ['y', 'w', 'f', 'b', 'x', 'z', 'n'];
const cr = (p0, p1, p2, p3, t) => {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};
const normRing = (r) => ({ y: r.y, w: r.w, f: r.f ?? r.w, b: r.b ?? r.f ?? r.w, x: r.x ?? 0, z: r.z ?? 0, n: r.n ?? 2 });

/**
 * Ring = { y, w (half-width along X), f (depth towards +Z), b (depth towards −Z), x, z (centre offset), n (superellipse
 * exponent: 2 = ellipse, >2 = boxier) }. Rings must be ordered along y (either direction).
 * opts: radial segments, sub = interpolated rings between keys, domeStart/domeEnd = height of a rounded cap.
 */
export function loftGeometry(ringsIn, { radial = 24, sub = 3, domeStart = 0, domeEnd = 0, domeSteps = 4 } = {}) {
  const rings = ringsIn.map(normRing);
  const dense = [];
  for (let i = 0; i < rings.length - 1; i++) {
    const p0 = rings[Math.max(i - 1, 0)], p1 = rings[i], p2 = rings[i + 1], p3 = rings[Math.min(i + 2, rings.length - 1)];
    for (let s = 0; s < sub; s++) {
      const t = s / sub, r = {};
      for (const k of KEYS) r[k] = cr(p0[k], p1[k], p2[k], p3[k], t);
      r.w = Math.max(r.w, 1e-4); r.f = Math.max(r.f, 1e-4); r.b = Math.max(r.b, 1e-4);
      dense.push(r);
    }
  }
  dense.push({ ...rings[rings.length - 1] });
  const dir = Math.sign(dense[dense.length - 1].y - dense[0].y) || 1;

  // Rounded caps: shrink the end ring along a quarter circle, then close with a pole vertex.
  const dome = (ring, h, sgn) => {
    const out = [];
    for (let k = 1; k < domeSteps; k++) {
      const th = (k / domeSteps) * Math.PI / 2, c = Math.cos(th);
      out.push({ ...ring, y: ring.y + sgn * h * Math.sin(th), w: ring.w * c, f: ring.f * c, b: ring.b * c });
    }
    return { rings: out, pole: { x: ring.x, y: ring.y + sgn * h, z: ring.z } };
  };
  let startPole = { x: dense[0].x, y: dense[0].y, z: dense[0].z };
  let endPole = { x: dense[dense.length - 1].x, y: dense[dense.length - 1].y, z: dense[dense.length - 1].z };
  if (domeStart > 0) { const d = dome(dense[0], domeStart, -dir); dense.unshift(...d.rings.reverse()); startPole = d.pole; }
  if (domeEnd > 0) { const d = dome(dense[dense.length - 1], domeEnd, dir); dense.push(...d.rings); endPole = d.pole; }

  const R = radial, pos = [];
  for (const r of dense) {
    const e = 2 / r.n;
    for (let j = 0; j < R; j++) {
      const a = (j / R) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      pos.push(r.x + r.w * Math.sign(c) * Math.abs(c) ** e, r.y, r.z + (s >= 0 ? r.f : r.b) * Math.sign(s) * Math.abs(s) ** e);
    }
  }
  const P0 = pos.length / 3; pos.push(startPole.x, startPole.y, startPole.z);
  const P1 = P0 + 1; pos.push(endPole.x, endPole.y, endPole.z);
  const idx = [];
  for (let i = 0; i < dense.length - 1; i++) {
    for (let j = 0; j < R; j++) {
      const a = i * R + j, b = i * R + (j + 1) % R, c = (i + 1) * R + j, d = (i + 1) * R + (j + 1) % R;
      idx.push(a, c, b, b, c, d);
    }
  }
  const last = (dense.length - 1) * R;
  for (let j = 0; j < R; j++) {
    idx.push(P0, j, (j + 1) % R);
    idx.push(P1, last + (j + 1) % R, last + j);
  }
  if (dir < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();

/**
 * Muscle belly from p0 to p1 (bone-local, metres). `out` = rough outward surface normal (the belly bulges that way).
 * w = half-width, t = height above the base, back = depth below the base (sinks into the body), peak = where along
 * the length the belly is thickest (0..1), bow = outward curvature of the axis, ends = width fraction at the tendons.
 */
export function spindle(p0, p1, { w, t, back = t * 0.6, out = [0, 0, 1], peak = 0.5, bow = 0, ends = [0.3, 0.3], n = 2,
  rings = 6, radial = 12, sharp = 0.75 } = {}) {
  const a = new THREE.Vector3(...p0), b = new THREE.Vector3(...p1);
  const L = a.distanceTo(b);
  const k = Math.log(0.5) / Math.log(Math.min(Math.max(peak, 0.05), 0.95));
  const rs = [];
  for (let i = 0; i <= rings; i++) {
    const s = i / rings, base = Math.sin(Math.PI * s ** k) ** sharp;
    const e = ends[0] + (ends[1] - ends[0]) * s;
    const pw = e + (1 - e) * base, pt = 0.15 + 0.85 * base;
    rs.push({ y: s * L, w: w * pw, f: t * pt, b: back * pt, z: bow * 4 * s * (1 - s), n });
  }
  const g = loftGeometry(rs, { radial, sub: 2, domeStart: w * ends[0] * 0.9, domeEnd: w * ends[1] * 0.9, domeSteps: 3 });
  _y.subVectors(b, a).normalize();
  _z.set(...out); _z.addScaledVector(_y, -_z.dot(_y));
  if (_z.lengthSq() < 1e-8) _z.set(0, 0, 1);
  _z.normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z).setPosition(a);
  g.applyMatrix4(_m);
  return g;
}

/** Lathe from a 2D profile [[r, y], ...] — used for plates, dumbbell heads, pulleys (axis = Y). */
export function lathe(profile, segments = 32) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

/** Rounded-edge disc profile (radius r, thickness h, fillet f) centred at y = 0. */
export function discProfile(r, h, f = Math.min(0.006, h * 0.3), inner = 0) {
  const p = [];
  const steps = 4;
  p.push([inner, -h / 2]);
  for (let i = 0; i <= steps; i++) { const a = -Math.PI / 2 + (i / steps) * Math.PI / 2; p.push([r - f + Math.cos(a) * f, -h / 2 + f + Math.sin(a) * f]); }
  for (let i = 0; i <= steps; i++) { const a = (i / steps) * Math.PI / 2; p.push([r - f + Math.cos(a) * f, h / 2 - f + Math.sin(a) * f]); }
  p.push([inner, h / 2]);
  return p;
}

/** Unit cylinder spanning y ∈ [0, 1] — scaled/oriented per frame for cables and rope strands. */
export function unitCylinder(radius, radial = 8) {
  const g = new THREE.CylinderGeometry(radius, radius, 1, radial, 1, true);
  g.translate(0, 0.5, 0);
  return g;
}

const _up = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3();
/** Place a unitCylinder mesh between two world points (no allocation). */
export function stretchBetween(mesh, from, to) {
  _d.subVectors(to, from);
  const len = _d.length();
  mesh.position.copy(from);
  if (len > 1e-6) mesh.quaternion.setFromUnitVectors(_up, _d.multiplyScalar(1 / len));
  mesh.scale.set(1, Math.max(len, 1e-4), 1);
  return len;
}
