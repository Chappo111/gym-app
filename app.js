// Мини-приложение «Тренировки»: справочник, конструктор, программы, режим тренировки, прогресс.
'use strict';

const tg = window.Telegram && window.Telegram.WebApp;
const inTelegram = !!(tg && tg.initData);
const EX = Object.fromEntries(DATA.exercises.map(e => [e.id, e]));
const MUS = DATA.muscles;
const GROUP_NAME = Object.fromEntries(DATA.groups.map(g => [g.key, g.name]));

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtW = w => String(Math.round(w * 100) / 100);
const pad = n => String(n).padStart(2, '0');
const fmtTime = sec => { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600); const m = Math.floor(sec / 60) % 60; return (h ? h + ':' + pad(m) : m) + ':' + pad(sec % 60); };
const fmtDate = ts => { const d = new Date(ts); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; };
const plural = (n, a, b, c) => { n = Math.abs(n) % 100; const n1 = n % 10; if (n > 10 && n < 20) return c; if (n1 > 1 && n1 < 5) return b; if (n1 === 1) return a; return c; };
const setsWord = n => plural(n, 'подход', 'подхода', 'подходов');
const kindMark = k => (k === 'base' ? '◆ базовое' : k === 'iso' ? '◇ изолирующее' : '♥ кардио');

// ---------------------------------------------------------------------------
// Состояние
// ---------------------------------------------------------------------------
const S = {
  tab: 'catalog',
  draft: { name: 'Моя тренировка', items: [] },
  saved: [],          // [{id, name, items}]
  cur: null,          // идущая тренировка {id, name, items, idx, start, sets:[[ex,w,r]], prs}
  hist: [],           // завершённые [{id, name, start, end, sets:[[ex,w,r]]}]
  cat: { group: 'all', muscle: null, q: '' },
  openProg: null,
  pages: [],          // стек страниц поверх вкладок
  rest: null,         // {until, total}
  restDefault: 90,
  inputs: { w: 0, r: 10, ex: null },
  showReport: true,
};

try { S.restDefault = parseInt(localStorage.getItem('gym:restDefault'), 10) || 90; } catch { /* нет доступа */ }

// ---------------------------------------------------------------------------
// Мелочи: вибрация, звук, тост, подтверждение
// ---------------------------------------------------------------------------
const hap = {
  tap() { try { tg && tg.HapticFeedback.impactOccurred('light'); } catch { /* старая версия */ } },
  ok() { try { tg && tg.HapticFeedback.notificationOccurred('success'); } catch { /* */ } },
  warn() { try { tg && tg.HapticFeedback.notificationOccurred('warning'); } catch { /* */ } },
};

let audioCtx = null;
function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* без звука */ }
}
function beep() {
  if (!audioCtx) return;
  try {
    [0, 0.25, 0.5].forEach(t => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination);
      const t0 = audioCtx.currentTime + t;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      o.start(t0); o.stop(t0 + 0.2);
    });
  } catch { /* */ }
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function confirmBox(msg) {
  return new Promise(res => {
    if (inTelegram && tg.isVersionAtLeast('6.2')) tg.showConfirm(msg, ok => res(!!ok));
    else res(window.confirm(msg));
  });
}

window.onStoreError = () => toast('⚠️ Не удалось сохранить — проверь интернет');

// ---------------------------------------------------------------------------
// Сохранение
// ---------------------------------------------------------------------------
let draftTimer;
function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => Store.save('draft', S.draft), 400);
}
const saveCur = () => (S.cur ? Store.save('cur', S.cur) : Store.remove('cur'));
const monthKey = ts => { const d = new Date(ts); return `m_${d.getFullYear()}_${pad(d.getMonth() + 1)}`; };
function saveMonth(ts) {
  const k = monthKey(ts);
  Store.save(k, S.hist.filter(s => monthKey(s.start) === k));
}

// ---------------------------------------------------------------------------
// Аналитика по дневнику
// ---------------------------------------------------------------------------
const e1rm = (w, r) => (r > 1 ? w * (1 + r / 30) : w);

function bestWeight(ex, includeCur = false) {
  let best = 0;
  for (const s of S.hist) for (const [e, w] of s.sets) if (e === ex && w > best) best = w;
  if (includeCur && S.cur) for (const [e, w] of S.cur.sets) if (e === ex && w > best) best = w;
  return best;
}

function lastResult(ex) {
  for (let i = S.hist.length - 1; i >= 0; i--) {
    const sets = S.hist[i].sets.filter(s => s[0] === ex);
    if (sets.length) return { date: fmtDate(S.hist[i].start), sets };
  }
  return null;
}

function records() {
  const best = {};
  for (const s of S.hist) for (const [ex, w, r] of s.sets) {
    if (!EX[ex] || w <= 0) continue;
    const b = best[ex] || (best[ex] = { ex, w: 0, r: 0, e1rm: 0 });
    if (w > b.w || (w === b.w && r > b.r)) { b.w = w; b.r = r; }
    b.e1rm = Math.max(b.e1rm, e1rm(w, r));
  }
  return Object.values(best).sort((a, b) => b.e1rm - a.e1rm);
}

function exerciseHistory(ex) {
  const pts = [];
  for (const s of S.hist) {
    const sets = s.sets.filter(x => x[0] === ex);
    if (!sets.length) continue;
    let w = 0, r = 0, best = 0;
    for (const [, sw, sr] of sets) {
      if (sw > w || (sw === w && sr > r)) { w = sw; r = sr; }
      best = Math.max(best, e1rm(sw, sr));
    }
    pts.push({ date: s.start, w, r, e1rm: best, sets });
  }
  return pts;
}

const tonnage = sets => sets.reduce((t, [, w, r]) => t + w * r, 0);

