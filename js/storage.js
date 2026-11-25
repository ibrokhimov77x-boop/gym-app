// Хранилище приложения. Контракт ключей: docs/DATA_CONTRACT.md
// Основное — localStorage (мгновенно, офлайн). Зеркало — Telegram CloudStorage (подключается из telegram.js через setMirror).
// Каждая запись получает поле upd (ISO) при сохранении; при слиянии побеждает запись с более поздним upd.
// Демо-режим живёт в отдельном пространстве имён и никогда не смешивается с реальными данными и облаком.

const MODE_FLAG = 'gym:mode';

/** Режим определяется до загрузки: ?demo=1 или флаг из профиля. ?demo=0 выключает флаг. */
function detectMode() {
  const q = new URLSearchParams(location.search).get('demo');
  try {
    if (q === '0') localStorage.removeItem(MODE_FLAG);
    if (q === '1') return 'demo';
    return localStorage.getItem(MODE_FLAG) === 'demo' ? 'demo' : 'real';
  } catch { return q === '1' ? 'demo' : 'real'; }
}

export const MODE = detectMode();
const NS = MODE === 'demo' ? 'gymdemo:' : 'gym:';

const DEFAULT_PROFILE = { v: 1, bodyweight: null, heightCm: null, startDate: null, wristCare: true, calibrationDone: false, restDefault: 90, autoRest: true };
const DEFAULT_STATE = { v: 1, nextIdx: 0, activeWorkoutId: null, unsynced: [] };
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
let mirror = null;

/** Записать ключ локально и (для реальных данных) в облачное зеркало. */
function persist(key, value) {
  lsSet(key, value);
  if (MODE === 'real' && mirror) mirror.put(key, value);
}

function saveIndex() { lsSet('wl', [...wmap.keys()]); }

export function initStore() {
  profile = { ...DEFAULT_PROFILE, ...(lsGet('profile') || {}) };
  state = { ...DEFAULT_STATE, ...(lsGet('state') || {}) };
  prefs = { ...DEFAULT_PREFS, ...(lsGet('prefs') || {}) };
  prefs.equip ||= {}; prefs.swaps ||= {};
  state.unsynced ||= [];
  wmap.clear();
  for (const id of lsGet('wl') || []) {
    const w = lsGet('w_' + id);
    if (w && w.id) wmap.set(w.id, w);
  }
  // Активная тренировка могла быть удалена на другом устройстве.
  if (state.activeWorkoutId && !getWorkout(state.activeWorkoutId)) state.activeWorkoutId = null;
}

export const getProfile = () => profile;
export const getState = () => state;
export const getPrefs = () => prefs;

export function updateProfile(patch) { profile = { ...profile, ...patch, upd: now() }; persist('profile', profile); }
export function updateState(patch) { state = { ...state, ...patch, upd: now() }; persist('state', state); }
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
  const patch = { unsynced: state.unsynced.filter((x) => x !== id) };
  if (state.activeWorkoutId === id) patch.activeWorkoutId = null;
  updateState(patch);
}

/** Id по контракту: YYYYMMDD-HHMM локального времени (с суффиксом при совпадении). */
export function newWorkoutId(date = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  const base = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
  let id = base, k = 2;
  while (wmap.has(id)) id = `${base}-${k++}`;
  return id;
}

export function markUnsynced(id) {
  if (!state.unsynced.includes(id)) updateState({ unsynced: [...state.unsynced, id] });
}
export function markSynced(ids) { updateState({ unsynced: state.unsynced.filter((x) => !ids.includes(x)) }); }

// ───────── Экспорт / импорт ─────────

export function exportData() {
  return { app: 'gym-upper-lower', v: 1, exported: now(), profile, state, prefs, workouts: allWorkouts() };
}

const newer = (a, b) => (a?.upd || '') > (b?.upd || '');

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
    const rec = { ...w, upd: w.upd || now() };
    wmap.set(w.id, rec);
    persist('w_' + w.id, rec);
  }
  saveIndex();
  if (obj.profile && newer(obj.profile, profile)) { profile = { ...DEFAULT_PROFILE, ...obj.profile }; persist('profile', profile); }
  if (obj.prefs && newer(obj.prefs, prefs)) { prefs = { ...DEFAULT_PREFS, ...obj.prefs }; persist('prefs', prefs); }
  return { added, updated };
}

// ───────── Облачное зеркало ─────────

/** m = { put(key, value), removeAll() } */
export function setMirror(m) { mirror = m; }

/**
 * Слить записи из облака (map key → value). Новее в облаке → пишем локально;
 * новее локально или нет в облаке → отправляем в облако. Возвращает true, если локальные данные изменились.
 */
export function mergeRemote(remote) {
  if (MODE !== 'real') return false;
  let changed = false;
  const take = (key, local, apply) => {
    const r = remote[key];
    if (r && newer(r, local)) { apply(r); lsSet(key, r); changed = true; }
    else if (local?.upd && (!r || newer(local, r))) mirror?.put(key, local);
  };
  take('profile', profile, (r) => { profile = { ...DEFAULT_PROFILE, ...r }; });
  take('state', state, (r) => { state = { ...DEFAULT_STATE, ...r }; });
  take('prefs', prefs, (r) => { prefs = { ...DEFAULT_PREFS, ...r }; });
  const ids = new Set([...wmap.keys(), ...Object.keys(remote).filter((k) => k.startsWith('w_')).map((k) => k.slice(2))]);
  for (const id of ids) {
    const key = 'w_' + id;
    take(key, wmap.get(id), (r) => { wmap.set(id, r); });
  }
  if (changed) {
    saveIndex();
    if (state.activeWorkoutId && !getWorkout(state.activeWorkoutId)) state.activeWorkoutId = null;
  }
  return changed;
}

/** Полный сброс текущего пространства (и облака, если это реальные данные). */
export function resetAll() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(NS)) localStorage.removeItem(k);
  } catch { /* приватный режим */ }
  if (MODE === 'real') mirror?.removeAll();
  initStore();
 
}

/** Демо: заполнить пустое демо-пространство сгенерированными данными. */
export function seedDemo({ profile: p, state: s, prefs: pr, workouts }) {
  if (MODE !== 'demo') return;
  for (const w of workouts) { wmap.set(w.id, w); lsSet('w_' + w.id, w); }
  saveIndex();
  profile = { ...DEFAULT_PROFILE, ...p }; lsSet('profile', profile);
  state = { ...DEFAULT_STATE, ...s }; lsSet('state', state);
  prefs = { ...DEFAULT_PREFS, ...pr }; lsSet('prefs', prefs);
}

/** Включить/выключить демо-режим (с перезагрузкой). */
export function setDemoMode(on) {
  try { if (on) localStorage.setItem(MODE_FLAG, 'demo'); else localStorage.removeItem(MODE_FLAG); } catch { /* ignore */ }
  const url = new URL(location.href);
  url.searchParams.delete('demo');
  if (on) url.searchParams.set('demo', '1');
  url.hash = '#/profile';
  location.replace(url.toString());
}
