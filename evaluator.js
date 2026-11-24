// Оценщик тренировки.
// На вход — список [{ex, sets, reps}], на выходе — балл 0–100, тип, плюсы, проблемы, советы, минуты.
// Правила основаны на общепринятых рекомендациях: «база → изоляция», разумный объём на мышцу,
// баланс жим/тяга, передняя/задняя поверхность бедра, осевая нагрузка и т.д.
'use strict';

const Evaluator = (() => {
  const EXM = Object.fromEntries(DATA.exercises.map(e => [e.id, e]));
  const M = DATA.muscles;
  const low = m => M[m].toLowerCase();

  const SUGGEST = {
    pull: 'тягу верхнего блока, тягу штанги/гантели в наклоне или подтягивания',
    push: 'жим лёжа, жим гантелей или армейский жим',
    legs: 'приседания, жим ногами или выпады',
    hamstrings: 'румынскую тягу или сгибания ног лёжа',
    quads: 'приседания, жим ногами или выпады',
  };

  function firstInt(s, def = 10) {
    const m = String(s).match(/\d+/);
    return m ? parseInt(m[0], 10) : def;
  }

  // Подходы на каждую мышцу: основная = 1, вспомогательная = 0.5 (кардио не считаем)
  function muscleVolume(items) {
    const vol = {};
    for (const it of items) {
      const e = EXM[it.ex];
      if (!e || e.kind === 'cardio') continue;
      for (const m of e.primary) vol[m] = (vol[m] || 0) + it.sets;
      for (const m of e.secondary) vol[m] = (vol[m] || 0) + it.sets * 0.5;
    }
    return vol;
  }

  function estimateMinutes(items) {
    let total = 10; // разминка
    for (const it of items) {
      const e = EXM[it.ex];
      if (!e) continue;
      if (e.kind === 'cardio') total += firstInt(it.reps, 10);
      else total += it.sets * (e.kind === 'base' ? 3 : 2);
    }
    return total;
  }

  function evaluate(items) {
    items = items.filter(it => EXM[it.ex]);
    const res = { score: 0, type: '', positives: [], problems: [], tips: [], minutes: 0, volume: {} };
    if (!items.length) return res;

    let score = 100;
    const problems = [], positives = [], tips = [];
    const bad = (pen, text) => { score -= pen; problems.push(text); };

    const pairs = items.map(it => [it, EXM[it.ex]]);
    const strength = pairs.filter(([, e]) => e.kind !== 'cardio');
    const cardio = pairs.filter(([, e]) => e.kind === 'cardio');
    const minutes = estimateMinutes(items);
    res.minutes = minutes;
    const vol = muscleVolume(items);
    res.volume = vol;

    const finish = (type) => {
      Object.assign(res, { score: Math.max(0, Math.min(100, score)), type, problems, positives, tips });
      return res;
    };

    // ---------- только кардио ----------
    if (!strength.length) {
      const cmin = cardio.reduce((s, [i]) => s + firstInt(i.reps, 10), 0);
      if (cmin < 20) bad(20, `Всего ~${cmin} мин кардио — для заметного эффекта нужно хотя бы 20–30 мин.`);
      else if (cmin > 90) bad(10, `~${cmin} мин кардио подряд — многовато, растёт риск перетренированности.`);
      else positives.push(`Длительность кардио в норме (~${cmin} мин).`);
      tips.push('Для фигуры и обмена веществ кардио лучше сочетать с силовыми 2–3 раза в неделю.');
      return finish('Кардио');
    }

    const n = strength.length;
    const totalSets = strength.reduce((s, [i]) => s + i.sets, 0);

    // ---------- количество упражнений и объём ----------
    if (n < 3) bad(20, `Всего ${n} силовых упражнения — маловато для полноценной тренировки. Оптимально 4–8.`);
    else if (n > 12) bad(20, `${n} упражнений — слишком много: к концу силы кончатся, качество упадёт. Оптимально 4–8.`);
    else if (n > 9) bad(10, `${n} упражнений — многовато. Лучше 4–8, но качественно.`);
    else positives.push(`Количество упражнений в норме (${n}).`);

    if (totalSets < 9) bad(15, `Маленький объём: ${totalSets} рабочих подходов. Для роста нужно хотя бы 12–20 за тренировку.`);
    else if (totalSets > 36) bad(25, `Огромный объём: ${totalSets} подходов (~${minutes} мин). Восстановиться будет тяжело.`);
    else if (totalSets > 28) bad(12, `Объём высоковат: ${totalSets} подходов (~${minutes} мин). Обычно хватает 15–25.`);
    else positives.push(`Объём в норме: ${totalSets} рабочих подходов.`);

    if (minutes > 100) tips.push(`Тренировка займёт ~${minutes} мин. После 60–75 минут работы эффективность падает.`);

    // ---------- повторы ----------
    const seen = new Set();
    for (const [, e] of strength) {
      if (seen.has(e.id)) bad(10, `«${e.name}» стоит в тренировке дважды — лучше заменить вторым упражнением под другим углом.`);
      seen.add(e.id);
    }
    for (const [i, e] of strength) {
      if (e.kind === 'iso' && firstInt(i.reps) <= 5) {
        bad(5, `«${e.name}» на ${i.reps} повт. — изоляцию в малых повторах делать травмоопасно, лучше 10–15.`);
        break;
      }
    }

    // ---------- базовые / изолирующие ----------
    const baseCnt = strength.filter(([, e]) => e.kind === 'base').length;
    if (baseCnt === 0) {
      bad(20, 'Нет ни одного базового (многосуставного) упражнения — тренировка малоэффективна. ' +
              'Начни с жима, тяги, приседа или выпадов.');
    } else if (n >= 4 && baseCnt / n < 0.25) {
      bad(5, 'Почти одна изоляция. Хотя бы 1–2 базовых упражнения дадут больше результата.');
    } else {
      positives.push(`Есть базовые упражнения (${baseCnt}).`);
    }

    // ---------- перегруз одной мышцы ----------
    const over = Object.entries(vol).filter(([, v]) => v > 12).sort((a, b) => b[1] - a[1]);
    for (const [m, v] of over.slice(0, 2)) {
      bad(8, `На ${low(m)} ~${+v.toFixed(1)} подходов за раз. Больше 10–12 за тренировку почти не даёт ` +
             'дополнительного роста, а восстановление ухудшается.');
    }
    const overSet = new Set(over.map(([m]) => m));
    const primCnt = {};
    for (const [, e] of strength) for (const m of e.primary) (primCnt[m] = primCnt[m] || []).push(e.name);
    for (const [m, names] of Object.entries(primCnt)) {
      if (names.length >= 4 && !overSet.has(m)) bad(8, `${names.length} упражнения на ${low(m)} — избыточно, хватит 2–3.`);
    }

    // ---------- порядок ----------
    let orderFlags = 0;
    const core = new Set(['abs', 'obliques', 'lower_back']);
    const hasCore = e => e.primary.some(m => core.has(m));
    const axialIdx = strength.map(([, e], k) => e.axial ? k : -1).filter(k => k >= 0);
    if (axialIdx.length) {
      const lastAxial = Math.max(...axialIdx);
      for (const [, e] of strength.slice(0, lastAxial)) {
        if (e.kind === 'iso' && hasCore(e)) {
          bad(10, `«${e.name}» перед «${strength[lastAxial][1].name}»: уставшие пресс и поясница хуже держат спину ` +
                  'под тяжёлым весом — риск травмы. Кор тренируй в конце.');
          orderFlags++;
          break;
        }
      }
    }
    for (let k = 0; k < strength.length && orderFlags < 2; k++) {
      const e = strength[k][1];
      if (e.kind !== 'iso' || hasCore(e)) continue;
      for (const [, e2] of strength.slice(k + 1)) {
        if (e2.kind !== 'base') continue;
        const target = new Set([...e2.primary, ...e2.secondary]);
        const common = e.primary.filter(m => target.has(m)).sort();
        if (common.length) {
          bad(8, `«${e.name}» стоит перед «${e2.name}» — мышцы (${low(common[0])}) устанут заранее и ослабят ` +
                 'базовое упражнение. Сначала база, потом изоляция.');
          orderFlags++;
          break;
        }
      }
    }
    if (strength[0][1].kind === 'base' && orderFlags === 0) positives.push('Правильный порядок: тренировка начинается с базы.');

    let longCardioFirst = false;
    if (cardio.length) {
      const firstStrength = items.indexOf(strength[0][0]);
      longCardioFirst = cardio.some(([i]) => items.indexOf(i) < firstStrength && firstInt(i.reps, 10) > 12);
      if (longCardioFirst) bad(5, 'Длинное кардио перед силовой «съедает» силы. В начале — 5–10 мин разминки, основное кардио — в конце.');
    }

    // ---------- осевая нагрузка ----------
    const axial = strength.filter(([, e]) => e.axial).map(([, e]) => e.name);
    const ids = new Set(strength.map(([, e]) => e.id));
    if (axial.length >= 3) {
      bad(10, 'Много упражнений с тяжёлой нагрузкой на позвоночник: ' + axial.join(', ') +
              '. Оставь 1–2, остальные замени тренажёрами.');
    } else if (ids.has('squat') && ids.has('deadlift')) {
      tips.push('Присед и становая в один день — очень тяжело. Новичкам лучше разнести их по разным дням.');
    }

    // ---------- баланс и тип тренировки ----------
    const reg = { push: 0, pull: 0, legs: 0, core: 0 };
    for (const [m, v] of Object.entries(vol)) reg[DATA.region[m]] += v;
    const { push, pull, legs } = reg;
    const body = (push + pull + legs) || 1;
    const legsShare = legs / body;
    const upper = push + pull;
    const hasAny = keys => keys.some(k => (vol[k] || 0) >= 2);
    let type;

    if (legsShare >= 0.22 && upper / body >= 0.3) {
      type = 'Фулбади (всё тело)';
      if (push < 2) bad(12, `В тренировке на всё тело нет жимовых упражнений. Добавь ${SUGGEST.push}.`);
      else if (pull < 2) bad(12, `В тренировке на всё тело нет тяги для спины. Добавь ${SUGGEST.pull}.`);
      else if (Math.max(push, pull) / Math.min(push, pull) > 2.5) {
        const weak = push > pull ? 'тяги для спины' : 'жимовых';
        bad(8, `Перекос: ${weak} упражнений заметно меньше. Перекосы ведут к сутулости и проблемам с плечами.`);
      } else positives.push('Хороший баланс жима и тяги.');
      if (!hasAny(['quads', 'glutes'])) bad(6, `Ноги почти не работают. Добавь ${SUGGEST.legs}.`);
    } else if (legsShare >= 0.7) {
      type = 'День ног';
      const q = vol.quads || 0, hm = vol.hamstrings || 0;
      if (q >= 3 && hm < 1.5) bad(10, `Не тренируется задняя поверхность бедра — дисбаланс, риск травм колена. Добавь ${SUGGEST.hamstrings}.`);
      else if (hm >= 3 && q < 1.5) bad(8, `Нет упражнений на квадрицепс. Добавь ${SUGGEST.quads}.`);
      else positives.push('Передняя и задняя поверхность бедра проработаны.');
    } else if (legsShare < 0.22 && upper > 0) {
      const pushShare = push / upper;
      if (pushShare >= 0.75) {
        type = 'Жимовой день (грудь/плечи/трицепс)';
        tips.push('Не забудь в другой день тренировку тяги (спина, бицепс, задняя дельта) — для баланса.');
      } else if (pushShare <= 0.25) {
        type = 'Тяговой день (спина/бицепс)';
        tips.push('Не забудь в другой день жимовую тренировку (грудь, плечи, трицепс) — для баланса.');
      } else {
        type = 'Верх тела';
        if (Math.max(push, pull) / Math.max(Math.min(push, pull), 0.1) > 2) {
          bad(8, `Перекос в верхе тела: ${push > pull ? 'тяги' : 'жимовых'} упражнений заметно меньше.`);
        } else positives.push('Хороший баланс жима и тяги.');
      }
      if (legs < 1 && legsShare < 0.05) tips.push('Ноги в этот день не работают — проследи, чтобы был отдельный день ног.');
    } else if (reg.core > body) {
      type = 'Пресс и кор';
    } else {
      type = 'Смешанная';
    }

    if ((vol.front_delts || 0) >= 6 && !(vol.rear_delts) && type !== 'Жимовой день (грудь/плечи/трицепс)') {
      tips.push('Передние дельты нагружены, а задние — нет. Добавь фейс-пул или разведения в наклоне.');
    }
    const bigHit = DATA.bigMuscles.filter(m => (vol[m] || 0) >= 3);
    if (!bigHit.length && type !== 'Пресс и кор') {
      bad(10, 'Крупные мышцы (грудь, спина, ноги) почти не работают — расход энергии и гормональный ' +
              'отклик будут слабыми.');
    }
    if (cardio.length && !longCardioFirst) positives.push('Есть кардио — плюс для выносливости и сердца.');

    return finish(type);
  }

  function verdict(score) {
    if (score >= 85) return 'Отличная тренировка';
    if (score >= 70) return 'Хорошая, но есть что улучшить';
    if (score >= 50) return 'Средняя эффективность';
    return 'Неэффективная тренировка';
  }

  return { evaluate, verdict, muscleVolume, estimateMinutes, firstInt };
})();
