// Режим тренировки, итоги и «Прогресс».
'use strict';

const REST_C = 2 * Math.PI * 40;

// ---------------------------------------------------------------------------
// Тренировка
// ---------------------------------------------------------------------------
function startTraining() {
  unlockAudio();
  if (S.cur) { openPage('train'); return; }
  if (!S.draft.items.length) return;
  S.cur = { id: Date.now(), name: S.draft.name, items: S.draft.items.map(it => ({ ...it })), idx: 0, start: Date.now(), sets: [], prs: 0 };
  S.inputs.ex = null;
  saveCur();
  if (inTelegram && tgAtLeast('6.2')) tg.enableClosingConfirmation();
  hap.ok();
  openPage('train');
}

const curSets = ex => S.cur.sets.filter(s => s[0] === ex);

function prefillInputs() {
  const it = S.cur.items[S.cur.idx];
  if (S.inputs.ex === it.ex) return;
  const mine = curSets(it.ex);
  const last = lastResult(it.ex);
  const src = mine.length ? mine[mine.length - 1] : last ? last.sets[0] : null;
  S.inputs = { ex: it.ex, w: src ? src[1] : 0, r: src ? src[2] : Evaluator.firstInt(it.reps, 10) };
}

const round25 = w => Math.max(0, Math.round(w / 2.5) * 2.5);
function warmupSets(e, work) {
  if (e.kind !== 'base' || work < 30) return '';
  const bar = CATS[e.id].has('barbell') ? 20 : 0;
  const list = [[0.5, 8], [0.7, 5], [0.85, 2]].map(([k, r]) => [Math.max(bar, round25(work * k)), r]);
  if (bar) list.unshift([bar, 10]);
  return `<div class="warmup"><span class="muted">🔥 Разминка:</span>${list.map(([w, r]) => `<span class="w">${fmtW(w)}×${r}</span>`).join('')}</div>`;
}

