// Экран «Сегодня»: следующая тренировка по кругу, цели, неделя, неделя знакомства и кнопка «Пришёл в зал».
import { EXERCISES } from '../data/exercises.js';
import { PROGRAM } from '../data/program.js';
import { attendance, weekStart, deloadAdvice } from '../analytics.js';
import { getProfile, getState, getPrefs, finishedWorkouts, activeWorkout, updateState, updateProfile, saveWorkout, newWorkoutId } from '../storage.js';
import { setClosingConfirmation, haptic } from '../telegram.js';
import { html, raw, on, dayLong, clock, isoDay, plural, WEEKDAYS, restLabel } from './dom.js';
import { icon } from './icons.js';
import { pageHeader, openSheet, confirmSheet } from './components.js';
import { sessionTargets, calibInfo, nextSession, targetLabel, WRIST } from './model.js';

const DAY = 86400000;

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
}

function weekStrip(finished) {
  const ws = weekStart(Date.now());
  const days = new Set(finished.map((w) => isoDay(w.start)));
  const todayKey = isoDay(Date.now());
  const att = attendance(finished);
  return html`<section class="card week">
    <div class="week-days">
      ${WEEKDAYS.map((d, i) => {
        const t = ws + i * DAY + 2 * 3600000;
        const key = isoDay(t);
        const cls = [days.has(key) ? 'done' : '', key === todayKey ? 'today' : '', t > Date.now() ? 'future' : ''].join(' ');
        return html`<div class="wd ${cls}"><span>${d}</span><b>${days.has(key) ? raw(icon('check', 16)) : new Date(t).getDate()}</b></div>`;
      })}
    </div>
    <div class="week-meta">
      <span><b>${att.thisWeek}</b> из 3 на этой неделе</span>
      <span class="streak">${raw(icon('flame', 16))} серия ${att.streakWeeks} ${plural(att.streakWeeks, ['неделя', 'недели', 'недель'])}</span>
    </div>
  </section>`;
}

function calibBanner(ci) {
  if (ci.done) return '';
  const pct = (ci.count / ci.total) * 100;
  return html`<section class="card calib">
    <div class="calib-top">
      <div class="calib-ic">${raw(icon('target', 22))}</div>
      <div><h3>${PROGRAM.calibration.title}</h3><p>Тренировка ${Math.min(ci.count + 1, ci.total)} из ${ci.total}: подбираем рабочие веса</p></div>
      <b class="calib-count">${ci.count}/${ci.total}</b>
    </div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <details class="calib-how">
      <summary>Как проходить неделю знакомства ${raw(icon('down', 16))}</summary>
      <ol>${PROGRAM.calibration.howTo.map((s) => html`<li>${s}</li>`)}</ol>
      <button class="link-btn" data-act="skip-calib">Я уже знаю свои веса — пропустить</button>
    </details>
  </section>`;
}

function activeCard(w) {
  const s = PROGRAM.sessions[w.session];
  const sets = w.ex.reduce((a, e) => a + e.sets.filter((x) => !x.warm).length, 0);
  return html`<section class="card resume tap" data-nav="#/workout">
    <span class="pulse-dot"></span>
    <div><p class="kicker">Тренировка идёт</p><h3>${s?.name || 'Тренировка'} · <span data-elapsed>${clock((Date.now() - new Date(w.start)) / 1000)}</span></h3>
    <p class="muted">${sets} ${plural(sets, ['подход', 'подхода', 'подходов'])} записано</p></div>
    ${raw(icon('right', 22))}
  </section>`;
}

