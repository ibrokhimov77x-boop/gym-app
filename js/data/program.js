// Программа «Верх / Низ / Руки и плечи» на 3 тренировки в неделю. Контракт: docs/DATA_CONTRACT.md, обоснование: docs/PLAN_V2.md
// 3 тренировки идут по кругу: Верх → Низ → Руки и плечи → Верх …
// При 3 визитах в неделю круг проходит ровно за неделю: ноги 1 раз, грудь и спина 1 раз, бицепс и трицепс 2 раза.
// superset: id упражнения-пары. rest первого в паре — переход к партнёру, rest второго — отдых после пары.

export const PROGRAM = {
  name: 'Верх / Низ / Руки и плечи · 3 дня',
  rotation: ['upper', 'lower', 'arms'],
  sessions: {
    upper: {
      id: 'upper', name: 'Верх', focus: 'Грудь и спина тяжело, в конце суперсет бицепс + трицепс',
      items: [
        { exId: 'db_bench_press', sets: 4, reps: [6, 10], rir: [1, 2], rest: 150, note: 'Главное упражнение дня. Бери регулируемую скамью: на ней же будет наклонный жим' },
        { exId: 'incline_db_press', sets: 4, reps: [8, 12], rir: [1, 2], rest: 120, note: 'Та же скамья: подними спинку до 30°' },
        { exId: 'lat_pulldown_neutral', sets: 4, reps: [8, 12], rir: [1, 2], rest: 120, note: 'V-рукоять; если хват устаёт раньше спины — лямки' },
        { exId: 'seated_cable_row', sets: 4, reps: [8, 12], rir: [1, 2], rest: 90, note: 'V-рукоять, корпус почти неподвижен' },
        { exId: 'cable_rope_curl', sets: 3, reps: [10, 15], rir: [0, 1], rest: 20, superset: 'triceps_rope_pushdown', note: 'Суперсет с трицепсом: бицепс → 20 с → трицепс → 60 с → снова бицепс. Нижний блок, канат' },
        { exId: 'triceps_rope_pushdown', sets: 3, reps: [10, 15], rir: [0, 1], rest: 60, superset: 'cable_rope_curl', note: 'Суперсет с бицепсом. Верхний блок, канат, локти прижаты' },
      ],
    },
    lower: {
      id: 'lower', name: 'Низ', focus: 'Все ноги за одну тренировку + пресс',
      items: [
        { exId: 'hack_squat', sets: 4, reps: [6, 10], rir: [1, 2], rest: 150, note: 'Главное упражнение дня. Перед ним 1–2 разминочных подхода; опускайся глубоко, таз не отрывай' },
        { exId: 'db_rdl', sets: 4, reps: [8, 12], rir: [1, 2], rest: 120, note: 'Нейтральный хват, кисть прямо. Лямки, если хват сдаётся раньше ног' },
        { exId: 'leg_extension', sets: 4, reps: [10, 15], rir: [0, 1], rest: 75, note: 'Вниз медленно, вверху пауза 1 с' },
        { exId: 'seated_leg_curl', sets: 3, reps: [10, 15], rir: [0, 1], rest: 75, note: 'Корпус чуть вперёд: так сильнее растяжение' },
        { exId: 'standing_calf_raise', sets: 6, reps: [10, 15], rir: [0, 1], rest: 45, note: 'Пауза 1–2 с внизу в растяжении. Нет тренажёра — «Икры сидя»' },
        { exId: 'cable_crunch', sets: 3, reps: [10, 15], rir: [0, 1], rest: 60, note: 'Таз неподвижен, рёбра к тазу' },
      ],
    },
    arms: {
      id: 'arms', name: 'Руки и плечи', focus: 'Бицепс и трицепс суперсетами, средняя и задняя дельта, пресс',
      items: [
        // СЛОТ А1 → incline_db_curl (после переделки 3D), назначение то же
        { exId: 'db_hammer_curl', sets: 4, reps: [8, 12], rir: [1, 2], rest: 20, superset: 'overhead_cable_ext', note: 'Суперсет А: молотки → 20 с → трицепс из-за головы → 75 с. Перед первым кругом — по лёгкому разминочному подходу. Позже здесь: сгибания на наклонной скамье' },
        { exId: 'overhead_cable_ext', sets: 4, reps: [10, 15], rir: [1, 2], rest: 75, superset: 'db_hammer_curl', note: 'Суперсет А. Локти смотрят вперёд; внизу глубокое растяжение без боли в локте' },
        // СЛОТ Б1 → bayesian_cable_curl; пока дубль «Верха» — назначение должно совпадать с ним
        { exId: 'cable_rope_curl', sets: 3, reps: [10, 15], rir: [0, 1], rest: 20, superset: 'triceps_rope_pushdown', note: 'Суперсет Б, как в «Верхе»: бицепс → 20 с → трицепс → 60 с. Позже здесь: байесовские сгибания на блоке' },
        // СЛОТ Б2 → lying_db_triceps_ext; пока дубль «Верха» — назначение должно совпадать с ним
        { exId: 'triceps_rope_pushdown', sets: 3, reps: [10, 15], rir: [0, 1], rest: 60, superset: 'cable_rope_curl', note: 'Суперсет Б. Позже здесь: разгибания лёжа с гантелями' },
        { exId: 'db_lateral_raise', sets: 4, reps: [12, 20], rir: [0, 1], rest: 20, superset: 'face_pull', note: 'Суперсет В: махи → 20 с → тяга к лицу → 60 с. Локоть ведёт, без раскачки' },
        { exId: 'face_pull', sets: 4, reps: [12, 15], rir: [0, 1], rest: 60, superset: 'db_lateral_raise', note: 'Суперсет В. Локти высоко, концы каната разводи в стороны' },
        { exId: 'cable_lateral_raise', sets: 3, reps: [12, 20], rir: [0, 1], rest: 45, note: 'Повторы на каждую руку: вторая рука сразу, отдых после обеих' },
        { exId: 'cable_crunch', sets: 3, reps: [10, 15], rir: [0, 1], rest: 60, note: 'Таз неподвижен, рёбра к тазу' },
      ],
    },
  },

  // Неделя знакомства: первые 3 тренировки (полный круг Верх → Низ → Руки и плечи), веса подбираются, а не задаются.
  calibration: {
    sessions: 3,
    title: 'Неделя знакомства',
    rir: [2, 3],
    howTo: [
      'Разминка: 1–2 лёгких подхода (~50% и ~70% от предполагаемого рабочего веса) по 6–8 повторов. Записывай их с отметкой «разминка».',
      'Рабочие подходы: выбери вес, с которым делаешь верх диапазона повторов и чувствуешь, что мог бы сделать ещё 2–3 повтора (RIR 2–3).',
      'Если повторов вышло больше верхней границы, в следующем подходе добавь вес. Если меньше нижней, убавь.',
      'Записывай КАЖДЫЙ подход: вес, повторы и ощущение (RIR). По этим данным приложение рассчитает рабочие веса.',
    ],
  },

  rules: {
    progression: 'Двойная прогрессия: когда во ВСЕХ рабочих подходах выполнен верх диапазона повторов при нужном RIR, вес растёт на шаг упражнения. Иначе добавляй повторы с тем же весом.',
    rir: 'RIR — сколько повторов ещё оставалось «в запасе». 0 = отказ, 1 = мог ещё один, 2 = ещё два.',
    deload: 'Разгрузка: каждые 6–8 недель или если 2+ главных упражнения стоят на месте 3 тренировки подряд — неделя с теми же весами, но на 1 подход меньше в каждом упражнении и RIR 3–4.',
    warmup: 'Перед первым упражнением 5 минут кардио и разминка суставов (особенно запястий: круговые движения, мягкое растяжение).',
  },
};

