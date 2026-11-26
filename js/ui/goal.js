// Экран «Режим и нормы» (#/goal): сушка / набор / поддержание / рекомпозиция и свои нормы калорий и БЖУ.
// Цифры вводит пользователь; приложение их никогда не меняет — только показывает, что получается, и подсказывает.
import { MODES, diaryDate, addDays, phaseAt, periodSummary, latestWeight, macroKcal, normalizeEntry } from '../diary.js';
import { getGoal, allDiaryDays, getProfile, saveGoalEntry } from '../storage.js';
import { haptic } from '../telegram.js';
import { html, raw, on, num, dayShort, dayLong } from './dom.js';
import { icon } from './icons.js';
import { subHeader, toast } from './components.js';
import { numField, setHint, setAside, markInvalid, setValue, bindFields } from './fields.js';
import {
  MODE_UI, MODE_ORDER, MACRO_GAP, DECIMALS, RANGE_TEXT, modeAbout, modeRateKg, dateAt, kg, kcalText, nb, macroGap,
  entryToForm, invalidGoalFields, goalDiffers, getDraft, putDraft, dropDraft, lastClosedDay, glue, joinParts,
} from './diary-model.js';

export const NAME = 'goal';

/** На экране сейчас показано сообщение «восстановлено то, что ты вводил» (чтобы оно пережило перерисовку на месте). */
let tipShown = false;

/** «2150 ккал · Б 165 · … · цель 76 кг»: части не рвутся посередине («цель» / «76 кг»), точка не висит в конце строки. */
const entryLine = (e) => joinParts([e.kcal != null ? `${kcalText(e.kcal)} ккал` : '', e.p != null ? `Б ${num(e.p)}` : '', e.f != null ? `Ж ${num(e.f)}` : '', e.c != null ? `У ${num(e.c)}` : '',
  e.targetW ? `цель ${num(e.targetW)} кг` : ''].filter(Boolean).map(glue)) || 'нормы не заданы';

