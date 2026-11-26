// Экран «План»: 3 тренировки по кругу (Верх → Низ → Руки и плечи), правила программы, неделя знакомства, оборудование зала и замены.
import { EXERCISES, EQUIPMENT } from '../data/exercises.js';
import { PROGRAM, currentNextIdx } from '../data/program.js';
import { getState, getPrefs, updatePrefs, finishedWorkouts, activeWorkout } from '../storage.js';
import { haptic } from '../telegram.js';
import { html, raw, on } from './dom.js';
import { icon } from './icons.js';
import { pageHeader, openSheet, toast } from './components.js';
import { planItems, equipState, exerciseAvailable, supersetLabels, restHtml, WRIST, STATUS, WRIST_WARMUP } from './model.js';

export const NAME = 'plan';
let openSession = null; // раскрытая карточка сессии (запоминается между перерисовками)

/**
 * Заметка пункта. Заметка программы написана для упражнения по плану; у замены вместо неё — подсказка
 * для запястья, если замена «осторожно» (например, опорная рука в тяге гантели).
 */
function planNote(it, ex) {
  if (it.exId === it.baseId) return it.note ? html`<span class="plan-note">${it.note}</span>` : '';
  return ex && ex.wrist !== 'safe' ? html`<span class="plan-note">${ex.wristNote}</span>` : '';
}

function sessionCard(s, i, isNext, prefs) {
  const open = openSession ? openSession === s.id : isNext;
  const items = planItems(s, prefs);
  const pairs = supersetLabels(items);
  const shortOf = (baseId) => EXERCISES[items.find((x) => x.baseId === baseId)?.exId]?.short || '';
  return html`<article class="card session ${open ? 'open' : ''} ${isNext ? 'next' : ''}">
    <header class="session-head tap" data-act="session" data-id="${s.id}">
      <span class="session-idx">${i + 1}</span>
      <div><h3>${s.name} ${isNext ? html`<span class="badge accent">следующая</span>` : ''}</h3><p>${s.focus}</p></div>
      ${raw(icon('down', 20, 'chev'))}
    </header>
    ${open ? html`<ul class="plan-items">${items.map((it) => {
      const ex = EXERCISES[it.exId];
      const pair = pairs.get(it.baseId);
      return html`<li class="plan-item tap" data-act="item" data-base="${it.baseId}" data-session="${s.id}">
        <div class="plan-item-main">
          <b>${pair ? html`<span class="badge accent">${pair.label}</span> ` : ''}${ex?.name || it.exId}</b>
          ${it.reason === 'missing' ? html`<span class="replaced warn">${raw(icon('alert', 13))} нет оборудования, замена не нашлась</span>`
            : it.reason === 'dup' ? html`<span class="replaced">${raw(icon('swap', 13))} своя замена «${EXERCISES[it.dup]?.short}» здесь не действует: это упражнение уже есть в тренировке</span>`
            : it.reason ? html`<span class="replaced">${raw(icon('swap', 13))} вместо «${EXERCISES[it.baseId]?.short}»${it.reason === 'equip' ? ' — нет оборудования' : ''}</span>` : ''}
          <span class="plan-meta"><em>${it.sets} × ${it.reps[0]}–${it.reps[1]}</em> RIR ${it.rir[0]}–${it.rir[1]} · ${restHtml(it, pair, pair && shortOf(pair.partner))}</span>
          ${planNote(it, ex)}
        </div>
        <i class="wrist-dot ${WRIST[ex?.wrist]?.cls || ''}"></i>
      </li>`;
    })}</ul>` : ''}
  </article>`;
}

