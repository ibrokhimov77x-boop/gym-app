// Страница упражнения: 3D-объяснялка, мышцы, запястье, техника, альтернативы, моя история.
import { EXERCISES, MUSCLES } from '../data/exercises.js';
import { exerciseHistory, progressRate } from '../analytics.js';
import { finishedWorkouts } from '../storage.js';
import { lineChart, chartWidth } from '../charts.js';
import { html, raw, on, num, dayShort, plural } from './dom.js';
import { icon } from './icons.js';
import { subHeader, segmented, emptyState } from './components.js';
import { WRIST, programUsage, repsOnly, repsUnit, weightLabel } from './model.js';
import { mount3D, playIcon } from './viewer3d.js';

export const NAME = 'exercise';

const PHASES = { eccentric: 'Опускание', bottom: 'Пауза внизу', concentric: 'Усилие', top: 'Пауза вверху' };
const LOAD = { barbell: 'Штанга', dumbbell: 'Гантели', machine: 'Тренажёр', cable: 'Блок', bodyweight: 'Свой вес', smith: 'Смит' };
let speed = 1, view = 'threeQuarter';

function historyBlock(id) {
  const h = exerciseHistory(finishedWorkouts(), id);
  if (!h.length) return emptyState('progress', 'Ещё нет записей', 'Сделай упражнение на тренировке — здесь появится график силы и лучшие подходы.');
  const ro = repsOnly(id);
  const best = h.reduce((a, x) => (x.best > a.best ? x : a), h[0]);
  const rate = progressRate(h);
  const fmtSet = (s) => (ro ? `${s.r} ${repsUnit(id)}` : `${weightLabel(id, s.w)} × ${s.r}`);
  return html`<div class="kpis three">
      <div class="kpi"><span>${ro ? 'Лучший результат' : 'Оценка 1ПМ'}</span><b>${ro ? `${best.best}` : `${num(best.best)} кг`}</b></div>
      <div class="kpi"><span>Лучший подход</span><b class="sm">${best.top ? fmtSet(best.top) : '—'}</b></div>
      <div class="kpi ${rate && rate.pctWeek > 0 ? 'good' : ''}"><span>Темп в неделю</span><b class="sm">${rate ? `${rate.pctWeek > 0 ? '+' : ''}${num(rate.pctWeek)}%` : 'мало данных'}</b></div>
    </div>
    <div class="card chart-card"><div class="chart-head"><b>${ro ? 'Повторы' : 'Оценка 1ПМ'}</b><span>${h.length} ${plural(h.length, ['тренировка', 'тренировки', 'тренировок'])} · пунктир — тренд</span></div><div data-chart></div></div>
    <div class="card list">${h.slice(-5).reverse().map((x) => html`<div class="list-row"><div><b>${dayShort(x.t)}</b><span>${x.calib ? 'знакомство · ' : ''}${x.sets.map(fmtSet).join(', ')}</span></div><div class="list-right"><b>${ro ? x.best : num(x.best)}</b></div></div>`)}</div>`;
}

