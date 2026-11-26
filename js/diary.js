// Дневник состояния: режим (сушка / набор / поддержание / рекомпозиция) со своими нормами, питание, вес и сон по дням.
// Чистые функции без DOM и хранилища — их импортируют и приложение, и бот. Контракт: docs/DIARY_CONTRACT.md
//
// days — всегда простая карта { 'YYYY-MM-DD': DiaryDay } без «надгробий»; goal — сохранённый объект { entries } или null.
// Даты — строки 'YYYY-MM-DD' (сравниваются как строки), время — строки 'HH:MM'. Функции не меняют входные данные
// и ходят только по запрошенному окну дат, а не по всему дневнику.
import { exerciseHistory, progressRate, ts } from './analytics.js';

/**
 * @typedef {{ kcal: number|null, p: number|null, f: number|null, c: number|null, w: number|null,
 *   wake: string|null, bed: string|null, note: string, upd?: string }} DiaryDay
 *   Ккал; белки/жиры/углеводы в граммах; w — утренний вес, кг; wake — во сколько проснулся в этот день;
 *   bed — во сколько лёг в конце этого дня (раньше '12:00' = уже после полуночи). null = не введено.
 * @typedef {{ from: string, mode: 'cut'|'bulk'|'maintain'|'recomp', kcal: number|null, p: number|null,
 *   f: number|null, c: number|null, targetW: number|null, note: string }} GoalEntry
 *   Нормы действуют с даты from до следующей записи.
 * @typedef {{ v?: number, entries: GoalEntry[], upd?: string }} Goal
 * @typedef {Record<string, DiaryDay>} Days
 * @typedef {{ v: number|null, target: number|null, pct: number|null, ok: boolean|null }} Check
 *   Значение дня против нормы: pct = v / target − 1; ok — попал ли в норму (null, если сравнить не с чем).
 */

/** Режимы. rate — здоровое изменение веса тела, % от веса в неделю. code — буква в компактном формате для бота. */
export const MODES = {
  cut: { name: 'Сушка', code: 'c', rate: [-1.0, -0.5] },
  bulk: { name: 'Набор массы', code: 'b', rate: [0.25, 0.5] },
  maintain: { name: 'Поддержание', code: 'm', rate: [-0.25, 0.25] },
  recomp: { name: 'Рекомпозиция', code: 'r', rate: [-0.25, 0.25] },
};
const MODE_BY_CODE = Object.fromEntries(Object.entries(MODES).map(([id, m]) => [m.code, id]));
const isMode = (m) => typeof m === 'string' && Object.hasOwn(MODES, m);

/** Допустимые значения (их же проверяет бот). Всё, что вне диапазона, считается «не введено» (null). */
export const LIMITS = { kcal: [0, 15000], macro: [0, 2000], w: [20, 400], note: 300 };

/** Пороги правил — чтобы тексты интерфейса и бота ссылались на те же числа, что и расчёты. */
export const RULES = {
  dayStartHour: 5,      // до 05:00 дневник относится к вчерашнему дню
  remindHour: 20,       // с 20:00 незаполненный дневник — уже «пора заполнить»
  kcalTolerance: 0.1,   // калории «в коридоре»: ±10 % от нормы
  proteinShare: 0.9,    // белок «выполнен»: ≥ 90 % нормы
  proteinPerKg: 1.6,    // минимум белка, г на кг веса тела
  sleepMin: 420,        // средний сон не меньше 7 ч
  bedSpreadMax: 60,     // разброс времени отбоя, мин
  kcalInRangeMin: 0.6,  // доля дней с калориями в коридоре
  minLogged: 5,         // заполненных дней из последних 7, иначе «мало данных»
  rateSpan: 21,         // окно тренда веса, дней
  rateMinDays: 14,      // вердикт по темпу веса — когда взвешивания покрывают ≥ 14 дней режима
  rateMinWeights: 8,    // …и взвешиваний в окне не меньше 8
  kcalChange: 50,       // смена нормы калорий от 50 ккал — темп веса при новой норме считается заново
  strengthSpan: 28,     // окно для «сила падает на сушке», дней
  strengthFall: -1,     // медиана темпа силы, % в неделю
};

const DAY = 86400000;
const DOW = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const p2 = (n) => (n < 10 ? '0' : '') + n;
const round1 = (x) => Math.round(x * 10) / 10 || 0;
const round2 = (x) => Math.round(x * 100) / 100 || 0;

// ───────── Даты и время ─────────

/** 'YYYY-MM-DD' → миллисекунды полуночи UTC. Только календарная арифметика: часовые пояса и летнее время не влияют. */
const utc = (date) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
function fromUtc(t) {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}

/** Настоящая ли это календарная дата в виде 'YYYY-MM-DD' ('2026-02-30' → false). */
export function isDate(s) {
  if (typeof s !== 'string' || s.length !== 10 || s[4] !== '-' || s[7] !== '-') return false;
  const t = utc(s);
  return !Number.isNaN(t) && fromUtc(t) === s;
}

/**
 * Дата дневника — день, который сейчас заканчивается: до 05:00 местного времени это ещё «вчера»
 * (дневник, заполненный в 00:40, относится ко вчерашнему дню).
 * @param {Date|number} [now]
 * @param {number|null} [tzOffsetMin] смещение от UTC в минутах — для бота (TZ_OFFSET_MIN), чтобы не зависеть от пояса
 *   компьютера. Без него берётся местное время устройства.
 * @returns {string} 'YYYY-MM-DD'
 */
