// Обёртка над Telegram.WebApp. Всё безопасно вызывать и в обычном браузере (там функции просто ничего не делают).
const tg = window.Telegram?.WebApp;

/**
 * Открыто внутри Telegram. В обычном браузере скрипт тоже загружается, но platform = 'unknown'.
 * initData для этой проверки не годится: при запуске кнопкой reply-клавиатуры она пустая (см. canSendToBot).
 */
export const inTelegram = !!(tg && tg.platform && tg.platform !== 'unknown');
const atLeast = (v) => inTelegram && tg.isVersionAtLeast?.(v);

/** Применить цвета: тёмная тема по умолчанию, светлая — если Telegram в светлой схеме. */
function applyTheme() {
  const root = document.documentElement;
  const scheme = inTelegram ? tg.colorScheme : 'dark';
  root.dataset.theme = scheme === 'light' ? 'light' : 'dark';
  const tp = inTelegram ? tg.themeParams || {} : {};
  // Фон и текст берём из темы Telegram, чтобы приложение «сливалось» с клиентом; акцент остаётся своим.
  const map = { bg_color: '--bg', secondary_bg_color: '--bg-elev', text_color: '--text', hint_color: '--text-3' };
  for (const [k, cssVar] of Object.entries(map)) {
    if (tp[k]) root.style.setProperty(cssVar, tp[k]); else root.style.removeProperty(cssVar);
  }
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim() || '#0A0B0E';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
  if (atLeast('6.1')) { try { tg.setHeaderColor(bg); tg.setBackgroundColor(bg); } catch { /* старый клиент */ } }
  if (atLeast('7.10')) { try { tg.setBottomBarColor(bg); } catch { /* ignore */ } }
}

export function initTelegram({ onBack }) {
  applyTheme();
  if (!inTelegram) return;
  tg.ready();
  tg.expand();
  if (atLeast('7.7')) tg.disableVerticalSwipes();
  tg.onEvent('themeChanged', applyTheme);
  if (atLeast('6.1')) tg.BackButton.onClick(onBack);
}

/** Есть ли нативная кнопка «Назад» (тогда свою в шапке не рисуем). */
export const hasNativeBack = () => atLeast('6.1');

export function showBack(show) {
  if (!hasNativeBack()) return;
  if (show) tg.BackButton.show(); else tg.BackButton.hide();
}

/** Тактильная отдача: Telegram HapticFeedback или navigator.vibrate как запасной вариант. */
export const haptic = {
  tap() { if (atLeast('6.1')) tg.HapticFeedback.impactOccurred('light'); },
  medium() { if (atLeast('6.1')) tg.HapticFeedback.impactOccurred('medium'); else navigator.vibrate?.(15); },
  select() { if (atLeast('6.1')) tg.HapticFeedback.selectionChanged(); },
  success() { if (atLeast('6.1')) tg.HapticFeedback.notificationOccurred('success'); else navigator.vibrate?.([20, 40, 20]); },
  warning() { if (atLeast('6.1')) tg.HapticFeedback.notificationOccurred('warning'); else navigator.vibrate?.(40); },
  error() { if (atLeast('6.1')) tg.HapticFeedback.notificationOccurred('error'); else navigator.vibrate?.([40, 30, 40]); },
};

/** Подтверждение перед закрытием Mini App, пока идёт тренировка. */
export function setClosingConfirmation(on) {
  if (!atLeast('6.2')) return;
  if (on) tg.enableClosingConfirmation(); else tg.disableClosingConfirmation();
}

// ───────── Передача в бота ─────────

/**
 * sendData работает только если Mini App открыт кнопкой reply-клавиатуры бота. По документации Telegram
 * (WebAppInitData) именно при таком запуске initData пустая; у кнопки меню и inline-кнопок она заполнена.
 */
export const canSendToBot = () => inTelegram && !tg.initData;
export function sendToBot(str) { tg.sendData(str); }

// ───────── CloudStorage (зеркало localStorage) ─────────
//
// Три правила, без которых облачная копия теряет данные (docs/DATA_CONTRACT.md, «CloudStorage»):
// 1. Пока облако ни разу не прочитано и не слито с локальными данными (cloudMirror.open), в него ничего не пишется:
//    на новом телефоне локальная копия пуста, и запись «как есть» стёрла бы то, что лежит в облаке.
// 2. Ключ, в одном значении которого много записей (месяц дневника, режим), перед записью читается из облака заново
//    и сливается (cloudMirror.merger) — так запись из давно открытого приложения не затирает то, что за это время
//    добавило другое устройство.
// 3. Длинное значение пишется новым «поколением» кусков, и только потом на него переключается сам ключ: читатель
//    никогда не видит смесь старых и новых кусков, даже если приложение закрыли посреди записи.

