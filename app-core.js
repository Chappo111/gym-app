// Ядро приложения: утилиты, состояние, схема тела, навигация, шторки, эффекты.
'use strict';

const tg = window.Telegram && window.Telegram.WebApp;
const inTelegram = !!(tg && tg.initData);
const tgAtLeast = v => { try { return !!(tg && tg.isVersionAtLeast(v)); } catch { return false; } };
const EX = Object.fromEntries(DATA.exercises.map(e => [e.id, e]));
const MUS = DATA.muscles;
const GROUP_NAME = Object.fromEntries(DATA.groups.map(g => [g.key, g.name]));

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtW = w => String(Math.round(w * 100) / 100).replace('.', ',');
const pad = n => String(n).padStart(2, '0');
const fmtTime = sec => {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60;
  return (h ? h + ':' + pad(m) : m) + ':' + pad(sec % 60);
};
const fmtDate = ts => { const d = new Date(ts); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; };
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const fmtDay = ts => { const d = new Date(ts); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const plural = (n, a, b, c) => { n = Math.abs(n) % 100; const n1 = n % 10; if (n > 10 && n < 20) return c; if (n1 > 1 && n1 < 5) return b; if (n1 === 1) return a; return c; };
const setsWord = n => plural(n, 'подход', 'подхода', 'подходов');
const kindLabel = k => (k === 'base' ? 'базовое' : k === 'iso' ? 'изолирующее' : 'кардио');
const ICON = {
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  swap: '<svg viewBox="0 0 24 24"><path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
};

// ---------------------------------------------------------------------------
// Состояние
// ---------------------------------------------------------------------------
const S = {
  tab: 'catalog',
  draft: { name: 'Моя тренировка', items: [] },
  saved: [],
  fav: [],
  cur: null,      // идущая тренировка {id, name, items, idx, start, sets:[[ex,w,r]], prs}
  hist: [],       // завершённые [{id, name, start, end, sets}]
  cat: { group: 'all', equip: 'all', muscle: null, q: '' },
  openProg: null,
  pages: [],
  rest: null,
  restDefault: 90,
  inputs: { w: 0, r: 10, ex: null },
  showReport: false,
  lastScore: 0,
  gen: { focus: 'full', goal: 'mass', level: 1, equip: 'gym', dur: 60 },
};
try {
  S.restDefault = parseInt(localStorage.getItem('gym:restDefault'), 10) || 90;
  const g = JSON.parse(localStorage.getItem('gym:gen') || 'null');
  if (g) Object.assign(S.gen, g);
} catch { /* нет доступа к localStorage */ }

// ---------------------------------------------------------------------------
// Вибрация, звук, тост, конфетти, подтверждение
// ---------------------------------------------------------------------------
const hap = {
  tap() { try { tg.HapticFeedback.impactOccurred('light'); } catch { /* */ } },
  soft() { try { tg.HapticFeedback.selectionChanged(); } catch { /* */ } },
  ok() { try { tg.HapticFeedback.notificationOccurred('success'); } catch { /* */ } },
  warn() { try { tg.HapticFeedback.notificationOccurred('warning'); } catch { /* */ } },
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
    [0, 0.22, 0.44].forEach((t, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = i === 2 ? 1175 : 880;
      o.connect(g); g.connect(audioCtx.destination);
      const t0 = audioCtx.currentTime + t;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.02);
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

function confetti(n = 40) {
  const colors = ['#ff3b30', '#ff8a00', '#ffc531', '#30d158', '#5ac8fa', '#ffffff'];
  for (let i = 0; i < n; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    const ang = Math.random() * Math.PI * 2, dist = 120 + Math.random() * 220;
    c.style.setProperty('--x', `${Math.cos(ang) * dist}px`);
    c.style.setProperty('--y', `${Math.sin(ang) * dist + 140}px`);
    c.style.setProperty('--r', `${Math.random() * 720 - 360}deg`);
    c.style.background = colors[i % colors.length];
    c.style.animationDelay = `${Math.random() * 0.12}s`;
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 1700);
  }
}

function confirmBox(msg) {
  return new Promise(res => {
    if (inTelegram && tgAtLeast('6.2')) tg.showConfirm(msg, ok => res(!!ok));
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
  const list = S.hist.filter(s => monthKey(s.start) === k);
  return list.length ? Store.save(k, list) : Store.remove(k);
}
function saveGenPrefs() { try { localStorage.setItem('gym:gen', JSON.stringify(S.gen)); } catch { /* */ } }

// ---------------------------------------------------------------------------
// Аналитика по дневнику
// ---------------------------------------------------------------------------
const e1rm = (w, r) => (r > 1 ? w * (1 + r / 30) : w);
const tonnage = sets => sets.reduce((t, [, w, r]) => t + w * r, 0);

function bestWeight(ex, includeCur = false) {
  let best = 0;
  for (const s of S.hist) for (const [e, w] of s.sets) if (e === ex && w > best) best = w;
  if (includeCur && S.cur) for (const [e, w] of S.cur.sets) if (e === ex && w > best) best = w;
  return best;
}

function lastResult(ex) {
  for (let i = S.hist.length - 1; i >= 0; i--) {
    const sets = S.hist[i].sets.filter(s => s[0] === ex);
    if (sets.length) return { date: S.hist[i].start, sets };
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

// подходы на мышцу по записанным подходам (основная = 1, вспомогательная = 0.5)
function volumeFromSets(sets) {
  const vol = {};
  for (const [ex] of sets) {
    const e = EX[ex];
    if (!e || e.kind === 'cardio') continue;
    for (const m of e.primary) vol[m] = (vol[m] || 0) + 1;
    for (const m of e.secondary) vol[m] = (vol[m] || 0) + 0.5;
  }
  return vol;
}

// ---------------------------------------------------------------------------
// Схема тела (SVG). Контуры — BODY из body.js
// ---------------------------------------------------------------------------
function injectBodySymbols() {
  // общие «заготовки» фигур для маленьких иконок (через <use>), чтобы не дублировать тяжёлые контуры
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  let html = '<defs>';
  for (const side of ['front', 'back']) {
    const B = BODY[side];
    html += `<symbol id="sym-${side}" viewBox="${B.viewBox}"><path class="sy-out" d="${B.outline}"/>`;
    for (const p of B.parts) html += `<path class="${p.t === 'm' || p.t === 'muscle' ? 'sy-mu' : 'sy-b'}" d="${p.d}"/>`;
    html += '</symbol>';
  }
  svg.innerHTML = html + '</defs>';
  document.body.prepend(svg);
}

// mode: {cls(keys)->'p'|'s'|'', style(keys)->css, selected, clickable}
function figSVG(side, opt = {}) {
  const B = BODY[side];
  let s = `<svg viewBox="${B.viewBox}" xmlns="http://www.w3.org/2000/svg"><path class="outline" d="${B.outline}"/>`;
  for (const p of B.parts) {
    if (p.t === 'base') s += `<path class="b" d="${p.d}"/>`;
    else if (p.t === 'hair') s += `<path class="hair" d="${p.d}"/>`;
    else if (p.t === 'muscle') s += `<path class="mu" d="${p.d}"/>`;
    else {
      const c = opt.cls ? opt.cls(p.k) : '';
      const st = opt.style ? opt.style(p.k) : '';
      const sel = opt.selected && p.k.includes(opt.selected);
      const glow = c === 'p' || sel || (st && st.includes('glow'));
      s += `<path class="mu ${c}${sel ? ' sel' : ''}" data-k="${p.k.join(',')}"${st ? ` style="${st.replace('glow;', '')}"` : ''}${glow ? ' filter="url(#glow)"' : ''} d="${p.d}"/>`;
    }
  }
  return s + '</svg>';
}

function bodyMap(opt = {}) {
  return `<div class="bodies">
    <div class="fig${opt.clickable ? ' clickable' : ''}">${figSVG('front', opt)}<div class="cap">Спереди</div></div>
    <div class="fig${opt.clickable ? ' clickable' : ''}">${figSVG('back', opt)}<div class="cap">Сзади</div></div>
  </div>`;
}

const levelOf = (e, keys) => (keys.some(k => e.primary.includes(k)) ? 'p' : keys.some(k => e.secondary.includes(k)) ? 's' : '');
const exerciseMap = e => bodyMap({ cls: keys => levelOf(e, keys) });

// какая сторона показательнее для упражнения (для маленьких иконок)
function bestSide(e) {
  const score = side => BODY[side].parts.reduce((n, p) => n + (p.t === 'm' ? (levelOf(e, p.k) === 'p' ? 3 : levelOf(e, p.k) === 's' ? 1 : 0) : 0), 0);
  return score('back') > score('front') ? 'back' : 'front';
}
const thumbCache = {};
function exThumb(e) {
  if (thumbCache[e.id]) return thumbCache[e.id];
  const side = bestSide(e);
  const B = BODY[side];
  const [vx, vy, vw, vh] = B.viewBox.split(' ');
  let s = `<svg viewBox="${B.viewBox}"><use href="#sym-${side}" x="${vx}" y="${vy}" width="${vw}" height="${vh}"/>`;
  for (const p of B.parts) {
    if (p.t !== 'm') continue;
    const c = levelOf(e, p.k);
    if (c) s += `<path class="mu ${c}" d="${p.d}"/>`;
  }
  return (thumbCache[e.id] = s + '</svg>');
}

// «тепловая» заливка: чем больше подходов, тем краснее
function heatStyle(v) {
  if (!v) return '';
  const stops = [[0, [255, 213, 184]], [0.35, [255, 154, 60]], [0.7, [255, 59, 48]], [1, [168, 0, 28]]];
  const t = Math.min(1, v / 10);
  let i = 0;
  while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
  const [t0, c0] = stops[i], [t1, c1] = stops[i + 1];
  const k = (t - t0) / (t1 - t0);
  const c = c0.map((x, j) => Math.round(x + (c1[j] - x) * k));
  return `${t >= 0.6 ? 'glow;' : ''}fill:rgb(${c});fill-opacity:1`;
}
const heatMap = vol => bodyMap({ style: keys => heatStyle(Math.max(0, ...keys.map(k => vol[k] || 0))) });

// ---------------------------------------------------------------------------
// Навигация: вкладки, страницы поверх, шторки
// ---------------------------------------------------------------------------
function setTab(t, anim = true) {
  S.tab = t;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  renderTab(anim);
  window.scrollTo(0, 0);
}

function renderTab(anim = false) {
  const v = $('#view');
  v.className = anim ? 'enter' : '';
  v.innerHTML = { catalog: tabCatalog, builder: tabBuilder, programs: tabPrograms, progress: tabProgress }[S.tab]();
  if (S.tab === 'catalog') renderCatalogList(anim);
  if (S.tab === 'builder') animateScore();
  renderBanner();
}

const PAGES = {};   // заполняется в других файлах: тип -> функция(arg) => {title, body, actions?}

function openPage(type, arg) {
  S.pages.push({ type, arg });
  renderPage(true);
}
function closePage() {
  S.pages.pop();
  renderPage(true);
  renderTab(false);
}
function renderPage(swap = false) {
  const el = $('#page');
  const top = S.pages[S.pages.length - 1];
  if (!top) {
    el.classList.remove('in');
    document.body.style.overflow = '';
    if (inTelegram) try { tg.BackButton.hide(); } catch { /* */ }
    setTimeout(() => { if (!S.pages.length) el.innerHTML = ''; }, 400);
    renderBanner();
    return;
  }
  const p = PAGES[top.type](top.arg);
  const backBtn = inTelegram ? '' : `<button class="icon-round" data-act="back" aria-label="Назад">${ICON.back}</button>`;
  el.innerHTML = `<div class="page-head">${backBtn}<h3>${p.title}</h3>${p.actions || ''}</div><div class="page-body">${p.body}</div>`;
  el.classList.toggle('swap', swap);
  if (!el.classList.contains('in')) { void el.offsetWidth; el.classList.add('in'); }
  if (swap) el.scrollTop = 0;
  document.body.style.overflow = 'hidden';
  if (inTelegram) try { tg.BackButton.show(); } catch { /* */ }
  renderBanner();
}
function rerenderPage() {
  const el = $('#page');
  const y = el.scrollTop;
  renderPage(false);
  el.scrollTop = y;
}
const topPage = () => S.pages[S.pages.length - 1];

function openSheet(html) {
  const sh = $('#sheet');
  sh.querySelector('.sheet').innerHTML = `<div class="grabber"></div>${html}`;
  sh.querySelector('.sheet').scrollTop = 0;
  void sh.offsetWidth;            // фиксируем начальное положение, чтобы сработала анимация
  sh.classList.add('open');
}
function closeSheet() { $('#sheet').classList.remove('open'); }

function renderBanner() {
  const b = $('#banner');
  const onTrain = S.pages.some(p => p.type === 'train');
  const show = !!(S.cur && !onTrain);
  b.hidden = !show;
  document.body.classList.toggle('has-banner', show);
  if (show) {
    b.innerHTML = `<span class="dot"></span><span>Идёт тренировка</span><span class="t" id="banner-time">${fmtTime((Date.now() - S.cur.start) / 1000)}</span><span>›</span>`;
  }
  const n = S.draft.items.length;
  const badge = $('#badge');
  if (badge.textContent !== String(n)) {
    badge.classList.remove('bump'); void badge.offsetWidth; badge.classList.add('bump');
  }
  badge.hidden = !n;
  badge.textContent = n;
}

function applyTheme() {
  const dark = inTelegram ? tg.colorScheme === 'dark' : !matchMedia('(prefers-color-scheme: light)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || (dark ? '#0b0c10' : '#f3f4f7');
  document.querySelector('meta[name="theme-color"]').content = bg;
  if (inTelegram) {
    try { if (tgAtLeast('6.9')) { tg.setHeaderColor(bg); tg.setBackgroundColor(bg); } } catch { /* */ }
    try { if (tgAtLeast('7.10')) tg.setBottomBarColor(bg); } catch { /* */ }
  }
}
