// Аналитика тренировок. Чистые функции без DOM — используются и приложением, и ботом.
// Контракт: docs/DATA_CONTRACT.md
import { EXERCISES, MUSCLES } from './data/exercises.js';
import { PROGRAM, calibCount } from './data/program.js';

const DAY = 86400000;
// Упражнения, которые делаются одной рукой/ногой за раз (вес на одну сторону, объём не удваиваем).
export const UNILATERAL = new Set(['db_row', 'bulgarian_split_squat', 'cable_lateral_raise', 'smith_split_squat']);
// Упражнения с весом тела, где прогресс меряем повторами (или секундами).
const REPS_ONLY = (ex) => ex && ex.load === 'bodyweight' && !ex.increment;

const round1 = (x) => (Math.round(x * 10) / 10) || 0;
/** Число для русского текста: десятичная запятая (22,5). */
const ru = (x) => String(x).replace('.', ',');
export const ts = (iso) => new Date(iso).getTime();
export const workingSets = (e) => (e?.sets || []).filter((s) => !s.warm && s.r > 0);
export const sortedWorkouts = (ws) => [...ws].filter(Boolean).sort((a, b) => ts(a.start) - ts(b.start));

/** Оценка 1ПМ. Если указан RIR — считаем «повторы до отказа» = r + RIR (точнее для неотказных подходов). */
export function e1rm(w, r, rir = null) {
  if (!(w > 0) || !(r > 0)) return 0;
  const reps = Math.min(r + (rir != null ? Math.min(rir, 4) : 0), 20);
  if (reps <= 1) return w;
  const epley = w * (1 + reps / 30);
  if (reps <= 10) return epley;
  // На высоких повторах Эпли завышает — смешиваем с Бжицки (ограниченным) для стабильности.
  const brz = w * 36 / (37 - Math.min(reps, 30));
  return (epley + brz) / 2;
}

/** Эффективная нагрузка подхода с учётом типа упражнения (гравитрон: помощь вычитается из веса тела). */
export function effLoad(exId, w, bw) {
  const ex = EXERCISES[exId];
  if (!ex) return w;
  if (ex.increment < 0) return bw ? Math.max(bw - w, 1) : Math.max(100 - w, 1); // помощь
  return w;
}

/** Метрика силы одного подхода (e1RM или повторы для упражнений с весом тела). */
export function setScore(exId, s, bw = null) {
  const ex = EXERCISES[exId];
  if (REPS_ONLY(ex)) return s.r;
  return e1rm(effLoad(exId, s.w, bw), s.r, s.rir);
}

export function setVolume(exId, s) {
  const ex = EXERCISES[exId];
  if (!ex || REPS_ONLY(ex)) return 0;
  const mult = ex.perHand && !UNILATERAL.has(exId) ? 2 : 1;
  return Math.max(s.w, 0) * s.r * mult;
}

/** Тяжёлый подход: рабочий и не «слишком лёгкий» (RIR ≤ 4 или не указан). */
export const isHardSet = (s) => !s.warm && s.r > 0 && (s.rir == null || s.rir <= 4);

/** История упражнения: одна точка на тренировку. */
export function exerciseHistory(workouts, exId) {
  const out = [];
  for (const w of sortedWorkouts(workouts)) {
    for (const e of w.ex || []) {
      if (e.id !== exId) continue;
      const sets = workingSets(e);
      if (!sets.length) continue;
      let best = 0, top = null;
      for (const s of sets) {
        const sc = setScore(exId, s, w.bw);
        if (sc > best) { best = sc; top = s; }
      }
      out.push({
        workoutId: w.id, date: w.start, t: ts(w.start), calib: !!w.calib,
        best: round1(best), top: top && { w: top.w, r: top.r, rir: top.rir ?? null },
        volume: Math.round(sets.reduce((a, s) => a + setVolume(exId, s), 0)),
        hardSets: sets.filter(isHardSet).length,
        sets: sets.map((s) => ({ w: s.w, r: s.r, rir: s.rir ?? null })),
      });
    }
  }
  return out;
}

