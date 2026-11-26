// Компактный формат для передачи в бота (Telegram.WebApp.sendData ≤ 4096 байт): тренировки, дни дневника и режим.
// Контракт: docs/DATA_CONTRACT.md (тренировки), docs/DIARY_CONTRACT.md (смешанная посылка k: 'm')
import { dayFromCompact, dayToCompact, goalFromCompact, goalToCompact, isEmptyDay } from './diary.js';

export const SEND_LIMIT = 4096;

export function toCompact(w) {
  return {
    i: w.id, s: w.session, c: w.calib ? 1 : 0, a: w.start, b: w.end || null,
    bw: w.bw ?? null, f: w.feel ?? null, n: (w.note || '').slice(0, 300),
    e: (w.ex || []).map((e) => {
      const sets = (e.sets || []).filter((s) => !s.warm && s.r > 0).map((s) => [s.w, s.r, s.rir ?? null]);
      const row = [e.id, sets];
      if (e.from) row.push(e.from);
      return row;
    }).filter((row) => row[1].length),
  };
}

export function fromCompact(c) {
  return {
    id: c.i, session: c.s, calib: !!c.c, start: c.a, end: c.b || null, bw: c.bw ?? null, feel: c.f ?? null, note: c.n || '',
    ex: (c.e || []).map(([id, sets, from]) => ({ id, from: from || null, note: '', sets: sets.map(([w, r, rir]) => ({ w, r, rir: rir ?? null, warm: false })) })),
  };
}

const encoder = new TextEncoder();
const bytes = (s) => encoder.encode(s).length;

/** Упаковать как можно больше тренировок (от старых к новым) в один sendData. Возвращает { data, ids }. */
export function packForSend(workouts, limit = SEND_LIMIT) {
  const ids = [];
  const ws = [];
  for (const w of workouts) {
    const c = toCompact(w);
    const candidate = JSON.stringify({ v: 1, k: 'w', ws: [...ws, c] });
    if (bytes(candidate) > limit) {
      if (!ws.length) { // одна огромная тренировка: обрезаем заметку и пробуем ещё раз
        c.n = '';
        const again = JSON.stringify({ v: 1, k: 'w', ws: [c] });
        if (bytes(again) <= limit) { ws.push(c); ids.push(w.id); }
      }
      break;
    }
    ws.push(c); ids.push(w.id);
  }
  return { data: ws.length ? JSON.stringify({ v: 1, k: 'w', ws }) : null, ids };
}

const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const byStart = (a, b) => new Date(a.start) - new Date(b.start);
const ENVELOPE = 15; // байт в {"v":1,"k":"m"}
const FIELD = 8;     // ,"ds":[ … ] вокруг первого элемента; следующие элементы — по запятой

/**
 * Упаковать в один sendData всё неотправленное: { v: 1, k: 'm', g?, ds?, ws?, r? }.
 * Порядок, когда места мало: режим → то, что отправляют прямо сейчас (first) → дни дневника от старых к новым →
 * тренировки от старых к новым. Порядок строгий: как только что-то не поместилось, всё, что за ним, остаётся
 * в очереди до следующей отправки.
 * Посылка только из тренировок уходит в прежнем формате k: 'w' — её поймёт и не обновлённый бот.
 *
 * «Повтор» r: { g?, ds? } — режим и последние дни, которые уже отправлялись (pending.repeat). Он добавляется, только
 * когда очередь ушла целиком и место ещё есть: сначала режим, потом дни от новых к старым, пока помещаются.
 * У sendData нет подтверждения доставки, а Telegram хранит сообщения для выключенного бота сутки — повтор закрывает
 * такие пробелы сам, при следующей же отправке. В очередь он не входит и в goal / dates результата не попадает.
 * @param {{ goal?: object|null, days?: { date: string, day: object|null }[], workouts?: object[],
 *   repeat?: { goal?: object|null, days?: { date: string, day: object|null }[] }|null }} pending
 *   результат storage.pendingSync(): goal — режим, если он менялся; day = null — день удалён
 * @param {number} [limit] байт UTF-8
 * @param {{ dates?: string[], ids?: string[] }|null} [first] то, что человек отправляет прямо сейчас (день из его
 *   формы, тренировка с экрана итога): оно встаёт в очередь сразу за режимом, впереди остальных дней и тренировок, —
 *   иначе при длинной очереди «Сохранить и отправить тренеру» увозила бы старые дни, а бот разбирал бы не тот день.
 *   Для остального порядок прежний и такой же строгий.
 * @returns {{ data: string|null, bytes: number, goal: boolean, dates: string[], ids: string[],
 *   left: { goal: boolean, days: number, workouts: number }, repeat: { goal: boolean, dates: string[] } }}
 *   data — строка для sendData (null, если отправлять нечего или ничего не поместилось); goal, dates, ids — что в неё
 *   вошло из очереди (передай в storage.markSent после sendData); left — что осталось в очереди; repeat — что
 *   поехало повтором
 */
