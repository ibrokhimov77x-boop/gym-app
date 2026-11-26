// Прикладная логика экранов «Состояние» и дневника поверх diary.js: подписи и форматы чисел, метки дней,
// обычное время подъёма, подсказки «сколько осталось до нормы» и черновики форм (введённое не теряется, если
// приложение закрыли на полпути). Без DOM: модуль можно проверять в Node (tools/test/diary-ui.test.mjs).
import {
  MODES, LIMITS, RULES, addDays, dayDiff, toMin, fromMin, bedOffset, isLogged, dayCheck, normalizeDay, normalizeEntry,
} from '../diary.js';
import { num, dayShort } from './dom.js';

// ───────── Режимы ─────────

/** Иконка режима и короткое пояснение (ориентир темпа берётся из MODES, чтобы цифры не расходились с расчётами). */
export const MODE_UI = {
  cut: { icon: 'flame' },
  bulk: { icon: 'progress' },
  maintain: { icon: 'equal' },
  recomp: { icon: 'refresh' },
};
export const MODE_ORDER = ['cut', 'bulk', 'maintain', 'recomp'];

/** «минус 0,5–1 % веса в неделю» / «плюс 0,25–0,5 % веса в неделю» / «вес в пределах ±0,25 % в неделю». */
export function modeAbout(mode) {
  const [a, b] = MODES[mode].rate;
  if (mode === 'recomp') return 'вес на месте, меняется состав тела';
  if (b <= 0) return `минус ${num(-b, 2)}–${num(-a, 2)} % веса в неделю`;
  if (a >= 0) return `плюс ${num(a, 2)}–${num(b, 2)} % веса в неделю`;
  return `вес в пределах ±${num(b, 2)} % в неделю`;
}

/** Тот же ориентир в килограммах для конкретного веса тела: «минус 0,4–0,8 кг в неделю». null — если вес неизвестен. */
export function modeRateKg(mode, bw) {
  if (!(bw > 0)) return null;
  const [a, b] = MODES[mode].rate.map((p) => (bw * p) / 100);
  if (b <= 0) return `минус ${num(-b)}–${num(-a)} кг в неделю`;
  if (a >= 0) return `плюс ${num(a)}–${num(b)} кг в неделю`;
  return `не больше ±${num(b)} кг в неделю`;
}

// ───────── Числа и даты ─────────

const MINUS = '−';
const NBSP = String.fromCharCode(160); // неразрывный пробел
const WJ = String.fromCharCode(0x2060); // «соединитель слов»: невидимый, запрещает перенос строки в этом месте
const p2 = (n) => String(n).padStart(2, '0');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Число со знаком и настоящим минусом: «+0,3», «−0,58», «0». */
export function signed(x, digits = 1) {
  if (x == null || Number.isNaN(x)) return '—';
  const k = 10 ** digits, r = Math.round(x * k) / k;
  return `${r > 0 ? '+' : r < 0 ? MINUS : ''}${String(Math.abs(r)).replace('.', ',')}`;
}
/** Калории целым числом. */
export const kcalText = (x) => (x == null ? '—' : String(Math.round(x)));
/**
 * Число с фиксированным количеством знаков после запятой («80,0») — для колонок таблиц. Округляет так же, как num()
 * (78,55 → «78,6»; toFixed сам по себе дал бы «78,5»: 78,55 хранится как 78,5499…), чтобы одно и то же значение
 * не выглядело на одном экране двумя разными числами.
 */
export const fixed = (x, digits = 1) => (x == null ? '—' : (Math.round(x * 10 ** digits) / 10 ** digits).toFixed(digits).replace('.', ','));
/**
 * Неразрывные пробелы для текста, который переносится по строкам: между числом и единицей («±10 %», «2,3 кг»,
 * «6 ч 37 мин») и перед тире — строка не рвётся посередине значения и не начинается с тире. Невидимый запрет
 * переноса — после косой черты в «кг/нед» и внутри диапазона чисел («0,5–1 %», «1935–2365», «−0,5…−1 %»).
 */
