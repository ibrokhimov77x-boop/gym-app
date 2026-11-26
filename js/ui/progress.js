// Экран «Прогресс» — мониторинг: KPI, эффективность упражнений, карта мышц, графики, посещаемость, рекорды, застои, история.
import { EXERCISES, MUSCLES, MUSCLE_GROUPS } from '../data/exercises.js';
import { PROGRAM } from '../data/program.js';
import {
  attendance, effectiveness, muscleHeat, muscleVolume, muscleProgress, VOLUME_TARGETS, exerciseHistory, progressRate,
  prs, stalls, deloadAdvice, weekStart, duration, workoutSummary, setVolume, workingSets,
} from '../analytics.js';
import { finishedWorkouts } from '../storage.js';
import { lineChart, barChart, calendarHeatmap, chartWidth } from '../charts.js';
import { html, raw, on, num, tonnage, minutes, dayShort, hourLabel, isoDay, plural } from './dom.js';
import { icon } from './icons.js';
import { pageHeader, segmented, emptyState, openSheet } from './components.js';
import { repsOnly, repsUnit, weightLabel } from './model.js';
import { mount3D } from './viewer3d.js';

export const NAME = 'progress';
const DAY = 86400000;
let heatMode = 'progress';
let chartEx = null;
let historyLimit = 8;

const weekVolume = (ws, from, to) => ws.filter((w) => { const t = new Date(w.start).getTime(); return t >= from && t < to; })
  .reduce((a, w) => a + w.ex.reduce((b, e) => b + workingSets(e).reduce((c, s) => c + setVolume(e.id, s), 0), 0), 0);

function kpis(ws, att) {
  // Скользящие 7 дней: сравнение с прошлыми 7 днями честнее, чем неполная календарная неделя.
  const now = Date.now();
  const vol = weekVolume(ws, now - 7 * DAY, now + 1);
  const prev = weekVolume(ws, now - 14 * DAY, now - 7 * DAY);
  const delta = prev ? Math.round(((vol - prev) / prev) * 100) : null;
  return html`<section class="kpis">
    <div class="kpi"><span>${raw(icon('calendar', 18))} Тренировок</span><b>${att.total}</b><small>с ${ws.length ? dayShort(ws[0].start) : '—'}</small></div>
    <div class="kpi ${att.thisWeek >= 3 ? 'good' : ''}"><span>${raw(icon('flame', 18))} Эта неделя</span><b>${att.thisWeek}<i>/3</i></b><small>серия ${att.streakWeeks} нед.</small></div>
    <div class="kpi"><span>${raw(icon('clock', 18))} Длительность</span><b>${att.avgDuration ?? '—'}<i> мин</i></b><small>приход ~${hourLabel(att.avgHour)}</small></div>
    <div class="kpi"><span>${raw(icon('weight', 18))} Тоннаж за 7 дней</span><b>${tonnage(vol)}</b><small>${delta == null ? 'нет данных для сравнения' : `${delta >= 0 ? '+' : ''}${delta}% к прошлым 7 дням`}</small></div>
  </section>`;
}

