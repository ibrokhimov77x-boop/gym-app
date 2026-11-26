// Хранилище приложения. Контракт ключей: docs/DATA_CONTRACT.md, режим и дневник — docs/DIARY_CONTRACT.md
// Основное — localStorage (мгновенно, офлайн). Зеркало — Telegram CloudStorage (подключается из telegram.js через setMirror).
// Каждая запись получает поле upd (ISO) при сохранении; при слиянии побеждает запись с более поздним upd.
import { addDays, diaryDate, goalAt, isDate, isEmptyDay, latestWeight, normalizeDay, normalizeEntry } from './diary.js';

const NS = 'gym:';
/** Отметка «сброс данных ещё не стёр копию в облаке» — вне пространства gym:, чтобы пережить сам сброс. */
const WIPE_KEY = 'gym-wipe';
/** Сколько последних дней дневника повторяется в каждой посылке боту (см. pendingSync). */
const REPEAT_DAYS = 14;
/** Бот не принимает дни позже своего «сегодня» + 2 (сбитые часы телефона) — дальше и повтор не заглядывает. */
const FUTURE_DAYS = 2;
/** Сколько секунд хранится отметка «эта версия отправлена» (state.s): дольше чужая очередь устаревшей не бывает. */
const SENT_KEEP = 30 * 86400;
/** Удалённые дни, которые «Отправить всё заново» отправляет ещё раз (за последний год). */
const REQUEUE_TOMBS = 366;

// Демо-режима больше нет. Стираем то, что от него могло остаться на устройстве: пространство `gymdemo:`
// и флаг `gym:mode`. Настоящие данные (`gym:*`) и облако Telegram не трогаем — демо туда никогда не писало.
(function purgeDemoLeftovers() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('gymdemo:') || k === 'gym:mode') localStorage.removeItem(k);
  } catch { /* приватный режим */ }
})();

const DEFAULT_PROFILE = { v: 1, bodyweight: null, heightCm: null, startDate: null, wristCare: true, calibrationDone: false, restDefault: 90, autoRest: true };
/**
 * state: nextIdx, plan, planIdx и activeWorkoutId — «скаляры» (при слиянии побеждают целиком по upd); q и s — очереди отправки боту
 * (сливаются по каждой вещи, см. «Очереди отправки»); unsynced, unsyncedDays, goalDirty — то же самое списками
 * (вычисляются из q и s; их читают экраны, тесты и прежние версии приложения).
 */
const DEFAULT_STATE = { v: 1, nextIdx: 0, activeWorkoutId: null, unsynced: [], unsyncedDays: [], goalDirty: false };
/** prefs: equip — { equipmentKey: true|false } (нет ключа = не отмечено); swaps — { exId: altExId } постоянные замены. */
const DEFAULT_PREFS = { v: 1, equip: {}, swaps: {} };

const now = () => new Date().toISOString();

function lsGet(key) {
  try { const s = localStorage.getItem(NS + key); return s ? JSON.parse(s) : null; } catch { return null; }
}
function lsSet(key, value) {
  try { localStorage.setItem(NS + key, JSON.stringify(value)); return true; } catch (e) { console.warn('localStorage write failed', key, e); return false; }
}

let profile, state, prefs;
/** id → Workout (включая «надгробия» { id, deleted: true, upd } — чтобы удаление не воскресало из облака). */
const wmap = new Map();
/**
 * Режим как он хранится: { v:1, entries: [GoalEntry & { upd } | { from, del: true, upd }], upd } или null. У каждой записи
 * своя метка upd, удалённая запись остаётся «надгробием» — так режим сливается по записям (см. mergeGoalWith).
 */
let goalRec = null;
/** То же без надгробий и меток — то, что видят экраны и diary.js (getGoal). */
let goal = null;
/** Дневник по месяцам: 'YYYYMM' → { v:1, days: { 'DD': DiaryDay | { del: true, upd } }, upd } (ключ dm_YYYYMM). */
const months = new Map();
/** Кэш allDiaryDays(); сбрасывается при любом изменении дневника. */
let dayCache = null;
let mirror = null;
/** Счётчик сбросов (resetAll): чтение облака, начатое до сброса, не сливается в стёртое хранилище. */
let resetGen = 0;
/** Идущий сброс: Promise<boolean> — стёрто ли облако. */
let resetting = null;

/** Записать ключ локально и в облачное зеркало. */
function persist(key, value) {
  lsSet(key, value);
  if (mirror) mirror.put(key, value);
}

function saveIndex() { lsSet('wl', [...wmap.keys()]); }

export function initStore() {
  profile = { ...DEFAULT_PROFILE, ...(lsGet('profile') || {}) };
  prefs = { ...DEFAULT_PREFS, ...(lsGet('prefs') || {}) };
  prefs.equip ||= {}; prefs.swaps ||= {};
  wmap.clear();
  for (const id of lsGet('wl') || []) {
    const w = lsGet('w_' + id);
    if (w && w.id) wmap.set(w.id, w);
  }
  setGoal(cleanGoal(lsGet('goal')));
  months.clear();
  dayCache = null;
  try {
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith(NS + 'dm_')) continue;
      const ym = k.slice(NS.length + 3);
      const m = lsGet('dm_' + ym);
      if (/^\d{6}$/.test(ym) && m && m.days && typeof m.days === 'object') months.set(ym, m);
    }
    localStorage.removeItem(NS + 'own'); // список «своей» очереди прежней версии: очереди теперь сливаются по каждой вещи
  } catch { /* приватный режим */ }
  // state — после записей: очереди прежней версии (списки) получают версии самих записей
  const raw = lsGet('state') || {};
  state = withQueues({ ...DEFAULT_STATE, ...raw }, raw.q ? readMarks(raw) : legacyMarks(raw));
  // Активная тренировка могла быть удалена на другом устройстве.
  if (state.activeWorkoutId && !getWorkout(state.activeWorkoutId)) state.activeWorkoutId = null;
}

export const getProfile = () => profile;
export const getState = () => state;
export const getPrefs = () => prefs;

