// Экран «План»: 4 тренировки по кругу, правила программы, неделя знакомства, оборудование зала и замены.
import { EXERCISES, EQUIPMENT } from '../data/exercises.js';
import { PROGRAM } from '../data/program.js';
import { getState, getPrefs, updatePrefs } from '../storage.js';
import { haptic } from '../telegram.js';
import { html, raw, on, restLabel } from './dom.js';
import { icon } from './icons.js';
import { pageHeader, openSheet, toast } from './components.js';
import { planItems, equipState, exerciseAvailable, resolveExercise, WRIST, STATUS, WRIST_WARMUP } from './model.js';

export const NAME = 'plan';
let openSession = null; // раскрытая карточка сессии (запоминается между перерисовками)

function sessionCard(s, i, isNext, prefs) {
  const open = openSession ? openSession === s.id : isNext;
  const items = planItems(s, prefs);
  return html`<article class="card session ${open ? 'open' : ''} ${isNext ? 'next' : ''}">
    <header class="session-head tap" data-act="session" data-id="${s.id}">
      <span class="session-idx">${i + 1}</span>
      <div><h3>${s.name} ${isNext ? html`<span class="badge accent">следующая</span>` : ''}</h3><p>${s.focus}</p></div>
      ${raw(icon('down', 20, 'chev'))}
    </header>
    ${open ? html`<ul class="plan-items">${items.map((it) => {
      const ex = EXERCISES[it.exId];
      return html`<li class="plan-item tap" data-act="item" data-base="${it.baseId}">
        <div class="plan-item-main">
          <b>${ex?.name || it.exId}</b>
          ${it.reason ? html`<span class="replaced">${raw(icon('swap', 13))} вместо «${EXERCISES[it.baseId]?.short}»${it.reason === 'equip' ? ' — нет оборудования' : ''}</span>` : ''}
          <span class="plan-meta"><em>${it.sets} × ${it.reps[0]}–${it.reps[1]}</em> RIR ${it.rir[0]}–${it.rir[1]} · отдых ${restLabel(it.rest)}</span>
          ${it.note ? html`<span class="plan-note">${it.note}</span>` : ''}
        </div>
        <i class="wrist-dot ${WRIST[ex?.wrist]?.cls || ''}"></i>
      </li>`;
    })}</ul>` : ''}
  </article>`;
}

function equipmentSection(prefs) {
  const keys = Object.keys(EQUIPMENT);
  const auto = [];
  for (const s of Object.values(PROGRAM.sessions)) for (const it of s.items) {
    const r = resolveExercise(it.exId, prefs);
    if (r.reason === 'equip') auto.push([it.exId, r.id]);
  }
  const missing = keys.filter((k) => equipState(k, prefs) === false).length;
  const unknown = keys.filter((k) => equipState(k, prefs) === null).length;
  return html`<section class="section" id="equipment">
    <h3 class="section-title">${raw(icon('gym', 18))} Оборудование зала</h3>
    <p class="section-sub">Список собран по фото филиала. Отметь, что реально есть: упражнения без оборудования автоматически заменятся первой доступной альтернативой.</p>
    <div class="equip-summary">
      <span><b>${keys.length - missing - unknown}</b> есть</span><span><b>${missing}</b> нет</span><span><b>${unknown}</b> не проверено</span>
    </div>
    ${auto.length ? html`<div class="card auto-swaps"><b>${raw(icon('swap', 16))} Автозамены</b>${auto.map(([a, b]) => html`<p>${EXERCISES[a]?.short} → <span class="accent-text">${EXERCISES[b]?.short}</span></p>`)}</div>` : ''}
    <div class="card list equip-list">${keys.map((k) => {
      const st = equipState(k, prefs);
      const meta = STATUS[EQUIPMENT[k].status];
      return html`<div class="equip-row">
        <div><b>${EQUIPMENT[k].name}</b><span class="badge ${meta.cls}">${meta.label}</span></div>
        <div class="yn" role="group" aria-label="${EQUIPMENT[k].name}">
          <button class="${st === true ? 'on yes' : ''}" data-act="equip" data-k="${k}" data-v="1">Есть</button>
          <button class="${st === false ? 'on no' : ''}" data-act="equip" data-k="${k}" data-v="0">Нет</button>
        </div>
      </div>`;
    })}</div>
  </section>`;
}

