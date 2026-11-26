// Точка входа Mini App: хранилище, Telegram, хэш-роутер и нижняя навигация.
import {
  initStore, activeWorkout, setMirror, mergeRemote, mergesKey, mergeKey, cloudWipePending, cloudWipeDone, resetEpoch, resetWait, getGoal, allDiaryDays,
} from './storage.js';
import { diaryDue, diaryDate } from './diary.js';
import { initTelegram, showBack, cloudMirror, cloudReadAll, cloudAvailable } from './telegram.js';
import { closeTopSheet, installPressFeedback, toast } from './ui/components.js';
import { icon } from './ui/icons.js';
import { initRest } from './ui/rest.js';
import { on } from './ui/dom.js';
import * as today from './ui/today.js';
import * as workout from './ui/workout.js';
import * as summary from './ui/summary.js';
import * as plan from './ui/plan.js';
import * as library from './ui/library.js';
import * as exercise from './ui/exercise.js';
import * as progress from './ui/progress.js';
import * as profile from './ui/profile.js';
import * as goal from './ui/goal.js';
import * as day from './ui/day.js';
import * as diary from './ui/diary.js';

const TABS = [
  ['today', 'Сегодня', 'today'],
  ['plan', 'План', 'plan'],
  ['library', 'Упражнения', 'library'],
  ['progress', 'Прогресс', 'progress'],
  ['profile', 'Профиль', 'profile'],
];