function effectivenessCard(ws) {
  const eff = effectiveness(ws);
  const ready = eff.filter((r) => r.ready).slice(0, 8);
  const waiting = eff.filter((r) => !r.ready);
  const max = Math.max(...ready.map((r) => Math.abs(r.pctWeek)), 0.5);
  return html`<section class="section">
    <h3 class="section-title">${raw(icon('sparkle', 18))} Самые эффективные упражнения для тебя <button class="info-btn" data-act="eff-info" aria-label="Как считается">${raw(icon('info', 16))}</button></h3>
    <div class="card pad">
      ${ready.length ? html`<p class="section-sub">Рост оценки силы (1ПМ) в неделю по линии тренда. Чем выше и стабильнее — тем лучше упражнение работает именно у тебя.</p>
        <ol class="rank">${ready.map((r, i) => html`<li class="tap" data-nav="#/ex/${r.exId}">
          <span class="rank-n ${i < 3 ? 'top' : ''}">${i + 1}</span>
          <div class="rank-main">
            <div class="rank-name"><b>${EXERCISES[r.exId]?.short || r.exId}</b><em class="${r.pctWeek < 0 ? 'neg' : ''}">${r.pctWeek > 0 ? '+' : ''}${num(r.pctWeek)}%/нед</em></div>
            <div class="rank-bar"><i class="${r.pctWeek < 0 ? 'neg' : ''}" style="--w:${(Math.abs(r.pctWeek) / max) * 100}%;animation-delay:${i * 60}ms"></i></div>
            <small>${r.sessions} трен. · ${r.hardSets} тяж. подх. · стабильность ${Math.round(r.r2 * 100)}%</small>
          </div>
        </li>`)}</ol>`
        : emptyState('sparkle', 'Пока мало данных', 'Рейтинг появится, когда по упражнению будет ≥3 тренировки за ≥7 дней. Обычно это 2–3 недели после знакомства.')}
      ${waiting.length ? html`<div class="waiting"><b>Набираем данные</b>${waiting.slice(0, 6).map((r) => html`<span class="chip muted">${EXERCISES[r.exId]?.short || r.exId} · ${r.sessions}/3</span>`)}</div>` : ''}
    </div>
  </section>`;
}

function muscleList(ws) {
  if (heatMode === 'volume') {
    const v = muscleVolume(ws, Date.now() - 7 * DAY, Date.now() + DAY);
    return html`<div class="mlist">${Object.entries(MUSCLE_GROUPS).flatMap(([, ms]) => ms).map((m) => {
      const [lo, hi] = VOLUME_TARGETS[m] || [6, 12];
      const val = v[m] || 0;
      const scale = hi * 1.3;
      const cls = val >= lo && val <= hi ? 'ok' : val > hi ? 'over' : val > 0 ? 'low' : 'none';
      return html`<div class="mrow"><span>${MUSCLES[m].name}</span>
        <div class="mbar"><span class="mband" style="left:${(lo / scale) * 100}%;width:${((hi - lo) / scale) * 100}%"></span><i class="${cls}" style="--w:${Math.min(100, (val / scale) * 100)}%"></i></div>
        <b class="${cls}">${num(val)}</b></div>`;
    })}</div><p class="legend"><span class="mband-key"></span> целевой диапазон тяжёлых подходов за 7 дней (вспомогательная мышца = 0,5)</p>`;
  }
  const p = muscleProgress(ws);
  const rows = Object.entries(p).filter(([, x]) => x).sort((a, b) => b[1].pctWeek - a[1].pctWeek);
  if (!rows.length) return html`<p class="section-sub">Темп по мышцам появится вместе с рейтингом упражнений.</p>`;
  const max = Math.max(...rows.map(([, x]) => Math.abs(x.pctWeek)), 0.5);
  return html`<div class="mlist">${rows.map(([m, x]) => html`<div class="mrow"><span>${MUSCLES[m].name}</span>
    <div class="mbar"><i class="${x.pctWeek < 0 ? 'low' : 'ok'}" style="--w:${(Math.abs(x.pctWeek) / max) * 100}%"></i></div>
    <b>${x.pctWeek > 0 ? '+' : ''}${num(x.pctWeek)}%</b></div>`)}</div>`;
}