// ---------------------------------------------------------------------------
// Картинка человека с мышцами (SVG)
// ---------------------------------------------------------------------------
const TOP = 34;
function bodySVG({ classOf = () => '', styleOf = () => '', clickable = false, selected = null } = {}) {
  const B = DATA.body;
  const mir = pts => pts.map(([x, y]) => [-x, y]);
  const fig = (cx, muscles, face) => {
    const tx = pts => pts.map(([x, y]) => `${cx + x},${y + TOP}`).join(' ');
    const sil = B.silhouette.concat(mir(B.silhouette).reverse());
    let s = `<polygon class="sil" points="${tx(sil)}"/>`;
    s += `<rect class="sil" x="${cx - 14}" y="${TOP + 76}" width="28" height="30" style="stroke:none"/>`;
    s += `<ellipse class="sil" cx="${cx}" cy="${TOP + 47}" rx="30" ry="39"/>`;
    if (face) s += `<circle cx="${cx - 11}" cy="${TOP + 45}" r="3" class="sil" style="fill-opacity:.5"/><circle cx="${cx + 11}" cy="${TOP + 45}" r="3" class="sil" style="fill-opacity:.5"/>`;
    for (const [m, polys] of Object.entries(muscles)) {
      const cls = `m ${classOf(m)}${selected === m ? ' sel' : ''}`;
      const st = styleOf(m);
      for (const p of polys) for (const q of [p, mir(p)]) {
        s += `<polygon class="${cls}" data-m="${m}"${st ? ` style="${st}"` : ''} points="${tx(q)}"/>`;
      }
    }
    return s;
  };
  return `<svg class="body${clickable ? ' clickable' : ''}" viewBox="60 0 640 ${TOP + 694}" xmlns="http://www.w3.org/2000/svg">
    <text x="190" y="24" text-anchor="middle">Спереди</text><text x="570" y="24" text-anchor="middle">Сзади</text>
    ${fig(190, B.front, true)}${fig(570, B.back, false)}</svg>`;
}

function exerciseMap(e) {
  return bodySVG({ classOf: m => (e.primary.includes(m) ? 'p' : e.secondary.includes(m) ? 's' : '') });
}

// цвет «тепловой карты» по количеству подходов
function heatStyle(v) {
  if (!v) return '';
  const stops = [[0, [247, 198, 193]], [0.5, [229, 57, 53]], [1, [127, 16, 16]]];
  const t = Math.min(1, v / 10);
  let a = stops[0], b = stops[1];
  if (t > 0.5) { a = stops[1]; b = stops[2]; }
  const k = (t - a[0]) / (b[0] - a[0]);
  const c = a[1].map((x, i) => Math.round(x + (b[1][i] - x) * k));
  return `fill:rgb(${c});fill-opacity:1;stroke:#8a1c1c;stroke-opacity:.6`;
}

// ---------------------------------------------------------------------------
// Навигация
// ---------------------------------------------------------------------------
function setTab(t) {
  S.tab = t;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  renderTab();
  window.scrollTo(0, 0);
}

function openPage(type, arg) {
  S.pages.push({ type, arg });
  renderPage();
}

function closePage() {
  S.pages.pop();
  renderPage();
  renderTab();
}

function replacePage(type, arg) {
  S.pages[S.pages.length - 1] = { type, arg };
  renderPage();
}

function renderPage() {
  const el = $('#page');
  const top = S.pages[S.pages.length - 1];
  if (!top) {
    el.hidden = true;
    el.innerHTML = '';
    document.body.style.overflow = '';
    if (inTelegram) tg.BackButton.hide();
    renderBanner();
    return;
  }
  const html = { ex: pageExercise, train: pageTrain, summary: pageSummary, exprog: pageExProgress }[top.type](top.arg);
  el.innerHTML = `<div class="page-head">${inTelegram ? '' : '<button class="back" data-act="back">‹ Назад</button>'}<h3>${html.title}</h3></div><div class="page-body">${html.body}</div>`;
  el.hidden = false;
  el.scrollTop = 0;
  document.body.style.overflow = 'hidden';
  if (inTelegram) tg.BackButton.show();
  renderBanner();
}

function rerenderPage() {
  const top = S.pages[S.pages.length - 1];
  if (!top) return;
  const scroll = $('#page').scrollTop;
  renderPage();
  $('#page').scrollTop = scroll;
}

function renderBanner() {
  const b = $('#banner');
  const onTrain = S.pages.some(p => p.type === 'train');
  if (S.cur && !onTrain) {
    b.hidden = false;
    b.innerHTML = `<span>▶ Идёт тренировка · <span id="banner-time">${fmtTime((Date.now() - S.cur.start) / 1000)}</span></span><span>Продолжить ›</span>`;
  } else {
    b.hidden = true;
  }
  const n = S.draft.items.length;
  $('#badge').hidden = !n;
  $('#badge').textContent = n;
}

function renderTab() {
  const v = $('#view');
  v.innerHTML = { catalog: tabCatalog, builder: tabBuilder, programs: tabPrograms, progress: tabProgress }[S.tab]();
  if (S.tab === 'catalog') renderCatalogList();
  renderBanner();
}

// ---------------------------------------------------------------------------
// Вкладка «Упражнения»
// ---------------------------------------------------------------------------
function tabCatalog() {
  const c = S.cat;
  const chips = [{ key: 'all', name: 'Все' }, ...DATA.groups]
    .map(g => `<button class="chip${c.group === g.key ? ' on' : ''}" data-act="group" data-g="${g.key}">${g.name}</button>`).join('');
  const head = c.muscle
    ? `<div class="muscle-pick"><span>🔴 ${esc(MUS[c.muscle])}</span><button class="btn ghost" data-act="muscle-clear">✕ Сбросить</button></div>`
    : '';
  return `
    <h1>Упражнения</h1>
    <input class="search" type="search" placeholder="🔎 Поиск: жим, тяга, присед…" value="${esc(c.q)}" data-input="q">
    <div class="body-wrap" id="catmap">${head}${bodySVG({ clickable: true, selected: c.muscle })}
      ${c.muscle ? '' : '<div class="map-hint">Нажми на мышцу — покажу упражнения для неё</div>'}</div>
    <div class="chips">${chips}</div>
    <div id="exlist"></div>`;
}