const CHUNK = 4000;            // значение ≤ 4096 символов — оставляем запас
const BATCH = 20;              // ключей за один getItems
const PARALLEL = 4;            // ключей в записи одновременно
const CALL_TIMEOUT = 12000;    // ответ CloudStorage не пришёл — считаем вызов неудачным
const DEBOUNCE = 800;          // частые сохранения во время тренировки склеиваются в одну запись
const RETRY = 20000;           // повтор неудавшейся записи
const ORPHAN_AGE = 3600000;    // куски чужого поколения моложе часа может ещё дописывать другое устройство
const cs = atLeast('6.9') ? tg.CloudStorage : null;
export const cloudAvailable = !!cs;

const call = (method, ...args) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`CloudStorage.${method}: нет ответа`)), CALL_TIMEOUT);
  cs[method](...args, (err, res) => { clearTimeout(t); if (err) reject(err); else resolve(res); });
});

/** Как значение ключа лежит в облаке: key → { n, g } — число кусков и поколение (g = null — прежние имена key__1…n). */
const chunkInfo = new Map();
const partKeys = (key, { n, g }) => Array.from({ length: n }, (_, i) => (g ? `${key}__${g}_${i + 1}` : `${key}__${i + 1}`));
let lastGen = 0;
/** Имя поколения — время записи в base36: по нему же видно, насколько старые куски остались без «головы». */
function nextGen() {
  lastGen = Math.max(Date.now(), lastGen + 1);
  return lastGen.toString(36);
}

async function getMany(keys) {
  const out = {};
  for (let i = 0; i < keys.length; i += BATCH) Object.assign(out, await call('getItems', keys.slice(i, i + BATCH)));
  return out;
}

const broken = (key, e) => { console.warn('CloudStorage: битое значение', key, e); };
/** Куски длинного значения не собрались в JSON (см. assemble с torn). */
const TORN = Symbol('torn');

/**
 * Собрать значение ключа из его «головы» (и кусков, если оно длинное). undefined — ключа нет или значение не
 * разбирается. Сбой связи при чтении кусков — исключение: «не прочиталось» нельзя путать с «в облаке пусто».
 * @param {boolean} [torn] вернуть TORN, если куски не сошлись (а не undefined): так readKey отличает значение,
 *   которое прямо сейчас переписывает другое устройство, от по-настоящему битого
 */
async function assemble(key, head, torn = false) {
  chunkInfo.delete(key);
  if (!head) return undefined;
  let v;
  try { v = JSON.parse(head); } catch (e) { broken(key, e); return undefined; }
  if (!v || !v.$chunks) return v ?? undefined;
  const info = { n: Math.max(0, Math.floor(+v.$chunks) || 0), g: typeof v.g === 'string' && v.g ? v.g : null };
  chunkInfo.set(key, info);
  const names = partKeys(key, info);
  const parts = await getMany(names);
  try { return JSON.parse(names.map((k) => parts[k] || '').join('')) ?? undefined; } catch (e) {
    if (torn) return TORN;
    broken(key, e);
    return undefined;
  }
}

let readStatus = null;         // последнее чтение облака целиком: true / false / null — ещё не читали

/**
 * Убрать куски, на которые не ссылается ни один ключ: приложение закрыли между переключением «головы» и уборкой.
 * Свежие чужие поколения не трогаем — возможно, их прямо сейчас дописывает другое устройство.
 */
function sweepOrphans(keys) {
  const stale = [];
  for (const k of keys) {
    const at = k.indexOf('__');
    if (at < 0) continue;
    const info = chunkInfo.get(k.slice(0, at));
    const m = k.slice(at + 2).match(/^(?:([a-z0-9]+)_)?(\d+)$/);
    if (!m) continue; // не наш ключ
    const gen = m[1] || null;
    if (info && info.g === gen && +m[2] <= info.n) continue;
    if (gen && Date.now() - parseInt(gen, 36) < ORPHAN_AGE) continue;
    stale.push(k);
  }
  for (let i = 0; i < stale.length; i += BATCH) call('removeItems', stale.slice(i, i + BATCH)).catch(() => {});
}

