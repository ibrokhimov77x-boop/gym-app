// Общие UI-компоненты: нижние шторки, тосты, подтверждения, шапки, степперы.
import { html, raw, esc, on } from './dom.js';
import { icon } from './icons.js';
import { haptic, hasNativeBack } from '../telegram.js';

const root = () => document.getElementById('overlay-root');

// ───────── Нижняя шторка ─────────

const sheets = [];

/**
 * Открыть шторку. body — Raw-разметка; onMount(el, close) — навесить обработчики.
 * Возвращает close(). Закрывается тапом по фону, свайпом вниз за ручку и кнопкой «Назад».
 */
export function openSheet({ title, body, onMount, onClose, cls = '' }) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = html`<div class="sheet-backdrop" data-close></div>
    <section class="sheet ${cls}" role="dialog" aria-modal="true" aria-label="${title || ''}">
      <div class="sheet-grip" data-grip><span></span></div>
      ${title ? html`<header class="sheet-head"><h3>${title}</h3><button class="icon-btn" data-close aria-label="Закрыть">${raw(icon('x', 20))}</button></header>` : ''}
      <div class="sheet-body">${body}</div>
    </section>`.s;
  root().appendChild(wrap);
  const sheet = wrap.querySelector('.sheet');
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    const i = sheets.indexOf(close);
    if (i >= 0) sheets.splice(i, 1);
    wrap.classList.remove('open');
    wrap.classList.add('closing');
    setTimeout(() => wrap.remove(), 260);
    onClose?.();
  };
  sheets.push(close);
  on(wrap, 'click', '[data-close]', () => close());
  // Свайп вниз за ручку
  const grip = wrap.querySelector('[data-grip]');
  let y0 = null;
  grip.addEventListener('pointerdown', (e) => { y0 = e.clientY; grip.setPointerCapture(e.pointerId); sheet.style.transition = 'none'; });
  grip.addEventListener('pointermove', (e) => { if (y0 != null) sheet.style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`; });
  grip.addEventListener('pointerup', (e) => {
    sheet.style.transition = '';
    const dy = e.clientY - (y0 ?? e.clientY);
    y0 = null;
    sheet.style.transform = '';
    if (dy > 80) close();
  });
  requestAnimationFrame(() => wrap.classList.add('open'));
  onMount?.(sheet, close);
  return close;
}

/** Закрыть верхнюю шторку (для кнопки «Назад»). Возвращает true, если что-то закрыли. */
export function closeTopSheet() {
  const c = sheets[sheets.length - 1];
  if (c) { c(); return true; }
  return false;
}

/** Подтверждение действия → Promise<boolean>. */
export function confirmSheet({ title, text, ok = 'Да', cancel = 'Отмена', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    openSheet({
      title,
      body: html`<p class="sheet-text">${text}</p>
        <div class="btn-row">
          <button class="btn btn-secondary" data-close>${cancel}</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${ok}</button>
        </div>`,
      onMount(el, close) { el.querySelector('[data-ok]').onclick = () => { result = true; close(); }; },
      onClose: () => resolve(result),
    });
  });
}

// ───────── Тост ─────────

let toastTimer;
export function toast(msg, type = '') {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; root().appendChild(el); }
  el.className = `toast ${type}`;
  el.innerHTML = `${type === 'good' ? icon('check', 18) : type === 'bad' ? icon('alert', 18) : ''}<span>${esc(msg)}</span>`;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

// ───────── Плашка с действием ─────────

let snackTimer;
/**
 * Плашка внизу экрана с одной кнопкой — например «День очищен · Отменить». Стоит над нижней панелью (в зоне
 * большого пальца), живёт ms миллисекунд; действие срабатывает один раз. Возвращает функцию, которая её убирает.
 */
export function snackbar(msg, { action = '', onAction = null, ms = 7000 } = {}) {
  let el = document.querySelector('.snack');
  if (!el) { el = document.createElement('div'); el.className = 'snack'; el.setAttribute('role', 'status'); root().appendChild(el); }
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="snack-btn">${icon('undo', 18)}${esc(action)}</button>` : ''}`;
  const hide = () => { clearTimeout(snackTimer); el.classList.remove('show'); };
  const btn = el.querySelector('button');
  if (btn) btn.onclick = () => { hide(); onAction?.(); };
  // Над тем, что сейчас закреплено внизу: док с главной кнопкой или нижняя навигация.
  const base = [...document.querySelectorAll('.cta-dock, .tabbar')]
    .filter((n) => !n.hidden && getComputedStyle(n).position === 'fixed')
    .reduce((h, n) => Math.max(h, window.innerHeight - n.getBoundingClientRect().top), 0);
  el.style.bottom = `${Math.max(base, 0) + 10}px`;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(snackTimer);
  snackTimer = setTimeout(hide, ms);
  return hide;
}

// ───────── Разметка ─────────

/** Шапка вложенного экрана. Своя кнопка «Назад» — только вне Telegram (там есть нативная). */
export function subHeader(title, { sub = '', right = '' } = {}) {
  return html`<header class="subhead">
    ${hasNativeBack() ? '' : html`<button class="icon-btn" data-act="back" aria-label="Назад">${raw(icon('left', 22))}</button>`}
    <div class="subhead-title"><h2>${title}</h2>${sub ? html`<p>${sub}</p>` : ''}</div>
    <div class="subhead-right">${right}</div>
  </header>`;
}

/** Заголовок вкладки. */
export function pageHeader(title, { kicker = '', right = '' } = {}) {
  return html`<header class="pagehead">
    <div>${kicker ? html`<p class="kicker">${kicker}</p>` : ''}<h1>${title}</h1></div>
    ${right}
  </header>`;
}

/** Сегментированный переключатель. */
export function segmented(name, options, value, cls = '') {
  return html`<div class="seg ${cls}" role="tablist" data-seg="${name}">
    ${options.map(([v, label]) => html`<button role="tab" class="${String(v) === String(value) ? 'on' : ''}" data-act="seg" data-name="${name}" data-v="${v}">${label}</button>`)}
  </div>`;
}

/** Степпер: [−] [число, можно ввести] [+]. */
export function stepper(field, value, { unit = '', label = '', step = 1, decimals = true } = {}) {
  return html`<div class="stepper" data-field="${field}" data-step="${step}">
    ${label ? html`<span class="stepper-label">${label}</span>` : ''}
    <div class="stepper-row">
      <button class="step-btn" data-act="step" data-d="-1" aria-label="Меньше">${raw(icon('minus', 22))}</button>
      <label class="step-val">
        <input type="text" class="${String(value).length > 3 ? 'long' : ''}" inputmode="${decimals ? 'decimal' : 'numeric'}" value="${String(value).replace('.', ',')}" data-input="${field}" aria-label="${label}">
        ${unit ? html`<span class="step-unit">${unit}</span>` : ''}
      </label>
      <button class="step-btn" data-act="step" data-d="1" aria-label="Больше">${raw(icon('plus', 22))}</button>
    </div>
  </div>`;
}

/** Считать число из поля степпера (запятая допускается). */
export const parseNum = (s) => { const v = parseFloat(String(s).replace(',', '.')); return Number.isFinite(v) ? v : 0; };

export function emptyState(ic, title, text, action = '') {
  return html`<div class="empty"><div class="empty-ic">${raw(icon(ic, 28))}</div><h4>${title}</h4><p>${text}</p>${action}</div>`;
}

/** Нажатия с тактильной отдачей для всех кнопок приложения. */
export function installPressFeedback() {
  document.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, .tap')) haptic.tap();
  }, { passive: true });
}