export function updateProfile(patch) { profile = { ...profile, ...patch, upd: now() }; persist('profile', profile); }
/** Изменить «скаляры» state (nextIdx + plan/planIdx через nextIdxPatch, activeWorkoutId). Очереди отправки меняют только функции ниже. */
export function updateState(patch) {
  const { q, s, unsynced, unsyncedDays, goalDirty, ...rest } = patch; // eslint-disable-line no-unused-vars
  state = { ...state, ...rest, upd: now() };
  persist('state', state);
}
export function updatePrefs(patch) { prefs = { ...prefs, ...patch, upd: now() }; persist('prefs', prefs); }

const alive = (w) => w && !w.deleted;
const byStart = (a, b) => new Date(a.start) - new Date(b.start);

/** Все тренировки (с активной), по времени. */
export const allWorkouts = () => [...wmap.values()].filter(alive).sort(byStart);
/** Только завершённые — для аналитики и истории. */
export const finishedWorkouts = () => allWorkouts().filter((w) => w.end);
export const getWorkout = (id) => (alive(wmap.get(id)) ? wmap.get(id) : null);
export const activeWorkout = () => (state.activeWorkoutId ? getWorkout(state.activeWorkoutId) : null);

/** Сохранить тренировку целиком (вызывается после каждого изменения — переживает закрытие приложения). */
export function saveWorkout(w) {
  w.upd = now();
  const isNew = !wmap.has(w.id);
  wmap.set(w.id, w);
  persist('w_' + w.id, w);
  if (isNew) saveIndex();
}

export function deleteWorkout(id) {
  const tomb = { id, deleted: true, upd: now() };
  wmap.set(id, tomb);
  persist('w_' + id, tomb);
  saveIndex();
  // Удалённую тренировку не отправляем: её место в очереди (и в чужих копиях очереди, где версия не новее надгробия)
  // закрывается отметкой «отправлено»
  const m = marks();
  m.s.w[id] = [Math.max(m.q.w[id] || 0, verOfUpd(tomb.upd), sentVer(m, 'w', id)), nowSec()];
  delete m.q.w[id];
  state = withQueues({ ...state, ...(state.activeWorkoutId === id ? { activeWorkoutId: null, upd: now() } : {}) }, m);
  persist('state', state);
}

/** Id по контракту: YYYYMMDD-HHMM локального времени (с суффиксом при совпадении). */
export function newWorkoutId(date = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  const base = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
  let id = base, k = 2;
  while (wmap.has(id)) id = `${base}-${k++}`;
  return id;
}

export function markUnsynced(id) { enqueue([['w', id]]); }
export function markSynced(ids) { markSent({ ids }); }

// ───────── Метки времени ─────────

const byFrom = (a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0);
/**
 * upd для новой версии записи: сейчас, но обязательно позже прежней версии. Часы устройств могут расходиться,
 * и правка не должна проиграть облачной копии только потому, что та помечена «из будущего».
 */
function stampAfter(prevUpd) {
  const t = Date.now(), p = Date.parse(prevUpd || '');
  return new Date(Number.isFinite(p) && p >= t ? p + 1 : t).toISOString();
}
/**
 * upd из файла или из облака → ISO-строка в UTC; null, если это не дата. Метки сравниваются как моменты времени,
 * а не как строки: «26.11.2026 21:30» из переписанного руками файла иначе побеждала бы любую настоящую дату.
 */
