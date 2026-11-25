// Мини-шаблонизатор и форматирование. Все интерполяции в html`` экранируются, raw() — для доверенной разметки.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s ?? ''));

function val(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(val).join('');
  if (v == null || v === false || v === true) return '';
  return esc(v);
}

/** Тегированный шаблон: html`<b>${name}</b>` → Raw. */
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += val(vals[i]) + strings[i + 1];
  return new Raw(out);
}

/** Делегирование событий: on(root, 'click', '[data-act]', (e, el) => …). */
export function on(root, type, selector, fn, opts) {
  const handler = (e) => {
    const el = e.target.closest(selector);
    if (el && root.contains(el)) fn(e, el);
  };
  root.addEventListener(type, handler, opts);
  return () => root.removeEventListener(type, handler, opts);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ───────── Форматирование (русская локаль) ─────────

/** 22.5 → «22,5», 24 → «24». */
export function num(x, digits = 1) {
  if (x == null || Number.isNaN(x)) return '—';
  const r = Math.round(x * 10 ** digits) / 10 ** digits;
  return String(r).replace('.', ',');
}

/** Склонение: plural(5, ['тренировка', 'тренировки', 'тренировок']). */
export function plural(n, forms) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

/** Секунды → «1:05:23» / «02:30». */
export function clock(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const p = (x) => String(x).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

/** Секунды отдыха → «2:30» / «45 с». */
export function restLabel(sec) {
  if (sec < 60) return `${sec} с`;
  const m = Math.floor(sec / 60), s = sec % 60;
  return s ? `${m}:${String(s).padStart(2, '0')}` : `${m} мин`;
}

/** Минуты → «1 ч 05 мин» / «58 мин». */
export function minutes(min) {
  if (min == null) return '—';
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} ч ${String(m).padStart(2, '0')} мин` : `${m} мин`;
}

/** Тоннаж: «860 кг» / «12,4 т». */
export function tonnage(kg) {
  if (!kg) return '0 кг';
  return kg >= 10000 ? `${num(kg / 1000)} т` : `${Math.round(kg).toLocaleString('ru-RU')} кг`;
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_FULL = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WEEKDAYS_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

export const dayShort = (t) => { const d = new Date(t); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
export const dayLong = (t) => { const d = new Date(t); return `${WEEKDAYS_FULL[d.getDay()]}, ${d.getDate()} ${MONTHS_FULL[d.getMonth()]}`; };
export const hhmm = (t) => { const d = new Date(t); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
export const monthShort = (m) => MONTHS[m];

/** Дробные часы → «18:40». */
export const hourLabel = (h) => (h == null ? '—' : `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`);

/** Локальная дата YYYY-MM-DD. */
export function isoDay(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