export const nb = (text) => String(text).replace(/(\d) (?=(?:%|кг|ккал|г|ч|мин|нед|дн)(?![а-яё]))/g, `$1${NBSP}`)
  .replace(/ (?=[—–] )/g, NBSP)
  .replace(/\/(?=[а-яё])/g, `/${WJ}`)
  .replace(/(\d)([–…])(?=[\d−+])/g, `$1$2${WJ}`);
/** Склеить фразу неразрывными пробелами: при нехватке ширины она переносится целиком («Б 165 · Ж 65 · У 225»). */
export const glue = (text) => String(text).replace(/ /g, NBSP);
/**
 * Части через точку: «2 тренировки · 1 день дневника». Точка приклеена к следующей части, поэтому при переносе
 * строка не кончается висящей точкой, а начинается с «· …». Сами части лучше склеить заранее (glue).
 */
export const joinParts = (parts) => parts.filter(Boolean).join(` ·${NBSP}`);
/** Килограммы: взвешивание — как введено (до сотых), среднее — до десятых. */
export const kg = (x, digits = 2) => num(x, digits);
/** Минуты → «7 ч 05» (для таблиц и подписей, где «7 ч 05 мин» не помещается); не «7:05» — так пишется время на часах. */
export const hmShort = (min) => (min == null ? '—' : glue(`${Math.floor(Math.round(min) / 60)} ч ${p2(Math.round(min) % 60)}`));
/** Минуты → «7 ч 05 мин», ровные часы → «7 ч». */
export function hmLong(min) {
  if (min == null) return '—';
  const t = Math.round(min), h = Math.floor(t / 60), m = t % 60;
  return h ? (m ? `${h} ч ${p2(m)} мин` : `${h} ч`) : `${m} мин`;
}

/** 'YYYY-MM-DD' → Date в полдень местного времени (для dayShort / dayLong из dom.js). */
export const dateAt = (date) => new Date(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), 12);
const DOW = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
/** День недели двумя буквами: «чт». */
export const dow = (date) => DOW[dateAt(date).getDay()];
/** «чт, 26 ноя». */
export const dayLabel = (date) => `${dow(date)}, ${dayShort(dateAt(date))}`;
/** Заголовок дня относительно сегодняшней даты дневника: «Сегодня», «Вчера», «Чт, 26 ноя». */
export function dayTitle(date, today) {
  const d = dayDiff(date, today);
  return d === 0 ? 'Сегодня' : d === 1 ? 'Вчера' : cap(dayLabel(date));
}
/** То же в строчку: «сегодня», «вчера», «26 ноя». */
export function dayRel(date, today) {
  const d = dayDiff(date, today);
  return d === 0 ? 'сегодня' : d === 1 ? 'вчера' : dayShort(dateAt(date));
}
/** Понедельник недели, в которую попадает дата. */
export const weekStartDate = (date) => addDays(date, -((dateAt(date).getDay() + 6) % 7));
/** «17–23 ноя» / «28 окт – 3 ноя». */
export function spanLabel(from, to) {
  const a = dateAt(from), b = dateAt(to);
  return a.getMonth() === b.getMonth() ? `${a.getDate()}–${dayShort(b)}` : `${dayShort(a)} – ${dayShort(b)}`;
}

// ───────── Дни ─────────

/**
 * Метка дня для полоски недели и списка: 'none' — не заполнен, 'ok' — калории в коридоре ±10 %,
 * 'over' / 'under' — выше / ниже коридора, 'log' — заполнен, но сравнить не с чем (нет калорий или нормы).
 */
export function dayMark(day, entry) {
  if (!isLogged(day)) return 'none';
  const k = dayCheck(day, entry).kcal;
  if (k.ok === true) return 'ok';
  if (k.ok === false) return k.pct > 0 ? 'over' : 'under';
  return 'log';
}
export const MARK_TEXT = { none: 'не заполнен', ok: 'калории в коридоре', over: 'калории выше коридора', under: 'калории ниже коридора', log: 'заполнен' };

/**
 * Какая сторона коридора калорий — промах для режима: на сушке перебор, на наборе недобор, на поддержании,
 * рекомпозиции и без режима — обе. Промах другой стороны показывается спокойным цветом, а не предупреждением.
 * @param {string|null|undefined} mode
 * @returns {{ over: boolean, under: boolean }}
 */