export function render(ctx) {
  const { root } = ctx;
  const id = ctx.params[0];
  const ex = EXERCISES[id];
  if (!ex) { root.innerHTML = html`${subHeader('Упражнение')}${emptyState('search', 'Упражнение не найдено', '')}`.s; return; }
  const w = WRIST[ex.wrist];
  const t = ex.technique || {};
  const used = programUsage(id);

  root.innerHTML = html`
    ${subHeader(ex.short || ex.name, { sub: LOAD[ex.load] || '' })}
    <section class="stage-wrap">
      <div class="stage" data-stage></div>
      <div class="stage-ui">
        <span class="phase" data-phase hidden></span>
        <div class="stage-bottom">
          <button class="round-btn" data-act="play" aria-label="Пауза">${raw(playIcon(true))}</button>
          ${segmented('speed', [[0.5, '0.5×'], [1, '1×']], speed, 'seg-glass')}
          ${segmented('view', [['front', 'Спереди'], ['side', 'Сбоку'], ['threeQuarter', '¾']], view, 'seg-glass')}
        </div>
      </div>
    </section>

    <h1 class="ex-title">${ex.name}</h1>
    ${used.length ? html`<p class="muted">В программе: ${used.join(', ')}</p>` : ''}
    <div class="muscles">
      ${ex.primary.map((m) => html`<span class="mchip primary">${MUSCLES[m]?.name}</span>`)}
      ${ex.secondary.map((m) => html`<span class="mchip secondary">${MUSCLES[m]?.name}</span>`)}
    </div>

    <section class="wrist-block ${w.cls}">
      <div class="wrist-head">${raw(icon('hand', 22))}<b>${w.label}</b></div>
      <p>${ex.wristNote}</p>
    </section>

    <section class="section tech">
      <h3 class="section-title">Подготовка</h3><ol class="steps">${(t.setup || []).map((s) => html`<li>${s}</li>`)}</ol>
      <h3 class="section-title">Выполнение</h3><ol class="steps">${(t.execution || []).map((s) => html`<li>${s}</li>`)}</ol>
      ${t.breathing ? html`<h3 class="section-title">Дыхание</h3><p class="card pad breath">${t.breathing}</p>` : ''}
      ${t.mistakes?.length ? html`<h3 class="section-title">Частые ошибки</h3><ul class="mistakes">${t.mistakes.map((s) => html`<li>${raw(icon('x', 16))}<span>${s}</span></li>`)}</ul>` : ''}
      ${t.cues?.length ? html`<h3 class="section-title">Подсказки себе</h3><div class="cues">${t.cues.map((s) => html`<span>«${s}»</span>`)}</div>` : ''}
    </section>

    ${ex.alternatives?.length ? html`<section class="section"><h3 class="section-title">${raw(icon('swap', 18))} Альтернативы</h3>
      <div class="card list">${ex.alternatives.filter((a) => EXERCISES[a]).map((a) => html`<a class="list-row tap" data-nav="#/ex/${a}"><div><b>${EXERCISES[a].name}</b><span>запястье: ${WRIST[EXERCISES[a].wrist].short}</span></div><div class="list-right"><i class="wrist-dot ${WRIST[EXERCISES[a].wrist].cls}"></i>${raw(icon('right', 18, 'muted'))}</div></a>`)}</div></section>` : ''}

    <section class="section"><h3 class="section-title">${raw(icon('progress', 18))} Моя история</h3>${historyBlock(id)}</section>`.s;

  // График истории
  const slot = root.querySelector('[data-chart]');
  if (slot) {
    const h = exerciseHistory(finishedWorkouts(), id);
    slot.appendChild(lineChart(h.map((x) => ({ x: x.t, y: x.best, muted: x.calib, label: `${dayShort(x.t)} · ${x.top ? (repsOnly(id) ? `${x.top.r} ${repsUnit(id)}` : `${num(x.top.w)}×${x.top.r}`) : ''}` })),
      { unit: repsOnly(id) ? repsUnit(id) : 'кг', width: chartWidth(slot) }));
  }

  // 3D
  const stage = root.querySelector('[data-stage]');
  const phaseEl = root.querySelector('[data-phase]');
  const v = mount3D(stage, async (ex3) => {
    await ex3.load(id);
    ex3.setSpeed(speed);
    ex3.setView(view);
    ex3.onPhase?.(({ phase }) => { phaseEl.hidden = false; phaseEl.textContent = PHASES[phase] || ''; phaseEl.dataset.phase = phase; });
  });
  ctx.cleanup(() => v.dispose());

  ctx.cleanup(on(root, 'click', '[data-act]', (e, b) => {
    const ex3 = v.ex;
    if (b.dataset.act === 'play' && ex3) {
      if (ex3.isPlaying()) ex3.pause(); else ex3.play();
      b.innerHTML = playIcon(ex3.isPlaying());
      b.setAttribute('aria-label', ex3.isPlaying() ? 'Пауза' : 'Играть');
    }
    if (b.dataset.act === 'seg') {
      b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      if (b.dataset.name === 'speed') { speed = +b.dataset.v; ex3?.setSpeed(speed); }
      if (b.dataset.name === 'view') { view = b.dataset.v; ex3?.setView(view); }
    }
  }));
}