/** Линейная регрессия: наклон, начальное значение, R². */
export function linreg(points) {
  const n = points.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of points) { sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y; }
  const den = n * sxx - sx * sx;
  if (den === 0) return null;
  const slope = (n * sxy - sx * sy) / den;
  const icpt = (sy - slope * sx) / n;
  const ssTot = syy - (sy * sy) / n;
  let ssRes = 0;
  for (const [x, y] of points) ssRes += (y - (icpt + slope * x)) ** 2;
  const r2 = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 1;
  return { slope, icpt, r2 };
}

/** Темп прогресса: % изменения силы в неделю. Нужно ≥3 тренировки на промежутке ≥ 7 дней. */
export function progressRate(history) {
  if (!history || history.length < 3) return null;
  const t0 = history[0].t;
  const span = (history[history.length - 1].t - t0) / DAY;
  if (span < 7) return null;
  const reg = linreg(history.map((h) => [(h.t - t0) / DAY, h.best]));
  if (!reg || reg.icpt <= 0) return null;
  const pctWeek = (reg.slope * 7 / reg.icpt) * 100;
  const first = reg.icpt, last = reg.icpt + reg.slope * span;
  return { pctWeek: round1(pctWeek), r2: Math.round(reg.r2 * 100) / 100, first: round1(first), last: round1(last), weeks: round1(span / 7), n: history.length };
}

/** Рейтинг эффективности упражнений «для меня». */
export function effectiveness(workouts) {
  const ids = new Set();
  for (const w of workouts) for (const e of w.ex || []) ids.add(e.id);
  const rows = [];
  for (const id of ids) {
    const h = exerciseHistory(workouts, id);
    const pr = progressRate(h);
    const hardSets = h.reduce((a, x) => a + x.hardSets, 0);
    if (!pr) { rows.push({ exId: id, sessions: h.length, hardSets, ready: false }); continue; }
    const gainPct = ((pr.last - pr.first) / pr.first) * 100;
    const perSet = hardSets ? gainPct / hardSets : 0; // % прироста на один тяжёлый подход
    const score = pr.pctWeek * (0.5 + 0.5 * pr.r2);
    rows.push({ exId: id, sessions: h.length, hardSets, ready: true, pctWeek: pr.pctWeek, r2: pr.r2,
      gainPct: round1(gainPct), perSet: Math.round(perSet * 100) / 100, score: round1(score), first: pr.first, last: pr.last });
  }
  return rows.sort((a, b) => (b.ready - a.ready) || ((b.score ?? -1e9) - (a.score ?? -1e9)) || b.sessions - a.sessions);
}

/** Тяжёлые подходы на мышцу за период (основная мышца = 1, вспомогательная = 0.5). */
export function muscleVolume(workouts, from = 0, to = Infinity) {
  const vol = Object.fromEntries(Object.keys(MUSCLES).map((m) => [m, 0]));
  for (const w of workouts) {
    const t = ts(w.start);
    if (t < from || t >= to) continue;
    for (const e of w.ex || []) {
      const ex = EXERCISES[e.id];
      if (!ex) continue;
      const n = (e.sets || []).filter(isHardSet).length;
      for (const m of ex.primary) vol[m] += n;
      for (const m of ex.secondary) vol[m] += n * 0.5;
    }
  }
  for (const m in vol) vol[m] = round1(vol[m]);
  return vol;
}

/** Ориентиры недельного объёма (тяжёлых подходов) для ~1 года стажа. Бицепс и трицепс — акцент программы,
 * предплечья растут вместе с ними (молотки, канат): docs/PLAN_V2.md §5. */
export const VOLUME_TARGETS = {
  chest: [8, 14], lats: [8, 14], mid_back: [6, 12], front_delt: [4, 10], side_delt: [6, 14], rear_delt: [4, 10],
  traps: [2, 8], lower_back: [2, 6], biceps: [10, 16], triceps: [10, 16], forearms: [2, 10], abs: [4, 10], obliques: [2, 6],
  glutes: [6, 12], quads: [8, 14], hamstrings: [6, 12], adductors: [2, 8], calves: [6, 12],
};

