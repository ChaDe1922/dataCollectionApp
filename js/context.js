/* ============================================================================
 * AppContext (unified): Game + Tryout
 * - Local sync: localStorage + BroadcastChannel
 * - Optional server sync: Apps Script ctx_get / ctx_set
 * - Keys supported:
 *   Game  : game_id, drive_id, play_id
 *   Tryout: tryout_id, station_id, rep_id, period_code, group_code
 * - Mapping (both directions): game_id<->tryout_id, drive_id<->station_id, play_id<->rep_id
 * ========================================================================== */
(function(global){
  'use strict';

  const KEY = 'gsds_ctx_v2';
  const CHAN_NAME = 'gsds_ctx';
  const chan = ('BroadcastChannel' in global) ? new BroadcastChannel(CHAN_NAME) : null;
  const subs = new Set();

  // --- server sync config/state ---
  let API_BASE = global.GSDS_API_BASE || global.API_BASE || '';
  let SERVER_SYNC = !!global.GSDS_SERVER_SYNC;
  let POLL_MS = Number(global.GSDS_POLL_MS || 1000);
  let pollTimer = null;
  let lastServerTs = 0;
  let pushTimer = null;
  let pushDelay = 150;

  // ---------- utils ----------
  function safeParse(json, fallback){ try { return JSON.parse(json); } catch { return fallback; } }
  function now(){ return Date.now(); }
  const clone = (o)=>Object.assign({}, o||{});

  // ---------- mapping helpers ----------
  function applyBidirectionalMapping(next, fromServer=false){
    const n = clone(next);

    // If incoming has tryout fields, ensure game aliases are set too
    if ('tryout_id' in n && !('game_id' in n)) n.game_id = n.tryout_id;
    if ('station_id' in n && !('drive_id' in n)) n.drive_id = n.station_id;
    if ('rep_id' in n && !('play_id' in n)) n.play_id = n.rep_id;

    // If incoming has only game fields (e.g., from server ctx), mirror to tryout
    if ('game_id' in n && !('tryout_id' in n)) n.tryout_id = n.game_id;
    if ('drive_id' in n && !('station_id' in n)) n.station_id = n.drive_id;
    if ('play_id' in n && !('rep_id' in n)) n.rep_id = n.play_id;

    // Always stamp updated_at if caller didn't provide one
    if (!fromServer && !Object.prototype.hasOwnProperty.call(n, 'updated_at')) {
      n.updated_at = now();
    }
    return n;
  }

  // ---------- storage core ----------
  function read(){
    const ctx = safeParse(localStorage.getItem(KEY), {});
    return (ctx && typeof ctx==='object')?ctx:{};
  }
  function writeLocal(ctx, notify=true){
    localStorage.setItem(KEY, JSON.stringify(ctx));
    if (chan) chan.postMessage({ type:'ctx', ctx });
    if (notify) subs.forEach(fn => { try{ fn(ctx); }catch{} });
  }
  function merge(partial, opts){
    const cur = read();
    const n = applyBidirectionalMapping({ ...cur, ...partial }, !!(opts && opts.fromServer));
    writeLocal(n, true);
    if (SERVER_SYNC && !(opts && opts.fromServer)) schedulePush(n);
    return n;
  }

  // ---------- cross-tab sync ----------
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

  // ---------- server sync ----------
  async function getServerCtx(){
    if (!API_BASE) return null;
    const url = new URL(API_BASE);
    url.searchParams.set('action','ctx_get');
    const r = await fetch(url.toString(), { method:'GET', credentials:'omit' });
    try { return r.ok ? await r.json() : null; } catch { return null; }
  }
  async function setServerCtx(ctx){
    if (!API_BASE) return null;
    // Always send aliases so old server code works (Apps Script accepts these)
    const payload = {
      action: 'ctx_set',
      game_id:  ctx.tryout_id || ctx.game_id || '',
      drive_id: ctx.station_id || ctx.drive_id || '',
      play_id:  ctx.rep_id || ctx.play_id || ''
    };
    const r = await fetch(API_BASE, {
      method:'POST',
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
            // mirror to tryout fields too:
            tryout_id: srv.game_id || '',
            station_id: srv.drive_id || '',
            rep_id: srv.play_id || '',
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
  function stopServerPoll(){ if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  // ---------- public API ----------
  const api = {
    // state
    get: read,
    subscribe(fn){ subs.add(fn); try { fn(read()); } catch{} return () => subs.delete(fn); },

    // setters (Game)
    set(obj){ return merge(obj); },
    clear(){ return merge({ game_id:'', drive_id:'', play_id:'', tryout_id:'', station_id:'', rep_id:'', period_code:'', group_code:'' }); },
    setGame(id){ return merge({ game_id: (id||'').trim() }); },
    setDrive(id){ return merge({ drive_id:(id||'').trim() }); },
    setPlay(id){ return merge({ play_id: (id||'').trim() }); },

    // setters (Tryout)
    setTryoutId(id){ return merge({ tryout_id:(id||'').trim() }); },
    setStation(id){ return merge({ station_id:(id||'').trim() }); },
    setRep(id){ return merge({ rep_id:(id||'').trim() }); },
    setGroup(code){ return merge({ group_code:(code||'').trim() }); },
    setPeriod(code){ return merge({ period_code:(code||'').trim() }); },

    // config
    configure(opts = {}){
      if (typeof opts.apiBase === 'string') API_BASE = opts.apiBase;
      if (!API_BASE) {
        // fallback: read <meta name="gsds-api-base">
        try{
          const m = document.querySelector('meta[name="gsds-api-base"]');
          if (m && m.content) API_BASE = m.content.trim();
        }catch{}
      }
      if (typeof opts.server === 'boolean') SERVER_SYNC = opts.server;
      if (typeof opts.pollMs === 'number') POLL_MS = opts.pollMs;
      if (SERVER_SYNC) startServerPoll(); else stopServerPoll();
      return { API_BASE, SERVER_SYNC, POLL_MS };
    },

    // bind inputs to any of the keys above
    bindInputs(map){
      const resolve = sel => {
        if (!sel) return null;
        if (typeof sel === 'string') return document.querySelector(sel);
        if (sel instanceof HTMLElement) return sel;
        return null;
      };
      const nodes = Object.fromEntries(Object.entries(map||{}).map(([k,sel])=>[k, resolve(sel)]));
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
      return () => { unsub(); Object.values(nodes).forEach(n => { if(n) n.removeEventListener('change', onInput); }); };
    },

    // Tryout-aware banner
    mountBanner(selector = '#ctxBanner'){
      const el = document.querySelector(selector);
      if (!el) return () => {};
      const unsub = api.subscribe(c=>{
        let text = '';
        if (c.tryout_id || c.station_id || c.rep_id || c.period_code || c.group_code) {
          const parts = [];
          if (c.tryout_id) parts.push(`Tryout: ${c.tryout_id}`);
          if (c.period_code) parts.push(`Period: ${c.period_code}`);
          if (c.group_code) parts.push(`Group: ${c.group_code}`);
          if (c.station_id) parts.push(`Station: ${c.station_id}`);
          if (c.rep_id) parts.push(`Rep: ${c.rep_id}`);
          text = parts.join(' • ');
        } else if (c.game_id || c.drive_id || c.play_id) {
          const parts = [];
          if (c.game_id) parts.push(`Game: ${c.game_id}`);
          if (c.drive_id) parts.push(`Drive: ${c.drive_id}`);
          if (c.play_id) parts.push(`Play: ${c.play_id}`);
          text = parts.join(' • ');
        }
        el.textContent = text || 'No context set';
      });
      return unsub;
    },

    _debug: {
      get API_BASE(){ return API_BASE; },
      get SERVER_SYNC(){ return SERVER_SYNC; },
      get POLL_MS(){ return POLL_MS; },
      forcePoll: pollOnce,
      getServerCtx, setServerCtx
    }
  };

  // export
  global.GameContext = api;

  // auto-configure if globals exist
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

/* ============================================================================
 * Time-based Period Notification Scheduler (Date-agnostic)
 * - T-5 minutes, T-1 minute, and T-0 "Now entering …"
 * - Uses time-of-day from dictionary (works even if date is omitted)
 * - Broadcast to all tabs (same origin) via localStorage
 * - Renders a LIGHT, FULL-WIDTH TOP BAR for 10s (non-blocking)
 * ========================================================================== */
(function(){
  'use strict';

  const BUS_KEY = 'gsds_notice_bus_v1';
  const ET_TZ = 'America/New_York';
  const DEFAULT_DURATION = 10_000;

  let scheduledTimers = new Set();
  let currentPeriods = [];
  let lastActivePeriod = null;
  let lastCheckedMinute = -1;

  // ---------- Notice UI (light horizontal top bar) ----------
  function ensureHost(){
    // Remove any legacy notice UIs that might style a tall pill
    try{
      const legacyHost = document.getElementById('noticeHost');
      if (legacyHost) legacyHost.remove();
      document.querySelectorAll('.notice, .notice-banner').forEach(n=>n.remove());
    }catch{}

    if (document.getElementById('gsdsNoticeBarHost')) return;
    const host = document.createElement('div');
    host.id = 'gsdsNoticeBarHost';
    Object.assign(host.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      zIndex: '10000',
      pointerEvents: 'none',
      paddingTop: 'env(safe-area-inset-top, 0px)'
    });
    document.body.appendChild(host);
  }

  let activeBar = null;
  let activeTimer = null;
  let lastShownKey = '';

  function showNotice(msg, { duration = DEFAULT_DURATION } = {}){
    ensureHost();
    const host = document.getElementById('gsdsNoticeBarHost');

    // Reuse a single bar so it never stacks or grows
    if (!activeBar) {
      activeBar = document.createElement('div');
      activeBar.id = 'gsdsNoticeBar';
      Object.assign(activeBar.style, {
        boxSizing: 'border-box',
        width: '100%',
        minHeight: '40px',
        padding: '10px 14px',
        background: '#F4F2FF',                 // light lavender
        color: '#20123A',
        borderBottom: '1px solid #E2D9FF',
        boxShadow: '0 2px 8px rgba(17,12,28,.08)',
        fontWeight: '800',
        letterSpacing: '.02em',
        textAlign: 'center',
        lineHeight: '1.25',
        pointerEvents: 'none',
        transform: 'translateY(-100%)',
        opacity: '0',
        transition: 'transform .25s ease, opacity .25s ease'
      });
      host.appendChild(activeBar);
    }

    activeBar.textContent = msg;

    // Animate in
    requestAnimationFrame(()=>{
      activeBar.style.opacity = '1';
      activeBar.style.transform = 'translateY(0)';
    });

    if (activeTimer) clearTimeout(activeTimer);
    activeTimer = setTimeout(hideNotice, duration);

    // Optional haptic tap
    if (navigator.vibrate) { try { navigator.vibrate(40); } catch {} }
  }

  function hideNotice(){
    if (!activeBar) return;
    activeBar.style.opacity = '0';
    activeBar.style.transform = 'translateY(-100%)';
    activeTimer = null;
  }

  function broadcastNotice(msg, opts = {}){
    // Show locally (storage event does not fire in the origin tab)
    try { showNotice(msg, opts); } catch {}
    // De-dupe repeated sends in the same instant (tab storms)
    const key = msg + '|' + Math.floor(Date.now()/1000);
    if (key === lastShownKey) return;
    lastShownKey = key;
    // Notify other tabs
    try { localStorage.setItem(BUS_KEY, JSON.stringify({ ts: Date.now(), msg, opts })); }
    catch(_){}
  }

  // Listen for notices from other tabs
  window.addEventListener('storage', (e) => {
    if (e.key !== BUS_KEY || !e.newValue) return;
    try {
      const { msg, opts } = JSON.parse(e.newValue || '{}');
      // De-dupe if we literally just showed the same message this second
      const key = msg + '|' + Math.floor(Date.now()/1000);
      if (key === lastShownKey) return;
      lastShownKey = key;
      if (msg) showNotice(msg, opts);
    } catch {}
  });

  // ---------- Time Helpers (ET timezone) ----------
  function getNowET(){
    return new Date(new Date().toLocaleString('en-US', { timeZone: ET_TZ }));
  }

  function parseTimeToMinutes(timeStr){
    if (!timeStr) return null;
    const match = String(timeStr).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?(\s*[APap][Mm])?/);
    if (!match) return null;
    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const ampm = match[4];
    if (ampm) {
      const isPM = ampm.toLowerCase().includes('p');
      if (isPM && hours < 12) hours += 12;
      if (!isPM && hours === 12) hours = 0;
    }
    return hours * 60 + minutes;
  }

  function getNextOccurrenceTime(timeStr){
    const now = getNowET();
    const targetMinutes = parseTimeToMinutes(timeStr);
    if (targetMinutes === null) return null;
    const targetHours = Math.floor(targetMinutes / 60);
    const targetMins = targetMinutes % 60;
    const targetTime = new Date(now);
    targetTime.setHours(targetHours, targetMins, 0, 0);
    if (targetTime.getTime() <= now.getTime()) targetTime.setDate(targetTime.getDate() + 1);
    return targetTime;
  }

  // ---------- Period Management ----------
  function clearScheduledTimers(){
    scheduledTimers.forEach(timer => clearTimeout(timer));
    scheduledTimers.clear();
  }

  function detectActivePeriod(periods){
    const now = getNowET();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    for (const period of periods) {
      const startMinutes = parseTimeToMinutes(period.start);
      const endMinutes = parseTimeToMinutes(period.end);
      if (startMinutes == null || endMinutes == null) continue;
      if (endMinutes < startMinutes) {
        if (nowMinutes >= startMinutes || nowMinutes <= endMinutes) return period;
      } else {
        if (nowMinutes >= startMinutes && nowMinutes <= endMinutes) return period;
      }
    }
    return null;
  }

  function scheduleNotifications(){
    clearScheduledTimers();

    const now = Date.now();
    const nowET = getNowET();

    currentPeriods.forEach(period => {
      const label = period.label || period.period_label || period.code || period.period_code || 'Next Period';
      const code  = period.code  || period.period_code || '';
      const nextStart = getNextOccurrenceTime(period.start);
      if (!nextStart) return;
      const startTime = nextStart.getTime();

      [
        { offset: 5 * 60 * 1000, text: '5 minutes', type: 'warn' },
        { offset: 60 * 1000,      text: '1 minute', type: 'warn' },
        { offset: 0,              text: null,       type: 'start' }
      ].forEach(({ offset, text, type }) => {
        const at = startTime - offset;
        if (at <= now) return;
        const t = setTimeout(() => {
          const msg = (type === 'warn')
            ? `${code} — ${label} starts in ${text}`
            : `Now entering ${code} — ${label}`;
          // Use broadcaster (shows here + other tabs; de-duped)
          broadcastNotice(msg);
          if (type === 'start') lastActivePeriod = period;
          scheduledTimers.delete(t);
        }, at - now);
        scheduledTimers.add(t);
      });
    });

    // Reschedule each midnight ET
    const tomorrowET = new Date(nowET);
    tomorrowET.setDate(tomorrowET.getDate() + 1);
    tomorrowET.setHours(0, 0, 5, 0);
    const midnightDelay = tomorrowET.getTime() - now;
    if (midnightDelay > 0) {
      const m = setTimeout(() => {
        scheduledTimers.delete(m);
        scheduleNotifications();
      }, midnightDelay);
      scheduledTimers.add(m);
    }
  }

  function checkPeriodTransition(){
    const now = getNowET();
    const currentMinute = now.getHours() * 60 + now.getMinutes();
    if (currentMinute === lastCheckedMinute) return;
    lastCheckedMinute = currentMinute;

    const active = detectActivePeriod(currentPeriods);
    if (active && (!lastActivePeriod || lastActivePeriod.code !== active.code)) {
      const label = active.label || active.period_label || active.code || '';
      const code  = active.code  || active.period_code || '';
      broadcastNotice(`Now in ${code} — ${label}`);
      lastActivePeriod = active;
    } else if (!active && lastActivePeriod) {
      lastActivePeriod = null;
    }
  }

  // ---------- Dictionary fetch ----------
  async function refreshFromDictionary(){
    if (!window.API_BASE) {
      try {
        const m = document.querySelector('meta[name="gsds-api-base"]');
        window.API_BASE = (m && m.content || '').trim();
      } catch {}
    }
    const base = window.API_BASE || '';
    if (!base) return [];

    const ctx = (window.GameContext && GameContext.get && GameContext.get()) || {};
    const url = new URL(base);
    url.searchParams.set('action', 'tryout_periods');
    if (ctx.tryout_id) url.searchParams.set('tryout_id', ctx.tryout_id);

    let rows = [];
    try {
      const r = await fetch(url.toString());
      const j = await r.json();
      rows = (j && (j.periods || j.rows || [])) || [];
    } catch(e) {
      console.warn('Failed to fetch periods:', e);
    }

    const periods = rows.map(x => ({
      code:  x.period_code || x.code,
      label: x.label || x.period_label || x.code,
      start: x.start_time || x.start || x.start_local,
      end:   x.end_time   || x.end   || x.end_local
    })).filter(p => p.code && p.start);

    currentPeriods = periods;
    scheduleNotifications();
    lastActivePeriod = detectActivePeriod(periods);

    return periods;
  }

  // ---------- Public API ----------
  window.NoticeScheduler = {
    refreshFromDictionary,
    scheduleNotifications,
    clearTimers: clearScheduledTimers,
    showNotice,
    broadcastNotice,
    checkPeriodTransition,
    detectActivePeriod,
    getCurrentPeriods: () => currentPeriods
  };

  // ---------- Initialization ----------
  ensureHost();

  // Initial load
  setTimeout(() => { refreshFromDictionary().catch(()=>{}); }, 350);

  // Refresh every 3 minutes for sheet changes
  setInterval(() => { refreshFromDictionary().catch(()=>{}); }, 180_000);

  // Period transition checks
  setInterval(checkPeriodTransition, 30_000);
  setInterval(() => { if (getNowET().getSeconds() === 0) checkPeriodTransition(); }, 1000);

  // On visibility regain
  window.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      refreshFromDictionary().catch(()=>{});
      setTimeout(checkPeriodTransition, 100);
    }
  });

  // Re-fetch when tryout_id changes
  try{
    if (window.GameContext && GameContext.subscribe) {
      let debounceTimer;
      GameContext.subscribe((ctx) => {
        if (ctx && typeof ctx.tryout_id === 'string') {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => { refreshFromDictionary().catch(()=>{}); }, 200);
        }
      });
    }
  }catch{}
})();
