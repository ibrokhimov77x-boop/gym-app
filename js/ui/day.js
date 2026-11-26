// Вечерняя форма дневника (#/diary/<дата> и #/diary/today): питание, утренний вес, подъём, отбой, заметка.
// Её заполняют в кровати одной рукой: крупные поля, нужные клавиатуры, время подъёма подставлено «как обычно»,
// отбой — кнопкой «Сейчас». Всё набранное сразу пишется в черновик и переживает закрытие приложения.
import {
  MODES, RULES, diaryDate, addDays, dayDiff, isDate, toMin, phaseAt, macroKcal, dayCheck, normalizeDay, isEmptyDay,
  latestWeight, sleepMinutes,
} from '../diary.js';
import { getGoal, getDiaryDay, allDiaryDays, saveDiaryDay, deleteDiaryDay, restoreDiaryDay, markDayUnsynced, isDayQueued, pendingSync } from '../storage.js';
import { canSendToBot, inTelegram, haptic } from '../telegram.js';
import { html, raw, on, plural, dayShort, dayLong, isoDay, hhmm } from './dom.js';
import { icon } from './icons.js';
import { subHeader, toast, snackbar, emptyState, openSheet } from './components.js';
import { numField, timeField, setHint, setAside, setMeter, markInvalid, setValue, bindFields } from './fields.js';
import {
  MODE_UI, MACRO_GAP, DECIMALS, RANGE_TEXT, DAY_KEYS, dateAt, dayTitle, dayRel, kg, kcalText, signed, nb, hmLong, usualWake, plannedSleep,
  dayToForm, invalidFields, formDiffers, kcalHint, macroHint, macroGap, getDraft, putDraft, dropDraft, draftDays, dayClosed, warnSide, glue, joinParts,
} from './diary-model.js';
import { sendFrom, leftoverText } from './profile.js';

export const NAME = 'day';

