// Обработка нажатий, тикер таймеров и запуск приложения.
'use strict';

document.addEventListener('click', async ev => {
  if (ev.target.closest('#banner')) { hap.tap(); openPage('train'); return; }
  const sheet = $('#sheet');
  if (ev.target === sheet) { closeSheet(); return; }
  const tab = ev.target.closest('#tabs button');
  if (tab) {
    hap.soft();
    closeSheet();
    if (S.pages.length) { S.pages = []; renderPage(); }
    setTab(tab.dataset.tab);
    return;
  }

  // нажатие на мышцу на карте
  const m = ev.target.closest('.fig.clickable .mu[data-k]');
  if (m) {
    hap.soft();
    const keys = m.dataset.k.split(',');
    const i = keys.indexOf(S.cat.muscle);
    S.cat.muscle = i < 0 ? keys[0] : keys[i + 1] || null;
    renderTab(false);
    return;
  }

  const a = ev.target.closest('[data-act]');
  if (!a || a.disabled) return;
  const d = a.dataset;
  const i = d.i !== undefined ? parseInt(d.i, 10) : -1;
  switch (d.act) {
    case 'back': closePage(); break;
    case 'tab': closeSheet(); setTab(d.t); break;
    case 'sheet-close': closeSheet(); break;

    // справочник
    case 'group': S.cat.group = d.g; hap.soft(); renderTab(false); renderCatalogList(true); break;
    case 'equip': S.cat.equip = d.q; hap.soft(); renderTab(false); renderCatalogList(true); break;
    case 'muscle-clear': S.cat.muscle = null; renderTab(false); break;
    case 'ex': closeSheet(); openPage('ex', d.id); break;
    case 'toggle-add': {
      toggleAdd(d.id);
      const on = S.draft.items.some(it => it.ex === d.id);
      document.querySelectorAll(`.add-btn[data-id="${d.id}"]`).forEach(b => {
        b.classList.toggle('in', on);
        b.innerHTML = on ? ICON.check : ICON.plus;
        b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
      });
      renderBanner();
      break;
    }
    case 'page-toggle-add': toggleAdd(d.id); rerenderPage(); renderBanner(); break;
    case 'fav': toggleFav(d.id); rerenderPage(); break;

    // конструктор
    case 'toggle-report': S.showReport = !S.showReport; hap.soft(); renderTab(false); break;
    case 'sets': changeDraft(items => { items[i].sets = Math.max(1, Math.min(10, items[i].sets + parseInt(d.d, 10))); }); hap.tap(); break;
    case 'move': changeDraft(items => { const j = i + parseInt(d.d, 10); [items[i], items[j]] = [items[j], items[i]]; }); hap.tap(); break;
    case 'del': changeDraft(items => { items.splice(i, 1); }); hap.tap(); break;
    case 'swap': swapSheet(i); break;
    case 'swap-to': {
      const it = S.draft.items[i];
      const e = EX[d.id];
      S.draft.items[i] = e.kind === EX[it.ex].kind ? { ...it, ex: d.id } : { ...defaultItem(d.id), sets: it.sets };
      saveDraft();
      closeSheet();
      hap.ok();
      toast(`Заменено на «${e.name}»`);
      renderTab(false);
      break;
    }
    case 'clear':
      if (await confirmBox('Очистить тренировку?')) { S.draft = { name: 'Моя тренировка', items: [] }; saveDraft(); renderTab(true); }
      break;
    case 'save': saveSheet(); break;
    case 'save-ok': {
      const name = ($('#save-name').value || '').trim().slice(0, 60) || 'Моя тренировка';
      S.draft.name = name;
      S.saved.unshift({ id: Date.now(), name, items: S.draft.items.map(it => ({ ...it })) });
      Store.save('saved', S.saved);
      saveDraft();
      closeSheet();
      hap.ok();
      toast('💾 Сохранено в «Программы»');
      renderTab(false);
      break;
    }
    case 'start': startTraining(); break;

    // генератор
    case 'gen-open': genSheet(); break;
    case 'gen-opt': {
      const k = d.k;
      S.gen[k] = typeof S.gen[k] === 'number' ? parseInt(d.v, 10) : d.v;
      a.parentElement.querySelectorAll('.opt').forEach(b => b.classList.toggle('on', b === a));
      hap.soft();
      break;
    }
    case 'gen-go': runGenerator(); break;

    // программы
    case 'open-prog': S.openProg = S.openProg === d.p ? null : d.p; hap.soft(); renderTab(false); break;
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
        renderTab(false);
      }
      break;
    }

    // тренировка
    case 'goto':
      if (i >= 0 && i < S.cur.items.length) { S.cur.idx = i; saveCur(); hap.soft(); renderPage(true); }
      break;
    case 'inc': {
      const k = d.k;
      const cur = parseFloat(String(S.inputs[k]).replace(',', '.')) || 0;
      const v = Math.max(0, Math.round((cur + parseFloat(d.d)) * 100) / 100);
      S.inputs[k] = v;
      const inp = document.querySelector(`[data-input="in-${k}"]`);
      if (inp) inp.value = v;
      hap.soft();
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
    case 'rest-add': if (S.rest) { S.rest.until += 30000; S.rest.total += 30; } hap.soft(); rerenderPage(); break;
    case 'rest-stop': S.rest = null; rerenderPage(); break;
    case 'finish': finishTraining(); break;
    case 'summary-done': S.pages = []; renderPage(); setTab('progress'); break;

    // прогресс
    case 'exprog': openPage('exprog', d.id); break;
    case 'session': openPage('session', d.id); break;
    case 'repeat-session': {
      const s = S.hist.find(x => String(x.id) === d.id);
      if (!s) break;
      const items = [];
      for (const [ex] of s.sets) {
        if (!EX[ex]) continue;
        const ex0 = items.find(x => x.ex === ex);
        if (ex0) ex0.sets = Math.min(10, ex0.sets + 1); else items.push({ ...defaultItem(ex), sets: 1 });
      }
      S.pages = []; renderPage();
      loadIntoDraft(s.name, items);
      break;
    }
    case 'del-session': {
      const s = S.hist.find(x => String(x.id) === d.id);
      if (s && await confirmBox('Удалить эту тренировку из истории? Отменить будет нельзя.')) {
        S.hist = S.hist.filter(x => x !== s);
        saveMonth(s.start);
        closePage();
        toast('Удалено');
      }
      break;
    }
  }
});