export const warnSide = (mode) => ({ over: mode !== 'bulk', under: mode !== 'cut' });
/** Тон метки дня (dayMark) для режима: 'warn' — промах в опасную для режима сторону, иначе ''. */
export const markTone = (mark, mode) => ((mark === 'over' && warnSide(mode).over) || (mark === 'under' && warnSide(mode).under) ? 'warn' : '');

/**
 * Последний закрытый день: сегодняшний, если в нём уже что-то записано, иначе вчерашний. На нём заканчивается
 * «текущая неделя» в плитках и на пути к цели — так же считает diary.assess, поэтому цифры в плитках совпадают
 * с цифрами в выводах и не меняются от того, что сегодняшний день ещё пуст.
 */
export const lastClosedDay = (days, today) => (isLogged(days[today]) ? today : addDays(today, -1));

const isWeekend = (date) => { const k = dateAt(date).getDay(); return k === 0 || k === 6; };

/**
 * Обычное время подъёма для такого дня (будни или выходные): медиана последних подъёмов за 4 недели до даты,
 * округлённая до 5 минут. Берутся такие же дни (если их набралось три), иначе любые. null — данных мало.
 * @param {Record<string, object>} days дневник
 * @param {string} date для какого дня подсказка
 * @returns {string|null} 'HH:MM'
 */
export function usualWake(days, date) {
  const want = isWeekend(date);
  const same = [], all = [];
  for (let i = 1; i <= 28; i++) {
    const d = addDays(date, -i);
    const m = toMin(days[d]?.wake);
    if (m == null) continue;
    if (all.length < 7) all.push(m);
    if (isWeekend(d) === want && same.length < 7) same.push(m);
  }
  const pick = same.length >= 3 ? same : all.length >= 3 ? all : null;
  if (!pick) return null;
  const s = [...pick].sort((a, b) => a - b);
  const mid = s.length >> 1;
  const med = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return fromMin(Math.round(med / 5) * 5);
}

/** Сколько минут сна выйдет, если лечь в bed ('HH:MM' даты дневника) и встать в wake на следующее утро. null — не посчитать. */
export function plannedSleep(bed, wake) {
  const b = bedOffset(bed), w = toMin(wake);
  if (b == null || w == null) return null;
  const dur = w + 1440 - b;
  return dur >= 60 && dur <= 960 ? dur : null;
}

// ───────── Форма дня ─────────

export const DAY_KEYS = ['kcal', 'p', 'f', 'c', 'w', 'wake', 'bed', 'note'];
export const NUM_KEYS = ['kcal', 'p', 'f', 'c', 'w'];
/** Сколько знаков после запятой допускает поле (как хранит diary.normalizeDay). */
export const DECIMALS = { kcal: 0, p: 1, f: 1, c: 1, w: 2, targetW: 1 };

/** День из хранилища → строки для полей формы (десятичная запятая, пустая строка = не введено). */
export function dayToForm(day) {
  const s = (x, digits) => (x == null ? '' : num(x, digits));
  return {
    kcal: s(day?.kcal, 0), p: s(day?.p, 1), f: s(day?.f, 1), c: s(day?.c, 1), w: s(day?.w, 2),
    wake: day?.wake || '', bed: day?.bed || '', note: day?.note || '',
  };
}

/** Привести то, что набрано в числовом поле: только цифры и одна запятая, не больше digits знаков после неё. */
export function cleanNumber(text, digits) {
  let s = String(text ?? '').replace(/\./g, ',').replace(/[^\d,]/g, '');
  const i = s.indexOf(',');
  if (i >= 0) s = digits ? `${s.slice(0, i)},${s.slice(i + 1).replace(/,/g, '').slice(0, digits)}` : s.slice(0, i);
  return s;
}

/** Числовые поля, в которых что-то введено, но значение не годится (не число или вне допустимого диапазона). */
export function invalidFields(form) {
  const n = normalizeDay(form);
  return NUM_KEYS.filter((k) => String(form[k] ?? '').trim() !== '' && n[k] == null);
}

