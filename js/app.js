// Точка входа Mini App: хранилище, Telegram, хэш-роутер и нижняя навигация.
import { initStore, MODE, activeWorkout, setMirror, mergeRemote, allWorkouts, seedDemo } from './storage.js';
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
];

const view = document.getElementById('view');
const tabbar = document.getElementById('tabbar');
const stack = [];          // своя история хэшей, чтобы «Назад» работал предсказуемо
let current = null;        // { route, cleanups }

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

function render(hash, { keepScroll = false } = {}) {
  const route = match(hash) || match('#/today');
  const y = window.scrollY;
  teardown();
  while (closeTopSheet()) { /* закрыть шторки прошлого экрана */ }
  const cleanups = [];
  current = { route, cleanups };
  document.body.dataset.screen = route.opts.tab || 'sub';
  tabbar.hidden = !route.opts.tab;
  tabbar.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === route.opts.tab));
  showBack(!route.opts.tab);
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
  };
  route.mod.render(ctx);
  window.scrollTo(0, keepScroll ? y : 0);
}

function onHash() {
  const h = location.hash || '#/today';
  if (stack.length >= 2 && stack[stack.length - 2] === h) stack.pop();
  else if (stack[stack.length - 1] !== h) stack.push(h);
  render(h);
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

function renderTabbar() {
  tabbar.innerHTML = TABS.map(([id, label, ic]) =>
    `<button class="tab" data-tab="${id}" aria-label="${label}">${icon(ic, 24)}<span>${label}</span></button>`).join('');
  on(tabbar, 'click', '[data-tab]', (e, b) => {
    const h = '#/' + b.dataset.tab;
    if (location.hash === h) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    stack.length = 0; stack.push(h);
    history.replaceState(null, '', h);
    render(h);
  });
}

async function boot() {
  initStore();
  if (MODE === 'demo' && !allWorkouts().length) {
    const { buildDemo } = await import('./ui/demo.js');
    seedDemo(buildDemo());
  }
  if (MODE === 'demo') document.body.classList.add('is-demo');
  initTelegram({ onBack: back });
  installPressFeedback();
  initRest();
  renderTabbar();

  // Глобальные ссылки и «Назад»
  on(document.body, 'click', '[data-nav]', (e, a) => { e.preventDefault(); nav(a.dataset.nav); });
  on(document.body, 'click', '[data-act="back"]', () => back());

  // Telegram открывает Mini App с параметрами запуска в хэше (#tgWebAppData=…); telegram-web-app.js их уже прочитал,
  // поэтому заменяем такой хэш на экран. Незавершённая тренировка → сразу к ней.
  const startHash = match(location.hash) ? location.hash : '#/today';
  history.replaceState(null, '', activeWorkout() && startHash === '#/today' ? '#/workout' : startHash);
  window.addEventListener('hashchange', onHash);
  onHash();

  // Облачное зеркало Telegram: слить и продолжать дублировать записи
  if (MODE === 'real' && cloudAvailable) {
    setMirror(cloudMirror);
    try {
      const remote = await cloudReadAll();
      if (mergeRemote(remote)) {
        // Вкладки безопасно перерисовать; во вложенном экране (например, тренировке) только сообщаем.
        if (current?.route.opts.tab) render(current.route.hash, { keepScroll: true });
        else toast('Данные синхронизированы с облаком Telegram', 'good');
      }
    } catch (e) { console.warn('CloudStorage недоступно', e); }
    document.addEventListener('visibilitychange', () => { if (document.hidden) cloudMirror.flush(); });
  }
}

boot();