/** Прогресс по мышцам: средневзвешенный темп роста упражнений, которые их тренируют. */
export function muscleProgress(workouts) {
  const eff = effectiveness(workouts).filter((r) => r.ready);
  const acc = {};
  for (const r of eff) {
    const ex = EXERCISES[r.exId];
    if (!ex) continue;
    const add = (m, k) => {
      const wgt = k * Math.max(r.hardSets, 1);
      acc[m] ??= { sum: 0, w: 0, exercises: [] };
      acc[m].sum += r.pctWeek * wgt; acc[m].w += wgt; acc[m].exercises.push(r.exId);
    };
    ex.primary.forEach((m) => add(m, 1));
    ex.secondary.forEach((m) => add(m, 0.4));
  }
  const out = {};
  for (const m of Object.keys(MUSCLES)) {
    const a = acc[m];
    out[m] = a ? { pctWeek: round1(a.sum / a.w), exercises: [...new Set(a.exercises)] } : null;
  }
  return out;
}

/** Нормированная «тепловая карта» для 3D-фигуры: 0..1 по мышцам. */
export function muscleHeat(workouts, mode = 'progress') {
  if (mode === 'volume') {
    const now = Date.now();
    const v = muscleVolume(workouts, now - 7 * DAY, now + DAY);
    const out = {};
    for (const m in v) { const [lo, hi] = VOLUME_TARGETS[m] || [6, 12]; out[m] = Math.min(1, v[m] / hi) * (v[m] >= lo ? 1 : 0.75); }
    return out;
  }
  const p = muscleProgress(workouts);
  const vals = Object.values(p).filter(Boolean).map((x) => x.pctWeek);
  const max = Math.max(1, ...vals);
  const out = {};
  for (const m in p) out[m] = p[m] ? Math.max(0.08, Math.min(1, p[m].pctWeek / max)) : 0;
  return out;
}

const roundTo = (x, step) => {
  const s = Math.abs(step) || 1;
  return Math.round(Math.round(x / s) * s * 100) / 100;
};
const floorTo = (x, step) => {
  const s = Math.abs(step) || 1;
  return Math.round(Math.floor(x / s + 1e-9) * s * 100) / 100;
};

/**
 * Цели на следующую тренировку для одного пункта программы (двойная прогрессия).
 * item: { exId, sets, reps:[lo,hi], rir:[lo,hi] }
 * Возвращает { mode, w, reps:[lo,hi], sets, note, last }
 *   mode: 'calibrate' — подобрать вес; 'increase' — добавить вес; 'reps' — добавить повторы; 'hold'; 'reduce'.
 * calibrating — идёт неделя знакомства (по умолчанию считается по тренировкам, calibCount): упражнение, которое
 * пока делалось только на знакомстве, остаётся «подобрать вес» (hint — прошлый вес); рабочий вес — после знакомства.
 */
