// Studio stage: environment lighting, key/fill/rim lights with soft shadows, floor disc and baked contact shadow.
// LIGHT BALANCE (tuned on the clay figure at phone size, tmp/fig/NOTES.md step 04b): the key carries the picture;
// environment, hemisphere and fill together are kept at about a third of it, so that a form turning away from the key
// goes visibly darker — on a light clay body that shading IS the muscle relief. (With twice the ambient light, the
// values until 2026-11, the figure was a white silhouette.) The machines keep their look: dark paint and steel take
// their brightness from the key and the rim.
// The background itself is a CSS gradient behind the transparent canvas (see explainer.js THEMES).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

function radialTexture(stops, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * theme: { floor: css colour of the floor disc centre, floorEdge, shadow: contact-shadow opacity }
 * Returns { lights, setShadows(on), setFocus(x, z, radius), dispose }.
 */
export function createStage(scene, renderer, { shadows = true, theme }) {
  const disposables = [];
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envRT = pmrem.fromScene(room, 0.035);
  room.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  pmrem.dispose();
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.28;
  disposables.push(envRT);

  // Key: warm, high front-left, casts the soft shadow.
  const key = new THREE.DirectionalLight(0xfff1e2, 2.4);
  key.userData.offset = new THREE.Vector3(2.2, 4.2, 2.8);   // from the subject's place on the floor
  key.position.copy(key.userData.offset);
  key.castShadow = shadows;
  key.shadow.mapSize.set(2048, 2048);
  // penumbra of 3 texels (≈ 6 mm): three's PCF takes 5 samples on a noise-rotated disc, and at 5 texels that noise
  // showed as grain on the body under the darker ambient of step 04b (tmp/fig/mh02/shape/r3/z_shadow_cmp.png)
  key.shadow.radius = 3;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.025;
  Object.assign(key.shadow.camera, { left: -2.2, right: 2.2, top: 2.6, bottom: -1.2, near: 0.5, far: 12 });
  key.shadow.camera.updateProjectionMatrix();
  // Fill: cool and soft from the other side; rim: strong from behind to separate the silhouette from the backdrop.
  const fill = new THREE.DirectionalLight(0xcfe0ff, 0.38);
  fill.userData.offset = new THREE.Vector3(-3, 2.0, 1.5);
  fill.position.copy(fill.userData.offset);
  const rim = new THREE.DirectionalLight(0xbfd4ff, 1.5);
  rim.userData.offset = new THREE.Vector3(-1.5, 3.2, -3.5);
  rim.position.copy(rim.userData.offset);
  const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x3a3530, 0.19);
  key.name = 'light:key'; fill.name = 'light:fill'; rim.name = 'light:rim'; hemi.name = 'light:hemi';   // (webapp/dev/tune.js finds them by name)
  const target = new THREE.Object3D();
  key.target = target; fill.target = target; rim.target = target;
  scene.add(key, fill, rim, hemi, target);

  // Floor: a soft disc that fades into the backdrop + a shadow-only layer on top.
  const floorTex = radialTexture([[0, theme.floor], [0.55, theme.floor], [1, theme.floorEdge]]);
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, transparent: true, roughness: 0.85, metalness: 0, depthWrite: false });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(3.2, 64), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.renderOrder = -2;
  const shadowMat = new THREE.ShadowMaterial({ opacity: 0.32, depthWrite: false });
  const shadowPlane = new THREE.Mesh(new THREE.CircleGeometry(3.2, 64), shadowMat);
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = 0.0005;
  shadowPlane.receiveShadow = true;
  shadowPlane.renderOrder = -1;
  // Baked contact shadow: always on (the only shadow in low quality), grounds feet and equipment.
  const contactTex = radialTexture([[0, 'rgba(0,0,0,0.55)'], [0.45, 'rgba(0,0,0,0.22)'], [1, 'rgba(0,0,0,0)']], 128);
  const contactMat = new THREE.MeshBasicMaterial({ map: contactTex, transparent: true, depthWrite: false, opacity: theme.shadow });
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), contactMat);
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.001;
  contact.renderOrder = -1;
  scene.add(floor, shadowPlane, contact);
  disposables.push(floorTex, floorMat, floor.geometry, shadowMat, shadowPlane.geometry, contactTex, contactMat, contact.geometry);

  return {
    key,
    setShadows(on) { key.castShadow = on; shadowPlane.visible = on; },
    /** Centre the lights' shadow frustum and the contact shadow on the subject. */
    setFocus(x, z, radius = 0.6) {
      target.position.set(x, 0.6, z);
      for (const l of [key, fill, rim]) l.position.set(x + l.userData.offset.x, l.userData.offset.y, z + l.userData.offset.z);
      contact.position.set(x, 0.001, z);
      contact.scale.set(radius * 2.4, radius * 2.4, 1);
    },
    dispose() {
      scene.remove(key, fill, rim, hemi, target, floor, shadowPlane, contact);
      key.shadow.map?.dispose();
      for (const d of disposables) d.dispose();
      scene.environment = null;
    },
  };
}
