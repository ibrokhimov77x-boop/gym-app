// Rep timeline: top → (eccentric) → bottom hold → (concentric) → top hold → loop.
// "top" = end of the concentric (lockout / contracted), "bottom" = end of the eccentric (stretched position).
// The animator owns the resolved key poses and blends them into one scratch pose per frame (no allocations).
import * as THREE from 'three';
import { createPose, resolvePose, lerpPose, copyPose } from './pose.js';

export const DEFAULT_TEMPO = { eccentric: 2.0, bottom: 0.4, concentric: 1.0, top: 0.6 };
const _qb = new THREE.Quaternion(), _ax = new THREE.Vector3();

const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
// Concentric: quick drive out of the bottom, smooth arrival at lockout (ease-out with a soft start).
const easeConc = (x) => 0.75 * (1 - (1 - x) ** 2.4) + 0.25 * x * x * (3 - 2 * x);
const smooth = (x) => x * x * (3 - 2 * x);

export class Animator {
  constructor(figure) {
    this.figure = figure;
    this.keys = { top: createPose(), bottom: createPose(), mid: createPose() };
    this.hasMid = false;
    this.scratch = createPose();
    this.tempo = { ...DEFAULT_TEMPO };
    this.speed = 1;
    this.time = 0;
    this.playing = false;
    this.phase = 'top';
    this.u = 0;           // 0 = top pose, 1 = bottom pose
    this.activation = 0;  // 0..1 glow drive, peaks at the end of the concentric
    this.listeners = new Set();
    this.idle = false;
  }

  /** Load a spec: resolves top/bottom (and optional mid) keyposes. */
  setSpec(spec) {
    const p = spec?.poses || {};
    resolvePose(p.top || p.bottom || {}, this.keys.top);
    resolvePose(p.bottom || p.top || {}, this.keys.bottom, this.keys.top);
    this.hasMid = !!p.mid;
    if (this.hasMid) {
      lerpPose(this.keys.top, this.keys.bottom, null, 0.5, this.scratch);
      resolvePose(p.mid, this.keys.mid, this.scratch);
    }
    this.tempo = { ...DEFAULT_TEMPO, ...(spec?.tempo || {}) };
    this.idle = false;
    this.time = 0; this.phase = null;
    this.poseAt(0);
  }

  /** Idle (standing / muscle-map) mode: one pose with procedural breathing. */
  setIdle(specPose) {
    resolvePose(specPose, this.keys.top);
    this.idle = true; this.time = 0;
    this.poseAt(0);
  }

  get cycle() { const t = this.tempo; return t.eccentric + t.bottom + t.concentric + t.top; }

  /** Pose the figure at blend u (0 top … 1 bottom). */
  poseAt(u) {
    this.u = u;
    lerpPose(this.keys.top, this.keys.bottom, this.hasMid ? this.keys.mid : null, u, this.scratch);
    this.figure.applyPose(this.scratch);
  }

  /** Stop the loop and show blend t (0 = top pose, 1 = bottom pose). Muscles glow as if working. */
  freeze(t) {
    this.playing = false;
    this.poseAt(Math.min(1, Math.max(0, t)));
    this.activation = 0.85;
  }

  onPhase(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }

  update(dt) {
    if (!this.playing) return;
    this.time += dt * this.speed;
    if (this.idle) {
      // Breathing: chest rises ~1.5°, shoulders lift slightly; 4 s period.
      const b = Math.sin(this.time * Math.PI * 0.5);
      const s = copyPose(this.keys.top, this.scratch);
      s.chest.multiply(_qb.setFromAxisAngle(_ax.set(1, 0, 0), -0.025 * b));
      s.clavicle_L.multiply(_qb.setFromAxisAngle(_ax.set(0, 0, 1), 0.012 * b));
      s.clavicle_R.multiply(_qb.setFromAxisAngle(_ax.set(0, 0, 1), -0.012 * b));
      this.figure.applyPose(s);
      return;
    }
    const T = this.tempo, cyc = this.cycle;
    let t = this.time % cyc, phase, pt, u, act;
    if (t < T.eccentric) { phase = 'eccentric'; pt = t / T.eccentric; u = easeInOut(pt); act = 0.42 + 0.08 * pt; }
    else if ((t -= T.eccentric) < T.bottom) { phase = 'bottom'; pt = t / T.bottom; u = 1; act = 0.5; }
    else if ((t -= T.bottom) < T.concentric) { phase = 'concentric'; pt = t / T.concentric; u = 1 - easeConc(pt); act = 0.5 + 0.5 * smooth(pt); }
    else { t -= T.concentric; phase = 'top'; pt = t / Math.max(T.top, 1e-3); u = 0; act = 1 - 0.58 * smooth(pt); }
    this.phaseT = pt;
    this.activation = act;
    if (phase !== this.phase) {
      this.phase = phase;
      for (const cb of this.listeners) { try { cb({ phase, t: this.time }); } catch (e) { console.error(e); } }
    }
    this.poseAt(u);
  }
}