PAGES.train = () => {
  const c = S.cur;
  if (!c) return { title: 'Тренировка', body: '<div class="empty"><b>Тренировка не запущена</b></div>' };
  prefillInputs();
  const it = c.items[c.idx];
  const e = EX[it.ex];
  const cardio = e.kind === 'cardio';
  const secs = /сек/.test(it.reps);
  const mine = curSets(it.ex);
  const last = lastResult(it.ex);
  const best = bestWeight(it.ex);
  const setStr = s => (s[1] ? `${fmtW(s[1])} × ${s[2]}` : `${s[2]}${cardio ? ' мин' : secs ? ' сек' : ''}`);
  const doneEx = c.items.filter(x => c.sets.some(s => s[0] === x.ex)).length;
  const planDone = !cardio && mine.length >= it.sets;
  const dots = c.items.map((x, i) => `<button class="${i === c.idx ? 'cur' : ''}${c.sets.some(s => s[0] === x.ex) ? ' done' : ''}" data-act="goto" data-i="${i}">${i + 1}</button>`).join('');
  const field = (label, key, step, wide) => `
    <div class="num-field"${wide ? ' style="grid-column:1/-1"' : ''}><label>${label}</label>
      <div class="row"><button data-act="inc" data-k="${key}" data-d="${-step}">−${String(step).replace('.', ',')}</button>
      <input type="number" inputmode="decimal" min="0" step="${step}" value="${S.inputs[key]}" data-input="in-${key}" aria-label="${label}">
      <button data-act="inc" data-k="${key}" data-d="${step}">+${String(step).replace('.', ',')}</button></div></div>`;
  let rest;
  if (S.rest) {
    const left = Math.max(0, (S.rest.until - Date.now()) / 1000);
    rest = `<div class="card rest-live"><div class="rest-ring"><svg viewBox="0 0 92 92"><circle class="bg" cx="46" cy="46" r="40"/>
        <circle class="fg" id="rest-fg" cx="46" cy="46" r="40" stroke-dasharray="${REST_C}" stroke-dashoffset="${REST_C * (1 - left / S.rest.total)}"/></svg>
        <div class="t" id="rest-time">${fmtTime(Math.ceil(left))}</div></div>
      <div class="grow"><b>Отдых</b><div class="muted small">Напомню звуком и вибрацией</div>
        <div class="row" style="margin-top:8px"><button class="btn" data-act="rest-add">+30 с</button><button class="btn" data-act="rest-stop">Хватит</button></div></div></div>`;
  } else {
    rest = `<div class="rest-row"><span class="lbl">Отдых</span>${[60, 90, 120, 180].map(s => `<button class="chip${S.restDefault === s ? ' on' : ''}" data-act="rest" data-s="${s}">${fmtTime(s)}</button>`).join('')}</div>`;
  }
  const side = bestSide(e);
  return {
    title: esc(c.name),
    body: `
      <div class="train-top"><span class="muted small">Упражнение ${c.idx + 1} из ${c.items.length} · выполнено ${doneEx}</span><span class="clock" id="elapsed">${fmtTime((Date.now() - c.start) / 1000)}</span></div>
      <div class="progress-bar"><div style="width:${Math.round((doneEx / c.items.length) * 100)}%"></div></div>
      <div class="dots">${dots}</div>
      <div class="card hero">
        <div class="ex-hero">
          <div class="mini-map fig">${figSVG(side, { cls: keys => levelOf(e, keys) })}</div>
          <div class="grow">
            <h3>${esc(e.name)}</h3>
            <div class="plan-line"><span class="tag hot">План: ${cardio ? esc(it.reps) : `${it.sets} × ${esc(it.reps)}`}</span>${best ? `<span class="tag">🏆 ${fmtW(best)} кг</span>` : ''}</div>
            ${last ? `<div class="small muted" style="margin-top:6px">Прошлый раз (${fmtDay(last.date)}): ${last.sets.map(setStr).join(', ')}</div>` : ''}
            <button class="btn ghost" data-act="ex" data-id="${e.id}" style="padding-left:0">Техника ›</button>
          </div>
        </div>
        ${!mine.length && !cardio ? warmupSets(e, parseFloat(S.inputs.w) || 0) : ''}
        <div class="set-chips">${mine.length ? mine.map((s, i) => `<span class="set-chip${s[3] ? ' pr' : ''}"><small>${i + 1}</small>${setStr(s)}${s[3] ? ' 🏆' : ''}</span>`).join('') : '<span class="muted small">Подходов пока нет — вперёд!</span>'}
          ${planDone ? '<span class="done-pill">✓ План выполнен</span>' : ''}</div>
      </div>
      <div class="inputs">
        ${cardio ? field('Минут', 'r', 1, true) : field('Вес, кг', 'w', 2.5) + field(secs ? 'Секунд' : 'Повторы', 'r', secs ? 5 : 1)}
      </div>
      <button class="btn primary big block" data-act="logset">✓ Записать подход ${mine.length + 1}</button>
      ${rest}
      <div class="grid3">
        <button class="btn" data-act="goto" data-i="${c.idx - 1}" ${c.idx === 0 ? 'disabled' : ''}>← Назад</button>
        <button class="btn" data-act="undo" ${mine.length ? '' : 'disabled'}>Отменить</button>
        <button class="btn${planDone ? ' primary' : ''}" data-act="goto" data-i="${c.idx + 1}" ${c.idx === c.items.length - 1 ? 'disabled' : ''}>Далее →</button>
      </div>
      <div class="spacer"></div>
      <button class="btn block outline danger" data-act="finish">🏁 Завершить тренировку</button>
      <div class="footer-note">Таймер отдыха работает, пока приложение открыто</div>`,
  };
};

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
  const w = cardio ? 0 : Math.max(0, Math.round((parseFloat(String(S.inputs.w).replace(',', '.')) || 0) * 100) / 100);
  const r = Math.round(parseFloat(S.inputs.r) || 0);
  if (r < 1 || r > 600 || w > 1000) { hap.warn(); toast('Проверь вес и повторы'); return; }
  const hadBefore = S.hist.some(s => s.sets.some(x => x[0] === it.ex));
  const prevBest = bestWeight(it.ex, true);
  const pr = hadBefore && w > 0 && w > prevBest;
  c.sets.push(pr ? [it.ex, w, r, 1] : [it.ex, w, r]);
  if (pr) c.prs = (c.prs || 0) + 1;
  saveCur();
  if (pr) { hap.ok(); confetti(); toast(`🏆 Новый рекорд: ${fmtW(w)} кг!`); } else { hap.tap(); }
  if (!cardio) startRest(S.restDefault);
  rerenderPage();
}

