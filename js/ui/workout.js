// Активная тренировка (#/workout) и просмотр/правка завершённой (#/w/<id>).
// Каждый подход сохраняется сразу — тренировка переживает закрытие приложения.
import { EXERCISES, MUSCLES } from '../data/exercises.js';
import { PROGRAM, sessionById, nextIdxAfter, currentNextIdx, nextIdxPatch } from '../data/program.js';
import { nextTarget, isPR, workingSets, duration, setScore } from '../analytics.js';
import {
  getProfile, getState, getPrefs, getWorkout, activeWorkout, finishedWorkouts, saveWorkout, deleteWorkout,
  updateState, updateProfile, updatePrefs, markUnsynced,
} from '../storage.js';
import { haptic, setClosingConfirmation, hasNativeBack } from '../telegram.js';
import { html, raw, on, clock, dayLong, hhmm, minutes } from './dom.js';
import { icon } from './icons.js';
import { openSheet, confirmSheet, toast, stepper, parseNum, emptyState, segmented } from './components.js';
import {
  itemFor, targetLabel, prefill, bestSet, repsOnly, repsUnit, weightLabel, exerciseAvailable, calibInfo, WRIST, WRIST_WARMUP,
  supersetPartner, afterWorkingSet, resumeCard, restHtml,
} from './model.js';
import { startRest, stopRest } from './rest.js';

export const NAME = 'workout';

// Состояние интерфейса между перерисовками (какая карточка раскрыта, черновики подходов).
let ui = { wid: null, open: 0, drafts: {}, notes: {} };

const RIR_OPTS = [[0, '0'], [1, '1'], [2, '2'], [3, '3'], [4, '4+']];

/** История до этой тренировки — для целей и «в прошлый раз». */
const historyBefore = (w) => finishedWorkouts().filter((x) => x.id !== w.id && new Date(x.start) < new Date(w.start));

function weightStep(exId) { return Math.abs(EXERCISES[exId]?.increment || 2.5) || 2.5; }
function weightCaption(exId) {
  const ex = EXERCISES[exId];
  if (ex?.increment < 0) return 'помощь, кг';
  if (ex?.load === 'bodyweight') return 'доп. вес, кг';
  return ex?.perHand ? 'кг на руку' : 'вес, кг';
}
const setText = (exId, s) => (repsOnly(exId) ? `${s.r} ${repsUnit(exId)}` : `${weightLabel(exId, s.w)} × ${s.r}`);

/** Рекорд: лучше всей истории и всех уже записанных подходов этого упражнения в текущей тренировке. */
function beatsAll(hist, w, e, set) {
  if (!isPR(hist, e.id, set, w.bw)) return false;
  const cur = bestSet(e, w.bw);
  return !cur || setScore(e.id, set, w.bw) > setScore(e.id, cur, w.bw) + 0.05;
}

