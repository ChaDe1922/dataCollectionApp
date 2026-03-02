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
  let API_BASE = '';              // e.g. 'https://script.google.com/macros/s/XXXXX/exec'
  let SERVER_SYNC = false;        // disabled by default; call configure({server:true})
  let POLL_MS = 1000;             // 1 second polling interval
  let pollTimer = null;
  let lastServerTs = 0;           // last server ctx ts we've applied
  let pushTimer = null;           // debounce for outgoing pushes
  let pushDelay = 150;            // debounce ms to avoid spamming while typing
  let leaderElection = null;      // leader election controller for single-tab polling
  let presenceChannel = null;     // BroadcastChannel for presence updates

  // ---------- Storage core ----------
  function safeParse(json, fallback){ try { return JSON.parse(json); } catch { return fallback; } }
  function now(){ return Date.now(); }

  function read(){
    const ctx = safeParse(localStorage.getItem(KEY), {});
    return ctx && typeof ctx === 'object' ? ctx : {};
  }
  function writeLocal(ctx, notify = true, source = 'local'){
    localStorage.setItem(KEY, JSON.stringify(ctx));
    if (chan) chan.postMessage({ type:'ctx', ctx, source });
    if (presenceChannel) presenceChannel.postMessage({ type:'PRESENCE_UPDATE', ctx, source, ts:Date.now() });
    if (notify) subs.forEach(fn => fn(ctx));
  }
  function merge(partial, opts){
    const cur = read();
    const next = { ...cur, ...partial };
    // Only stamp updated_at if caller didn't explicitly provide a ts (server pulls bring their own)
    if (!Object.prototype.hasOwnProperty.call(partial, 'updated_at')) {
      next.updated_at = now();
    }
    const source = (opts && opts.fromServer) ? 'server' : 'local';
    writeLocal(next, true, source);
    // If server sync is on and this wasn't a server-applied change, push upstream (debounced)
    if (SERVER_SYNC && !(opts && opts.fromServer)) {
      schedulePush(next);
    }
    // If this was a local change and we're leader, broadcast to followers
    if (source === 'local' && leaderElection && leaderElection.isLeader()) {
      broadcastPresenceUpdate(next, 'local');
    }
    return next;
  }

  // ---------- Broadcast & storage events ----------
  function onStorage(e){
    if (e.key !== KEY) return;
    const ctx = safeParse(e.newValue || '{}', {});
    subs.forEach(fn => fn(ctx));
  }
  if (typeof window !== 'undefined'){
    window.addEventListener('storage', onStorage);
    if (chan) chan.onmessage = ev => {
      if (ev.data && ev.data.type === 'ctx') subs.forEach(fn => fn(ev.data.ctx));
    };
    // Setup dedicated presence update channel
    if ('BroadcastChannel' in global) {
      presenceChannel = new BroadcastChannel('gsds_presence');
      presenceChannel.onmessage = ev => {
        if (ev.data && ev.data.type === 'PRESENCE_UPDATE' && ev.data.ctx) {
          // Apply update from another tab/leader
          const cur = read();
          const isDifferent = JSON.stringify(cur) !== JSON.stringify(ev.data.ctx);
          if (isDifferent) {
            writeLocal(ev.data.ctx, false, 'broadcast');
            subs.forEach(fn => fn(ev.data.ctx));
          }
        }
      };
    }
  }

  // ---------- Server sync (optional) - uses API.request if available ----------
  async function getServerCtx(){
    if (!API_BASE) return null;
    // Prefer API.request if available
    if (window.API && window.API.request) {
      const res = await window.API.request({ action:'ctx_get' }, { method:'GET' });
      return res.ok ? res.data : null;
    }
    // Fallback to direct fetch
    const url = new URL(API_BASE);
    url.searchParams.set('action','ctx_get');
    const r = await fetch(url.toString(), { method:'GET', credentials:'omit' });
    return r.ok ? r.json() : null;
  }
  async function setServerCtx(ctx){
    if (!API_BASE) return null;
    const payload = {
      action: 'ctx_set',
      game_id:  ctx.game_id || '',
      drive_id: ctx.drive_id || '',
      play_id:  ctx.play_id || ''
    };
    // Prefer API.request if available
    if (window.API && window.API.request) {
      const res = await window.API.request(payload);
      return res.ok ? res.data : null;
    }
    // Fallback to direct fetch
    const r = await fetch(API_BASE, {
      method:'POST',
      headers:{ 'Content-Type':'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      credentials:'omit'
    });
    return r.ok ? r.json() : null;
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
      // Only apply if server has something newer than what we've already applied from server
      if (Number(srv.ts||0) > Number(lastServerTs||0)) {
        lastServerTs = Number(srv.ts)||0;
        // Merge from server WITHOUT pushing back (avoid loops)
        const newCtx = merge(
          {
            game_id: srv.game_id || '',
            drive_id: srv.drive_id || '',
            play_id: srv.play_id || '',
            updated_at: Number(srv.ts) || now()
          },
          { fromServer:true }
        );
        // Leader broadcasts the update to all followers
        broadcastPresenceUpdate(newCtx, 'poll');
      }
    } catch {}
  }

  // Broadcast presence update to all tabs (leader only)
  let lastBroadcastCtx = null;
  function broadcastPresenceUpdate(ctx, source='local'){
    const ctxStr = JSON.stringify(ctx);
    if (lastBroadcastCtx === ctxStr) return; // dedupe
    lastBroadcastCtx = ctxStr;

    const msg = {
      type: 'PRESENCE_UPDATE',
      ctx,
      source,
      ts: Date.now(),
      tabId: leaderElection?._debug?.tabId || 'unknown'
    };

    // Broadcast via BroadcastChannel
    if (presenceChannel) {
      try { presenceChannel.postMessage(msg); } catch {}
    }

    // Mirror to localStorage for non-BC tabs
    try {
      localStorage.setItem('GSDS_PRESENCE_LAST', JSON.stringify({ ctx, ts: Date.now(), source, tabId: msg.tabId }));
    } catch {}
  }

  // ---------- Leader election integration ----------
  function initLeaderElection() {
    if (!SERVER_SYNC || !API_BASE) return;
    if (!global.GSDSLeader) {
      console.warn('GSDSLeader not available, falling back to all-tab polling');
      return;
    }

    // Stop any existing election
    if (leaderElection) {
      leaderElection.stop();
      leaderElection = null;
    }

    leaderElection = global.GSDSLeader.start({
      key: 'GSDS_POLL_LEADER:PRESENCE',
      pollMs: POLL_MS,
      debugLabel: 'PRESENCE',
      onBecameLeader: () => {
        // This tab became leader - start polling
        if (global.GSDS_DEBUG) console.log('[LEADER][PRESENCE] Started polling as leader');
        startPollInterval();
      },
      onLostLeadership: () => {
        // Lost leadership - stop polling
        if (global.GSDS_DEBUG) console.log('[LEADER][PRESENCE] Stopped polling (lost leadership)');
        stopPollInterval();
      }
    });

    // If we're already leader, start polling immediately
    if (leaderElection.isLeader()) {
      startPollInterval();
    }
  }

  function startPollInterval() {
    if (pollTimer) clearInterval(pollTimer);
    pollOnce();
    pollTimer = setInterval(pollOnce, Math.max(300, POLL_MS|0));
  }

  function stopPollInterval() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startServerPoll(){
    if (!SERVER_SYNC || !API_BASE) return;
    // Stop old-style polling
    stopServerPollLegacy();
    // Start leader election (which manages polling)
    initLeaderElection();
  }

  function stopServerPollLegacy(){ if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  function stopServerPoll(){
    stopServerPollLegacy();
    if (leaderElection) {
      leaderElection.stop();
      leaderElection = null;
    }
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
      // map example: { game_id:'#game_id', drive_id:'#drive_id', play_id:'#play_id' }
      const resolve = sel => {
        if (!sel) return null;
        if (typeof sel === 'string') return document.querySelector(sel);
        if (sel instanceof HTMLElement) return sel;
        return null;
      };
      const nodes = Object.fromEntries(
        Object.entries(map||{}).map(([k,sel])=>[k, resolve(sel)])
      );
      // init UI from ctx & keep in sync
      const unsub = api.subscribe(ctx=>{
        for (const k of Object.keys(nodes)){
          const n = nodes[k];
          if (!n) continue;
          const val = (ctx && ctx[k]) || '';
          if (n.value !== undefined && n.value !== String(val)) n.value = String(val);
          // also reflect as data-attr for CSS hooks if needed
          n.dataset.ctxValue = String(val);
        }
      });
      // push UI edits to ctx (debounced by GameContext push)
      const onInput = e => {
        const id = Object.keys(nodes).find(key => nodes[key] === e.currentTarget);
        if (id) api.set({ [id]: e.currentTarget.value || '' });
      };
      Object.values(nodes).forEach(n => { if(n) n.addEventListener('change', onInput); });

      // return unbinder
      return () => {
        unsub();
        Object.values(nodes).forEach(n => { if(n) n.removeEventListener('change', onInput); });
      };
    },

    // expose internals for debugging (optional)
    _debug: {
      get API_BASE(){ return API_BASE; },
      get SERVER_SYNC(){ return SERVER_SYNC; },
      get POLL_MS(){ return POLL_MS; },
      get isLeader(){ return leaderElection ? leaderElection.isLeader() : false; },
      get leaderTabId(){ return leaderElection?._debug?.currentLeader || null; },
      get myTabId(){ return leaderElection?._debug?.tabId || 'unknown'; },
      forcePoll: pollOnce,
      get leaderElection() { return leaderElection; }
    }
  };

  // Export
  global.GameContext = api;

  // If a global default is present, auto-configure (non-fatal)
  // e.g., set on page: window.GSDS_API_BASE = 'https://script.google.com/.../exec'
  try {
    if (global.GSDS_API_BASE || global.GSDS_SERVER_SYNC) {
      api.configure({
        apiBase: global.GSDS_API_BASE || API_BASE,
        server:  !!global.GSDS_SERVER_SYNC,
        pollMs:  global.GSDS_POLL_MS || POLL_MS
      });
    }
  } catch {}
})(window);
