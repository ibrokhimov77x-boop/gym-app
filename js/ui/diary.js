// Экран «Дневник и графики» (#/diary): фаза режима и выводы, графики за 7 / 30 / 90 дней (вес со средним за 7 дней,
// калории и белок против нормы, сон, отбой и подъём), средние по неделям и список дней (тап — править день).
import {
  MODES, RULES, diaryDate, addDays, dayDiff, toMin, bedOffset, goalAt, phaseAt, sleepMinutes, dayCheck, weightSeries,
  periodSummary, assess, isLogged, fromMin,
} from '../diary.js';
import { getGoal, allDiaryDays, finishedWorkouts } from '../storage.js';
import { dayLineChart, dayBarChart, dayRangeChart, chartWidth } from '../charts.js';
import { html, raw, on, num, dayShort, plural } from './dom.js';
import { icon } from './icons.js';
import { subHeader, segmented, emptyState } from './components.js';
import {
  MODE_UI, MARK_TEXT, dayMark, markTone, warnSide, dateAt, dow, dayLabel, dayTitle, signed, kg, kcalText, fixed, nb, glue, joinParts, hmShort, hmLong,
  weekStartDate, lastClosedDay,
} from './diary-model.js';

export const NAME = 'diary';

const RANGES = [[7, '7 дней'], [30, '30 дней'], [90, '90 дней']];
const VERDICT_ICON = { warn: 'alert', info: 'info', good: 'check' };
const MARK_ICON = { ok: 'check', over: 'arrowUp', under: 'arrowDown' };
let range = null;   // выбранный период; при первом открытии — по тому, сколько дней уже в дневнике
let dayLimit = 10;  // сколько дней показано в списке

/** Нормы по частям: ['2150 ккал', 'Б 165', 'Ж 65', 'У 225'] (+ extra); пустой массив — норм нет. */
const targetParts = (e, extra = '') => [e.kcal != null ? `${kcalText(e.kcal)} ккал` : '', e.p != null ? `Б ${num(e.p)}` : '', e.f != null ? `Ж ${num(e.f)}` : '', e.c != null ? `У ${num(e.c)}` : '', extra]
  .filter(Boolean);

/** Шапка: режим, день фазы, нормы, путь к целевому весу и выводы. */
function phaseCard(days, goal, today, phase, verdicts) {
  const list = verdicts.length
    ? html`<ul class="verdicts">${verdicts.map((v) => html`<li class="${v.level}">${raw(icon(VERDICT_ICON[v.level], 18))}<p>${nb(v.text)}</p></li>`)}</ul>`
    : html`<p class="dg-none">Выводы появятся, когда в дневнике наберётся несколько дней.</p>`;
  if (!phase) {
    return html`<section class="card ph-card">
      <div class="st-head"><span class="st-ic muted">${raw(icon('target', 22))}</span>
        <div class="st-title"><h4>Режим не выбран</h4><p>без него нет норм и оценки темпа веса</p></div>
        <button class="chip-btn" data-nav="#/goal">Выбрать</button></div>
      ${list}
    </section>`;
  }
  const e = phase.entry;
  // Путь к цели: средний вес первой недели режима → средний за последние 7 дней → целевой вес.
  // «Сейчас» — та же неделя, что в плитке на «Профиле» и в выводах: до последнего закрытого дня.
  const startW = periodSummary(days, goal, phase.from, addDays(phase.from, 6)).wAvg;
  const end = lastClosedDay(days, today);
  const nowW = periodSummary(days, goal, addDays(end, -6), end).wAvg;
  let path = '';
  if (startW != null && nowW != null && phase.day > 7) {
    const r1 = (x) => Math.round(x * 10) / 10; // разница — из тех же чисел, что показаны рядом (до десятых)
    const done = r1(nowW) - r1(startW);
    const frac = e.targetW && Math.abs(e.targetW - startW) > 0.05 ? Math.min(1, Math.max(0, done / (e.targetW - startW))) : null;
    path = html`<div class="ph-path">
      <div class="ph-path-row">
        <span><b>${kg(startW, 1)}</b><small>старт, кг</small></span>
        <span class="now"><b>${kg(nowW, 1)}</b><small>сейчас · ${signed(done, 1)} кг</small></span>
        ${e.targetW ? html`<span><b>${num(e.targetW)}</b><small>цель, кг</small></span>` : ''}
      </div>
      ${frac != null ? html`<div class="bar"><i style="width:${Math.round(frac * 100)}%"></i></div>` : ''}
    </div>`;
  }
  // Нормы — отдельной строкой на всю ширину карточки (в шапке рядом с кнопкой они не помещаются на узком экране).
  // Целевой вес в неё попадает, пока нет блока «путь к цели» (первая неделя режима или нет взвешиваний).
  const targets = targetParts(e, !path && e.targetW ? `цель ${num(e.targetW)} кг` : '');
  return html`<section class="card ph-card">
    <div class="st-head"><span class="st-ic">${raw(icon(MODE_UI[phase.mode].icon, 22))}</span>
      <div class="st-title"><h4>${MODES[phase.mode].name}</h4><p>день ${phase.day} · с ${dayShort(dateAt(phase.from))}</p></div>
      <button class="chip-btn" data-nav="#/goal">Изменить</button></div>
    <div class="ph-targets"><p>${targets.length ? targets.map((t, i) => html`<span>${i ? '' : html`<i>Нормы</i>`}${t}</span>`)
      : html`<span>Нормы калорий и БЖУ не заданы</span>`}</p></div>
    ${path}
    ${list}
  </section>`;
}