export function render(ctx) {
  const edit = !!ctx.opts.edit;
  const w = edit ? getWorkout(ctx.params[0]) : activeWorkout();
  const { root } = ctx;
  if (!w) {
    root.innerHTML = html`<div class="pad-top"></div>${emptyState('today', edit ? 'Тренировка не найдена' : 'Нет активной тренировки', edit ? 'Возможно, она была удалена.' : 'Нажми «Пришёл в зал» на экране «Сегодня», чтобы начать.',
      html`<button class="btn btn-primary" data-nav="#/today">На экран «Сегодня»</button>`)}`.s;
    return;
  }
  if (ui.wid !== w.id) ui = { wid: w.id, open: resumeCard(w), drafts: {}, notes: {} };
  if (!edit) setClosingConfirmation(true);

  const profile = getProfile();
  const hist = historyBefore(w);
  const session = sessionById(w.session); // и старые тренировки (Верх A …) — с прежними названиями и назначениями
  const ctxFor = (e) => {
    const item = itemFor(w, e, profile.restDefault);
    const target = nextTarget(hist, { ...item, exId: e.from || e.id }, e.id, !!w.calib);
    return { item, target };
  };
  const planned = w.ex.reduce((a, e) => a + Math.max(itemFor(w, e).sets, workingSets(e).length), 0);
  const done = w.ex.reduce((a, e) => a + workingSets(e).length, 0);
  const started = w.ex.some((e) => e.sets.length);
  const draftOf = (i) => (ui.drafts[i] ??= prefill(w.ex[i], ctxFor(w.ex[i]).item, ctxFor(w.ex[i]).target));
  if (w.ex[ui.open]) draftOf(ui.open);

  root.innerHTML = html`
    <header class="whead">
      <div class="whead-row">
        ${hasNativeBack() ? '' : html`<button class="icon-btn" data-act="back" aria-label="Назад">${raw(icon('left', 22))}</button>`}
        <div class="whead-title">
          <p class="kicker">${edit ? dayLong(w.start) : w.calib ? 'Неделя знакомства' : 'Тренировка'}</p>
          <h2>${session?.name || 'Тренировка'}</h2>
        </div>
        <div class="whead-time">${edit
          ? html`<b>${minutes(duration(w))}</b><span>${hhmm(w.start)}${w.end ? `–${hhmm(w.end)}` : ''}</span>`
          : html`<b data-elapsed>${clock((Date.now() - new Date(w.start)) / 1000)}</b><span>с ${hhmm(w.start)}</span>`}</div>
        <button class="icon-btn" data-act="menu" aria-label="Меню тренировки">${raw(icon('dots', 22))}</button>
      </div>
      <div class="whead-progress"><div class="bar"><i style="width:${planned ? (done / planned) * 100 : 0}%"></i></div><span>${done}/${planned}</span></div>
    </header>

    ${w.calib && !edit ? html`<div class="tip">${raw(icon('target', 18))}<p>Подбирай вес так, чтобы оставалось <b>2–3 повтора в запасе</b>. Разминочные подходы тоже записывай с отметкой «Разминка».</p></div>` : ''}
    ${!started && !edit ? html`<details class="card warmup"><summary>${raw(icon('hand', 20))}<span><b>Разминка запястий · 2 мин</b><small>Старый перелом — начинаем бережно</small></span>${raw(icon('down', 18))}</summary><ol>${WRIST_WARMUP.map((s) => html`<li>${s}</li>`)}</ol></details>` : ''}

    <div class="wcards">${w.ex.map((e, i) => card(w, e, i, ctxFor(e), hist, pairOf(w, i)))}</div>

    <button class="add-ex" data-act="add-ex">${raw(icon('plus', 20))} Добавить упражнение</button>
    ${w.note ? html`<div class="card note-card">${raw(icon('note', 18))}<p>${w.note}</p></div>` : ''}
    <div class="cta-spacer tall"></div>
    <div class="cta-dock dock-row">
      ${edit
        ? html`<button class="btn btn-secondary" data-act="delete-workout">${raw(icon('trash', 18))} Удалить</button><button class="btn btn-primary" data-act="back">Готово</button>`
        : html`<button class="btn btn-primary btn-xl" data-act="finish">${raw(icon('check', 22))} Завершить тренировку</button>`}
    </div>`.s;

  // Таймер длительности
  if (!edit) {
    const elT = root.querySelector('[data-elapsed]');
    const iv = setInterval(() => { elT.textContent = clock((Date.now() - new Date(w.start)) / 1000); }, 1000);
    ctx.cleanup(() => clearInterval(iv));
    keepAwake(ctx);
  }

  const save = () => { saveWorkout(w); if (edit) markUnsynced(w.id); };

  // Живой бейдж рекорда в редакторе подхода
  const updateLive = () => {
    const i = ui.open, e = w.ex[i];
    const badge = root.querySelector('.composer .pr-live');
    if (!badge || !e) return;
    const d = draftOf(i);
    badge.hidden = d.warm || !(d.r > 0) || !beatsAll(hist, w, e, d);
  };
  updateLive();

  ctx.cleanup(bindSteppers(root, () => draftOf(ui.open), (field, v) => {
    if (field === 'w') draftOf(ui.open).w = v; else draftOf(ui.open).r = Math.round(v);
    updateLive();
  }));

  ctx.cleanup(on(root, 'click', '[data-act]', async (ev, b) => {
    const act = b.dataset.act;
    const i = b.dataset.i != null ? +b.dataset.i : ui.open;
    const e = w.ex[i];
    switch (act) {
      case 'toggle':
        ui.open = ui.open === i ? -1 : i;
        ctx.refresh();
        break;
      case 'rir': {
        draftOf(i).rir = +b.dataset.v;
        b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        haptic.select();
        updateLive();
        break;
      }
      case 'warm': {
        // Разминка: предлагаем ~50% рабочего веса на 8 повторов; выключение возвращает к цели.
        const d = draftOf(i);
        if (d.warm) delete ui.drafts[i];
        else {
          const step = weightStep(e.id);
          ui.drafts[i] = { ...d, warm: true, w: Math.round((d.w * 0.5) / step) * step, r: 8 };
        }
        ctx.refresh();
        break;
      }
      case 'fill': {
        const d = draftOf(i);
        d.w = +b.dataset.w; d.r = +b.dataset.r;
        ctx.refresh();
        break;
      }
      case 'log': {
        const d = draftOf(i);
        if (!(d.r > 0)) { toast('Укажи количество повторов', 'bad'); haptic.error(); return; }
        const set = { w: repsOnly(e.id) ? 0 : Math.max(0, d.w), r: d.r, rir: d.warm ? null : d.rir, warm: !!d.warm, t: new Date().toISOString() };
        const pr = !set.warm && beatsAll(hist, w, e, set);
        e.sets.push(set);
        save();
        // После разминки следующий подход снова предзаполняется целью, после рабочего — повтором этого подхода.
        if (set.warm) delete ui.drafts[i]; else ui.drafts[i] = { ...set, warm: false };
        if (pr) { haptic.success(); toast(`Новый рекорд: ${setText(e.id, set)}!`, 'good'); } else haptic.medium();
        // Куда дальше: в суперсете — к партнёру, план пункта выполнен — к следующему упражнению.
        // Разминочный подход карточку не переключает (отдых 60 с).
        const move = set.warm
          ? { open: i, rest: 60, label: `${EXERCISES[e.id]?.short || ''}, подход ${workingSets(e).length + 1}` }
          : afterWorkingSet(w, i, profile.restDefault);
        const moved = move.open !== i;
        if (moved) ui.open = move.open;
        if (!edit && getProfile().autoRest) startRest(move.rest, move.label);
        ctx.refresh();
        if (moved) document.querySelector('.wcard.open')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      }
      case 'edit-set': editSet(ctx, w, i, +b.dataset.s, save); break;
      case 'rir-info': rirInfo(); break;
      case 'swap': swapSheet(ctx, w, i, save); break;
      case 'note-ex':
        ui.notes[i] = !ui.notes[i];
        ctx.refresh();
        break;
      case 'add-ex': addExerciseSheet(ctx, w, save); break;
      case 'menu': menuSheet(ctx, w, save, edit); break;
      case 'finish': finishSheet(ctx, w); break;
      case 'delete-workout':
        if (await confirmSheet({ title: 'Удалить тренировку?', text: 'Все подходы этой тренировки будут удалены без возможности восстановления.', ok: 'Удалить', danger: true })) {
          deleteWorkout(w.id);
          toast('Тренировка удалена');
          ctx.back();
        }
        break;
    }
  }));

  // Заметка к упражнению сохраняется по мере ввода
  ctx.cleanup(on(root, 'input', '[data-note]', (ev, t) => { w.ex[+t.dataset.note].note = t.value; save(); }));
}