function equipmentSection(prefs) {
  const keys = Object.keys(EQUIPMENT);
  // Автозамены по всем тренировкам круга (одно упражнение в двух тренировках — одна строка).
  const auto = new Map();
  for (const s of Object.values(PROGRAM.sessions)) for (const it of planItems(s, prefs)) {
    if (it.reason === 'equip' || it.reason === 'missing') auto.set(`${it.baseId}>${it.exId}`, it);
  }
  const missing = keys.filter((k) => equipState(k, prefs) === false).length;
  const unknown = keys.filter((k) => equipState(k, prefs) === null).length;
  return html`<section class="section" id="equipment">
    <h3 class="section-title">${raw(icon('gym', 18))} Оборудование зала</h3>
    <p class="section-sub">Список собран по фото филиала. Отметь, что реально есть: упражнения без оборудования автоматически заменятся первой доступной альтернативой.</p>
    <div class="equip-summary">
      <span><b>${keys.length - missing - unknown}</b> есть</span><span><b>${missing}</b> нет</span><span><b>${unknown}</b> не проверено</span>
    </div>
    ${auto.size ? html`<div class="card auto-swaps"><b>${raw(icon('swap', 16))} Автозамены</b>${[...auto.values()].map((it) => html`<p>${EXERCISES[it.baseId]?.short} → ${it.reason === 'missing' ? html`<span class="warn-text">замены нет</span>` : html`<span class="accent-text">${EXERCISES[it.exId]?.short}</span>`}</p>`)}</div>` : ''}
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
  const nextId = PROGRAM.rotation[currentNextIdx(state, finishedWorkouts(), activeWorkout())];
  const R = PROGRAM.rules;
  root.innerHTML = html`
    ${pageHeader('План', { kicker: PROGRAM.name })}
    <p class="lead">3 тренировки идут по кругу без привязки к дням недели. Приходишь — делаешь следующую. При 3 визитах в неделю круг проходит ровно за неделю: ноги\u00A0— 1\u00A0раз, грудь и спина\u00A0— 1\u00A0раз, бицепс и трицепс\u00A0— 2\u00A0раза. Между «Руки и плечи» и «Верхом» нужен хотя бы день отдыха: оба дня нагружают локти и запястья.</p>
    <div class="rotation big">${PROGRAM.rotation.map((id, i) => html`<span class="rot ${id === nextId ? 'on' : ''}">${PROGRAM.sessions[id].name}</span>${i < PROGRAM.rotation.length - 1 ? raw(icon('right', 14)) : ''}`)}</div>

    <div class="sessions">${PROGRAM.rotation.map((id, i) => sessionCard(PROGRAM.sessions[id], i, id === nextId, prefs))}</div>

    <section class="section">
      <h3 class="section-title">${raw(icon('layers', 18))} Правила программы</h3>
      <div class="rules">
        <div class="rule"><div class="rule-ic">${raw(icon('progress', 20))}</div><div><b>Прогрессия</b><p>${R.progression}</p></div></div>
        <div class="rule"><div class="rule-ic">${raw(icon('target', 20))}</div><div><b>RIR</b><p>${R.rir}</p></div></div>
        <div class="rule"><div class="rule-ic">${raw(icon('refresh', 20))}</div><div><b>Разгрузка</b><p>${R.deload}</p></div></div>
        <div class="rule"><div class="rule-ic">${raw(icon('flame', 20))}</div><div><b>Разминка</b><p>${R.warmup}</p></div></div>
        <div class="rule"><div class="rule-ic">${raw(icon('swap', 20))}</div><div><b>Суперсеты</b><p>Упражнения с метками А1 и А2 (Б1 и Б2, В1 и В2) идут парой: подход первого, 20 секунд на переход, подход второго, отдых — и снова первое. Приложение само переключает карточки и ставит таймер.</p></div></div>
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
    if (act === 'item') itemSheet(ctx, b.dataset.base, b.dataset.session);
  }));
}

/** Постоянная замена упражнения в плане. */
function itemSheet(ctx, baseId, sessionId) {
  const prefs = getPrefs();
  const cur = planItems(PROGRAM.sessions[sessionId], prefs).find((it) => it.baseId === baseId)?.exId || baseId;
  const options = [baseId, ...(EXERCISES[baseId]?.alternatives || [])].filter((id) => EXERCISES[id]);
  // Замена общая для всех тренировок: упражнение, которое уже есть в этой тренировке, выбрать нельзя.
  const inSession = new Set(PROGRAM.sessions[sessionId].items.map((it) => it.exId).filter((id) => id !== baseId));
  openSheet({
    title: EXERCISES[baseId]?.name,
    body: html`<button class="btn btn-secondary wide" data-tech="${cur}">${raw(icon('cube', 18))} Техника и 3D: ${EXERCISES[cur]?.short}</button>
      <p class="field-label">Делать в плане</p>
      <div class="pick-list">${options.map((id) => {
        const ex = EXERCISES[id];
        const avail = exerciseAvailable(id, prefs);
        const dup = inSession.has(id);
        return html`<button class="pick ${id === cur ? 'on' : ''}" data-id="${id}" ${avail && !dup ? '' : 'disabled'}>
          <b>${ex.name}${id === baseId ? html` <span class="badge">по программе</span>` : ''}</b>
          <span><i class="wrist-dot ${WRIST[ex.wrist].cls}"></i> запястье: ${WRIST[ex.wrist].short}${avail ? '' : ' · нет оборудования'}${dup ? ' · уже есть в этой тренировке' : ''}</span>
        </button>`;
      })}</div>`,
    onMount(el, close) {
      el.querySelector('[data-tech]').onclick = () => { close(); ctx.nav(`#/ex/${cur}`); };
      on(el, 'click', '[data-id]', (e, b) => {
        const swaps = { ...prefs.swaps };
        if (b.dataset.id === baseId) delete swaps[baseId]; else swaps[baseId] = b.dataset.id;
        updatePrefs({ swaps });
        close();
        // Тот же пункт есть и в другой тренировке, где эта замена повторила бы упражнение дня, — там она не действует.
        const skipped = PROGRAM.rotation.map((id) => PROGRAM.sessions[id])
          .filter((s) => planItems(s, { ...prefs, swaps }).some((it) => it.baseId === baseId && it.reason === 'dup'));
        toast(skipped.length ? `Замена сохранена. В «${skipped.map((s) => s.name).join('», «')}» не действует: там это упражнение уже есть` : 'Замена сохранена', 'good');
        ctx.refresh();
      });
    },
  });
}