export function nextTarget(workouts, item, exIdOverride = null, calibrating = calibCount(workouts) < PROGRAM.calibration.sessions) {
  const exId = exIdOverride || item.exId;
  const ex = EXERCISES[exId];
  const [lo, hi] = item.reps;
  const h = exerciseHistory(workouts, exId);
  const base = { exId, sets: item.sets, reps: [lo, hi] };
  if (!h.length) {
    return { ...base, mode: 'calibrate', w: null, last: null,
      note: `Подбери вес на ${hi} повторов с запасом 2–3 (RIR 2–3).` };
  }
  const last = h[h.length - 1];
  const inc = Math.abs(ex?.increment || 2.5);
  const assisted = (ex?.increment || 0) < 0;
  if (REPS_ONLY(ex)) {
    const allTop = last.sets.length >= item.sets && last.sets.every((s) => s.r >= hi);
    return { ...base, mode: allTop ? 'increase' : 'reps', w: 0, last: last.sets,
      note: allTop ? 'Верх диапазона пройден: замедли темп или добавь отягощение.' : 'Добавь 1–2 повтора в каждом подходе.' };
  }
  const topW = Math.max(...last.sets.map((s) => s.w));
  const atTop = last.sets.filter((s) => s.w === topW);
  if (calibrating && h.every((x) => x.calib)) {
    return { ...base, mode: 'calibrate', w: null, hint: topW, last: last.sets,
      note: `Неделя знакомства ещё идёт: подбери вес на ${hi} повторов с запасом 2–3 (RIR 2–3).` };
  }
  // После недели знакомства: рабочий вес из лучшей оценки силы
  if (last.calib && h.filter((x) => !x.calib).length === 0) {
    const best = Math.max(...h.map((x) => x.best));
    const rirT = item.rir?.[1] ?? 2;
    const repsT = Math.round((lo + hi) / 2);
    let w = best / (1 + (repsT + rirT) / 30);
    if (assisted) {
      // помощь: чем больше помощь, тем легче — оставляем ту же помощь, работаем на повторы
      return { ...base, mode: 'hold', w: topW, last: last.sets, note: 'Та же помощь, добирай повторы до верха диапазона.' };
    }
    w = Math.max(floorTo(w, inc), 0);
    return { ...base, mode: 'hold', w: w || topW, reps: [repsT, hi], last: last.sets,
      note: `Рабочий вес из недели знакомства (оценка 1ПМ ≈ ${ru(round1(best))} кг).` };
  }
  const enoughSets = atTop.length >= Math.min(item.sets, last.sets.length) && last.sets.length >= item.sets;
  const allHit = enoughSets && atTop.every((s) => s.r >= hi);
  const rirOk = atTop.every((s) => s.rir == null || s.rir >= (item.rir?.[0] ?? 0));
  if (allHit && rirOk) {
    const w = assisted ? Math.max(topW - inc, 0) : roundTo(topW + inc, inc);
    return { ...base, mode: 'increase', w, reps: [lo, hi], last: last.sets,
      note: assisted ? `Верх диапазона во всех подходах → уменьши помощь до ${ru(w)} кг.` : `Верх диапазона во всех подходах → +${ru(inc)} кг.` };
  }
  // две тренировки подряд ниже нижней границы → снизить вес
  const prev = h[h.length - 2];
  const below = (x) => x && x.sets.filter((s) => s.w === Math.max(...x.sets.map((q) => q.w))).some((s) => s.r < lo);
  if (below(last) && below(prev)) {
    const w = assisted ? topW + inc : Math.max(roundTo(topW * 0.9, inc), 0);
    return { ...base, mode: 'reduce', w, reps: [lo, hi], last: last.sets,
      note: 'Дважды ниже диапазона → снизь вес ~10% и наберись повторов.' };
  }
  return { ...base, mode: 'reps', w: topW, reps: [lo, hi], last: last.sets,
    note: 'Тот же вес: добавь хотя бы 1 повтор в одном из подходов.' };
}

export function nextTargets(workouts, session, swaps = {}) {
  return session.items.map((it) => nextTarget(workouts, it, swaps[it.exId] || null));
}

/** Рекорды: для каждой тренировки — упражнения, где лучшая оценка силы превысила все предыдущие. */
export function prs(workouts) {
  const best = {};
  const out = [];
  for (const w of sortedWorkouts(workouts)) {
    for (const e of w.ex || []) {
      let top = 0, topSet = null;
      for (const s of workingSets(e)) { const sc = setScore(e.id, s, w.bw); if (sc > top) { top = sc; topSet = s; } }
      if (!topSet) continue;
      if (best[e.id] != null && top > best[e.id] + 0.05) out.push({ workoutId: w.id, date: w.start, exId: e.id, score: round1(top), prev: round1(best[e.id]), w: topSet.w, r: topSet.r });
      best[e.id] = Math.max(best[e.id] ?? 0, top);
    }
  }
  return out;
}

