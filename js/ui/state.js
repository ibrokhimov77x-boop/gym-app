// Раздел «Состояние» на экране «Профиль»: режим и свои нормы, сегодняшний дневник, неделя, вес и сон, главный вывод.
// Только разметка: все переходы — обычные ссылки data-nav, которые обрабатывает app.js.
import {
  MODES, RULES, diaryDate, addDays, phaseAt, goalAt, periodSummary, streak, assess, hasEvening, isLogged, latestWeight, dayCheck, fromMin,
} from '../diary.js';
import { getGoal, allDiaryDays, finishedWorkouts } from '../storage.js';
import { html, raw, num, dayShort, dayLong, plural } from './dom.js';
import { icon } from './icons.js';
import { emptyState } from './components.js';
import {
  MODE_UI, MARK_TEXT, dayMark, markTone, warnSide, dayLabel, dow, dateAt, signed, kg, kcalText, nb, kcalHint, dayClosed, draftDays, lastClosedDay,
} from './diary-model.js';

const VERDICT_ICON = { warn: 'alert', info: 'info', good: 'check' };
const MARK_ICON = { ok: 'check', over: 'arrowUp', under: 'arrowDown' };

/** Шапка раздела с заголовком. */
const title = html`<h3 class="section-title">${raw(icon('pulse', 18))} Состояние</h3>`;

/** Режим не выбран: приглашение начать. */
function emptyCard(hasDays) {
  return html`<section class="section state" data-state="empty">
    ${title}
    <div class="card">
      ${emptyState('target', 'Сушка, набор или поддержание?',
        nb('Выбери режим и запиши свои нормы калорий и БЖУ. Каждый вечер перед сном — пара минут на дневник: питание, утренний вес, подъём и отбой. Здесь появятся тренды и выводы, а бот пришлёт разбор.'),
        html`<button class="btn btn-primary" data-nav="#/goal">Выбрать режим</button>`)}
    </div>
    ${hasDays ? html`<div class="card list st-links"><a class="list-row tap" data-nav="#/diary"><div><b>Дневник и графики</b><span>записи, которые уже есть</span></div>${raw(icon('right', 18, 'muted'))}</a></div>` : ''}
  </section>`;
}

/** Таблица «норма / сегодня» по четырём показателям. Режим выбран, а чисел нет — вместо пустой таблицы предложение их задать. */
function targetsTable(entry, day) {
  if (!['kcal', 'p', 'f', 'c'].some((k) => entry[k] != null)) {
    return html`<a class="st-nonorm tap" data-nav="#/goal">${raw(icon('target', 20))}
      <span><b>Нормы не заданы</b>${nb('Запиши свои калории и БЖУ — появятся остаток на день и оценка питания')}</span>${raw(icon('right', 16, 'muted'))}</a>`;
  }
  const chk = dayCheck(day, entry);
  const cols = [['kcal', 'ккал', kcalText], ['p', 'белки', (x) => num(x)], ['f', 'жиры', (x) => num(x)], ['c', 'углев.', (x) => num(x)]];
  const shown = hasEvening(day);
  // Калории вне коридора — предупреждение, только если промах в опасную для режима сторону (на наборе — недобор)
  const side = warnSide(entry.mode);
  const warn = (k) => chk[k].ok === false && (k !== 'kcal' || (chk[k].pct > 0 ? side.over : side.under));
  return html`<div class="st-table ${shown ? 'two' : ''}" role="table" aria-label="Нормы на день${shown ? ' и сегодняшние значения' : ''}">
    <span></span>${cols.map(([, label]) => html`<span class="st-cap">${label}</span>`)}
    <span class="st-row">норма</span>${cols.map(([k, , fmt]) => html`<b>${entry[k] == null ? '—' : fmt(entry[k])}</b>`)}
    ${shown ? html`<span class="st-row">сегодня</span>${cols.map(([k, , fmt]) => html`<i class="${chk[k].ok === true ? 'good' : warn(k) ? 'warn' : ''}">${chk[k].v == null ? '—' : fmt(chk[k].v)}</i>`)}` : ''}
  </div>`;
}

/** До которого часа на «Профиле» напоминаем о пропущенном вчерашнем вечере. */
const MISSED_UNTIL = 15;

/**
 * Вчерашний вечер пропущен, а сейчас утро или день: вчерашний день ещё можно заполнить, и серия не прервётся.
 * @returns {{ date: string, run: number }|null} run — сколько дней подряд было заполнено до вчерашнего
 */
function missedYesterday(days, goal, today, now = new Date()) {
  const h = now.getHours();
  if (h < RULES.dayStartHour || h >= MISSED_UNTIL) return null;
  const y = addDays(today, -1);
  if (!goalAt(goal, y) || hasEvening(days[y])) return null;
  return { date: y, run: streak(days, addDays(y, -1)) };
}