function exItem(e) {
  const inDraft = S.draft.items.some(it => it.ex === e.id);
  return `<div class="ex-item" data-act="ex" data-id="${e.id}">
      <div class="grow"><div class="ex-name">${esc(e.name)}</div>
      <div class="ex-sub">${kindMark(e.kind)} · ${esc(e.equipment)}</div></div>
      <button class="add-btn${inDraft ? ' in' : ''}" data-act="toggle-add" data-id="${e.id}" aria-label="Добавить">${inDraft ? '✓' : '+'}</button>
    </div>`;
}

function renderCatalogList() {
  const el = $('#exlist');
  if (!el) return;
  const c = S.cat;
  const words = c.q.toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean);
  let list = DATA.exercises.filter(e => {
    if (c.group !== 'all' && e.group !== c.group) return false;
    const name = e.name.toLowerCase().replace(/ё/g, 'е');
    return words.every(w => name.includes(w));
  });
  let html = '';
  if (c.muscle) {
    const main = list.filter(e => e.primary.includes(c.muscle));
    const help = list.filter(e => e.secondary.includes(c.muscle));
    if (main.length) html += `<div class="section-title">Основная нагрузка · ${main.length}</div><div class="ex-list">${main.map(exItem).join('')}</div>`;
    if (help.length) html += `<div class="section-title">Вспомогательная · ${help.length}</div><div class="ex-list">${help.map(exItem).join('')}</div>`;
    list = main.concat(help);
  } else {
    html = `<div class="section-title">${c.group === 'all' ? 'Все упражнения' : GROUP_NAME[c.group]} · ${list.length}</div><div class="ex-list">${list.map(exItem).join('')}</div>`;
  }
  if (!list.length) html = '<div class="empty"><div class="big">🤷</div>Ничего не нашлось. Попробуй короче: «жим», «тяга», «присед».</div>';
  el.innerHTML = html;
}

function defaultItem(id) {
  const e = EX[id];
  if (e.kind === 'cardio') return { ex: id, sets: 1, reps: '15 мин' };
  if (id === 'plank' || id === 'side_plank') return { ex: id, sets: 3, reps: '45 сек' };
  return { ex: id, sets: 3, reps: e.kind === 'base' ? '8-10' : '10-12' };
}

function toggleAdd(id) {
  const i = S.draft.items.map(it => it.ex).lastIndexOf(id);
  if (i >= 0) {
    S.draft.items.splice(i, 1);
    toast('Убрано из тренировки');
  } else {
    S.draft.items.push(defaultItem(id));
    toast(`✅ Добавлено · в тренировке ${S.draft.items.length}`);
  }
  hap.tap();
  saveDraft();
}

// ---------------------------------------------------------------------------
// Страница упражнения
// ---------------------------------------------------------------------------
function pageExercise(id) {
  const e = EX[id];
  const inDraft = S.draft.items.some(it => it.ex === id);
  const best = bestWeight(id);
  const list = arr => (arr.length ? arr.map(m => esc(MUS[m])).join(', ') : '—');
  return {
    title: esc(e.name),
    body: `
      <div class="body-wrap">${exerciseMap(e)}
        <div class="legend"><span><i style="background:var(--accent)"></i>Основные</span>${e.secondary.length ? '<span><i style="background:var(--pink)"></i>Вспомогательные</span>' : ''}</div>
      </div>
      <div><span class="tag">${kindMark(e.kind)}</span><span class="tag">${DATA.levels[e.level]}</span><span class="tag">${esc(GROUP_NAME[e.group])}</span></div>
      <dl class="info">
        <dt>🔴 Основные мышцы</dt><dd>${list(e.primary)}</dd>
        <dt>🩷 Вспомогательные</dt><dd>${list(e.secondary)}</dd>
        <dt>🏋️ Инвентарь</dt><dd>${esc(e.equipment)}</dd>
        <dt>✅ Техника</dt><dd>${esc(e.tech)}</dd>
        <dt>⚠️ Частые ошибки</dt><dd>${esc(e.mistakes)}</dd>
        ${best ? `<dt>🏆 Твой рекорд</dt><dd>${fmtW(best)} кг <button class="btn ghost" data-act="exprog" data-id="${id}">график ›</button></dd>` : ''}
      </dl>
      <div style="height:14px"></div>
      <button class="btn ${inDraft ? '' : 'primary'} big block" data-act="page-toggle-add" data-id="${id}">
        ${inDraft ? '✓ В тренировке — убрать' : '＋ Добавить в тренировку'}</button>`,
  };
}

// ---------------------------------------------------------------------------
// Вкладка «Тренировка» (конструктор)
// ---------------------------------------------------------------------------
function scoreColor(s) { return s >= 85 ? 'var(--ok)' : s >= 70 ? 'var(--warn)' : s >= 50 ? '#f08a24' : 'var(--accent)'; }

function scoreCard(r) {
  const li = arr => arr.map(x => `<li>${esc(x)}</li>`).join('');
  return `
    <div class="card" data-act="toggle-report">
      <div class="score">
        <div class="score-ring" style="background:${scoreColor(r.score)}">${r.score}</div>
        <div class="grow">
          <div class="verdict">${Evaluator.verdict(r.score)}</div>
          <div class="muted small">${esc(r.type)} · ≈ ${r.minutes} мин</div>
          <div class="muted small">${S.showReport ? 'Скрыть разбор ▲' : 'Показать разбор ▼'}</div>
        </div>
      </div>
      ${S.showReport ? `<div class="report">
        ${r.problems.length ? `<h4>⚠️ Что исправить</h4><ul>${li(r.problems)}</ul>` : ''}
        ${r.positives.length ? `<h4>✅ Хорошо</h4><ul>${li(r.positives)}</ul>` : ''}
        ${r.tips.length ? `<h4>💡 Советы</h4><ul>${li(r.tips)}</ul>` : ''}
      </div>` : ''}
    </div>`;
}

