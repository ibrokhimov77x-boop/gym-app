// Прикладная логика UI поверх данных и аналитики: замены упражнений, цели, неделя знакомства.
import { EXERCISES, EQUIPMENT } from '../data/exercises.js';
import { PROGRAM, sessionAt, sessionById, currentNextIdx, calibCount } from '../data/program.js';
import { nextTarget, workingSets, setScore, UNILATERAL } from '../analytics.js';
import { html, num, restLabel } from './dom.js';

/** Есть ли оборудование: true/false — отметка пользователя; null — не отмечено (считаем доступным). */
export function equipState(key, prefs) {
  if (key in (prefs.equip || {})) return prefs.equip[key];
  return EQUIPMENT[key]?.status === 'guess' ? null : true;
}

export const exerciseAvailable = (exId, prefs) =>
  (EXERCISES[exId]?.equipment || []).every((k) => equipState(k, prefs) !== false);

/**
 * Какое упражнение реально делать вместо baseId:
 * постоянная замена пользователя (если доступна) → само упражнение → первая доступная альтернатива,
 * которой нет в exclude (другие упражнения той же тренировки). Ничего не подошло — само упражнение,
 * reason 'missing' («нет оборудования»). Своя замена, которая повторила бы другое упражнение той же
 * тренировки (замены общие для всех тренировок), здесь не применяется: reason 'dup', dup — эта замена.
 */
export function resolveExercise(baseId, prefs, exclude = null) {
  const pref = prefs.swaps?.[baseId];
  const usable = pref && EXERCISES[pref] && exerciseAvailable(pref, prefs);
  if (usable && !exclude?.has(pref)) return { id: pref, reason: 'swap' };
  if (exerciseAvailable(baseId, prefs)) return usable ? { id: baseId, reason: 'dup', dup: pref } : { id: baseId, reason: null };
  const alt = (EXERCISES[baseId]?.alternatives || []).find((a) => !exclude?.has(a) && exerciseAvailable(a, prefs));
  return alt ? { id: alt, reason: 'equip' } : { id: baseId, reason: 'missing' };
}

/**
 * Пункты сессии с учётом замен: { ...item, baseId, exId, reason, dup? }. Ни автозамена, ни своя замена
 * не дублируют другое упражнение сессии (иначе два назначения читают одну историю).
 */
export function planItems(session, prefs) {
  const taken = new Set(session.items.map((it) => it.exId));
  return session.items.map((it) => {
    const r = resolveExercise(it.exId, prefs, taken);
    taken.add(r.id);
    return { ...it, baseId: it.exId, exId: r.id, reason: r.reason, ...(r.dup ? { dup: r.dup } : {}) };
  });
}

/** Бейдж замены у пункта плана: автозамена, своя замена или «нет оборудования» (замены не нашлось). */
export const SWAP_BADGE = { equip: ['warn', 'замена'], swap: ['info', 'замена'], missing: ['warn', 'нет оборудования'] };

/** Цели на тренировку: [{ item, target }]. calibrating — идёт неделя знакомства (calibInfo: !done). */
export function sessionTargets(workouts, session, prefs, calibrating = undefined) {
  return planItems(session, prefs).map((item) => ({
    item,
    target: nextTarget(workouts, { ...item, exId: item.baseId }, item.exId !== item.baseId ? item.exId : null, calibrating),
  }));
}

/** Пункт программы для упражнения внутри тренировки (по исходному id), либо шаблон для дополнительного. */
export function itemFor(workout, e, restDefault = 90) {
  const session = sessionById(workout.session); // старые тренировки (Верх A …) — со своими назначениями
  const base = e.from || e.id;
  const it = session?.items.find((i) => i.exId === base);
  return it ? { ...it, extra: false } : { exId: e.id, sets: 3, reps: [8, 12], rir: [1, 2], rest: restDefault, extra: true };
}

/** Неделя знакомства: сколько завершено из PROGRAM.calibration.sessions (старые — только полная старая неделя, calibCount). */
export function calibInfo(profile, finished) {
  const total = PROGRAM.calibration.sessions;
  const count = calibCount(finished);
  return { total, count: Math.min(count, total), done: profile.calibrationDone || count >= total };
}

/** Следующая тренировка по кругу (старый nextIdx переводится по смыслу, см. program.js currentNextIdx). */
export const nextSession = (state, finished, active = null) => sessionAt(currentNextIdx(state, finished, active));

const ISOLATION = new Set(['iso_upper', 'iso_lower', 'core']);
/**
 * Оценка длительности, мин: 40 с работы на подход (80 с — по одной руке/ноге), отдых после каждого подхода,
 * +1 мин на смену упражнения, +10 мин разминки. docs/PLAN_V2.md §4. В неделю знакомства (calibrating) —
 * ещё разминочный подход перед каждым базовым упражнением: 40 с + 60 с отдыха.
 */
export function estimateMinutes(items, calibrating = false) {
  if (!items.length) return 0;
  let sec = items.reduce((a, it) => a + it.sets * ((UNILATERAL.has(it.exId) ? 80 : 40) + it.rest), 0);
  if (calibrating) sec += 100 * items.filter((it) => EXERCISES[it.exId] && !ISOLATION.has(EXERCISES[it.exId].pattern)).length;
  return Math.round(sec / 60 + 10 + (items.length - 1));
}

// ───────── Суперсеты ─────────

const PAIR_LETTERS = 'АБВГДЕЖ';

