// Ленивое подключение 3D-объяснялки (docs/3D_CONTRACT.md). Модуль грузится только когда нужен;
// если он недоступен или WebGL нет — показываем аккуратную заглушку. Экран обязан вызвать dispose() при уходе.
import { icon } from './icons.js';

let modPromise = null;
const loadModule = () => (modPromise ??= import('../three/explainer.js').catch((e) => { modPromise = null; throw e; }));

const lowEnd = () => (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 3;

/**
 * Модель тела — готовый файл (webapp/assets/body/). Начинаем качать его сразу, параллельно с three.js: загрузчик
 * маленький и three.js не тянет. Ошибку здесь не показываем — её сообщит createExplainer (он ждёт ту же загрузку).
 */
function preloadBody(quality) {
  import('../three/body/loader.js').then((m) => m.getBodyData(quality)).catch(() => {});
}

function placeholder(container, text) {
  container.classList.remove('is-loading');
  container.classList.add('is-fallback');
  container.insertAdjacentHTML('beforeend', `<div class="v3d-fallback">${figureSvg()}<p>${text}</p></div>`);
}

/** Схематичная фигура для заглушки. */
function figureSvg() {
  return `<svg viewBox="0 0 80 160" width="64" height="128" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true">
    <circle cx="40" cy="16" r="10"/><path d="M40 28v52M18 42l22-8 22 8M18 42l-6 34M62 42l6 34M30 80l-4 66M50 80l4 66"/></svg>`;
}

/**
 * Смонтировать 3D в контейнер. init(ex) — что сделать после создания (load / showBody).
 * Возвращает { ready: Promise<ex|null>, get ex(), dispose() }.
 */
export function mount3D(container, init) {
  let disposed = false, ex = null;
  container.classList.add('v3d', 'is-loading');
  container.insertAdjacentHTML('beforeend', `<div class="v3d-loader"><span class="spinner"></span><p>Загружаем 3D…</p></div>`);
  const ready = (async () => {
    try {
      if (!window.WebGLRenderingContext) throw new Error('WebGL недоступен');
      const quality = lowEnd() ? 'low' : 'high';
      preloadBody(quality);
      const m = await loadModule();
      if (disposed) return null;
      const inst = await m.createExplainer(container, { quality });
      if (disposed) { inst.dispose(); return null; }
      ex = inst;
      await init(inst);
      if (disposed) return null;
      container.classList.remove('is-loading');
      container.classList.add('is-ready');
      return inst;
    } catch (e) {
      console.warn('3D недоступно:', e?.message || e);
      try { ex?.dispose(); } catch { /* уже освобождено */ }
      ex = null;
      if (!disposed) placeholder(container, '3D-модель пока недоступна. Техника описана ниже.');
      return null;
    }
  })();
  return {
    ready,
    get ex() { return ex; },
    dispose() {
      disposed = true;
      try { ex?.dispose(); } catch (e) { console.warn('3D dispose', e); }
      ex = null;
    },
  };
}

export const playIcon = (playing) => icon(playing ? 'pause' : 'play', 20);
