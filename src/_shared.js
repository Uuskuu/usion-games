/* ===== Usion mini-app shared runtime (uses the real window.Usion SDK) =====
 * The SDK is loaded via <script src="https://usions.com/usion-sdk.js"> in <head>.
 * Outside the host (local dev / SDK unreachable) a minimal stub with the SAME
 * method names is installed so the game still runs; every SDK call is wrapped
 * in try/catch because platform writes fail for guests (AUTH_REQUIRED).
 */
(function installStubIfNeeded(){
  if (window.Usion) return;
  const mem = {};
  const noop = () => {};
  const P = v => Promise.resolve(v);
  window.Usion = {
    _stub: true,
    init(cb){ const cfg={userId:'local_dev',userName:'You',theme:'dark',language:(navigator.language||'mn').slice(0,2),mode:'single'}; this.config=cfg; setTimeout(()=>cb&&cb(cfg),0); return P(cfg); },
    config:{}, getLaunchParams(){ return {mode:'single',path:null,roomId:null,ref:null}; },
    getTheme(){ return (this.config&&this.config.theme)||'dark'; }, getLanguage(){ return (this.config&&this.config.language)||'mn'; },
    user:{ getId(){return 'local_dev';}, getName(){return 'You';}, getAvatar(){return null;} },
    storage:{ get(k){return P(mem[k]===undefined?null:mem[k]);}, set(k,v){mem[k]=v;return P({success:true});}, remove(k){delete mem[k];return P({success:true});}, keys(){return P(Object.keys(mem));}, clear(){for(const k in mem)delete mem[k];return P({success:true});} },
    leaderboard:{ submit(s){return P({success:true,score:s,best:s,previous:null,rank:1,updated:true});}, top(){return P([]);}, friends(){return P([{user_id:'local_dev',name:'You',score:0,rank:1,is_me:true}]);}, me(){return P({score:0,rank:1,total:1});} },
    game:{
      connect(){return P(true);}, join(){return P({room_id:null,player_id:'local_dev'});}, leave:noop, disconnect:noop,
      isConnected(){return false;}, isMultiplayer(){return false;},
      action(){return P({success:true});}, realtime(){return P({success:true});}, requestSync:noop,
      invite(){return P({success:false,reason:'offline'});}, reportResult(){return P({success:true});},
      forfeit(){return P({success:true});}, setState(){return P({success:true});},
      saveState(){return false;}, loadState(){return null;}, clearState:noop,
      onJoined:noop, onPlayerJoined:noop, onPlayerLeft:noop, onRoomAssigned:noop, onAction:noop, onRealtime:noop,
      onSync:noop, onError:noop, onDisconnect:noop, onReconnect:noop, onReconnected:noop,
      onConnectionState:noop, onPlayerConnection:noop, onGameFinished:noop, onStateUpdate:noop
    },
    share:noop, claimBackButton:noop, releaseBackButton:noop, exit:noop, log:noop, setLoading:noop
  };
})();

/* ---- i18n ---- */
const I18N = (() => {
  let lang = 'mn'; const dict = {};
  function t(key, vars) {
    let s = (dict[lang] && dict[lang][key]) || (dict.mn && dict.mn[key]) || key;
    if (vars) for (const k in vars) s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
    return s;
  }
  function apply() {
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
    document.documentElement.lang = lang;
    const b = document.getElementById('langBtn'); if (b) b.textContent = lang === 'mn' ? 'EN' : 'MN';
  }
  function set(l) { lang = l === 'en' ? 'en' : 'mn'; apply(); window.dispatchEvent(new Event('langchange')); }
  function toggle() { set(lang === 'mn' ? 'en' : 'mn'); Store.set('lang', lang); }
  return { t, apply, set, toggle, get lang() { return lang; }, register(d) { for (const l in d) dict[l] = Object.assign(dict[l] || {}, d[l]); } };
})();

/* ---- durable per-user storage (Usion.storage, localStorage fallback) ---- */
const Store = {
  prefix: (document.documentElement.dataset.game || 'game') + ':',
  async get(k) { try { const v = await Usion.storage.get(this.prefix + k); if (v !== null && v !== undefined) return v; } catch (e) {} try { const s = localStorage.getItem(this.prefix + k); return s ? JSON.parse(s) : null; } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(this.prefix + k, JSON.stringify(v)); } catch (e) {} try { return Usion.storage.set(this.prefix + k, v).catch(() => {}); } catch (e) { return Promise.resolve(); } },
  remove(k) { try { localStorage.removeItem(this.prefix + k); } catch (e) {} try { return Usion.storage.remove(this.prefix + k).catch(() => {}); } catch (e) { return Promise.resolve(); } },
};

