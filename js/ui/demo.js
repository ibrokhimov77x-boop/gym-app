// Генератор демо-данных: 8 недель реалистичных тренировок (неделя знакомства, разный темп роста, один застой).
// Детерминированный (свой ГПСЧ), отсчитывается от текущей даты. Используется только в демо-пространстве хранилища.
import { EXERCISES } from '../data/exercises.js';
import { PROGRAM } from '../data/program.js';

const DAY = 86400000;

function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Стартовая сила (оценка 1ПМ, кг на руку для гантелей) и темп роста %/нед. Повторы для упражнений с весом тела.
const PROFILE = {
  db_bench_press: [30, 1.6], seated_cable_row: [72, 1.4], machine_shoulder_press: [52, 0], lat_pulldown_neutral: [70, 1.2],
  cable_fly: [16, 1.0], db_hammer_curl: [17, 0.9], triceps_rope_pushdown: [30, 1.3],
  hack_squat: [95, 2.6], db_rdl: [32, 1.8], leg_press: [170, 3.0], lying_leg_curl: [50, 1.1], standing_calf_raise: [80, 0.6], cable_crunch: [45, 1.0],
  lat_pulldown_wide: [66, 1.3], incline_db_press: [25, 1.5], db_row: [34, 1.9], db_lateral_raise: [11, 0.5], face_pull: [26, 0.8],
  overhead_cable_ext: [24, 1.2], cable_rope_curl: [24, 0.7], bb_rdl: [90, 2.2], bulgarian_split_squat: [20, 2.0], hip_thrust: [100, 2.8],
  leg_extension: [60, 1.4], seated_leg_curl: [48, 1.0], seated_calf_raise: [45, 0.5], hanging_knee_raise: [10, 2.5],
};

const roundTo = (x, s) => Math.round(x / s) * s;

export function buildDemo() {
  const rand = rng(1337);
  const now = new Date();
  const today0 = new Date(now); today0.setHours(0, 0, 0, 0);
  const monday = today0.getTime() - ((today0.getDay() + 6) % 7) * DAY;
  const start = monday - 7 * 7 * DAY;
  const weights = {};      // текущий рабочий вес по упражнению
  const workouts = [];
  let idx = 0;
  // Расписание: обычно Пн/Ср/Пт, иногда сдвиг или пропуск (одна неделя — 2 тренировки)
  const pattern = [[0, 2, 4], [0, 2, 4], [1, 3, 5], [0, 2, 4], [0, 3], [0, 2, 4], [1, 3, 5], [0, 2, 4]];
  for (let wk = 0; wk < 8; wk++) {
    for (const d of pattern[wk]) {
      const day = start + wk * 7 * DAY + d * DAY;
      if (day >= today0.getTime()) continue;
      const session = PROGRAM.sessions[PROGRAM.rotation[idx % 4]];
      const calib = idx < 4;
      const t0 = new Date(day + (18 * 60 + Math.round(rand() * 80 - 20)) * 60000);
      const weeks = (day - start) / (7 * DAY);
      let clock = t0.getTime() + 8 * 60000;
      const ex = [];
      for (const item of session.items) {
        let id = item.exId;
        // Однажды тренажёр был занят — замена из альтернатив
        if (idx === 13 && id === 'seated_cable_row') id = 'db_row';
        const def = EXERCISES[id];
        const [base, rate] = PROFILE[id] || [40, 1];
        const strength = base * (1 + (rate / 100) * weeks) * (1 + (rand() - 0.5) * 0.03);
        const inc = Math.abs(def.increment) || 1;
        const [lo, hi] = item.reps;
        const sets = [];
        const at = () => new Date((clock += (item.rest + 40) * 1000)).toISOString();
        if (def.load === 'bodyweight' && !def.increment) {
          const r0 = Math.round(strength);
          for (let s = 0; s < item.sets; s++) sets.push({ w: 0, r: Math.max(lo - 2, r0 - s), rir: 1, warm: false, t: at() });
        } else {
          const rirT = calib ? 2 : 1;
          if (calib || weights[id] == null) {
            // Знакомство: стартуем осторожно и подбираем вес от подхода к подходу
            let w = roundTo(strength / (1 + (hi + 3) / 30), inc);
            sets.push({ w: roundTo(w * 0.5, inc), r: 8, rir: null, warm: true, t: at() });
            for (let s = 0; s < item.sets; s++) {
              const r = Math.max(1, Math.round(30 * (strength / w - 1) - rirT - s * 0.6));
              sets.push({ w, r: Math.min(r, hi + 3), rir: rirT + (r > hi ? 1 : 0), warm: false, t: at() });
              if (r > hi) w = roundTo(w + inc, inc);
            }
            weights[id] = sets[sets.length - 1].w;
          } else {
            const w = weights[id];
            if (item === session.items[0]) sets.push({ w: roundTo(w * 0.5, inc), r: 8, rir: null, warm: true, t: at() }, { w: roundTo(w * 0.75, inc), r: 5, rir: null, warm: true, t: at() });
            let all = true;
            for (let s = 0; s < item.sets; s++) {
              const raw = 30 * (strength / w - 1) - rirT - s * 0.7 + (rand() - 0.5);
              const r = Math.max(lo - 2, Math.min(hi, Math.round(raw)));
              if (r < hi) all = false;
              sets.push({ w, r, rir: Math.max(0, Math.min(3, Math.round(rirT + (raw - r) * 0.5))), warm: false, t: at() });
            }
            if (all) weights[id] = roundTo(w + inc, inc);
          }
        }
        ex.push({ id, from: id !== item.exId ? item.exId : null, note: '', sets });
      }
      const end = new Date(clock + 5 * 60000);
      const p2 = (x) => String(x).padStart(2, '0');
      workouts.push({
        id: `${t0.getFullYear()}${p2(t0.getMonth() + 1)}${p2(t0.getDate())}-${p2(t0.getHours())}${p2(t0.getMinutes())}`,
        session: session.id, calib, start: t0.toISOString(), end: end.toISOString(), bw: 77 + Math.round(weeks * 0.12 * 10) / 10,
        feel: 3 + Math.round(rand() * 2), note: idx === 13 ? 'Горизонтальный блок был занят — делал тягу гантели.' : '', ex, upd: end.toISOString(),
      });
      idx++;
    }
  }
  return {
    workouts,
    profile: { bodyweight: 77.8, heightCm: 180, startDate: new Date(start).toISOString().slice(0, 10), calibrationDone: true, restDefault: 90, autoRest: true },
    state: { nextIdx: idx % 4, activeWorkoutId: null, unsynced: workouts.slice(-2).map((w) => w.id) },
    prefs: { equip: { 'machine:pec_deck': true, 'machine:leg_extension': true }, swaps: {} },
  };
}