/**
 * Отличается ли форма от сохранённого дня по смыслу («78,40» и «78,4» — одно и то же). Поля из skip (подсказки,
 * которые пользователь не трогал) не сравниваются. Непроходящее проверку значение тоже считается отличием.
 */
export function formDiffers(form, base, skip = null) {
  const a = normalizeDay(form), b = normalizeDay(base);
  if (DAY_KEYS.some((k) => !skip?.has(k) && a[k] !== b[k])) return true;
  return invalidFields(form).some((k) => !skip?.has(k));
}

/** Подсказка об ошибке ввода: что не так с числом в поле (диапазоны — из diary.LIMITS). */
export const RANGE_TEXT = {
  kcal: `Проверь число: не больше ${LIMITS.kcal[1]} ккал`,
  p: `не больше ${LIMITS.macro[1]} г`, f: `не больше ${LIMITS.macro[1]} г`, c: `не больше ${LIMITS.macro[1]} г`,
  w: `Проверь: от ${LIMITS.w[0]} до ${LIMITS.w[1]} кг`, targetW: `Проверь: от ${LIMITS.w[0]} до ${LIMITS.w[1]} кг`,
};

/**
 * Закончен ли день для подписей «сколько осталось»: прошедший день или сегодняшний, у которого уже записан отбой.
 * Для такого дня «осталось 70» звучит странно — там пишется, на сколько вышло меньше нормы.
 */
export const dayClosed = (date, today, day) => date < today || !!day?.bed;

/**
 * Подпись под калориями: сколько осталось до нормы (или, для законченного дня, на сколько меньше) и попал ли день
 * в коридор. Промах окрашивается предупреждением, только если он в опасную для режима сторону (warnSide).
 * Части подписи не рвутся при переносе строки: «осталось 700» · «ниже коридора».
 * @param {{ v: number|null, target: number|null, ok: boolean|null }} check dayCheck(…).kcal
 * @param {string} [unit] единица после числа (' ккал'), когда рядом нет поля с подписью
 * @param {{ mode?: string|null, closed?: boolean }} [o] mode — режим дня; closed — день закончен (dayClosed)
 * @returns {{ text: string, cls: ''|'good'|'warn' }}
 */
export function kcalHint(check, unit = '', { mode = null, closed = false } = {}) {
  const { v, target, ok } = check;
  if (target == null) return { text: '', cls: '' };
  const lo = Math.round(target * (1 - RULES.kcalTolerance)), hi = Math.round(target * (1 + RULES.kcalTolerance));
  if (v == null) return { text: `коридор ±10 %: ${lo}–${hi}${unit}`, cls: '' };
  const diff = Math.round(target - v);
  const head = glue(diff > 0 ? (closed ? `на ${diff}${unit} меньше нормы` : `осталось ${diff}${unit}`) : diff < 0 ? `сверх нормы ${-diff}${unit}` : 'ровно в норму');
  if (ok) return { text: joinParts([head, glue('в коридоре')]), cls: 'good' };
  const side = warnSide(mode);
  return diff > 0 ? { text: joinParts([head, glue('ниже коридора')]), cls: side.under ? 'warn' : '' }
    : { text: joinParts([head, glue('выше коридора')]), cls: side.over ? 'warn' : '' };
}

/**
 * Подпись под белками / жирами / углеводами: «из 165 · ещё 6», «из 165 · +8»; для законченного дня — «из 165 · −6».
 * @param {{ v: number|null, target: number|null, ok: boolean|null }} check
 * @param {{ closed?: boolean }} [o]
 */
export function macroHint(check, { closed = false } = {}) {
  const { v, target, ok } = check;
  if (target == null) return { text: '', cls: '' };
  if (v == null) return { text: glue(`из ${num(target)}`), cls: '' };
  const diff = Math.round((target - v) * 10) / 10;
  const tail = diff > 0 ? (closed ? `${MINUS}${num(diff)}` : glue(`ещё ${num(diff)}`)) : diff < 0 ? `+${num(-diff)}` : 'ровно';
  return { text: joinParts([glue(`из ${num(target)}`), tail]), cls: ok ? 'good' : '' };
}

