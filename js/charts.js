// Лёгкие SVG-графики без библиотек: линия с точками и трендом, столбики, календарь посещений.
// Каждая функция возвращает DOM-элемент с подсказками по тапу. Цвета берутся из CSS-переменных темы.
import { linreg } from './analytics.js';
import { esc, num, dayShort, isoDay, monthShort, WEEKDAYS } from './ui/dom.js';

const NS = 'http://www.w3.org/2000/svg';
const DAY = 86400000;

function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  parent?.appendChild(n);
  return n;
}

/** «Красивые» деления оси. */
function ticks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || step0;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

let uid = 0;

/** Обёртка с подсказкой. */
function frame(cls, height) {
  const wrap = document.createElement('div');
  wrap.className = `chart ${cls}`;
  wrap.style.height = height + 'px';
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  wrap.appendChild(tip);
  let hideT;
  const showTip = (x, y, htmlStr, w) => {
    tip.innerHTML = htmlStr;
    tip.classList.add('show');
    const tw = tip.offsetWidth;
    tip.style.left = Math.min(Math.max(x - tw / 2, 0), w - tw) + 'px';
    tip.style.top = Math.max(y - tip.offsetHeight - 12, -6) + 'px';
    clearTimeout(hideT);
    hideT = setTimeout(() => hideTip(), 3200);
  };
  const hideTip = () => { tip.classList.remove('show'); wrap.querySelectorAll('.is-active').forEach((n) => n.classList.remove('is-active')); };
  return { wrap, showTip, hideTip };
}

/**
 * Линейный график.
 * points: [{ x: ms, y: number, label?: string, muted?: bool }]
 * opts: { height, unit, trend: bool, width }
 */
export function lineChart(points, { height = 190, unit = '', trend = true, width = 340 } = {}) {
  const { wrap, showTip, hideTip } = frame('chart-line', height);
  if (!points.length) return wrap;
  const W = width, H = height, L = 36, R = 10, T = 14, B = 24;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  let x0 = Math.min(...xs), x1 = Math.max(...xs);
  if (x0 === x1) { x0 -= DAY; x1 += DAY; }
  const yt = ticks(Math.min(...ys) * 0.97, Math.max(...ys) * 1.02, 3);
  const y0 = yt[0], y1 = yt[yt.length - 1];
  const sx = (x) => L + ((x - x0) / (x1 - x0)) * (W - L - R);
  const sy = (y) => T + (1 - (y - y0) / (y1 - y0 || 1)) * (H - T - B);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, preserveAspectRatio: 'none', role: 'img' });
  const id = 'g' + (++uid);
  const defs = el('defs', {}, svg);
  const grad = el('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el('stop', { offset: '0%', 'stop-color': 'var(--accent)', 'stop-opacity': '.28' }, grad);
  el('stop', { offset: '100%', 'stop-color': 'var(--accent)', 'stop-opacity': '0' }, grad);

  for (const v of yt) {
    el('line', { x1: L, x2: W - R, y1: sy(v), y2: sy(v), class: 'grid' }, svg);
    el('text', { x: L - 8, y: sy(v) + 4, class: 'axis', 'text-anchor': 'end' }, svg).textContent = num(v, 0);
  }
  // Подписи дат: первая, середина, последняя
  const xl = [x0, (x0 + x1) / 2, x1];
  xl.forEach((x, i) => {
    el('text', { x: sx(x), y: H - 6, class: 'axis', 'text-anchor': ['start', 'middle', 'end'][i] }, svg).textContent = dayShort(x);
  });

  const pts = points.map((p) => [sx(p.x), sy(p.y)]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  el('path', { d: `${d}L${pts[pts.length - 1][0]},${H - B}L${pts[0][0]},${H - B}Z`, fill: `url(#${id})`, class: 'area' }, svg);

  if (trend && points.length >= 3) {
    const reg = linreg(points.map((p) => [(p.x - x0) / DAY, p.y]));
    if (reg) {
      const ya = reg.icpt, yb = reg.icpt + reg.slope * ((x1 - x0) / DAY);
      el('line', { x1: sx(x0), y1: sy(ya), x2: sx(x1), y2: sy(yb), class: 'trend' }, svg);
    }
  }
  el('path', { d, class: 'line', pathLength: 1 }, svg);
  const guide = el('line', { x1: 0, x2: 0, y1: T, y2: H - B, class: 'guide' }, svg);
  const dots = pts.map(([x, y], i) => el('circle', { cx: x, cy: y, r: 3.6, class: `dot${points[i].muted ? ' muted' : ''}`, style: `animation-delay:${200 + i * 25}ms` }, svg));
  wrap.appendChild(svg);

  const pick = (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    pts.forEach(([x], i) => { if (Math.abs(x - px) < Math.abs(pts[best][0] - px)) best = i; });
    const p = points[best];
    dots.forEach((c) => c.classList.remove('is-active'));
    dots[best].classList.add('is-active');
    guide.setAttribute('x1', pts[best][0]); guide.setAttribute('x2', pts[best][0]);
    guide.classList.add('is-active');
    const scale = r.width / W;
    showTip(pts[best][0] * scale, pts[best][1] * (r.height / H), `<b>${num(p.y)} ${esc(unit)}</b><span>${esc(p.label || dayShort(p.x))}</span>`, r.width);
  };
  svg.addEventListener('pointerdown', pick);
  svg.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'mouse') pick(e); });
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hideTip(); });
  return wrap;
}