// [шаблон, модуль, опции]. parent — куда вести «Назад», если истории нет.
const ROUTES = [
  [/^#\/today$/, today, { tab: 'today' }],
  [/^#\/plan$/, plan, { tab: 'plan' }],
  [/^#\/library$/, library, { tab: 'library' }],
  [/^#\/progress$/, progress, { tab: 'progress' }],
  [/^#\/profile$/, profile, { tab: 'profile' }],
  [/^#\/workout$/, workout, { parent: '#/today' }],
  [/^#\/w\/([\w-]+)$/, workout, { parent: '#/progress', edit: true }],
  [/^#\/summary\/([\w-]+)$/, summary, { parent: '#/today' }],
  [/^#\/ex\/(\w+)$/, exercise, { parent: '#/library' }],
  // Состояние и дневник живут внутри «Профиля»: «Назад» без истории ведёт туда. live — экран можно перерисовать
  // на месте, когда данные пришли из облака (формы восстанавливают набранное из черновика).
  [/^#\/goal$/, goal, { parent: '#/profile', live: true }],
  [/^#\/diary$/, diary, { parent: '#/profile', live: true }],
  [/^#\/diary\/(today|\d{4}-\d{2}-\d{2})$/, day, { parent: '#/profile', live: true }],
];

const view = document.getElementById('view');
const tabbar = document.getElementById('tabbar');
const stack = [];          // своя история хэшей, чтобы «Назад» работал предсказуемо
const leftAt = [];         // leftAt[i] — прокрутка экрана stack[i] в момент, когда с него ушли вперёд: «Назад» вернёт на то же место
let current = null;        // { route, cleanups }
let shownDay = null;       // дата дневника, при которой нарисован текущий экран (см. checkDay)
let tabLock = false;       // нижняя навигация ненадолго не реагирует на нажатия (см. render)

function match(hash) {
  for (const [re, mod, opts] of ROUTES) {
    const m = hash.match(re);
    if (m) return { mod, opts, params: m.slice(1), hash };
  }
  return null;
}

function teardown() {
  if (!current) return;
  for (const fn of current.cleanups.splice(0)) { try { fn(); } catch (e) { console.warn('cleanup', e); } }
}

function render(hash, { keepScroll = false, scrollTo = 0 } = {}) {
  const route = match(hash) || match('#/today');
  const y = window.scrollY;
  shownDay = diaryDate();
  // Двойное нажатие на кнопку в нижней панели формы («Сохранить», «Готово»): второе касание приходит уже на экран, куда
  // вернулись, и попадает во вкладку на том же месте. Поэтому сразу после возврата с вложенного экрана на вкладку
  // нижняя навигация треть секунды не реагирует.
  if (current && !current.route.opts.tab && route.opts.tab) {
    tabLock = true;
    setTimeout(() => { tabLock = false; }, 350);
  }
  teardown();
  while (closeTopSheet()) { /* закрыть шторки прошлого экрана */ }
  const cleanups = [];
  current = { route, cleanups };
  document.body.dataset.screen = route.opts.tab || 'sub';
  tabbar.hidden = !route.opts.tab;
  tabbar.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === route.opts.tab));
  showBack(!route.opts.tab);
  updateDiaryDot();
  view.innerHTML = '';
  const root = document.createElement('div');
  root.className = `screen screen-${route.opts.tab || route.mod.NAME || 'sub'}${keepScroll ? '' : ' enter'}`;
  view.appendChild(root);
  const ctx = {
    root,
    params: route.params,
    opts: route.opts,
    nav,
    back,
    cleanup: (fn) => cleanups.push(fn),
    refresh: () => render(route.hash, { keepScroll: true }),
    soft: keepScroll, // экран перерисован на месте (не открыт заново): форма не сообщает о «восстановленном черновике»
  };
  route.mod.render(ctx);
  window.scrollTo(0, keepScroll ? y : scrollTo);
}

/**
 * Перерисовать текущий экран на месте: данные изменились не из него самого (отмена в плашке, слияние с облаком).
 * Прокрутка сохраняется; поле формы, в котором стоял курсор, остаётся в фокусе, курсор — в конце набранного.
 */
function rerender() {
  if (!current) return;
  const field = view.contains(document.activeElement) ? document.activeElement.dataset.in : null;
  render(current.route.hash, { keepScroll: true });
  const inp = field ? view.querySelector(`[data-in="${field}"]`) : null;
  if (!inp) return;
  inp.focus({ preventScroll: true });
  if (inp.type === 'text' || inp.type === 'textarea') inp.setSelectionRange(inp.value.length, inp.value.length);
}

/**
 * Данные изменились не из текущего экрана (слияние с облаком, отмена «Очистить день» в плашке). Вкладки и экраны
 * состояния и дневника (live) перерисовываются на месте; остальные вложенные экраны (тренировка с набранным подходом,
 * упражнение с 3D-сценой) не трогаем — там только обновляется точка на вкладке.
 */
function dataChanged() {
  const { tab, live } = current?.route.opts || {};
  if (tab || live) rerender(); else updateDiaryDot();
}

function onHash() {
  const h = location.hash || '#/today';
  let scrollTo = 0;
  if (stack.length >= 2 && stack[stack.length - 2] === h) {
    // «Назад»: экран открывается там, где его оставили (список дней дневника, история тренировок), а не с самого верха
    stack.pop();
    scrollTo = leftAt[stack.length - 1] || 0;
  } else if (stack[stack.length - 1] !== h) {
    if (stack.length) leftAt[stack.length - 1] = window.scrollY;
    stack.push(h);
  }
  leftAt.length = stack.length;
  render(h, { scrollTo });
}

export function nav(hash, { replace = false } = {}) {
  if (hash === location.hash && !replace) return;
  if (replace) {
    stack.pop(); stack.push(hash);
    history.replaceState(null, '', hash);
    render(hash);
  } else location.hash = hash;
}

export function back() {
  if (closeTopSheet()) return;
  if (stack.length > 1) history.back();
  else nav(current?.route.opts.parent || '#/today', { replace: true });
}

/** Точка на вкладке «Профиль»: вечер, режим выбран, а дневник за сегодня ещё не заполнен. */
function updateDiaryDot() {
  const tab = tabbar.querySelector('[data-tab="profile"]');
  if (!tab) return;
  const due = diaryDue(allDiaryDays(), getGoal());
  tab.classList.toggle('due', due);
  tab.setAttribute('aria-label', due ? 'Профиль: пора заполнить дневник' : 'Профиль');
}

function renderTabbar() {
  tabbar.innerHTML = TABS.map(([id, label, ic]) =>
    `<button class="tab" data-tab="${id}" aria-label="${label}">${icon(ic, 24)}<span>${label}</span></button>`).join('');
  on(tabbar, 'click', '[data-tab]', (e, b) => {
    if (tabLock) return;
    const h = '#/' + b.dataset.tab;
    if (location.hash === h) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    stack.length = 0; stack.push(h);
    leftAt.length = 0;
    history.replaceState(null, '', h);
    render(h);
  });
}

/**
 * Пока приложение было открыто или свёрнуто, наступил новый день дневника (05:00): «сегодня» на экране устарело.
 * Вкладки и экраны состояния и дневника перерисовываются — форма «сегодня» становится формой нового дня, а набранное
 * за прошлый день остаётся в его черновике. Без этого запись следующего вечера ушла бы во вчерашнюю дату.
 */
function checkDay() {
  const today = diaryDate();
  if (shownDay && today !== shownDay) { shownDay = today; dataChanged(); } else updateDiaryDot();
}

// ───────── Облако Telegram ─────────

const RESYNC_PAUSE = 30000;   // не читать облако чаще, чем раз в полминуты (быстрые переключения между приложениями)
let syncing = null;           // идущее слияние
let syncCool = false;         // недавно слито
let syncRetry = null;         // таймер повтора после сбоя
let retryIn = 4000;
let mergedOnce = false;

/**
 * Прочитать облако и слить его с данными на устройстве. При запуске, при возвращении в приложение (давно открытое
 * приложение не знает о том, что за это время сохранило другое устройство), после «Сбросить все данные» и повтором
 * после сбоя. Пока слияние не удалось, зеркало ничего не пишет в облако: на новом телефоне локальная копия пуста,
 * и запись стёрла бы облачную.
 * @param {boolean} [force] не смотреть на паузу между слияниями
 */
function syncCloud(force = false) {
  if (syncing) return syncing;
  if (syncCool && !force) return Promise.resolve(false);
  clearTimeout(syncRetry);
  syncing = (async () => {
    try {
      let remote, changed;
      for (;;) {
        // Идущий «Сбросить все данные» сначала дотирает облако (два стирания сразу мешали бы друг другу)
        const busy = resetWait();
        if (busy) await busy;
        if (cloudWipePending()) {
          // Сброс не смог стереть облако (не было связи). Стираем до слияния — иначе оно вернёт удалённое.
          if (!(await cloudMirror.removeAll())) throw new Error('облако не очищено после сброса данных');
          cloudWipeDone();
        }
        const epoch = resetEpoch();
        remote = await cloudReadAll();
        // Пока читали, данные на устройстве сбросили: прочитанное относится к стёртому — читаем заново, после стирания
        if (epoch !== resetEpoch() || resetWait() || cloudWipePending()) continue;
        changed = mergeRemote(remote);
        break;
      }
      cloudMirror.open();
      retryIn = 4000;
      syncCool = true;
      setTimeout(() => { syncCool = false; }, RESYNC_PAUSE);
      if (changed) {
        // Вкладки безопасно перерисовать. Экраны состояния и дневника (live) — тоже: без этого запуск кнопкой
        // «📓 Дневник» на устройстве, куда данные только что пришли из облака, показал бы форму без режима и норм.
        // На вложенных экранах при первом слиянии ещё и сообщаем, что произошло.
        dataChanged();
        if (!mergedOnce && !current?.route.opts.tab) toast('Данные синхронизированы с облаком Telegram', 'good');
      }
      mergedOnce = true;
      return true;
    } catch (e) {
      console.warn('CloudStorage недоступно', e);
      syncRetry = setTimeout(() => syncCloud(true), retryIn);
      retryIn = Math.min(retryIn * 2, 60000);
      return false;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

async function boot() {
  initStore();
  initTelegram({ onBack: back });
  installPressFeedback();
  initRest();
  renderTabbar();

  // Глобальные ссылки и «Назад»
  on(document.body, 'click', '[data-nav]', (e, a) => { e.preventDefault(); nav(a.dataset.nav); });
  on(document.body, 'click', '[data-act="back"]', () => back());

  // Экран перерисовывается, когда данные поменялись не из него самого (отмена «Очистить день» в плашке).
  window.addEventListener('gym:refresh', dataChanged);

  // Telegram открывает Mini App с параметрами запуска в хэше (#tgWebAppData=…); telegram-web-app.js их уже прочитал,
  // поэтому заменяем такой хэш на экран. Незавершённая тренировка → сразу к ней.
  // Кнопка бота «📓 Дневник» открывает приложение с ?open=diary: параметр стоит в запросе, потому что хэш занят
  // Telegram. Он срабатывает только при запуске — после перезагрузки остаёшься на том экране, где был.
  const open = new URLSearchParams(location.search).get('open');
  const startHash = match(location.hash) ? location.hash : open === 'diary' ? '#/diary/today' : '#/today';
  history.replaceState(null, '', activeWorkout() && startHash === '#/today' ? '#/workout' : startHash);
  window.addEventListener('hashchange', onHash);
  onHash();

  // Точка «пора заполнить дневник» и само «сегодня» зависят от времени: проверяем раз в минуту и при возвращении
  // в приложение (страницу могли заморозить и разбудить без visibilitychange — поэтому ещё pageshow и focus).
  setInterval(checkDay, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDay(); });
  window.addEventListener('pageshow', checkDay);
  window.addEventListener('focus', checkDay);

  // Облачное зеркало Telegram: слить и продолжать дублировать записи. Зеркало подключается сразу (сохранённое копится
  // в нём), но пишет в облако только после первого удачного слияния — см. syncCloud и правила в telegram.js.
  if (cloudAvailable) {
    cloudMirror.merger = { test: mergesKey, merge: mergeKey };
    cloudMirror.onPulled = dataChanged;
    // После сброса данных зеркало закрыто: облако стирается (если не вышло — повтором, когда появится связь),
    // читается и сливается заново, и только потом запись снова открыта
    cloudMirror.onReset = () => { syncCool = false; syncCloud(true); };
    setMirror(cloudMirror);
    document.addEventListener('visibilitychange', () => { if (document.hidden) cloudMirror.flush(); else syncCloud(); });
    // Окно Telegram Desktop может весь день оставаться видимым (visibilitychange не приходит): тогда облако читается
    // при возвращении в окно и при открытии дня дневника — форма вечером видит утреннее взвешивание с телефона.
    // Пауза между чтениями та же (RESYNC_PAUSE).
    window.addEventListener('focus', () => syncCloud());
    window.addEventListener('pageshow', () => syncCloud());
    window.addEventListener('hashchange', () => { if (/^#\/diary\//.test(location.hash)) syncCloud(); });
    window.addEventListener('online', () => syncCloud(true));
    await syncCloud(true);
  }
}

boot();