/** Версия программы. Пишется в state.plan вместе с nextIdx: так видно, что индекс уже в новом круге. */
export const PLAN_VERSION = 2;

// ───────── Старая программа «Upper / Lower» (до 26.11.2026) — только для истории ─────────
// Тренировки с этими id остаются в истории как есть: по ним показываются названия и назначения,
// и так же дорабатывается тренировка, начатая до обновления. В круг они больше не входят.
export const LEGACY_ROTATION = ['upperA', 'lowerA', 'upperB', 'lowerB'];
export const LEGACY_SESSIONS = {
  upperA: {
    id: 'upperA', name: 'Верх A', focus: 'Горизонтальные жимы и тяги',
    items: [
      { exId: 'db_bench_press', sets: 3, reps: [6, 10], rir: [1, 2], rest: 150, note: 'Главное упражнение дня' },
      { exId: 'seated_cable_row', sets: 3, reps: [8, 12], rir: [1, 2], rest: 120 },
      { exId: 'machine_shoulder_press', sets: 3, reps: [8, 12], rir: [1, 2], rest: 120 },
      { exId: 'lat_pulldown_neutral', sets: 3, reps: [8, 12], rir: [1, 2], rest: 120 },
      { exId: 'cable_fly', sets: 2, reps: [12, 15], rir: [0, 1], rest: 75 },
      { exId: 'db_hammer_curl', sets: 2, reps: [10, 15], rir: [0, 1], rest: 60, note: 'Можно суперсетом с трицепсом' },
      { exId: 'triceps_rope_pushdown', sets: 2, reps: [10, 15], rir: [0, 1], rest: 60 },
    ],
  },
  lowerA: {
    id: 'lowerA', name: 'Низ A', focus: 'Квадрицепсы (присед)',
    items: [
      { exId: 'hack_squat', sets: 3, reps: [6, 10], rir: [1, 2], rest: 180, note: 'Главное упражнение дня' },
      { exId: 'db_rdl', sets: 3, reps: [8, 12], rir: [1, 2], rest: 150 },
      { exId: 'leg_press', sets: 2, reps: [10, 15], rir: [1, 2], rest: 120 },
      { exId: 'lying_leg_curl', sets: 3, reps: [10, 15], rir: [0, 1], rest: 90 },
      { exId: 'standing_calf_raise', sets: 3, reps: [10, 15], rir: [0, 1], rest: 60 },
      { exId: 'cable_crunch', sets: 3, reps: [10, 15], rir: [0, 1], rest: 60 },
    ],
  },
  upperB: {
    id: 'upperB', name: 'Верх B', focus: 'Вертикальные тяги, наклонный жим, плечи',
    items: [
      { exId: 'lat_pulldown_wide', sets: 3, reps: [6, 10], rir: [1, 2], rest: 150, note: 'Главное упражнение дня' },
      { exId: 'incline_db_press', sets: 3, reps: [8, 12], rir: [1, 2], rest: 150 },
      { exId: 'db_row', sets: 3, reps: [8, 12], rir: [1, 2], rest: 90, note: 'Опорная рука на кулаке!' },
      { exId: 'db_lateral_raise', sets: 3, reps: [12, 20], rir: [0, 1], rest: 60 },
      { exId: 'face_pull', sets: 2, reps: [12, 15], rir: [0, 1], rest: 60 },
      { exId: 'overhead_cable_ext', sets: 2, reps: [10, 15], rir: [0, 1], rest: 60 },
      { exId: 'cable_rope_curl', sets: 2, reps: [10, 15], rir: [0, 1], rest: 60 },
    ],
  },
  lowerB: {
    id: 'lowerB', name: 'Низ B', focus: 'Задняя цепь (наклон) и ягодицы',
    items: [
      { exId: 'bb_rdl', sets: 3, reps: [6, 10], rir: [1, 2], rest: 180, note: 'Главное упражнение дня · лямки' },
      { exId: 'bulgarian_split_squat', sets: 3, reps: [8, 12], rir: [1, 2], rest: 90, note: 'Повторы на каждую ногу' },
      { exId: 'hip_thrust', sets: 3, reps: [8, 12], rir: [1, 2], rest: 120 },
      { exId: 'leg_extension', sets: 3, reps: [12, 15], rir: [0, 1], rest: 75 },
      { exId: 'seated_leg_curl', sets: 2, reps: [10, 15], rir: [0, 1], rest: 75 },
      { exId: 'seated_calf_raise', sets: 3, reps: [12, 20], rir: [0, 1], rest: 60 },
      { exId: 'hanging_knee_raise', sets: 3, reps: [10, 15], rir: [0, 1], rest: 60 },
    ],
  },
};
// Старые тренировки доступны и как PROGRAM.sessions[id] (история, сводки, бот), но Object.keys/values
// видят только 3 новые: главные упражнения, автозамены и списки программы строятся по новому кругу.
for (const [id, s] of Object.entries(LEGACY_SESSIONS)) {
  s.legacy = true;
  Object.defineProperty(PROGRAM.sessions, id, { value: s, enumerable: false });
}
/** После старого «Верха» — «Низ», после старого «Низа» — «Руки и плечи». */
export const LEGACY_NEXT = { upperA: 'lower', upperB: 'lower', lowerA: 'arms', lowerB: 'arms' };
/** Новая тренировка того же типа, что старая: «Верх A/B» → «Верх», «Низ A/B» → «Низ». */
export const LEGACY_SAME = { upperA: 'upper', upperB: 'upper', lowerA: 'lower', lowerB: 'lower' };

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
/** Индекс в круге длины n: остаток от деления, мусор → 0. */
const wrap = (i, n) => { const k = Math.trunc(Number(i)) || 0; return ((k % n) + n) % n; };