/**
 * Изменение веса внутри периода: среднее за 7 дней в его конце минус среднее за 7 дней в его начале (первая точка
 * линии на графике веса). Разница со средним прошлого периода тут не годится: когда прошлый период заполнен лишь
 * частично, его несколько взвешиваний лежат у самой границы и занижают изменение почти вдвое.
 * @returns {{ change: number, from: string }|null} null — линии среднего меньше недели
 */
function weightTrendIn(days, from, to) {
  const line = weightSeries(days, from, to).filter((r) => r.avg7 != null);
  if (line.length < 2 || dayDiff(line[0].date, line.at(-1).date) < 6) return null;
  return { change: line.at(-1).avg7 - line[0].avg7, from: line[0].date };
}

/** Средние за выбранный период. */
function tiles(sum, n, trend) {
  const kHits = sum.kcalDays ? Math.round(sum.kcalInRange * sum.kcalDays) : 0;
  const pHits = sum.proteinDays ? Math.round(sum.proteinHit * sum.proteinDays) : 0;
  const sleep = sum.sleepAvg == null ? '—' : html`${Math.floor(sum.sleepAvg / 60)}<i> ч </i>${String(sum.sleepAvg % 60).padStart(2, '0')}<i> мин</i>`;
  return html`<section class="kpis dg-tiles">
    <div class="kpi"><span>${raw(icon('food', 18))} Калории</span><b>${sum.kcalAvg == null ? '—' : html`${sum.kcalAvg}<i> ккал</i>`}</b>
      <small>${sum.kcalDays ? `в коридоре ${kHits} из ${sum.kcalDays}` : sum.kcalN ? `в среднем за ${sum.kcalN} дн.` : 'нет записей'}</small></div>
    <div class="kpi"><span>${raw(icon('bolt', 18))} Белок</span><b>${sum.pAvg == null ? '—' : html`${Math.round(sum.pAvg)}<i> г</i>`}</b>
      <small>${sum.pAvg != null && sum.wAvg ? `${num(sum.pAvg / sum.wAvg)} г на кг веса` : sum.proteinDays ? `норма в ${pHits} из ${sum.proteinDays} дн.` : sum.pN ? `в среднем за ${sum.pN} дн.` : 'нет записей'}</small></div>
    <div class="kpi"><span>${raw(icon('scale', 18))} Вес</span><b>${sum.wAvg == null ? '—' : html`${kg(sum.wAvg, 1)}<i> кг</i>`}</b>
      <small>${n === 7 && sum.wChange != null ? `${signed(sum.wChange, 2)} кг за неделю`
        : n > 7 && trend ? glue(`${signed(trend.change, 1)} кг с ${dayShort(dateAt(trend.from))}`)
          : sum.wN ? `${sum.wN} ${plural(sum.wN, ['взвешивание', 'взвешивания', 'взвешиваний'])}` : 'нет взвешиваний'}</small></div>
    <div class="kpi"><span>${raw(icon('moon', 18))} Сон</span><b class="${sum.sleepN >= 3 && sum.sleepAvg < RULES.sleepMin ? 'warn-text' : ''}">${sleep}</b>
      <small>${sum.bedAvg != null && sum.wakeAvg != null ? `с ${fromMin(sum.bedAvg)} до ${fromMin(sum.wakeAvg)}` : sum.bedAvg != null ? `отбой около ${fromMin(sum.bedAvg)}` : 'нужны отбой и подъём'}</small></div>
  </section>`;
}