async function finishTraining() {
  if (!(await confirmBox('Завершить тренировку?'))) return;
  const c = S.cur;
  S.cur = null;
  S.rest = null;
  saveCur();
  if (inTelegram && tgAtLeast('6.2')) try { tg.disableClosingConfirmation(); } catch { /* */ }
  if (!c.sets.length) {
    toast('Подходов не было — тренировка не сохранена');
    S.pages = [];
    renderPage();
    renderTab(false);
    return;
  }
  const session = { id: c.id, name: c.name, start: c.start, end: Date.now(), sets: c.sets.map(s => s.slice(0, 3)) };
  S.hist.push(session);
  saveMonth(session.start);
  hap.ok();
  confetti(60);
  S.pages = [{ type: 'summary', arg: { ...session, prs: c.prs || 0 } }];
  renderPage(true);
}

PAGES.summary = s => {
  const byEx = {};
  for (const x of s.sets) (byEx[x[0]] = byEx[x[0]] || []).push(x);
  const mins = Math.max(1, Math.round((s.end - s.start) / 60000));
  return {
    title: 'Готово!',
    body: `<div class="empty"><div class="ico">🏁</div><b>Отличная работа!</b>${esc(s.name)}</div>
      <div class="grid3">
        <div class="stat accent"><b>${mins}</b><span>${plural(mins, 'минута', 'минуты', 'минут')}</span></div>
        <div class="stat"><b>${s.sets.length}</b><span>${setsWord(s.sets.length)}</span></div>
        <div class="stat"><b>${Math.round(tonnage(s.sets)).toLocaleString('ru')}</b><span>кг тоннаж</span></div>
      </div>
      ${s.prs ? `<div class="card hero" style="margin-top:10px">🏆 Новых рекордов: <b>${s.prs}</b></div>` : ''}
      <div class="card map-card" style="margin-top:10px">${heatMap(volumeFromSets(s.sets))}<div class="map-hint">Что сегодня поработало</div></div>
      <h2>Что сделано</h2>
      <div class="card">${Object.entries(byEx).map(([ex, sets]) => `<div class="list-row"><span>${esc(EX[ex] ? EX[ex].name : ex)}</span><span class="muted small" style="text-align:right">${sets.map(x => (x[1] ? `${fmtW(x[1])}×${x[2]}` : x[2])).join(', ')}</span></div>`).join('')}</div>
      <div class="footer-note">Восстанавливайся: сон, белок, вода 💧</div>
      <div class="sticky-bottom"><button class="btn primary big block" data-act="summary-done">Готово</button></div>`,
  };
};

// ---------------------------------------------------------------------------
// «Прогресс»
// ---------------------------------------------------------------------------
const DAY = 86400000;
const dayStart = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };

function activityCalendar() {
  const today = dayStart(Date.now());
  const dow = (new Date(today).getDay() + 6) % 7;                // 0 = понедельник
  const start = today - (dow + 7 * 11) * DAY;                     // 12 недель
  const perDay = {};
  for (const s of S.hist) { const k = dayStart(s.start); perDay[k] = (perDay[k] || 0) + s.sets.length; }
  let cells = '';
  for (let t = start; t <= today + (6 - dow) * DAY; t += DAY) {
    const n = perDay[dayStart(t)] || 0;
    const l = !n ? '' : n <= 10 ? 'l1' : n <= 20 ? 'l2' : 'l3';
    cells += `<div class="${l}${dayStart(t) === today ? ' today' : ''}" title="${fmtDate(t)}"></div>`;
  }
  // недели подряд с тренировками
  let streak = 0;
  for (let w = 0; w < 52; w++) {
    const ws = today - (dow + 7 * w) * DAY, we = ws + 7 * DAY;
    if (S.hist.some(s => s.start >= ws && s.start < we)) streak++;
    else if (w > 0) break;
  }
  return { cells, streak };
}