/** Будет ли этот подход рекордом (для живого бейджа во время тренировки). */
export function isPR(workouts, exId, set, bw = null, excludeWorkoutId = null) {
  let best = 0, seen = false;
  for (const w of workouts) {
    if (w.id === excludeWorkoutId) continue;
    for (const e of w.ex || []) if (e.id === exId) for (const s of workingSets(e)) { seen = true; best = Math.max(best, setScore(exId, s, w.bw)); }
  }
  return seen && setScore(exId, set, bw) > best + 0.05;
}

/** Застой: лучшая оценка не росла последние 3 тренировки этого упражнения. */
export function stalls(workouts, n = 3) {
  const ids = new Set();
  for (const w of workouts) for (const e of w.ex || []) ids.add(e.id);
  const out = [];
  for (const id of ids) {
    const h = exerciseHistory(workouts, id).filter((x) => !x.calib);
    if (h.length < n + 1) continue;
    const before = Math.max(...h.slice(0, -n).map((x) => x.best));
    const recent = Math.max(...h.slice(-n).map((x) => x.best));
    if (recent <= before * 1.005) out.push({ exId: id, best: before, recent, sessions: n });
  }
  return out;
}

const MAIN_LIFTS = new Set(Object.values(PROGRAM.sessions).map((s) => s.items[0].exId));

export function deloadAdvice(workouts, lastDeloadISO = null) {
  const ws = sortedWorkouts(workouts).filter((w) => !w.calib);
  if (!ws.length) return null;
  const st = stalls(workouts).filter((s) => MAIN_LIFTS.has(s.exId));
  const sinceT = lastDeloadISO ? ts(lastDeloadISO) : ts(ws[0].start);
  const weeks = (Date.now() - sinceT) / (7 * DAY);
  if (st.length >= 2) return { reason: 'stall', weeks: round1(weeks), stalled: st.map((s) => s.exId), text: 'Главные упражнения стоят 3 тренировки подряд → пора на разгрузочную неделю.' };
  if (weeks >= 7) return { reason: 'time', weeks: round1(weeks), stalled: [], text: `Прошло ${Math.floor(weeks)} нед. без разгрузки — запланируй лёгкую неделю.` };
  return null;
}

/** Начало недели (понедельник 00:00, локальное время). */
export function weekStart(t) {
  const d = new Date(t);
  const day = (d.getDay() + 6) % 7;
  d.setHours(0, 0, 0, 0);
  return d.getTime() - day * DAY;
}

export function duration(w) {
  if (!w.end) return null;
  return Math.max(0, Math.round((ts(w.end) - ts(w.start)) / 60000));
}

/** Посещаемость по неделям, средняя длительность, время прихода, серия недель с ≥3 тренировками. */
export function attendance(workouts) {
  const ws = sortedWorkouts(workouts);
  const weeks = {};
  for (const w of ws) { const k = weekStart(ts(w.start)); weeks[k] = (weeks[k] || 0) + 1; }
  const durs = ws.map(duration).filter((x) => x != null);
  const hours = ws.map((w) => new Date(w.start).getHours() + new Date(w.start).getMinutes() / 60);
  let streak = 0;
  const cur = weekStart(Date.now());
  for (let k = cur - (weeks[cur] >= 3 ? 0 : 7 * DAY); ; k -= 7 * DAY) { if ((weeks[k] || 0) >= 3) streak++; else break; }
  return {
    total: ws.length,
    thisWeek: weeks[cur] || 0,
    weeks: Object.entries(weeks).map(([k, n]) => ({ week: Number(k), n })).sort((a, b) => a.week - b.week),
    avgDuration: durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : null,
    avgHour: hours.length ? round1(hours.reduce((a, b) => a + b, 0) / hours.length) : null,
    streakWeeks: streak,
    days: ws.map((w) => w.start.slice(0, 10)),
  };
}