function tabBuilder() {
  const d = S.draft;
  if (!d.items.length) {
    return `<h1>Тренировка</h1>
      <div class="empty"><div class="big">🏗</div>
        <p>Собери тренировку из упражнений — я покажу, какие мышцы работают, и оценю её эффективность.</p></div>
      <button class="btn primary big block" data-act="tab" data-t="catalog">📚 Выбрать упражнения</button>
      <div style="height:8px"></div>
      <button class="btn big block" data-act="tab" data-t="programs">📋 Взять готовую программу</button>`;
  }
  const r = Evaluator.evaluate(d.items);
  const items = d.items.map((it, i) => {
    const e = EX[it.ex];
    const cardio = e.kind === 'cardio';
    const opts = cardio ? DATA.cardioOptions : DATA.repsOptions;
    const all = opts.includes(it.reps) ? opts : [it.reps, ...opts];
    const sel = `<select class="select" data-change="reps" data-i="${i}">${all.map(o => `<option${o === it.reps ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    return `<div class="card item">
      <div class="top"><span class="num">${i + 1}</span><span class="title" data-act="ex" data-id="${e.id}">${esc(e.name)}</span></div>
      <div class="ctrl">
        ${cardio ? '' : `<div class="stepper"><button data-act="sets" data-i="${i}" data-d="-1">−</button><span>${it.sets} ${setsWord(it.sets)}</span><button data-act="sets" data-i="${i}" data-d="1">+</button></div>`}
        ${cardio ? '' : '<span class="muted">×</span>'}${sel}
        <span class="grow"></span>
        <button class="icon-btn" data-act="move" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Выше">↑</button>
        <button class="icon-btn" data-act="move" data-i="${i}" data-d="1" ${i === d.items.length - 1 ? 'disabled' : ''} aria-label="Ниже">↓</button>
        <button class="icon-btn del" data-act="del" data-i="${i}" aria-label="Убрать">✕</button>
      </div></div>`;
  }).join('');
  const vol = r.volume;
  const worked = Object.keys(vol).length;
  return `
    <input class="name-input" value="${esc(d.name)}" maxlength="60" data-input="dname" aria-label="Название тренировки">
    ${scoreCard(r)}
    <div class="body-wrap">${bodySVG({ styleOf: m => heatStyle(vol[m]) })}
      <div class="legend"><span>мало <span class="heat-bar"></span> много подходов</span></div>
      <div class="muted small" style="text-align:center;padding-bottom:6px">Работает ${worked} из ${Object.keys(MUS).length} групп мышц</div>
    </div>
    <h2>Упражнения · ${d.items.length}</h2>
    ${items}
    <button class="btn block" data-act="tab" data-t="catalog">＋ Добавить упражнения</button>
    <div style="height:8px"></div>
    <div class="grid2">
      <button class="btn" data-act="save">💾 Сохранить</button>
      <button class="btn danger" data-act="clear">🗑 Очистить</button>
    </div>
    <div style="height:12px"></div>
    <button class="btn primary big block" data-act="start">▶ Начать тренировку</button>`;
}

function changeDraft(fn) {
  fn(S.draft.items);
  saveDraft();
  renderTab();
}

function saveModal() {
  const m = $('#modal');
  m.innerHTML = `<div class="sheet">
    <h3>Сохранить тренировку</h3>
    <input class="text-input" id="save-name" maxlength="60" value="${esc(S.draft.name)}" placeholder="Например, Грудь + трицепс">
    <div style="height:12px"></div>
    <div class="grid2"><button class="btn" data-act="modal-close">Отмена</button><button class="btn primary" data-act="save-ok">Сохранить</button></div>
  </div>`;
  m.hidden = false;
  setTimeout(() => { const i = $('#save-name'); i.focus(); i.select(); }, 50);
}

// ---------------------------------------------------------------------------
// Вкладка «Программы»
// ---------------------------------------------------------------------------
function itemsList(items) {
  return items.map(it => {
    const e = EX[it.ex];
    return `<div class="small">• ${esc(e.name)} — ${e.kind === 'cardio' ? esc(it.reps) : `${it.sets}×${esc(it.reps)}`}</div>`;
  }).join('');
}

const progItems = day => day.items.map(([ex, sets, reps]) => ({ ex, sets, reps }));

function tabPrograms() {
  const saved = S.saved.length
    ? S.saved.map(w => `<div class="card">
        <h3>${esc(w.name)}</h3>
        <div class="muted small">${w.items.length} упр. · оценка ${Evaluator.evaluate(w.items).score}/100</div>
        <div style="height:8px"></div>${itemsList(w.items)}
        <div style="height:10px"></div>
        <div class="grid2"><button class="btn primary" data-act="load-saved" data-id="${w.id}">📥 Загрузить</button>
        <button class="btn danger" data-act="del-saved" data-id="${w.id}">Удалить</button></div></div>`).join('')
    : '<div class="card muted small">Пока пусто. Собери тренировку и нажми «💾 Сохранить».</div>';

  const progs = DATA.programs.map(p => {
    const open = S.openProg === p.id;
    const days = open ? p.days.map((d, di) => {
      const items = progItems(d);
      const sc = Evaluator.evaluate(items).score;
      return `<div style="margin-top:12px"><div class="row"><b class="grow">${esc(d.name)}</b><span class="tag" style="background:${scoreColor(sc)};color:#fff">${sc}/100</span></div>
        ${itemsList(items)}
        <div style="height:8px"></div>
        <button class="btn block" data-act="load-prog" data-p="${p.id}" data-d="${di}">📥 Загрузить «${esc(d.name)}»</button></div>`;
    }).join('') : '';
    return `<div class="card">
      <div data-act="open-prog" data-p="${p.id}" style="cursor:pointer">
        <div class="row"><h3 class="grow">${esc(p.name)}</h3><span class="muted">${open ? '▲' : '▼'}</span></div>
        <div class="muted small">${esc(p.desc)}</div>
      </div>${days}</div>`;
  }).join('');
  return `<h1>Программы</h1><h2>💾 Мои тренировки</h2>${saved}<h2>📋 Готовые программы</h2>${progs}`;
}

async function loadIntoDraft(name, items) {
  if (S.draft.items.length && !(await confirmBox('Заменить текущую тренировку в конструкторе?'))) return;
  S.draft = { name, items: items.map(it => ({ ...it })) };
  saveDraft();
  hap.ok();
  toast('Загружено в конструктор');
  setTab('builder');
}

// ---------------------------------------------------------------------------
// Режим тренировки
// ---------------------------------------------------------------------------
async function startTraining() {
  unlockAudio();
  if (S.cur) { openPage('train'); return; }
  if (!S.draft.items.length) return;
  S.cur = {
    id: Date.now(), name: S.draft.name, items: S.draft.items.map(it => ({ ...it })),
    idx: 0, start: Date.now(), sets: [], prs: 0,
  };
  S.inputs.ex = null;
  saveCur();
  if (inTelegram && tg.isVersionAtLeast('6.2')) tg.enableClosingConfirmation();
  hap.ok();
  openPage('train');
}

function curSets(ex) { return S.cur.sets.filter(s => s[0] === ex); }

function prefillInputs() {
  const it = S.cur.items[S.cur.idx];
  if (S.inputs.ex === it.ex) return;
  const mine = curSets(it.ex);
  const last = lastResult(it.ex);
  const src = mine.length ? mine[mine.length - 1] : last ? last.sets[0] : null;
  S.inputs = { ex: it.ex, w: src ? src[1] : 0, r: src ? src[2] : Evaluator.firstInt(it.reps, 10) };
}

function pageTrain() {
  const c = S.cur;
  if (!c) return { title: 'Тренировка', body: '<div class="empty">Тренировка не запущена</div>' };
  prefillInputs();
  const it = c.items[c.idx];
  const e = EX[it.ex];
  const cardio = e.kind === 'cardio';
  const secs = /сек/.test(it.reps);
  const mine = curSets(it.ex);
  const last = lastResult(it.ex);
  const best = bestWeight(it.ex);
  const setStr = s => (s[1] ? `${fmtW(s[1])}×${s[2]}` : `${s[2]}${cardio ? ' мин' : ''}`);
  const dots = c.items.map((x, i) => {
    const done = c.sets.some(s => s[0] === x.ex);
    return `<button class="${i === c.idx ? 'cur' : ''}${done ? ' done' : ''}" data-act="goto" data-i="${i}">${i + 1}</button>`;
  }).join('');
  const field = (label, key, step, wide) => `
    <div class="num-field"${wide ? ' style="grid-column:1/-1"' : ''}><label>${label}</label>
      <div class="row"><button data-act="inc" data-k="${key}" data-d="${-step}">−${step}</button>
      <input type="number" inputmode="decimal" min="0" step="${step}" value="${S.inputs[key]}" data-input="in-${key}">
      <button data-act="inc" data-k="${key}" data-d="${step}">+${step}</button></div></div>`;
  const rest = S.rest
    ? `<div class="rest-live"><span>Отдых</span><span class="timer" id="rest-time">${fmtTime((S.rest.until - Date.now()) / 1000)}</span>
        <button class="btn" data-act="rest-stop">Стоп</button></div>`
    : `<div class="rest"><span class="muted small">Отдых:</span>${[60, 90, 120, 180].map(s => `<button class="chip${S.restDefault === s ? ' on' : ''}" data-act="rest" data-s="${s}">${fmtTime(s)}</button>`).join('')}</div>`;
  return {
    title: esc(c.name),
    body: `
      <div class="train-top"><span class="muted">Упражнение ${c.idx + 1} из ${c.items.length}</span><span class="timer" id="elapsed">${fmtTime((Date.now() - c.start) / 1000)}</span></div>
      <div class="dots">${dots}</div>
      <div class="card">
        <div class="row"><h3 class="grow">${esc(e.name)}</h3><button class="btn ghost" data-act="ex" data-id="${e.id}">техника ›</button></div>
        <div class="muted small">План: ${cardio ? esc(it.reps) : `${it.sets}×${esc(it.reps)}`}</div>
        ${last ? `<div class="small">Прошлый раз (${last.date}): ${last.sets.map(setStr).join(', ')}</div>` : ''}
        ${best ? `<div class="small">🏆 Рекорд: ${fmtW(best)} кг</div>` : ''}
        <div class="set-chips">${mine.length ? mine.map((s, i) => `<span class="set-chip">${i + 1}: ${setStr(s)}</span>`).join('') : '<span class="muted small">Подходов пока нет</span>'}</div>
      </div>
      <div class="inputs">
        ${cardio ? field('Минут', 'r', 1, true) : field('Вес, кг', 'w', 2.5) + field(secs ? 'Секунд' : 'Повторы', 'r', secs ? 5 : 1)}
      </div>
      <button class="btn primary big block" data-act="logset">✓ Записать подход${mine.length ? ` ${mine.length + 1}` : ''}</button>
      ${rest}
      <div class="grid3">
        <button class="btn" data-act="goto" data-i="${c.idx - 1}" ${c.idx === 0 ? 'disabled' : ''}>← Пред.</button>
        <button class="btn" data-act="undo" ${mine.length ? '' : 'disabled'}>Отменить</button>
        <button class="btn" data-act="goto" data-i="${c.idx + 1}" ${c.idx === c.items.length - 1 ? 'disabled' : ''}>След. →</button>
      </div>
      <div style="height:16px"></div>
      <button class="btn block danger" data-act="finish">🏁 Завершить тренировку</button>
      <p class="muted small" style="text-align:center">Таймер отдыха работает, пока приложение открыто.</p>`,
  };
}

function startRest(sec) {
  unlockAudio();
  S.restDefault = sec;
  try { localStorage.setItem('gym:restDefault', String(sec)); } catch { /* */ }
  S.rest = { until: Date.now() + sec * 1000, total: sec };
}

function logSet() {
  unlockAudio();
  const c = S.cur;
  const it = c.items[c.idx];
  const cardio = EX[it.ex].kind === 'cardio';
  const w = cardio ? 0 : Math.max(0, Math.round((parseFloat(S.inputs.w) || 0) * 100) / 100);
  const r = Math.round(parseFloat(S.inputs.r) || 0);
  if (r < 1 || r > 600 || w > 1000) { hap.warn(); toast('Проверь вес и повторы'); return; }
  const hadBefore = S.hist.some(s => s.sets.some(x => x[0] === it.ex));
  const prevBest = bestWeight(it.ex, true);
  c.sets.push([it.ex, w, r]);
  const pr = hadBefore && w > 0 && w > prevBest;
  if (pr) c.prs = (c.prs || 0) + 1;
  saveCur();
  if (pr) { hap.ok(); toast(`🏆 Новый рекорд: ${fmtW(w)} кг!`); } else { hap.tap(); toast('✓ Записано'); }
  if (!cardio) startRest(S.restDefault);
  rerenderPage();
}

async function finishTraining() {
  if (!(await confirmBox('Завершить тренировку?'))) return;
  const c = S.cur;
  S.cur = null;
  S.rest = null;
  saveCur();
  if (inTelegram && tg.isVersionAtLeast('6.2')) tg.disableClosingConfirmation();
  if (!c.sets.length) {
    toast('Подходов не было — тренировка не сохранена');
    S.pages = [];
    renderPage();
    renderTab();
    return;
  }
  const session = { id: c.id, name: c.name, start: c.start, end: Date.now(), sets: c.sets };
  S.hist.push(session);
  saveMonth(session.start);
  hap.ok();
  S.pages = [{ type: 'summary', arg: { ...session, prs: c.prs || 0 } }];
  renderPage();
}

function pageSummary(s) {
  const byEx = {};
  for (const x of s.sets) (byEx[x[0]] = byEx[x[0]] || []).push(x);
  const mins = Math.round((s.end - s.start) / 60000);
  return {
    title: 'Тренировка завершена',
    body: `<div class="empty"><div class="big">🏁</div><b>Отличная работа!</b></div>
      <div class="grid3">
        <div class="stat"><b>${mins}</b><span>минут</span></div>
        <div class="stat"><b>${s.sets.length}</b><span>${setsWord(s.sets.length)}</span></div>
        <div class="stat"><b>${Math.round(tonnage(s.sets))}</b><span>кг тоннаж</span></div>
      </div>
      ${s.prs ? `<div class="card" style="margin-top:10px">🏆 Новых рекордов: <b>${s.prs}</b></div>` : ''}
      <h2>Что сделано</h2>
      ${Object.entries(byEx).map(([ex, sets]) => `<div class="list-row"><span>${esc(EX[ex] ? EX[ex].name : ex)}</span><span class="muted">${sets.map(x => (x[1] ? `${fmtW(x[1])}×${x[2]}` : x[2])).join(', ')}</span></div>`).join('')}
      <p class="muted small">Восстанавливайся: сон, белок, вода 💧</p>
      <button class="btn primary big block" data-act="summary-done">Готово</button>`,
  };
}

// ---------------------------------------------------------------------------
// Вкладка «Прогресс»
// ---------------------------------------------------------------------------
function tabProgress() {
  const now = Date.now(), day = 86400000;
  const in7 = S.hist.filter(s => s.start > now - 7 * day);
  const in30 = S.hist.filter(s => s.start > now - 30 * day);
  const t30 = in30.reduce((t, s) => t + tonnage(s.sets), 0);
  const recs = records();
  const store = Store.useCloud ? '☁️ Данные хранятся в облаке Telegram и доступны с любого устройства.'
    : '💻 Приложение открыто вне Telegram — данные хранятся только в этом браузере.';
  if (!S.hist.length) {
    return `<h1>Прогресс</h1><div class="empty"><div class="big">📈</div>
      <p>Здесь появятся статистика, рекорды и история. Запусти тренировку (▶ во вкладке «Тренировка») и записывай подходы.</p></div>
      <p class="muted small">${store}</p>`;
  }
  const recHtml = recs.length ? recs.slice(0, 30).map(r => `
      <div class="list-row click" data-act="exprog" data-id="${r.ex}"><span>${esc(EX[r.ex].name)}</span>
      <span><b>${fmtW(r.w)}×${r.r}</b> <span class="muted small">≈${Math.round(r.e1rm)} кг</span> ›</span></div>`).join('')
    : '<div class="muted small">Записывай вес в подходах — здесь появятся рекорды.</div>';
  const hist = S.hist.slice(-30).reverse().map(s => `
      <div class="list-row"><span><b>${esc(s.name)}</b><br><span class="muted small">${fmtDate(s.start)} · ${Math.round((s.end - s.start) / 60000)} мин</span></span>
      <span class="muted small" style="text-align:right">${s.sets.length} ${setsWord(s.sets.length)}<br>${Math.round(tonnage(s.sets))} кг</span></div>`).join('');
  return `<h1>Прогресс</h1>
    <div class="grid2">
      <div class="stat"><b>${S.hist.length}</b><span>тренировок всего</span></div>
      <div class="stat"><b>${in7.length}</b><span>за 7 дней</span></div>
      <div class="stat"><b>${in30.length}</b><span>за 30 дней</span></div>
      <div class="stat"><b>${Math.round(t30).toLocaleString('ru')}</b><span>кг тоннаж за 30 дней</span></div>
    </div>
    ${in7.length === 0 ? '<div class="card small" style="margin-top:10px">За неделю не было тренировок — самое время вернуться в зал 😉</div>' : ''}
    <h2>🏆 Рекорды</h2><div class="card">${recHtml}</div>
    <h2>📜 История</h2><div class="card">${hist}</div>
    <p class="muted small">${store}</p>`;
}

function chartSVG(pts) {
  const W = 600, H = 240, L = 58, R = 14, T = 16, B = 34;
  const ys = pts.map(p => p.w);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (hi === lo) { lo -= 5; hi += 5; }
  const x = i => (pts.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (pts.length - 1));
  const y = v => T + ((hi - v) * (H - T - B)) / (hi - lo);
  const line = pts.map((p, i) => `${x(i)},${y(p.w)}`).join(' ');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">
    <line class="grid" x1="${L}" y1="${y(hi)}" x2="${W - R}" y2="${y(hi)}"/><line class="grid" x1="${L}" y1="${y(lo)}" x2="${W - R}" y2="${y(lo)}"/>
    <text x="${L - 6}" y="${y(hi) + 4}" text-anchor="end">${fmtW(hi)}</text><text x="${L - 6}" y="${y(lo) + 4}" text-anchor="end">${fmtW(lo)}</text>
    <polyline class="line" points="${line}"/>
    ${pts.map((p, i) => `<circle class="dot" cx="${x(i)}" cy="${y(p.w)}" r="5"/>`).join('')}
    <text x="${x(0)}" y="${H - 8}" text-anchor="start">${fmtDate(pts[0].date)}</text>
    ${pts.length > 1 ? `<text x="${x(pts.length - 1)}" y="${H - 8}" text-anchor="end">${fmtDate(pts[pts.length - 1].date)}</text>` : ''}
  </svg>`;
}

function pageExProgress(id) {
  const pts = exerciseHistory(id);
  const withW = pts.filter(p => p.w > 0);
  return {
    title: esc(EX[id].name),
    body: `
      ${withW.length ? `<div class="card"><div class="muted small">Лучший вес в каждой тренировке, кг</div>${chartSVG(withW)}</div>` : ''}
      <h2>Все тренировки · ${pts.length}</h2>
      <div class="card">${pts.slice().reverse().map(p => `<div class="list-row"><span>${fmtDate(p.date)}</span>
        <span class="muted small" style="text-align:right">${p.sets.map(s => (s[1] ? `${fmtW(s[1])}×${s[2]}` : s[2])).join(', ')}</span></div>`).join('') || '<span class="muted">Нет записей</span>'}</div>
      <button class="btn block" data-act="ex" data-id="${id}">Техника выполнения ›</button>`,
  };
}

// ---------------------------------------------------------------------------
// Обработка нажатий (один обработчик на всё приложение)
// ---------------------------------------------------------------------------
document.addEventListener('click', async ev => {
  if (ev.target.closest('#banner')) { openPage('train'); return; }
  const tab = ev.target.closest('#tabs button');
  if (tab) { hap.tap(); S.pages = []; renderPage(); setTab(tab.dataset.tab); return; }

  const m = ev.target.closest('svg.body.clickable .m');
  if (m) {
    hap.tap();
    S.cat.muscle = S.cat.muscle === m.dataset.m ? null : m.dataset.m;
    renderTab();
    return;
  }

  const a = ev.target.closest('[data-act]');
  if (!a || a.disabled) return;
  const d = a.dataset;
  const i = d.i !== undefined ? parseInt(d.i, 10) : -1;
  switch (d.act) {
    case 'back': closePage(); break;
    case 'tab': setTab(d.t); break;
    case 'group': S.cat.group = d.g; renderTab(); break;
    case 'muscle-clear': S.cat.muscle = null; renderTab(); break;
    case 'ex': openPage('ex', d.id); break;
    case 'toggle-add':
      toggleAdd(d.id);
      a.classList.toggle('in', S.draft.items.some(it => it.ex === d.id));
      a.textContent = a.classList.contains('in') ? '✓' : '+';
      renderBanner();
      break;
    case 'page-toggle-add': toggleAdd(d.id); rerenderPage(); break;

    // конструктор
    case 'toggle-report': S.showReport = !S.showReport; renderTab(); break;
    case 'sets': changeDraft(items => { items[i].sets = Math.max(1, Math.min(10, items[i].sets + parseInt(d.d, 10))); }); hap.tap(); break;
    case 'move': changeDraft(items => { const j = i + parseInt(d.d, 10); [items[i], items[j]] = [items[j], items[i]]; }); hap.tap(); break;
    case 'del': changeDraft(items => { items.splice(i, 1); }); hap.tap(); break;
    case 'clear':
      if (await confirmBox('Очистить тренировку?')) { S.draft = { name: 'Моя тренировка', items: [] }; saveDraft(); renderTab(); }
      break;
    case 'save': saveModal(); break;
    case 'modal-close': $('#modal').hidden = true; break;
    case 'save-ok': {
      const name = ($('#save-name').value || '').trim().slice(0, 60) || 'Моя тренировка';
      S.draft.name = name;
      S.saved.unshift({ id: Date.now(), name, items: S.draft.items.map(it => ({ ...it })) });
      Store.save('saved', S.saved);
      saveDraft();
      $('#modal').hidden = true;
      hap.ok();
      toast('💾 Сохранено в «Программы → Мои тренировки»');
      renderTab();
      break;
    }
    case 'start': startTraining(); break;

    // программы
    case 'open-prog': S.openProg = S.openProg === d.p ? null : d.p; renderTab(); break;
    case 'load-prog': {
      const p = DATA.programs.find(x => x.id === d.p);
      const day = p.days[parseInt(d.d, 10)];
      loadIntoDraft(`${p.name}: ${day.name}`, progItems(day));
      break;
    }
    case 'load-saved': { const w = S.saved.find(x => String(x.id) === d.id); if (w) loadIntoDraft(w.name, w.items); break; }
    case 'del-saved': {
      const w = S.saved.find(x => String(x.id) === d.id);
      if (w && await confirmBox(`Удалить «${w.name}»?`)) {
        S.saved = S.saved.filter(x => x !== w);
        Store.save('saved', S.saved);
        renderTab();
      }
      break;
    }

    // тренировка
    case 'goto':
      if (i >= 0 && i < S.cur.items.length) { S.cur.idx = i; saveCur(); hap.tap(); rerenderPage(); }
      break;
    case 'inc': {
      const k = d.k;
      const v = Math.max(0, Math.round(((parseFloat(S.inputs[k]) || 0) + parseFloat(d.d)) * 100) / 100);
      S.inputs[k] = v;
      const inp = document.querySelector(`[data-input="in-${k}"]`);
      if (inp) inp.value = v;
      hap.tap();
      break;
    }
    case 'logset': logSet(); break;
    case 'undo': {
      const ex = S.cur.items[S.cur.idx].ex;
      for (let j = S.cur.sets.length - 1; j >= 0; j--) if (S.cur.sets[j][0] === ex) { S.cur.sets.splice(j, 1); break; }
      saveCur(); hap.tap(); rerenderPage();
      break;
    }
    case 'rest': startRest(parseInt(d.s, 10)); hap.tap(); rerenderPage(); break;
    case 'rest-stop': S.rest = null; rerenderPage(); break;
    case 'finish': finishTraining(); break;
    case 'summary-done': S.pages = []; renderPage(); setTab('progress'); break;

    // прогресс
    case 'exprog': openPage('exprog', d.id); break;
  }
});

document.addEventListener('input', ev => {
  const k = ev.target.dataset && ev.target.dataset.input;
  if (!k) return;
  if (k === 'q') { S.cat.q = ev.target.value; renderCatalogList(); }
  else if (k === 'dname') { S.draft.name = ev.target.value.slice(0, 60) || 'Моя тренировка'; saveDraft(); }
  else if (k === 'in-w') S.inputs.w = ev.target.value;
  else if (k === 'in-r') S.inputs.r = ev.target.value;
});

document.addEventListener('change', ev => {
  const t = ev.target;
  if (t.dataset && t.dataset.change === 'reps') {
    const i = parseInt(t.dataset.i, 10);
    changeDraft(items => { items[i].reps = t.value; });
  }
});

document.addEventListener('keydown', ev => {
  if (ev.key === 'Enter' && ev.target.id === 'save-name') document.querySelector('[data-act="save-ok"]').click();
  if (ev.key === 'Enter' && ev.target.dataset && /^in-/.test(ev.target.dataset.input || '')) { ev.target.blur(); }
});

// ---------------------------------------------------------------------------
// Тикер: секундомер тренировки и таймер отдыха
// ---------------------------------------------------------------------------
setInterval(() => {
  if (S.cur) {
    const t = fmtTime((Date.now() - S.cur.start) / 1000);
    const el = $('#elapsed'); if (el) el.textContent = t;
    const bt = $('#banner-time'); if (bt) bt.textContent = t;
  }
  if (S.rest) {
    const left = (S.rest.until - Date.now()) / 1000;
    const el = $('#rest-time');
    if (left <= 0) {
      S.rest = null;
      hap.ok();
      beep();
      toast('⏰ Отдых окончен — следующий подход!');
      if (S.pages.some(p => p.type === 'train') && S.pages[S.pages.length - 1].type === 'train') rerenderPage();
    } else if (el) {
      el.textContent = fmtTime(Math.ceil(left));
    }
  }
}, 250);

// ---------------------------------------------------------------------------
// Запуск
// ---------------------------------------------------------------------------
async function init() {
  if (tg) {
    tg.ready();
    tg.expand();
    if (inTelegram) {
      document.documentElement.classList.add('tg');
      try { tg.BackButton.onClick(closePage); } catch { /* */ }
      try { if (tg.isVersionAtLeast('7.7')) tg.disableVerticalSwipes(); } catch { /* */ }
    }
  }
  let all;
  try {
    all = await Store.loadAll();
  } catch (e) {
    console.error(e);
    $('#view').innerHTML = `<div class="empty"><div class="big">⚠️</div><p>Не удалось загрузить данные из облака Telegram.</p>
      <button class="btn primary" onclick="location.reload()">Повторить</button></div>`;
    return;
  }
  const valid = items => (Array.isArray(items) ? items.filter(it => it && EX[it.ex]) : []);
  if (all.draft) S.draft = { name: all.draft.name || 'Моя тренировка', items: valid(all.draft.items) };
  if (Array.isArray(all.saved)) S.saved = all.saved.map(w => ({ ...w, items: valid(w.items) }));
  if (all.cur && Array.isArray(all.cur.items) && valid(all.cur.items).length) {
    S.cur = all.cur;
    S.cur.items = valid(S.cur.items);
    S.cur.idx = Math.min(S.cur.idx || 0, S.cur.items.length - 1);
    if (inTelegram && tg.isVersionAtLeast('6.2')) tg.enableClosingConfirmation();
  }
  S.hist = Object.keys(all).filter(k => /^m_\d{4}_\d{2}$/.test(k)).sort()
    .flatMap(k => (Array.isArray(all[k]) ? all[k] : [])).sort((a, b) => a.start - b.start);
  setTab(S.cur ? 'builder' : 'catalog');
}

init();