/* ---- leaderboard: submit + render friends/global boards ---- */
const Board = {
  async submit(score, meta) {
    try { return await Usion.leaderboard.submit(score, meta); } catch (e) { return null; }
  },
  /* container gets a Friends/Global toggle + list. lowerIsBetter only affects formatting. */
  async render(container, fmt) {
    fmt = fmt || (v => v);
    container.innerHTML = '<div class="lbtabs"><button class="lbtab on" data-k="friends">' + I18N.t('lbFriends') + '</button><button class="lbtab" data-k="top">' + I18N.t('lbGlobal') + '</button></div><div class="lblist"><div class="muted">…</div></div>';
    const list = container.querySelector('.lblist');
    const me = (() => { try { return Usion.user.getId(); } catch (e) { return null; } })();
    async function load(k) {
      list.innerHTML = '<div class="muted">…</div>';
      let rows = [];
      try { rows = k === 'friends' ? await Usion.leaderboard.friends({ limit: 10 }) : await Usion.leaderboard.top({ limit: 10 }); } catch (e) { rows = []; }
      if (!rows || !rows.length) { list.innerHTML = '<div class="muted">' + I18N.t('lbEmpty') + '</div>'; return; }
      list.innerHTML = '';
      rows.slice(0, 10).forEach((r, i) => {
        const d = document.createElement('div'); d.className = 'lbrow' + ((r.is_me || r.user_id === me) ? ' me' : '');
        const rank = document.createElement('span'); rank.className = 'lbrank'; rank.textContent = (r.rank || i + 1);
        const av = document.createElement('span'); av.className = 'lbav'; if (r.avatar) { const img = document.createElement('img'); img.src = r.avatar; img.alt = ''; img.draggable = false; av.appendChild(img); } else av.textContent = (r.name || '?').slice(0, 1).toUpperCase();
        const nm = document.createElement('span'); nm.className = 'lbname'; nm.textContent = r.name || I18N.t('lbPlayer');
        const sc = document.createElement('span'); sc.className = 'lbscore'; sc.textContent = fmt(r.score);
        d.append(rank, av, nm, sc); list.appendChild(d);
      });
    }
    container.querySelectorAll('.lbtab').forEach(b => b.onclick = () => { container.querySelectorAll('.lbtab').forEach(x => x.classList.remove('on')); b.classList.add('on'); load(b.dataset.k); });
    load('friends');
  }
};
I18N.register({ mn: { lbFriends: 'Найзууд', lbGlobal: 'Глобал', lbEmpty: 'Одоогоор амжилт алга', lbPlayer: 'Тоглогч' }, en: { lbFriends: 'Friends', lbGlobal: 'Global', lbEmpty: 'No records yet', lbPlayer: 'Player' } });

/* ---- theme ---- */
function applyTheme() { let th = 'dark'; try { th = Usion.getTheme() || 'dark'; } catch (e) {} document.documentElement.dataset.theme = th; }

/* ---- boot: wait for Usion.init, then start instantly (mode 'single' = zero taps) ---- */
function bootApp(onReady) {
  let started = false;
  async function go(cfg) {
    if (started) return; started = true;
    cfg = cfg || Usion.config || {};
    applyTheme();
    let saved = null; try { saved = await Store.get('lang'); } catch (e) {}
    let lang = saved; if (!lang) { try { lang = Usion.getLanguage(); } catch (e) {} } if (!lang) lang = cfg.language || 'mn';
    I18N.set(lang);
    bindTopbar();
    try { Usion.releaseBackButton(); } catch (e) {}
    onReady(cfg);
  }
  try { Usion.init(go); } catch (e) { go({}); }
  setTimeout(() => { if (!started) go(Usion.config || {}); }, 4000); // host silent → still playable
}

/* ---- tiny helpers ---- */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const rnd = n => Math.floor(Math.random() * n);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function haptic(ms) { try { navigator.vibrate && navigator.vibrate(ms || 15); } catch (e) {} }
function fmtTime(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 800); }

/* ---- WebAudio sfx (no assets) ---- */
const Sfx = (() => {
  let ctx = null, on = true;
  try { on = localStorage.getItem('usion_sfx') !== '0'; } catch (e) {}
  function ac() { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } return ctx; }
  function tone(f, d, type, vol) {
    if (!on) return; const c = ac(); if (!c) return;
    try { const o = c.createOscillator(), g = c.createGain(); o.type = type || 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(vol || 0.07, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + d);
      o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + d); } catch (e) {}
  }
  return {
    ok() { tone(660, 0.08); setTimeout(() => tone(880, 0.1), 60); },
    bad() { tone(180, 0.18, 'square', 0.05); },
    tick() { tone(1000, 0.03, 'square', 0.03); },
    win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.15), i * 90)); },
    toggle() { on = !on; try { localStorage.setItem('usion_sfx', on ? '1' : '0'); } catch (e) {} return on; },
    get on() { return on; }
  };
})();
function bindTopbar() {
  const lb = $('#langBtn'); if (lb) lb.onclick = () => I18N.toggle();
  const sb = $('#sfxBtn'); if (sb) { sb.textContent = Sfx.on ? '🔊' : '🔈'; sb.onclick = () => { sb.textContent = Sfx.toggle() ? '🔊' : '🔈'; }; }
}
/* ---- records: durable personal bests / counters (Usion.storage backed) ---- */
const Records = {
  d: {}, _t: null,
  async load() { this.d = (await Store.get('records')) || {}; return this.d; },
  get(k, dflt) { const v = this.d[k]; return (v === undefined || v === null) ? (dflt === undefined ? 0 : dflt) : v; },
  bump(k, n) { this.d[k] = (this.d[k] || 0) + (n === undefined ? 1 : n); this.save(); return this.d[k]; },
  /* returns {better, prev} — prev is null on a first-ever result */
  best(k, v, lowerIsBetter) {
    const p = this.d[k]; const has = p !== undefined && p !== null;
    const better = !has || (lowerIsBetter ? v < p : v > p);
    if (better) { this.d[k] = v; this.save(); }
    return { better, prev: has ? p : null };
  },
  save() { clearTimeout(this._t); this._t = setTimeout(() => Store.set('records', this.d), 120); }
};

