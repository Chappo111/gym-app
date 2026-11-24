// Вкладки «Упражнения», «Тренировка» (конструктор), «Программы» + генератор и замена упражнений.
'use strict';

// ---------------------------------------------------------------------------
// Инвентарь: категории для фильтров и генератора
// ---------------------------------------------------------------------------
const EQUIP = [
  { key: 'all', name: 'Любой' },
  { key: 'barbell', name: 'Штанга' },
  { key: 'dumbbell', name: 'Гантели' },
  { key: 'machine', name: 'Тренажёры' },
  { key: 'body', name: 'Свой вес' },
  { key: 'kettlebell', name: 'Гиря' },
];
function equipCats(e) {
  const s = e.equipment.toLowerCase();
  const c = new Set();
  if (/штанг|гриф|ez/.test(s)) c.add('barbell');
  if (/гантел/.test(s)) c.add('dumbbell');
  if (/тренаж|блок|кроссовер|смит|хаммер|рычаж|бабочк|скотт|гакк|степпер|дорожк|эллипс|велотрен|гребн|резин/.test(s)) c.add('machine');
  if (/собственный вес|турник|брусья|коврик|перекладин|римский|скакалк|ролик|скамья$|платформ/.test(s)) c.add('body');
  if (/гир/.test(s)) c.add('kettlebell');
  if (!c.size) c.add('body');
  return c;
}
const CATS = Object.fromEntries(DATA.exercises.map(e => [e.id, equipCats(e)]));

// ---------------------------------------------------------------------------
// «Упражнения»
// ---------------------------------------------------------------------------
function tabCatalog() {
  const c = S.cat;
  const groups = [{ key: 'all', name: 'Все' }, { key: 'fav', name: '★ Избранное' }, ...DATA.groups]
    .map(g => `<button class="chip${c.group === g.key ? ' on' : ''}" data-act="group" data-g="${g.key}">${g.name}</button>`).join('');
  const equip = EQUIP.map(q => `<button class="chip${c.equip === q.key ? ' on' : ''}" data-act="equip" data-q="${q.key}">${q.name}</button>`).join('');
  const head = c.muscle
    ? `<span class="sel-pill">${esc(MUS[c.muscle])}<button data-act="muscle-clear" aria-label="Сбросить">✕</button></span>`
    : '<span class="title">Карта мышц</span>';
  return `
    <h1>Упражнения</h1>
    <div class="sub">${DATA.exercises.length} упражнений · нажми на мышцу, чтобы найти упражнения</div>
    <div class="search-wrap">${ICON.search}<input class="search" type="search" placeholder="Жим, тяга, присед…" value="${esc(c.q)}" data-input="q" enterkeyhint="search"></div>
    <div class="card hero map-card" id="catmap">
      <div class="map-head">${head}</div>
      ${bodyMap({ clickable: true, selected: c.muscle })}
      <div class="map-hint">${c.muscle ? 'Нажми ещё раз — выберется соседняя мышца' : '👆 Нажми на любую мышцу'}</div>
    </div>
    <div class="chips">${groups}</div>
    <div class="chips small">${equip}</div>
    <div id="exlist"></div>`;
}

function exItem(e, i) {
  const inDraft = S.draft.items.some(it => it.ex === e.id);
  const fav = S.fav.includes(e.id);
  return `<div class="ex-item" data-act="ex" data-id="${e.id}" style="--i:${i}">
      <div class="ex-thumb">${exThumb(e)}</div>
      <div class="grow"><div class="ex-name">${fav ? '<span class="star">★</span> ' : ''}${esc(e.name)}</div>
      <div class="ex-sub">${kindLabel(e.kind)} · ${esc(e.equipment)}</div></div>
      <button class="add-btn${inDraft ? ' in' : ''}" data-act="toggle-add" data-id="${e.id}" aria-label="Добавить">${inDraft ? ICON.check : ICON.plus}</button>
    </div>`;
}