/** Насколько калории из БЖУ расходятся с введёнными: доля (0,18 = на 18 %) со знаком; null — сравнить нечего. */
export function macroGap(macroKcal, kcal) {
  return macroKcal != null && kcal > 0 ? macroKcal / kcal - 1 : null;
}
/** Порог «мягкой» подсказки о расхождении калорий и БЖУ. */
export const MACRO_GAP = 0.15;

// ───────── Форма режима ─────────

export const GOAL_KEYS = ['mode', 'kcal', 'p', 'f', 'c', 'targetW', 'note'];
export const GOAL_NUM_KEYS = ['kcal', 'p', 'f', 'c', 'targetW'];

/** Запись режима → строки для полей формы. */
export function entryToForm(e) {
  const s = (x, digits) => (x == null ? '' : num(x, digits));
  return { mode: e?.mode || '', kcal: s(e?.kcal, 0), p: s(e?.p, 1), f: s(e?.f, 1), c: s(e?.c, 1), targetW: s(e?.targetW, 1), note: e?.note || '' };
}
const asEntry = (form) => normalizeEntry({ ...form, from: '2000-01-01' });
/** Числовые поля режима с негодным значением. */
export function invalidGoalFields(form) {
  const n = asEntry({ ...form, mode: 'cut' });
  return GOAL_NUM_KEYS.filter((k) => String(form[k] ?? '').trim() !== '' && n[k] == null);
}
/** Отличается ли форма режима от сохранённых норм. */
export function goalDiffers(form, base) {
  const a = asEntry({ ...form, mode: form.mode || 'cut' }), b = asEntry({ ...base, mode: base.mode || 'cut' });
  if ((form.mode || '') !== (base.mode || '')) return true;
  if (GOAL_KEYS.some((k) => k !== 'mode' && a[k] !== b[k])) return true;
  return invalidGoalFields(form).length > 0;
}

// ───────── Черновики ─────────
// Один ключ на устройстве, в облако и в экспорт не попадает: { '<дата>' | 'goal': { v: поля формы, sug: [поля-подсказки], t: мс } }.
// Префикс gym: — чтобы общий сброс данных (storage.resetAll) стирал и черновики.

const DRAFT_KEY = 'gym:draft';
const MAX_DAY_DRAFTS = 6;
const DRAFT_TTL = 21 * 86400000;
const isDay = (id) => /^\d{4}-\d{2}-\d{2}$/.test(id);

function readDrafts() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  } catch { return {}; }
}
function writeDrafts(d) {
  try {
    if (Object.keys(d).length) localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); else localStorage.removeItem(DRAFT_KEY);
  } catch { /* приватный режим: черновик проживёт только до закрытия экрана */ }
}

/** Черновик формы: { v, sug, t } или null. id — дата дня или 'goal'. */
export function getDraft(id) {
  const d = readDrafts()[id];
  return d && d.v && typeof d.v === 'object' && Date.now() - (d.t || 0) < DRAFT_TTL ? { v: d.v, sug: Array.isArray(d.sug) ? d.sug : [], t: d.t || 0 } : null;
}
/** Запомнить черновик (вызывается при каждом вводе). Хранятся шесть самых свежих дней и форма режима. */
export function putDraft(id, v, sug = []) {
  const all = readDrafts();
  all[id] = { v, sug: [...sug], t: Date.now() };
  const dates = Object.keys(all).filter(isDay).sort((a, b) => (all[b].t || 0) - (all[a].t || 0));
  for (const old of dates.slice(MAX_DAY_DRAFTS)) delete all[old];
  writeDrafts(all);
}
export function dropDraft(id) {
  const all = readDrafts();
  if (!(id in all)) return;
  delete all[id];
  writeDrafts(all);
}
/** Даты дней, по которым лежит несохранённый черновик, от старых к новым. */
export function draftDays() {
  const all = readDrafts(), now = Date.now();
  return Object.keys(all).filter((id) => isDay(id) && all[id]?.v && now - (all[id].t || 0) < DRAFT_TTL).sort();
}
