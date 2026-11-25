// Программа Upper/Lower на 3 тренировки в неделю. Контракт: docs/DATA_CONTRACT.md
// 4 тренировки идут по кругу: Upper A → Lower A → Upper B → Lower B → Upper A …
// При 3 визитах в неделю каждая мышца получает прямую нагрузку ~1,5 раза в неделю, и тренировки не повторяются в одни и те же дни.

export const PROGRAM = {
  name: 'Upper / Lower · 3 дня',
  rotation: ['upperA', 'lowerA', 'upperB', 'lowerB'],
  sessions: {
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
  },

  // Неделя знакомства: первые 3–4 тренировки (полный круг A/B), веса подбираются, а не задаются.
  calibration: {
    sessions: 4,
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

export function sessionAt(idx) {
  const id = PROGRAM.rotation[((idx % 4) + 4) % 4];
  return PROGRAM.sessions[id];
}