function filteredExercises() {
  const c = S.cat;
  const words = c.q.toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean);
  return DATA.exercises.filter(e => {
    // при поиске по названию группа не ограничивает (кроме «Избранного»)
    if (c.group === 'fav' ? !S.fav.includes(e.id) : (!words.length && c.group !== 'all' && e.group !== c.group)) return false;
    if (c.equip !== 'all' && !CATS[e.id].has(c.equip)) return false;
    const name = e.name.toLowerCase().replace(/ё/g, 'е');
    return words.every(w => name.includes(w));
  });
}

function renderCatalogList(anim = true) {
  const el = $('#exlist');
  if (!el) return;
  const c = S.cat;
  let list = filteredExercises();
  let html = '';
  const block = (title, arr) => `<div class="section-title">${title} · ${arr.length}</div><div class="ex-list${anim ? ' stagger' : ''}">${arr.map(exItem).join('')}</div>`;
  if (c.muscle) {
    const main = list.filter(e => e.primary.includes(c.muscle));
    const help = list.filter(e => e.secondary.includes(c.muscle));
    if (main.length) html += block('Основная нагрузка', main);
    if (help.length) html += block('Вспомогательная', help);
    list = main.concat(help);
  } else {
    const title = c.q.trim() && c.group !== 'fav' ? 'Найдено' : c.group === 'all' ? 'Все упражнения' : c.group === 'fav' ? 'Избранное' : GROUP_NAME[c.group];
    html = block(title, list);
  }
  if (!list.length) {
    html = c.group === 'fav' && !S.fav.length
      ? '<div class="empty"><div class="ico">★</div><b>Пока пусто</b>Открой упражнение и нажми звёздочку — оно появится здесь.</div>'
      : '<div class="empty"><div class="ico">🤷</div><b>Ничего не нашлось</b>Попробуй короче: «жим», «тяга», «присед» или сбрось фильтры.</div>';
  }
  el.innerHTML = html;
}

function defaultItem(id) {
  const e = EX[id];
  if (e.kind === 'cardio') return { ex: id, sets: 1, reps: '15 мин' };
  if (id === 'plank' || id === 'side_plank') return { ex: id, sets: 3, reps: '45 сек' };
  if (e.group === 'core') return { ex: id, sets: 3, reps: '15-20' };
  return { ex: id, sets: 3, reps: e.kind === 'base' ? '8-10' : '10-12' };
}

function toggleAdd(id) {
  const i = S.draft.items.map(it => it.ex).lastIndexOf(id);
  if (i >= 0) {
    S.draft.items.splice(i, 1);
    toast('Убрано из тренировки');
  } else {
    S.draft.items.push(defaultItem(id));
    toast(`Добавлено · в тренировке ${S.draft.items.length}`);
  }
  hap.tap();
  saveDraft();
}

function toggleFav(id) {
  const i = S.fav.indexOf(id);
  if (i >= 0) S.fav.splice(i, 1); else S.fav.push(id);
  Store.save('fav', S.fav);
  hap.soft();
  toast(i >= 0 ? 'Убрано из избранного' : '★ В избранном');
}