const p2 = (n) => String(n).padStart(2, '0');
/** Время «HH:MM» — как в полях формы (hhmm из dom.js пишет «0:40»). */
const clock = (t) => { const d = new Date(t); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
/** Дата дня, на форме которого сейчас висит сообщение «восстановлен черновик» (чтобы оно пережило перерисовку на месте). */
let tipDate = null;

export function render(ctx) {
  const { root } = ctx;
  const today = diaryDate();
  const date = ctx.params[0] === 'today' ? today : ctx.params[0];
  // День «из будущего» открывается, только если он уже сохранён (часы телефона спешили) — чтобы его можно было очистить
  const future = isDate(date) && date > today;
  if (!isDate(date) || (future && !getDiaryDay(date))) {
    root.innerHTML = html`${subHeader('Дневник')}${emptyState('calendar', isDate(date) ? 'Этот день ещё не наступил' : 'Нет такого дня',
      'Дневник заполняется за сегодня и за прошедшие дни.', html`<button class="btn btn-primary" data-nav="#/diary/today">К сегодняшнему дню</button>`)}`.s;
    return;
  }

  const days = allDiaryDays();
  const goal = getGoal();
  const phase = phaseAt(goal, date);
  const entry = phase?.entry || null;
  const hasTargets = !!entry && ['kcal', 'p', 'f', 'c'].some((k) => entry[k] != null); // режим может быть выбран без чисел
  const stored = getDiaryDay(date);
  const base = dayToForm(stored);
  const isToday = date === today;
  const prevDate = addDays(date, -1);
  const prevDay = days[prevDate] || null;
  const prevWord = isToday ? 'вчера' : 'накануне';
  const canSend = canSendToBot();
  const wakeNext = usualWake(days, addDays(date, 1));

  // Форма: сохранённый день → поверх — поля, которые человек сам менял и не сохранил (черновик). В черновике только
  // такие поля: если после первого же нажатия из облака придёт этот же день с другого устройства (утром там записали
  // вес и подъём), набранное ляжет поверх него, а не сотрёт его пустыми полями. Черновик старше сохранённого дня
  // (день с тех пор поправили) уже не годится.
  let draft = getDraft(date);
  if (draft && stored && Date.parse(stored.upd) - draft.t > 5000) { dropDraft(date); draft = null; }
  const sug = new Set(); // поля-подсказки, которых человек не трогал: в новой форме их нет (см. usual), остались для старых черновиков
  const touched = new Set(); // поля, которые меняли руками
  let form = { ...base };
  // Обычное время подъёма не подставляется в поле само: нетронутая догадка сохранялась бы как настоящее время,
  // а медиана следующих дней считалась бы уже из догадок. Его предлагает кнопка «Как обычно — 07:00» (одно касание).
  const usual = usualWake(days, date);
  let restored = false;
  if (draft) {
    const mine = DAY_KEYS.filter((k) => typeof draft.v[k] === 'string' && !draft.sug.includes(k));
    const merged = { ...form };
    for (const k of mine) merged[k] = draft.v[k];
    if (formDiffers(merged, base, new Set([...sug].filter((k) => !mine.includes(k))))) {
      form = merged;
      for (const k of mine) { touched.add(k); sug.delete(k); }
      restored = true;
    } else dropDraft(date);
  }
  // Остался несохранённый черновик за один из прошлых дней (например, форму «сегодня» оставили открытой на ночь,
  // и она стала формой нового дня) — напоминаем о нём прямо здесь.
  const olderDraft = isToday ? draftDays().filter((d) => d < date).pop() : null;

  // О восстановленном черновике сообщаем, когда форму открыли заново. При перерисовке на месте (ctx.soft: отмена,
  // слияние с облаком посреди ввода) сообщение не появляется из ниоткуда, но и не пропадает, если уже было показано.
  const showRestored = restored && (!ctx.soft || tipDate === date);
  tipDate = showRestored ? date : null;

  const night = isToday && isoDay(Date.now()) !== today;
  // Переключатель дней — с числами («‹ 25», «27 ›»): иначе стрелка «предыдущий день» выглядела как «Назад» в той же строке
  const nextDate = addDays(date, 1);
  const dayNav = html`<div class="d-nav" role="group" aria-label="Другой день">
    <button class="d-step" data-act="prev" aria-label="Предыдущий день, ${dayShort(dateAt(prevDate))}">${raw(icon('left', 16))}<span>${dateAt(prevDate).getDate()}</span></button>
    <button class="d-step" data-act="next" aria-label="Следующий день${isToday || future ? '' : `, ${dayShort(dateAt(nextDate))}`}" ${isToday || future ? 'disabled' : ''}><span>${dateAt(nextDate).getDate()}</span>${raw(icon('right', 16))}</button>
  </div>`;

  // Под «Сегодня» и «Вчера» — полная дата; у более давних дней дата уже в заголовке, поэтому под ней — как давно это было.
  const ago = dayDiff(date, today);
  root.innerHTML = html`
    ${subHeader(dayTitle(date, today), { sub: future ? `${dayLong(dateAt(date))} ${date.slice(0, 4)} г.` : ago < 2 ? dayLong(dateAt(date)) : `${ago} ${plural(ago, ['день', 'дня', 'дней'])} назад`, right: dayNav })}
    <div class="d-top">
      ${phase ? html`<span class="badge accent">${raw(icon(MODE_UI[phase.mode].icon, 13))} ${MODES[phase.mode].name} · день ${phase.day}</span>`
        : goal ? html`<span class="badge">до начала режима</span>`
          : html`<a class="badge warn tap" data-nav="#/goal">режим не выбран · выбрать ${raw(icon('right', 12))}</a>`}
      <span class="d-state" data-state></span>
    </div>
    ${night ? html`<div class="tip">${raw(icon('moon', 18))}<p>${nb('Сейчас ночь: до 05:00 записи идут в день, который заканчивается, —')} <b>${dayLong(dateAt(date))}</b>.</p></div>` : ''}
    ${future ? html`<div class="tip warn">${raw(icon('alert', 18))}<p>${nb('Дата этого дня ещё не наступила: его сохранили, когда часы телефона спешили. Бот такой день не примет — если он ошибочный, очисти его.')}</p></div>` : ''}
    ${showRestored ? html`<div class="tip">${raw(icon('edit', 18))}<p>${stored
      ? `Несохранённые правки${draft.t ? ` от ${isoDay(draft.t) === isoDay(Date.now()) ? hhmm(draft.t) : dayShort(draft.t)}` : ''} — поля с ними отмечены, под ними сохранённые значения. Сохрани правки или верни сохранённое.`
      : `Восстановлен несохранённый черновик${draft.t ? ` от ${isoDay(draft.t) === isoDay(Date.now()) ? hhmm(draft.t) : dayShort(draft.t)}` : ''}. Проверь и нажми «Сохранить».`}</p></div>` : ''}
    <div class="d-edits" data-edits hidden><span>${raw(icon('edit', 16))} Есть правки</span><button class="chip-btn" data-act="discard">Вернуть сохранённое</button></div>
    ${olderDraft ? html`<a class="tip tap" data-nav="#/diary/${olderDraft}" data-older-draft>${raw(icon('edit', 18))}<p>${nb(`Не сохранён черновик за ${dayRel(olderDraft, today)} —`)} <span class="tip-go">открыть ${raw(icon('right', 14))}</span></p></a>` : ''}

    <section class="card d-card">
      <header class="d-card-head">${raw(icon('food', 18))}<h3>Питание за день</h3>${hasTargets ? html`<span>нормы — твои</span>`
        : entry ? html`<a class="tap" data-nav="#/goal">задать нормы ${raw(icon('right', 12))}</a>` : ''}</header>
      ${numField({ key: 'kcal', label: 'Калории', unit: 'ккал', big: true, mode: 'numeric', max: 5, value: form.kcal, meter: true })}
      <div class="d-macros">
        ${numField({ key: 'p', label: 'Белки', unit: 'г', value: form.p, meter: true })}
        ${numField({ key: 'f', label: 'Жиры', unit: 'г', value: form.f, meter: true })}
        ${numField({ key: 'c', label: 'Углеводы', unit: 'г', value: form.c, meter: true })}
      </div>
      <div class="d-sum" data-sum hidden></div>
    </section>

    <section class="card d-card">
      <header class="d-card-head">${raw(icon('sun', 18))}<h3>Утро</h3></header>
      <div class="d-pair">
        ${numField({ key: 'w', label: 'Вес натощак', unit: 'кг', value: form.w, enter: 'done' })}
        ${timeField({ key: 'wake', label: 'Проснулся', value: form.wake,
          below: html`<button class="d-usual" data-act="usual-wake" hidden>${raw(icon('sun', 16))}<span></span></button>` })}
      </div>
      <div class="d-sleep" data-sleep></div>
    </section>

    <section class="card d-card">
      <header class="d-card-head">${raw(icon('moon', 18))}<h3>Вечер</h3></header>
      ${timeField({ key: 'bed', label: isToday ? 'Ложусь спать' : 'Лёг спать', value: form.bed,
        after: isToday ? html`<button class="btn btn-secondary d-now" data-act="now">${raw(icon('clock', 20))} Сейчас</button>` : '' })}
    </section>

    <section class="card d-card">
      <header class="d-card-head">${raw(icon('note', 18))}<h3>Заметка</h3><span data-count></span></header>
      <textarea rows="2" maxlength="300" data-in="note" aria-label="Заметка" placeholder="Самочувствие, голод, как прошла тренировка…">${form.note}</textarea>
    </section>

    <button class="d-clear" data-act="clear" hidden>${raw(icon('trash', 18))}<span data-clear-text></span></button>
    ${canSend ? '' : html`<p class="footnote left">${raw(icon('send', 14))} ${inTelegram
      ? 'Отправить день тренеру можно, когда приложение открыто кнопкой «📓 Дневник» или «🏋️ Тренировка» внизу чата с ботом.'
      : 'Тренер в боте получит день, когда откроешь приложение в Telegram кнопкой бота: неотправленное хранится здесь.'}</p>`}
    <div class="cta-spacer" data-spacer></div>
    <div class="cta-dock"><div class="d-dock" data-dock></div></div>`.s;

  const stateEl = root.querySelector('[data-state]');
  const sumEl = root.querySelector('[data-sum]');
  const sleepEl = root.querySelector('[data-sleep]');
  const dockEl = root.querySelector('[data-dock]');
  const spacerEl = root.querySelector('[data-spacer]');
  const clearBtn = root.querySelector('[data-act="clear"]');
  const countEl = root.querySelector('[data-count]');
  const usualBtn = root.querySelector('[data-act="usual-wake"]');
  const editsEl = root.querySelector('[data-edits]');
  const prevW = latestWeight(days, prevDate);
  const firstDay = !Object.keys(days).some((d) => d < date); // раньше этого дня записей нет
  let dockKey = '';

  /**
   * Очередь отправки вместе с этим днём в том виде, в каком он сейчас в форме (сохранённым или нет), — чтобы заранее
   * честно сказать, уйдёт ли за один раз всё.
   */
  function queueWithDay() {
    const p = pendingSync();
    const day = normalizeDay(form);
    p.days = [...p.days.filter((d) => d.date !== date), { date, day: isEmptyDay(day) ? null : day, upd: new Date().toISOString() }]; // с версией, как уйдёт
    return p;
  }

  /** Кнопки нижней панели под текущее состояние формы. */
  function dockHtml(dirty, pending) {
    const sendBtn = (act, label, small) => html`<button class="btn btn-primary btn-xl" data-act="${act}">${raw(icon('send', 20))}<span>${label}<small>${small}</small></span></button>`;
    if (canSend) {
      // Этот день уходит первым (sync.packAll, first). Если вся очередь в одну посылку не помещается — говорим здесь
      // же, что остальное уйдёт потом (подробно — на «Профиле»).
      const tooLong = (dirty || pending) && leftoverText(queueWithDay(), { dates: [date] }) ? 'уйдёт этот день, остальное — позже' : ''; // в одну строку даже на 360 px
      if (dirty) return html`${sendBtn('save-send', 'Сохранить и отправить тренеру', tooLong || 'приложение закроется, бот пришлёт разбор')}
        <button class="btn btn-secondary" data-act="save">Сохранить без отправки</button>`;
      if (stored && pending) return html`${sendBtn('send', 'Отправить тренеру', tooLong || 'день сохранён, но ещё не отправлен')}
        <button class="btn btn-secondary" data-act="back">Готово</button>`;
      // Подтверждения доставки у sendData нет: если бот был выключен дольше суток, он этот день не получил.
      if (stored) return html`<button class="btn btn-secondary btn-xl" data-act="back">${raw(icon('check', 20, 'good-text'))}<span>Готово<small>сохранено и отправлено тренеру</small></span></button>
        <button class="link-btn d-again" data-act="resend">Бот не ответил? Отправить ещё раз</button>`;
      return html`<button class="btn btn-primary btn-xl" disabled>${raw(icon('send', 20))}<span>Сохранить и отправить тренеру<small>сначала заполни день</small></span></button>`;
    }
    if (dirty) return html`<button class="btn btn-primary btn-xl" data-act="save">${raw(icon('check', 22))} Сохранить</button>`;
    if (stored) return html`<button class="btn btn-secondary btn-xl" data-act="back">Готово</button>`;
    return html`<button class="btn btn-primary btn-xl" data-act="save" disabled>${raw(icon('check', 22))} Сохранить</button>`;
  }

  /**
   * Правка сохранённого дня: что было в поле до неё («было 2125»). Поле отмечается, а сохранённое значение видно под
   * ним — иначе прежние цифры (жиры и углеводы больше нигде в приложении не показаны) приходилось вспоминать.
   */
  const was = (k) => (stored && form[k] !== base[k] ? `было ${base[k] || '—'}` : '');
  const hint = (k, text = '', cls = '') => {
    root.querySelector(`[data-field="${k}"]`)?.classList.toggle('edited', !!was(k));
    setHint(root, k, joinParts([was(k), text].filter(Boolean)), cls);
  };

  /** Обновить подсказки, статус и кнопки под то, что сейчас в форме. Возвращает true, если есть несохранённое. */
  function paint() {
    const n = normalizeDay(form);
    const bad = invalidFields(form);
    markInvalid(root, bad);
    const chk = dayCheck(n, entry);

    // Калории: норма, остаток (у законченного дня — сколько не хватило), коридор; промах окрашивается по режиму
    const closed = dayClosed(date, today, n);
    const side = warnSide(phase?.mode);
    setAside(root, 'kcal', chk.kcal.target != null ? `норма ${kcalText(chk.kcal.target)}` : '');
    if (bad.includes('kcal')) setHint(root, 'kcal', RANGE_TEXT.kcal, 'bad');
    else { const h = kcalHint(chk.kcal, '', { mode: phase?.mode, closed }); hint('kcal', h.text, h.cls); }
    setMeter(root, 'kcal', chk.kcal.v, chk.kcal.target, { band: RULES.kcalTolerance, cls: chk.kcal.ok ? 'ok' : chk.kcal.ok === false && (chk.kcal.pct > 0 ? side.over : side.under) ? 'warn' : '' });

    // Белки, жиры, углеводы
    for (const k of ['p', 'f', 'c']) {
      if (bad.includes(k)) setHint(root, k, RANGE_TEXT[k], 'bad');
      else { const h = macroHint(chk[k], { closed }); hint(k, h.text, h.cls); }
      setMeter(root, k, chk[k].v, chk[k].target, { cls: chk[k].ok ? 'ok' : '' });
    }
    const mk = macroKcal(n);
    const gap = macroGap(mk, n.kcal);
    sumEl.hidden = mk == null;
    if (mk != null) {
      const off = gap != null && Math.abs(gap) > MACRO_GAP;
      sumEl.className = `d-sum ${off ? 'warn' : ''}`;
      sumEl.innerHTML = html`<p>${nb(off
        ? `По БЖУ выходит ${mk} ккал — на ${Math.round(Math.abs(gap) * 100)} % ${gap > 0 ? 'больше' : 'меньше'} введённых калорий. Проверь цифры.`
        : `По БЖУ выходит ${mk} ккал`)}</p>
        ${n.kcal == null ? html`<button class="chip-btn" data-act="use-macro" data-v="${mk}">Подставить</button>` : ''}`.s;
    }

    // Вес: с чем сравнить
    if (bad.includes('w')) setHint(root, 'w', RANGE_TEXT.w, 'bad');
    else if (!prevW) hint('w', 'утром, до еды и воды');
    else {
      const when = dayDiff(prevW.date, date) === 1 ? prevWord : dayShort(dateAt(prevW.date));
      const d = n.w == null ? null : n.w - prevW.w;
      if (d != null && Math.abs(d) > 3) hint('w', `Проверь: ${when} было ${kg(prevW.w)} кг`, 'warn');
      else hint('w', `${when} ${kg(prevW.w)}${d == null ? '' : ` · ${signed(d, 2)}`}`);
    }

    // Подъём (пустое поле — кнопка с обычным временем) и сон прошлой ночью
    hint('wake');
    usualBtn.hidden = !usual || !!n.wake;
    if (!usualBtn.hidden) usualBtn.querySelector('span').textContent = `${glue(`в ${usual},`)} ${glue('как обычно')}`; // в узкой колонке — в две строки
    const sl = n.wake && prevDay?.bed ? sleepMinutes({ [prevDate]: prevDay, [date]: { wake: n.wake } }, date) : null;
    const sleepText = sl != null ? hmLong(sl) : !prevDay?.bed ? '—' : !n.wake ? '—' : 'проверь время';
    // Самый первый день дневника: считать сон ещё не из чего — объясняем, а не просим «указать вчера».
    const sleepSub = sl != null ? `лёг ${prevWord} в ${prevDay.bed}`
      : !prevDay?.bed ? (firstDay ? (isToday ? 'посчитается завтра: от отбоя до подъёма' : 'считается от отбоя накануне до подъёма')
        : `нет времени отбоя за ${isToday ? 'вчера' : dayShort(dateAt(prevDate))}`)
        : !n.wake ? 'укажи, во сколько проснулся' : 'получилось не от 1 до 16 часов';
    sleepEl.innerHTML = html`${raw(icon('moon', 18))}<div><span>Сон прошлой ночью</span><small>${sleepSub}</small></div>
      ${!prevDay?.bed && !firstDay ? html`<button class="chip-btn" data-act="fill-prev">Указать</button>` : html`<b class="${sl != null && sl < RULES.sleepMin ? 'warn-text' : ''}">${sleepText}</b>`}`.s;

    // Отбой
    if (n.bed) {
      const plan = isToday && wakeNext ? plannedSleep(n.bed, wakeNext) : null;
      setAside(root, 'bed', toMin(n.bed) < 720 ? 'после полуночи' : '');
      hint('bed', plan != null ? `до подъёма в ${wakeNext} — ${hmLong(plan)} сна` : '', plan != null && plan < RULES.sleepMin ? 'warn' : '');
    } else {
      setAside(root, 'bed', '');
      hint('bed', isToday ? 'нажми «Сейчас», когда ложишься' : '');
    }

    countEl.textContent = form.note.length >= 240 ? `${form.note.length}/300` : '';

    // Статус и кнопки
    const dirty = formDiffers(form, base, sug);
    const pending = !!stored && isDayQueued(date);
    editsEl.hidden = !(dirty && stored); // правку сохранённого дня можно отбросить, не очищая сам день
    stateEl.className = `d-state ${dirty ? 'dirty' : stored ? 'saved' : ''}`;
    stateEl.innerHTML = dirty ? 'не сохранено'
      : stored ? `${icon('check', 14)} сохранено ${isoDay(stored.upd) === isoDay(Date.now()) ? `в ${clock(stored.upd)}` : dayShort(stored.upd)}` : '';
    clearBtn.hidden = !stored && !dirty;
    clearBtn.querySelector('[data-clear-text]').textContent = stored ? 'Очистить день' : 'Сбросить введённое';
    const key = `${dirty}|${pending}`;
    if (key !== dockKey) { // кнопки не пересоздаём без нужды: иначе нажатие в момент обновления теряется
      dockKey = key;
      dockEl.innerHTML = dockHtml(dirty, pending).s;
      spacerEl.style.height = `${dockEl.parentElement.offsetHeight + 8}px`;
    }
    return dirty;
  }

  function changed() {
    if (paint()) putDraft(date, Object.fromEntries([...touched].map((k) => [k, form[k]]))); else dropDraft(date);
  }

  /**
   * Форма «сегодня» пережила смену дня дневника (05:00) и не перерисовалась: страницу заморозили и разбудили без
   * событий, по которым app.js это замечает. Тогда перед сохранением спрашиваем, за какой день запись.
   * @returns {Promise<string|null>} дата или null — человек закрыл вопрос, ничего не сохраняем
   */
  function targetDay() {
    const now = diaryDate();
    if (ctx.params[0] !== 'today' || now === date) return Promise.resolve(date);
    return new Promise((resolve) => {
      let picked = null;
      openSheet({
        title: 'За какой день запись?',
        body: html`<p class="sheet-text">${nb(`Эта форма открыта со вчера: она за ${dayLong(dateAt(date))}, а сейчас уже ${dayLong(dateAt(now))}.`)}</p>
          <div class="btn-col">
            <button class="btn btn-primary" data-pick="${now}">За сегодня — ${dayShort(dateAt(now))}</button>
            <button class="btn btn-secondary" data-pick="${date}">За ${dayShort(dateAt(date))}, как в форме</button>
          </div>`,
        onMount(el, close) { el.querySelectorAll('[data-pick]').forEach((b) => { b.onclick = () => { picked = b.dataset.pick; close(); }; }); },
        onClose: () => resolve(picked),
      });
    });
  }

  /**
   * Сохранить день. Возвращает дату, за которую сохранено, или false, если сохранять нельзя (ошибка в поле) или
   * человек отказался выбирать день.
   */
  async function save() {
    const bad = invalidFields(form);
    if (bad.length) {
      toast('Проверь выделенные поля', 'bad');
      haptic.error();
      root.querySelector(`[data-in="${bad[0]}"]`)?.focus();
      return false;
    }
    const target = await targetDay();
    if (!target) return false;
    // В другой день переносится только набранное руками — поверх того, что в нём уже записано (утренний вес и т. п.).
    saveDiaryDay(target, target === date ? form : { ...dayToForm(getDiaryDay(target)), ...Object.fromEntries([...touched].map((k) => [k, form[k]])) });
    dropDraft(date);
    return target;
  }

  /**
   * В форме стёрто всё: «Сохранить» тогда означает «очистить день» (с отменой). Негодное число в поле — не пустая
   * форма: его надо поправить, а не молча выбросить, поэтому такой случай уходит в save() и подсвечивает поле.
   */
  const wiped = () => !invalidFields(form).length && isEmptyDay(normalizeDay(form));

  /**
   * Очистить день (или сбросить набранное) с возможностью отмены. «Отменить» возвращает сохранённый день таким, каким
   * он был, — и в очереди отправки тоже: день, который бот уже получил, не становится «не отправленным». Правки поверх
   * очищенного дня не возвращаются: чтобы отбросить их, есть «Вернуть сохранённое».
   */
  function clearDay() {
    const prevRec = getDiaryDay(date);
    const wasQueued = isDayQueued(date);
    const prevDraft = prevRec ? null : getDraft(date);
    if (prevRec) deleteDiaryDay(date);
    dropDraft(date);
    haptic.warning();
    ctx.refresh();
    snackbar(prevRec ? 'День очищен' : 'Введённое сброшено', {
      action: 'Отменить',
      onAction() {
        if (prevRec) restoreDiaryDay(date, prevRec, wasQueued);
        if (prevDraft) putDraft(date, prevDraft.v, prevDraft.sug);
        haptic.success();
        window.dispatchEvent(new Event('gym:refresh'));
      },
    });
  }

  /** Отбросить несохранённые правки сохранённого дня: форма снова показывает сохранённое (с отменой). */
  function discardEdits() {
    const prevDraft = getDraft(date);
    dropDraft(date);
    haptic.select();
    ctx.refresh();
    snackbar('Вернул сохранённое', {
      action: 'Отменить',
      onAction() {
        if (prevDraft) putDraft(date, prevDraft.v, prevDraft.sug);
        window.dispatchEvent(new Event('gym:refresh'));
      },
    });
  }

  paint();

  ctx.cleanup(bindFields(root, {
    decimals: DECIMALS,
    order: ['kcal', 'p', 'f', 'c', 'w'],
    onChange(key, value) {
      if (form[key] === value) return;
      form[key] = value;
      sug.delete(key);
      touched.add(key);
      changed();
    },
  }));

  ctx.cleanup(on(root, 'click', '[data-act]', async (e, b) => {
    switch (b.dataset.act) {
      case 'prev': ctx.nav(`#/diary/${prevDate}`, { replace: true }); break;
      // «Указать» время отбоя накануне: вчерашний день открывается поверх этого — после «Сохранить» возвращаешься сюда
      case 'fill-prev': ctx.nav(`#/diary/${prevDate}`); break;
      case 'next': if (!isToday && !future) { const d = addDays(date, 1); ctx.nav(`#/diary/${d === today ? 'today' : d}`, { replace: true }); } break;
      case 'now': {
        const t = new Date();
        form.bed = `${p2(t.getHours())}:${p2(t.getMinutes())}`;
        sug.delete('bed');
        touched.add('bed');
        setValue(root, 'bed', form.bed);
        haptic.select();
        changed();
        break;
      }
      case 'usual-wake':
        form.wake = usual;
        touched.add('wake');
        setValue(root, 'wake', usual);
        haptic.select();
        changed();
        break;
      case 'use-macro':
        form.kcal = b.dataset.v;
        touched.add('kcal');
        setValue(root, 'kcal', form.kcal);
        changed();
        break;
      case 'clear': clearDay(); break;
      case 'discard': discardEdits(); break;
      case 'save':
        if (wiped()) { clearDay(); break; }
        if (!(await save())) break;
        haptic.success();
        toast('День сохранён', 'good');
        ctx.back();
        break;
      case 'save-send': {
        if (wiped()) { clearDay(); break; }
        const saved = await save();
        if (!saved) break;
        // Этот день уходит первым, даже если очередь длинная. sendData закрывает приложение; если Telegram его
        // не закрыл (или отправка не удалась) — показываем итог.
        if (await sendFrom(b, { dates: [saved] })) { toast('Отправлено тренеру', 'good'); ctx.back(); } else ctx.refresh();
        break;
      }
      case 'send':
        if (await sendFrom(b, { dates: [date] })) { toast('Отправлено тренеру', 'good'); ctx.back(); }
        break;
      case 'resend': // день уже отправлялся, но бот мог его не получить — ставим в очередь ещё раз
        markDayUnsynced(date);
        if (await sendFrom(b, { dates: [date] })) { toast('Отправлено тренеру ещё раз', 'good'); ctx.back(); } else ctx.refresh();
        break;
      default:
    }
  }));
}
