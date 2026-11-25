// Прикладная логика UI поверх данных и аналитики: замены упражнений, цели, неделя знакомства.
import { EXERCISES, EQUIPMENT } from '../data/exercises.js';
import { PROGRAM, sessionAt } from '../data/program.js';
import { nextTarget, workingSets, setScore } from '../analytics.js';
import { num } from './dom.js';

/** Есть ли оборудование: true/false — отметка пользователя; null — не отмечено (считаем доступным). */
export function equipState(key, prefs) {
  if (key in (prefs.equip || {})) return prefs.equip[key];
  return EQUIPMENT[key]?.status === 'guess' ? null : true;
}

export const exerciseAvailable = (exId, prefs) =>
  (EXERCISES[exId]?.equipment || []).every((k) => equipState(k, prefs) !== false);

/**
 * Какое упражнение реально делать вместо baseId:
 * постоянная замена пользователя (если доступна) → само упражнение → первая доступная альтернатива.
 */
export function resolveExercise(baseId, prefs) {
  const pref = prefs.swaps?.[baseId];
  if (pref && EXERCISES[pref] && exerciseAvailable(pref, prefs)) return { id: pref, reason: 'swap' };
  if (exerciseAvailable(baseId, prefs)) return { id: baseId, reason: null };
  const alt = (EXERCISES[baseId]?.alternatives || []).find((a) => exerciseAvailable(a, prefs));
  return alt ? { id: alt, reason: 'equip' } : { id: baseId, reason: null };
}

/** Пункты сессии с учётом замен: { ...item, baseId, exId, reason }. */
export function planItems(session, prefs) {
  return session.items.map((it) => {
    const r = resolveExercise(it.exId, prefs);
    return { ...it, baseId: it.exId, exId: r.id, reason: r.reason };
  });
}

/** Цели на тренировку: [{ item, target }]. */
export function sessionTargets(workouts, session, prefs) {
  return planItems(session, prefs).map((item) => ({
    item,
    target: nextTarget(workouts, { ...item, exId: item.baseId }, item.exId !== item.baseId ? item.exId : null),
  }));
}

/** Пункт программы для упражнения внутри тренировки (по исходному id), либо шаблон для дополнительного. */
export function itemFor(workout, e, restDefault = 90) {
  const session = PROGRAM.sessions[workout.session];
  const base = e.from || e.id;
  const it = session?.items.find((i) => i.exId === base);
  return it ? { ...it, extra: false } : { exId: e.id, sets: 3, reps: [8, 12], rir: [1, 2], rest: restDefault, extra: true };
}

/** Неделя знакомства: сколько завершено из 4. */
export function calibInfo(profile, finished) {
  const total = PROGRAM.calibration.sessions;
  const count = finished.filter((w) => w.calib).length;
  return { total, count: Math.min(count, total), done: profile.calibrationDone || count >= total };
}

export const nextSession = (state) => sessionAt(state.nextIdx || 0);

/** Вес по-человечески: «24 кг», «помощь 30 кг», «вес тела». */
export function weightLabel(exId, w) {
  const ex = EXERCISES[exId];
  if (!ex) return `${num(w)} кг`;
  if (ex.load === 'bodyweight' && !ex.increment) return 'вес тела';
  if (ex.increment < 0) return `помощь ${num(w)} кг`;
  if (ex.load === 'bodyweight' && !w) return 'вес тела';
  return `${num(w)} кг`;
}

/** Повторы считаются только числом (подъём коленей, планка — секунды). */
export const repsOnly = (exId) => { const ex = EXERCISES[exId]; return !!ex && ex.load === 'bodyweight' && !ex.increment; };
export const repsUnit = (exId) => (exId === 'plank' ? 'сек' : 'повт');

/** Текст цели: «24 кг × 6–10» или «подобрать вес». */
export function targetLabel(t) {
  const reps = `${t.reps[0]}–${t.reps[1]}`;
  if (t.mode === 'calibrate') return `подобрать вес · ${reps}`;
  if (repsOnly(t.exId)) return `${reps} ${repsUnit(t.exId)}`;
  return `${weightLabel(t.exId, t.w)} × ${reps}`;
}

/** Предзаполнение следующего подхода: повтор прошлого подхода этой тренировки или цель. */
export function prefill(e, item, target) {
  const sets = workingSets(e);
  const prev = sets[sets.length - 1];
  if (prev) return { w: prev.w, r: prev.r, rir: prev.rir ?? 2, warm: false };
  const idx = sets.length;
  const last = target?.last?.[idx] || target?.last?.[target.last.length - 1];
  const [lo, hi] = target?.reps || item.reps;
  let r = lo;
  if (target?.mode === 'reps' && last) r = Math.min(hi, last.r + 1);
  const w = target?.w ?? last?.w ?? 0;
  return { w: w || 0, r, rir: item.rir?.[1] ?? 2, warm: false };
}

/** Лучший подход упражнения в тренировке (по оценке силы). */
export function bestSet(e, bw) {
  let best = null, sc = 0;
  for (const s of workingSets(e)) { const v = setScore(e.id, s, bw); if (v > sc) { sc = v; best = s; } }
  return best;
}

/** Метки: используется ли упражнение в программе и в какой сессии. */
export function programUsage(exId) {
  const out = [];
  for (const s of Object.values(PROGRAM.sessions)) if (s.items.some((i) => i.exId === exId)) out.push(s.name);
  return out;
}

export const WRIST = {
  safe: { label: 'Безопасно для запястья', short: 'безопасно', cls: 'safe' },
  care: { label: 'Осторожно: следи за кистью', short: 'осторожно', cls: 'care' },
  risky: { label: 'Рискованно для запястья', short: 'риск', cls: 'risky' },
};

export const STATUS = {
  confirmed: { label: 'Подтверждено', cls: 'good' },
  likely: { label: 'Вероятно', cls: 'info' },
  guess: { label: 'Проверить', cls: 'warn' },
};

/** Мягкая разминка запястий (после старого перелома) — показывается в правилах и в начале тренировки. */
export const WRIST_WARMUP = [
  'Круги кистями: по 10 в каждую сторону, медленно и без боли.',
  'Сжать-разжать кулаки: 15 раз, пальцы широко.',
  'Сгибание-разгибание кисти без веса: 10 раз, амплитуда только комфортная.',
  'Мягкая растяжка «молитва» у груди: 15–20 секунд, без давления в боль.',
  'Первый подход каждого жима и тяги — лёгкий: проверь, что кисть стоит прямо.',
];