// альтернативы: та же главная мышца, похожий тип
function alternatives(id) {
  const e = EX[id];
  const main = e.primary[0];
  return DATA.exercises
    .filter(x => x.id !== id && (x.kind === 'cardio') === (e.kind === 'cardio') && x.primary.includes(main))
    .map(x => ({ x, s: (x.primary[0] === main ? 2 : 0) + (x.kind === e.kind ? 1 : 0) + (S.fav.includes(x.id) ? 0.5 : 0) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 10).map(o => o.x);
}

// ---------------------------------------------------------------------------
// Страница упражнения
// ---------------------------------------------------------------------------
PAGES.ex = id => {
  const e = EX[id];
  const inDraft = S.draft.items.some(it => it.ex === id);
  const fav = S.fav.includes(id);
  const best = bestWeight(id);
  const chips = (arr, c) => arr.map(m => `<span class="mchip ${c}">${esc(MUS[m])}</span>`).join('');
  const steps = e.tech.split(/(?<=[.!])\s+/).filter(Boolean).map(s => `<li>${esc(s)}</li>`).join('');
  const alts = alternatives(id).slice(0, 5);
  return {
    title: esc(e.name),
    actions: `<button class="icon-round${fav ? ' on' : ''}" data-act="fav" data-id="${id}" aria-label="Избранное">${fav ? '★' : '☆'}</button>`,
    body: `
      <div class="card hero map-card">${exerciseMap(e)}
        <div class="legend"><span><i style="background:var(--m-primary)"></i>Основные</span>${e.secondary.length ? '<span><i style="background:var(--m-secondary)"></i>Вспомогательные</span>' : ''}</div>
      </div>
      <div><span class="tag hot">${kindLabel(e.kind)}</span><span class="tag">${DATA.levels[e.level]}</span><span class="tag">${esc(GROUP_NAME[e.group])}</span><span class="tag">${esc(e.equipment)}</span></div>
      <div class="info-block"><div class="lbl">Основные мышцы</div><div class="muscle-row">${chips(e.primary, 'p')}</div></div>
      ${e.secondary.length ? `<div class="info-block"><div class="lbl">Вспомогательные</div><div class="muscle-row">${chips(e.secondary, 's')}</div></div>` : ''}
      <div class="info-block"><div class="lbl">Техника</div><ol class="steps">${steps}</ol></div>
      <div class="info-block"><div class="lbl">Частые ошибки</div><div class="warn-box">⚠️ ${esc(e.mistakes)}</div></div>
      ${best ? `<div class="info-block"><div class="card tight row list-row click" data-act="exprog" data-id="${id}"><span>🏆 Твой рекорд: <b>${fmtW(best)} кг</b></span><span class="chev">график ›</span></div></div>` : ''}
      ${alts.length ? `<div class="info-block"><div class="lbl">Похожие упражнения</div><div class="ex-list">${alts.map(exItem).join('')}</div></div>` : ''}
      <div class="sticky-bottom">
        <button class="btn ${inDraft ? 'outline' : 'primary'} big block" data-act="page-toggle-add" data-id="${id}">
          ${inDraft ? '✓ В тренировке — убрать' : '＋ Добавить в тренировку'}</button>
      </div>`,
  };
};

// ---------------------------------------------------------------------------
// «Тренировка» — конструктор
// ---------------------------------------------------------------------------
const scoreColor = s => (s >= 85 ? 'var(--ok)' : s >= 70 ? 'var(--warn)' : s >= 50 ? 'var(--mid)' : 'var(--a1)');
const RING_C = 2 * Math.PI * 36;

function scoreCard(r) {
  const li = (arr, cls, ico) => arr.map(x => `<div class="it ${cls}"><i>${ico}</i><span>${esc(x)}</span></div>`).join('');
  const issues = r.problems.length;
  return `
    <div class="card hero" data-act="toggle-report">
      <div class="score">
        <div class="ring"><svg viewBox="0 0 84 84"><circle class="bg" cx="42" cy="42" r="36"/>
          <circle class="fg" id="ring-fg" cx="42" cy="42" r="36" stroke="${scoreColor(r.score)}" stroke-dasharray="${RING_C}"
            stroke-dashoffset="${RING_C * (1 - S.lastScore / 100)}" data-score="${r.score}"/></svg>
          <div class="num" id="ring-num">${S.lastScore}</div></div>
        <div class="grow">
          <div class="verdict">${Evaluator.verdict(r.score)}</div>
          <div class="meta-row"><span class="tag">${esc(r.type)}</span><span class="tag">⏱ ≈ ${r.minutes} мин</span></div>
          <div class="toggle-line">${issues ? `${issues} ${plural(issues, 'замечание', 'замечания', 'замечаний')} · ` : ''}${S.showReport ? 'скрыть разбор ▲' : 'показать разбор ▼'}</div>
        </div>
      </div>
      ${S.showReport ? `<div class="report">
        ${r.problems.length ? `<div class="grp"><div class="grp-t" style="color:var(--a1)">Что исправить</div>${li(r.problems, 'bad', '!')}</div>` : ''}
        ${r.positives.length ? `<div class="grp"><div class="grp-t" style="color:var(--ok)">Хорошо</div>${li(r.positives, 'good', '✓')}</div>` : ''}
        ${r.tips.length ? `<div class="grp"><div class="grp-t" style="color:var(--warn)">Советы</div>${li(r.tips, 'tip', '💡')}</div>` : ''}
      </div>` : ''}
    </div>`;
}

// плавно докручиваем кольцо и число оценки
function animateScore() {
  const fg = $('#ring-fg'), num = $('#ring-num');
  if (!fg) return;
  const to = parseInt(fg.dataset.score, 10), from = S.lastScore;
  S.lastScore = to;
  requestAnimationFrame(() => requestAnimationFrame(() => { fg.style.strokeDashoffset = RING_C * (1 - to / 100); }));
  const t0 = performance.now(), dur = 800;
  const step = t => {
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    num.textContent = Math.round(from + (to - from) * e);
    if (k < 1 && document.body.contains(num)) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function tabBuilder() {
  const d = S.draft;
  if (!d.items.length) {
    S.lastScore = 0;
    return `<h1>Тренировка</h1><div class="sub">Собери сам или доверь подбор мне</div>
      <div class="card hero cta-card" data-act="gen-open"><div class="ico">✨</div>
        <div class="grow"><h3>Собрать за меня</h3><div class="muted small">Выбери цель и мышцы — подберу упражнения, подходы и порядок</div></div><span class="chev muted">›</span></div>
      <div class="card cta-card" data-act="tab" data-t="catalog"><div class="ico" style="background:var(--card-2)">📚</div>
        <div class="grow"><h3>Выбрать упражнения</h3><div class="muted small">Из справочника — нажимай ＋ у нужных</div></div><span class="chev muted">›</span></div>
      <div class="card cta-card" data-act="tab" data-t="programs"><div class="ico" style="background:var(--card-2)">📋</div>
        <div class="grow"><h3>Готовая программа</h3><div class="muted small">Фулбади, PPL, верх/низ, 5×5 и другие</div></div><span class="chev muted">›</span></div>`;
  }
  const r = Evaluator.evaluate(d.items);
  const items = d.items.map((it, i) => {
    const e = EX[it.ex];
    const cardio = e.kind === 'cardio';
    const opts = cardio ? DATA.cardioOptions : DATA.repsOptions;
    const all = opts.includes(it.reps) ? opts : [it.reps, ...opts];
    const sel = `<select class="select" data-change="reps" data-i="${i}" aria-label="Повторы">${all.map(o => `<option${o === it.reps ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    return `<div class="card item">
      <div class="top"><span class="num">${i + 1}</span><span class="title" data-act="ex" data-id="${e.id}">${esc(e.name)}</span>
        <button class="ibtn" data-act="swap" data-i="${i}" aria-label="Заменить">${ICON.swap}</button></div>
      <div class="ctrl">
        ${cardio ? '' : `<div class="stepper"><button data-act="sets" data-i="${i}" data-d="-1">−</button><span>${it.sets} подх.</span><button data-act="sets" data-i="${i}" data-d="1">+</button></div>`}
        ${sel}<span class="grow"></span>
        <button class="ibtn" data-act="move" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Выше">${ICON.up}</button>
        <button class="ibtn" data-act="move" data-i="${i}" data-d="1" ${i === d.items.length - 1 ? 'disabled' : ''} aria-label="Ниже">${ICON.down}</button>
        <button class="ibtn del" data-act="del" data-i="${i}" aria-label="Убрать">${ICON.x}</button>
      </div></div>`;
  }).join('');
  const worked = Object.keys(r.volume).length;
  return `
    <div class="name-wrap">${ICON.edit}<input class="name-input" value="${esc(d.name)}" maxlength="60" data-input="dname" aria-label="Название тренировки"></div>
    ${scoreCard(r)}
    <div class="card map-card">${heatMap(r.volume)}
      <div class="legend"><span>мало<span class="heat-bar"></span>много подходов</span></div>
      <div class="map-hint">Работает ${worked} из ${Object.keys(MUS).length} групп мышц</div>
    </div>
    <h2>Упражнения <span class="count">${d.items.length}</span></h2>
    ${items}
    <div class="grid2"><button class="btn" data-act="tab" data-t="catalog">＋ Добавить</button><button class="btn" data-act="gen-open">✨ Пересобрать</button></div>
    <div class="spacer"></div>
    <div class="grid2"><button class="btn" data-act="save">💾 Сохранить</button><button class="btn danger" data-act="clear">Очистить</button></div>
    <div class="spacer"></div>
    <button class="btn primary big block" data-act="start">▶ Начать тренировку</button>`;
}

function changeDraft(fn) {
  fn(S.draft.items);
  saveDraft();
  renderTab(false);
}

function saveSheet() {
  openSheet(`<h3>Сохранить тренировку</h3><div class="muted small" style="margin-bottom:12px">Она появится во вкладке «Программы»</div>
    <input class="text-input" id="save-name" maxlength="60" value="${esc(S.draft.name)}" placeholder="Например, Грудь + трицепс">
    <div class="spacer"></div>
    <div class="grid2"><button class="btn" data-act="sheet-close">Отмена</button><button class="btn primary" data-act="save-ok">Сохранить</button></div>`);
  setTimeout(() => { const i = $('#save-name'); if (i) { i.focus(); i.select(); } }, 350);
}

function swapSheet(i) {
  const it = S.draft.items[i];
  const alts = alternatives(it.ex);
  openSheet(`<h3>Заменить «${esc(EX[it.ex].name)}»</h3>
    <div class="muted small" style="margin-bottom:12px">Тренажёр занят или не нравится? Те же мышцы, другое упражнение.</div>
    <div class="ex-list stagger">${alts.map((x, k) => `<div class="ex-item" data-act="swap-to" data-i="${i}" data-id="${x.id}" style="--i:${k}">
      <div class="ex-thumb">${exThumb(x)}</div><div class="grow"><div class="ex-name">${esc(x.name)}</div>
      <div class="ex-sub">${kindLabel(x.kind)} · ${esc(x.equipment)}</div></div><span class="chev muted">›</span></div>`).join('')
      || '<div class="muted">Замены не нашлось</div>'}</div>`);
}

// ---------------------------------------------------------------------------
// Генератор тренировки
// ---------------------------------------------------------------------------
const GEN = {
  focus: [
    ['full', 'Всё тело'], ['upper', 'Верх'], ['lower', 'Ноги'], ['push', 'Грудь + трицепс'],
    ['pull', 'Спина + бицепс'], ['arms', 'Плечи + руки'], ['glutes', 'Ягодицы'], ['core', 'Пресс'],
  ],
  goal: [['mass', '💪 Масса'], ['strength', '🏋️ Сила'], ['tone', '🔥 Рельеф']],
  level: [[1, 'Новичок'], [2, 'Средний'], [3, 'Опытный']],
  equip: [['gym', 'Весь зал'], ['dumbbell', 'Только гантели'], ['machine', 'Тренажёры']],
  dur: [[45, '45 мин'], [60, '60 мин'], [75, '75 мин'], [90, '90 мин']],
};
const SLOTS = {
  full: [['quads,glutes', 'base'], ['chest', 'base'], ['lats,middle_back', 'base'], ['hamstrings', 'base'], ['front_delts,side_delts', null], ['abs,obliques', 'iso'], ['biceps', 'iso'], ['triceps', 'iso']],
  upper: [['chest', 'base'], ['lats', 'base'], ['front_delts', 'base'], ['middle_back', 'base'], ['side_delts', 'iso'], ['biceps', 'iso'], ['triceps', 'iso'], ['rear_delts', 'iso']],
  lower: [['quads', 'base'], ['hamstrings', 'base'], ['glutes', 'base'], ['quads', 'iso'], ['hamstrings', 'iso'], ['calves', 'iso'], ['abs', 'iso'], ['adductors', 'iso']],
  push: [['chest', 'base'], ['front_delts', 'base'], ['chest', 'base'], ['side_delts', 'iso'], ['triceps', 'iso'], ['chest', 'iso'], ['triceps', 'iso'], ['abs', 'iso']],
  pull: [['lats', 'base'], ['middle_back', 'base'], ['lats,middle_back', 'base'], ['rear_delts', 'iso'], ['biceps', 'iso'], ['biceps,forearms', 'iso'], ['traps', 'iso'], ['abs', 'iso']],
  arms: [['front_delts', 'base'], ['side_delts', 'iso'], ['rear_delts', 'iso'], ['biceps', 'iso'], ['triceps', 'iso'], ['biceps', 'iso'], ['triceps', 'iso'], ['forearms', 'iso']],
  glutes: [['glutes', 'base'], ['hamstrings', 'base'], ['quads,glutes', 'base'], ['abductors', 'iso'], ['glutes', 'iso'], ['hamstrings', 'iso'], ['calves', 'iso'], ['abs', 'iso']],
  core: [['abs', 'iso'], ['obliques', 'iso'], ['abs', 'iso'], ['lower_back', 'iso'], ['obliques', 'iso'], ['abs', 'iso']],
};

function equipAllowed(e, mode) {
  const c = CATS[e.id];
  if (mode === 'dumbbell') return c.has('dumbbell') || c.has('kettlebell') || (c.has('body') && !c.has('barbell') && !c.has('machine'));
  if (mode === 'machine') return c.has('machine') || (c.has('body') && !c.has('barbell'));
  return true;
}

function generateOnce(o) {
  const nSlots = { 45: 5, 60: 6, 75: 7, 90: 8 }[o.dur] || 6;
  const slots = SLOTS[o.focus].slice(0, nSlots);
  const chosen = [];
  for (const [ms, kind] of slots) {
    const want = ms.split(',');
    const pool = DATA.exercises.filter(e => e.kind !== 'cardio' && !chosen.includes(e) && e.level <= o.level &&
      (!kind || e.kind === kind) && e.primary.some(m => want.includes(m)) && equipAllowed(e, o.equip));
    if (!pool.length) continue;
    const top = pool.filter(e => want.includes(e.primary[0]));
    const from = top.length ? top : pool;
    chosen.push(from[Math.floor(Math.random() * from.length)]);
  }
  const isCore = e => e.group === 'core';
  const ordered = [...chosen.filter(e => e.kind === 'base' && !isCore(e)), ...chosen.filter(e => e.kind === 'iso' && !isCore(e)), ...chosen.filter(isCore)];
  let baseN = 0;
  const items = ordered.map(e => {
    if (isCore(e)) return defaultItem(e.id);
    const base = e.kind === 'base';
    const k = base ? baseN++ : -1;
    if (o.goal === 'strength') return { ex: e.id, sets: base ? (k < 2 ? 5 : 4) : 3, reps: base ? (k < 2 ? '5' : '6-8') : '8-10' };
    if (o.goal === 'tone') return { ex: e.id, sets: 3, reps: base ? '10-12' : '12-15' };
    return { ex: e.id, sets: base && k === 0 ? 4 : 3, reps: base ? (k === 0 ? '6-8' : '8-10') : '10-12' };
  });
  if (o.goal === 'tone' && o.dur >= 60) items.push({ ex: o.equip === 'dumbbell' ? 'jump_rope' : 'treadmill', sets: 1, reps: o.equip === 'dumbbell' ? '10 мин' : '15 мин' });
  return items;
}

function generateWorkout(o) {
  let best = null, bestScore = -1;
  for (let i = 0; i < 30; i++) {
    const items = generateOnce(o);
    if (!items.length) continue;
    const sc = Evaluator.evaluate(items).score + Math.random();   // случайность — чтобы при равенстве была разнообразие
    if (sc > bestScore) { bestScore = sc; best = items; }
  }
  return best || [];
}

function genSheet() {
  const g = S.gen;
  const group = (key, label, opts) => `<div class="opt-group"><div class="lbl">${label}</div><div class="opts">${
    opts.map(([v, n]) => `<button class="opt${String(g[key]) === String(v) ? ' on' : ''}" data-act="gen-opt" data-k="${key}" data-v="${v}">${n}</button>`).join('')}</div></div>`;
  openSheet(`<h3>✨ Собрать тренировку</h3><div class="muted small" style="margin-bottom:16px">Подберу упражнения, подходы и порядок, проверю оценщиком</div>
    ${group('focus', 'Что тренируем', GEN.focus)}${group('goal', 'Цель', GEN.goal)}${group('level', 'Уровень', GEN.level)}
    ${group('equip', 'Инвентарь', GEN.equip)}${group('dur', 'Время', GEN.dur)}
    <button class="btn primary big block" data-act="gen-go">Собрать</button>`);
}

async function runGenerator() {
  const items = generateWorkout(S.gen);
  if (!items.length) { toast('Не получилось подобрать — смени инвентарь или уровень'); return; }
  if (S.draft.items.length && !(await confirmBox('Заменить текущую тренировку новой?'))) return;
  const focus = GEN.focus.find(f => f[0] === S.gen.focus)[1];
  const goal = GEN.goal.find(f => f[0] === S.gen.goal)[1].replace(/^\S+\s/, '');
  S.draft = { name: `${focus} · ${goal}`, items };
  saveDraft();
  saveGenPrefs();
  closeSheet();
  hap.ok();
  S.showReport = false;
  setTab('builder');
  toast('✨ Тренировка собрана');
}

// ---------------------------------------------------------------------------
// «Программы»
// ---------------------------------------------------------------------------
function itemsList(items) {
  return items.map(it => {
    const e = EX[it.ex];
    return `<div class="list-row small"><span>${esc(e.name)}</span><span class="muted">${e.kind === 'cardio' ? esc(it.reps) : `${it.sets}×${esc(it.reps)}`}</span></div>`;
  }).join('');
}
const progItems = day => day.items.map(([ex, sets, reps]) => ({ ex, sets, reps }));
const scoreTag = sc => `<span class="tag" style="background:${scoreColor(sc)};color:#fff">${sc}/100</span>`;

function tabPrograms() {
  const saved = S.saved.length
    ? S.saved.map(w => `<div class="card">
        <div class="row"><h3 class="grow">${esc(w.name)}</h3>${scoreTag(Evaluator.evaluate(w.items).score)}</div>
        <div class="muted small">${w.items.length} упр.</div>
        ${itemsList(w.items)}
        <div class="spacer"></div>
        <div class="grid2"><button class="btn primary" data-act="load-saved" data-id="${w.id}">Загрузить</button>
        <button class="btn danger" data-act="del-saved" data-id="${w.id}">Удалить</button></div></div>`).join('')
    : '<div class="card muted small">Пока пусто. Собери тренировку и нажми «💾 Сохранить».</div>';

  const icons = { fb: '🌱', ppl: '🔁', ul: '↕️', split: '🗓', glutes: '🍑', strength: '🏋️', fatburn: '🔥' };
  const progs = DATA.programs.map(p => {
    const open = S.openProg === p.id;
    const days = open ? p.days.map((d, di) => {
      const items = progItems(d);
      return `<div class="card tight" style="margin-top:12px;background:var(--card-2)">
        <div class="row"><b class="grow">${esc(d.name)}</b>${scoreTag(Evaluator.evaluate(items).score)}</div>
        ${itemsList(items)}
        <div class="spacer"></div>
        <button class="btn primary block" data-act="load-prog" data-p="${p.id}" data-d="${di}">Загрузить «${esc(d.name)}»</button></div>`;
    }).join('') : '';
    return `<div class="card">
      <div class="cta-card" data-act="open-prog" data-p="${p.id}">
        <div class="ico" style="background:var(--card-2)">${icons[p.id] || '📋'}</div>
        <div class="grow"><h3>${esc(p.name)}</h3><div class="muted small">${esc(p.desc)}</div></div>
        <span class="chev muted">${open ? '▲' : '▼'}</span>
      </div>${days}</div>`;
  }).join('');
  return `<h1>Программы</h1><div class="sub">Готовые схемы и твои сохранённые тренировки</div>
    <div class="card hero cta-card" data-act="gen-open"><div class="ico">✨</div>
      <div class="grow"><h3>Собрать под себя</h3><div class="muted small">Цель, уровень, инвентарь и время — остальное подберу</div></div><span class="chev muted">›</span></div>
    <h2>Мои тренировки <span class="count">${S.saved.length}</span></h2>${saved}
    <h2>Готовые программы</h2>${progs}`;
}

async function loadIntoDraft(name, items) {
  if (S.draft.items.length && !(await confirmBox('Заменить текущую тренировку в конструкторе?'))) return;
  S.draft = { name, items: items.map(it => ({ ...it })) };
  saveDraft();
  hap.ok();
  toast('Загружено в конструктор');
  setTab('builder');
}
