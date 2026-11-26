// Поля форм дневника и режима: крупные числовые поля с подписью, время, общее поведение ввода.
// Рассчитаны на телефон в одной руке: нужная клавиатура, Enter переводит к следующему полю, поле не прячется под док.
import { html, on } from './dom.js';
import { cleanNumber, nb } from './diary-model.js';

/**
 * Числовое поле. Значение — строка с десятичной запятой; подпись справа от названия (aside) и строка под полем (hint)
 * обновляются снаружи через setAside / setHint.
 * @param {{ key: string, label: string, unit: string, value?: string, big?: boolean, mode?: 'decimal'|'numeric',
 *   max?: number, enter?: 'next'|'done', meter?: boolean }} o meter — полоска «сколько набрано от нормы» (setMeter)
 */
export function numField({ key, label, unit, value = '', big = false, mode = 'decimal', max = 6, enter = 'next', meter = false }) {
  return html`<div class="d-field ${big ? 'big' : ''}" data-field="${key}">
    <label class="d-label" for="f-${key}"><b>${label}</b><em data-aside="${key}"></em></label>
    <label class="d-input"><input id="f-${key}" type="text" inputmode="${mode}" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="${enter}" maxlength="${max}" value="${value}" placeholder="—" data-in="${key}"><i>${unit}</i></label>
    ${meter ? html`<span class="d-meter" data-meter="${key}" hidden><i></i><s></s></span>` : ''}
    <span class="d-hint" data-hint="${key}"></span>
  </div>`;
}

/**
 * Полоска под полем: value от нормы target. С band (доля, 0,1 = ±10 %) рисуется коридор вокруг нормы, а шкала
 * продлевается до 130 % нормы; без него полоска заполняется до нормы. cls — цвет заливки ('ok', 'over', '').
 */
export function setMeter(root, key, value, target, { band = 0, cls = '' } = {}) {
  const el = root.querySelector(`[data-meter="${key}"]`);
  if (!el) return;
  el.hidden = !(target > 0);
  if (el.hidden) return;
  const scale = band ? target * 1.3 : target;
  const zone = el.querySelector('s'), fill = el.querySelector('i');
  zone.hidden = !band;
  if (band) { zone.style.left = `${((target * (1 - band)) / scale) * 100}%`; zone.style.width = `${((target * 2 * band) / scale) * 100}%`; }
  fill.className = cls;
  fill.style.width = `${Math.min(100, Math.max(0, ((value || 0) / scale) * 100))}%`;
}

/**
 * Поле времени (системный выбор времени). Пустое поле показывает свой прочерк — на iOS системное пустое поле не видно.
 * after — разметка справа от поля в той же строке (кнопка «Сейчас»); below — под подписью поля (кнопка «Как обычно»).
 */
export function timeField({ key, label, value = '', after = '', below = '' }) {
  const input = html`<label class="d-input time ${value ? '' : 'empty'}"><input id="f-${key}" type="time" value="${value}" data-in="${key}"><u aria-hidden="true">--:--</u></label>`;
  return html`<div class="d-field" data-field="${key}">
    <label class="d-label" for="f-${key}"><b>${label}</b><em data-aside="${key}"></em></label>
    ${after ? html`<div class="d-row">${input}${after}</div>` : input}
    <span class="d-hint" data-hint="${key}"></span>${below}
  </div>`;
}

/** Строка под полем: текст и цвет ('', 'good', 'warn', 'bad'). Число не отрывается от единицы при переносе строки. */
export function setHint(root, key, text = '', cls = '') {
  const el = root.querySelector(`[data-hint="${key}"]`);
  if (!el) return;
  el.textContent = nb(text);
  el.className = `d-hint ${cls}`;
}
/** Подпись справа от названия поля (например «норма 2150»). */
export function setAside(root, key, text = '') {
  const el = root.querySelector(`[data-aside="${key}"]`);
  if (el) el.textContent = text;
}
/** Отметить поля с негодным значением. */
export function markInvalid(root, keys) {
  root.querySelectorAll('[data-field]').forEach((f) => f.classList.toggle('invalid', keys.includes(f.dataset.field)));
}
/** Подставить значение в поле из кода (кнопка «Сейчас», «Подставить»). */
export function setValue(root, key, value) {
  const inp = root.querySelector(`[data-in="${key}"]`);
  if (!inp) return;
  inp.value = value;
  if (inp.type === 'time') inp.parentElement.classList.toggle('empty', !inp.value);
}

/**
 * Общее поведение полей формы.
 * @param {HTMLElement} root
 * @param {{ decimals: Record<string, number>, order: string[], onChange: (key: string, value: string) => void }} o
 *   decimals — сколько знаков после запятой у числовых полей; order — порядок перехода по Enter
 * @returns {() => void} снять обработчики
 */
export function bindFields(root, { decimals, order, onChange }) {
  // Заметка растёт вместе с текстом: длинную не приходится перечитывать в окошке на две строки.
  const grow = (ta) => {
    ta.style.height = 'auto';
    if (ta.scrollHeight > 0) ta.style.height = `${ta.scrollHeight + ta.offsetHeight - ta.clientHeight}px`; // + рамка
  };
  root.querySelectorAll('textarea[data-in]').forEach(grow);
  const change = (e, inp) => {
    const key = inp.dataset.in;
    if (inp.type === 'text' && key in decimals) {
      const v = cleanNumber(inp.value, decimals[key]);
      if (v !== inp.value) inp.value = v;
    }
    if (inp.type === 'time') inp.parentElement.classList.toggle('empty', !inp.value);
    if (inp.tagName === 'TEXTAREA') grow(inp);
    onChange(key, inp.value);
  };
  const offs = [
    on(root, 'input', '[data-in]', change),
    on(root, 'change', '[data-in]', change),
    on(root, 'keydown', 'input[data-in]', (e, inp) => {
      if (e.key !== 'Enter' || inp.type !== 'text') return;
      e.preventDefault();
      const next = order.slice(order.indexOf(inp.dataset.in) + 1).map((k) => root.querySelector(`input[type="text"][data-in="${k}"]`)).find(Boolean);
      if (next) next.focus(); else inp.blur();
    }),
    on(root, 'focusin', '[data-in]', (e, inp) => {
      if (inp.type === 'text') inp.select();
      // Когда клавиатура уже выехала, поле могло оказаться под шапкой или под доком с кнопками — подвинем его.
      setTimeout(() => {
        if (document.activeElement !== inp) return;
        const r = inp.getBoundingClientRect();
        const dock = root.querySelector('.cta-dock');
        const fixed = dock && getComputedStyle(dock).position === 'fixed';
        const bottom = (window.visualViewport?.height || window.innerHeight) - (fixed ? dock.offsetHeight : 0) - 12;
        // У заметки нет обёртки поля — двигаем её саму (иначе с открытой клавиатурой она оставалась под кнопками)
        if (r.top < 72 || r.bottom > bottom) (inp.closest('[data-field]') || inp).scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 320);
    }),
  ];
  return () => offs.forEach((off) => off());
}