/**
 * Пары суперсетов по порядку: Map(exId пункта → { label: 'А1' | 'А2' …, partner: exId, first }).
 * Пара — два пункта, которые указывают друг на друга полем superset; первый в списке — «1» (rest = переход),
 * второй — «2» (rest = отдых после пары). items — пункты сессии (или planItems: ключ — baseId).
 */
export function supersetLabels(items) {
  const out = new Map();
  let k = 0;
  for (const it of items) {
    const base = it.baseId || it.exId;
    if (!it.superset || out.has(base)) continue;
    if (!items.some((x) => (x.baseId || x.exId) === it.superset && x.superset === base)) continue;
    const L = PAIR_LETTERS[k++] || '·';
    out.set(base, { label: `${L}1`, partner: it.superset, first: true });
    out.set(it.superset, { label: `${L}2`, partner: base, first: false });
  }
  return out;
}

/**
 * Партнёр карточки i по суперсету: { j, label, first, item, partnerItem } или null.
 * Пара — по исходному упражнению (e.from || e.id), поэтому замена сохраняет пару; карточка партнёра — последняя
 * с его исходным id (после замены посреди упражнения подходы идут в новую карточку).
 */
export function supersetPartner(w, i) {
  const session = sessionById(w.session);
  const e = w.ex[i];
  if (!session || !e) return null;
  const base = e.from || e.id;
  const info = supersetLabels(session.items).get(base);
  if (!info) return null;
  let j = -1;
  w.ex.forEach((c, k) => { if (k !== i && (c.from || c.id) === info.partner) j = k; });
  if (j < 0) return null;
  const find = (id) => session.items.find((it) => it.exId === id);
  return { j, label: info.label, first: info.first, item: find(base), partnerItem: find(info.partner) };
}

/**
 * Куда после рабочего подхода на карточке i: { open: карточка, rest: секунды, label: «что дальше» }.
 * В суперсете, пока партнёр не закончил, — к нему: партнёр отстаёт → переход (rest первого в паре),
 * догнал → круг закрыт, отдых после пары (rest второго). Иначе тот же пункт, а когда его подходы сделаны —
 * следующий после пары. docs/PLAN_V2.md §3
 * Пункт обогнал партнёра на 2 подхода (второй блок занят — пару делают обычными подходами): суперсет на эту
 * тренировку снят — тот же пункт с отдыхом после пары, после его подходов — партнёр.
 */
export function afterWorkingSet(w, i, restDefault = 90) {
  const e = w.ex[i];
  const item = itemFor(w, e, restDefault);
  const n = (k) => workingSets(w.ex[k]).length;
  const planned = (k) => itemFor(w, w.ex[k], restDefault).sets;
  const short = (k) => EXERCISES[w.ex[k].id]?.short || w.ex[k].id;
  const p = item.extra ? null : supersetPartner(w, i);
  const restAfter = p ? (p.first ? p.partnerItem.rest : p.item.rest) : item.rest;
  const straight = p && n(i) - n(p.j) >= 2;
  if (straight && n(i) < item.sets) return { open: i, rest: restAfter, label: `${short(i)}, подход ${n(i) + 1}` };
  if (p && n(p.j) < planned(p.j)) {
    if (straight) return { open: p.j, rest: restAfter, label: `${short(p.j)}, подход ${n(p.j) + 1}` };
    const restSwitch = p.first ? p.item.rest : p.partnerItem.rest;
    return { open: p.j, rest: n(p.j) < n(i) ? restSwitch : restAfter, label: `${short(p.j)}, подход ${n(p.j) + 1}` };
  }
  const last = p ? Math.max(i, p.j) : i;
  if (n(i) === item.sets && last < w.ex.length - 1) return { open: last + 1, rest: restAfter, label: short(last + 1) };
  return { open: i, rest: restAfter, label: `${short(i)}, подход ${n(i) + 1}` };
}

/** Отдых пункта словами: «отдых 2:30»; в суперсете — «20 с → Трицепс канат» (переход) и «отдых 1 мин → Бицепс на блоке». */
export function restText(item, pair, partnerShort, word = 'отдых ') {
  if (!pair) return `${word}${restLabel(item.rest)}`;
  return `${pair.first ? '' : word}${restLabel(item.rest)} → ${partnerShort}`;
}

/** То же для разметки: «→ партнёр» переносится на новую строку целиком. */
export function restHtml(item, pair, partnerShort, word = 'отдых ') {
  if (!pair) return restText(item, pair, partnerShort, word);
  return html`${pair.first ? '' : word}${restLabel(item.rest)} <span style="white-space:nowrap">→ ${partnerShort}</span>`;
}

/** Какую карточку раскрыть при входе в тренировку: первую недоделанную, а в суперсете — того, чья очередь. */
export function resumeCard(w) {
  const n = (k) => workingSets(w.ex[k]).length;
  const i = w.ex.findIndex((e, k) => n(k) < itemFor(w, e).sets);
  if (i < 0) return w.ex.length - 1;
  const p = supersetPartner(w, i);
  return p && n(p.j) < n(i) && n(i) - n(p.j) < 2 && n(p.j) < itemFor(w, w.ex[p.j]).sets ? p.j : i;
}

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

/** Текст цели: «24 кг × 6–10» или «подобрать вес» (на знакомстве — с прошлым весом: «было 20 кг»). */
export function targetLabel(t) {
  const reps = `${t.reps[0]}–${t.reps[1]}`;
  if (t.mode === 'calibrate') return `подобрать вес · ${reps}${t.hint ? ` · было ${weightLabel(t.exId, t.hint)}` : ''}`;
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