export function diaryDate(now = new Date(), tzOffsetMin = null) {
  const t = now instanceof Date ? now.getTime() : Number(now);
  if (tzOffsetMin != null) return fromUtc(t + tzOffsetMin * 60000 - RULES.dayStartHour * 3600000);
  const d = new Date(t);
  if (d.getHours() < RULES.dayStartHour) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/** Дата через n дней (n может быть отрицательным): addDays('2026-12-31', 1) → '2027-01-01'. */
export function addDays(date, n) { return fromUtc(utc(date) + n * DAY); }

/** Сколько дней от a до b: dayDiff('2026-11-01', '2026-11-08') → 7; отрицательное, если b раньше a. */
export function dayDiff(a, b) { return Math.round((utc(b) - utc(a)) / DAY); }

const digit = (s, i) => { const c = s.charCodeAt(i) - 48; return c >= 0 && c <= 9 ? c : NaN; };

/** 'HH:MM' (или 'H:MM') → минуты от 00:00; null, если строка не время. */
export function toMin(hhmm) {
  if (typeof hhmm !== 'string') return null;
  let h, m;
  if (hhmm.length === 5 && hhmm[2] === ':') { h = digit(hhmm, 0) * 10 + digit(hhmm, 1); m = digit(hhmm, 3) * 10 + digit(hhmm, 4); }
  else if (hhmm.length === 4 && hhmm[1] === ':') { h = digit(hhmm, 0); m = digit(hhmm, 2) * 10 + digit(hhmm, 3); }
  else return null;
  return h < 24 && m < 60 ? h * 60 + m : null; // NaN не проходит ни одно сравнение
}

/** Минуты → 'HH:MM'. Значения вне суток заворачиваются: fromMin(1470) → '00:30', fromMin(-30) → '23:30'. null → null. */
export function fromMin(min) {
  if (min == null || !Number.isFinite(min)) return null;
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${p2(Math.floor(m / 60))}:${p2(m % 60)}`;
}

/**
 * Время отбоя в минутах от 00:00 даты дневника: «после полуночи» (раньше 12:00) — это уже следующие сутки,
 * поэтому '00:40' → 1480, а '23:30' → 1410. Нужно для среднего, медианы и графика отбоя.
 */
export function bedOffset(hhmm) {
  const m = toMin(hhmm);
  return m == null ? null : m < 720 ? m + 1440 : m;
}

/** Компактная дата для передачи боту: '2026-11-26' → 20261126. */
export const dateToNum = (date) => +date.slice(0, 4) * 10000 + +date.slice(5, 7) * 100 + +date.slice(8, 10);
/** 20261126 → '2026-11-26'; null, если это не дата. */
export function numToDate(n) {
  if (!Number.isInteger(n) || n < 10000101 || n > 99991231) return null;
  const s = `${Math.floor(n / 10000)}-${p2(Math.floor(n / 100) % 100)}-${p2(n % 100)}`;
  return isDate(s) ? s : null;
}

// ───────── Проверка и приведение значений ─────────

function numIn(v, range, digits) {
  if (typeof v === 'string') { const s = v.trim().replace(',', '.'); v = s === '' ? null : Number(s); }
  if (typeof v !== 'number' || !Number.isFinite(v) || v < range[0] || v > range[1]) return null;
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}
const timeStr = (v) => fromMin(toMin(v));
function noteStr(v) {
  if (typeof v !== 'string') return '';
  let s = v.trim().slice(0, LIMITS.note);
  const last = s.charCodeAt(s.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) s = s.slice(0, -1); // не оставлять половинку эмодзи
  return s;
}

/**
 * Привести день к виду DiaryDay (без upd): числа в допустимых диапазонах (иначе null), ккал — целые, БЖУ — до 0,1 г,
 * вес — до 0,01 кг, время — 'HH:MM', заметка ≤ 300 символов. Числа можно передавать строкой с запятой.
 * @returns {DiaryDay}
 */
export function normalizeDay(raw) {
  const d = raw || {};
  return {
    kcal: numIn(d.kcal, LIMITS.kcal, 0), p: numIn(d.p, LIMITS.macro, 1), f: numIn(d.f, LIMITS.macro, 1), c: numIn(d.c, LIMITS.macro, 1),
    w: numIn(d.w, LIMITS.w, 2), wake: timeStr(d.wake), bed: timeStr(d.bed), note: noteStr(d.note),
  };
}

/** Привести запись режима к виду GoalEntry; null, если нет настоящей даты from или режим неизвестен. */
export function normalizeEntry(raw) {
  if (!raw || !isDate(raw.from) || !isMode(raw.mode)) return null;
  return {
    from: raw.from, mode: raw.mode,
    kcal: numIn(raw.kcal, LIMITS.kcal, 0), p: numIn(raw.p, LIMITS.macro, 1), f: numIn(raw.f, LIMITS.macro, 1), c: numIn(raw.c, LIMITS.macro, 1),
    targetW: numIn(raw.targetW, LIMITS.w, 1), note: noteStr(raw.note),
  };
}

/** День заполнен: введено хоть что-то из чисел или времени (одна заметка не считается). */
export function isLogged(day) {
  return !!day && !day.del
    && (day.kcal != null || day.p != null || day.f != null || day.c != null || day.w != null || day.wake != null || day.bed != null);
}

/** В дне нет ничего, даже заметки (такой день хранить незачем). */
export const isEmptyDay = (day) => !isLogged(day) && !(day && !day.del && day.note);

/**
 * Заполнена ли вечерняя часть дня: питание или время отбоя. День, где утром записали только вес и подъём,
 * уже «заполнен» (isLogged), но вечером о нём всё ещё стоит напомнить.
 */
export function hasEvening(day) {
  return !!day && !day.del && (day.kcal != null || day.p != null || day.f != null || day.c != null || day.bed != null);
}

/**
 * Пора ли заполнить дневник: режим выбран, на часах от 20:00 до 04:59 местного времени, а вечерняя часть дня
 * дневника (diaryDate(now)) ещё пуста. Для точки на вкладке «Профиль».
 * @param {Days} days
 * @param {Goal|null} goal
 * @param {Date|number} [now]
 */
export function diaryDue(days, goal, now = new Date()) {
  const d = new Date(now instanceof Date ? now.getTime() : Number(now));
  const h = d.getHours();
  if (h >= RULES.dayStartHour && h < RULES.remindHour) return false;
  const date = diaryDate(d);
  return !!goalAt(goal, date) && !hasEvening(days[date]);
}

const weightOf = (day) => (day && !day.del && typeof day.w === 'number' && day.w > 0 ? day.w : null);

// ───────── Режим и нормы ─────────

/**
 * Нормы, действовавшие в этот день: последняя запись с from ≤ date.
 * @param {Goal|null} goal
 * @param {string} date
 * @returns {GoalEntry|null} null — режима ещё не было
 */
export function goalAt(goal, date) {
  const es = goal?.entries;
  if (!es) return null;
  let best = null;
  for (let i = 0; i < es.length; i++) {
    const e = es[i];
    if (e && !e.del && e.from <= date && (!best || e.from >= best.from)) best = e; // del — надгробие (хранилище, бот)
  }
  return best;
}

/**
 * Фаза на эту дату: подряд идущие записи с одним режимом (смена норм внутри режима фазу не прерывает).
 * @returns {{ mode: string, from: string, day: number, entry: GoalEntry }|null} from — первый день фазы,
 *   day — номер дня фазы с единицы, entry — нормы на эту дату
 */
export function phaseAt(goal, date) {
  const entry = goalAt(goal, date);
  if (!entry) return null;
  let from = entry.from;
  for (;;) { // назад по записям, пока режим тот же (порядок записей в массиве не важен)
    let prev = null;
    for (const e of goal.entries) if (e && !e.del && e.from < from && (!prev || e.from >= prev.from)) prev = e;
    if (!prev || prev.mode !== entry.mode) break;
    from = prev.from;
  }
  return { mode: entry.mode, from, day: dayDiff(from, date) + 1, entry };
}

// ───────── Один день ─────────

/** Сон между отбоем предыдущего дня и подъёмом текущего, мин; null, если чего-то нет или вышло не 1…16 ч. */
function sleepBetween(prev, cur) {
  if (!prev || !cur) return null;
  const wake = toMin(cur.wake), bed = toMin(prev.bed);
  if (wake == null || bed == null) return null;
  const dur = wake - (bed < 720 ? bed : bed - 1440);
  return dur >= 60 && dur <= 960 ? dur : null;
}

/**
 * Ночной сон перед датой date: подъём в этот день минус отбой предыдущего дня.
 * @param {Days} days
 * @param {string} date
 * @returns {number|null} минуты; null, если нет одного из двух времён или получилось не 1…16 ч
 */
export function sleepMinutes(days, date) {
  const cur = days[date];
  return cur ? sleepBetween(days[addDays(date, -1)], cur) : null;
}

/**
 * Калории, которые дают макросы: 4·белки + 9·жиры + 4·углеводы. Годится и для дня, и для записи режима.
 * @returns {number|null} null, пока не введены все три числа
 */
export function macroKcal(day) {
  if (!day || day.p == null || day.f == null || day.c == null) return null;
  return Math.round(4 * day.p + 9 * day.f + 4 * day.c);
}

const kcalOk = (v, target) => Math.abs(v - target) <= target * RULES.kcalTolerance + 1e-9;
const proteinOk = (v, target) => v >= target * RULES.proteinShare - 1e-9;

function checkItem(v, target, okFn) {
  const val = typeof v === 'number' ? v : null;
  const tgt = typeof target === 'number' && target > 0 ? target : null;
  const has = val != null && tgt != null;
  return { v: val, target: tgt, pct: has ? val / tgt - 1 : null, ok: has && okFn ? okFn(val, tgt) : null };
}

/**
 * День против норм. Всегда возвращает все четыре поля — и для пустого дня, и без режима (тогда v / target = null).
 * @param {DiaryDay|null} day
 * @param {GoalEntry|null} entry нормы на этот день (goalAt)
 * @returns {{ kcal: Check, p: Check, f: Check, c: Check }} Check = { v, target, pct, ok }: pct = v / target − 1
 *   (−0,05 = на 5 % меньше нормы); ok — калории в пределах ±10 %, белок ≥ 90 % нормы; для жиров и углеводов
 *   и когда сравнить не с чем — null
 */
export function dayCheck(day, entry) {
  const d = day && !day.del ? day : null;
  return {
    kcal: checkItem(d?.kcal, entry?.kcal, kcalOk),
    p: checkItem(d?.p, entry?.p, proteinOk),
    f: checkItem(d?.f, entry?.f, null),
    c: checkItem(d?.c, entry?.c, null),
  };
}

// ───────── Вес ─────────

/**
 * Вес по дням для графика: по одной строке на каждый календарный день от from до to включительно.
 * @returns {{ date: string, w: number|null, avg7: number|null }[]} w — взвешивание в этот день (null, если не было);
 *   avg7 — среднее взвешиваний за 7 дней, заканчивающихся этим днём (null, если их меньше трёх)
 */
export function weightSeries(days, from, to) {
  const out = [];
  const n = dayDiff(from, to) + 1;
  if (!(n > 0)) return out;
  const win = [null, null, null, null, null, null, null]; // кольцо из последних семи дней
  let t = utc(from) - 6 * DAY;
  for (let i = -6; i < n; i++, t += DAY) {
    const date = fromUtc(t);
    const w = weightOf(days[date]);
    const slot = (i + 6) % 7;
    win[slot] = w;
    if (i < 0) continue;
    let sum = 0, cnt = 0;
    for (let k = 1; k <= 7; k++) { // от старого дня к новому — тот же порядок сложения, что и в periodSummary
      const x = win[(slot + k) % 7];
      if (x != null) { sum += x; cnt++; }
    }
    out.push({ date, w, avg7: cnt >= 3 ? round2(sum / cnt) : null });
  }
  return out;
}

/**
 * Темп изменения веса: наклон прямой по методу наименьших квадратов по взвешиваниям за span дней, заканчивающихся to.
 * @param {Days} days
 * @param {string} to
 * @param {number} [span] длина окна в днях
 * @returns {{ kgPerWeek: number, pctPerWeek: number, n: number, days: number }|null} n — число взвешиваний,
 *   days — сколько календарных дней они покрывают (от первого до последнего включительно), pctPerWeek — % от среднего
 *   веса в окне. null, если взвешиваний меньше 5 или они покрывают меньше 7 дней
 */
export function weightRate(days, to, span = RULES.rateSpan) {
  const tr = weightTrend(days, to, span);
  if (tr.n < 5 || tr.days < 7 || tr.perWeek == null) return null;
  return { kgPerWeek: round2(tr.perWeek), pctPerWeek: round2((tr.perWeek / tr.mean) * 100), n: tr.n, days: tr.days };
}

/** Сырой тренд веса в окне: сколько взвешиваний (n), сколько дней они покрывают (days), наклон в кг/нед и средний вес. */
function weightTrend(days, to, span) {
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, first = -1, last = -1;
  let t = utc(to) - (span - 1) * DAY;
  for (let i = 0; i < span; i++, t += DAY) {
    const w = weightOf(days[fromUtc(t)]);
    if (w == null) continue;
    if (first < 0) first = i;
    last = i;
    n++; sx += i; sy += w; sxx += i * i; sxy += i * w;
  }
  const den = n * sxx - sx * sx;
  return { n, days: n ? last - first + 1 : 0, mean: n ? sy / n : null, perWeek: den ? ((n * sxy - sx * sy) / den) * 7 : null };
}

/** Последнее известное взвешивание не позже даты to. @returns {{ date: string, w: number }|null} */
export function latestWeight(days, to) {
  let best = null;
  for (const date in days) {
    if (date > to || (best && date <= best)) continue;
    if (weightOf(days[date]) != null) best = date;
  }
  return best ? { date: best, w: days[best].w } : null;
}

// ───────── Период ─────────

/**
 * Сводка за период from…to включительно (нормы для каждого дня — те, что действовали в этот день).
 * @returns {{ total: number, logged: number, kcalAvg: number|null, pAvg: number|null, fAvg: number|null, cAvg: number|null,
 *   kcalInRange: number|null, proteinHit: number|null, wAvg: number|null, wChange: number|null, sleepAvg: number|null,
 *   bedAvg: number|null, wakeAvg: number|null, bedSpread: number|null, kcalN: number, pN: number, wN: number,
 *   sleepN: number, bedN: number, kcalDays: number, kcalOver: number, kcalUnder: number, proteinDays: number,
 *   kcalDev: number|null, kcalTarget: number|null }}
 *   total — дней в периоде, logged — заполненных; kcalAvg, pAvg, fAvg, cAvg — средние по дням, где значение введено;
 *   kcalInRange и proteinHit — доля (0…1) дней с калориями в коридоре ±10 % и с белком ≥ 90 % нормы среди дней, где
 *   введено значение и на этот день есть норма (их число — kcalDays и proteinDays; из kcalDays дней kcalOver — перебор
 *   больше 10 %, kcalUnder — недобор больше 10 %); kcalDev — среднее отклонение калорий от нормы своего дня
 *   (0,05 = в среднем на 5 % больше нормы; по тем же kcalDays дням) и kcalTarget — норма калорий этих дней, если она
 *   у всех одна (иначе null: норма внутри периода менялась);
 *   средние БЖУ и веса не округлены (округлять при показе — один раз), kcalAvg — целое;
 *   wAvg — средний вес, wChange — разница со средним весом предыдущего периода той же длины (нужно ≥ 3 взвешиваний
 *   в каждом); sleepAvg — средний ночной сон, мин; bedAvg и wakeAvg — средние отбой и подъём в минутах от 00:00
 *   (покажи через fromMin); bedSpread — стандартное отклонение времени отбоя, мин (нужно ≥ 3 значений);
 *   kcalN, pN, wN, sleepN, bedN — сколько значений стоит за соответствующим средним. Нет данных — null.
 */
export function periodSummary(days, goal, from, to) {
  const total = Math.max(0, dayDiff(from, to) + 1);
  let logged = 0, kS = 0, kN = 0, pS = 0, pN = 0, fS = 0, fN = 0, cS = 0, cN = 0;
  let kDays = 0, kOk = 0, kOver = 0, kDev = 0, kTarget = null, kMixed = false, pDays = 0, pOk = 0, wS = 0, wN = 0;
  let slS = 0, slN = 0, wkS = 0, wkN = 0, bS = 0, bSS = 0, bN = 0;
  const t0 = utc(from);
  let prev = total ? days[fromUtc(t0 - DAY)] : null;
  for (let i = 0, t = t0; i < total; i++, t += DAY) {
    const date = fromUtc(t);
    const day = days[date] && !days[date].del ? days[date] : null;
    if (day) {
      if (isLogged(day)) logged++;
      const e = goalAt(goal, date);
      if (day.kcal != null) {
        kS += day.kcal; kN++;
        if (e && e.kcal > 0) {
          kDays++;
          if (kcalOk(day.kcal, e.kcal)) kOk++; else if (day.kcal > e.kcal) kOver++;
          kDev += day.kcal / e.kcal - 1;
          if (kTarget == null) kTarget = e.kcal; else if (kTarget !== e.kcal) kMixed = true;
        }
      }
      if (day.p != null) { pS += day.p; pN++; if (e && e.p > 0) { pDays++; if (proteinOk(day.p, e.p)) pOk++; } }
      if (day.f != null) { fS += day.f; fN++; }
      if (day.c != null) { cS += day.c; cN++; }
      const w = weightOf(day);
      if (w != null) { wS += w; wN++; }
      const wake = toMin(day.wake);
      if (wake != null) { wkS += wake; wkN++; }
      const bed = bedOffset(day.bed);
      if (bed != null) { bS += bed; bSS += bed * bed; bN++; }
      const sl = sleepBetween(prev, day);
      if (sl != null) { slS += sl; slN++; }
    }
    prev = day;
  }
  let pwS = 0, pwN = 0; // вес за предыдущий период той же длины
  for (let i = 0, t = t0 - total * DAY; i < total; i++, t += DAY) {
    const w = weightOf(days[fromUtc(t)]);
    if (w != null) { pwS += w; pwN++; }
  }
  const need = Math.min(3, total);
  const bedMean = bN ? bS / bN : 0;
  return {
    total, logged,
    kcalAvg: kN ? Math.round(kS / kN) : null,
    // Средние БЖУ и веса не округляются: их округляет тот, кто показывает, — один раз и до нужного числа знаков
    // (иначе 78,2486 → 78,25 → «78,3» вместо «78,2»)
    pAvg: pN ? pS / pN : null, fAvg: fN ? fS / fN : null, cAvg: cN ? cS / cN : null,
    kcalInRange: kDays ? kOk / kDays : null,
    proteinHit: pDays ? pOk / pDays : null,
    wAvg: wN ? wS / wN : null,
    wChange: wN >= need && pwN >= need && need > 0 ? wS / wN - pwS / pwN : null,
    sleepAvg: slN ? Math.round(slS / slN) : null,
    bedAvg: bN ? Math.round(bedMean) % 1440 : null,
    wakeAvg: wkN ? Math.round(wkS / wkN) : null,
    bedSpread: bN >= 3 ? Math.round(Math.sqrt(Math.max(0, (bSS - bN * bedMean * bedMean) / (bN - 1)))) : null,
    kcalN: kN, pN, wN, sleepN: slN, bedN: bN, kcalDays: kDays, kcalOver: kOver, kcalUnder: kDays - kOk - kOver, proteinDays: pDays,
    kcalDev: kDays ? kDev / kDays : null, kcalTarget: kMixed ? null : kTarget,
  };
}

/** Сколько дней подряд заполнено, считая назад от to (если сам to ещё пуст — от предыдущего дня). */
export function streak(days, to) {
  let t = utc(to);
  if (!isLogged(days[to])) t -= DAY;
  let n = 0;
  while (isLogged(days[fromUtc(t)])) { n++; t -= DAY; }
  return n;
}

// ───────── Выводы ─────────

/** Число для русского текста: десятичная запятая, настоящий минус, без хвостовых нулей. */
function ru(x, digits = 1) {
  const k = 10 ** digits;
  return String(Math.round(x * k) / k || 0).replace('.', ',').replace('-', '−');
}
const signed = (x, digits = 1) => (Math.round(x * 10 ** digits) > 0 ? '+' : '') + ru(x, digits);
/** Минуты → «7 ч 05 мин» / «7 ч» / «45 мин». */
function hm(min) {
  const t = Math.round(min), h = Math.floor(t / 60), m = t % 60;
  return h ? (m ? `${h} ч ${p2(m)} мин` : `${h} ч`) : `${m} мин`;
}
/** «из 6 дней», «из 21 дня». */
const ofDays = (n) => `из ${n} ${n % 10 === 1 && n % 100 !== 11 ? 'дня' : 'дней'}`;

/** Темп силы за последние недели: медиана % в неделю по упражнениям, у которых хватает точек. */
function strengthTrend(workouts, fromT, toT) {
  const ws = workouts.filter((w) => w && w.end && !w.calib && ts(w.start) >= fromT && ts(w.start) < toT);
  if (ws.length < 3) return null;
  const ids = new Set();
  for (const w of ws) for (const e of w.ex || []) ids.add(e.id);
  const rates = [];
  for (const id of ids) {
    const pr = progressRate(exerciseHistory(ws, id));
    if (pr) rates.push(pr.pctWeek);
  }
  if (rates.length < 3) return null;
  rates.sort((a, b) => a - b);
  const mid = rates.length >> 1;
  const median = rates.length % 2 ? rates[mid] : (rates[mid - 1] + rates[mid]) / 2;
  return { median: round1(median), n: rates.length, falling: rates.filter((r) => r <= -0.5).length };
}

const LEVEL_ORDER = { warn: 0, info: 1, good: 2 };

/**
 * Когда в текущей фазе последний раз менялась норма калорий (не меньше чем на RULES.kcalChange ккал): темп веса
 * до этой даты относится к прежней норме. Смена белка, жиров или целевого веса не в счёт.
 * @returns {{ from: string, was: number, now: number }|null} null — норма калорий с начала фазы одна и та же
 */
function kcalChange(goal, phase) {
  const es = (goal?.entries || []).filter((e) => e && !e.del && e.from >= phase.from && e.from <= phase.entry.from).sort(byFrom);
  for (let i = es.length - 1; i > 0; i--) {
    const a = es[i - 1].kcal, b = es[i].kcal;
    if (a > 0 && b > 0 && Math.abs(a - b) >= RULES.kcalChange) return { from: es[i].from, was: a, now: b };
  }
  return null;
}

/**
 * Окно тренда веса на дату to — одно для вывода assess, для /goal бота и для сводки ИИ: последние ≤ 21 день текущей
 * фазы и не раньше последней смены нормы калорий (тренд прошлого режима или прежней нормы к нынешнему ориентиру
 * не относится).
 * @returns {{ phase: object, change: { from: string, was: number, now: number }|null, since: number, span: number }|null}
 *   since — который день действует нынешняя норма калорий (без смены нормы — день фазы); span — длина окна в днях;
 *   null — режима на эту дату нет
 */
export function trendWindow(goal, to) {
  const phase = phaseAt(goal, to);
  if (!phase) return null;
  const change = kcalChange(goal, phase);
  const since = change ? dayDiff(change.from, to) + 1 : phase.day;
  return { phase, change, since, span: Math.min(RULES.rateSpan, phase.day, since) };
}

/**
 * Выводы по дневнику на дату to. Только советы: нормы приложение само не меняет.
 * Правила: темп веса против ориентира режима (когда взвешивания покрывают ≥ 14 дней текущей фазы); калории в коридоре
 * реже чем в 60 % дней; белок меньше 1,6 г на кг веса; сон в среднем меньше 7 ч; разброс отбоя больше часа; меньше
 * 5 заполненных дней из последних 7 — «мало данных», и тогда темп веса не оценивается. Питание и сон считаются
 * за 7 дней, заканчивающихся последним закрытым днём (to, а если он ещё не заполнен — вчерашним: до вечера выводы
 * не меняются), тренд веса — за последние до 21 дня текущей фазы, но не раньше последней смены нормы калорий:
 * после неё вердикт по темпу появляется снова через две недели, а до тех пор — справка, что норма изменена.
 * Калории каждого дня сравниваются с нормой, которая действовала в этот день, а не с сегодняшней.
 * @param {Days} days
 * @param {Goal|null} goal
 * @param {string} to обычно diaryDate()
 * @param {object[]|null} [workouts] тренировки — тогда на сушке добавляется предупреждение, если сила заметно падает
 * @returns {{ level: 'good'|'warn'|'info', text: string }[]} сначала предупреждения, затем справки, затем то, что в порядке
 */
export function assess(days, goal, to, workouts = null) {
  const out = [];
  const add = (level, text) => out.push({ level, text });
  const end = isLogged(days[to]) ? to : addDays(to, -1);
  const weekFrom = addDays(end, -6);
  const week = periodSummary(days, goal, weekFrom, end);
  const phase = phaseAt(goal, to);
  const entry = phase?.entry || null;
  const enough = week.logged >= RULES.minLogged;
  // Насколько калории недели отклоняются от нормы — каждый день от своей (норму могли менять посреди недели):
  // тому, кто сам ест мимо нормы, менять её рано
  const kcalOff = week.kcalDays >= 3 ? week.kcalDev : null;
  const actual = week.kcalTarget != null ? `В среднем выходит ${week.kcalAvg} ккал при норме ${week.kcalTarget}`
    : `В среднем выходит на ${ru(Math.abs((kcalOff || 0) * 100), 0)} % ${kcalOff > 0 ? 'больше' : 'меньше'} нормы`;
  /** Совет, как поправить норму (dir: +1 — есть больше, −1 — меньше), или «сначала попади в неё». */
  const fix = (dir, advice) => (dir < 0 && kcalOff > 0.05 ? ` ${actual} — сначала попадай в норму.`
    : dir > 0 && kcalOff != null && kcalOff < -0.05 ? ` ${actual} — сначала доедай до нормы.` : ` ${advice}`);

  // 1. Темп веса
  if (phase && enough) {
    // Только дни текущей фазы: тренд прошлого режима к нынешнему ориентиру не относится. И только дни с нынешней
    // нормой калорий: иначе сразу после того, как норму поменяли по совету, совет повторялся бы ещё две недели.
    const { change, since, span } = trendWindow(goal, to);
    const seen = weightTrend(days, to, span);
    const rate = seen.days >= RULES.rateMinDays && seen.n >= RULES.rateMinWeights ? weightRate(days, to, span) : null;
    if (rate) {
      const r = rate.pctPerWeek;
      const pct = `${ru(Math.abs(r), 2)} % в неделю`;
      const spct = `${signed(r, 2)} % в неделю`;
      const kg = `${signed(rate.kgPerWeek, 2)} кг/нед`;
      const tw = entry.targetW, cur = week.wAvg;
      let eta = '';
      if (tw && cur != null && rate.kgPerWeek) {
        const weeks = (tw - cur) / rate.kgPerWeek;
        if (weeks >= 1 && weeks <= 104) eta = ` До целевых ${ru(tw)} кг осталось ${ru(Math.abs(tw - cur))} кг — при таком темпе примерно ${Math.round(weeks)} нед.`;
      }
      // Цель по весу достигнута: «вес больше не уходит / не растёт» — уже не проблема, такие замечания не нужны
      const reached = !!tw && cur != null && ((phase.mode === 'cut' && cur <= tw) || (phase.mode === 'bulk' && cur >= tw));
      if (reached) add('good', `Целевой вес ${ru(tw)} кг достигнут: среднее за неделю ${ru(cur)} кг. Можно переходить на поддержание.`);
      if (phase.mode === 'cut') {
        if (r < -1) add('warn', `Вес уходит слишком быстро, риск потерять мышцы: ${pct} (${kg}) при ориентире 0,5–1 %.${fix(1, 'Добавь к норме 100–200 ккал.')}`);
        else if (r <= -0.5) add('good', `Вес уходит на ${pct} (${kg}) — здоровый темп для сушки (0,5–1 %).${eta}`);
        else if (reached) { /* вес держится на достигнутой цели — замечаний нет */ }
        else if (r > -0.25) {
          add('warn', (r > 0.25 ? `На сушке вес растёт: ${spct} (${kg}) — дефицита сейчас нет.`
            : `На сушке вес почти не меняется: ${spct} (${kg}) при ориентире −0,5…−1 %.`)
            + fix(-1, 'Если так продержится ещё неделю, снизь норму на 100–200 ккал или добавь шагов.'));
        } else add('info', `Вес уходит медленнее ориентира: ${pct} (${kg}) при 0,5–1 %. Если не спешишь, это нормально; чтобы ускориться, убери 100–150 ккал или добавь шагов.${eta}`);
      } else if (phase.mode === 'bulk') {
        if (r > 0.75) add('warn', `Сейчас набор слишком быстрый: ${spct} (${kg}) при ориентире 0,25–0,5 % — лишнее уйдёт в жир.${fix(-1, 'Убери из нормы 100–200 ккал.')}`);
        else if (r >= 0.25 && r <= 0.5) add('good', `Вес растёт на ${pct} (${kg}) — хороший темп для набора (0,25–0,5 %).${eta}`);
        else if (r > 0.5) add('info', `Вес растёт чуть быстрее ориентира: ${pct} (${kg}) при 0,25–0,5 %. Следи за талией; если так продолжится, убери 100 ккал.${eta}`);
        else if (reached) { /* вес держится на достигнутой цели — замечаний нет */ }
        else if (r < 0.1) {
          add('warn', (r < -0.25 ? `На наборе вес снижается: ${spct} (${kg}).`
            : `На наборе вес не растёт: ${spct} (${kg}) при ориентире +0,25…+0,5 %.`)
            + fix(1, 'Если так продержится ещё неделю, добавь к норме 100–200 ккал.'));
        } else add('info', `Вес растёт медленнее ориентира: ${pct} (${kg}) при 0,25–0,5 %. Можно добавить к норме 100 ккал.${eta}`);
      } else {
        const recomp = phase.mode === 'recomp';
        if (Math.abs(r) > 0.25) {
          add('warn', `${recomp ? 'На рекомпозиции' : 'На поддержании'} вес ${r > 0 ? 'растёт' : 'снижается'}: ${spct} (${kg}), а должен держаться в пределах ±0,25 %.`
            + fix(r > 0 ? -1 : 1, `${r > 0 ? 'Убери из нормы' : 'Добавь к норме'} 100–150 ккал.`));
        } else add('good', `Вес стабилен: ${spct} (${kg}) — как и нужно ${recomp ? 'для рекомпозиции' : 'на поддержании'}.`);
      }
    } else if (phase.day < RULES.rateMinDays) {
      add('info', `Оценка темпа веса появится на ${RULES.rateMinDays}-й день режима (сейчас ${phase.day}-й): нужен тренд хотя бы за две недели.`);
    } else if (change && since < RULES.rateMinDays) {
      // Предварительный темп — когда с новой нормой набралось хотя бы 5 взвешиваний за неделю
      const early = weightRate(days, to, span);
      add('info', `С ${dm(change.from)} норма калорий ${change.now} вместо ${change.was} ккал. Темп веса при новой норме оценю на ${RULES.rateMinDays}-й день (сейчас ${since}-й): нужен тренд хотя бы за две недели.`
        + (early ? ` Предварительно — ${signed(early.pctPerWeek, 2)} % в неделю.` : ''));
    } else if (seen.n >= RULES.rateMinWeights) {
      add('info', `Оценка темпа веса появится после ближайшего взвешивания: пока взвешивания покрывают ${seen.days} дн. из нужных ${RULES.rateMinDays}.`);
    } else {
      add('info', `Темп веса пока не оценить: нужно хотя бы ${RULES.rateMinWeights} взвешиваний на отрезке от двух недель, а сейчас ${seen.n} за ${seen.days} дн. Взвешивайся утром натощак — каждый день или через день.`);
    }
  }

  // 2. Калории в коридоре
  let kcalWarn = false;
  if (week.kcalDays >= 3 && week.kcalInRange < RULES.kcalInRangeMin) {
    kcalWarn = true;
    const hits = Math.round(week.kcalInRange * week.kcalDays);
    const { kcalOver: over, kcalUnder: under } = week;
    add('warn', `Калории попали в коридор ±10 % только в ${hits} ${ofDays(week.kcalDays)} за неделю: в среднем ${week.kcalAvg} ккал${week.kcalTarget != null ? ` при норме ${week.kcalTarget}` : ' (норма на неделе менялась)'}.`
      + (over >= 2 * under ? ' Чаще выходит перебор.' : under >= 2 * over ? ' Чаще выходит недобор.' : ' То перебор, то недобор — старайся есть ровнее.'));
  }

  // 3. Белок на килограмм веса
  const bw = week.wAvg ?? latestWeight(days, to)?.w ?? null;
  const perKg = bw && week.pN >= 3 ? week.pAvg / bw : null;
  if (perKg != null && perKg < RULES.proteinPerKg) {
    add('warn', `Белка в среднем ${ru(perKg)} г на кг веса (${Math.round(week.pAvg)} г при весе ${ru(bw)} кг). Для мышц нужно от 1,6 г/кг — это от ${Math.ceil(RULES.proteinPerKg * bw - 1e-9)} г в день.`);
  }

  // 4. Сила на сушке
  if (workouts && phase?.mode === 'cut') {
    const [y, m, d] = [+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)];
    const toT = new Date(y, m, d + 1, RULES.dayStartHour).getTime();
    const span = Math.min(RULES.strengthSpan, phase.day);
    const st = strengthTrend(workouts, new Date(y, m, d + 1 - span).getTime(), toT);
    if (st && st.median <= RULES.strengthFall && st.falling * 2 > st.n) {
      add('warn', `На сушке сила заметно падает: в среднем ${ru(st.median)} % в неделю по ${st.n} упражнениям. Дефицит великоват для восстановления — добавь 100–200 ккал, проверь сон и белок.`);
    }
  }

  // 5. Сон
  let sleepWarn = false;
  if (week.sleepN >= 3 && week.sleepAvg < RULES.sleepMin) {
    sleepWarn = true;
    const earlier = Math.min(90, Math.max(15, Math.ceil((RULES.sleepMin - week.sleepAvg) / 15) * 15));
    const why = phase?.mode === 'cut' ? 'На сушке недосып усиливает голод и потерю мышц'
      : phase?.mode === 'bulk' ? 'Мышцы растут во сне, а не в зале' : 'Без сна восстановление и прогресс замедляются';
    add('warn', `Сон в среднем ${hm(week.sleepAvg)} — меньше 7 часов. ${why}: ложись на ${earlier} мин раньше.`);
  }
  if (week.bedSpread != null && week.bedSpread > RULES.bedSpreadMax) {
    sleepWarn = true;
    add('warn', `Время отбоя гуляет: разброс ${hm(week.bedSpread)} вокруг ${fromMin(week.bedAvg)}. Ложись примерно в одно и то же время (±30 мин) — сон станет глубже.`);
  }

  // 6. Что в порядке
  if (!kcalWarn && week.kcalDays >= RULES.minLogged && week.kcalInRange >= 0.8
    && week.proteinDays >= RULES.minLogged && week.proteinHit >= 0.8 && !(perKg != null && perKg < RULES.proteinPerKg)) {
    add('good', `Питание по плану: калории в коридоре ±10 % в ${Math.round(week.kcalInRange * week.kcalDays)} ${ofDays(week.kcalDays)}, белок в среднем ${Math.round(week.pAvg)} г${perKg != null ? ` (${ru(perKg)} г на кг)` : ''}.`);
  }
  if (!sleepWarn && week.sleepN >= RULES.minLogged && week.bedSpread != null) {
    add('good', `Сон в порядке: в среднем ${hm(week.sleepAvg)}, отбой стабильный (разброс ${week.bedSpread} мин).`);
  }

  // 7. Мало данных
  if (!enough) {
    let older = false; // были ли записи раньше этой недели, или дневник только начат
    let any = false;   // есть ли в дневнике хоть один заполненный день
    for (const date in days) {
      if (!isLogged(days[date])) continue;
      any = true;
      if (date < weekFrom) { older = true; break; }
    }
    add('info', !any ? `Дневник только начинается: заполняй его каждый вечер — первые выводы появятся, когда наберётся ${RULES.minLogged} дней.`
      : !week.logged ? 'Пока мало данных: за последние 7 дней дневник не заполнялся. Заполняй его каждый вечер — выводы появятся через несколько дней.'
      : older ? `Пока мало данных: заполнено ${week.logged} из последних 7 дней. Темп веса оценивается, когда заполнено хотя бы ${RULES.minLogged} дней в неделю.`
        : `Пока мало данных: в дневнике всего ${week.logged} ${week.logged === 1 ? 'день' : 'дня'}. Первые выводы появятся, когда наберётся хотя бы ${RULES.minLogged}.`);
  }

  return out.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]); // сортировка устойчивая: внутри уровня порядок правил
}

// ───────── Контекст для ИИ ─────────

const CONTEXT_LIMIT = 1500;
const dm = (date) => `${date.slice(8, 10)}.${date.slice(5, 7)}`;
const val = (x, digits = 0) => (x == null ? '—' : ru(x, digits));
const clockOf = (min) => `${Math.floor(min / 60)}:${p2(min % 60)}`;
/** Заметка одной строкой и не длиннее max символов (обрезанная заканчивается многоточием). */
function oneLine(s, max) {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trim()}…` : t;
}

function averagesLine(label, s, total) {
  const parts = [`заполнено ${s.logged} из ${total}`];
  if (s.kcalAvg != null) parts.push(`${s.kcalAvg} ккал`);
  if (s.pAvg != null || s.fAvg != null || s.cAvg != null) parts.push(`Б/Ж/У ${val(s.pAvg)}/${val(s.fAvg)}/${val(s.cAvg)} г`);
  if (s.kcalDays) parts.push(`калории в коридоре ±10 % — ${Math.round(s.kcalInRange * s.kcalDays)} дн. из ${s.kcalDays}`);
  if (s.proteinDays) parts.push(`белок ≥ 90 % нормы — ${Math.round(s.proteinHit * s.proteinDays)} дн. из ${s.proteinDays}`);
  return `Среднее за ${label}: ${parts.join('; ')}`;
}

/**
 * Короткая текстовая сводка дневника для запроса к ИИ (не длиннее 1500 символов): режим и день фазы, нормы,
 * таблица последних 7 дней, средние за 7 и 14 дней, тренд веса, сон, заметки.
 * @param {Days} days
 * @param {Goal|null} goal
 * @param {string} to последняя дата (обычно diaryDate())
 * @returns {string}
 */
export function diaryContext(days, goal, to) {
  const lines = [];
  const phase = phaseAt(goal, to);
  const e = phase?.entry;
  if (phase) {
    lines.push(`Режим: ${MODES[phase.mode].name}, день ${phase.day} (с ${phase.from}). Нормы на день: ${val(e.kcal)} ккал, белки ${val(e.p)} г, жиры ${val(e.f)} г, углеводы ${val(e.c)} г`
      + `${e.targetW ? `; целевой вес ${ru(e.targetW)} кг` : ''}${e.note ? `; пометка: ${oneLine(e.note, 80)}` : ''}.`);
  } else {
    const first = (goal?.entries || []).filter((x) => x && !x.del && x.from > to).sort(byFrom)[0];
    lines.push(first ? `${dm(to)} — до начала режима (${MODES[first.mode].name} с ${dm(first.from)}): норм на эту дату нет.` : 'Режим не выбран, норм нет.');
  }

  lines.push(`Дни до ${to} — ккал; Б/Ж/У, г; вес, кг; сон прошлой ночью; подъём–отбой:`);
  const notes = [];
  for (let i = 6; i >= 0; i--) {
    const date = addDays(to, -i);
    const d = days[date];
    const head = `${dm(date)} ${DOW[new Date(utc(date)).getUTCDay()]}:`;
    if (d && !d.del && d.note) notes.push(`${dm(date)} — ${oneLine(d.note, 70)}`);
    if (!isLogged(d)) { lines.push(`${head} —`); continue; }
    const sl = sleepMinutes(days, date);
    lines.push(`${head} ${val(d.kcal)}; ${val(d.p)}/${val(d.f)}/${val(d.c)}; ${val(d.w, 2)}; ${sl == null ? '—' : clockOf(sl)}; ${d.wake || '—'}–${d.bed || '—'}`);
  }

  const s7 = periodSummary(days, goal, addDays(to, -6), to);
  const s14 = periodSummary(days, goal, addDays(to, -13), to);
  lines.push(averagesLine('7 дн.', s7, 7));
  const line14 = averagesLine('14 дн.', s14, 14);
  lines.push(line14);

  // Окно тренда то же, что у выводов (assess): текущая фаза и нынешняя норма калорий. Иначе ИИ видел бы тренд прошлого
  // режима или прежней нормы рядом с ориентиром нынешнего — и повторял бы совет, который уже выполнен.
  const tw = trendWindow(goal, to);
  const rate = !tw ? weightRate(days, to, RULES.rateSpan) : tw.span >= 7 ? weightRate(days, to, tw.span) : null;
  const last = latestWeight(days, to);
  if (last) {
    const w = [s7.wAvg != null ? `среднее за 7 дн. ${ru(s7.wAvg, 2)} кг` : `последнее взвешивание ${ru(last.w, 2)} кг (${dm(last.date)})`];
    if (s7.wChange != null) w[0] += ` (${signed(s7.wChange, 2)} кг к предыдущим 7 дн.)`;
    const under = tw?.change ? ` при норме с ${dm(tw.change.from)}` : '';
    w.push(rate ? `тренд за ${rate.days} дн.${under}: ${signed(rate.kgPerWeek, 2)} кг/нед (${signed(rate.pctPerWeek, 2)} %/нед)`
      : tw && tw.span < 7 ? `тренда ${tw.change ? `при норме с ${dm(tw.change.from)}` : 'в этом режиме'} ещё нет (${tw.since}-й день)`
        : 'для тренда мало взвешиваний');
    if (phase) w.push(`ориентир режима ${signed(MODES[phase.mode].rate[0], 2)}…${signed(MODES[phase.mode].rate[1], 2)} %/нед`);
    lines.push(`Вес: ${w.join('; ')}.`);
  } else lines.push('Вес: взвешиваний нет.');

  if (s7.sleepAvg != null || s7.bedAvg != null) {
    const s = [];
    if (s7.sleepAvg != null) s.push(`в среднем ${hm(s7.sleepAvg)} (ночей: ${s7.sleepN})`);
    if (s7.bedAvg != null) s.push(`отбой ≈ ${fromMin(s7.bedAvg)}${s7.bedSpread != null ? `, разброс ${s7.bedSpread} мин` : ''}`);
    if (s7.wakeAvg != null) s.push(`подъём ≈ ${fromMin(s7.wakeAvg)}`);
    lines.push(`Сон за 7 дн.: ${s.join('; ')}.`);
  } else lines.push('Сон: данных нет.');

  // Лимит. Числа помещаются всегда (на крайний случай — без средних за 14 дней и с обрезкой);
  // заметки занимают то, что осталось, начиная с самых свежих.
  let text = lines.join('\n');
  if (text.length > CONTEXT_LIMIT) text = lines.filter((l) => l !== line14).join('\n');
  if (text.length > CONTEXT_LIMIT) return `${text.slice(0, CONTEXT_LIMIT - 1)}…`;
  const kept = [];
  let room = CONTEXT_LIMIT - text.length - '\nЗаметки: .'.length;
  for (let i = notes.length - 1; i >= 0; i--) {
    const cost = notes[i].length + (kept.length ? 2 : 0);
    if (cost > room) break;
    kept.unshift(notes[i]);
    room -= cost;
  }
  return kept.length ? `${text}\nЗаметки: ${kept.join('; ')}.` : text;
}

// ───────── Компактный формат для бота (см. sync.js) ─────────

/**
 * Версия записи для бота: её upd (ISO-строка или миллисекунды) в миллисекундах, иначе 0 (версии нет). По версиям бот
 * отличает правку от устаревшей копии с другого устройства: запись заменяется только более новой версией. Две версии
 * одной записи на одном устройстве всегда различаются хотя бы на 1 мс (storage.js, stampAfter).
 */
export function versionOf(upd) {
  const v = typeof upd === 'number' ? upd : typeof upd === 'string' ? Date.parse(upd) : NaN;
  return isVersion(v) ? v : 0;
}
/** Годная ли версия из посылки (миллисекунды, не раньше 2001 и не позже 5000 года). */
export const isVersion = (v) => Number.isSafeInteger(v) && v > 1e12 && v < 1e14;

/**
 * День → DayCompact: [ymd, kcal, p, f, c, w, wakeMin, bedMin, ver?, note?]; удалённый день (day = null или надгробие) →
 * [ymd, 'x', ver?]. ver — версия записи (versionOf её upd), число; заметка — всегда строка, поэтому и строку прежнего
 * вида [… bedMin, note?] (без версии) разобрать можно.
 * @param {string} date 'YYYY-MM-DD'
 * @param {DiaryDay|null} day
 * @param {string|number} [upd] метка записи (для удалённого дня — метка надгробия)
 */
export function dayToCompact(date, day, upd = day?.upd) {
  const ymd = dateToNum(date);
  const ver = versionOf(upd);
  if (!day || day.del) return ver ? [ymd, 'x', ver] : [ymd, 'x'];
  const row = [ymd, day.kcal ?? null, day.p ?? null, day.f ?? null, day.c ?? null, day.w ?? null, toMin(day.wake), toMin(day.bed)];
  if (ver) row.push(ver);
  const note = noteStr(day.note);
  if (note) row.push(note);
  return row;
}

const minutesOrNull = (v) => (Number.isInteger(v) && v >= 0 && v < 1440 ? fromMin(v) : null);

/**
 * DayCompact → { date, …DiaryDay, ver? } (без upd) или { date, del: true, ver? }. Значения проходят через LIMITS: всё,
 * что вне диапазона, становится null. ver — версия записи, если приложение её прислало. Возвращает null, если строка
 * не разбирается (нет настоящей даты).
 */
export function dayFromCompact(row) {
  if (!Array.isArray(row)) return null;
  const date = numToDate(row[0]);
  if (!date) return null;
  if (row[1] === 'x') return isVersion(row[2]) ? { date, del: true, ver: row[2] } : { date, del: true };
  const versioned = typeof row[8] === 'number'; // [… bedMin, ver, note?]; прежний вид — [… bedMin, note?]
  const d = normalizeDay({ kcal: row[1], p: row[2], f: row[3], c: row[4], w: row[5], note: row[versioned ? 9 : 8] });
  d.wake = minutesOrNull(row[6]);
  d.bed = minutesOrNull(row[7]);
  return versioned && isVersion(row[8]) ? { date, ...d, ver: row[8] } : { date, ...d };
}

const byFrom = (a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0);

/**
 * Режим → GoalCompact: [[ymd, код режима, kcal, p, f, c, targetW|null, ver?], …] — последние max записей по дате, и за
 * ними — убранные в этом же отрезке записи [ymd, 'x', ver] (если режим хранится с надгробиями и метками, как в
 * storage.js). ver — версия записи (versionOf её upd). Пометка (note) боту не передаётся.
 * @param {Goal|null} goal
 * @param {number} [max]
 */
export function goalToCompact(goal, max = 6) {
  const all = (goal?.entries || []).filter((e) => e && isDate(e.from)).sort(byFrom);
  const alive = all.filter((e) => !e.del && isMode(e.mode));
  const live = alive.slice(-max);
  const floor = alive.length > live.length ? live[0].from : null; // история не уместилась — надгробия только из её хвоста
  const rows = live.map((e) => {
    const row = [dateToNum(e.from), MODES[e.mode].code, e.kcal ?? null, e.p ?? null, e.f ?? null, e.c ?? null, e.targetW ?? null];
    const ver = versionOf(e.upd);
    if (ver) row.push(ver);
    return row;
  });
  const gone = all.filter((e) => e.del && (!floor || e.from > floor) && versionOf(e.upd)).slice(-max);
  for (const e of gone) rows.push([dateToNum(e.from), 'x', versionOf(e.upd)]);
  return rows;
}

/**
 * GoalCompact → { entries, gone? } или null, если нет ни одной годной строки. entries — по возрастанию даты, note = '',
 * ver — если версия пришла; gone — убранные записи [{ from, ver }] (только с версией).
 */
export function goalFromCompact(rows) {
  if (!Array.isArray(rows)) return null;
  const byDate = new Map();
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    let e;
    if (row[1] === 'x') e = numToDate(row[0]) && isVersion(row[2]) ? { from: numToDate(row[0]), del: true, ver: row[2] } : null;
    else {
      e = normalizeEntry({ from: numToDate(row[0]), mode: MODE_BY_CODE[row[1]], kcal: row[2], p: row[3], f: row[4], c: row[5], targetW: row[6] });
      if (e && isVersion(row[7])) e.ver = row[7];
    }
    if (e && !(byDate.get(e.from)?.ver > (e.ver || 0))) byDate.set(e.from, e);
  }
  const list = [...byDate.values()].sort(byFrom);
  const entries = list.filter((e) => !e.del);
  const gone = list.filter((e) => e.del).map(({ from, ver }) => ({ from, ver }));
  if (!entries.length && !gone.length) return null;
  return gone.length ? { entries, gone } : { entries };
}

/**
 * Слить историю режима, пришедшую от приложения (посылка несёт только последние записи), с уже сохранённой у бота:
 * записи старше первой пришедшей остаются, а начиная с её даты действуют пришедшие. Так до бота доходят и правка,
 * и откат норм в приложении, а давняя история (начало фазы) не теряется.
 * @param {{ entries: GoalEntry[] }|null} stored
 * @param {{ entries: GoalEntry[] }|null} incoming результат goalFromCompact / parsePayload().goal
 * @returns {{ entries: GoalEntry[] }|null}
 */
export function mergeGoal(stored, incoming) {
  const fresh = (incoming?.entries || []).filter((e) => e && isDate(e.from)).sort(byFrom);
  const old = (stored?.entries || []).filter((e) => e && isDate(e.from));
  if (!fresh.length) return old.length ? { entries: old.sort(byFrom) } : null;
  return { entries: [...old.filter((e) => e.from < fresh[0].from).sort(byFrom), ...fresh] };
}