export function render(ctx) {
  const { root } = ctx;
  const state = getState(), prefs = getPrefs();
  const nextId = PROGRAM.rotation[state.nextIdx % 4];
  const R = PROGRAM.rules;
  root.innerHTML = html`
    ${pageHeader('План', { kicker: PROGRAM.name })}
    <p class="lead">4 тренировки идут по кругу без привязки к дням недели. Приходишь — делаешь следующую. Каждая мышца получает нагрузку ~1,5 раза в неделю.</p>
    <div class="rotation big">${PROGRAM.rotation.map((id, i) => html`<span class="rot ${id === nextId ? 'on' : ''}">${PROGRAM.sessions[id].name}</span>${i < 3 ? raw(icon('right', 14)) : ''}`)}</div>

    <div class="sessions">${PROGRAM.rotation.map((id, i) => sessionCard(PROGRAM.sessions[id], i, id === nextId, prefs))}</div>

    <section class="section">
      <h3 class="section-title">${raw(icon('layers', 18))} Правила программы</h3>
      <div class="rules">
        <div class="rule"><div class="rule-ic">${raw(icon('progress', 20))}</div><div><b>Прогрессия</b><p>${R.progression}</p></div></div>
        <div class="rule"><div class="rule-ic">${raw(icon('target', 20))}</div><div><b>RIR</b><p>${R.rir}</p></div></div>
        <div class="rule"><div class="rule-ic">${raw(icon('refresh', 20))}</div><div><b>Разгрузка</b><p>${R.deload}</p></div></div>
        <div class="rule"><div class="rule-ic">${raw(icon('flame', 20))}</div><div><b>Разминка</b><p>${R.warmup}</p></div></div>
        <div class="rule wrist"><div class="rule-ic">${raw(icon('hand', 20))}</div><div><b>Запястья — бережём</b>
          <ol>${WRIST_WARMUP.map((s) => html`<li>${s}</li>`)}</ol>
          <p class="legend"><i class="wrist-dot safe"></i> безопасно <i class="wrist-dot care"></i> осторожно <i class="wrist-dot risky"></i> риск — цветная точка у каждого упражнения.</p></div></div>
      </div>
    </section>

    <section class="section">
      <h3 class="section-title">${raw(icon('sparkle', 18))} ${PROGRAM.calibration.title}</h3>
      <div class="card pad"><p class="section-sub">Первые ${PROGRAM.calibration.sessions} тренировки (полный круг) веса не задаются — ты их подбираешь. По записанным подходам приложение оценит силу (1ПМ) и рассчитает рабочие веса для двойной прогрессии.</p>
      <ol class="steps">${PROGRAM.calibration.howTo.map((s) => html`<li>${s}</li>`)}</ol></div>
    </section>

    ${equipmentSection(prefs)}`.s;

  ctx.cleanup(on(root, 'click', '[data-act]', (e, b) => {
    const act = b.dataset.act;
    if (act === 'session') {
      const id = b.dataset.id;
      const curOpen = openSession ?? nextId;
      openSession = curOpen === id ? '__none' : id;
      ctx.refresh();
    }
    if (act === 'equip') {
      const equip = { ...prefs.equip };
      const v = b.dataset.v === '1';
      if (equip[b.dataset.k] === v) delete equip[b.dataset.k]; else equip[b.dataset.k] = v;
      updatePrefs({ equip });
      haptic.select();
      ctx.refresh();
    }
    if (act === 'item') itemSheet(ctx, b.dataset.base);
  }));
}

/** Постоянная замена упражнения в плане. */
function itemSheet(ctx, baseId) {
  const prefs = getPrefs();
  const cur = resolveExercise(baseId, prefs).id;
  const options = [baseId, ...(EXERCISES[baseId]?.alternatives || [])].filter((id) => EXERCISES[id]);
  openSheet({
    title: EXERCISES[baseId]?.name,
    body: html`<button class="btn btn-secondary wide" data-tech="${cur}">${raw(icon('cube', 18))} Техника и 3D: ${EXERCISES[cur]?.short}</button>
      <p class="field-label">Делать в плане</p>
      <div class="pick-list">${options.map((id) => {
        const ex = EXERCISES[id];
        const avail = exerciseAvailable(id, prefs);
        return html`<button class="pick ${id === cur ? 'on' : ''}" data-id="${id}" ${avail ? '' : 'disabled'}>
          <b>${ex.name}${id === baseId ? html` <span class="badge">по программе</span>` : ''}</b>
          <span><i class="wrist-dot ${WRIST[ex.wrist].cls}"></i> запястье: ${WRIST[ex.wrist].short}${avail ? '' : ' · нет оборудования'}</span>
        </button>`;
      })}</div>`,
    onMount(el, close) {
      el.querySelector('[data-tech]').onclick = () => { close(); ctx.nav(`#/ex/${cur}`); };
      on(el, 'click', '[data-id]', (e, b) => {
        const swaps = { ...prefs.swaps };
        if (b.dataset.id === baseId) delete swaps[baseId]; else swaps[baseId] = b.dataset.id;
        updatePrefs({ swaps });
        close();
        toast('Замена сохранена', 'good');
        ctx.refresh();
      });
    },
  });
}