/** Сводка одной тренировки (для экрана завершения и бота). */
export function workoutSummary(workouts, w) {
  const others = workouts.filter((x) => x.id !== w.id && ts(x.start) < ts(w.start));
  let volume = 0, sets = 0;
  const prList = [];
  for (const e of w.ex || []) {
    for (const s of workingSets(e)) { volume += setVolume(e.id, s); if (isHardSet(s)) sets++; }
    const top = workingSets(e).reduce((b, s) => (setScore(e.id, s, w.bw) > (b ? setScore(e.id, b, w.bw) : 0) ? s : b), null);
    if (top && isPR(others, e.id, top, w.bw)) prList.push({ exId: e.id, w: top.w, r: top.r, score: round1(setScore(e.id, top, w.bw)) });
  }
  return { id: w.id, session: w.session, calib: !!w.calib, duration: duration(w), volume: Math.round(volume), hardSets: sets, exercises: (w.ex || []).filter((e) => workingSets(e).length).length, prs: prList };
}

/** Недельный отчёт. */
export function weeklyReport(workouts, refT = Date.now()) {
  const from = weekStart(refT), to = from + 7 * DAY;
  const ws = sortedWorkouts(workouts).filter((w) => ts(w.start) >= from && ts(w.start) < to);
  const vol = muscleVolume(workouts, from, to);
  const low = Object.entries(vol).filter(([m, v]) => VOLUME_TARGETS[m] && v < VOLUME_TARGETS[m][0] && ['chest', 'lats', 'mid_back', 'side_delt', 'quads', 'hamstrings', 'glutes', 'biceps', 'triceps', 'calves'].includes(m)).map(([m]) => m);
  const weekPrs = prs(workouts).filter((p) => ts(p.date) >= from && ts(p.date) < to);
  return { from, to, sessions: ws.length, summaries: ws.map((w) => workoutSummary(workouts, w)), volume: vol, lowVolume: low, prs: weekPrs };
}

/** Компактный текстовый контекст для ИИ-агента (бот). */
export function aiContext(workouts, opts = {}) {
  const ws = sortedWorkouts(workouts);
  const eff = effectiveness(ws).slice(0, 12).map((r) => r.ready
    ? `${EXERCISES[r.exId]?.name || r.exId}: ${r.pctWeek > 0 ? '+' : ''}${r.pctWeek}%/нед (R²=${r.r2}, сессий ${r.sessions}, тяж. подходов ${r.hardSets})`
    : `${EXERCISES[r.exId]?.name || r.exId}: мало данных (${r.sessions} сесс.)`);
  const recent = ws.slice(-(opts.recent ?? 6)).map((w) => {
    const ex = (w.ex || []).map((e) => `${EXERCISES[e.id]?.short || e.id}${e.from ? ` (вместо ${EXERCISES[e.from]?.short || e.from})` : ''}: ${workingSets(e).map((s) => `${s.w}×${s.r}${s.rir != null ? `@${s.rir}` : ''}`).join(', ')}`).join('; ');
    return `${w.start.slice(0, 16).replace('T', ' ')} ${PROGRAM.sessions[w.session]?.name || w.session}${w.calib ? ' [знакомство]' : ''}${duration(w) ? `, ${duration(w)} мин` : ''}${w.feel ? `, самочувствие ${w.feel}/5` : ''}${w.note ? `, заметка: ${w.note}` : ''} — ${ex}`;
  });
  const vol = muscleVolume(ws, Date.now() - 7 * DAY, Date.now() + DAY);
  const st = stalls(ws).map((s) => EXERCISES[s.exId]?.name || s.exId);
  const att = attendance(ws);
  return [
    `Тренировок всего: ${att.total}, на этой неделе: ${att.thisWeek}, средняя длительность: ${att.avgDuration ?? '—'} мин.`,
    `Эффективность упражнений (рост оценки 1ПМ):\n- ${eff.join('\n- ') || 'нет данных'}`,
    `Тяжёлые подходы за 7 дней: ${Object.entries(vol).filter(([, v]) => v > 0).map(([m, v]) => `${MUSCLES[m].name} ${v}`).join(', ') || 'нет'}`,
    `Застой: ${st.join(', ') || 'нет'}`,
    `Последние тренировки (вес×повторы@RIR):\n${recent.join('\n') || 'нет'}`,
  ].join('\n\n');
}