/** Статус сегодняшнего дня и главная кнопка. */
function todayBlock(today, day, entry, drafts, missed) {
  const filled = hasEvening(day);
  const hasDraft = drafts.includes(today);
  let head, sub;
  if (filled) {
    const hint = kcalHint(dayCheck(day, entry).kcal, ' ккал', { mode: entry.mode, closed: dayClosed(today, today, day) });
    head = html`${raw(icon('check', 18, 'good-text'))} Сегодня заполнено`;
    sub = day.kcal != null && hint.text ? nb(hint.text) : dayLong(dateAt(today));
  } else if (isLogged(day)) {
    head = 'Вечер ещё не заполнен';
    sub = nb(`Утром записано: ${[day.w != null ? `вес ${kg(day.w)} кг` : '', day.wake ? `подъём ${day.wake}` : ''].filter(Boolean).join(', ')}`);
  } else {
    head = 'Сегодня ещё не заполнено';
    sub = `${dayLong(dateAt(today))} · пара минут перед сном`;
  }
  const older = drafts.filter((d) => d !== today && d !== missed?.date);
  // Вчерашний вечер пропущен: напоминаем здесь же, иначе вчерашнюю еду легко вписать в сегодняшнюю форму
  const missedLink = missed ? html`<a class="st-missed tap" data-nav="#/diary/${missed.date}">${raw(icon('alert', 16))}<span><b>${nb(`Вчера, ${dayShort(dateAt(missed.date))}, не заполнено`)}</b><small>${
    drafts.includes(missed.date) ? 'Есть несохранённый черновик — продолжить'
      : missed.run > 1 ? nb(`Заполни — серия из ${missed.run} ${plural(missed.run, ['дня', 'дней', 'дней'])} не прервётся`) : 'Его ещё можно заполнить'}</small></span>${raw(icon('right', 16))}</a>` : '';
  return html`<div class="st-today">
    ${missedLink}
    <div class="st-today-text"><b>${head}</b><span>${sub}</span></div>
    ${hasDraft ? html`<p class="st-draft">${raw(icon('edit', 15))} ${filled ? 'Есть несохранённые правки' : 'Есть несохранённый черновик'}</p>` : ''}
    <button class="btn ${filled ? 'btn-secondary' : 'btn-primary'} wide" data-nav="#/diary/today">${filled ? html`${raw(icon('edit', 18))} Изменить` : hasDraft ? 'Продолжить заполнение' : 'Заполнить дневник'}</button>
    ${older.map((d) => html`<a class="st-draft tap" data-nav="#/diary/${d}">${raw(icon('edit', 15))} Не сохранён черновик за ${dayLabel(d)} ${raw(icon('right', 14))}</a>`)}
  </div>`;
}

/** Полоска последних семи дней: тап открывает день. */
function weekStrip(days, goal, today, missed) {
  let logged = 0;
  const cells = [];
  // Сегодня утром записаны только вес и подъём — день ещё не заполнен: в счёт и в серию он войдёт вечером
  const morningOnly = isLogged(days[today]) && !hasEvening(days[today]);
  for (let i = 6; i >= 0; i--) {
    const date = addDays(today, -i);
    const e = goalAt(goal, date);
    const mark = dayMark(days[date], e);
    if (mark !== 'none' && !(i === 0 && morningOnly)) logged++;
    cells.push(html`<a class="st-day ${mark} ${markTone(mark, e?.mode)} ${i === 0 ? 'today' : ''}" data-nav="#/diary/${i === 0 ? 'today' : date}" aria-label="${dayLabel(date)}: ${MARK_TEXT[mark]}">
      <span>${dow(date)}</span><b>${MARK_ICON[mark] ? raw(icon(MARK_ICON[mark], 16)) : mark === 'log' ? raw('<u></u>') : dateAt(date).getDate()}</b></a>`);
  }
  // Серия: вчерашний пропуск, который ещё можно заполнить, её не обрывает (о нём говорит ссылка выше)
  const run = missed ? 0 : streak(days, morningOnly ? addDays(today, -1) : today);
  const count = logged ? html`<b>${logged}</b> из 7 дней заполнено${morningOnly ? ' · сегодня — только утро' : ''}` : morningOnly ? 'Сегодня записано утро — вечером заполни день' : 'Первая запись — сегодня вечером';
  return html`<div class="st-week">
    <div class="st-strip">${cells}</div>
    <div class="st-week-meta"><span>${count}</span>${run > 1 ? html`<span class="streak">${raw(icon('flame', 16))} ${run} ${plural(run, ['день', 'дня', 'дней'])} подряд</span>` : ''}</div>
  </div>`;
}

