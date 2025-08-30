<script>
/* ============================================================================
 * GameContext: shared, real-time game state across Game Day pages
 * - Same-device/tab sync: localStorage + BroadcastChannel
 * - Optional multi-device sync: Apps Script ctx_get/ctx_set (1s poll)
 * - Helpers: configure(), bindInputs(), subscribe(), setGame/Drive/Play()
 * ========================================================================== */
(function(global){
  'use strict';

  const KEY = 'gsds_game_ctx_v1';
  const CHAN_NAME = 'gsds_ctx';
  const chan = ('BroadcastChannel' in global) ? new BroadcastChannel(CHAN_NAME) : null;
  const subs = new Set();

  // --- server sync config/state ---
  let API_BASE = global.GSDS_API_BASE || global.API_BASE || ''; // <— also read window.API_BASE
  let SERVER_SYNC = !!global.GSDS_SERVER_SYNC;
  let POLL_MS = Number(global.GSDS_POLL_MS || 1000);
  let pollTimer = null;
  let lastServerTs = 0;
  let pushTimer = null;
  let pushDelay = 150;

  // ---------- Storage core ----------
  function safeParse(json, fallback){ try { return JSON.parse(json); } catch { return fallback; } }
  function now(){ return Date.now(); }

  function read(){
    const ctx = safeParse(localStorage.getItem(KEY), {});
    return (ctx && typeof ctx === 'object') ? ctx : {};
  }
  function writeLocal(ctx, notify = true){
    localStorage.setItem(KEY, JSON.stringify(ctx));
    if (chan) chan.postMessage({ type:'ctx', ctx });
    if (notify) subs.forEach(fn => { try{ fn(ctx); }catch{} });
  }
  function merge(partial, opts){
    const cur = read();
    const next = { ...cur, ...partial };
    if (!Object.prototype.hasOwnProperty.call(partial, 'updated_at')) {
      next.updated_at = now();
    }
    writeLocal(next, true);
    if (SERVER_SYNC && !(opts && opts.fromServer)) {
      schedulePush(next);
    }
    return next;
  }

  // ---------- Broadcast & storage events ----------
  function onStorage(e){
    if (e.key !== KEY) return;
    const ctx = safeParse(e.newValue || '{}', {});
    subs.forEach(fn => { try{ fn(ctx); }catch{} });
  }
  if (typeof window !== 'undefined'){
    window.addEventListener('storage', onStorage);
    if (chan) chan.onmessage = ev => {
      if (ev.data && ev.data.type === 'ctx') subs.forEach(fn => { try{ fn(ev.data.ctx); }catch{} });
    };
  }

  // ---------- Server sync (optional) ----------
  async function getServerCtx(){
    if (!API_BASE) return null;
    const url = new URL(API_BASE);
    url.searchParams.set('action','ctx_get');
    const r = await fetch(url.toString(), { method:'GET', credentials:'omit' });
    try { return r.ok ? await r.json() : null; } catch { return null; }
  }
  async function setServerCtx(ctx){
    if (!API_BASE) return null;
    const payload = {
      action: 'ctx_set',
      game_id:  ctx.game_id || '',
      drive_id: ctx.drive_id || '',
      play_id:  ctx.play_id || ''
    };
    const r = await fetch(API_BASE, {
      method:'POST',
      // use text/plain to avoid preflight like the rest of the app
      headers:{ 'Content-Type':'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      credentials:'omit'
    });
    try { return r.ok ? await r.json() : null; } catch { return null; }
  }
  function schedulePush(ctx){
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(async ()=>{
      pushTimer = null;
      try { await setServerCtx(ctx); } catch {}
    }, pushDelay);
  }
  async function pollOnce(){
    try{
      const res = await getServerCtx();
      if (!res || !res.ok || !res.ctx) return;
      const srv = res.ctx;
      if (Number(srv.ts||0) > Number(lastServerTs||0)) {
        lastServerTs = Number(srv.ts)||0;
        merge(
          {
            game_id:  srv.game_id || '',
            drive_id: srv.drive_id || '',
            play_id:  srv.play_id || '',
            updated_at: Number(srv.ts) || now()
          },
          { fromServer:true }
        );
      }
    } catch {}
  }
  function startServerPoll(){
    if (!SERVER_SYNC || !API_BASE) return;
    if (pollTimer) clearInterval(pollTimer);
    pollOnce();
    pollTimer = setInterval(pollOnce, Math.max(300, POLL_MS|0));
  }
  function stopServerPoll(){
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // ---------- Public API ----------
  const api = {
    // state
    get: read,
    subscribe(fn){ subs.add(fn); try { fn(read()); } catch{} return () => subs.delete(fn); },

    // simple setters
    set(obj){ return merge(obj); },
    clear(){ return merge({ game_id:'', drive_id:'', play_id:'' }); },
    setGame(id){ return merge({ game_id: (id||'').trim() }); },
    setDrive(id){ return merge({ drive_id:(id||'').trim() }); },
    setPlay(id){ return merge({ play_id: (id||'').trim() }); },

    // config
    configure(opts = {}){
      if (typeof opts.apiBase === 'string') API_BASE = opts.apiBase;
      if (typeof opts.server === 'boolean') SERVER_SYNC = opts.server;
      if (typeof opts.pollMs === 'number') POLL_MS = opts.pollMs;
      if (SERVER_SYNC) startServerPoll(); else stopServerPoll();
      return { API_BASE, SERVER_SYNC, POLL_MS };
    },

    // helpers: two-way bind inputs to context keys (id or selector)
    bindInputs(map){
      const resolve = sel => {
        if (!sel) return null;
        if (typeof sel === 'string') return document.querySelector(sel);
        if (sel instanceof HTMLElement) return sel;
        return null;
      };
      const nodes = Object.fromEntries(
        Object.entries(map||{}).map(([k,sel])=>[k, resolve(sel)])
      );
      const unsub = api.subscribe(ctx=>{
        for (const k of Object.keys(nodes)){
          const n = nodes[k];
          if (!n) continue;
          const val = (ctx && ctx[k]) || '';
          if (n.value !== undefined && n.value !== String(val)) n.value = String(val);
          n.dataset.ctxValue = String(val);
        }
      });
      const onInput = e => {
        const id = Object.keys(nodes).find(key => nodes[key] === e.currentTarget);
        if (id) api.set({ [id]: e.currentTarget.value || '' });
      };
      Object.values(nodes).forEach(n => { if(n) n.addEventListener('change', onInput); });
      return () => {
        unsub();
        Object.values(nodes).forEach(n => { if(n) n.removeEventListener('change', onInput); });
      };
    },

    // tiny UI helper for a standard banner chip
    mountBanner(selector = '#ctxBanner'){
      const el = document.querySelector(selector);
      if (!el) return () => {};
      const unsub = api.subscribe(c=>{
        const parts = [];
        if (c.game_id) parts.push(`Game: ${c.game_id}`);
        if (c.drive_id) parts.push(`Drive: ${c.drive_id}`);
        if (c.play_id) parts.push(`Play: ${c.play_id}`);
        el.textContent = parts.join(' • ') || 'No game selected';
      });
      return unsub;
    },

    // expose internals for debugging (optional)
    _debug: {
      get API_BASE(){ return API_BASE; },
      get SERVER_SYNC(){ return SERVER_SYNC; },
      get POLL_MS(){ return POLL_MS; },
      forcePoll: pollOnce,
      getServerCtx, setServerCtx
    }
  };

  // Export
  global.GameContext = api;

  // Auto-configure if globals exist
  try {
    if (global.GSDS_API_BASE || global.API_BASE || global.GSDS_SERVER_SYNC) {
      api.configure({
        apiBase: global.GSDS_API_BASE || global.API_BASE || API_BASE,
        server:  !!global.GSDS_SERVER_SYNC,
        pollMs:  global.GSDS_POLL_MS || POLL_MS
      });
    }
  } catch {}
})(window);
</script>