/** Тренировка по id — новая или старая (Верх A … Низ B); null, если id неизвестен. */
export function sessionById(id) {
  return typeof id === 'string' && hasOwn(PROGRAM.sessions, id) ? PROGRAM.sessions[id] : null;
}

/** Название тренировки для истории и сводок: «Верх», «Низ B»; для неизвестного id — fallback. */
export const sessionName = (id, fallback = 'Тренировка') => sessionById(id)?.name || fallback;

export function sessionAt(idx) {
  return PROGRAM.sessions[PROGRAM.rotation[wrap(idx, PROGRAM.rotation.length)]];
}

/** Индекс (в новом круге) тренировки, которая идёт после sessionId — нового или старого; null для неизвестного id. */
export function nextIdxAfter(sessionId) {
  const i = PROGRAM.rotation.indexOf(sessionId);
  if (i >= 0) return (i + 1) % PROGRAM.rotation.length;
  return hasOwn(LEGACY_NEXT, sessionId) ? PROGRAM.rotation.indexOf(LEGACY_NEXT[sessionId]) : null;
}

/**
 * Перевод state.nextIdx из старого круга (0–3: Верх A, Низ A, Верх B, Низ B) в новый, по смыслу.
 * Обычно nextIdx = последняя тренировка + 1, поэтому: ждали «Низ» → «Низ»; ждали «Верх» после «Низа» →
 * «Руки и плечи»; ничего ещё не сделано → «Верх». docs/PLAN_V2.md §10.1
 */