/**
 * Столбики.
 * bars: [{ label, value, tip?, hot? }]
 */
export function barChart(bars, { height = 150, unit = '', width = 340 } = {}) {
  const { wrap, showTip } = frame('chart-bars', height);
  if (!bars.length) return wrap;
  const W = width, H = height, T = 10, B = 22, L = 4, R = 4;
  const max = Math.max(...bars.map((b) => b.value), 1);
  const slot = (W - L - R) / bars.length;
  const bw = Math.min(26, slot * 0.62);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, preserveAspectRatio: 'none' });
  el('line', { x1: L, x2: W - R, y1: H - B, y2: H - B, class: 'grid' }, svg);
  const showEvery = Math.ceil(bars.length / 8);
  const rects = bars.map((b, i) => {
    const h = Math.max(2, (b.value / max) * (H - T - B));
    const x = L + slot * i + (slot - bw) / 2;
    const rect = el('rect', { x, y: H - B - h, width: bw, height: h, rx: Math.min(6, bw / 2), class: `col${b.hot ? ' hot' : ''}`, style: `animation-delay:${i * 30}ms` }, svg);
    if (i % showEvery === 0 || i === bars.length - 1) el('text', { x: x + bw / 2, y: H - 6, class: 'axis', 'text-anchor': 'middle' }, svg).textContent = b.label;
    return rect;
  });
  wrap.appendChild(svg);
  svg.addEventListener('pointerdown', (e) => {
    const r = svg.getBoundingClientRect();
    const i = Math.min(bars.length - 1, Math.max(0, Math.floor((((e.clientX - r.left) / r.width) * W - L) / slot)));
    rects.forEach((x) => x.classList.remove('is-active'));
    rects[i].classList.add('is-active');
    const scale = r.width / W;
    const b = bars[i];
    showTip((L + slot * i + slot / 2) * scale, (+rects[i].getAttribute('y')) * (r.height / H), `<b>${esc(b.tip || `${num(b.value)} ${unit}`)}</b><span>${esc(b.label)}</span>`, r.width);
  });
  return wrap;
}

/**
 * Календарь посещений (недели × дни, понедельник сверху).
 * days: Map<'YYYY-MM-DD', { level: 0..1, tip: string }>
 */