export function packAll({ goal = null, days = [], workouts = [], repeat = null } = {}, limit = SEND_LIMIT, first = null) {
  const res = { data: null, bytes: 0, goal: false, dates: [], ids: [], left: { goal: false, days: 0, workouts: 0 }, repeat: { goal: false, dates: [] } };
  let size = ENVELOPE;
  let g = null;
  const ds = [];
  const ws = [];

  const gc = goal ? goalToCompact(goal) : [];
  if (gc.length) {
    const json = JSON.stringify(gc);
    if (size + 5 + bytes(json) <= limit) { g = json; size += 5 + bytes(json); res.goal = true; } else res.left.goal = true;
  }

  // Очередь целиком: сначала то, что отправляют сейчас (first), потом дни от старых к новым, потом тренировки.
  const dq = [...days].sort(byDate);
  const wq = [...workouts].sort(byStart);
  const fd = new Set(first?.dates || []), fw = new Set(first?.ids || []);
  const queue = [
    ...dq.filter((d) => fd.has(d.date)).map((d) => ({ d })), ...wq.filter((w) => fw.has(w.id)).map((w) => ({ w })),
    ...dq.filter((d) => !fd.has(d.date)).map((d) => ({ d })), ...wq.filter((w) => !fw.has(w.id)).map((w) => ({ w })),
  ];
  for (const it of res.left.goal ? [] : queue) {
    if (it.d) {
      const json = JSON.stringify(dayToCompact(it.d.date, it.d.day, it.d.upd));
      const cost = bytes(json) + (ds.length ? 1 : FIELD);
      if (size + cost > limit) break; // всё, что за ним, — следующей отправкой
      size += cost; ds.push(json); res.dates.push(it.d.date);
    } else {
      const c = toCompact(it.w);
      let json = JSON.stringify(c);
      let cost = bytes(json) + (ws.length ? 1 : FIELD);
      if (size + cost > limit) {
        if (g || ds.length || ws.length) break; // уйдёт следующей отправкой
        c.n = ''; // одна огромная тренировка: без заметки, как в packForSend
        json = JSON.stringify(c);
        cost = bytes(json) + FIELD;
        if (size + cost > limit) break;
      }
      size += cost; ws.push(json); res.ids.push(it.w.id);
    }
  }
  res.left.days = dq.length - res.dates.length;
  res.left.workouts = wq.length - res.ids.length;

  if (!g && !ds.length && !ws.length) return res;

  // Повтор — только если очередь ушла целиком: место в посылке сначала получает то, что ещё не отправлялось.
  let r = '';
  if (repeat && !res.left.goal && !res.left.days && !res.left.workouts) {
    let room = limit - size - 7; // ,"r":{ … }
    let rg = '';
    const gc2 = repeat.goal ? goalToCompact(repeat.goal) : [];
    if (gc2.length) {
      const json = JSON.stringify(gc2);
      if (4 + bytes(json) <= room) { rg = json; room -= 4 + bytes(json); res.repeat.goal = true; }
    }
    const rds = [];
    for (const it of [...(repeat.days || [])].sort(byDate).reverse()) {
      const json = JSON.stringify(dayToCompact(it.date, it.day, it.upd));
      const cost = bytes(json) + (rds.length ? 1 : rg ? 8 : 7); // "ds":[ … ] и запятая после "g"
      if (cost > room) break;
      room -= cost; rds.push(json); res.repeat.dates.push(it.date);
    }
    if (rg || rds.length) r = `,"r":{${rg ? `"g":${rg}` : ''}${rg && rds.length ? ',' : ''}${rds.length ? `"ds":[${rds.join(',')}]` : ''}}`;
  }

  res.data = `{"v":1,"k":"${g || ds.length || r ? 'm' : 'w'}"${g ? `,"g":${g}` : ''}${ds.length ? `,"ds":[${ds.join(',')}]` : ''}${ws.length ? `,"ws":[${ws.join(',')}]` : ''}${r}}`;
  res.bytes = size + bytes(r);
  return res;
}