export function migrateNextIdx(oldIdx, hasFinished) {
  return [hasFinished ? 2 : 0, 1, 2, 1][wrap(oldIdx, LEGACY_ROTATION.length)];
}

/**
 * Индекс следующей тренировки в новом круге по состоянию приложения.
 * state.plan === PLAN_VERSION и planIdx === nextIdx — индекс уже новый. Иначе он из старого круга: состояние
 * до обновления, пришедшее из облака со старого устройства, или nextIdx поменяла старая версия приложения
 * (она сохраняет чужие поля, но planIdx не трогает). Тогда старый nextIdx не читаем, а считаем, как бот:
 * идёт старая тренировка (active) — новая того же типа (так же новая идущая показывается сама собой);
 * есть завершённые — следующая после последней (после старого «Верха» — «Низ», после старого «Низа» —
 * «Руки и плечи»); истории нет — перевод старого индекса (migrateNextIdx). Миграция ничего не пишет: маркер
 * появляется вместе с первым новым nextIdx (nextIdxPatch), поэтому свежее устройство не перетирает облако.
 * finished — завершённые тренировки, active — идущая тренировка или null.
 */
export function currentNextIdx(state, finished = [], active = null) {
  if (state?.plan === PLAN_VERSION && state.planIdx === state.nextIdx) return wrap(state.nextIdx, PROGRAM.rotation.length);
  if (active && hasOwn(LEGACY_SAME, active.session)) return PROGRAM.rotation.indexOf(LEGACY_SAME[active.session]);
  if (finished.length) {
    const last = finished.reduce((a, w) => (Date.parse(w.start) > Date.parse(a.start) ? w : a));
    const n = nextIdxAfter(last.session);
    if (n != null) return n;
  }
  return migrateNextIdx(state?.nextIdx, finished.length > 0);
}

/**
 * Сколько тренировок недели знакомства засчитано. Старые (Верх A … Низ B) — только если старая неделя
 * пройдена целиком (4 из 4): тогда знакомство уже позади. Иначе считаются только тренировки нового круга,
 * чтобы новое знакомство покрыло полный круг Верх → Низ → Руки и плечи.
 */
export function calibCount(workouts = []) {
  const calib = workouts.filter((w) => w?.calib);
  const old = calib.filter((w) => hasOwn(LEGACY_SESSIONS, w.session)).length;
  return old >= LEGACY_ROTATION.length ? calib.length : calib.length - old;
}

/** Патч состояния с новым индексом и маркером версии — так пишется любой nextIdx. */
export function nextIdxPatch(idx) {
  const i = wrap(idx, PROGRAM.rotation.length);
  return { nextIdx: i, plan: PLAN_VERSION, planIdx: i };
}