export function calendarHeatmap(days, { width = 340, cell = 17, gap = 4 } = {}) {
  const left = 22, top = 18;
  const weeks = Math.floor((width - left) / (cell + gap));
  const H = top + 7 * (cell + gap);
  const { wrap, showTip } = frame('chart-cal', H);
  const svg = el('svg', { viewBox: `0 0 ${width} ${H}`, width: '100%', height: H });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const monday = today.getTime() - ((today.getDay() + 6) % 7) * DAY;
  const start = monday - (weeks - 1) * 7 * DAY;
  [0, 2, 4].forEach((d) => { el('text', { x: 0, y: top + d * (cell + gap) + cell - 4, class: 'axis' }, svg).textContent = WEEKDAYS[d]; });
  // Подпись месяца — над неделей, где он начинается; первую колонку подписываем, только если до смены месяца ≥3 недели.
  const firstOfMonthWeek = (wk) => Array.from({ length: 7 }, (_, d) => new Date(start + wk * 7 * DAY + d * DAY + 2 * 3600000)).find((x) => x.getDate() === 1);
  let nextStart = 1;
  while (nextStart < weeks && !firstOfMonthWeek(nextStart)) nextStart++;
  const cells = [];
  for (let wk = 0; wk < weeks; wk++) {
    const ws = start + wk * 7 * DAY;
    const f = firstOfMonthWeek(wk);
    const label = f ? f.getMonth() : wk === 0 && nextStart >= 3 ? new Date(ws).getMonth() : null;
    if (label != null) el('text', { x: left + wk * (cell + gap), y: 11, class: 'axis' }, svg).textContent = monthShort(label);
    for (let d = 0; d < 7; d++) {
      const t = ws + d * DAY + 2 * 3600000; // +2 ч: устойчиво к переходу на летнее время
      if (t > today.getTime() + DAY) continue;
      const info = days.get(isoDay(t));
      const lvl = info ? Math.max(0.35, Math.min(1, info.level)) : 0;
      const x = left + wk * (cell + gap), y = top + d * (cell + gap);
      const r = el('rect', { x, y, width: cell, height: cell, rx: 4.5, class: `cal${info ? ' on' : ''}${isoDay(t) === isoDay(Date.now()) ? ' today' : ''}`,
        style: info ? `fill-opacity:${lvl};animation-delay:${wk * 18}ms` : '' }, svg);
      cells.push({ r, t, info, x, y });
    }
  }
  wrap.appendChild(svg);
  svg.addEventListener('pointerdown', (e) => {
    const box = svg.getBoundingClientRect();
    const sc = box.width / width;
    const px = (e.clientX - box.left) / sc, py = (e.clientY - box.top) / sc;
    const c = cells.find((q) => px >= q.x - 2 && px <= q.x + cell + 2 && py >= q.y - 2 && py <= q.y + cell + 2);
    if (!c) return;
    cells.forEach((q) => q.r.classList.remove('is-active'));
    c.r.classList.add('is-active');
    showTip((c.x + cell / 2) * sc, c.y * sc, `<b>${esc(c.info ? c.info.tip : 'Без тренировки')}</b><span>${esc(dayShort(c.t))}</span>`, box.width);
  });
  return wrap;
}

// ───────── Графики по дням (дневник: вес, калории, белок, сон) ─────────
// Общая ось: по одному слоту на календарный день и одинаковые поля у всех трёх видов — один и тот же день стоит
// на одной вертикали на всех графиках экрана. rows — по строке на каждый день периода; rows[i].tip =
// [главная строка, подпись] — подсказка по тапу (день без tip пропускается, берётся ближайший);
// xLabels = [[индекс дня, текст, 'start' | 'middle' | 'end'], …] — подписи под осью.

const DL = 38, DR = 8, DT = 12, DB = 24;

function dayFrame(cls, n, height, width) {
  const { wrap, showTip, hideTip } = frame(`chart-days ${cls}`, height);
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height, preserveAspectRatio: 'none', role: 'img' });
  const slot = (width - DL - DR) / Math.max(n, 1);
  return { wrap, showTip, hideTip, svg, W: width, H: height, slot, sx: (i) => DL + slot * (i + 0.5) };
}

