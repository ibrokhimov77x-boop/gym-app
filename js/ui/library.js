// Экран «Упражнения»: поиск и библиотека по группам мышц.
import { EXERCISES, MUSCLES, MUSCLE_GROUPS } from '../data/exercises.js';
import { html, raw, on } from './dom.js';
import { icon } from './icons.js';
import { pageHeader, segmented, emptyState } from './components.js';
import { programUsage, WRIST } from './model.js';

export const NAME = 'library';
let query = '';
let group = 'all';

/** Группа упражнения — по первой основной мышце. */
const groupOf = (ex) => Object.entries(MUSCLE_GROUPS).find(([, ms]) => ms.includes(ex.primary[0]))?.[0] || 'Другое';

function listHtml() {
  const q = query.trim().toLowerCase();
  const all = Object.values(EXERCISES).filter((ex) => (!q || ex.name.toLowerCase().includes(q) || ex.primary.some((m) => MUSCLES[m].name.toLowerCase().includes(q)))
    && (group === 'all' || groupOf(ex) === group));
  if (!all.length) return emptyState('search', 'Ничего не нашлось', 'Попробуй другое название или мышцу.');
  const groups = Object.keys(MUSCLE_GROUPS).filter((g) => all.some((ex) => groupOf(ex) === g));
  return html`${groups.map((g) => html`<section class="lib-group">
    <h3 class="section-title">${g}</h3>
    <div class="card list">${all.filter((ex) => groupOf(ex) === g).map((ex) => {
      const used = programUsage(ex.id);
      return html`<a class="list-row tap" data-nav="#/ex/${ex.id}">
        <div><b>${ex.name}</b><span>${ex.primary.map((m) => MUSCLES[m].name).join(', ')}${used.length ? html` · <em class="accent-text">${used.join(', ')}</em>` : ''}</span></div>
        <div class="list-right"><i class="wrist-dot ${WRIST[ex.wrist].cls}" title="${WRIST[ex.wrist].label}"></i>${raw(icon('right', 18, 'muted'))}</div>
      </a>`;
    })}</div></section>`)}`;
}

export function render(ctx) {
  const { root } = ctx;
  root.innerHTML = html`
    ${pageHeader('Упражнения', { kicker: `${Object.keys(EXERCISES).length} в библиотеке` })}
    <div class="lib-tools">
      <label class="search"><span>${raw(icon('search', 18))}</span><input type="search" placeholder="Название или мышца" value="${query}" data-q enterkeyhint="search"></label>
      <div class="hscroll">${segmented('group', [['all', 'Все'], ...Object.keys(MUSCLE_GROUPS).map((g) => [g, g])], group, 'seg-scroll')}</div>
    </div>
    <div data-list>${listHtml()}</div>`.s;
  const list = root.querySelector('[data-list]');
  ctx.cleanup(on(root, 'input', '[data-q]', (e, inp) => { query = inp.value; list.innerHTML = listHtml().s; }));
  ctx.cleanup(on(root, 'click', '[data-act="seg"]', (e, b) => {
    group = b.dataset.v;
    root.querySelectorAll('[data-act="seg"]').forEach((x) => x.classList.toggle('on', x === b));
    list.innerHTML = listHtml().s;
  }));
}
