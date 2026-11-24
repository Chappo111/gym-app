// Хранилище данных пользователя.
// В Telegram — CloudStorage: у каждого пользователя своё облако, данные доступны с любого устройства,
// лимиты: 1024 ключа по 4096 символов. Большие значения режем на части («чанки»).
// Вне Telegram (открыли страницу в обычном браузере) — localStorage этого браузера.
'use strict';

const Store = (() => {
  const tg = window.Telegram && window.Telegram.WebApp;
  const useCloud = !!(tg && tg.initData && tg.CloudStorage && tg.isVersionAtLeast && tg.isVersionAtLeast('6.9'));
  const CHUNK = 4000;
  const BATCH = 100;

  // ---- низкоуровневые операции над ключами ----
  function cloudCall(method, ...args) {
    return new Promise((resolve, reject) => {
      tg.CloudStorage[method](...args, (err, val) => (err ? reject(new Error(String(err))) : resolve(val)));
    });
  }

  const cloud = {
    keys: () => cloudCall('getKeys'),
    async getMany(keys) {
      const out = {};
      for (let i = 0; i < keys.length; i += BATCH) {
        Object.assign(out, await cloudCall('getItems', keys.slice(i, i + BATCH)));
      }
      return out;
    },
    set: (k, v) => cloudCall('setItem', k, v),
    removeMany: keys => (keys.length ? cloudCall('removeItems', keys) : Promise.resolve(true)),
  };

  const P = 'gym:';
  const local = {
    async keys() {
      try {
        return Object.keys(localStorage).filter(k => k.startsWith(P)).map(k => k.slice(P.length));
      } catch { return []; }
    },
    async getMany(keys) {
      const out = {};
      try { for (const k of keys) out[k] = localStorage.getItem(P + k); } catch { /* приватный режим */ }
      return out;
    },
    async set(k, v) { try { localStorage.setItem(P + k, v); } catch { /* нет места или запрещено */ } },
    async removeMany(keys) { try { keys.forEach(k => localStorage.removeItem(P + k)); } catch { /* ignore */ } },
  };

  const be = useCloud ? cloud : local;
  const chunkCount = {};      // логический ключ -> сколько частей сейчас записано
  const queue = {};           // очередь записи по ключу, чтобы записи не перемешивались

  // Читает всё облако пользователя: { ключ: значение (уже разобранный JSON) }
  async function loadAll() {
    const keys = await be.keys();
    const raw = await be.getMany(keys);
    const out = {};
    for (const k of keys) {
      if (/__\d+$/.test(k)) continue;                  // это часть, соберём ниже
      const n = parseInt(raw[k], 10);
      if (!n) continue;
      let s = '';
      for (let i = 0; i < n; i++) s += raw[`${k}__${i}`] || '';
      try {
        out[k] = JSON.parse(s);
        chunkCount[k] = n;
      } catch (e) {
        console.warn('Повреждённое значение', k, e);
      }
    }
    return out;
  }

  async function write(k, obj) {
    const s = JSON.stringify(obj);
    const parts = [];
    for (let i = 0; i < s.length; i += CHUNK) parts.push(s.slice(i, i + CHUNK));
    if (!parts.length) parts.push('null');
    await Promise.all(parts.map((p, i) => be.set(`${k}__${i}`, p)));
    await be.set(k, String(parts.length));
    const old = chunkCount[k] || 0;
    const extra = [];
    for (let i = parts.length; i < old; i++) extra.push(`${k}__${i}`);
    await be.removeMany(extra);
    chunkCount[k] = parts.length;
  }

  async function del(k) {
    const n = chunkCount[k] || 0;
    const keys = [k];
    for (let i = 0; i < n; i++) keys.push(`${k}__${i}`);
    await be.removeMany(keys);
    delete chunkCount[k];
  }

  function enqueue(k, job) {
    queue[k] = (queue[k] || Promise.resolve()).then(job).catch(e => {
      console.error('Ошибка сохранения', k, e);
      if (window.onStoreError) window.onStoreError(e);
    });
    return queue[k];
  }

  return {
    useCloud,
    loadAll,
    save: (k, obj) => enqueue(k, () => write(k, obj)),
    remove: k => enqueue(k, () => del(k)),
  };
})();