function isoUpd(s) {
  const t = typeof s === 'string' ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
/** Момент последнего изменения записи, мс; −∞, если метки нет или она не разбирается (такая запись проигрывает любой). */
function stampOf(x) {
  const t = Date.parse(x?.upd);
  return Number.isFinite(t) ? t : -Infinity;
}
const newer = (a, b) => stampOf(a) > stampOf(b);
/** Версия записи для очереди и для бота — её upd в миллисекундах (0 — метки нет). */
const verOfUpd = (upd) => { const t = Date.parse(upd || ''); return Number.isFinite(t) && t > 0 ? t : 0; };
const nowSec = () => Math.floor(Date.now() / 1000);
const monthOf = (date) => date.slice(0, 4) + date.slice(5, 7);
const dayOf = (date) => date.slice(8, 10);
/** Запись дня как она хранится: DiaryDay, надгробие { del: true, upd } или null. */
const rawDay = (date) => months.get(monthOf(date))?.days[dayOf(date)] || null;

// ───────── Очереди отправки боту ─────────
//
// Что ещё не отправлено боту, хранится в state двумя картами (docs/DIARY_CONTRACT.md → «Очереди отправки»):
//   q = { d: { дата: версия }, w: { id: версия }, g: версия } — какая версия вещи ждёт отправки;
//   s = { d: { дата: [версия, с] }, w: { id: [версия, с] }, g: версия } — какая версия уже отправлена (и когда).
// Вещь в очереди, пока её версия в q больше отправленной. Версия — upd самой записи в миллисекундах, поэтому решение
// «уже отправлено» следует тому же порядку, что и слияние самих записей. Обе карты сливаются по каждой вещи — берётся
// большее, — поэтому state из давно открытого приложения не стирает чужую очередь, а отправленное с другого устройства
// не возвращается в очередь из устаревшей копии. Отметки «отправлено» живут 30 дней.

const noMarks = () => ({ q: { d: {}, w: {}, g: 0 }, s: { d: {}, w: {}, g: 0 } });
const posInt = (v) => Number.isSafeInteger(v) && v > 0;
const keyOk = (k, key) => (k === 'd' ? isDate(key) : typeof key === 'string' && key.length > 0 && key.length <= 64);
const sentVer = (m, k, key) => (k === 'g' ? m.s.g : m.s[k][key]?.[0] || 0);

/** Очереди из state (облако, localStorage): только годные записи. */
function readMarks(st) {
  const out = noMarks();
  for (const k of ['d', 'w']) {
    const q = st?.q?.[k], s = st?.s?.[k];
    if (q && typeof q === 'object') for (const [key, v] of Object.entries(q)) if (posInt(v) && keyOk(k, key)) out.q[k][key] = v;
    if (s && typeof s === 'object') {
      for (const [key, v] of Object.entries(s)) if (Array.isArray(v) && posInt(v[0]) && posInt(v[1]) && keyOk(k, key)) out.s[k][key] = [v[0], v[1]];
    }
  }
  if (posInt(st?.q?.g)) out.q.g = st.q.g;
  if (posInt(st?.s?.g)) out.s.g = st.s.g;
  return out;
}

/** Версия записи, которая сейчас лежит на устройстве (0 — её здесь нет). */
function verOf(k, key) {
  if (k === 'd') return verOfUpd(rawDay(key)?.upd);
  if (k === 'w') return verOfUpd(wmap.get(key)?.upd);
  return verOfUpd(goalRec?.upd);
}

/** Очереди state прежней версии (списки без версий): каждой вещи — версия её записи на устройстве. */
function legacyMarks(st) {
  const m = noMarks();
  for (const id of Array.isArray(st?.unsynced) ? st.unsynced : []) if (keyOk('w', id)) m.q.w[id] = verOf('w', id) || 1;
  for (const d of Array.isArray(st?.unsyncedDays) ? st.unsyncedDays : []) if (isDate(d)) m.q.d[d] = verOf('d', d) || 1;
  if (st?.goalDirty) m.q.g = verOf('g') || 1;
  return m;
}

/** Убрать из q то, что уже отправлено, и старые отметки «отправлено». Меняет m. */
function tidy(m) {
  for (const k of ['d', 'w']) {
    for (const key of Object.keys(m.q[k])) if (m.q[k][key] <= sentVer(m, k, key)) delete m.q[k][key];
    const old = nowSec() - SENT_KEEP;
    for (const key of Object.keys(m.s[k])) if (m.s[k][key][1] < old && !m.q[k][key]) delete m.s[k][key];
  }
  if (m.q.g <= m.s.g) m.q.g = 0;
  return m;
}

/** state с очередями m (приводит их в порядок и пересчитывает списки unsynced / unsyncedDays / goalDirty). */
function withQueues(st, m) {
  tidy(m);
  return { ...st, q: m.q, s: m.s, unsynced: Object.keys(m.q.w).sort(), unsyncedDays: Object.keys(m.q.d).sort(), goalDirty: m.q.g > 0 };
}

/** Копия очередей текущего state — менять её, потом saveQueues. */
const marks = () => ({ q: { d: { ...state.q.d }, w: { ...state.q.w }, g: state.q.g }, s: { d: { ...state.s.d }, w: { ...state.s.w }, g: state.s.g } });
function saveQueues(m) {
  state = withQueues(state, m); // upd не меняется: это время изменения скаляров, очереди сливаются по своим версиям
  persist('state', state);
}

/**
 * Поставить вещи в очередь: items = [['d', дата] | ['w', id] | ['g']]. Версия — версия записи на устройстве, но
 * больше уже отправленной: «отправить ещё раз» не отличается от правки.
 */
function enqueue(items) {
  const m = marks();
  let dirty = false;
  for (const [k, key] of items) {
    const sent = sentVer(m, k, key);
    const was = k === 'g' ? m.q.g : m.q[k][key] || 0;
    const v = Math.max(verOf(k, key) || Date.now(), sent + 1, was);
    if (v === was) continue;
    if (k === 'g') m.q.g = v; else m.q[k][key] = v;
    dirty = true;
  }
  if (dirty) saveQueues(m);
}

/** Слить очереди a и b: по каждой вещи большее. */
function unionMarks(a, b) {
  const m = noMarks();
  for (const k of ['d', 'w']) {
    for (const src of [a, b]) {
      for (const [key, v] of Object.entries(src.q[k])) if (v > (m.q[k][key] || 0)) m.q[k][key] = v;
      for (const [key, v] of Object.entries(src.s[k])) {
        const cur = m.s[k][key];
        if (!cur || v[0] > cur[0] || (v[0] === cur[0] && v[1] > cur[1])) m.s[k][key] = v;
      }
    }
  }
  m.q.g = Math.max(a.q.g, b.q.g);
  m.s.g = Math.max(a.s.g, b.s.g);
  return m;
}

/** Одинаковые ли очереди (ключи в любом порядке). */
function sameMarks(a, b) {
  const flat = (m) => JSON.stringify([m.q.g, m.s.g, ...['d', 'w'].flatMap((k) => [Object.entries(m.q[k]).sort(), Object.entries(m.s[k]).sort()])]);
  return flat(a) === flat(b);
}

/** Стоит ли эта вещь в очереди. */
const queued = (k, key) => (k === 'g' ? state.q.g > state.s.g : (state.q[k][key] || 0) > sentVer(state, k, key));
/** Ждёт ли день отправки боту (сохранён или удалён после последней отправки). */
export const isDayQueued = (date) => queued('d', date);

/**
 * Слить свой state с другой его версией (облако). Скаляры — целиком по upd, очереди — по каждой вещи.
 * @returns {{ changed: boolean, push: boolean }} changed — свой state изменился; push — у другой стороны нет того, что есть здесь
 */
function mergeStateWith(r) {
  if (!r || typeof r !== 'object') return { changed: false, push: !!state.upd || !sameMarks(state, noMarks()) };
  const theirs = r.q ? readMarks(r) : legacyMarks(r);
  const m = tidy(unionMarks(state, theirs));
  let base = state, scalars = false;
  if (newer(r, state)) {
    const { q, s, unsynced, unsyncedDays, goalDirty, ...rest } = r; // eslint-disable-line no-unused-vars
    base = { ...DEFAULT_STATE, ...rest, upd: isoUpd(r.upd) };
    scalars = ['nextIdx', 'plan', 'planIdx', 'activeWorkoutId'].some((k) => base[k] !== state[k]); // plan/planIdx — маркер нового круга (program.js nextIdxPatch)
  }
  const changed = scalars || !sameMarks(m, state);
  const push = newer(state, r) || !sameMarks(m, theirs);
  if (changed || base !== state) {
    state = withQueues(base, m);
    lsSet('state', state);
  }
  return { changed, push };
}

// ───────── Режим и дневник (docs/DIARY_CONTRACT.md) ─────────

/**
 * Проверить режим из хранилища / облака / файла: годные записи и надгробия, по одной на дату, по возрастанию даты.
 * Записи прежней версии (без своей метки) получают метку всего режима.
 */
function cleanGoal(g) {
  if (!g || !Array.isArray(g.entries)) return null;
  const all = isoUpd(g.upd);
  const byDate = new Map();
  for (const raw of g.entries) {
    const upd = isoUpd(raw?.upd) ?? all;
    let rec = null;
    if (raw && raw.del === true && isDate(raw.from)) rec = { from: raw.from, del: true, upd };
    else { const e = normalizeEntry(raw); if (e) rec = { ...e, upd }; }
    if (rec && (!byDate.has(rec.from) || !newer(byDate.get(rec.from), rec))) byDate.set(rec.from, rec);
  }
  if (!byDate.size) return null;
  const entries = [...byDate.values()].sort(byFrom);
  if (!entries.some((e) => !e.del)) return null;
  const top = entries.reduce((a, e) => (stampOf(e) > stampOf(a) ? e : a), entries[0]);
  return { v: 1, entries, upd: Number.isFinite(stampOf(top)) ? top.upd : all ?? undefined };
}

/** Поставить хранимый режим и собрать его вид для экранов (без надгробий и меток). */
function setGoal(rec) {
  goalRec = rec;
  if (!rec) { goal = null; return; }
  const live = rec.entries.filter((e) => !e.del).map(({ upd, ...e }) => e); // eslint-disable-line no-unused-vars
  goal = live.length ? { v: 1, entries: live, upd: rec.upd } : null;
}

/** Проверить день из облака или файла → запись для хранения (с upd) или null, если он пустой, битый или без метки времени. */
function cleanDay(d, upd) {
  const stamp = isoUpd(upd);
  if (!d || typeof d !== 'object' || !stamp) return null;
  if (d.del) return { del: true, upd: stamp };
  const day = normalizeDay(d);
  if (isEmptyDay(day)) return null;
  const rec = { ...day, upd: stamp };
  for (const k of ['mu', 'eu']) { const s = isoUpd(d[k]); if (s) rec[k] = s; }
  return rec;
}

/*
 * День заполняют по частям и часто с разных устройств: утро (вес, подъём) — с телефона, вечер (еда, отбой, заметка) —
 * перед сном, может быть, с компьютера. Поэтому день сливается по частям: у каждой части своя метка — mu (утро) и
 * eu (вечер), ISO. Метки нет → у заполненной части это upd записи, у пустой — «никогда» (такая часть проигрывает
 * любой заполненной: вечернее сохранение на устройстве, где утра ещё нет, не стирает утреннее взвешивание). Явная
 * метка у пустой части — её очистили нарочно; у заполненной — часть не менялась с этого момента.
 */
const DAY_PARTS = { mu: ['w', 'wake'], eu: ['kcal', 'p', 'f', 'c', 'bed', 'note'] };
const partEmpty = (rec, p) => DAY_PARTS[p].every((k) => rec[k] == null || rec[k] === '');
function partStamp(rec, p) {
  const t = Date.parse(rec?.[p] || '');
  if (Number.isFinite(t)) return t;
  return rec && !partEmpty(rec, p) ? stampOf(rec) : -Infinity;
}
/** Записать метку части в rec (без поля, если она совпадает с upd или «никогда»). Меняет rec. */
function setPartStamp(rec, p, t) {
  delete rec[p];
  const implied = partEmpty(rec, p) ? -Infinity : stampOf(rec);
  if (Number.isFinite(t) && t !== implied) rec[p] = new Date(t).toISOString();
}

/**
 * Слить две версии одного дня. Надгробие против записи — целиком, по upd. Две записи — по частям: каждая часть берётся
 * из версии, где её метка позже (при равенстве — из версии с более поздним upd). Если части пришли из разных версий,
 * получается новая версия с upd = позднейший из двух + 1 мс: оба устройства собирают её одинаково, и бот получает её
 * как более новую. Обе части пустые → надгробие.
 * @returns {{ rec: object|null, made: boolean }} made — получилась новая версия (её надо отправить боту)
 */
function mergeDay(local, remote) {
  if (!remote) return { rec: local, made: false };
  if (!local) return { rec: remote, made: false };
  const remoteNewer = newer(remote, local);
  if (local.del || remote.del) return { rec: remoteNewer ? remote : local, made: false };
  const pick = {};
  for (const p of Object.keys(DAY_PARTS)) {
    const l = partStamp(local, p), r = partStamp(remote, p);
    pick[p] = r > l || (r === l && remoteNewer) ? remote : local;
  }
  if (pick.mu === pick.eu) return { rec: pick.mu, made: false };
  const upd = new Date(Math.max(stampOf(local), stampOf(remote)) + 1).toISOString();
  const day = {};
  for (const p of Object.keys(DAY_PARTS)) for (const k of DAY_PARTS[p]) day[k] = pick[p][k] ?? null;
  const clean = normalizeDay(day);
  if (isEmptyDay(clean)) return { rec: { del: true, upd }, made: true };
  const rec = { ...clean, upd };
  for (const p of Object.keys(DAY_PARTS)) setPartStamp(rec, p, partStamp(pick[p], p));
  return { rec, made: true };
}

function putDay(date, rec) {
  const ym = monthOf(date);
  let m = months.get(ym);
  if (!m) { m = { v: 1, days: {}, upd: rec.upd }; months.set(ym, m); }
  m.days[dayOf(date)] = rec;
  m.upd = rec.upd;
  dayCache = null;
  persist('dm_' + ym, m);
}

/** Режим и история норм: { v:1, entries: [GoalEntry], upd } или null, пока режим не выбран. Не изменять. */
export const getGoal = () => goal;

const sameTargets = (a, b) => a.mode === b.mode && a.kcal === b.kcal && a.p === b.p && a.f === b.f && a.c === b.c && a.targetW === b.targetW;

/**
 * Сохранить режим и нормы. Изменение режима или чисел добавляет запись, действующую с даты from (запись с той же
 * датой заменяется), — прошлые дни остаются со своими нормами. Если отличается только пометка, она правится
 * на месте; если ничего не изменилось, ничего не делает. Возврат к нормам предыдущей записи в тот же день
 * убирает лишнюю запись (пометка предыдущей записи остаётся своей). Сохранение «на сегодня» убирает записи с более
 * поздней датой (они появляются, если часы телефона перевели назад или другое устройство уже жило «завтра»): то, что
 * сохранено сейчас, действует с этого дня и дальше. Запись задним числом (from раньше сегодняшнего дня) просто
 * встаёт на своё место в истории. Убранная запись остаётся в хранилище надгробием — иначе слияние с копией, где она
 * есть, вернуло бы её.
 * @param {{ mode: string, kcal: number|null, p: number|null, f: number|null, c: number|null, targetW?: number|null, note?: string }} entry
 * @param {string} [from] с какой даты действует; по умолчанию сегодняшняя дата дневника (до 05:00 — вчерашняя)
 * @returns {object} режим целиком (getGoal())
 */
export function saveGoalEntry(entry, from = diaryDate()) {
  const e = normalizeEntry({ ...entry, from });
  if (!e) throw new Error('Неверный режим или дата');
  const live = goal ? goal.entries : [];
  const cur = goalAt(goal, e.from);
  const dropLater = e.from >= diaryDate() && live.some((x) => x.from > e.from);
  const upd = stampAfter(goalRec?.upd);
  const recs = new Map((goalRec?.entries || []).map((x) => [x.from, x]));
  if (cur && sameTargets(cur, e) && !dropLater) {
    if (cur.note === e.note) return goal;
    recs.set(cur.from, { ...cur, note: e.note, upd }); // пометка боту не передаётся — очередь не трогаем
    commitGoal(recs, upd);
    return goal;
  }
  if (dropLater) for (const x of live) if (x.from > e.from) recs.set(x.from, { from: x.from, del: true, upd });
  const prev = goalAt({ entries: live.filter((x) => x.from < e.from) }, e.from);
  if (prev && sameTargets(prev, e)) {
    // вернулся к прежним нормам — лишняя запись не нужна
    if (recs.get(e.from) && !recs.get(e.from).del) recs.set(e.from, { from: e.from, del: true, upd });
  } else recs.set(e.from, { ...e, upd });
  commitGoal(recs, upd);
  enqueue([['g']]);
  return goal;
}

function commitGoal(recs, upd) {
  setGoal({ v: 1, entries: [...recs.values()].sort(byFrom), upd });
  persist('goal', goalRec);
}

/** День дневника (DiaryDay с upd) или null, если он не заполнен или удалён. Не изменять. */
export function getDiaryDay(date) {
  const d = rawDay(date);
  return d && !d.del ? d : null;
}

/**
 * Весь дневник: { 'YYYY-MM-DD': DiaryDay } по возрастанию даты, без удалённых дней — вход для функций diary.js.
 * Объект общий и кэшируется до следующего изменения: не изменять.
 */
export function allDiaryDays() {
  if (dayCache) return dayCache;
  const out = {};
  for (const ym of [...months.keys()].sort()) {
    const days = months.get(ym).days;
    const prefix = `${ym.slice(0, 4)}-${ym.slice(4)}-`;
    for (const dd of Object.keys(days).sort()) if (days[dd] && !days[dd].del) out[prefix + dd] = days[dd];
  }
  dayCache = out;
  return out;
}

/** Все записи дневника вместе с надгробиями: [дата, запись] по возрастанию даты. */
function allDayRecords() {
  const out = [];
  for (const ym of [...months.keys()].sort()) {
    const days = months.get(ym).days;
    for (const dd of Object.keys(days).sort()) {
      const date = `${ym.slice(0, 4)}-${ym.slice(4)}-${dd}`;
      if (days[dd] && isDate(date)) out.push([date, days[dd]]);
    }
  }
  return out;
}

/** Поставить день дневника в очередь отправки боту (сохранение и удаление делают это сами; так же — «отправить ещё раз»). */
export function markDayUnsynced(date) { if (isDate(date)) enqueue([['d', date]]); }
/** Поставить режим и нормы в очередь отправки боту (saveGoalEntry делает это сам). */
export function markGoalUnsynced() { if (goalRec) enqueue([['g']]); }

/**
 * Поставить в очередь отправки боту всё заново: режим, все дни дневника (и удаления за последний год) и все
 * завершённые тренировки. Для случая, когда бот что-то не получил (был выключен дольше суток — Telegram хранит
 * сообщения 24 часа) или потерял свои данные. То, что у бота уже есть, он не задвоит. Уходит обычной отправкой,
 * при длинной очереди — за несколько раз.
 * @returns {{ goal: boolean, days: number, workouts: number }} сколько всего поставлено в очередь (days — с удалениями)
 */
export function requeueAll() {
  const since = addDays(diaryDate(), -REQUEUE_TOMBS);
  const dates = allDayRecords().filter(([d, rec]) => !rec.del || d >= since).map(([d]) => d);
  const ids = finishedWorkouts().map((w) => w.id);
  enqueue([...dates.map((d) => ['d', d]), ...ids.map((id) => ['w', id]), ...(goalRec ? [['g']] : [])]);
  return { goal: !!goalRec, days: dates.length, workouts: ids.length };
}

/**
 * Вес в профиле — последнее взвешивание в дневнике не позже сегодняшнего дня (запись «из будущего», сохранённая при
 * сбитых часах, вес в профиле не держит). Вызывается, когда взвешивания изменились. removed — вес, который только что
 * стёрли: если взвешиваний больше нет, а в профиле стоит именно он (опечатка, которую убрали), профиль тоже очищается.
 */
function syncBodyweight(removed = null) {
  const last = latestWeight(allDiaryDays(), diaryDate());
  if (last) { if (profile.bodyweight !== last.w) updateProfile({ bodyweight: last.w }); } else if (removed != null && profile.bodyweight === removed) updateProfile({ bodyweight: null });
}

const DAY_FIELDS = ['kcal', 'p', 'f', 'c', 'w', 'wake', 'bed', 'note'];

/**
 * Сохранить день дневника. Значения приводятся к виду DiaryDay (diary.normalizeDay: всё, что вне допустимых
 * диапазонов, становится «не введено»), день ставится в очередь отправки боту. Если взвешивание изменилось,
 * profile.bodyweight становится равен самому свежему взвешиванию дневника. День без единого значения и без заметки
 * не хранится: такой вызов удаляет день (как deleteDiaryDay). Сохранение без изменений ничего не делает.
 * @param {string} date 'YYYY-MM-DD'
 * @param {object} day { kcal, p, f, c, w, wake, bed, note } — числа или null, время 'HH:MM'
 * @returns {object|null} сохранённая запись (с upd) или null, если день оказался пустым
 */
export function saveDiaryDay(date, day) {
  if (!isDate(date)) throw new Error('Неверная дата');
  const clean = normalizeDay(day);
  if (isEmptyDay(clean)) { deleteDiaryDay(date); return null; }
  const old = getDiaryDay(date);
  if (old && DAY_FIELDS.every((k) => old[k] === clean[k])) return old;
  const raw = rawDay(date);
  const rec = { ...clean, upd: stampAfter(raw?.upd) };
  // Метки частей (см. mergeDay): изменённая часть — сейчас; нетронутая сохраняет прежнюю; после очистки дня пустая
  // часть тоже «сейчас» — иначе её вернула бы более старая копия дня с другого устройства
  const before = old || normalizeDay({});
  for (const p of Object.keys(DAY_PARTS)) {
    const changed = DAY_PARTS[p].some((k) => before[k] !== clean[k]);
    setPartStamp(rec, p, changed || raw?.del ? stampOf(rec) : partStamp(old, p));
  }
  putDay(date, rec);
  markDayUnsynced(date);
  if ((old?.w ?? null) !== rec.w) syncBodyweight(old?.w ?? null);
  return rec;
}

/**
 * Очистить день: вместо записи остаётся надгробие { del: true, upd }, чтобы удаление дошло до облака и до бота.
 * @returns {boolean} false, если удалять было нечего
 */
export function deleteDiaryDay(date) {
  const old = rawDay(date);
  if (!old || old.del) return false;
  putDay(date, { del: true, upd: stampAfter(old.upd) });
  markDayUnsynced(date);
  if (old.w != null) syncBodyweight(old.w);
  return true;
}

/**
 * Вернуть день, очищенный по ошибке («Отменить» в плашке «День очищен»): запись rec снова становится днём, и в очереди
 * отправки остаётся то же, что было до очистки, — день, который бот уже получил, не числится «не отправленным».
 * @param {string} date
 * @param {object} rec запись, которая была до очистки (getDiaryDay)
 * @param {boolean} wasQueued стоял ли день в очереди до очистки (isDayQueued)
 */
export function restoreDiaryDay(date, rec, wasQueued) {
  const before = marks();
  const back = saveDiaryDay(date, rec);
  if (!back || wasQueued) return back;
  // Отправленная версия остаётся отправленной: новая версия того же содержимого ничего боту не добавляет
  const m = marks();
  m.s.d[date] = [Math.max(m.q.d[date] || 0, sentVer(m, 'd', date)), before.s.d[date]?.[1] || nowSec()];
  delete m.q.d[date];
  saveQueues(m);
  return back;
}

/**
 * Всё, что ещё не отправлено боту, — вход для sync.packAll: режим (если менялся; вместе с надгробиями), дни дневника по
 * возрастанию даты (day = null — день удалён; upd — версия записи) и завершённые тренировки от старых к новым.
 *
 * repeat — «повтор»: режим и записи за последние 14 дней, которые уже отправлялись. packAll кладёт их в ту же
 * посылку, пока есть место. Подтверждения доставки у sendData нет, а Telegram хранит сообщения для выключенного
 * бота только сутки, — так пробел у бота закрывается сам при следующей отправке. В очередь повтор не входит.
 * @returns {{ goal: object|null, days: { date: string, day: object|null, upd: string }[], workouts: object[],
 *   repeat: { goal: object|null, days: { date: string, day: object|null, upd: string }[] } }}
 */
export function pendingSync() {
  const days = [];
  for (const date of state.unsyncedDays) {
    const rec = rawDay(date);
    if (rec && queued('d', date)) days.push({ date, day: rec.del ? null : rec, upd: rec.upd }); // даты без записи (её ещё не принесло облако) не отправляем
  }
  const workouts = state.unsynced.filter((id) => queued('w', id)).map(getWorkout).filter((w) => w && w.end).sort(byStart);
  const dirty = queued('g') && !!goal;
  const again = [];
  // Окно повтора заканчивается сегодняшним днём — или последней записью, если она чуть позже (часы перевели назад),
  // но не дальше, чем бот принимает: запись «из будущего» не должна вытеснить из повтора настоящие последние дни.
  const today = diaryDate();
  let last = today;
  const newest = allDayRecords().map(([d]) => d).filter((d) => d <= addDays(today, FUTURE_DAYS)).pop();
  if (newest && newest > last) last = newest;
  for (let i = REPEAT_DAYS - 1; i >= 0; i--) {
    const date = addDays(last, -i);
    const rec = rawDay(date);
    if (rec && !queued('d', date)) again.push({ date, day: rec.del ? null : rec, upd: rec.upd });
  }
  return { goal: dirty ? goalRec : null, days, workouts, repeat: { goal: dirty || !goal ? null : goalRec, days: again } };
}

/**
 * Отметить отправленным то, что ушло одним sendData (результат sync.packAll). Вызывать только после того, как
 * sendData вернулся без ошибки, и сразу (посылку собирать прямо перед sendData): отправленной считается версия,
 * которая стоит в очереди сейчас.
 * @param {{ goal?: boolean, dates?: string[], ids?: string[] }} sent
 */
export function markSent({ goal: goalSent = false, dates = [], ids = [] } = {}) {
  const m = marks();
  const t = nowSec();
  let dirty = false;
  for (const [k, list] of [['d', dates], ['w', ids]]) {
    for (const key of list) {
      if (!m.q[k][key]) continue;
      m.s[k][key] = [Math.max(m.q[k][key], sentVer(m, k, key)), t];
      delete m.q[k][key];
      dirty = true;
    }
  }
  if (goalSent && m.q.g) { m.s.g = Math.max(m.q.g, m.s.g); m.q.g = 0; dirty = true; }
  if (dirty) saveQueues(m);
}

// ───────── Экспорт / импорт ─────────

export function exportData() {
  return { app: 'gym-upper-lower', v: 1, exported: now(), profile, state, prefs, workouts: allWorkouts(), goal: goalRec, diary: allDiaryDays() };
}

/**
 * Слить свой режим с другой его версией (из облака или из файла) — по записям: для каждой даты берётся запись (или
 * надгробие) с более поздней меткой. Целиком по upd побеждать нельзя: на новом телефоне своя версия — одна только что
 * выбранная запись, и она стёрла бы всю историю норм в облаке; а правка пометки в давно открытом приложении стёрла бы
 * запись, которую за это время добавило другое устройство.
 * @param {object|null} other результат cleanGoal
 * @returns {{ changed: boolean, push: boolean }} changed — свой режим изменился; push — у другой стороны нет того,
 *   что есть здесь (в облако надо записать)
 */
function mergeGoalWith(other) {
  if (!other) return { changed: false, push: !!goalRec };
  // Записи из файла без единой метки времени получают «сейчас»: без метки запись проиграла бы любой копии
  const stamp = now();
  const stamped = (e) => (e.upd ? e : { ...e, upd: stamp });
  if (!goalRec) {
    setGoal({ ...other, entries: other.entries.map(stamped), upd: other.upd || stamp });
    lsSet('goal', goalRec);
    return { changed: true, push: !other.upd };
  }
  const recs = new Map(goalRec.entries.map((e) => [e.from, e]));
  for (const e of other.entries) if (!recs.has(e.from) || newer(e, recs.get(e.from))) recs.set(e.from, stamped(e));
  const entries = [...recs.values()].sort(byFrom);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const changed = !same(entries, goalRec.entries);
  const push = !same(entries, other.entries);
  if (changed) {
    const top = entries.reduce((a, e) => (stampOf(e) > stampOf(a) ? e : a), entries[0]);
    setGoal({ v: 1, entries, upd: Number.isFinite(stampOf(top)) ? top.upd : now() });
    lsSet('goal', goalRec);
  }
  return { changed, push };
}

/**
 * Слить месяц дневника с другой его версией по дням: побеждает день с более поздним upd, а не весь месяц целиком.
 * @param {string} ym 'YYYYMM'
 * @param {object|undefined} r облачное значение ключа dm_YYYYMM
 * @returns {{ changed: boolean, push: boolean }} changed — пришли новые дни; push — здесь есть дни новее, чем там
 */
function mergeMonthWith(ym, r) {
  const rdays = r && r.days && typeof r.days === 'object' ? r.days : {};
  const m = months.get(ym) || { v: 1, days: {}, upd: undefined };
  let pulled = false;
  const made = [];
  for (const dd of Object.keys(rdays)) {
    const date = `${ym.slice(0, 4)}-${ym.slice(4)}-${dd}`;
    if (!isDate(date)) continue;
    const res = mergeDay(m.days[dd], cleanDay(rdays[dd], rdays[dd]?.upd));
    if (res.rec && res.rec !== m.days[dd]) { m.days[dd] = res.rec; pulled = true; }
    if (res.made) made.push(date);
  }
  if (pulled) {
    if (newer(r, m)) m.upd = isoUpd(r.upd) ?? m.upd;
    months.set(ym, m);
    lsSet('dm_' + ym, m);
    dayCache = null;
  }
  // Сведённая из двух версий запись — новая версия дня: боту её не отправляло ни одно устройство
  if (made.length) { enqueue(made.map((d) => ['d', d])); syncBodyweight(); }
  return { changed: pulled, push: Object.keys(m.days).some((dd) => newer(m.days[dd], rdays[dd])) };
}

/** Слияние по id: берём запись с более поздним upd (импортированная без upd проигрывает существующей). */
export function importData(obj) {
  if (!obj || !Array.isArray(obj.workouts)) throw new Error('Неверный формат файла');
  let added = 0, updated = 0;
  for (const w of obj.workouts) {
    if (!w || !w.id || !w.start) continue;
    const local = wmap.get(w.id);
    if (!local) added++;
    else if (newer(w, local) || (local.deleted && !w.deleted)) updated++;
    else continue;
    const rec = { ...w, upd: isoUpd(w.upd) || now() };
    wmap.set(w.id, rec);
    persist('w_' + w.id, rec);
  }
  saveIndex();
  if (obj.profile && newer(obj.profile, profile)) { profile = { ...DEFAULT_PROFILE, ...obj.profile, upd: isoUpd(obj.profile.upd) }; persist('profile', profile); }
  if (obj.prefs && newer(obj.prefs, prefs)) { prefs = { ...DEFAULT_PREFS, ...obj.prefs, upd: isoUpd(obj.prefs.upd) }; persist('prefs', prefs); }
  // Дневник — по дням: берём день с более поздним upd; день из файла возвращает и локально удалённый (как у тренировок).
  // Метка времени, которая не разбирается как дата, считается отсутствующей.
  let days = 0;
  if (obj.diary && typeof obj.diary === 'object') {
    for (const date of Object.keys(obj.diary).sort()) {
      const d = obj.diary[date];
      const local = rawDay(date);
      let rec = isDate(date) ? cleanDay(d, isoUpd(d?.upd) || now()) : null;
      if (rec && local && !local.del && !rec.del) {
        // Обе версии живые — по частям, как с облаком (mergeDay)
        const res = mergeDay(local, rec);
        if (res.rec === local) continue;
        putDay(date, res.rec);
        if (res.made) markDayUnsynced(date);
        days++;
        continue;
      }
      if (!rec || (local && !newer(d, local) && !(local.del && !rec.del))) continue;
      if (local && !newer(rec, local)) rec.upd = stampAfter(local.upd); // возвращённый день должен пережить надгробие в облаке
      putDay(date, rec);
      days++;
    }
  }
  // Режим — по записям (mergeGoalWith): файл без меток тоже годится, его давние записи встают рядом со своими.
  const goalChanged = mergeGoalWith(cleanGoal(obj.goal)).changed;
  if (goalChanged) mirror?.put('goal', goalRec);
  return { added, updated, days, goal: goalChanged };
}

// ───────── Облачное зеркало ─────────

/**
 * m = { put(key, value), removeAll(), close()?, onReset? }. Зеркало само решает, когда писать: настоящее (telegram.js)
 * ничего не пишет, пока app.js не прочитал облако и не вызвал mergeRemote, а «составные» ключи перед записью сливает
 * через mergeKey.
 */
export function setMirror(m) { mirror = m; }

/** Ключи, в одном значении которых много записей: перед записью в облако их надо слить с облачной копией. */
export const mergesKey = (key) => key === 'goal' || key === 'state' || /^dm_\d{6}$/.test(key);

/** Пока сброс не стёр облако, из него ничего нельзя брать: оно вернуло бы удалённое. */
function refuseWhileWiping() {
  if (cloudWipePending()) throw new Error('облако ещё не стёрто после сброса данных');
}

/**
 * Слить один «составной» ключ с его свежей облачной копией прямо перед записью (зеркало читает её и передаёт сюда).
 * Из облака подтягивается то, что там новее, — например день, который за время работы этого приложения добавило
 * другое устройство; без этого запись целого месяца из локальной копии такой день стёрла бы. Пока облако не стёрто
 * после сброса данных, бросает исключение: ключ остаётся в очереди зеркала.
 * @param {string} key 'goal', 'state' или 'dm_YYYYMM'
 * @param {object|undefined} remote облачное значение ключа (undefined — в облаке его нет)
 * @returns {{ value: object|null, changed: boolean }} value — что записать (null — в облаке уже всё есть);
 *   changed — локальные данные изменились
 */
export function mergeKey(key, remote) {
  refuseWhileWiping();
  if (key === 'goal') {
    const res = mergeGoalWith(cleanGoal(remote));
    return { value: res.push ? goalRec : null, changed: res.changed };
  }
  if (key === 'state') {
    const res = mergeStateWith(remote);
    return { value: res.push ? state : null, changed: res.changed };
  }
  const ym = key.slice(3);
  const res = mergeMonthWith(ym, remote);
  return { value: res.push ? months.get(ym) : null, changed: res.changed };
}

/**
 * Слить записи из облака (map key → value). Новее в облаке → пишем локально;
 * новее локально или нет в облаке → отправляем в облако. Возвращает true, если локальные данные изменились.
 * Пока облако не стёрто после сброса данных, бросает исключение (app.js сначала стирает облако).
 */
export function mergeRemote(remote) {
  refuseWhileWiping();
  let changed = false;
  const take = (key, local, apply) => {
    const r = remote[key];
    if (r && newer(r, local)) { apply(r); lsSet(key, r); changed = true; }
    else if (local?.upd && (!r || newer(local, r))) mirror?.put(key, local);
  };
  take('profile', profile, (r) => { profile = { ...DEFAULT_PROFILE, ...r }; });
  take('prefs', prefs, (r) => { prefs = { ...DEFAULT_PREFS, ...r }; });
  const ids = new Set([...wmap.keys(), ...Object.keys(remote).filter((k) => k.startsWith('w_')).map((k) => k.slice(2))]);
  for (const id of ids) {
    const key = 'w_' + id;
    take(key, wmap.get(id), (r) => { wmap.set(id, r); });
  }
  // Режим — по записям, дневник — по дням внутри месяца (см. mergeGoalWith и mergeMonthWith).
  const g = mergeGoalWith(cleanGoal(remote.goal));
  if (g.changed) changed = true;
  if (g.push) mirror?.put('goal', goalRec);
  const yms = new Set(months.keys());
  for (const k of Object.keys(remote)) if (/^dm_\d{6}$/.test(k)) yms.add(k.slice(3));
  for (const ym of yms) {
    const res = mergeMonthWith(ym, remote['dm_' + ym]);
    if (res.changed) changed = true;
    if (res.push) mirror?.put('dm_' + ym, months.get(ym));
  }
  // state — после записей: очереди прежней версии получают версии уже слитых записей
  const st = mergeStateWith(remote.state);
  if (st.changed) changed = true;
  if (st.push) mirror?.put('state', state);
  if (changed) {
    saveIndex();
    if (state.activeWorkoutId && !getWorkout(state.activeWorkoutId)) state.activeWorkoutId = null;
  }
  return changed;
}

/** Совместимость: прежняя версия снимала здесь «свою» очередь. Очереди теперь сливаются по каждой вещи — делать нечего. */
export function cloudSaved() {}

/** Сброс данных не успел стереть копию в облаке (не было связи): её надо стереть до следующего слияния. */
export function cloudWipePending() {
  try { return !!localStorage.getItem(WIPE_KEY); } catch { return false; }
}
/** Облако стёрто — отметку можно снять. */
export function cloudWipeDone() {
  try { localStorage.removeItem(WIPE_KEY); } catch { /* приватный режим */ }
}

/** Сколько раз за этот запуск сбрасывали данные: чтение облака, во время которого это число изменилось, не сливается. */
export const resetEpoch = () => resetGen;
/** Идущий сброс (Promise<boolean> — стёрто ли облако) или null. app.js ждёт его, прежде чем читать облако. */
export const resetWait = () => resetting;

/**
 * Полный сброс: все данные приложения на устройстве и их копия в облаке Telegram. Данные на устройстве стираются
 * сразу; облако — асинхронно. Зеркало закрывается: всё, что ждало записи, выбрасывается, а запись, которая как раз
 * читала облако, ничего не сливает. Снова открывает его app.js (cloudMirror.onReset → syncCloud): сначала облако
 * стирается (если сейчас не удалось — когда появится связь), потом читается и сливается заново. Пока облако не стёрто,
 * отметка gym-wipe не даёт ничего из него взять, а сохранённое после сброса ждёт на устройстве.
 * @returns {Promise<boolean>} false — копия в облаке пока осталась
 */
export function resetAll() {
  const gen = ++resetGen;
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(NS)) localStorage.removeItem(k);
    if (mirror) localStorage.setItem(WIPE_KEY, now());
  } catch { /* приватный режим */ }
  initStore();
  if (!mirror) return Promise.resolve(true);
  mirror.close?.();
  const run = (async () => {
    let ok = false;
    try { ok = (await mirror.removeAll()) !== false; } catch { ok = false; }
    if (ok && gen === resetGen) cloudWipeDone();
    return ok;
  })();
  resetting = run;
  run.then(() => {
    if (resetting !== run) return; // начался ещё один сброс — откроет он
    resetting = null;
    try { mirror?.onReset?.(); } catch (e) { console.warn('onReset', e); }
  });
  return run;
}