/** Суперсет карточки для заголовка: { label: 'А1', first, partnerShort } или null. */
function pairOf(w, i) {
  const p = supersetPartner(w, i);
  return p && { label: p.label, first: p.first, partnerShort: EXERCISES[w.ex[p.j].id]?.short || '' };
}

function card(w, e, i, { item, target }, hist, pair) {
  const ex = EXERCISES[e.id] || { name: e.id };
  const ws = workingSets(e);
  const open = ui.open === i;
  const complete = ws.length >= item.sets;
  const best = bestSet(e, w.bw);
  const bestIsPR = best && isPR(hist, e.id, best, w.bw);
  let n = 0;
  return html`<article class="wcard ${open ? 'open' : ''} ${complete ? 'complete' : ''}" data-card="${i}">
    <header class="wcard-head tap" data-act="toggle" data-i="${i}">
      <span class="ex-num">${complete ? raw(icon('check', 16)) : i + 1}</span>
      <div class="wcard-title">
        <h3>${pair ? html`<span class="badge accent">${pair.label}</span> ` : ''}${ex.name}</h3>
        <p>${item.extra ? 'дополнительно · ' : ''}${item.sets} × ${item.reps[0]}–${item.reps[1]} · RIR ${item.rir[0]}–${item.rir[1]} · ${restHtml(item, pair, pair?.partnerShort, '')}${e.from ? html` · <span class="accent-text">вместо ${EXERCISES[e.from]?.short || e.from}</span>` : ''}</p>
      </div>
      <span class="wcard-count">${ws.length}/${item.sets}</span>
    </header>
    ${!open && e.sets.length ? html`<div class="set-chips">${e.sets.map((s) => html`<span class="chip ${s.warm ? 'muted' : ''}">${setText(e.id, s)}</span>`)}</div>` : ''}
    ${open ? html`<div class="wcard-body">
      <div class="wtools">
        <button class="tool" data-nav="#/ex/${e.id}">${raw(icon('cube', 18))} Техника · 3D</button>
        <button class="tool" data-act="swap" data-i="${i}">${raw(icon('swap', 18))} Замена</button>
        <button class="tool ${ui.notes[i] || e.note ? 'on' : ''}" data-act="note-ex" data-i="${i}">${raw(icon('note', 18))}</button>
        <i class="wrist-dot ${WRIST[ex.wrist]?.cls || ''}" title="${WRIST[ex.wrist]?.label || ''}"></i>
      </div>
      ${ui.notes[i] || e.note ? html`<textarea class="note-input" rows="2" placeholder="Заметка: сиденье на 4, ручка…" data-note="${i}">${e.note || ''}</textarea>` : ''}
      <div class="target-line ${target.mode}">
        <span class="target-label">${raw(icon(target.mode === 'increase' ? 'bolt' : 'target', 16))} Цель</span>
        <b>${targetLabel(target)}</b>
        <p>${target.note}</p>
      </div>
      ${target.last?.length ? html`<div class="last"><span>В прошлый раз</span>${target.last.map((s) => html`<button class="chip" data-act="fill" data-i="${i}" data-w="${s.w}" data-r="${s.r}">${setText(e.id, s)}${s.rir != null ? html`<small>@${s.rir}</small>` : ''}</button>`)}</div>` : ''}
      ${e.sets.length ? html`<ul class="sets">${e.sets.map((s, si) => html`<li><button class="set-row" data-act="edit-set" data-i="${i}" data-s="${si}">
        <span class="set-n ${s.warm ? 'warm' : ''}">${s.warm ? 'Р' : ++n}</span>
        <b>${setText(e.id, s)}</b>
        <span class="set-rir">${s.warm ? 'разминка' : s.rir != null ? `RIR ${s.rir === 4 ? '4+' : s.rir}` : ''}</span>
        ${!s.warm && bestIsPR && s === best ? html`<span class="badge pr">${raw(icon('trophy', 13))} PR</span>` : ''}
        ${raw(icon('edit', 16, 'set-edit'))}
      </button></li>`)}</ul>` : ''}
      ${composer(w, e, i, item)}
    </div>` : ''}
  </article>`;
}