function exercisePicker(ws) {
  const ids = [...new Set(ws.flatMap((w) => w.ex.filter((e) => workingSets(e).length).map((e) => e.id)))];
  if (!ids.length) return '';
  const counts = Object.fromEntries(ids.map((id) => [id, exerciseHistory(ws, id).length]));
  ids.sort((a, b) => counts[b] - counts[a]);
  if (!chartEx || !ids.includes(chartEx)) chartEx = ids[0];
  const h = exerciseHistory(ws, chartEx);
  const rate = progressRate(h);
  const ro = repsOnly(chartEx);
  const last = h[h.length - 1];
  const first = h[0];
  return html`<section class="section">
    <h3 class="section-title">${raw(icon('progress', 18))} Динамика упражнения</h3>
    <div class="hscroll chips-scroll">${ids.map((id) => html`<button class="chip ${id === chartEx ? 'on' : ''}" data-act="chart-ex" data-id="${id}">${EXERCISES[id]?.short || id}</button>`)}</div>
    <div class="card chart-card">
      <div class="chart-head"><b>${ro ? 'Повторы' : 'Оценка 1ПМ'}</b><span>${rate ? `${rate.pctWeek > 0 ? '+' : ''}${num(rate.pctWeek)}%/нед · тренд пунктиром` : 'тренд — от 3 тренировок'}</span></div>
      <div class="ex-stats">
        <div><span>Сейчас</span><b>${ro ? last.best : `${num(last.best)} кг`}</b></div>
        <div><span>Было</span><b>${ro ? first.best : `${num(first.best)} кг`}</b></div>
        <div><span>Топ-подход</span><b>${last.top ? (ro ? `${last.top.r} ${repsUnit(chartEx)}` : `${weightLabel(chartEx, last.top.w)}×${last.top.r}`) : '—'}</b></div>
      </div>
      <div data-chart="e1rm"></div>
      ${ro ? '' : html`<div class="chart-head sub"><b>Объём (вес × повторы)</b><span>по тренировкам</span></div><div data-chart="vol"></div>`}
      <button class="link-btn" data-nav="#/ex/${chartEx}">Техника и вся история ${raw(icon('right', 16))}</button>
    </div>
  </section>`;
}

function attendanceCard(ws, att) {
  const durs = ws.map(duration).filter((x) => x != null);
  const longest = durs.length ? Math.max(...durs) : null;
  const weeks = att.weeks.slice(-10);
  return html`<section class="section">
    <h3 class="section-title">${raw(icon('calendar', 18))} Посещаемость</h3>
    <div class="card chart-card">
      <div data-chart="cal"></div>
      <div class="att-stats">
        <div><span>Приход в среднем</span><b>${hourLabel(att.avgHour)}</b></div>
        <div><span>Длительность</span><b>${att.avgDuration ?? '—'} мин</b></div>
        <div><span>Самая долгая</span><b>${longest ?? '—'} мин</b></div>
      </div>
      ${weeks.length > 1 ? html`<div class="chart-head sub"><b>Тренировок в неделю</b><span>цель — 3</span></div><div data-chart="weeks"></div>` : ''}
    </div>
  </section>`;
}

function prFeed(ws) {
  const list = prs(ws).slice(-6).reverse();
  return html`<section class="section">
    <h3 class="section-title">${raw(icon('trophy', 18))} Рекорды</h3>
    ${list.length ? html`<div class="card list">${list.map((p) => html`<a class="list-row tap" data-nav="#/ex/${p.exId}">
      <div><b>${EXERCISES[p.exId]?.short || p.exId}</b><span>${dayShort(p.date)} · ${repsOnly(p.exId) ? `${p.r} ${repsUnit(p.exId)}` : `${weightLabel(p.exId, p.w)} × ${p.r}`}</span></div>
      <div class="list-right"><span class="badge pr">+${num(((p.score - p.prev) / p.prev) * 100)}%</span></div></a>`)}</div>`
      : html`<div class="card pad"><p class="section-sub">Рекорды появятся, когда ты превзойдёшь прошлые результаты.</p></div>`}
  </section>`;
}