/** Данные всех графиков: по строке на каждый день периода. */
function chartRows(days, goal, from, n) {
  const ws = weightSeries(days, from, addDays(from, n - 1));
  const rows = { weight: [], kcal: [], protein: [], sleep: [], night: [] };
  for (let i = 0; i < n; i++) {
    const date = addDays(from, i);
    const day = days[date] || null;
    const prev = days[addDays(date, -1)] || null;
    const chk = dayCheck(day, goalAt(goal, date));
    const label = dayLabel(date);
    const { w, avg7 } = ws[i];
    rows.weight.push({
      dot: w, line: avg7,
      tip: w != null ? [`${kg(w)} кг`, `${avg7 != null ? `среднее ${kg(avg7, 1)} · ` : ''}${label}`] : avg7 != null ? [`среднее ${kg(avg7, 1)} кг`, `${label} · без взвешивания`] : null,
    });
    const k = chk.kcal;
    const mark = k.ok === false ? (k.pct > 0 ? 'over' : 'under') : '';
    rows.kcal.push({
      // цвет промаха — по режиму этого дня: опасная для режима сторона — предупреждение, другая — спокойный цвет
      value: k.v, target: k.target, cls: k.ok === true ? 'ok' : mark ? `${mark} ${markTone(mark, goalAt(goal, date)?.mode) ? 'warn' : 'calm'}` : '',
      tip: k.v != null ? [`${kcalText(k.v)} ккал`, `${k.target != null ? `норма ${kcalText(k.target)}, ${signed(k.pct * 100, 0)} % · ` : ''}${label}`] : null,
    });
    const p = chk.p;
    rows.protein.push({
      value: p.v, target: p.target, cls: p.ok === true ? 'ok' : '',
      tip: p.v != null ? [`${num(p.v)} г`, `${p.target != null ? `норма ${num(p.target)} · ` : ''}${label}`] : null,
    });
    const sl = sleepMinutes(days, date);
    const slCls = sl == null ? '' : sl >= RULES.sleepMin ? 'ok' : 'over';
    rows.sleep.push({ value: sl == null ? null : sl / 60, target: RULES.sleepMin / 60, cls: slCls, tip: sl != null ? [hmLong(sl), `ночь на ${label}`] : null });
    const bed = bedOffset(prev?.bed), wake = toMin(day?.wake);
    rows.night.push({
      from: bed == null ? null : bed - 1440, to: wake, cls: slCls,
      tip: bed != null || wake != null ? [`${prev?.bed || '—'} → ${day?.wake || '—'}`, `ночь на ${label}${sl != null ? ` · ${hmLong(sl)}` : ''}`] : null,
    });
  }
  return rows;
}

/** Подписи оси дат: дни недели для недели, три-четыре даты для длинных периодов. */
function axisLabels(from, n) {
  if (n <= 7) return Array.from({ length: n }, (_, i) => [i, dow(addDays(from, i))]);
  const idx = n > 45 ? [0, Math.round((n - 1) / 3), Math.round(((n - 1) * 2) / 3), n - 1] : [0, Math.round((n - 1) / 2), n - 1];
  return idx.map((i, k) => [i, dayShort(dateAt(addDays(from, i))), k === 0 ? 'start' : k === idx.length - 1 ? 'end' : 'middle']);
}

const chartCard = (name, title, legend, has, none, foot = '') => html`<div class="card chart-card dg-chart">
  <div class="chart-head"><b>${title}</b><span>${has ? legend : ''}</span></div>
  ${has ? html`<div data-chart="${name}"></div>${foot}` : html`<p class="dg-none">${none}</p>`}
</div>`;

