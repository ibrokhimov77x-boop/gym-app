// Экран «Профиль»: состояние (режим и дневник), параметры тела, таймер отдыха, экспорт/импорт, синхронизация с ботом, сброс данных.
import { packAll, SEND_LIMIT } from '../sync.js';
import {
  getProfile, updateProfile, finishedWorkouts, allDiaryDays, getGoal, pendingSync, markSent, requeueAll, exportData, importData, resetAll,
} from '../storage.js';
import { inTelegram, canSendToBot, sendToBot, cloudAvailable, cloudMirror, cloudStatus, haptic } from '../telegram.js';
import { html, raw, on, plural, hhmm, num } from './dom.js';
import { icon } from './icons.js';
import { pageHeader, segmented, confirmSheet, openSheet, toast, snackbar, parseNum } from './components.js';
import { stateSection } from './state.js';
import { glue, joinParts } from './diary-model.js';

export const NAME = 'profile';

/** Подсказка, если отправка в бота недоступна. */
export function sendHint() {
  return inTelegram
    ? 'Отправка работает, только если приложение открыто кнопкой «🏋️ Тренировка» или «📓 Дневник» внизу чата с ботом (клавиатура бота). Закрой и открой его оттуда.'
    : 'Открой приложение в Telegram кнопкой «🏋️ Тренировка» или «📓 Дневник» в чате с ботом, чтобы отправлять тренировки и дневник. Пока они хранятся здесь и в экспорте.';
}

const WORKOUTS = ['тренировка', 'тренировки', 'тренировок'];
const DIARY_DAYS = ['день дневника', 'дня дневника', 'дней дневника'];

/** ['2 тренировки', '1 день дневника', 'режим'] по количествам (число не отрывается от слова при переносе строки). */
const countParts = (workouts, days, goal) => [
  workouts ? glue(`${workouts} ${plural(workouts, WORKOUTS)}`) : '',
  days ? glue(`${days} ${plural(days, DIARY_DAYS)}`) : '',
  goal ? 'режим' : '',
].filter(Boolean);

/**
 * Что ждёт отправки боту, словами: «2 тренировки · 1 день дневника · режим». Пустая строка — всё отправлено.
 * Точка-разделитель приклеена к следующей части: при переносе строка начинается с «· …», а не кончается висящей точкой.
 */
export function pendingText(p = pendingSync()) {
  return joinParts(countParts(p.workouts.length, p.days.length, !!p.goal));
}

/**
 * Что не поместится в одну посылку (sendData принимает не больше 4096 байт) и останется в очереди до следующей
 * отправки: «2 тренировки и 7 дней дневника». Пустая строка — уйдёт всё. Показывать до отправки: после неё Telegram
 * закрывает приложение.
 * @param {object} [p] pendingSync()
 * @param {{ dates?: string[], ids?: string[] }|null} [first] что отправляется в первую очередь (sync.packAll)
 */