function tabProgress() {
  const now = Date.now();
  const in7 = S.hist.filter(s => s.start > now - 7 * DAY);
  const in30 = S.hist.filter(s => s.start > now - 30 * DAY);
  const t30 = in30.reduce((t, s) => t + tonnage(s.sets), 0);
  const store = Store.useCloud ? '☁️ Данные в облаке Telegram — доступны с любого устройства'
    : '💻 Открыто вне Telegram — данные хранятся только в этом браузере';
  if (!S.hist.length) {
    return `<h1>Прогресс</h1><div class="sub">Статистика, рекорды и история</div>
      <div class="empty"><div class="ico">📈</div><b>Здесь будет твой прогресс</b>Запусти тренировку (▶ во вкладке «Тренировка») и записывай подходы — появятся рекорды, графики и карта мышц за неделю.</div>
      <div class="footer-note">${store}</div>`;
  }
  const recs = records();
  const week = {};
  in7.forEach(s => { const v = volumeFromSets(s.sets); for (const m in v) week[m] = (week[m] || 0) + v[m]; });
  const missed = ['chest', 'lats', 'quads', 'hamstrings', 'glutes', 'front_delts', 'side_delts', 'biceps', 'triceps', 'abs'].filter(m => !week[m]);
  const cal = activityCalendar();
  const recHtml = recs.length ? recs.slice(0, 30).map((r, i) => `
      <div class="list-row click" data-act="exprog" data-id="${r.ex}" style="--i:${i}"><span>${esc(EX[r.ex].name)}</span>
      <span style="white-space:nowrap"><b>${fmtW(r.w)}×${r.r}</b> <span class="muted small">≈${Math.round(r.e1rm)}</span> <span class="chev">›</span></span></div>`).join('')
    : '<div class="muted small">Записывай вес в подходах — здесь появятся рекорды.</div>';
  const hist = S.hist.slice(-30).reverse().map(s => `
      <div class="list-row click" data-act="session" data-id="${s.id}"><span><b>${esc(s.name)}</b><br><span class="muted small">${fmtDay(s.start)} · ${Math.max(1, Math.round((s.end - s.start) / 60000))} мин</span></span>
      <span class="muted small" style="text-align:right;white-space:nowrap">${s.sets.length} ${setsWord(s.sets.length)}<br>${Math.round(tonnage(s.sets)).toLocaleString('ru')} кг <span class="chev">›</span></span></div>`).join('');
  return `<h1>Прогресс</h1><div class="sub">${cal.streak ? `🔥 ${cal.streak} ${plural(cal.streak, 'неделя', 'недели', 'недель')} подряд с тренировками` : 'Статистика, рекорды и история'}</div>
    <div class="grid2">
      <div class="stat accent"><b>${in7.length}</b><span>${plural(in7.length, 'тренировка', 'тренировки', 'тренировок')} за 7 дней</span></div>
      <div class="stat"><b>${in30.length}</b><span>за 30 дней</span></div>
      <div class="stat"><b>${S.hist.length}</b><span>всего</span></div>
      <div class="stat"><b>${Math.round(t30).toLocaleString('ru')}</b><span>кг тоннаж за 30 дней</span></div>
    </div>
    <h2>Активность</h2>
    <div class="card"><div class="cal">${cal.cells}</div><div class="muted small" style="margin-top:8px">Последние 12 недель · чем ярче, тем больше подходов</div></div>
    <h2>Мышцы за неделю</h2>
    <div class="card map-card">${heatMap(week)}
      <div class="legend"><span>мало<span class="heat-bar"></span>много подходов</span></div>
      ${missed.length && in7.length ? `<div class="map-hint">Не тренировались: ${missed.map(m => MUS[m].split(' (')[0].toLowerCase()).join(', ')}</div>` : ''}
    </div>
    <h2>🏆 Рекорды</h2><div class="card">${recHtml}</div>
    <h2>История</h2><div class="card">${hist}</div>
    <div class="footer-note">${store}</div>`;
}