/** Вес и сон за 7 дней, заканчивающихся последним закрытым днём (та же неделя, что в выводах assess). */
function kpis(days, goal, today, mode) {
  const end = lastClosedDay(days, today);
  const week = periodSummary(days, goal, addDays(end, -6), end);
  let wMain = '—', wSub = 'взвешивайся утром натощак', wCls = '';
  if (week.wAvg != null) {
    wMain = html`${kg(week.wAvg, 1)}<i> кг</i>`;
    if (week.wChange != null) {
      wSub = `${signed(week.wChange, 2)} кг за неделю`;
      const dir = mode === 'cut' ? -1 : mode === 'bulk' ? 1 : 0;
      if (dir && Math.abs(week.wChange) >= 0.05) wCls = Math.sign(week.wChange) === dir ? 'good-text' : 'warn-text';
    } else wSub = `по ${week.wN} ${plural(week.wN, ['взвешиванию', 'взвешиваниям', 'взвешиваниям'])}`;
  } else {
    const last = latestWeight(days, today);
    if (last) { wMain = html`${kg(last.w)}<i> кг</i>`; wSub = `последнее взвешивание — ${dayShort(dateAt(last.date))}`; }
  }
  let sMain = '—', sSub = 'нужны отбой и подъём', sCls = '';
  if (week.sleepAvg != null) {
    const h = Math.floor(week.sleepAvg / 60), m = week.sleepAvg % 60;
    sMain = html`${h}<i> ч </i>${String(m).padStart(2, '0')}<i> мин</i>`;
    sSub = week.bedAvg != null ? `отбой около ${fromMin(week.bedAvg)}` : `за ${week.sleepN} ${plural(week.sleepN, ['ночь', 'ночи', 'ночей'])}`;
    if (week.sleepN >= 3 && week.sleepAvg < RULES.sleepMin) sCls = 'warn-text';
  } else if (week.bedAvg != null) sSub = `отбой около ${fromMin(week.bedAvg)}`;
  if (wMain === '—' && sMain === '—' && week.bedAvg == null) return ''; // дневник только начат: пустые плитки не показываем
  return html`<div class="kpis st-kpis">
    <div class="kpi"><span>${raw(icon('scale', 18))} Вес · 7 дней</span><b>${wMain}</b><small class="${wCls}">${wSub}</small></div>
    <div class="kpi"><span>${raw(icon('moon', 18))} Сон · 7 дней</span><b class="${sCls}">${sMain}</b><small>${sSub}</small></div>
  </div>`;
}

/**
 * Раздел «Состояние» целиком (Raw-разметка для html``).
 * Без режима — приглашение выбрать его; с режимом — нормы, статус дня с главной кнопкой, неделя, вес, сон и вывод.
 */
export function stateSection() {
  const goal = getGoal(), days = allDiaryDays(), today = diaryDate();
  const phase = phaseAt(goal, today);
  if (!phase) return emptyCard(Object.keys(days).length > 0);
  const { entry } = phase;
  const day = days[today] || null;
  const verdicts = assess(days, goal, today, finishedWorkouts());
  const first = verdicts[0];
  const total = Object.keys(days).length;
  const missed = missedYesterday(days, goal, today);

  return html`<section class="section state" data-state="${phase.mode}">
    ${title}
    <div class="card st-card">
      <div class="st-head">
        <span class="st-ic">${raw(icon(MODE_UI[phase.mode].icon, 22))}</span>
        <div class="st-title"><h4>${MODES[phase.mode].name}</h4><p>день ${phase.day} · с ${dayShort(dateAt(phase.from))}</p></div>
        ${entry.targetW ? html`<div class="st-goalw"><b>${num(entry.targetW)} кг</b><span>цель</span></div>` : ''}
      </div>
      ${targetsTable(entry, day)}
      ${todayBlock(today, day, entry, draftDays(), missed)}
      ${weekStrip(days, goal, today, missed)}
    </div>
    ${kpis(days, goal, today, phase.mode)}
    ${first ? total ? html`<a class="st-verdict ${first.level} tap" data-nav="#/diary">${raw(icon(VERDICT_ICON[first.level], 20))}<div><p>${nb(first.text)}</p>
      <span>${verdicts.length > 1 ? `Ещё ${verdicts.length - 1} ${plural(verdicts.length - 1, ['вывод', 'вывода', 'выводов'])} и графики` : 'Графики и история'} ${raw(icon('right', 14))}</span></div></a>`
      // Дневник ещё пуст: история пока пустая — ведём к первой записи
      : html`<a class="st-verdict ${first.level} tap" data-nav="#/diary/today">${raw(icon(VERDICT_ICON[first.level], 20))}<div><p>${nb(first.text)}</p>
      <span>Заполнить первый день ${raw(icon('right', 14))}</span></div></a>` : ''}
    <div class="card list st-links">
      <a class="list-row tap" data-nav="#/diary"><div><b>Дневник и графики</b><span>${total ? `${total} ${plural(total, ['день', 'дня', 'дней'])} · вес, калории, сон` : 'вес, калории, сон'}</span></div>${raw(icon('right', 18, 'muted'))}</a>
      <a class="list-row tap" data-nav="#/goal"><div><b>Режим и нормы</b><span>сменить режим, калории и БЖУ</span></div>${raw(icon('right', 18, 'muted'))}</a>
    </div>
  </section>`;
}