document.addEventListener('input', ev => {
  const k = ev.target.dataset && ev.target.dataset.input;
  if (!k) return;
  if (k === 'q') { S.cat.q = ev.target.value; renderCatalogList(false); }
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
  if (ev.key !== 'Enter') return;
  if (ev.target.id === 'save-name') document.querySelector('[data-act="save-ok"]').click();
  else if (ev.target.dataset && /^(in-|q$)/.test(ev.target.dataset.input || '')) ev.target.blur();
});

// ---------------------------------------------------------------------------
// Тикер: секундомер и таймер отдыха
// ---------------------------------------------------------------------------
setInterval(() => {
  if (S.cur) {
    const t = fmtTime((Date.now() - S.cur.start) / 1000);
    const el = $('#elapsed'); if (el) el.textContent = t;
    const bt = $('#banner-time'); if (bt) bt.textContent = t;
  }
  if (S.rest) {
    const left = (S.rest.until - Date.now()) / 1000;
    if (left <= 0) {
      S.rest = null;
      hap.ok();
      beep();
      toast('⏰ Отдых окончен — следующий подход!');
      const top = topPage();
      if (top && top.type === 'train') rerenderPage();
    } else {
      const el = $('#rest-time'); if (el) el.textContent = fmtTime(Math.ceil(left));
      const fg = $('#rest-fg'); if (fg) fg.style.strokeDashoffset = REST_C * (1 - left / S.rest.total);
    }
  }
}, 250);

// ---------------------------------------------------------------------------
// Запуск
// ---------------------------------------------------------------------------
async function init() {
  applyTheme();
  if (tg) {
    try { tg.ready(); tg.expand(); } catch { /* */ }
    if (inTelegram) {
      document.documentElement.classList.add('tg');
      try { tg.BackButton.onClick(() => { if ($('#sheet').classList.contains('open')) closeSheet(); else closePage(); }); } catch { /* */ }
      try { if (tgAtLeast('7.7')) tg.disableVerticalSwipes(); } catch { /* */ }
      try { tg.onEvent('themeChanged', applyTheme); } catch { /* */ }
    }
  }
  if (!inTelegram) matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);
  injectBodySymbols();

  let all;
  try {
    all = await Store.loadAll();
  } catch (e) {
    console.error(e);
    $('#view').innerHTML = `<div class="empty"><div class="ico">⚠️</div><b>Не удалось загрузить данные</b>Проверь интернет и попробуй ещё раз.
      <div class="spacer"></div><button class="btn primary" onclick="location.reload()">Повторить</button></div>`;
    return;
  }
  const valid = items => (Array.isArray(items) ? items.filter(it => it && EX[it.ex]) : []);
  if (all.draft) S.draft = { name: all.draft.name || 'Моя тренировка', items: valid(all.draft.items) };
  if (Array.isArray(all.saved)) S.saved = all.saved.map(w => ({ ...w, items: valid(w.items) }));
  if (Array.isArray(all.fav)) S.fav = all.fav.filter(id => EX[id]);
  if (all.cur && valid(all.cur.items).length) {
    S.cur = all.cur;
    S.cur.items = valid(S.cur.items);
    S.cur.idx = Math.min(S.cur.idx || 0, S.cur.items.length - 1);
    if (inTelegram && tgAtLeast('6.2')) try { tg.enableClosingConfirmation(); } catch { /* */ }
  }
  S.hist = Object.keys(all).filter(k => /^m_\d{4}_\d{2}$/.test(k)).sort()
    .flatMap(k => (Array.isArray(all[k]) ? all[k] : [])).sort((a, b) => a.start - b.start);
  setTab(S.cur || S.draft.items.length ? 'builder' : 'catalog');
}

init();