function dayAxes({ svg, W, H, slot }, yt, sy, fmt, xLabels) {
  for (const v of yt) {
    el('line', { x1: DL, x2: W - DR, y1: sy(v), y2: sy(v), class: 'grid' }, svg);
    el('text', { x: DL - 7, y: sy(v) + 3.5, class: 'axis', 'text-anchor': 'end' }, svg).textContent = fmt(v);
  }
  for (const [i, text, anchor = 'middle'] of xLabels) {
    const x = anchor === 'start' ? DL : anchor === 'end' ? W - DR : DL + slot * (i + 0.5);
    el('text', { x, y: H - 6, class: 'axis', 'text-anchor': anchor }, svg).textContent = text;
  }
}

/** Подсказка по тапу и ведению пальцем: ближайший день с данными. markOf(i) — элемент, который подсветить. */
function dayTips({ svg, wrap, showTip, hideTip, W, H, slot, sx }, rows, anchorY, markOf, guide = null) {
  const n = rows.length;
  const pick = (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let i = Math.min(n - 1, Math.max(0, Math.floor((px - DL) / slot)));
    if (!rows[i].tip) {
      let best = -1;
      for (let k = 0; k < n; k++) if (rows[k].tip && (best < 0 || Math.abs(k - i) < Math.abs(best - i))) best = k;
      if (best < 0) return;
      i = best;
    }
    wrap.querySelectorAll('.is-active').forEach((x) => x.classList.remove('is-active'));
    if (guide) { guide.setAttribute('x1', sx(i)); guide.setAttribute('x2', sx(i)); guide.classList.add('is-active'); }
    markOf(i)?.classList.add('is-active');
    showTip(sx(i) * (r.width / W), anchorY(i) * (r.height / H), `<b>${esc(rows[i].tip[0])}</b><span>${esc(rows[i].tip[1])}</span>`, r.width);
  };
  svg.addEventListener('pointerdown', pick);
  svg.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'mouse') pick(e); });
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hideTip(); });
}

/**
 * Точки-замеры и сглаженная линия по дням (вес и его среднее за 7 дней).
 * rows: [{ dot: number|null, line: number|null, tip? }] — dot рисуется точкой, line соединяется линией (на null рвётся).
 * opts: { height, width, xLabels, ref: { y, label } — горизонтальная отметка, например целевой вес }
 */