/** Дни из компактных строк: по дате, без битых строк; дата дважды — берётся последняя. */
function daysFromRows(rows) {
  const byDay = new Map();
  for (const row of rows || []) {
    const d = dayFromCompact(row);
    if (d && (d.del || !isEmptyDay(d))) byDay.set(d.date, d); // пустых дней приложение не шлёт: это битая строка
  }
  return [...byDay.values()].sort(byDate);
}

/**
 * Разобрать посылку приложения (обе версии: k: 'w' — только тренировки, k: 'm' — смешанная).
 * @returns {{ workouts: object[], days: object[], goal: { entries: object[] }|null,
 *   repeat: { days: object[], goal: { entries: object[] }|null } }}
 *   days — по возрастанию даты: { date, kcal, p, f, c, w, wake, bed, note } или { date, del: true }; значения уже
 *   проверены по diary.LIMITS (вне диапазона → null); строки без настоящей даты и дни без единого значения отброшены.
 *   goal — последние записи режима ({ from, mode, kcal, p, f, c, targetW, note: '' }) или null, если режим не менялся.
 *   repeat — то же самое из «повтора» (то, что приложение уже отправляло раньше): сохранить, если у бота этого нет
 *   или оно отличается, но отвечать на него как на новый дневник не нужно. Дни, которые есть и в days, в repeat
 *   не попадают.
 * @throws {Error} 'bad payload', если это не посылка приложения
 */
export function parsePayload(str) {
  const p = JSON.parse(str);
  if (!p || typeof p !== 'object' || p.v !== 1) throw new Error('bad payload');
  if (p.k === 'w') {
    if (!Array.isArray(p.ws)) throw new Error('bad payload');
    return { workouts: p.ws.map(fromCompact), days: [], goal: null, repeat: { days: [], goal: null } };
  }
  if (p.k !== 'm') throw new Error('bad payload');
  for (const f of ['g', 'ds', 'ws']) if (p[f] != null && !Array.isArray(p[f])) throw new Error('bad payload');
  const r = p.r && typeof p.r === 'object' && !Array.isArray(p.r) ? p.r : {}; // повтор необязателен: битый просто не учитывается
  const days = daysFromRows(p.ds);
  const sent = new Set(days.map((d) => d.date));
  const goal = p.g ? goalFromCompact(p.g) : null;
  return {
    workouts: (p.ws || []).map(fromCompact),
    days,
    goal,
    repeat: {
      days: daysFromRows(Array.isArray(r.ds) ? r.ds : []).filter((d) => !sent.has(d.date)),
      goal: !goal && Array.isArray(r.g) ? goalFromCompact(r.g) : null,
    },
  };
}