export function render(ctx) {
  const { root } = ctx;
  const profile = getProfile(), state = getState(), prefs = getPrefs();
  const finished = finishedWorkouts();
  const active = activeWorkout();
  const session = nextSession(state);
  const rows = sessionTargets(finished, session, prefs);
  const ci = calibInfo(profile, finished);
  const totalSets = rows.reduce((a, r) => a + r.item.sets, 0);
  const estMin = Math.round(rows.reduce((a, r) => a + r.item.sets * (r.item.rest + 45), 0) / 60 + 10);
  const deload = deloadAdvice(finished);
  const order = PROGRAM.rotation.map((id, i) => ({ id, i, s: PROGRAM.sessions[id] }));

  root.innerHTML = html`
    ${pageHeader(greeting(), { kicker: dayLong(Date.now()) })}
    ${active ? activeCard(active) : ''}
    ${weekStrip(finished)}
    ${calibBanner(ci)}
    ${deload ? html`<section class="card alert">${raw(icon('alert', 20))}<div><b>Пора разгрузиться</b><p>${deload.text}</p></div></section>` : ''}

    <section class="next-block">
      <div class="next-head">
        <div>
          <p class="kicker">Следующая по кругу</p>
          <h2 class="display">${session.name}</h2>
          <p class="muted">${session.focus}</p>
        </div>
        <button class="chip-btn" data-act="pick-session">${raw(icon('swap', 16))} Другая</button>
      </div>
      <div class="next-stats">
        <div><b>${rows.length}</b><span>упражнений</span></div>
        <div><b>${totalSets}</b><span>подходов</span></div>
        <div><b>~${estMin}</b><span>минут</span></div>
      </div>
      <ol class="ex-list">
        ${rows.map(({ item, target }, i) => {
          const ex = EXERCISES[item.exId];
          return html`<li class="ex-row tap" data-nav="#/ex/${item.exId}">
            <span class="ex-num">${i + 1}</span>
            <div class="ex-main">
              <div class="ex-name">${ex?.name || item.exId}${item.reason ? html` <span class="badge ${item.reason === 'equip' ? 'warn' : 'info'}">замена</span>` : ''}</div>
              <div class="ex-sub">${item.sets} × ${item.reps[0]}–${item.reps[1]} · RIR ${item.rir[0]}–${item.rir[1]} · отдых ${restLabel(item.rest)}</div>
              <div class="ex-target ${target.mode}">${raw(icon(target.mode === 'increase' ? 'bolt' : 'target', 14))} ${targetLabel(target)}</div>
            </div>
            <i class="wrist-dot ${WRIST[ex?.wrist]?.cls || ''}" title="${WRIST[ex?.wrist]?.label || ''}"></i>
          </li>`;
        })}
      </ol>
      <div class="rotation">
        ${order.map(({ s, i }) => html`<span class="rot ${i === state.nextIdx % 4 ? 'on' : ''}">${s.name}</span>${i < 3 ? raw(icon('right', 14)) : ''}`)}
      </div>
    </section>
    <div class="cta-spacer"></div>
    <div class="cta-dock">
      ${active
        ? html`<button class="btn btn-primary btn-xl" data-nav="#/workout">${raw(icon('play', 20))} Продолжить тренировку</button>`
        : html`<button class="btn btn-primary btn-xl" data-act="checkin">${raw(icon('bolt', 22))}<span>Пришёл в зал<small>начать «${session.name}»</small></span></button>`}
    </div>`.s;

  // Тикающий таймер на карточке активной тренировки
  if (active) {
    const elT = root.querySelector('[data-elapsed]');
    const iv = setInterval(() => { elT.textContent = clock((Date.now() - new Date(active.start)) / 1000); }, 1000);
    ctx.cleanup(() => clearInterval(iv));
  }

  ctx.cleanup(on(root, 'click', '[data-act]', async (e, b) => {
    const act = b.dataset.act;
    if (act === 'checkin') checkIn(ctx, session, rows, ci);
    if (act === 'pick-session') pickSession(ctx);
    if (act === 'skip-calib') {
      if (await confirmSheet({ title: 'Пропустить неделю знакомства?', text: 'Цели будут считаться от весов, которые ты запишешь на первых тренировках. Если веса ещё не известны, лучше пройти знакомство.', ok: 'Пропустить' })) {
        updateProfile({ calibrationDone: true });
        ctx.refresh();
      }
    }
  }));
}

/** «Пришёл в зал»: создаём тренировку с временем прихода и списком упражнений (с учётом замен). */
function checkIn(ctx, session, rows, ci) {
  const profile = getProfile();
  const start = new Date();
  const w = {
    id: newWorkoutId(start),
    session: session.id,
    calib: !ci.done,
    start: start.toISOString(),
    end: null,
    bw: profile.bodyweight ?? null,
    feel: null,
    note: '',
    ex: rows.map(({ item }) => ({ id: item.exId, from: item.exId !== item.baseId ? item.baseId : null, note: '', sets: [] })),
  };
  saveWorkout(w);
  updateState({ activeWorkoutId: w.id });
  if (!profile.startDate) updateProfile({ startDate: start.toISOString().slice(0, 10) });
  setClosingConfirmation(true);
  haptic.success();
  ctx.nav('#/workout');
}

function pickSession(ctx) {
  const state = getState();
  openSheet({
    title: 'Какую тренировку делаем?',
    body: html`<p class="sheet-text">Круг продолжится со следующей после выбранной.</p>
      <div class="pick-list">${PROGRAM.rotation.map((id, i) => {
        const s = PROGRAM.sessions[id];
        return html`<button class="pick ${i === state.nextIdx % 4 ? 'on' : ''}" data-i="${i}"><b>${s.name}</b><span>${s.focus}</span></button>`;
      })}</div>`,
    onMount(el, close) {
      on(el, 'click', '[data-i]', (e, b) => { updateState({ nextIdx: +b.dataset.i }); close(); ctx.refresh(); });
    },
  });
}