function stallCard(ws) {
  const st = stalls(ws);
  const dl = deloadAdvice(ws);
  if (!st.length && !dl) return html`<section class="section"><h3 class="section-title">${raw(icon('refresh', 18))} Застой и разгрузка</h3>
    <div class="card pad ok-card">${raw(icon('check', 20))}<p>Застоев нет — продолжай по плану.</p></div></section>`;
  return html`<section class="section">
    <h3 class="section-title">${raw(icon('refresh', 18))} Застой и разгрузка</h3>
    ${dl ? html`<div class="card alert">${raw(icon('alert', 20))}<div><b>${dl.reason === 'stall' ? 'Рекомендована разгрузка' : 'Запланируй разгрузку'}</b><p>${dl.text}</p><p class="muted">${PROGRAM.rules.deload}</p></div></div>` : ''}
    ${st.length ? html`<div class="card list">${st.map((s) => html`<a class="list-row tap" data-nav="#/ex/${s.exId}"><div><b>${EXERCISES[s.exId]?.short || s.exId}</b><span>${s.sessions} тренировки без роста · лучшее ${num(s.best)}</span></div><div class="list-right"><span class="badge warn">застой</span></div></a>`)}</div>
      <p class="section-sub">Что делать: проверь сон и питание, попробуй замену из альтернатив или сбрось вес на 10% и набери повторы заново.</p>` : ''}
  </section>`;
}

function historyList(ws) {
  const list = ws.slice().reverse();
  const shown = list.slice(0, historyLimit);
  return html`<section class="section">
    <h3 class="section-title">${raw(icon('layers', 18))} История тренировок</h3>
    <div class="card list">${shown.map((w) => {
      const s = workoutSummary(ws, w);
      return html`<a class="list-row tap" data-nav="#/w/${w.id}">
        <div><b>${PROGRAM.sessions[w.session]?.name || w.session}${w.calib ? html` <span class="badge">знакомство</span>` : ''}</b>
        <span>${dayShort(w.start)} · ${minutes(s.duration)} · ${tonnage(s.volume)}${s.prs.length ? ` · ${s.prs.length} PR` : ''}</span></div>
        <div class="list-right">${w.feel ? html`<span class="feel f${w.feel}">${w.feel}</span>` : ''}${raw(icon('right', 18, 'muted'))}</div></a>`;
    })}</div>
    ${list.length > shown.length ? html`<button class="btn btn-secondary wide" data-act="more">Показать ещё ${Math.min(10, list.length - shown.length)}</button>` : ''}
  </section>`;
}

export function render(ctx) {
  const { root } = ctx;
  const ws = finishedWorkouts();
  if (!ws.length) {
    root.innerHTML = html`${pageHeader('Прогресс')}${emptyState('progress', 'Здесь будет твой прогресс', 'После первых тренировок появятся графики силы, рейтинг упражнений, карта мышц и посещаемость. Начни с кнопки «Пришёл в зал» на экране «Сегодня».',
      html`<button class="btn btn-secondary" data-nav="#/today">К тренировке</button>`)}`.s;
    return;
  }
  const att = attendance(ws);

  root.innerHTML = html`
    ${pageHeader('Прогресс', { kicker: `${att.total} ${plural(att.total, ['тренировка', 'тренировки', 'тренировок'])}` })}
    ${kpis(ws, att)}
    ${effectivenessCard(ws)}
    <section class="section">
      <h3 class="section-title">${raw(icon('profile', 18))} Карта мышц</h3>
      ${segmented('heat', [['progress', 'Прогресс силы'], ['volume', 'Объём за неделю']], heatMode, 'wide')}
      <div class="card body-card">
        <div class="stage body-stage" data-stage></div>
        <div class="heat-legend"><span>${heatMode === 'volume' ? 'мало' : 'медленно'}</span><i></i><span>${heatMode === 'volume' ? 'в норме' : 'быстро'}</span></div>
        <div data-mlist>${muscleList(ws)}</div>
      </div>
    </section>
    ${exercisePicker(ws)}
    ${attendanceCard(ws, att)}
    ${prFeed(ws)}
    ${stallCard(ws)}
    ${historyList(ws)}`.s;

  mountCharts(root, ws, att);

  // 3D-карта мышц
  const stage = root.querySelector('[data-stage]');
  const v = mount3D(stage, (ex) => ex.showBody({ heat: muscleHeat(ws, heatMode), autoRotate: true }));
  ctx.cleanup(() => v.dispose());

  ctx.cleanup(on(root, 'click', '[data-act]', (e, b) => {
    const act = b.dataset.act;
    if (act === 'seg' && b.dataset.name === 'heat') {
      heatMode = b.dataset.v;
      b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      root.querySelector('[data-mlist]').innerHTML = muscleList(ws).s;
      const lg = root.querySelectorAll('.heat-legend span');
      lg[0].textContent = heatMode === 'volume' ? 'мало' : 'медленно';
      lg[1].textContent = heatMode === 'volume' ? 'в норме' : 'быстро';
      v.ex?.showBody({ heat: muscleHeat(ws, heatMode), autoRotate: true });
    }
    if (act === 'chart-ex') { chartEx = b.dataset.id; ctx.refresh(); }
    if (act === 'more') { historyLimit += 10; ctx.refresh(); }
    if (act === 'eff-info') effInfo();
  }));
}

