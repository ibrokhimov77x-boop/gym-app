// 3D exercise explainer — public API per docs/3D_CONTRACT.md.
//   const ex = await createExplainer(el, { quality: 'high' | 'low', theme: 'dark' | 'light', autoQuality });
//   await ex.load(id); ex.play(); ex.pause(); ex.setSpeed(1.5); ex.setView('side'); ex.onPhase(cb);
//   await ex.showBody({ heat, autoRotate }); ex.onMuscleTap(cb); ex.dispose();
// Extras for tooling/tests: ex.freeze(t), ex.snapshot({ t, view }), ex.info().
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createFigure } from './figure.js';
import { Animator } from './animator.js';
import { createStage } from './scene.js';
import { createProp } from './props.js';
import { buildMachine } from './machines/index.js';
import { getSpec } from './anims/index.js';
import { createMotionArrow } from './overlay.js';
import { unitCylinder, stretchBetween } from './geo.js';
import { getMaterials, disposeMaterials } from './materials.js';
import { EXERCISES } from '../data/exercises.js';

// Backdrop gradient stops are shared by the CSS background and by snapshot() (which bakes them into the PNG).
const THEMES = {
  dark: { stops: [[0, '#3b4352'], [0.52, '#242a35'], [1, '#12151b']], floor: 'rgba(92,100,116,0.75)', floorEdge: 'rgba(40,45,55,0)', shadow: 0.6 },
  light: { stops: [[0, '#ffffff'], [0.55, '#e8ebf0'], [1, '#cfd5de']], floor: 'rgba(255,255,255,0.9)', floorEdge: 'rgba(225,229,236,0)', shadow: 0.35 },
};
const cssBackdrop = (t) => `radial-gradient(125% 95% at 50% 38%, ${t.stops.map(([o, c]) => `${c} ${o * 100}%`).join(', ')})`;

/** Draw the WebGL canvas over the theme backdrop (same geometry as the CSS radial gradient). */
function compositeSnapshot(glCanvas, theme) {
  const w = glCanvas.width, h = glCanvas.height;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const cx = w / 2, cy = h * 0.38, rx = w * 1.25, ry = h * 0.95;
  g.save();
  g.translate(cx, cy); g.scale(1, ry / rx);
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy) * rx / ry) * 0.8);
  for (const [o, col] of theme.stops) grd.addColorStop(o, col);
  g.fillStyle = grd; g.fillRect(-cx, -cy * rx / ry, w, h * rx / ry);
  g.restore();
  g.drawImage(glCanvas, 0, 0);
  return c.toDataURL('image/png');
}

// Relaxed standing pose (fallback when an exercise has no spec) and the A-pose for the muscle map.
const STAND = {
  pelvis: { pos: [0, 0.965, 0] },
  hand_L: { pos: [0.245, 0.81, 0.05], palm: [-1, 0, 0.1], hint: [0.6, 1.1, -0.5] },
  hand_R: { pos: [-0.245, 0.81, 0.05], palm: [1, 0, 0.1], hint: [-0.6, 1.1, -0.5] },
  foot_L: { pos: [0.11, 0, 0.0], rot: [0, 6, 0] },
  foot_R: { pos: [-0.11, 0, 0.0], rot: [0, -6, 0] },
};
const BODY_POSE = {
  ...STAND,
  hand_L: { pos: [0.36, 0.86, 0.03], palm: [-0.6, 0, 0.8], hint: [0.6, 1.2, -0.5] },
  hand_R: { pos: [-0.36, 0.86, 0.03], palm: [0.6, 0, 0.8], hint: [-0.6, 1.2, -0.5] },
  foot_L: { pos: [0.13, 0, 0.0], rot: [0, 8, 0] },
  foot_R: { pos: [-0.13, 0, 0.0], rot: [0, -8, 0] },
};
const EFFECTORS = ['hand_L', 'hand_R', 'handsMid', 'foot_L', 'foot_R', 'feetMid', 'pelvis', 'chest'];
const VIEW_NAMES = ['front', 'side', 'threeQuarter', 'back', 'top'];

const smooth = (x) => x * x * (3 - 2 * x);
const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const V3 = (a) => new THREE.Vector3().fromArray(a);
let alive = 0;

