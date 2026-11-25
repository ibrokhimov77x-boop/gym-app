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

const CHUNK = 4000;            // значение ≤ 4096 символов — оставляем запас
const BATCH = 20;              // ключей за один getItems
const cs = atLeast('6.9') ? tg.CloudStorage : null;
export const cloudAvailable = !!cs;

const call = (method, ...args) => new Promise((resolve, reject) => {
  cs[method](...args, (err, res) => (err ? reject(err) : resolve(res)));
});

/** Сколько кусков сейчас лежит у ключа в облаке (чтобы удалить лишние при перезаписи). */
const chunkCount = new Map();

async function getMany(keys) {
  const out = {};
  for (let i = 0; i < keys.length; i += BATCH) Object.assign(out, await call('getItems', keys.slice(i, i + BATCH)));
  return out;
}

/** Прочитать всё облако → { key: object }. Длинные значения собираются из кусков key__1..n. */
export async function cloudReadAll() {
  if (!cs) return {};
  const keys = (await call('getKeys')) || [];
  const main = keys.filter((k) => !k.includes('__'));
  const raw = await getMany(main);
  const out = {};
  for (const k of main) {
    try {
      let v = JSON.parse(raw[k] || 'null');
      if (v && v.$chunks) {
        const n = v.$chunks;
        chunkCount.set(k, n);
        const parts = await getMany(Array.from({ length: n }, (_, i) => `${k}__${i + 1}`));
        v = JSON.parse(Array.from({ length: n }, (_, i) => parts[`${k}__${i + 1}`] || '').join(''));
      }
      if (v) out[k] = v;
    } catch (e) { console.warn('CloudStorage: битое значение', k, e); }
  }
  return out;
}

async function writeKey(key, value) {
  const str = JSON.stringify(value);
  const old = chunkCount.get(key) || 0;
  let n = 0;
  if (str.length <= CHUNK) {
    await call('setItem', key, str);
  } else {
    n = Math.ceil(str.length / CHUNK);
    for (let i = 0; i < n; i++) await call('setItem', `${key}__${i + 1}`, str.slice(i * CHUNK, (i + 1) * CHUNK));
    await call('setItem', key, JSON.stringify({ $chunks: n }));
  }
  if (old > n) await call('removeItems', Array.from({ length: old - n }, (_, i) => `${key}__${n + i + 1}`));
  chunkCount.set(key, n);
}

// Запись с задержкой: частые сохранения во время тренировки склеиваются в одну.
const pending = new Map();
let timer = null;
let lastStatus = { ok: true, at: null };
export const cloudStatus = () => lastStatus;

async function flush() {
  timer = null;
  const items = [...pending.entries()];
  pending.clear();
  for (const [k, v] of items) {
    try { await writeKey(k, v); lastStatus = { ok: true, at: Date.now() }; }
    catch (e) { lastStatus = { ok: false, at: Date.now(), error: String(e) }; console.warn('CloudStorage write failed', k, e); }
  }
}

export const cloudMirror = {
  put(key, value) {
    if (!cs) return;
    pending.set(key, value);
    clearTimeout(timer);
    timer = setTimeout(flush, 800);
  },
  async removeAll() {
    if (!cs) return;
    pending.clear();
    try {
      const keys = (await call('getKeys')) || [];
      for (let i = 0; i < keys.length; i += BATCH) await call('removeItems', keys.slice(i, i + BATCH));
      chunkCount.clear();
    } catch (e) { console.warn('CloudStorage clear failed', e); }
  },
  flush() { if (pending.size) { clearTimeout(timer); flush(); } },
};