function mountCharts(root, ws, att) {
  const e1 = root.querySelector('[data-chart="e1rm"]');
  if (e1 && chartEx) {
    const h = exerciseHistory(ws, chartEx);
    const ro = repsOnly(chartEx);
    e1.appendChild(lineChart(h.map((x) => ({ x: x.t, y: x.best, muted: x.calib, label: `${dayShort(x.t)}${x.top ? ` · ${ro ? x.top.r : `${num(x.top.w)}×${x.top.r}`}` : ''}` })),
      { unit: ro ? repsUnit(chartEx) : 'кг', width: chartWidth(e1) }));
    const vol = root.querySelector('[data-chart="vol"]');
    if (vol) vol.appendChild(barChart(h.map((x) => ({ label: dayShort(x.t).split(' ')[0], value: x.volume, tip: `${x.volume.toLocaleString('ru-RU')} кг` })), { height: 120, width: chartWidth(vol) }));
  }
  const cal = root.querySelector('[data-chart="cal"]');
  if (cal) {
    const days = new Map();
    for (const w of ws) {
      const d = duration(w);
      days.set(isoDay(w.start), { level: d ? d / 80 : 0.6, tip: `${PROGRAM.sessions[w.session]?.name || ''} · ${d ?? '—'} мин` });
    }
    cal.appendChild(calendarHeatmap(days, { width: chartWidth(cal) }));
  }
  const wk = root.querySelector('[data-chart="weeks"]');
  if (wk) {
    const cur = weekStart(Date.now());
    const map = new Map(att.weeks.map((x) => [x.week, x.n]));
    const bars = [];
    // Последние 10 недель, но не раньше недели первой тренировки (иначе в начале — пустые столбики).
    const from = Math.max(cur - 9 * 7 * DAY, att.weeks[0]?.week ?? cur);
    for (let k = from; k <= cur; k += 7 * DAY) {
      const n = map.get(weekStart(k + 3 * DAY)) || 0;
      bars.push({ label: dayShort(k).split(' ')[0], value: n, hot: n >= 3, tip: `${n} ${plural(n, ['тренировка', 'тренировки', 'тренировок'])}` });
    }
    wk.appendChild(barChart(bars, { height: 110, width: chartWidth(wk) }));
  }
}

function effInfo() {
  openSheet({
    title: 'Как считается эффективность',
    body: html`<div class="sheet-text">
      <p>Для каждого подхода считается <b>оценка 1ПМ</b> — вес, который ты поднял бы один раз (формула Эпли с учётом RIR). На каждой тренировке берётся лучший подход.</p>
      <p>По этим точкам строится <b>линия тренда</b>, и её наклон переводится в <b>% роста в неделю</b>. Стабильность — насколько точки ложатся на линию (R²): шумные результаты немного штрафуются.</p>
      <p>Рейтинг появляется, когда по упражнению есть <b>≥3 тренировки за ≥7 дней</b>. Неделя знакомства тоже учитывается.</p>
      <p class="muted">Это сравнение «для тебя»: упражнение с быстрым ростом сейчас хорошо откликается. Медленный рост на изоляции — норма.</p></div>`,
  });
}