export function leftoverText(p = pendingSync(), first = null) {
  const { data, left } = packAll(p, SEND_LIMIT, first);
  if (!data) return ''; // не уйдёт ничего — об этом скажет сама отправка
  return andList(countParts(left.workouts, left.days, left.goal));
}
/** ['a', 'b', 'c'] → «a, b и c». */
const andList = (parts) => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} и ${parts[parts.length - 1]}` : parts.join(''));

const CLOUD_WAIT = 2000; // сколько ждать запись в облако перед sendData, мс
let sending = false;
const nothingQueued = (p) => !p.goal && !p.days.length && !p.workouts.length;

/**
 * Отправить боту всё неотправленное одной посылкой: режим, дни дневника и тренировки (sendData закрывает приложение).
 * Что не поместилось в 4096 байт, остаётся в очереди до следующей отправки. Перед sendData только что сохранённое
 * дописывается в облако (ждём не дольше двух секунд): Telegram закрывает приложение сразу после sendData, и запись,
 * начатая после него, до облака уже не дойдёт.
 * @param {{ dates?: string[], ids?: string[] }|null} [first] то, что отправляют с этого экрана (день формы,
 *   тренировка итога), — уходит первым, даже если очередь длинная
 * @returns {Promise<boolean>} true — посылка ушла и очереди очищены; false — отправлять нечего или отправка не удалась
 */
export async function sendUnsynced(first = null) {
  if (sending) return false;
  if (nothingQueued(pendingSync())) { toast('Всё уже отправлено', 'good'); return false; }
  if (!packAll(pendingSync(), SEND_LIMIT, first).data) { toast('Тренировка слишком большая для отправки — используй экспорт', 'bad'); return false; }
  sending = true;
  try {
    if (navigator.onLine !== false) await Promise.race([cloudMirror.flush(), new Promise((r) => { setTimeout(r, CLOUD_WAIT); })]);
    // Посылка собирается только теперь: запись в облако перед ней сливает облачную копию и могла принести более
    // свежую версию дня или режима (или другое устройство уже всё отправило). Отправленной считается то, что в ней.
    const pending = pendingSync();
    if (nothingQueued(pending)) { toast('Всё уже отправлено', 'good'); return false; }
    // «Повтор» — только когда облако в этом запуске уже прочитано и слито: иначе в нём могут оказаться устаревшие
    // копии дней (правку с другого устройства это устройство ещё не видело)
    if (cloudAvailable && !cloudStatus().ready) pending.repeat = null;
    const res = packAll(pending, SEND_LIMIT, first);
    if (!res.data) { toast('Тренировка слишком большая для отправки — используй экспорт', 'bad'); return false; }
    // Запись в localStorage синхронная — успеваем отметить отправленное сразу после sendData.
    // Если sendData бросит исключение, очереди останутся нетронутыми.
    try { sendToBot(res.data); } catch (e) { console.warn('sendData', e); toast('Не удалось отправить — попробуй ещё раз', 'bad'); return false; }
    markSent(res);
    cloudMirror.flush(); // если Telegram приложение не закрыл — очередь в облаке тоже обновится
    haptic.success();
    return true;
  } finally {
    sending = false;
  }
}

/** То же по нажатию кнопки: пока идёт отправка, кнопка неактивна и показывает, что занята. */
export async function sendFrom(btn, first = null) {
  if (!btn || btn.disabled) return false;
  btn.disabled = true;
  btn.classList.add('busy');
  try { return await sendUnsynced(first); } finally { btn.disabled = false; btn.classList.remove('busy'); }
}

/**
 * Что уйдёт вместе с тем, что отправляют с экрана (first), и что останется: «Вместе с ним уйдут 3 дня дневника и режим;
 * ещё 7 дней дневника — следующей отправкой.» Если сам он уже отправлен (в посылке его нет) — «Уйдут 3 дня дневника…».
 * Пустая строка — с ним не уйдёт ничего и ничего не останется.
 * @param {object} p pendingSync()
 * @param {{ dates?: string[], ids?: string[] }} first
 * @param {string} [pronoun] «ним» (день) / «ней» (тренировка)
 */
export function alongText(p, first, pronoun = 'ним') {
  const res = packAll(p, SEND_LIMIT, first);
  if (!res.data) return '';
  const fd = new Set(first.dates || []), fw = new Set(first.ids || []);
  const along = countParts(res.ids.filter((id) => !fw.has(id)).length, res.dates.filter((d) => !fd.has(d)).length, res.goal);
  const left = countParts(res.left.workouts, res.left.days, res.left.goal);
  const withIt = res.ids.some((id) => fw.has(id)) || res.dates.some((d) => fd.has(d)); // само оно в посылке
  // «уйдёт 1 день / 21 день / режим», «уйдут 3 дня и режим»
  const one = along.length === 1 && (along[0] === 'режим' || /^(\d*[02-9])?1\s/.test(along[0]));
  const verb = one ? 'уйдёт' : 'уйдут';
  const out = [];
  if (along.length) out.push(`${withIt ? `Вместе с ${pronoun} ${verb}` : verb.charAt(0).toUpperCase() + verb.slice(1)} ${andList(along)}`);
  if (left.length) out.push(`${along.length ? 'ещё' : 'Ещё'} ${andList(left)} — следующей отправкой`);
  return out.length ? `${out.join('; ')}.` : '';
}

/** Подпись про облако Telegram для экрана «Профиль». */
function cloudLine(cs) {
  if (!cloudAvailable) return { text: 'недоступно', cls: 'muted' };
  if (!cs.ready) return cs.readOk === false ? { text: 'нет связи — пока только на устройстве', cls: 'warn-text' } : { text: 'подключается…', cls: 'muted' };
  return cs.ok ? { text: `включено${cs.at ? ` · ${hhmm(cs.at)}` : ''}`, cls: 'good-text' } : { text: 'ошибка записи — повторю', cls: 'bad-text' };
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function doImport(text, ctx) {
  try {
    const { added, updated, days, goal } = importData(JSON.parse(text));
    toast(`Импорт: тренировок новых ${added}, обновлено ${updated}${days ? `; дней дневника ${days}` : ''}${goal ? '; режим' : ''}`, 'good');
    ctx.refresh();
  } catch (e) { toast(`Не удалось импортировать: ${e.message}`, 'bad'); }
}

export function render(ctx) {
  const { root } = ctx;
  const p = getProfile();
  const pending = pendingSync();
  const unsent = pendingText(pending);
  const total = finishedWorkouts().length;
  const diaryDays = Object.keys(allDiaryDays()).length;
  const canSend = canSendToBot();
  const leftover = canSend && unsent ? leftoverText(pending) : '';
  const cloud = cloudLine(cloudStatus());
  const stored = total + diaryDays + (getGoal() ? 1 : 0); // есть ли что отправлять заново
  const bmi = p.bodyweight && p.heightCm ? p.bodyweight / (p.heightCm / 100) ** 2 : null;

  root.innerHTML = html`
    ${pageHeader('Профиль', { kicker: inTelegram ? 'Telegram' : 'Браузер' })}

    ${stateSection()}

    <section class="section">
      <h3 class="section-title">${raw(icon('profile', 18))} Тело</h3>
      <div class="card list">
        <label class="list-row field-row"><div><b>Вес тела</b><span>для гравитрона и заметок</span></div>
          <div class="num-field"><input type="text" inputmode="decimal" value="${p.bodyweight ? num(p.bodyweight) : ''}" placeholder="—" data-f="bodyweight"><span>кг</span></div></label>
        <label class="list-row field-row"><div><b>Рост</b><span>${bmi ? `ИМТ ${bmi.toFixed(1).replace('.', ',')}` : 'необязательно'}</span></div>
          <div class="num-field"><input type="text" inputmode="numeric" value="${p.heightCm ?? ''}" placeholder="—" data-f="heightCm"><span>см</span></div></label>
      </div>
    </section>

    <section class="section">
      <h3 class="section-title">${raw(icon('timer', 18))} Таймер отдыха</h3>
      <div class="card pad">
        <p class="section-sub">Отдых между подходами берётся из плана. Для дополнительных упражнений — значение ниже.</p>
        ${segmented('rest', [[60, '1:00'], [90, '1:30'], [120, '2:00'], [180, '3:00']], p.restDefault, 'wide')}
        <label class="switch-row"><span><b>Запускать автоматически</b><small>после каждого записанного подхода</small></span><input type="checkbox" class="switch" data-f="autoRest" ${p.autoRest ? 'checked' : ''}></label>
      </div>
    </section>

    <section class="section">
      <h3 class="section-title">${raw(icon('send', 18))} Синхронизация с ботом</h3>
      <div class="card pad sync">
        <div class="sync-row"><span>Telegram</span><b class="${inTelegram ? 'good-text' : 'muted'}">${inTelegram ? 'открыто в Telegram' : 'обычный браузер'}</b></div>
        <div class="sync-row"><span>Облако Telegram</span><b class="${cloud.cls}" data-cloud>${cloud.text}</b></div>
        <div class="sync-row"><span>Не отправлено в бота</span><b class="${unsent ? 'warn-text' : 'good-text'}" data-unsent>${unsent || 'всё отправлено'}</b></div>
        ${leftover ? html`<p class="hint" data-leftover>${raw(icon('info', 16))} За один раз всё не поместится: останется ${leftover}. После отправки открой приложение снова и отправь остаток.</p>` : ''}
        ${canSend ? html`<button class="btn btn-primary wide" data-act="send" ${unsent ? '' : 'disabled'}>${raw(icon('send', 20))} Отправить в бот</button>`
          : html`<p class="hint">${raw(icon('info', 16))} ${sendHint()}</p>`}
        ${canSend && stored && !unsent ? html`<button class="link-btn sync-again" data-act="resend">Бот что-то не получил? ${glue('Отправить всё заново')} ${raw(icon('right', 16))}</button>` : ''}
      </div>
    </section>

    <section class="section">
      <h3 class="section-title">${raw(icon('layers', 18))} Данные</h3>
      <div class="card list">
        <button class="list-row tap" data-act="export"><div><b>Экспорт в JSON</b><span>${total} ${plural(total, WORKOUTS)}${diaryDays ? ` · ${diaryDays} ${plural(diaryDays, DIARY_DAYS)}` : ''} · файл</span></div>${raw(icon('download', 20, 'muted'))}</button>
        <button class="list-row tap" data-act="copy"><div><b>Скопировать JSON</b><span>в буфер обмена</span></div>${raw(icon('copy', 20, 'muted'))}</button>
        <label class="list-row tap"><div><b>Импорт из JSON</b><span>слияние по id, новые записи побеждают</span></div>${raw(icon('upload', 20, 'muted'))}<input type="file" accept="application/json,.json" data-file hidden></label>
        <button class="list-row tap" data-act="paste"><div><b>Вставить JSON текстом</b><span>если файл не открывается</span></div>${raw(icon('note', 20, 'muted'))}</button>
      </div>
    </section>

    <section class="section">
      <button class="btn btn-danger-soft wide" data-act="reset">${raw(icon('trash', 18))} Сбросить все данные</button>
      <p class="footnote">Верх / Низ / Руки и плечи · данные хранятся на устройстве${cloudAvailable ? ' и в облаке Telegram' : ''}.</p>
    </section>`.s;

  ctx.cleanup(on(root, 'change', '[data-f]', (e, inp) => {
    const f = inp.dataset.f;
    if (f === 'autoRest') { updateProfile({ autoRest: inp.checked }); return; }
    const v = parseNum(inp.value);
    updateProfile({ [f]: v > 0 ? v : null });
    toast('Сохранено', 'good');
    ctx.refresh();
  }));
  ctx.cleanup(on(root, 'change', '[data-file]', async (e, inp) => {
    const f = inp.files?.[0];
    if (f) doImport(await f.text(), ctx);
  }));
  ctx.cleanup(on(root, 'click', '[data-act]', async (e, b) => {
    const act = b.dataset.act;
    const json = () => JSON.stringify(exportData(), null, 1);
    if (act === 'seg') { updateProfile({ restDefault: +b.dataset.v }); ctx.refresh(); }
    if (act === 'send' && await sendFrom(b)) ctx.refresh(); // Telegram закрывает приложение сам; если не закрыл — покажем, что очередь пуста
    if (act === 'resend') {
      const what = [getGoal() ? 'режим и нормы' : '', diaryDays ? glue(`${diaryDays} ${plural(diaryDays, DIARY_DAYS)}`) : '', total ? glue(`${total} ${plural(total, WORKOUTS)}`) : ''].filter(Boolean);
      const ok = await confirmSheet({
        title: 'Отправить боту всё заново?',
        text: `В очередь встанет всё, что есть в приложении: ${what.join(', ')}. Это нужно, если бот был выключен дольше суток (Telegram хранит сообщения для него 24 часа) или потерял свои данные. То, что у бота уже есть, не задвоится. Потом нажми «Отправить в бот»; если за один раз всё не поместится, приложение подскажет.`,
        ok: 'В очередь',
      });
      if (!ok) return;
      requeueAll();
      toast('Готово: нажми «Отправить в бот»', 'good');
      ctx.refresh();
    }
    if (act === 'export') { download(`gym-${new Date().toISOString().slice(0, 10)}.json`, json()); toast('Файл сохранён', 'good'); }
    if (act === 'copy') { const ok = await copy(json()); toast(ok ? 'JSON скопирован' : 'Не удалось скопировать', ok ? 'good' : 'bad'); }
    if (act === 'paste') pasteSheet(ctx);
    if (act === 'reset') {
      const ok = await confirmSheet({
        title: 'Сбросить все данные?',
        // Другое устройство со старой копией данных при следующем запуске вернёт их в облако (метки сброса в облаке
        // пока нет — см. NOTES.md, Step 6), поэтому об этом надо сказать здесь, а не обещать, что всё удалено везде.
        text: 'Все тренировки, дневник с режимом, настройки и копия в облаке Telegram будут удалены. Это нельзя отменить. Сначала сделай экспорт, если данные нужны. Если приложение открывали ещё где-то (Telegram на компьютере, второй телефон), сбрось данные и там — иначе оно вернёт их в облако.',
        ok: 'Удалить всё', danger: true,
      });
      if (!ok) return;
      // На устройстве данные стираются сразу; облако — следом. Если до него не достучаться, оно сотрётся, как только
      // появится связь (до любого чтения из него), и об этом надо сказать, а не обещать, что всё удалено.
      const cloudGone = resetAll();
      toast('Данные удалены');
      ctx.nav('#/today', { replace: true });
      if (!(await cloudGone)) snackbar('Копию в облаке Telegram стереть не удалось — нет связи. Она сотрётся, как только связь появится; до тех пор новое хранится только на этом устройстве.', { ms: 9000 });
    }
  }));
}

function pasteSheet(ctx) {
  openSheet({
    title: 'Импорт JSON',
    body: html`<label class="field"><span>Вставь содержимое файла экспорта</span><textarea rows="8" data-json placeholder='{"app":"gym-upper-lower", …}'></textarea></label>
      <div class="btn-row"><button class="btn btn-secondary" data-close>Отмена</button><button class="btn btn-primary" data-go>Импортировать</button></div>`,
    onMount(el, close) {
      el.querySelector('[data-go]').onclick = () => { const t = el.querySelector('[data-json]').value; close(); doImport(t, ctx); };
    },
  });
}