/**
 * Прочитать всё облако → { key: object }. Длинные значения собираются из кусков. Бросает исключение, если облако
 * не ответило: тогда слияние надо повторить позже, а не считать, что там пусто.
 */
export async function cloudReadAll() {
  if (!cs) return {};
  try {
    const keys = (await call('getKeys')) || [];
    const main = keys.filter((k) => !k.includes('__'));
    const raw = await getMany(main);
    const out = {};
    for (const k of main) {
      const v = await assemble(k, raw[k]);
      if (v) out[k] = v;
    }
    readStatus = true;
    sweepOrphans(keys);
    return out;
  } catch (e) {
    readStatus = false;
    throw e;
  }
}

/**
 * Прочитать один ключ (перед записью со слиянием). «Голова» и куски длинного значения читаются двумя запросами; если
 * между ними другое устройство переключило ключ на новое поколение и убрало старые куски, они не соберутся. Такое
 * значение не битое — его просто переписывают: «голова» читается заново, и, если она изменилась, ключ читается ещё раз.
 * Если «голова» та же — значение и правда битое (его можно переписать своим). Ключ, который всё время меняется, —
 * сбой чтения: вслепую его не пишем, он останется в очереди до повтора.
 */
async function readKey(key) {
  for (let attempt = 1; ; attempt++) {
    const head = (await call('getItems', [key]))?.[key];
    const v = await assemble(key, head, true);
    if (v !== TORN) return v;
    const again = (await call('getItems', [key]))?.[key];
    if (again === head) { broken(key, 'куски не собираются'); return undefined; }
    if (attempt >= 3) throw new Error(`CloudStorage: ${key} переписывается другим устройством`);
  }
}

/**
 * Разрезать строку на куски не длиннее CHUNK так, чтобы суррогатная пара (эмодзи) не разрывалась: одинокая половинка
 * на стыке не переживает передачу в UTF-8 и превращается в «�».
 */
function cut(str) {
  const out = [];
  for (let i = 0; i < str.length;) {
    let end = Math.min(i + CHUNK, str.length);
    const last = str.charCodeAt(end - 1);
    if (end < str.length && last >= 0xd800 && last <= 0xdbff) end--;
    out.push(str.slice(i, end));
    i = end;
  }
  return out;
}

async function writeKey(key, value) {
  const str = JSON.stringify(value);
  const old = chunkInfo.get(key);
  let info = null;
  if (str.length <= CHUNK) {
    await call('setItem', key, str);
  } else {
    // Сначала все куски нового поколения, потом — одним запросом — «голова», которая на них указывает.
    const pieces = cut(str);
    info = { n: pieces.length, g: nextGen() };
    const names = partKeys(key, info);
    await Promise.all(names.map((name, i) => call('setItem', name, pieces[i])));
    await call('setItem', key, JSON.stringify({ $chunks: info.n, g: info.g }));
  }
  if (info) chunkInfo.set(key, info); else chunkInfo.delete(key);
  // Прежние куски больше не нужны. Не удалось убрать — не страшно: их подберёт sweepOrphans.
  if (old?.n) call('removeItems', partKeys(key, old)).catch(() => {});
}

const pending = new Map();     // ключ → значение, ждущее записи
let timer = null;
let gate = false;              // правило 1: записи разрешены после первого слияния с облаком
let flushing = null;           // идущая запись (Promise)
let epoch = 0;                 // растёт при close(): запись, начатая до него, не сливает и не пишет ничего
let lastStatus = { ok: true, at: null };
/**
 * Состояние зеркала для экрана «Профиль»: ok / at / error — последняя запись; ready — облако прочитано и слито,
 * записи идут; readOk — удалось ли последнее чтение облака (null — ещё не читали).
 */
export const cloudStatus = () => ({ ...lastStatus, ready: gate, readOk: readStatus });

function schedule(ms) {
  clearTimeout(timer);
  timer = gate && pending.size ? setTimeout(flush, ms) : null;
}

async function writeOne(key, value, seen, ep) {
  const m = cloudMirror.merger;
  if (m && m.test(key)) {
    // Правило 2. Сбой чтения — исключение: вслепую такой ключ не пишем, он останется в очереди до повтора.
    const remote = await readKey(key);
    // Пока читали, данные на устройстве сбросили (close): прочитанное нельзя сливать в пустое хранилище — сброс
    // вернул бы стёртое, — и писать прежнее значение тоже незачем.
    if (ep !== epoch) return;
    const res = m.merge(key, remote);
    if (res.changed) seen.pulled = true;
    if (res.value == null) return; // в облаке уже есть всё, что есть здесь
    value = res.value;
  }
  if (ep !== epoch) return;
  await writeKey(key, value);
  cloudMirror.onSaved?.(key, value);
}