/** Средние по календарным неделям (до восьми последних). */
function weeksTable(days, goal, today, first) {
  const rows = [];
  let ws = weekStartDate(today);
  for (let k = 0; k < 8 && addDays(ws, 6) >= first; k++, ws = addDays(ws, -7)) {
    const s = periodSummary(days, goal, ws, addDays(ws, 6));
    const hits = s.kcalDays ? Math.round(s.kcalInRange * s.kcalDays) : 0;
    // Текущая неделя ещё идёт: считаем из прошедших дней (сегодняшний — когда он заполнен), а не «3 из 7» в четверг
    const of = k === 0 ? Math.max(s.logged, dayDiff(ws, today) + (isLogged(days[today]) ? 1 : 0)) : 7;
    rows.push(html`<tr class="${s.logged ? '' : 'none'}">
      <th scope="row"><b>${k === 0 ? 'эта неделя' : `с ${dayShort(dateAt(ws))}`}</b><small>${of ? `${s.logged} из ${of} дн.` : 'началась сегодня'}</small></th>
      <td><b>${s.kcalAvg ?? '—'}</b><small>${s.kcalDays ? `${hits} из ${s.kcalDays}` : ''}</small></td>
      <td><b>${s.pAvg == null ? '—' : Math.round(s.pAvg)}</b></td>
      <td><b>${fixed(s.wAvg, 1)}</b><small>${s.wChange == null ? '' : signed(s.wChange, 1)}</small></td>
      <td><b>${hmShort(s.sleepAvg)}</b></td>
    </tr>`);
  }
  return html`<section class="section">
    <h3 class="section-title">${raw(icon('calendar', 18))} По неделям</h3>
    <div class="card dg-weeks"><table>
      <thead><tr><th scope="col">неделя</th><th scope="col">ккал</th><th scope="col">белок, г</th><th scope="col">вес, кг</th><th scope="col">сон</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="legend">Средние за неделю (пн–вс). Под калориями — сколько дней в коридоре ±10 %, под весом — изменение к прошлой неделе.</p>
  </section>`;
}

/** Список дней от сегодняшнего назад, с пропущенными: тап открывает день. */
function dayList(days, goal, today, first) {
  const total = dayDiff(first, today) + 1;
  const shown = Math.min(total, dayLimit);
  const rows = [];
  // Дни с датой из будущего (сохранены, когда часы телефона спешили): бот их не примет, а в обычный список они не попадают —
  // показываем первыми, чтобы их можно было открыть и очистить
  for (const date of Object.keys(days).filter((d) => d > today).reverse()) {
    rows.push(html`<a class="list-row tap dg-day" data-nav="#/diary/${date}"><div><b>${dayShort(dateAt(date))}${date.slice(0, 4) !== today.slice(0, 4) ? ` ${date.slice(0, 4)}` : ''} — дата из будущего</b><span class="warn-text">${nb('сохранён при сбитых часах — открыть и проверить')}</span></div>
      <div class="list-right">${raw(icon('alert', 18, 'warn-text'))}</div></a>`);
  }
  for (let i = 0; i < shown; i++) {
    const date = addDays(today, -i);
    const day = days[date] || null;
    const href = `#/diary/${i === 0 ? 'today' : date}`;
    const name = i < 2 ? `${dayTitle(date, today)}, ${dayShort(dateAt(date))}` : dayTitle(date, today);
    if (!isLogged(day)) {
      rows.push(html`<a class="list-row tap dg-day ${i === 0 ? 'todo' : 'none'}" data-nav="${href}"><div><b>${name}</b><span>${day?.note ? `«${day.note}»` : i === 0 ? 'ещё не заполнено — заполнить' : 'не заполнено'}</span></div>
        <div class="list-right">${raw(icon('plus', 18, i === 0 ? '' : 'muted'))}</div></a>`);
      continue;
    }
    const e = goalAt(goal, date);
    const mark = dayMark(day, e);
    const sl = sleepMinutes(days, date);
    // Каждая часть склеена: при переносе строка не рвётся между «сон» и временем или числом и «кг»
    const parts = [day.kcal != null ? `${kcalText(day.kcal)} ккал` : '', day.p != null ? `Б ${num(day.p)}` : '', day.w != null ? `${kg(day.w)} кг` : '', sl != null ? `сон ${hmShort(sl)}` : '']
      .filter(Boolean).map(glue);
    rows.push(html`<a class="list-row tap dg-day" data-nav="${href}"><div><b>${name}</b><span>${joinParts(parts) || 'только время'}</span>${day.note ? html`<span class="dg-note">«${day.note}»</span>` : ''}</div>
      <div class="list-right"><i class="dg-mark ${mark} ${markTone(mark, e?.mode)}" title="${MARK_TEXT[mark]}">${MARK_ICON[mark] ? raw(icon(MARK_ICON[mark], 14)) : ''}</i>${raw(icon('right', 18, 'muted'))}</div></a>`);
  }
  // Цвета стрелок — по нынешнему режиму: на сушке тревожен перебор, на наборе недобор, на поддержании оба
  const side = warnSide(phaseAt(goal, today)?.mode);
  return html`<section class="section">
    <h3 class="section-title">${raw(icon('layers', 18))} Дни</h3>
    <div class="card list">${rows}</div>
    ${total > shown ? html`<button class="btn btn-secondary wide dg-more" data-act="more">Показать ещё ${Math.min(14, total - shown)}</button>` : ''}
    <p class="legend dg-legend"><i class="dg-mark ok">${raw(icon('check', 14))}</i> калории в коридоре ±10 % <i class="dg-mark over ${side.over ? 'warn' : ''}">${raw(icon('arrowUp', 14))}</i> выше <i class="dg-mark under ${side.under ? 'warn' : ''}">${raw(icon('arrowDown', 14))}</i> ниже</p>
  </section>`;
}

