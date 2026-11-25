// Итог тренировки: длительность, тоннаж, тяжёлые подходы, рекорды, лучшие подходы и отправка в бота.
import { EXERCISES } from '../data/exercises.js';
import { PROGRAM } from '../data/program.js';
import { workoutSummary } from '../analytics.js';
import { getWorkout, finishedWorkouts, getProfile, MODE } from '../storage.js';
import { canSendToBot } from '../telegram.js';
import { html, raw, on, minutes, tonnage, dayLong, plural, num } from './dom.js';
import { icon } from './icons.js';
import { emptyState } from './components.js';
import { bestSet, repsOnly, repsUnit, weightLabel, calibInfo } from './model.js';
import { sendUnsynced, sendHint } from './profile.js';

export const NAME = 'summary';

export function render(ctx) {
  const { root } = ctx;
  const w = getWorkout(ctx.params[0]);
  if (!w) { root.innerHTML = emptyState('today', 'Тренировка не найдена', '', html`<button class="btn btn-primary" data-nav="#/today">На главную</button>`).s; return; }
  const all = finishedWorkouts();
  const sum = workoutSummary(all, w);
  const ci = calibInfo(getProfile(), all);
  const prIds = new Set(sum.prs.map((p) => p.exId));
  const canSend = MODE === 'real' && canSendToBot();

  root.innerHTML = html`
    <section class="hero-done">
      <div class="done-badge">${raw(icon('check', 40))}</div>
      <p class="kicker">${dayLong(w.start)}</p>
      <h1 class="display">${PROGRAM.sessions[w.session]?.name || 'Тренировка'} — готово!</h1>
      <p class="muted">${w.feel ? `Самочувствие ${w.feel}/5` : ''}${w.calib ? ' · неделя знакомства' : ''}</p>
    </section>

    <section class="kpis">
      <div class="kpi"><span>${raw(icon('clock', 18))} Время</span><b>${minutes(sum.duration)}</b></div>
      <div class="kpi"><span>${raw(icon('weight', 18))} Тоннаж</span><b>${tonnage(sum.volume)}</b></div>
      <div class="kpi"><span>${raw(icon('flame', 18))} Тяжёлых подходов</span><b>${sum.hardSets}</b></div>
      <div class="kpi ${sum.prs.length ? 'hot' : ''}"><span>${raw(icon('trophy', 18))} Рекордов</span><b>${sum.prs.length}</b></div>
    </section>

    ${w.calib && !ci.done ? html`<section class="card calib"><div class="calib-top"><div class="calib-ic">${raw(icon('target', 22))}</div><div><h3>Неделя знакомства: ${ci.count}/${ci.total}</h3><p>Ещё ${ci.total - ci.count} ${plural(ci.total - ci.count, ['тренировка', 'тренировки', 'тренировок'])}, и приложение рассчитает рабочие веса.</p></div></div><div class="bar"><i style="width:${(ci.count / ci.total) * 100}%"></i></div></section>` : ''}
    ${w.calib && ci.done ? html`<section class="card calib"><div class="calib-top"><div class="calib-ic">${raw(icon('sparkle', 22))}</div><div><h3>Знакомство пройдено!</h3><p>Рабочие веса рассчитаны — смотри цели на экране «Сегодня».</p></div></div></section>` : ''}

    ${sum.prs.length ? html`<section class="section"><h3 class="section-title">${raw(icon('trophy', 18))} Новые рекорды</h3>
      <div class="pr-list">${sum.prs.map((p) => html`<div class="pr-card"><b>${EXERCISES[p.exId]?.name || p.exId}</b><span>${repsOnly(p.exId) ? `${p.r} ${repsUnit(p.exId)}` : `${weightLabel(p.exId, p.w)} × ${p.r}`}</span><small>оценка 1ПМ ${num(p.score)} кг</small></div>`)}</div></section>` : ''}

    <section class="section"><h3 class="section-title">Лучшие подходы</h3>
      <div class="card list">${w.ex.filter((e) => e.sets.some((s) => !s.warm)).map((e) => {
        const b = bestSet(e, w.bw);
        const n = e.sets.filter((s) => !s.warm).length;
        return html`<div class="list-row tap" data-nav="#/ex/${e.id}"><div><b>${EXERCISES[e.id]?.name || e.id}</b><span>${n} ${plural(n, ['подход', 'подхода', 'подходов'])}</span></div>
          <div class="list-right">${prIds.has(e.id) ? html`<span class="badge pr">PR</span>` : ''}<b>${b ? (repsOnly(e.id) ? `${b.r} ${repsUnit(e.id)}` : `${weightLabel(e.id, b.w)} × ${b.r}`) : '—'}</b></div></div>`;
      })}</div>
    </section>

    <section class="card send">
      <div class="send-top">${raw(icon('send', 22))}<div><h3>Отправить тренеру в бот</h3><p>${canSend ? 'Бот проанализирует тренировку и даст советы. Приложение закроется после отправки.' : MODE === 'demo' ? 'В демо-режиме отправка выключена.' : sendHint()}</p></div></div>
      ${canSend ? html`<button class="btn btn-primary" data-act="send">${raw(icon('send', 20))} Отправить в бот</button>` : ''}
    </section>
    <div class="cta-spacer"></div>
    <div class="cta-dock"><button class="btn btn-secondary btn-xl" data-nav="#/today">Готово</button></div>`.s;

  ctx.cleanup(on(root, 'click', '[data-act="send"]', () => sendUnsynced()));
}