function composer(w, e, i, item) {
  const d = ui.drafts[i];
  const ro = repsOnly(e.id);
  const nWork = workingSets(e).length;
  return html`<div class="composer">
    <div class="composer-head">
      <span>${d?.warm ? 'Разминочный подход' : nWork >= item.sets ? `Дополнительный подход ${nWork + 1}` : `Подход ${nWork + 1} из ${item.sets}`}</span>
      <span class="badge pr pr-live" hidden>${raw(icon('trophy', 13))} Рекорд!</span>
    </div>
    <div class="steppers ${ro ? 'one' : ''}">
      ${ro ? '' : stepper('w', d?.w ?? 0, { label: weightCaption(e.id), step: weightStep(e.id) })}
      ${stepper('r', d?.r ?? item.reps[0], { label: ro && e.id === 'plank' ? 'секунды' : 'повторы', step: 1, decimals: false })}
    </div>
    <div class="rir-row">
      <span class="rir-label">RIR <button class="info-btn" data-act="rir-info" aria-label="Что такое RIR">${raw(icon('info', 16))}</button></span>
      <div class="rir-chips">${RIR_OPTS.map(([v, l]) => html`<button class="${(d?.rir ?? 2) === v ? 'on' : ''}" data-act="rir" data-i="${i}" data-v="${v}">${l}</button>`)}</div>
    </div>
    <div class="composer-actions">
      <button class="toggle ${d?.warm ? 'on' : ''}" data-act="warm" data-i="${i}" aria-pressed="${!!d?.warm}">Разминка</button>
      <button class="btn btn-primary log-btn" data-act="log" data-i="${i}">${raw(icon('check', 22))} Записать</button>
    </div>
  </div>`;
}

