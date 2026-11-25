// Motion-path arrow: a curved dashed tube with flowing dashes + cone tip, drawn on top of the scene.
// Shows the working (concentric) direction; the explainer fades it in during the concentric phase.
import * as THREE from 'three';

const VERT = `varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAG = `uniform vec3 uColor; uniform float uOpacity; uniform float uTime; uniform float uDashes;
varying vec2 vUv;
void main() {
  float d = fract(vUv.x * uDashes - uTime * 1.6);
  float dash = smoothstep(0.0, 0.08, d) * (1.0 - smoothstep(0.52, 0.6, d));
  float tail = smoothstep(0.0, 0.25, vUv.x);
  gl_FragColor = vec4(uColor, dash * tail * uOpacity);
  #include <colorspace_fragment>
}`;

const _t = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

/** points: world Vector3[] from the start (bottom) to the end (top) of the working motion. */
export function createMotionArrow(points, { color = 0x6fdcff, radius = 0.0075 } = {}) {
  const group = new THREE.Group();
  group.renderOrder = 20;
  const full = new THREE.CatmullRomCurve3(points);
  const len = full.getLength();
  const tipLen = Math.min(0.075, len * 0.3);
  // Shorten the tube so it ends where the cone starts.
  const endU = 1 - tipLen / len;
  const pts = [];
  for (let i = 0; i <= 24; i++) pts.push(full.getPointAt((i / 24) * endU));
  const curve = new THREE.CatmullRomCurve3(pts);
  const uniforms = {
    uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0 }, uTime: { value: 0 },
    uDashes: { value: Math.max(3, Math.round(len / 0.045)) },
  };
  const tubeMat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false });
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, radius, 8, false), tubeMat);
  tube.renderOrder = 20;
  const coneMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(radius * 3.6, tipLen, 18), coneMat);
  cone.renderOrder = 21;
  full.getTangentAt(1, _t);
  cone.quaternion.setFromUnitVectors(_up, _t);
  cone.position.copy(full.getPointAt(1)).addScaledVector(_t, -tipLen / 2);
  group.add(tube, cone);
  return {
    group,
    length: len,
    update(opacity, time) {
      uniforms.uOpacity.value = opacity;
      uniforms.uTime.value = time;
      coneMat.opacity = opacity;
      group.visible = opacity > 0.01;
    },
    dispose() { tube.geometry.dispose(); cone.geometry.dispose(); tubeMat.dispose(); coneMat.dispose(); },
  };
}
