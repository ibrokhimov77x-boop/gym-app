// Экран «Профиль»: параметры тела, таймер отдыха, экспорт/импорт, синхронизация с ботом, сброс данных.
import { packForSend } from '../sync.js';
import {
  getProfile, getState, updateProfile, finishedWorkouts, getWorkout, markSynced, exportData, importData, resetAll,
} from '../storage.js';
import { inTelegram, canSendToBot, sendToBot, cloudAvailable, cloudStatus, haptic } from '../telegram.js';
import { html, raw, on, plural, hhmm, num } from './dom.js';
import { icon } from './icons.js';
import { pageHeader, segmented, confirmSheet, openSheet, toast, parseNum } from './components.js';

export const NAME = 'profile';

/** Подсказка, если отправка в бота недоступна. */
export function sendHint() {
  return inTelegram
    ? 'Отправка работает, только если приложение открыто кнопкой «🏋️ Тренировка» внизу чата с ботом (клавиатура бота). Закрой и открой его оттуда.'
    : 'Открой приложение в Telegram кнопкой «🏋️ Тренировка» в чате с ботом, чтобы отправлять тренировки. Пока они хранятся здесь и в экспорте.';
}

/** Отправить неотправленные тренировки в бота (sendData закрывает приложение). */
export function sendUnsynced() {
  const ids = getState().unsynced;
  const ws = ids.map(getWorkout).filter((w) => w && w.end).sort((a, b) => new Date(a.start) - new Date(b.start));
  if (!ws.length) { toast('Всё уже отправлено', 'good'); return; }
  const { data, ids: sent } = packForSend(ws);
  if (!data) { toast('Тренировка слишком большая для отправки — используй экспорт', 'bad'); return; }
  // sendData закрывает приложение асинхронно, а запись в localStorage синхронная — успеваем отметить сразу после.
  // Если sendData бросит исключение, очередь останется нетронутой.
  try { sendToBot(data); } catch (e) { console.warn('sendData', e); toast('Не удалось отправить — попробуй ещё раз', 'bad'); return; }
  markSynced(sent);
  haptic.success();
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
    const { added, updated } = importData(JSON.parse(text));
    toast(`Импорт: новых ${added}, обновлено ${updated}`, 'good');
    ctx.refresh();
  } catch (e) { toast(`Не удалось импортировать: ${e.message}`, 'bad'); }
}

export function render(ctx) {
  const { root } = ctx;
  const p = getProfile();
  const unsynced = getState().unsynced.filter((id) => getWorkout(id)?.end);
  const total = finishedWorkouts().length;
  const canSend = canSendToBot();
  const cs = cloudStatus();
  const bmi = p.bodyweight && p.heightCm ? p.bodyweight / (p.heightCm / 100) ** 2 : null;

  root.innerHTML = html`
    ${pageHeader('Профиль', { kicker: inTelegram ? 'Telegram' : 'Браузер' })}

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
        <div class="sync-row"><span>Облако Telegram</span><b class="${cloudAvailable ? (cs.ok ? 'good-text' : 'bad-text') : 'muted'}">${cloudAvailable ? (cs.ok ? `включено${cs.at ? ` · ${hhmm(cs.at)}` : ''}` : 'ошибка записи') : 'недоступно'}</b></div>
        <div class="sync-row"><span>Не отправлено в бота</span><b class="${unsynced.length ? 'warn-text' : 'good-text'}">${unsynced.length} ${plural(unsynced.length, ['тренировка', 'тренировки', 'тренировок'])}</b></div>
        ${canSend ? html`<button class="btn btn-primary wide" data-act="send" ${unsynced.length ? '' : 'disabled'}>${raw(icon('send', 20))} Отправить в бот</button>`
          : html`<p class="hint">${raw(icon('info', 16))} ${sendHint()}</p>`}
      </div>
    </section>

    <section class="section">
      <h3 class="section-title">${raw(icon('layers', 18))} Данные</h3>
      <div class="card list">
        <button class="list-row tap" data-act="export"><div><b>Экспорт в JSON</b><span>${total} ${plural(total, ['тренировка', 'тренировки', 'тренировок'])} · файл</span></div>${raw(icon('download', 20, 'muted'))}</button>
        <button class="list-row tap" data-act="copy"><div><b>Скопировать JSON</b><span>в буфер обмена</span></div>${raw(icon('copy', 20, 'muted'))}</button>
        <label class="list-row tap"><div><b>Импорт из JSON</b><span>слияние по id, новые записи побеждают</span></div>${raw(icon('upload', 20, 'muted'))}<input type="file" accept="application/json,.json" data-file hidden></label>
        <button class="list-row tap" data-act="paste"><div><b>Вставить JSON текстом</b><span>если файл не открывается</span></div>${raw(icon('note', 20, 'muted'))}</button>
      </div>
    </section>

    <section class="section">
      <button class="btn btn-danger-soft wide" data-act="reset">${raw(icon('trash', 18))} Сбросить все данные</button>
      <p class="footnote">Upper/Lower · данные хранятся на устройстве${cloudAvailable ? ' и в облаке Telegram' : ''}.</p>
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
    if (act === 'send') sendUnsynced();
    if (act === 'export') { download(`gym-${new Date().toISOString().slice(0, 10)}.json`, json()); toast('Файл сохранён', 'good'); }
    if (act === 'copy') { const ok = await copy(json()); toast(ok ? 'JSON скопирован' : 'Не удалось скопировать', ok ? 'good' : 'bad'); }
    if (act === 'paste') pasteSheet(ctx);
    if (act === 'reset') {
      const ok = await confirmSheet({
        title: 'Сбросить все данные?',
        text: 'Все тренировки, настройки и копия в облаке Telegram будут удалены. Это нельзя отменить. Сначала сделай экспорт, если данные нужны.',
        ok: 'Удалить всё', danger: true,
      });
      if (!ok) return;
      resetAll();
      toast('Данные удалены');
      ctx.nav('#/today', { replace: true });
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