export function dayLineChart(rows, { height = 180, width = 340, xLabels = [], ref = null } = {}) {
  const f = dayFrame('chart-dayline', rows.length, height, width);
  const vals = [];
  for (const r of rows) { if (r.dot != null) vals.push(r.dot); if (r.line != null) vals.push(r.line); }
  if (!vals.length) return f.wrap;
  const { svg, W, H, sx } = f;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  // Отметку показываем, только если она рядом с данными: далёкая цель сплющила бы график.
  const near = Math.max((hi - lo) * 0.6, 0.5);
  const showRef = !!ref && ref.y != null && ref.y > lo - near && ref.y < hi + near;
  if (showRef) { lo = Math.min(lo, ref.y); hi = Math.max(hi, ref.y); }
  const pad = Math.max((hi - lo) * 0.1, 0.15);
  const yt = ticks(lo - pad, hi + pad, 3);
  const y0 = yt[0], y1 = yt[yt.length - 1];
  const step = Math.round((yt[1] - yt[0]) * 100) / 100;
  const digits = Number.isInteger(step) ? 0 : Number.isInteger(Math.round(step * 100) / 10) ? 1 : 2;
  const sy = (y) => DT + (1 - (y - y0) / (y1 - y0 || 1)) * (H - DT - DB);
  dayAxes(f, yt, sy, (v) => num(v, digits), xLabels);
  if (showRef) {
    el('line', { x1: DL, x2: W - DR, y1: sy(ref.y), y2: sy(ref.y), class: 'ref' }, svg);
    if (ref.label) el('text', { x: W - DR, y: sy(ref.y) - 5, class: 'ref-label', 'text-anchor': 'end' }, svg).textContent = ref.label;
  }
  let d = '', pen = false;
  rows.forEach((r, i) => {
    if (r.line == null) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(r.line).toFixed(1)}`;
    pen = true;
  });
  if (d) el('path', { d, class: 'line', pathLength: 1 }, svg);
  const guide = el('line', { x1: 0, x2: 0, y1: DT, y2: H - DB, class: 'guide' }, svg);
  const rad = rows.length > 45 ? 2 : 2.8;
  const dots = rows.map((r, i) => (r.dot == null ? null
    : el('circle', { cx: sx(i).toFixed(1), cy: sy(r.dot).toFixed(1), r: rad, class: 'pt', style: `animation-delay:${Math.min(200 + i * 12, 900)}ms` }, svg)));
  f.wrap.appendChild(svg);
  dayTips(f, rows, (i) => sy(rows[i].dot ?? rows[i].line ?? y0), (i) => dots[i], guide);
  return f.wrap;
}

/**
 * Столбики по дням с нормой (калории, белок, длительность сна).
 * rows: [{ value: number|null, target?: number|null, cls?: 'ok'|'over'|'under'|'', tip? }] — норма рисуется
 * пунктиром-ступеньками (у каждого дня своя), cls задаёт цвет столбика.
 * opts: { height, width, xLabels, band — доля коридора вокруг нормы (0,1 = ±10 %), fmt — подписи делений,
 *   step — шаг делений (по умолчанию подбирается сам) }
 */
export function dayBarChart(rows, { height = 150, width = 340, xLabels = [], band = 0, fmt = (v) => num(v, 0), step = 0 } = {}) {
  const f = dayFrame('chart-daybars', rows.length, height, width);
  let hi = 0;
  for (const r of rows) hi = Math.max(hi, r.value ?? 0, (r.target ?? 0) * (1 + band));
  if (!hi) return f.wrap;
  const { svg, H, slot, sx } = f;
  const yt = step > 0 ? Array.from({ length: Math.ceil((hi * 1.03) / step) + 1 }, (_, i) => i * step) : ticks(0, hi * 1.03, 3);
  const y1 = yt[yt.length - 1];
  const sy = (y) => DT + (1 - y / y1) * (H - DT - DB);
  dayAxes(f, yt, sy, fmt, xLabels);
  // Подряд идущие дни с одной нормой — один отрезок; при смене нормы — ступенька.
  const runs = [];
  rows.forEach((r, i) => {
    if (r.target == null) return;
    const last = runs[runs.length - 1];
    if (last && last.b === i - 1 && last.t === r.target) last.b = i; else runs.push({ a: i, b: i, t: r.target });
  });
  let d = '';
  runs.forEach((run, k) => {
    const xa = DL + slot * run.a, xb = DL + slot * (run.b + 1);
    if (band) {
      const top = sy(run.t * (1 + band));
      el('rect', { x: xa.toFixed(1), y: top.toFixed(1), width: (xb - xa).toFixed(1), height: (sy(run.t * (1 - band)) - top).toFixed(1), class: 'band' }, svg);
    }
    const joined = k > 0 && runs[k - 1].b === run.a - 1;
    d += `${joined ? `V${sy(run.t).toFixed(1)}` : `M${xa.toFixed(1)},${sy(run.t).toFixed(1)}`}H${xb.toFixed(1)}`;
  });
  const bw = Math.max(1.5, Math.min(22, slot * 0.66));
  const rects = rows.map((r, i) => {
    if (r.value == null) return null;
    const h = Math.max(2, (r.value / y1) * (H - DT - DB));
    return el('rect', { x: (sx(i) - bw / 2).toFixed(1), y: (H - DB - h).toFixed(1), width: bw.toFixed(1), height: h.toFixed(1), rx: Math.min(5, bw / 2).toFixed(1),
      class: `col ${r.cls || ''}`, style: `animation-delay:${Math.min(i * 14, 700)}ms` }, svg);
  });
  if (d) el('path', { d, class: 'target' }, svg);
  f.wrap.appendChild(svg);
  dayTips(f, rows, (i) => (rects[i] ? +rects[i].getAttribute('y') : H - DB), (i) => rects[i]);
  return f.wrap;
}

/**
 * Отрезки по дням на шкале времени суток (ночной сон: от отбоя до подъёма). Сверху вечер, снизу утро.
 * rows: [{ from: минуты|null, to: минуты|null, cls?, tip? }] — минуты от полуночи этого дня; отбой до полуночи —
 * отрицательные (23:30 → −30). Если известен только один конец, рисуется точка.
 * opts: { height, width, xLabels, refs: [{ y }] — горизонтальные отметки (средние отбой и подъём) }
 * Отметка вне шкалы не рисуется: шкала строится по самим отрезкам, и линия за её пределами легла бы поверх соседних
 * графиков (у svg overflow: visible).
 */
export function dayRangeChart(rows, { height = 170, width = 340, xLabels = [], refs = [] } = {}) {
  const f = dayFrame('chart-dayrange', rows.length, height, width);
  const vals = [];
  for (const r of rows) { if (r.from != null) vals.push(r.from); if (r.to != null) vals.push(r.to); }
  if (!vals.length) return f.wrap;
  const { svg, W, H, slot, sx } = f;
  // Границы — по целым часам с небольшим запасом; деления — на «круглых» часах (00:00, 03:00, …). Шкала начинается
  // и кончается на делении: иначе отбой в 23:25 рисовался выше верхней подписи «00:00» и по оси не читался.
  const lo0 = Math.floor((Math.min(...vals) - 20) / 60) * 60, hi0 = Math.ceil((Math.max(...vals) + 20) / 60) * 60;
  const stepMin = hi0 - lo0 > 600 ? 180 : hi0 - lo0 > 300 ? 120 : 60;
  const lo = Math.floor(lo0 / stepMin) * stepMin, hi = Math.ceil(hi0 / stepMin) * stepMin;
  const yt = [];
  for (let v = lo; v <= hi; v += stepMin) yt.push(v);
  const sy = (m) => DT + ((m - lo) / (hi - lo || 1)) * (H - DT - DB);
  const clockLabel = (m) => { const x = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
  dayAxes(f, yt, sy, clockLabel, xLabels);
  for (const ref of refs) {
    if (ref.y == null || ref.y < lo || ref.y > hi) continue;
    el('line', { x1: DL, x2: W - DR, y1: sy(ref.y), y2: sy(ref.y), class: 'ref' }, svg);
  }
  const bw = Math.max(1.5, Math.min(18, slot * 0.6));
  const marks = rows.map((r, i) => {
    const style = `animation-delay:${Math.min(i * 14, 700)}ms`;
    if (r.from != null && r.to != null) {
      const y = sy(r.from), h = Math.max(3, sy(r.to) - y);
      return el('rect', { x: (sx(i) - bw / 2).toFixed(1), y: y.toFixed(1), width: bw.toFixed(1), height: h.toFixed(1), rx: Math.min(5, bw / 2).toFixed(1), class: `col range ${r.cls || ''}`, style }, svg);
    }
    const one = r.from ?? r.to;
    return one == null ? null : el('circle', { cx: sx(i).toFixed(1), cy: sy(one).toFixed(1), r: Math.max(1.8, Math.min(3, bw / 2)), class: 'pt', style }, svg);
  });
  f.wrap.appendChild(svg);
  dayTips(f, rows, (i) => sy(rows[i].from ?? rows[i].to ?? lo), (i) => marks[i]);
  return f.wrap;
}

/** Ширина для графика внутри контейнера (до вставки в DOM берём ширину родителя). */
export const chartWidth = (container) => Math.max(260, Math.round(container?.clientWidth || 340));