/** Степперы: кнопки ± и ручной ввод. getDraft() — текущий черновик, set(field, value). */
function bindSteppers(container, getDraft, set) {
  const offClick = on(container, 'click', '[data-act="step"]', (e, b) => {
    const st = b.closest('.stepper');
    const field = st.dataset.field, step = +st.dataset.step;
    const d = getDraft();
    const cur = field === 'w' ? d.w : d.r;
    const v = Math.max(0, Math.round((cur + step * +b.dataset.d) * 100) / 100);
    set(field, v);
    const inp = st.querySelector('input');
    inp.value = String(v).replace('.', ',');
    inp.classList.toggle('long', inp.value.length > 3);
    inp.classList.remove('bump'); void inp.offsetWidth; inp.classList.add('bump'); // перезапуск анимации
    haptic.select();
  });
  const offInput = on(container, 'input', '[data-input]', (e, inp) => {
    inp.classList.toggle('long', inp.value.length > 3);
    set(inp.dataset.input, Math.max(0, parseNum(inp.value)));
  });
  const offFocus = on(container, 'focusin', '[data-input]', (e, inp) => inp.select());
  return () => { offClick(); offInput(); offFocus(); };
}

function editSet(ctx, w, i, si, save) {
  const e = w.ex[i];
  const s = e.sets[si];
  const d = { ...s, rir: s.rir ?? 2 };
  const ro = repsOnly(e.id);
  openSheet({
    title: `${EXERCISES[e.id]?.short || e.id} · подход`,
    body: html`<div class="steppers ${ro ? 'one' : ''}">
        ${ro ? '' : stepper('w', d.w, { label: weightCaption(e.id), step: weightStep(e.id) })}
        ${stepper('r', d.r, { label: 'повторы', step: 1, decimals: false })}
      </div>
      <div class="rir-row"><span class="rir-label">RIR</span>
        <div class="rir-chips">${RIR_OPTS.map(([v, l]) => html`<button class="${d.rir === v ? 'on' : ''}" data-rir="${v}">${l}</button>`)}</div></div>
      <label class="switch-row"><span>Разминочный подход</span><input type="checkbox" class="switch" data-warm ${d.warm ? 'checked' : ''}></label>
      <div class="btn-row">
        <button class="btn btn-secondary danger-text" data-del>${raw(icon('trash', 18))} Удалить</button>
        <button class="btn btn-primary" data-save>Сохранить</button>
      </div>`,
    onMount(el, close) {
      bindSteppers(el, () => d, (f, v) => { if (f === 'w') d.w = v; else d.r = Math.round(v); });
      on(el, 'click', '[data-rir]', (ev, b) => { d.rir = +b.dataset.rir; el.querySelectorAll('[data-rir]').forEach((x) => x.classList.toggle('on', x === b)); });
      el.querySelector('[data-warm]').onchange = (ev) => { d.warm = ev.target.checked; };
      el.querySelector('[data-save]').onclick = () => {
        if (!(d.r > 0)) { toast('Укажи количество повторов', 'bad'); return; }
        e.sets[si] = { ...s, w: ro ? 0 : d.w, r: d.r, rir: d.warm ? null : d.rir, warm: d.warm };
        save(); close(); ctx.refresh();
      };
      el.querySelector('[data-del]').onclick = () => {
        e.sets.splice(si, 1);
        save(); close(); toast('Подход удалён'); ctx.refresh();
      };
    },
  });
}