function chartSVG(pts) {
  const W = 600, H = 250, L = 60, R = 16, T = 18, B = 36;
  const ys = pts.map(p => p.w);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (hi === lo) { lo -= 5; hi += 5; }
  const x = i => (pts.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (pts.length - 1));
  const y = v => T + ((hi - v) * (H - T - B)) / (hi - lo);
  const line = pts.map((p, i) => `${x(i)},${y(p.w)}`).join(' ');
  const area = `${x(0)},${H - B} ${line} ${x(pts.length - 1)},${H - B}`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">
    <line class="grid" x1="${L}" y1="${y(hi)}" x2="${W - R}" y2="${y(hi)}"/><line class="grid" x1="${L}" y1="${y(lo)}" x2="${W - R}" y2="${y(lo)}"/>
    <text x="${L - 10}" y="${y(hi) + 6}" text-anchor="end">${fmtW(hi)}</text><text x="${L - 10}" y="${y(lo) + 6}" text-anchor="end">${fmtW(lo)}</text>
    <polygon class="area" points="${area}"/>
    <polyline class="line" points="${line}"/>
    ${pts.map((p, i) => `<circle class="dot" cx="${x(i)}" cy="${y(p.w)}" r="6"/>`).join('')}
    <text x="${x(0)}" y="${H - 8}" text-anchor="${pts.length === 1 ? 'middle' : 'start'}">${fmtDay(pts[0].date)}</text>
    ${pts.length > 1 ? `<text x="${x(pts.length - 1)}" y="${H - 8}" text-anchor="end">${fmtDay(pts[pts.length - 1].date)}</text>` : ''}
  </svg>`;
}

PAGES.exprog = id => {
  const pts = exerciseHistory(id);
  const withW = pts.filter(p => p.w > 0);
  const first = withW[0], lastP = withW[withW.length - 1];
  const gain = first && lastP ? lastP.w - first.w : 0;
  return {
    title: esc(EX[id].name),
    body: `
      ${withW.length ? `<div class="grid2" style="margin-bottom:10px">
        <div class="stat accent"><b>${fmtW(Math.max(...withW.map(p => p.w)))} кг</b><span>лучший вес</span></div>
        <div class="stat"><b>${gain >= 0 ? '+' : ''}${fmtW(gain)} кг</b><span>с первой тренировки</span></div></div>
        <div class="card"><div class="muted small">Лучший вес в каждой тренировке</div>${chartSVG(withW)}</div>` : ''}
      <h2>Все тренировки <span class="count">${pts.length}</span></h2>
      <div class="card">${pts.slice().reverse().map(p => `<div class="list-row"><span>${fmtDay(p.date)}</span>
        <span class="muted small" style="text-align:right">${p.sets.map(s => (s[1] ? `${fmtW(s[1])}×${s[2]}` : s[2])).join(', ')}</span></div>`).join('') || '<span class="muted">Нет записей</span>'}</div>
      <button class="btn block" data-act="ex" data-id="${id}">Техника выполнения ›</button>`,
  };
};

PAGES.session = id => {
  const s = S.hist.find(x => String(x.id) === String(id));
  if (!s) return { title: 'Тренировка', body: '<div class="empty"><b>Не найдено</b></div>' };
  const byEx = {};
  for (const x of s.sets) (byEx[x[0]] = byEx[x[0]] || []).push(x);
  return {
    title: esc(s.name),
    body: `<div class="sub">${fmtDate(s.start)} · ${Math.max(1, Math.round((s.end - s.start) / 60000))} мин · ${s.sets.length} ${setsWord(s.sets.length)} · ${Math.round(tonnage(s.sets)).toLocaleString('ru')} кг</div>
      <div class="card map-card">${heatMap(volumeFromSets(s.sets))}</div>
      <div class="card">${Object.entries(byEx).map(([ex, sets]) => `<div class="list-row click" data-act="exprog" data-id="${ex}"><span>${esc(EX[ex] ? EX[ex].name : ex)}</span><span class="muted small" style="text-align:right">${sets.map(x => (x[1] ? `${fmtW(x[1])}×${x[2]}` : x[2])).join(', ')}</span></div>`).join('')}</div>
      <div class="grid2"><button class="btn" data-act="repeat-session" data-id="${s.id}">🔁 Повторить</button>
        <button class="btn danger" data-act="del-session" data-id="${s.id}">Удалить</button></div>`,
  };
};