async function drain() {
  const failed = new Map();
  const seen = { pulled: false, any: false, error: '' };
  const ep = epoch;
  while (gate && pending.size && ep === epoch) {
    seen.any = true;
    const items = [...pending.entries()];
    pending.clear();
    let next = 0;
    const worker = async () => {
      while (next < items.length && ep === epoch) { // после close() оставшееся из этой пачки уже не пишется
        const [k, v] = items[next++];
        try {
          await writeOne(k, v, seen, ep);
        } catch (e) {
          seen.error = String(e);
          console.warn('CloudStorage write failed', k, e);
          failed.set(k, v);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, worker));
  }
  if (ep !== epoch) return true; // данные сброшены: недописанное относится к стёртому
  for (const [k, v] of failed) if (!pending.has(k)) pending.set(k, v); // более свежее значение того же ключа важнее
  // «Ошибка записи», пока не записан хотя бы один ключ, а не по тому, какой из них ответил последним
  if (seen.any) lastStatus = failed.size ? { ok: false, at: Date.now(), error: seen.error } : { ok: true, at: Date.now() };
  if (seen.pulled) { try { cloudMirror.onPulled?.(); } catch (e) { console.warn('onPulled', e); } }
  return failed.size === 0;
}

/** Записать всё, что ждёт. Возвращает Promise<boolean>: true — очередь записана целиком (или писать было нечего). */
function flush() {
  clearTimeout(timer);
  timer = null;
  if (!gate || !cs) return Promise.resolve(!pending.size);
  if (!flushing) {
    flushing = drain().catch((e) => { console.warn('CloudStorage flush', e); return false; }).then((ok) => {
      flushing = null;
      if (pending.size) schedule(ok ? DEBOUNCE : RETRY);
      return ok;
    });
  }
  return flushing;
}

export const cloudMirror = {
  /**
   * Правила слияния хранилища для «составных» ключей: { test(key) → boolean, merge(key, remote) → { value, changed } }.
   * merge получает свежую облачную копию ключа (undefined — её нет), подтягивает из неё то, что новее, и возвращает
   * value — что писать (null — писать нечего) и changed — изменились ли локальные данные.
   */
  merger: null,
  /** Вызывается после записи, если слияние перед ней подтянуло из облака новые данные (экран стоит перерисовать). */
  onPulled: null,
  /** Вызывается после каждой удачной записи ключа: (key, value). */
  onSaved: null,
  /**
   * Вызывается после «Сбросить все данные» (storage.resetAll), когда попытка стереть облако закончилась: облако надо
   * заново прочитать и слить (app.js → syncCloud), и только после этого зеркало снова открывается для записи.
   */
  onReset: null,
  put(key, value) {
    if (!cs) return;
    pending.set(key, value);
    if (!flushing) schedule(DEBOUNCE); // идущая запись сама подхватит новое
  },
  /** Облако прочитано и слито с локальными данными — с этого момента записи идут. Вызывает app.js после mergeRemote. */
  open() {
    gate = true;
    if (pending.size) flush();
  },
  /**
   * Данные на устройстве стёрты (storage.resetAll): запись закрыта, всё, что ждало записи, выброшено, а идущая
   * запись не сливает прочитанное и не пишет. Снова открывает зеркало только app.js — после того как облако стёрто
   * и прочитано заново. То, что сохранят после сброса, копится и уйдёт тогда же.
   */
  close() {
    epoch++;
    gate = false;
    pending.clear();
    clearTimeout(timer);
    timer = null;
    readStatus = null;
  },
  /**
   * Стереть всё облако. Ждёт идущую запись (иначе она допишет ключи уже после очистки); то, что ждёт записи, не
   * трогает — после close() это сохранённое уже после сброса.
   * @returns {Promise<boolean>} false — не получилось (нет связи): облачная копия осталась
   */
  async removeAll() {
    if (!cs) return true;
    try {
      if (flushing) await flushing;
      const keys = (await call('getKeys')) || [];
      for (let i = 0; i < keys.length; i += BATCH) await call('removeItems', keys.slice(i, i + BATCH));
      chunkInfo.clear();
      return true;
    } catch (e) {
      console.warn('CloudStorage clear failed', e);
      readStatus = false; // «нет связи — пока только на устройстве»
      return false;
    }
  },
  flush,
};