function swapSheet(ctx, w, i, save) {
  const e = w.ex[i];
  const base = e.from || e.id;
  const prefs = getPrefs();
  const options = [base, ...(EXERCISES[base]?.alternatives || [])].filter((id) => id !== e.id && EXERCISES[id]);
  openSheet({
    title: 'Заменить упражнение',
    body: html`<p class="sheet-text">${e.sets.length ? 'Записанные подходы останутся, новое упражнение добавится следом.' : 'Если тренажёр занят или кисть просит пощады.'}</p>
      <div class="pick-list">${options.map((id) => {
        const ex = EXERCISES[id];
        const avail = exerciseAvailable(id, prefs);
        return html`<button class="pick" data-id="${id}">
          <b>${ex.name}${id === base ? html` <span class="badge">по плану</span>` : ''}</b>
          <span><i class="wrist-dot ${WRIST[ex.wrist].cls}"></i> запястье: ${WRIST[ex.wrist].short}${avail ? '' : ' · нет оборудования'}</span>
        </button>`;
      })}</div>
      ${options.length ? '' : html`<p class="muted">Нет альтернатив для этого упражнения.</p>`}
      <label class="switch-row"><span>Запомнить замену для плана</span><input type="checkbox" class="switch" data-remember></label>`,
    onMount(el, close) {
      on(el, 'click', '[data-id]', (ev, b) => {
        const alt = b.dataset.id;
        if (e.sets.length) {
          w.ex.splice(i + 1, 0, { id: alt, from: alt === base ? null : base, note: '', sets: [] }); // from — упражнение по плану
          ui.open = i + 1;
        } else {
          e.id = alt;
          e.from = alt === base ? null : base;
        }
        delete ui.drafts[i]; delete ui.drafts[i + 1];
        if (el.querySelector('[data-remember]').checked) {
          const swaps = { ...prefs.swaps };
          if (alt === base) delete swaps[base]; else swaps[base] = alt;
          updatePrefs({ swaps });
        }
        save(); close(); haptic.medium(); ctx.refresh();
      });
    },
  });
}

function addExerciseSheet(ctx, w, save) {
  const list = Object.values(EXERCISES);
  const rowsHtml = (q) => list.filter((ex) => !q || ex.name.toLowerCase().includes(q))
    .map((ex) => html`<button class="pick" data-id="${ex.id}"><b>${ex.name}</b><span><i class="wrist-dot ${WRIST[ex.wrist].cls}"></i> ${ex.primary.map((m) => MUSCLES[m]?.name).join(', ')}</span></button>`);
  openSheet({
    title: 'Добавить упражнение',
    cls: 'tall',
    body: html`<label class="search"><span>${raw(icon('search', 18))}</span><input type="search" placeholder="Поиск" data-q></label><div class="pick-list" data-list>${rowsHtml('')}</div>`,
    onMount(el, close) {
      const listEl = el.querySelector('[data-list]');
      el.querySelector('[data-q]').oninput = (ev) => { listEl.innerHTML = html`${rowsHtml(ev.target.value.trim().toLowerCase())}`.s; };
      on(el, 'click', '[data-id]', (ev, b) => {
        w.ex.push({ id: b.dataset.id, from: null, note: '', sets: [] });
        ui.open = w.ex.length - 1;
        save(); close(); ctx.refresh();
      });
    },
  });
}

function menuSheet(ctx, w, save, edit) {
  openSheet({
    title: 'Тренировка',
    body: html`<label class="field"><span>Заметка к тренировке</span><textarea rows="3" data-wnote placeholder="Самочувствие, сон, что болело…">${w.note || ''}</textarea></label>
      <div class="menu-list">
        <button class="menu-item" data-x="rir">${raw(icon('info', 20))} Что такое RIR</button>
        ${edit ? '' : html`<button class="menu-item danger-text" data-x="cancel">${raw(icon('trash', 20))} Отменить тренировку</button>`}
      </div>`,
    onMount(el, close) {
      el.querySelector('[data-wnote]').oninput = (ev) => { w.note = ev.target.value; save(); };
      on(el, 'click', '[data-x]', async (ev, b) => {
        if (b.dataset.x === 'rir') { close(); rirInfo(); }
        if (b.dataset.x === 'cancel') {
          close();
          if (await confirmSheet({ title: 'Отменить тренировку?', text: 'Записанные подходы будут удалены, круг тренировок не сдвинется.', ok: 'Отменить тренировку', cancel: 'Продолжить', danger: true })) {
            deleteWorkout(w.id);
            stopRest();
            setClosingConfirmation(false);
            ctx.nav('#/today', { replace: true });
          }
        }
      });
    },
    onClose: () => ctx.refresh(),
  });
}