export function render(ctx) {
  const { root } = ctx;
  const goal = getGoal(), days = allDiaryDays(), today = diaryDate();
  const dates = Object.keys(days);
  if (!dates.length) {
    root.innerHTML = html`${subHeader('Дневник')}
      <div class="pad-top"></div>
      ${emptyState('note', 'Дневник пока пуст',
        'Каждый вечер перед сном записывай калории и БЖУ, утренний вес, во сколько встал и лёг. Через несколько дней здесь появятся графики веса, питания и сна и выводы по режиму.',
        html`<button class="btn btn-primary" data-nav="#/diary/today">Заполнить сегодня</button>${goal ? '' : html`<button class="link-btn" data-nav="#/goal">Сначала выбрать режим ${raw(icon('right', 16))}</button>`}`)}`.s;
    return;
  }

  const first = dates[0];
  if (range == null) range = dayDiff(first, today) >= 10 ? 30 : 7;
  // Период заканчивается последним закрытым днём — как неделя в выводах и в плитках «Профиля»: пока сегодня пусто,
  // в средних и на графиках только прошедшие дни, а первая же запись за сегодня сдвигает период на сегодня.
  const end = lastClosedDay(days, today);
  const from = addDays(end, -(range - 1));
  const phase = phaseAt(goal, today);
  const sum = periodSummary(days, goal, from, end);
  const verdicts = assess(days, goal, today, finishedWorkouts());
  // Дневник короче выбранного периода — графики начинаются с первой записи (но не короче недели), без пустой полосы слева.
  const chartFrom = first > from ? (first < addDays(end, -6) ? first : addDays(end, -6)) : from;
  const span = dayDiff(chartFrom, end) + 1;
  const rows = chartRows(days, goal, chartFrom, span);
  const has = {
    weight: rows.weight.some((r) => r.dot != null || r.line != null), kcal: rows.kcal.some((r) => r.value != null),
    protein: rows.protein.some((r) => r.value != null), sleep: rows.sleep.some((r) => r.value != null),
    night: rows.night.some((r) => r.from != null || r.to != null),
  };
  const total = dates.length;
  // Отметки на графике отбоя и подъёма — средние по тем ночам, что на нём нарисованы (отбой накануне → подъём).
  // Средние из сводки периода сюда не годятся: в них входит отбой последнего дня, которого на графике нет, —
  // в первый день дневника такая линия оказывалась далеко за шкалой, поверх соседнего графика.
  // Числа под заголовком не повторяем: средние отбой и подъём за период уже стоят в плитке «Сон» выше.
  const nightAvg = (key) => { const v = rows.night.map((r) => r[key]).filter((x) => x != null); return v.length >= 2 ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const nightRefs = [nightAvg('from'), nightAvg('to')];
  const side = warnSide(phase?.mode); // какая сторона коридора калорий — промах для нынешнего режима (легенда)

  root.innerHTML = html`
    ${subHeader('Дневник', { sub: `${total} ${plural(total, ['день', 'дня', 'дней'])} · с ${dayShort(dateAt(first))}` })}
    ${phaseCard(days, goal, today, phase, verdicts)}

    <div class="dg-range">${segmented('range', RANGES, range, 'wide')}</div>
    ${tiles(sum, range, weightTrendIn(days, from, end))}

    <section class="dg-charts">
      ${chartCard('weight', 'Вес', rows.weight.some((r) => r.line != null) ? 'линия — среднее за 7 дней' : '', has.weight, 'За этот период нет взвешиваний. Взвешивайся утром натощак — появятся точки и среднее за 7 дней.')}
      ${chartCard('kcal', 'Калории', rows.kcal.some((r) => r.target != null) ? 'пунктир — норма, полоса — ±10 %' : '', has.kcal, 'За этот период калории не записаны.',
        rows.kcal.some((r) => r.target != null) ? html`<p class="legend"><i class="lg ok"></i> в коридоре <i class="lg ${side.over ? 'warn' : 'calm'}"></i> выше <i class="lg ${side.under ? 'warn' : 'calm'}"></i> ниже${rows.kcal.some((r) => r.value != null && r.target == null) ? html` <i class="lg"></i> без нормы` : ''}</p>` : '')}
      ${chartCard('protein', 'Белок', rows.protein.some((r) => r.target != null) ? 'пунктир — норма' : '', has.protein, 'За этот период белок не записан.',
        rows.protein.some((r) => r.target != null) ? html`<p class="legend"><i class="lg ok"></i> не меньше 90 % нормы <i class="lg"></i> меньше</p>` : '')}
      ${chartCard('sleep', 'Сон', 'пунктир — 7 часов', has.sleep, 'Сон считается от отбоя накануне до подъёма: записывай оба времени два дня подряд.',
        html`<p class="legend"><i class="lg ok"></i> 7 часов и больше <i class="lg over"></i> меньше</p>`)}
      ${chartCard('night', 'Отбой и подъём', nightRefs.some((y) => y != null) ? 'пунктир — в среднем' : 'столбик — от отбоя до подъёма', has.night,
        'Здесь будет видно, во сколько ты ложишься и встаёшь.')}
    </section>

    ${weeksTable(days, goal, today, first)}
    ${dayList(days, goal, today, first)}`.s;

  const labels = axisLabels(chartFrom, span);
  const put = (name, make) => { const slot = root.querySelector(`[data-chart="${name}"]`); if (slot) slot.appendChild(make(chartWidth(slot))); };
  put('weight', (width) => dayLineChart(rows.weight, { width, xLabels: labels, ref: phase?.entry.targetW ? { y: phase.entry.targetW, label: `цель ${num(phase.entry.targetW)}` } : null }));
  put('kcal', (width) => dayBarChart(rows.kcal, { width, xLabels: labels, band: RULES.kcalTolerance }));
  put('protein', (width) => dayBarChart(rows.protein, { width, height: 130, xLabels: labels }));
  put('sleep', (width) => dayBarChart(rows.sleep, { width, height: 130, xLabels: labels, step: 2, fmt: (v) => `${num(v, 0)} ч` }));
  put('night', (width) => dayRangeChart(rows.night, { width, xLabels: labels, refs: nightRefs.map((y) => ({ y })) }));

  ctx.cleanup(on(root, 'click', '[data-act]', (e, b) => {
    if (b.dataset.act === 'seg') { range = +b.dataset.v; ctx.refresh(); }
    if (b.dataset.act === 'more') { dayLimit += 14; ctx.refresh(); }
  }));
}