export function render(ctx) {
  const { root } = ctx;
  const goal = getGoal(), days = allDiaryDays(), today = diaryDate();
  const phase = phaseAt(goal, today);
  const cur = phase?.entry || null;
  // Пометка объясняет именно эту запись норм. Пока числа прежние, правится пометка нынешних норм — открыто: поле
  // показывает её, а под ним сказано, к каким нормам она относится. Как только меняется число, нормы, заданные раньше
  // сегодняшнего дня, станут новой записью (с сегодня) — её пометка начинается пустой, а прежняя названа под полем
  // (если человек пометку не трогал): иначе история объясняла бы новые нормы старой причиной. Запись, сделанная
  // сегодня, правится вместе со своей пометкой.
  const curNote = cur?.note || '';
  const base = entryToForm(cur);
  const draft = getDraft('goal');
  const restored = !!draft && goalDiffers(draft.v, base);
  const form = restored ? { ...base, ...draft.v } : { ...base };
  if (draft && !restored) dropDraft('goal');
  // Пометку человек правил сам (пустая из черновика прежней версии, где она начиналась пустой, — не в счёт)
  let noteTouched = restored && typeof draft.v.note === 'string' && draft.v.note !== curNote && draft.v.note !== '';
  /** Сохранение создаст новую запись норм (числа или режим изменились, а нынешние нормы — не сегодняшние). */
  const targetsChanged = () => goalDiffers({ ...form, note: curNote }, base);
  const newEntry = () => !!cur && cur.from !== today && targetsChanged();
  // Сообщение о восстановленном вводе — когда экран открыли заново; перерисовку на месте (ctx.soft) оно переживает,
  // но само при ней не появляется.
  const showRestored = restored && (!ctx.soft || tipShown);
  tipShown = showRestored;
  // Текущий вес — для пересчёта в граммы на килограмм и расстояния до цели: среднее за ту же неделю, что на «Профиле».
  const end = lastClosedDay(days, today);
  const week = periodSummary(days, goal, addDays(end, -6), end);
  const bw = week.wAvg ?? latestWeight(days, today)?.w ?? getProfile().bodyweight ?? null;
  const history = [...(goal?.entries || [])].reverse();

  root.innerHTML = html`
    ${subHeader('Режим и нормы', { sub: cur ? `${MODES[cur.mode].name} · день ${phase.day}` : 'цифры задаёшь ты' })}
    ${showRestored ? html`<div class="tip">${raw(icon('edit', 18))}<p>Восстановлено то, что ты вводил в прошлый раз и не сохранил.</p></div>` : ''}

    <p class="field-label">Режим</p>
    <div class="g-modes" role="radiogroup" aria-label="Режим">
      ${MODE_ORDER.map((m) => html`<button class="pick g-mode ${form.mode === m ? 'on' : ''}" role="radio" aria-checked="${form.mode === m}" data-act="mode" data-v="${m}">
        <span class="g-mode-ic">${raw(icon(MODE_UI[m].icon, 20))}</span><b>${MODES[m].name}</b><span>${nb(modeAbout(m))}</span></button>`)}
    </div>
    <p class="g-note" data-mode-note hidden></p>

    <section class="card d-card">
      <header class="d-card-head">${raw(icon('target', 18))}<h3>Нормы на день</h3><span>твои цифры</span></header>
      ${numField({ key: 'kcal', label: 'Калории', unit: 'ккал', big: true, mode: 'numeric', max: 5, value: form.kcal })}
      <div class="d-macros">
        ${numField({ key: 'p', label: 'Белки', unit: 'г', value: form.p })}
        ${numField({ key: 'f', label: 'Жиры', unit: 'г', value: form.f })}
        ${numField({ key: 'c', label: 'Углеводы', unit: 'г', value: form.c })}
      </div>
      <div class="d-sum" data-sum hidden></div>
    </section>

    <section class="card d-card">
      <header class="d-card-head">${raw(icon('scale', 18))}<h3>Целевой вес</h3><span>необязательно</span></header>
      ${numField({ key: 'targetW', label: 'К какому весу идёшь', unit: 'кг', value: form.targetW, enter: 'done' })}
    </section>

    <section class="card d-card">
      <header class="d-card-head">${raw(icon('note', 18))}<h3>Пометка</h3><span>для себя</span></header>
      <textarea rows="2" maxlength="300" data-in="note" aria-label="Пометка" placeholder="${nb('Зачем и до какого срока: «минус 4 кг к Новому году»')}">${form.note}</textarea>
      <span class="d-hint" data-hint="note"></span>
    </section>

    <p class="footnote left">Новые нормы действуют с сегодняшнего дня (${dayLong(dateAt(today))}); у прошлых дней остаются прежние.
      ${nb('Приложение нормы само не меняет — только подсказывает, когда их стоит поправить.')}</p>

    ${history.length ? html`<section class="section">
      <h3 class="section-title">${raw(icon('layers', 18))} История норм</h3>
      <div class="card list">${history.map((e) => html`<div class="list-row g-hist">
        <div><b>с ${dayShort(dateAt(e.from))} · ${MODES[e.mode].name}</b><span>${entryLine(e)}</span>${e.note ? html`<span class="g-hist-note">«${e.note}»</span>` : ''}</div>
        ${e === cur ? html`<div class="list-right"><span class="badge accent">сейчас</span></div>` : ''}
      </div>`)}</div>
    </section>` : ''}

    <div class="cta-spacer"></div>
    <div class="cta-dock"><button class="btn btn-primary btn-xl" data-act="save" disabled>${raw(icon('check', 22))}<span data-save-label>${cur ? 'Сохранить нормы' : 'Сохранить режим'}<small>действует с сегодня</small></span></button></div>`.s;

  const sumEl = root.querySelector('[data-sum]');
  const noteEl = root.querySelector('[data-mode-note]');
  const saveBtn = root.querySelector('[data-act="save"]');
  const saveLabel = root.querySelector('[data-save-label]');
  const noteInput = root.querySelector('[data-in="note"]');
  const notePlaceholder = noteInput.placeholder;
  let saveKey = '';

  /** Обновить подсказки и кнопку под то, что сейчас в форме. */
  function paint() {
    const n = normalizeEntry({ ...form, mode: form.mode || 'cut', from: today }) || {};
    const bad = invalidGoalFields(form);
    markInvalid(root, bad);

    // Режим: ориентир темпа в килограммах — когда известен вес (в процентах он уже написан на самой карточке режима)
    const rate = form.mode ? modeRateKg(form.mode, bw) : null;
    const modeNote = [
      rate ? `Ориентир для веса ${kg(bw, 1)} кг: ${rate}.` : '',
      form.mode && cur && form.mode !== cur.mode ? 'Со сменой режима отсчёт дней начнётся заново.' : '',
    ].filter(Boolean).join(' ');
    noteEl.hidden = !modeNote;
    noteEl.textContent = nb(modeNote);

    // Калории и БЖУ
    const mk = macroKcal(n);
    if (bad.includes('kcal')) setHint(root, 'kcal', RANGE_TEXT.kcal, 'bad'); else setHint(root, 'kcal');
    for (const k of ['p', 'f', 'c']) {
      if (bad.includes(k)) setHint(root, k, RANGE_TEXT[k], 'bad');
      else setHint(root, k, n[k] != null && bw ? `${num(n[k] / bw)} г на кг` : '');
    }
    const gap = macroGap(mk, n.kcal);
    sumEl.hidden = mk == null;
    if (mk != null) {
      const off = gap != null && Math.abs(gap) > MACRO_GAP;
      sumEl.className = `d-sum ${off ? 'warn' : ''}`;
      sumEl.innerHTML = html`<p>${nb(off
        ? `По БЖУ выходит ${mk} ккал — на ${Math.round(Math.abs(gap) * 100)} % ${gap > 0 ? 'больше' : 'меньше'}, чем в поле «Калории». Проверь цифры.`
        : `По БЖУ выходит ${mk} ккал`)}</p>
        ${n.kcal == null || off ? html`<button class="chip-btn" data-act="use-macro" data-v="${mk}">Поставить ${mk}</button>` : ''}`.s;
    }

    // Целевой вес
    if (bad.includes('targetW')) setHint(root, 'targetW', RANGE_TEXT.targetW, 'bad');
    else if (!bw) setHint(root, 'targetW'); // «необязательно» уже написано в заголовке карточки
    else if (n.targetW == null) setHint(root, 'targetW', `Сейчас ${kg(bw, 1)} кг`);
    else {
      const d = n.targetW - bw;
      const odd = (form.mode === 'cut' && d > 0.5) || (form.mode === 'bulk' && d < -0.5);
      setHint(root, 'targetW', Math.abs(d) < 0.05 ? `Сейчас ${kg(bw, 1)} кг — уже на цели`
        : `Сейчас ${kg(bw, 1)} кг — ${d < 0 ? 'сбросить' : 'набрать'} ${num(Math.abs(d))} кг${odd ? `. Для режима «${MODES[form.mode].name}» цель обычно ${d > 0 ? 'ниже' : 'выше'} текущего веса` : ''}`, odd ? 'warn' : '');
    }
    setAside(root, 'targetW', n.targetW != null && bw ? `${n.targetW < bw ? '−' : '+'}${num(Math.abs(n.targetW - bw))} кг` : '');

    // Пометка: пока числа прежние — это пометка нынешних норм (поле её показывает); изменились — новая запись со своей
    // пометкой (пустой, прежняя названа под полем), если человек сам пометку не трогал
    const fresh = newEntry();
    if (!noteTouched) {
      const want = fresh ? '' : curNote;
      if (form.note !== want) { form.note = want; setValue(root, 'note', want); }
    }
    // Прежняя пометка — строкой под полем, а не подсказкой в нём: длинная подсказка в поле на две строки обрезалась
    noteInput.placeholder = fresh ? 'Пометка к новым нормам — необязательно' : notePlaceholder;
    const noteOnly = !!cur && !targetsChanged() && form.note !== curNote;
    setHint(root, 'note', noteOnly ? `Правишь пометку норм от ${dayShort(dateAt(cur.from))} — сами нормы не меняются`
      : fresh && curNote ? `У норм от ${dayShort(dateAt(cur.from))} остаётся своя пометка: «${curNote}»` : '');

    const dirty = goalDiffers(form, base);
    saveBtn.disabled = !form.mode || !dirty;
    const key = noteOnly ? 'note' : cur ? 'targets' : 'mode';
    if (key !== saveKey) {
      saveKey = key;
      saveLabel.innerHTML = noteOnly ? html`Сохранить пометку<small>нормы не меняются</small>`.s
        : html`${cur ? 'Сохранить нормы' : 'Сохранить режим'}<small>действует с сегодня</small>`.s;
    }
    return { dirty, bad, noteOnly };
  }

  function changed() {
    const { dirty } = paint();
    if (dirty) putDraft('goal', form); else dropDraft('goal');
  }

  paint();

  ctx.cleanup(bindFields(root, {
    decimals: DECIMALS,
    order: ['kcal', 'p', 'f', 'c', 'targetW'],
    onChange(key, value) {
      if (key === 'note') noteTouched = true;
      form[key] = value;
      changed();
    },
  }));

  ctx.cleanup(on(root, 'click', '[data-act]', (e, b) => {
    const act = b.dataset.act;
    if (act === 'mode') {
      form.mode = b.dataset.v;
      root.querySelectorAll('[data-act="mode"]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
      haptic.select();
      changed();
    }
    if (act === 'use-macro') {
      form.kcal = b.dataset.v;
      setValue(root, 'kcal', form.kcal);
      changed();
    }
    if (act === 'save') {
      const bad = invalidGoalFields(form);
      if (!form.mode) { toast('Сначала выбери режим', 'bad'); return; }
      if (bad.length) {
        toast('Проверь выделенные поля', 'bad');
        haptic.error();
        root.querySelector(`[data-in="${bad[0]}"]`)?.focus();
        return;
      }
      const { noteOnly } = paint();
      saveGoalEntry({ mode: form.mode, kcal: form.kcal, p: form.p, f: form.f, c: form.c, targetW: form.targetW, note: form.note });
      dropDraft('goal');
      haptic.success();
      toast(noteOnly ? 'Пометка сохранена' : cur ? 'Нормы сохранены' : 'Режим сохранён', 'good');
      ctx.back();
    }
  }));
}