function rirInfo() {
  openSheet({
    title: 'RIR — повторы в запасе',
    body: html`<p class="sheet-text">${PROGRAM.rules.rir}</p>
      <ul class="rir-explain">
        <li><b>0</b> отказ: следующий повтор не получится</li>
        <li><b>1</b> мог сделать ещё один</li>
        <li><b>2</b> ещё два — рабочая зона для базовых</li>
        <li><b>3</b> ещё три — неделя знакомства</li>
        <li><b>4+</b> легко, такой подход не считается тяжёлым</li>
      </ul>`,
  });
}

const FEEL = [[1, 'Тяжко'], [2, 'Так себе'], [3, 'Норм'], [4, 'Хорошо'], [5, 'Огонь']];

function finishSheet(ctx, w) {
  const sets = w.ex.reduce((a, e) => a + workingSets(e).length, 0);
  let feel = w.feel || 4;
  openSheet({
    title: 'Завершить тренировку',
    body: html`${sets ? '' : html`<p class="tip warn">${raw(icon('alert', 18))} Пока не записано ни одного рабочего подхода.</p>`}
      <p class="field-label">Как прошла тренировка?</p>
      ${segmented('feel', FEEL.map(([v, l]) => [v, raw(`<b>${v}</b><small>${l}</small>`)]), feel, 'feel-seg')}
      <label class="field"><span>Заметка</span><textarea rows="3" data-note-final placeholder="Что получилось, что нет…">${w.note || ''}</textarea></label>
      <div class="btn-row">
        <button class="btn btn-secondary" data-close>Ещё не всё</button>
        <button class="btn btn-primary" data-done>${raw(icon('check', 20))} Завершить</button>
      </div>`,
    onMount(el, close) {
      on(el, 'click', '[data-act="seg"]', (ev, b) => {
        feel = +b.dataset.v;
        el.querySelectorAll('[data-act="seg"]').forEach((x) => x.classList.toggle('on', x === b));
        haptic.select();
      });
      el.querySelector('[data-done]').onclick = () => {
        w.feel = feel;
        w.note = el.querySelector('[data-note-final]').value.trim();
        w.end = new Date().toISOString();
        saveWorkout(w);
        markUnsynced(w.id);
        // Следующая — после этой тренировки, и для старой тоже: после «Верх A/B» — «Низ», после «Низ A/B» — «Руки и плечи».
        const after = nextIdxAfter(w.session) ?? currentNextIdx(getState(), finishedWorkouts()) + 1;
        updateState({ activeWorkoutId: null, ...nextIdxPatch(after) });
        const ci = calibInfo(getProfile(), finishedWorkouts());
        if (!getProfile().calibrationDone && ci.count >= ci.total) updateProfile({ calibrationDone: true });
        stopRest();
        setClosingConfirmation(false);
        haptic.success();
        close();
        ui = { wid: null, open: 0, drafts: {}, notes: {} };
        ctx.nav(`#/summary/${w.id}`, { replace: true });
      };
    },
  });
}

/** Не даём экрану погаснуть во время тренировки (Screen Wake Lock API, если есть). */
function keepAwake(ctx) {
  if (!('wakeLock' in navigator)) return;
  let lock = null, alive = true;
  const acquire = async () => {
    try { if (alive && document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen'); } catch { /* отказ браузера */ }
  };
  const onVis = () => { if (document.visibilityState === 'visible') acquire(); };
  acquire();
  document.addEventListener('visibilitychange', onVis);
  ctx.cleanup(() => { alive = false; document.removeEventListener('visibilitychange', onVis); lock?.release().catch(() => {}); });
}