/** Camera presets from spec.camera { target, front, side, [view]: [x,y,z] overrides }. */
function computeViews(cam = {}) {
  const target = V3(cam.target || [0, 0.95, 0]);
  const front = V3(cam.front || [0, 1.25, 3.4]);
  const side = V3(cam.side || [3.4, 1.25, 0]);
  const fo = front.clone().sub(target), so = side.clone().sub(target);
  const r = (fo.length() + so.length()) / 2;
  const tq = fo.clone().normalize().add(so.clone().normalize()).setY(0).normalize().multiplyScalar(r * 0.94);
  tq.y = (fo.y + so.y) / 2 + 0.15;
  const views = {
    front, side,
    back: new THREE.Vector3(target.x - fo.x, front.y, target.z - fo.z),
    threeQuarter: target.clone().add(tq),
    top: target.clone().add(new THREE.Vector3(fo.x * 0.25, r * 0.95, fo.z * 0.25 + 0.01)),
  };
  for (const n of VIEW_NAMES) if (cam[n] && n !== 'front' && n !== 'side') views[n] = V3(cam[n]);
  return { target, views };
}

export async function createExplainer(container, opts = {}) {
  const quality = opts.quality === 'low' ? 'low' : 'high';
  const theme = THEMES[opts.theme] || THEMES.dark;
  const autoQuality = opts.autoQuality ?? quality === 'high';
  alive++;

  // ── DOM / renderer ────────────────────────────────────────────────────────────────────────────────────────────
  const wrap = document.createElement('div');
  wrap.className = 'explainer3d';
  Object.assign(wrap.style, { position: 'absolute', inset: '0', overflow: 'hidden', background: cssBackdrop(theme), touchAction: 'none' });
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.appendChild(wrap);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  let dpr = Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1.25 : 2);
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = quality === 'high';
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x000000, 0);
  Object.assign(renderer.domElement.style, { display: 'block', width: '100%', height: '100%' });
  wrap.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 40);
  const stage = createStage(scene, renderer, { shadows: quality === 'high', theme });
  const figure = createFigure();
  scene.add(figure.root);
  const animator = new Animator(figure);
  const exGroup = new THREE.Group(); // machine + world-space props + cables + arrow live here
  scene.add(exGroup);

  const controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, {
    enableDamping: true, dampingFactor: 0.08, enablePan: false, minDistance: 0.9, maxDistance: 7,
    maxPolarAngle: Math.PI * 0.495, rotateSpeed: 0.8, zoomSpeed: 0.8, autoRotateSpeed: 1.1,
  });

  // ── Exercise state ────────────────────────────────────────────────────────────────────────────────────────────
  let mode = 'exercise', spec = null, machine = null, props = [], cables = [], movers = [], arrow = null;
  let views = computeViews(), tween = null, dirty = true, clock = 0, frozen = false;
  let resumeRotate = null, wantAutoRotate = false;
  const cableGeo = unitCylinder(0.0045, 6);
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion();

  function clearExercise() {
    for (const p of props) p.dispose();
    for (const c of cables) { c.mesh.removeFromParent(); }
    if (machine) { machine.group.removeFromParent(); machine.group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); }
    arrow?.group.removeFromParent(); arrow?.dispose();
    machine = null; props = []; cables = []; movers = []; arrow = null; spec = null;
    controls.autoRotate = false; wantAutoRotate = false;
    clearTimeout(resumeRotate);
  }

  /** Props, machine movers, cables and stacks follow the current figure pose. */
  function updateAttachments() {
    for (const p of props) p.update();
    for (const m of movers) {
      figure.getEffector(m.follow, _a).sub(m.effRest);
      m.part.position.copy(m.rest).addScaledVector(m.localAxis, _a.dot(m.axis) * m.scale);
    }
    const lifts = {};
    for (const c of cables) {
      const end = c.endPoint();
      const len = stretchBetween(c.mesh, c.anchor, end);
      if (c.stack) lifts[c.stack] = Math.max(lifts[c.stack] || 0, (len - c.minLen) * c.ratio);
    }
    for (const [name, lift] of Object.entries(lifts)) machine.parts[name].position.y = lift + 0.004;
    machine?.update?.();
  }

  /** Where a cable ends: a prop's cable point if a prop is held by that effector, else the effector itself. */
  function cableEnd(to) {
    let prop = null;
    const m = /^prop:(\d+)$/.exec(to);
    if (m) prop = props[+m[1]];
    else prop = props.find((p) => p.cablePoint && (p.attach === to || (to === 'handsMid' && p.attach === 'handsMid')));
    if (prop?.cablePoint) return { prop, fn: () => prop.cablePoint };
    if (!EFFECTORS.includes(to)) { console.warn(`[explainer] cable target "${to}" is not an effector`); return null; }
    const v = new THREE.Vector3();
    return { prop: null, fn: () => figure.getEffector(to, v) };
  }

  function setupExercise(s) {
    const wanted = (s.cables || []).map((c) => c.from);
    machine = buildMachine(s.machine, { ...(s.machineOpts || {}), anchorsWanted: wanted });
    if (machine) exGroup.add(machine.group);
    animator.setSpec(s);
    props = (s.props || []).map((p) => createProp(p, { figure, parent: exGroup })).filter(Boolean);
    for (const c of s.cables || []) {
      const anchor = machine?.anchors[c.from];
      if (!anchor) { console.warn(`[explainer] ${s.id}: cable anchor "${c.from}" not found on machine "${s.machine}"`); continue; }
      const end = cableEnd(c.to);
      if (!end) continue;
      end.prop?.setAnchor(anchor);
      const mesh = new THREE.Mesh(cableGeo, getMaterials().cable);
      mesh.castShadow = true;
      exGroup.add(mesh);
      const stack = c.stack ?? machine.cableStacks?.[c.from] ?? null;
      cables.push({ mesh, anchor, endPoint: end.fn, stack: stack && machine.parts[stack] ? stack : null,
        ratio: c.ratio ?? machine.stackRatio ?? 1, minLen: Infinity });
    }
    // Props on a hand that are not cable-linked still get an anchor hint if one is named in opts.anchor.
    props.forEach((p, i) => { const n = s.props[i].opts?.anchor; if (n && machine?.anchors[n]) p.setAnchor(machine.anchors[n]); });
    for (const m of s.movers || []) {
      const part = machine?.parts[m.part];
      if (!part) { console.warn(`[explainer] ${s.id}: mover part "${m.part}" not found`); continue; }
      const axis = V3(m.axis || [0, 1, 0]).normalize();
      part.parent.getWorldQuaternion(_q);
      movers.push({ part, follow: m.follow, axis, localAxis: axis.clone().applyQuaternion(_q.invert()),
        rest: part.position.clone(), effRest: new THREE.Vector3(), scale: m.scale ?? 1 });
    }
    // Sample one rep: cable rest lengths, arrow path, reach checks.
    const arrowCfg = s.arrow === false ? null : pickArrow(s);
    const path = [], N = 20, warned = new Set();
    for (let i = N; i >= 0; i--) {
      animator.poseAt(i / N);
      for (const p of props) p.update();
      for (const c of cables) c.minLen = Math.min(c.minLen, c.anchor.distanceTo(c.endPoint()));
      if (arrowCfg) path.push(figure.getEffector(arrowCfg.effector, new THREE.Vector3()).add(arrowCfg.offset));
      figure.reachError.forEach((e, k) => {
        if (e > 0.02 && !warned.has(k)) { warned.add(k); console.warn(`[explainer] ${s.id}: ${['hand_L', 'hand_R', 'foot_L', 'foot_R'][k]} target out of reach by ${(e * 100).toFixed(0)} cm (u=${(i / N).toFixed(2)})`); }
      });
    }
    animator.poseAt(0);
    for (const m of movers) figure.getEffector(m.follow, m.effRest);
    if (arrowCfg && path[0].distanceTo(path[path.length - 1]) > 0.06) {
      arrow = createMotionArrow(path, arrowCfg.color ? { color: arrowCfg.color } : undefined);
      exGroup.add(arrow.group);
    }
    updateAttachments();
  }

  /** Arrow effector: spec.arrow.effector or the effector that travels furthest between top and bottom. */
  function pickArrow(s) {
    const cfg = s.arrow || {};
    let effector = cfg.effector;
    if (!effector) {
      const d = {};
      for (const e of ['hand_L', 'feetMid', 'pelvis']) { animator.poseAt(0); figure.getEffector(e, _a); animator.poseAt(1); figure.getEffector(e, _b); d[e] = _a.distanceTo(_b); }
      effector = Object.keys(d).sort((x, y) => d[y] - d[x])[0];
    }
    const off = cfg.offset || (effector === 'hand_L' ? [0.13, 0, 0] : effector === 'hand_R' ? [-0.13, 0, 0] : [0.32, 0, 0]);
    return { effector, offset: V3(off), color: cfg.color };
  }

  function highlightFor(id, s) {
    const ex = EXERCISES[id];
    const prim = s?.muscles?.primary || ex?.primary || [], sec = s?.muscles?.secondary || ex?.secondary || [];
    const st = {};
    for (const m of sec) st[m] = 'secondary';
    for (const m of prim) st[m] = 'primary';
    figure.setHighlight(st);
  }

  // ── Camera ────────────────────────────────────────────────────────────────────────────────────────────────────
  const _s0 = new THREE.Spherical(), _s1 = new THREE.Spherical(), _o = new THREE.Vector3();
  /**
   * Spec cameras are authored for a ~square frame. On narrow (portrait) screens pull the camera back so the
   * horizontal coverage stays the same.
   */
  const _fit = new THREE.Vector3();
  function fittedPos(name) {
    const base = views.views[name] || views.views.front;
    const k = THREE.MathUtils.clamp(Math.tan(THREE.MathUtils.degToRad(17)) / (camera.aspect * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))), 1, 1.8);
    return _fit.subVectors(base, views.target).multiplyScalar(k).add(views.target);
  }
  function setView(name, { instant = false } = {}) {
    const pos = fittedPos(name);
    if (instant) {
      tween = null;
      camera.position.copy(pos); controls.target.copy(views.target);
      controls.update(); dirty = true; return;
    }
    _s0.setFromVector3(_o.subVectors(camera.position, controls.target));
    _s1.setFromVector3(_o.subVectors(pos, views.target));
    let dTheta = _s1.theta - _s0.theta;
    dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta)); // shortest way round
    tween = { t: 0, dur: 0.9, from: _s0.clone(), dTheta, dPhi: _s1.phi - _s0.phi, dR: _s1.radius - _s0.radius,
      t0: controls.target.clone(), t1: views.target.clone() };
  }
  const _sp = new THREE.Spherical();
  function stepTween(dt) {
    tween.t = Math.min(1, tween.t + dt / tween.dur);
    const k = easeInOutCubic(tween.t), f = tween.from;
    _sp.set(f.radius + tween.dR * k, f.phi + tween.dPhi * k, f.theta + tween.dTheta * k);
    controls.target.lerpVectors(tween.t0, tween.t1, k);
    camera.position.setFromSpherical(_sp).add(controls.target);
    if (tween.t >= 1) tween = null;
  }
  controls.addEventListener('start', () => {
    tween = null;
    if (controls.autoRotate) { controls.autoRotate = false; }
    clearTimeout(resumeRotate);
  });
  controls.addEventListener('end', () => {
    if (wantAutoRotate) resumeRotate = setTimeout(() => { controls.autoRotate = wantAutoRotate; }, 2500);
  });
  controls.addEventListener('change', () => { dirty = true; });

  // ── Loop, visibility, resize, auto quality ────────────────────────────────────────────────────────────────────
  let raf = 0, last = 0, visible = true, perfN = 0, perfSum = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    clock += dt;
    const playing = animator.playing;
    if (playing) { animator.update(dt); updateAttachments(); }
    if (tween) stepTween(dt);
    const moved = controls.update(dt);
    if (!playing && !tween && !moved && !dirty && !controls.autoRotate) return;
    if (mode === 'exercise') {
      const a = spec ? animator.activation : 0.62 + 0.3 * Math.sin(clock * 2.2); // no spec: gentle pulse
      figure.setActivation(frozen ? 0.85 : a);
      if (arrow) {
        const ph = animator.phase, pt = animator.phaseT || 0;
        const op = frozen ? 0.9 : ph === 'concentric' ? 0.9 * smooth(Math.min(1, pt * 1.6)) : ph === 'top' ? 0.9 * (1 - smooth(pt)) : 0;
        arrow.update(op, clock);
      }
    }
    renderer.render(scene, camera);
    dirty = false;
    if (autoQuality && playing) monitorPerf(dt);
  }
  function monitorPerf(dt) {
    perfSum += dt; perfN++;
    if (perfN < 90) return;
    const avg = perfSum / perfN; perfN = 0; perfSum = 0;
    if (avg < 0.026) return; // ≥ ~38 fps: fine
    if (dpr > 1.01) { dpr = Math.max(1, dpr - 0.375); renderer.setPixelRatio(dpr); resize(); }
    else if (renderer.shadowMap.enabled) {
      renderer.shadowMap.enabled = false; stage.setShadows(false);
      scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
    }
  }
  function start() { if (!raf && visible && !document.hidden) { last = 0; dirty = true; raf = requestAnimationFrame(frame); } }
  function stop() { cancelAnimationFrame(raf); raf = 0; }
  const onVis = () => (document.hidden ? stop() : start());
  document.addEventListener('visibilitychange', onVis);
  const io = new IntersectionObserver((es) => { visible = es[es.length - 1].isIntersecting; visible ? start() : stop(); });
  io.observe(wrap);
  function resize() {
    const w = wrap.clientWidth || 1, h = wrap.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Portrait screens: widen the vertical FOV a bit so standing figures are not cropped.
    camera.fov = w / h < 0.8 ? 42 : 34;
    camera.updateProjectionMatrix();
    dirty = true;
  }
  const ro = new ResizeObserver(resize);
  ro.observe(wrap);
  resize();

  // ── Muscle tap (raycast) ──────────────────────────────────────────────────────────────────────────────────────
  let tapCb = null, down = null;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const onDown = (e) => { down = { x: e.clientX, y: e.clientY }; };
  const onUp = (e) => {
    if (!tapCb || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(figure.meshes, false)[0];
    const id = hit?.object.userData.muscle;
    if (id) tapCb(id);
  };
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointerup', onUp);

  function loadExercise(id, s) {
    clearExercise();
    mode = 'exercise'; frozen = false;
    if (!s && !EXERCISES[id]) console.warn(`[explainer] unknown exercise "${id}"`);
    highlightFor(id, s);
    if (s) { spec = s; setupExercise(s); } else animator.setIdle(STAND);
    views = computeViews(s?.camera);
    setView('front', { instant: true });
    stage.setFocus(views.target.x, views.target.z, s?.machine ? 0.9 : 0.55);
    animator.playing = true;
    start();
  }

  // ── Public API ────────────────────────────────────────────────────────────────────────────────────────────────
  const api = {
    async load(id) { loadExercise(id, getSpec(id)); },
    /** Dev/authoring: preview a spec object that is not (yet) registered. */
    async loadSpec(specObj) { loadExercise(specObj.id, specObj); },
    async showBody({ heat = {}, autoRotate = true } = {}) {
      clearExercise();
      mode = 'body'; frozen = false;
      figure.setHeat(heat);
      animator.setIdle(BODY_POSE);
      animator.playing = true;
      views = computeViews({ target: [0, 1.0, 0], front: [0, 1.25, 3.7], side: [3.7, 1.25, 0] });
      setView('front', { instant: true });
      stage.setFocus(0, 0, 0.5);
      wantAutoRotate = autoRotate; controls.autoRotate = autoRotate;
      start();
    },
    play() { frozen = false; animator.playing = true; dirty = true; start(); },
    pause() { animator.playing = false; dirty = true; },
    isPlaying: () => animator.playing,
    setSpeed(s) { animator.speed = Math.max(0.1, +s || 1); },
    setView(name, { instant = false } = {}) { setView(VIEW_NAMES.includes(name) ? name : 'front', { instant }); start(); },
    onPhase(cb) { return animator.onPhase(cb); },
    onMuscleTap(cb) { tapCb = cb; },
    /** Pause at blend t (0 = top pose, 1 = bottom pose) — for tests and stills. */
    freeze(t) {
      if (mode !== 'exercise' || !spec) return;
      frozen = true; animator.freeze(t); updateAttachments(); dirty = true;
    },
    /** Render a still synchronously and return a PNG data URL (freezes the loop). */
    snapshot({ t = 0, view = 'front' } = {}) {
      api.freeze(t);
      setView(view, { instant: true });
      figure.setActivation(0.85);
      arrow?.update(0.9, clock);
      renderer.render(scene, camera);
      return compositeSnapshot(renderer.domElement, theme);
    },
    info() {
      const i = renderer.info;
      return { triangles: i.render.triangles, calls: i.render.calls, geometries: i.memory.geometries, textures: i.memory.textures, dpr, shadows: renderer.shadowMap.enabled };
    },
    dispose() {
      stop();
      document.removeEventListener('visibilitychange', onVis);
      io.disconnect(); ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      controls.dispose();
      clearExercise();
      figure.dispose();
      stage.dispose();
      cableGeo.dispose();
      if (--alive === 0) disposeMaterials();
      renderer.dispose();
      renderer.forceContextLoss();
      wrap.remove();
    },
    // Dev/debug handles (not part of the app contract).
    debug: { scene, camera, renderer, figure, animator, controls, get machine() { return machine; }, get props() { return props; } },
  };
  return api;
}
