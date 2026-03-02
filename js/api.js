// /js/api.js — Unified API layer (Phase 1)
// Single entry point for ALL network calls with consistent timeout, retry, and response shaping
(function (g) {
  'use strict';

  // ============================================================================
  // DEFAULTS — Single place to tune behavior app-wide
  // ============================================================================
  const DEFAULTS = {
    timeoutMs: g.GSDS_API_TIMEOUT_MS ?? 8000,
    retries: g.GSDS_API_RETRIES ?? 2,          // total attempts = 1 + retries
    retryDelayMs: g.GSDS_API_RETRY_DELAY_MS ?? 400,
    backoffMultiplier: 2,
    debug: g.GSDS_DEBUG === true
  };

  // ============================================================================
  // Internal state
  // ============================================================================
  const state = {
    base: null,
    lastError: null
  };

  // ============================================================================
  // Utils
  // ============================================================================
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (...args) => { if (DEFAULTS.debug) console.log('[API]', ...args); };
  const warn = (...args) => { if (DEFAULTS.debug) console.warn('[API]', ...args); };

  function detectBase_() {
    if (state.base) return state.base;
    state.base = g.GSDS_API_BASE || g.API_BASE || '';
    return state.base;
  }
  function setBase(url) { state.base = url || ''; return state.base; }
  function getBase() { return detectBase_(); }

  function toLocalISO(d) {
    const dt = (d instanceof Date) ? d : new Date(d);
    const pad = (n) => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
  }

  // ============================================================================
  // Auth token management
  // ============================================================================
  const AUTH_TOKEN_KEY = 'gsds_auth_token';
  const AUTH_USER_KEY = 'gsds_auth_user';

  function getAuthToken() {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  }

  function setAuthToken(token) {
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
    else localStorage.removeItem(AUTH_TOKEN_KEY);
  }

  function setAuthUser(user) {
    if (user) localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(AUTH_USER_KEY);
  }

  function getAuthUser() {
    try {
      const json = localStorage.getItem(AUTH_USER_KEY);
      return json ? JSON.parse(json) : null;
    } catch { return null; }
  }

  function clearAuth() {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    localStorage.removeItem('auth_ok');
    localStorage.removeItem('auth_until');
  }

  function isAuthenticated() {
    const token = getAuthToken();
    const user = getAuthUser();
    if (!token || !user) return false;
    if (user.expires_at && new Date(user.expires_at) < new Date()) {
      clearAuth();
      return false;
    }
    return true;
  }

  // ============================================================================
  // Idempotency key generation
  // ============================================================================
  function makeIdempotencyKey(prefix = 'idmp') {
    // Generate a unique key with timestamp and random component
    // This should be called once per logical user action and reused for retries
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }

  // ============================================================================
  // Core request — THE single network entry point (Phase 3: with auth)
  // ============================================================================
  async function request(payload = {}, opts = {}) {
    const base = getBase();
    if (!base) {
      const err = { code: 'CONFIG_MISSING', message: 'Missing GSDS_API_BASE. Check js/config.js.', status: 0, detail: null };
      state.lastError = err;
      return { ok: false, data: null, error: err };
    }

    const method = (opts.method || 'POST').toUpperCase();
    const asQuery = opts.asQuery === true || method === 'GET';
    const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
    const maxRetries = opts.retries ?? DEFAULTS.retries;
    const retryDelayMs = opts.retryDelayMs ?? DEFAULTS.retryDelayMs;
    const backoffMultiplier = opts.backoffMultiplier ?? DEFAULTS.backoffMultiplier;

    // Attach auth token to all requests except auth_login
    if (payload.action !== 'auth_login') {
      const token = getAuthToken();
      if (token) {
        payload.auth_token = token;
      }
    }

    let url;
    if (asQuery) {
      url = new URL(base);
      Object.entries(payload).forEach(([k, v]) => {
        if (v === undefined || v === null) return;
        if (Array.isArray(v)) v.forEach((iv) => url.searchParams.append(k, iv));
        else url.searchParams.set(k, v);
      });
      url.searchParams.set('_', Date.now());
    } else {
      url = new URL(base);
    }

    const urlString = url.toString();
    let lastErr = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const ctl = new AbortController();
      const timeoutId = setTimeout(() => ctl.abort('timeout'), timeoutMs);

      try {
        let res;
        if (asQuery) {
          res = await fetch(urlString, { method: 'GET', credentials: 'omit', signal: ctl.signal });
        } else {
          res = await fetch(urlString, {
            method: 'POST',
            credentials: 'omit',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload),
            signal: ctl.signal
          });
        }
        clearTimeout(timeoutId);

        let data = null;
        let parseError = null;
        try {
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('application/json')) { data = await res.json(); }
          else {
            const text = await res.text();
            try { data = JSON.parse(text); } catch (e) { parseError = e; data = text; }
          }
        } catch (e) { parseError = e; }

        // Handle auth errors
        if (data?.error?.code === 'AUTH_REQUIRED' || data?.error?.code === 'TOKEN_EXPIRED') {
          clearAuth();
          const authError = {
            code: data.error.code,
            message: 'Session expired. Please log in again.',
            status: 401,
            detail: data
          };
          state.lastError = authError;
          // Trigger redirect to login if not already there
          if (typeof window !== 'undefined' && !window.location.href.includes('index.html')) {
            window.location.href = '../index.html#login';
          }
          return { ok: false, data: null, error: authError };
        }

        // Handle forbidden errors
        if (data?.error?.code === 'FORBIDDEN') {
          const forbiddenError = {
            code: 'FORBIDDEN',
            message: data.error.message || 'You do not have permission for this action.',
            status: 403,
            detail: data
          };
          state.lastError = forbiddenError;
          return { ok: false, data: null, error: forbiddenError };
        }

        let ok = res.ok;
        if (ok && typeof data === 'object' && data !== null) {
          if (data.ok === false || data.error) ok = false;
        }

        if (ok) {
          log('success', { method, url: urlString, data });
          return { ok: true, data, error: null };
        }

        const status = res.status;
        const isRetryable = (status === 429 || (status >= 500 && status < 600) || parseError !== null);

        if (!isRetryable || attempt >= maxRetries) {
          const error = {
            code: parseError ? 'PARSE_ERROR' : (data?.error?.code || `HTTP_${status}`),
            message: parseError ? `Failed to parse response: ${parseError.message}` : (data?.error?.message || data?.error || `Request failed with status ${status}`),
            status,
            detail: data
          };
          state.lastError = error;
          warn('error', { method, url: urlString, status, error });
          return { ok: false, data: null, error };
        }

        lastErr = new Error(`HTTP ${status}`);
        warn('retry', { attempt, delay: retryDelayMs * Math.pow(backoffMultiplier, attempt) });
        await sleep(retryDelayMs * Math.pow(backoffMultiplier, attempt));
      } catch (err) {
        clearTimeout(timeoutId);
        lastErr = err;
        const isRetryable = err.name === 'AbortError' || err.message?.includes('timeout');
        if (!isRetryable || attempt >= maxRetries) {
          const error = {
            code: err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
            message: err.name === 'AbortError' ? `Request timed out after ${timeoutMs}ms` : (err.message || 'Network request failed'),
            status: 0,
            detail: err
          };
          state.lastError = error;
          warn('error', { method, url: urlString, error });
          return { ok: false, data: null, error };
        }
        warn('retry', { attempt, delay: retryDelayMs * Math.pow(backoffMultiplier, attempt), error: err.message });
        await sleep(retryDelayMs * Math.pow(backoffMultiplier, attempt));
      }
    }

    const error = { code: 'MAX_RETRIES_EXCEEDED', message: lastErr?.message || 'Request failed after maximum retries', status: 0, detail: lastErr };
    state.lastError = error;
    return { ok: false, data: null, error };
  }

  // ============================================================================
  // Convenience wrappers
  // ============================================================================
  function get(params = {}, opts = {}) { return request(params, { ...opts, method: 'GET' }); }
  function post(payload = {}, opts = {}) { return request(payload, { ...opts, method: 'POST' }); }

  // ============================================================================
  // Legacy compatibility — route through request()
  // ============================================================================
  async function apiGet(params = {}, opts = {}) {
    const res = await request(params, { ...opts, method: 'GET' });
    if (res.ok) return res.data;
    return { ok: false, error: res.error.message, status: res.error.status, ...res.error.detail };
  }

  async function apiPost(payload = {}, opts = {}) {
    const res = await request(payload, { ...opts, method: 'POST' });
    if (res.ok) return res.data;
    return { ok: false, error: res.error.message, status: res.error.status, ...res.error.detail };
  }

  // ============================================================================
  // Common action wrappers (routed through request)
  // ============================================================================
  function table({ sheet_id, sheet_name }) { return request({ action: 'table', sheet_id, sheet_name }, { method: 'GET' }); }
  function nextId(prefix) { return request({ action: 'next_id', prefix }, { method: 'GET' }); }
  function append(route, row, ensure_headers, idempotency_key) { return request({ action: 'append', route, row, ensure_headers, idempotency_key }); }
  function authLogin({ sheet_id, sheet_name, username, password }) {
    return request({ action: 'auth_login', sheet_id, sheet_name, username, password }, { method: 'GET' })
      .then(res => {
        if (res.ok && res.data?.token) {
          // Store token and user info
          setAuthToken(res.data.token);
          setAuthUser({
            user_id: res.data.user_id,
            username: res.data.username,
            role: res.data.role,
            expires_at: res.data.expires_at
          });
          // Also set legacy auth flags for compatibility
          localStorage.setItem('auth_ok', '1');
          localStorage.setItem('auth_until', String(Date.now() + 12 * 60 * 60 * 1000)); // 12 hours
        }
        return res;
      });
  }
  function ctxGet() { return request({ action: 'ctx_get' }, { method: 'GET' }); }
  function ctxSet(ctx) { return request({ action: 'ctx_set', game_id: ctx.game_id || '', drive_id: ctx.drive_id || '', play_id: ctx.play_id || '', tryout_id: ctx.tryout_id || '', station_id: ctx.station_id || '', rep_id: ctx.rep_id || '' }); }
  function presenceGet({ tryout_id, group } = {}) {
    const params = { action: 'presence_get' };
    if (tryout_id) params.tryout_id = tryout_id;
    if (group) params.group = group;
    return request(params, { method: 'GET' });
  }
  function presenceSet({ tryout_id, group, players, meta }) { return request({ action: 'presence_set', tryout_id, group, players, meta }); }

  // ============================================================================
  // Tryout helpers (unchanged API surface, routed through request)
  // ============================================================================
  const TRYOUT_HEADERS = {
    AGILITY: ['timestamp','tryout_id','period_code','tryout_num','player_id','group_code','station_id','drill_id','lane','attempt','time_sec','cone_hit','dnf','best_flag','notes'],
    STATION: ['timestamp','tryout_id','period_code','player_id','group_code','station_id','drill_id','attempt','metric_1','metric_2','errors_count','pass_flag','score_5','notes'],
    ONEVONE: ['timestamp','tryout_id','period_code','offense_id','offense_group','defense_id','defense_group','qb_id','matchup_type','route_or_rush','targeted','catch','pbu','int','separation_1_5','time_to_pressure_sec','win_side','yards_est','notes'],
    TEAM: ['timestamp','tryout_id','period_code','station_id','rep_id','unit','qb_id','runner_id','receiver_id','offense_group','defense_group','result','catch','pbu','int','tfl','missed_tkl','gain_yards','notes']
  };

  const _tryoutCache = { tryout_id: '', rosterById: new Map(), latestGroup: new Map(), loaded: false };

  async function getTryoutRoster() {
    const res = await request({ action: 'tryout_roster' }, { method: 'GET' });
    if (res.ok) _tryoutCache.rosterById.clear();
    return res;
  }
  async function getTryoutPeriods(tryout_id) { const p = { action: 'tryout_periods' }; if (tryout_id) p.tryout_id = tryout_id; return request(p, { method: 'GET' }); }
  async function getTryoutDrillDict() { return request({ action: 'tryout_drilldict' }, { method: 'GET' }); }
  async function getTryoutGroupsLatest(tryout_id) { const p = { action: 'tryout_groups_get', latest: 1 }; if (tryout_id) p.tryout_id = tryout_id; return request(p, { method: 'GET' }); }
  function setTryoutGroups(assignments) { return request({ action: 'tryout_groups_set', assignments: Array.isArray(assignments) ? assignments : [assignments] }); }

  async function _ensureRoster_() {
    if (_tryoutCache.rosterById.size) return;
    const res = await getTryoutRoster();
    if (res.ok) { const map = new Map(); (res.data?.roster || []).forEach(r => map.set(String(r.player_id), r)); _tryoutCache.rosterById = map; }
  }
  async function refreshGroupIndex(tryout_id) {
    _tryoutCache.tryout_id = tryout_id || _tryoutCache.tryout_id || '';
    await _ensureRoster_();
    const res = await getTryoutGroupsLatest(_tryoutCache.tryout_id);
    const map = new Map();
    if (res.ok) { (res.data?.latest || []).forEach(r => { const pid = String(r.player_id || ''); const g = String(r.group_code || '').toUpperCase(); if (pid) map.set(pid, g); }); }
    _tryoutCache.latestGroup = map; _tryoutCache.loaded = true;
    return { ok: res.ok, count: map.size, error: res.error };
  }
  async function assignPlayerGroup({ tryout_id, player_id, group_code, start_time, end_time, notes }) {
    const row = { tryout_id, player_id, group_code, start_time: start_time || toLocalISO(new Date()), end_time: end_time || '', notes: notes || 'manual' };
    const r = await setTryoutGroups(row);
    if (r.ok) await refreshGroupIndex(tryout_id);
    return r;
  }
  function groupFor(player_id, { fallback = '' } = {}) {
    const pid = String(player_id || '');
    if (!pid) return fallback;
    const gLatest = _tryoutCache.latestGroup.get(pid);
    if (gLatest) return gLatest;
    const r = _tryoutCache.rosterById.get(pid);
    if (r) { const gRoster = (r.group_code || '').toString().trim(); if (gRoster) return gRoster.toUpperCase(); const pos = (r.primary_pos || '').toString().trim(); if (pos) return pos.toUpperCase(); }
    return fallback;
  }
  function attachGroup(rowOrRows, { fallback = '' } = {}) {
    const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
    rows.forEach(r => {
      const hasSingle = !!r.player_id; const isOneVOne = !!(r.offense_id || r.defense_id); const isTeam = !!(r.qb_id || r.runner_id || r.receiver_id || r.defender_id);
      if (hasSingle && !r.group_code) r.group_code = groupFor(r.player_id, { fallback });
      if (isOneVOne) { if (!r.offense_group && r.offense_id) r.offense_group = groupFor(r.offense_id, { fallback }); if (!r.defense_group && r.defense_id) r.defense_group = groupFor(r.defense_id, { fallback }); }
      if (isTeam) { if (!r.offense_group) { const offPid = r.receiver_id || r.runner_id || r.qb_id; if (offPid) r.offense_group = groupFor(offPid, { fallback }); } if (!r.defense_group && r.defender_id) r.defense_group = groupFor(r.defender_id, { fallback }); }
    });
    return Array.isArray(rowOrRows) ? rows : rows[0];
  }
  function makeIdemKey_(route, row) {
    const parts = [route, row.tryout_id || '', row.period_code || '', row.player_id || row.offense_id || row.qb_id || '', row.station_id || '', row.drill_id || '', row.lane || '', row.attempt || '', row.time_sec || '', row.matchup_type || '', row.rep_id || ''];
    return parts.join('|').replace(/\s+/g, ' ');
  }
  function tryoutAgility(row) { const r = attachGroup({ ...row }); const key = makeIdemKey_('tryout_agility', r); return append('tryout_agility', r, TRYOUT_HEADERS.AGILITY, key); }
  function tryoutStation(row) { const r = attachGroup({ ...row }); const key = makeIdemKey_('tryout_station', r); return append('tryout_station', r, TRYOUT_HEADERS.STATION, key); }
  function tryout1v1(row) { const r = attachGroup({ ...row }); const key = makeIdemKey_('tryout_1v1', r); return append('tryout_1v1', r, TRYOUT_HEADERS.ONEVONE, key); }
  function tryoutTeam(row) { const r = attachGroup({ ...row }); const key = makeIdemKey_('tryout_team', r); return append('tryout_team', r, TRYOUT_HEADERS.TEAM, key); }

  // ============================================================================
  // Expose
  // ============================================================================
  g.apiGet = apiGet;
  g.apiPost = apiPost;
  g.toLocalISO = toLocalISO;
  g.makeIdempotencyKey = makeIdempotencyKey;
  g.API = {
    request, get, post,
    DEFAULTS,
    getBase, setBase,
    apiGet, apiPost,
    table, nextId, append,
    ctxGet, ctxSet,
    presenceGet, presenceSet,
    authLogin,
    // Auth helpers
    getAuthToken, setAuthToken, getAuthUser, setAuthUser, clearAuth, isAuthenticated,
    // Idempotency
    makeIdempotencyKey,
    tryout: {
      headers: TRYOUT_HEADERS,
      write: { agility: tryoutAgility, station: tryoutStation, onevone: tryout1v1, team: tryoutTeam },
      read: { roster: getTryoutRoster, periods: getTryoutPeriods, drills: getTryoutDrillDict, groupsLatest: getTryoutGroupsLatest },
      groups: { set: setTryoutGroups },
      util: { refreshGroupIndex, assignPlayerGroup, groupFor, attachGroup }
    },
    _debug: { get lastError() { return state.lastError; } }
  };
})(window);
