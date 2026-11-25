// Компактный формат для передачи тренировок в бота (Telegram.WebApp.sendData ≤ 4096 байт).
// Контракт: docs/DATA_CONTRACT.md
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

const bytes = (s) => new TextEncoder().encode(s).length;

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

export function parsePayload(str) {
  const p = JSON.parse(str);
  if (!p || p.v !== 1 || p.k !== 'w' || !Array.isArray(p.ws)) throw new Error('bad payload');
  return p.ws.map(fromCompact);
}