/* The platform's launch-mode split: 'single' => instant play, 'multiplayer' => waiting hall.
   Decided from the MODE, never from roomId (a solo launch can carry a standalone_* room). */
function launchedSolo(config) {
  try {
    const lp = (window.Usion && Usion.getLaunchParams && Usion.getLaunchParams()) || {};
    if (lp.mode === 'single') return true;
    if (lp.mode === 'multiplayer') return false;
    if (Usion.game && typeof Usion.game.isMultiplayer === 'function') return !Usion.game.isMultiplayer();
    const rid = config && config.roomId ? String(config.roomId) : '';
    return !rid || /^standalone[_-]/i.test(rid);
  } catch (e) { return false; }
}

/* ---- roster: who is in the room, their info and ready state ---- */
const Roster = {
  ids: [], myId: null, info: {}, present: {},
  reset(ids, myId) {
    this.myId = myId || this.myId;
    this.ids = (ids || []).slice();
    if (this.myId && this.ids.indexOf(this.myId) < 0) this.ids.push(this.myId);
    this.info = {}; this.present = {};
    if (this.myId) this.see(this.myId);
    return this;
  },
  /* adopt the platform roster verbatim — ids[0] is the host — keeping known info */
  setIds(ids) {
    if (!ids || !ids.length) return this;
    this.ids = ids.slice();
    if (this.myId && this.ids.indexOf(this.myId) < 0) this.ids.push(this.myId);
    this.ids.forEach(id => { if (this.present[id] === undefined) this.present[id] = true; });
    return this;
  },
  hostId() { return this.ids[0] || null; },
  isHost() { return !!this.myId && this.hostId() === this.myId; },
  see(id) { if (!id) return; if (this.ids.indexOf(id) < 0) this.ids.push(id); this.present[id] = true; if (this.info[id]) this.info[id].gone = false; },
  gone(id) { this.present[id] = false; if (this.info[id]) this.info[id].gone = true; },
  drop(id) { delete this.present[id]; const i = this.ids.indexOf(id); if (i >= 0) this.ids.splice(i, 1); delete this.info[id]; },
  set(id, patch) { this.info[id] = Object.assign({ name: '', avatar: null, ready: false, bot: false, gone: false }, this.info[id], patch); return this.info[id]; },
  of(id) { return this.info[id] || { name: '', avatar: null, ready: false, bot: false, gone: false }; },
  name(id) { const n = this.of(id).name; return n || (id === this.myId ? I18N.t('lbPlayer') : I18N.t('lbPlayer')); },
  here() { return this.ids.filter(id => this.present[id] !== false); },
  allReady() { const h = this.here(); return h.length >= 2 && h.every(id => this.of(id).ready); }
};

/* avatar bubble (image or initial) shared by the roster, the race track and the boards */
function avatarEl(info, cls) {
  const av = document.createElement('span'); av.className = cls || 'lbav';
  if (info && info.avatar) { const img = document.createElement('img'); img.src = info.avatar; img.alt = ''; img.draggable = false; av.appendChild(img); }
  else av.textContent = ((info && info.name) || '?').slice(0, 1).toUpperCase();
  return av;
}

/* ---- in-game quick chat (rides the room relay, never Usion.chat) ---- */
const Chat = {
  MAX: 60, _last: 0, render: null,
  norm(v) { if (typeof v !== 'string') return ''; const m = v.trim().replace(/\s+/g, ' '); return (m && m.length <= this.MAX) ? m : m.slice(0, this.MAX); },
  send(v) {
    const phrase = this.norm(v); if (!phrase) return false;
    if (Date.now() - this._last < 700) return false;
    this._last = Date.now();
    if (this.render) this.render(Roster.myId, phrase);
    try { Usion.game.realtime('quick_chat', { phrase }); } catch (e) {}
    return true;
  },
  receive(m) {
    if (!m || m.action_type !== 'quick_chat' || m.player_id === Roster.myId) return;
    const phrase = this.norm(m.action_data && m.action_data.phrase);
    if (phrase && this.render) this.render(m.player_id, phrase);
  }
};

/* block scroll on play surfaces */
document.addEventListener('touchmove', e => { if (e.target.closest && e.target.closest('.play')) e.preventDefault(); }, { passive: false });
