// /js/api.js  — resilient GET/POST helpers + Tryout convenience API
(function (g) {
  const state = {
    base: null,
    defaultTimeoutMs: 10000,
    maxRetries: 2, // total attempts = maxRetries + 1
  };

  /** Resolve API base from window vars or <meta name="gsds-api-base" content="..."> */
  function detectBase_() {
    if (state.base) return state.base;
    const meta = document.querySelector('meta[name="gsds-api-base"]');
    state.base = g.GSDS_API_BASE || g.API_BASE || (meta && meta.content) || '';
    return state.base;
  }
  function setBase(url) { state.base = url || ''; return state.base; }
  function getBase() { return detectBase_(); }

  /** Small utils */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function toLocalISO(d) {
    const dt = (d instanceof Date) ? d : new Date(d);
    const pad = (n) => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
  }
  async function fetchWithTimeout_(url, opts, timeoutMs) {
    const ctl = new AbortController();
    const id = setTimeout(() => ctl.abort('timeout'), timeoutMs || state.defaultTimeoutMs);
    try {
      return await fetch(url, { credentials: 'omit', mode: 'cors', signal: ctl.signal, ...opts });
    } finally {
      clearTimeout(id);
    }
  }
  async function parseJsonSafe_(res) {
    const text = await res.text();
    try { return JSON.parse(text || '{}'); }
    catch { return { ok: false, error: 'Bad JSON from server', status: res.status, raw: text }; }
  }

  /** Core GET with cache-bust, retries, and friendly errors */
  async function apiGet(params = {}, opts = {}) {
    const base = getBase();
    if (!base) return { ok: false, error: 'GSDS_API_BASE not set' };

    const url = new URL(base);
    Object.entries(params).forEach(([k, v]) => {
      if (Array.isArray(v)) v.forEach((iv) => url.searchParams.append(k, iv));
      else if (v !== undefined && v !== null) url.searchParams.set(k, v);
    });
    url.searchParams.set('_', Date.now()); // bust cache

    const tries = (opts.retry == null ? state.maxRetries : opts.retry) + 1;
    let lastErr = null;

    for (let i = 0; i < tries; i++) {
      try {
        const res = await fetchWithTimeout_(url.toString(), {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
        }, opts.timeoutMs);

        const data = await parseJsonSafe_(res);
        if (!res.ok) {
          if (i < tries - 1 && (res.status >= 500 || res.status === 429)) {
            await sleep(300 * (i + 1));
            continue;
          }
          return data.ok !== undefined ? data : { ok: false, error: `HTTP ${res.status}`, status: res.status, ...data };
        }
        return (typeof data === 'object' && data) ? data : { ok: false, error: 'Empty response' };
      } catch (err) {
        lastErr = err;
        if (i < tries - 1) { await sleep(300 * (i + 1)); continue; }
        return { ok: false, error: String(err && err.message || err) };
      }
    }
    return { ok: false, error: String(lastErr || 'unknown error') };
  }

  /** Core POST with *simple* headers (no preflight), retries, and friendly errors */
  async function apiPost(payload = {}, opts = {}) {
    const base = getBase();
    if (!base) return { ok: false, error: 'GSDS_API_BASE not set' };

    const tries = (opts.retry == null ? state.maxRetries : opts.retry) + 1;
    let lastErr = null;

    for (let i = 0; i < tries; i++) {
      try {
        const res = await fetchWithTimeout_(base, {
          method: 'POST',
          headers: {
            // Keep headers SIMPLE to avoid CORS preflight:
            'Content-Type': 'text/plain',
            'Accept': 'application/json',
          },
          body: JSON.stringify(payload),
        }, opts.timeoutMs);

        const data = await parseJsonSafe_(res);
        if (!res.ok) {
          if (i < tries - 1 && (res.status >= 500 || res.status === 429)) {
            await sleep(300 * (i + 1)); continue;
          }
          return data.ok !== undefined ? data : { ok: false, status: res.status, ...data };
        }
        return (typeof data === 'object' && data) ? data : { ok: false, error: 'Empty response' };
      } catch (err) {
        lastErr = err;
        if (i < tries - 1) { await sleep(300 * (i + 1)); continue; }
        return { ok: false, error: String(err && err.message || err) };
      }
    }
    return { ok: false, error: String(lastErr || 'unknown error') };
  }

  /** Base convenience */
  function table({ sheet_id, sheet_name }) {
    return apiGet({ action: 'table', sheet_id, sheet_name });
  }
  function nextId(prefix) { return apiGet({ action: 'next_id', prefix }); }
  function append(route, row, ensure_headers, idempotency_key) {
    return apiPost({ action: 'append', route, row, ensure_headers, idempotency_key });
  }

  /* ============================
   * TRYOUT HELPERS (new)
   * ============================ */

  // Canonical column sets (server will create missing headers in this order)
  const TRYOUT_HEADERS = {
    AGILITY: [
      'timestamp','tryout_id','period_code','tryout_num','player_id','group_code',
      'station_id','drill_id','lane','attempt','time_sec','cone_hit','dnf','best_flag','notes'
    ],
    STATION: [
      'timestamp','tryout_id','period_code','player_id','group_code',
      'station_id','drill_id','attempt','metric_1','metric_2','errors_count','pass_flag','score_5','notes'
    ],
    ONEVONE: [
      'timestamp','tryout_id','period_code',
      'offense_id','offense_group',
      'defense_id','defense_group',
      'qb_id',
      'matchup_type','route_or_rush','targeted','catch','pbu','int',
      'separation_1_5','time_to_pressure_sec','win_side','yards_est','notes'
    ],
    TEAM: [
      'timestamp','tryout_id','period_code','station_id','rep_id','unit','qb_id','runner_id','receiver_id',
      'offense_group','defense_group','result','catch','pbu','int','tfl','missed_tkl','gain_yards','notes'
    ]
  };

  /* -------------------------------------------------------------
   * Tryout utilities: roster/group cache + attachment helpers
   * ------------------------------------------------------------- */
  const _tryoutCache = {
    tryout_id: '',
    rosterById: new Map(),   // player_id -> roster row (01_Dim_Tryout_Roster)
    latestGroup: new Map(),  // player_id -> group_code (03_Map_Tryout_Groups latest)
    loaded: false
  };

  async function getTryoutRoster(){ return apiGet({ action:'tryout_roster' }); }
  async function getTryoutPeriods(tryout_id){
    const p = { action:'tryout_periods' };
    if (tryout_id) p.tryout_id = tryout_id;
    return apiGet(p);
  }
  async function getTryoutDrillDict(){ return apiGet({ action:'tryout_drilldict' }); }
  async function getTryoutGroupsLatest(tryout_id){
    const p = { action:'tryout_groups_get', latest:1 };
    if (tryout_id) p.tryout_id = tryout_id;
    return apiGet(p);
  }
  function setTryoutGroups(assignments){
    return apiPost({ action:'tryout_groups_set', assignments:Array.isArray(assignments)?assignments:[assignments] });
  }

  async function _ensureRoster_(){
    if (_tryoutCache.rosterById.size) return;
    const res = await getTryoutRoster();
    if (res && res.ok) {
      const map = new Map();
      (res.roster || []).forEach(r => map.set(String(r.player_id), r));
      _tryoutCache.rosterById = map;
    }
  }

  async function refreshGroupIndex(tryout_id){
    _tryoutCache.tryout_id = tryout_id || _tryoutCache.tryout_id || '';
    await _ensureRoster_();
    const res = await getTryoutGroupsLatest(_tryoutCache.tryout_id);
    const map = new Map();
    if (res && res.ok) (res.latest || []).forEach(r => {
      const pid = String(r.player_id||'');
      const g   = String(r.group_code||'').toUpperCase();
      if (pid) map.set(pid, g);
    });
    _tryoutCache.latestGroup = map;
    _tryoutCache.loaded = true;
    return { ok:true, count: map.size };
  }

  // Persist an on-the-day assignment; refresh cache after write
  async function assignPlayerGroup({ tryout_id, player_id, group_code, start_time, end_time, notes }){
    const row = {
      tryout_id,
      player_id,
      group_code,
      start_time: start_time || toLocalISO(new Date()),
      end_time: end_time || '',
      notes: notes || 'manual'
    };
    const r = await setTryoutGroups(row);
    if (r && r.ok) await refreshGroupIndex(tryout_id);
    return r;
  }

  // Resolve a player's group:
  // latest assignment → roster.group_code → roster.primary_pos → fallback
  function groupFor(player_id, { fallback='' } = {}){
    const pid = String(player_id||'');
    if (!pid) return fallback;

    const gLatest = _tryoutCache.latestGroup.get(pid);
    if (gLatest) return gLatest;

    const r = _tryoutCache.rosterById.get(pid);
    if (r) {
      const gRoster = (r.group_code || '').toString().trim();
      if (gRoster) return gRoster.toUpperCase();
      const pos = (r.primary_pos || '').toString().trim();
      if (pos) return pos.toUpperCase();
    }
    return fallback;
  }

  // Attach inferred group info to outgoing rows.
  function attachGroup(rowOrRows, { fallback='' } = {}){
    const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];

    rows.forEach(r => {
      const hasSingle = !!r.player_id;
      const isOneVOne = !!(r.offense_id || r.defense_id);
      const isTeam    = !!(r.qb_id || r.runner_id || r.receiver_id || r.defender_id);

      if (hasSingle && !r.group_code) {
        r.group_code = groupFor(r.player_id, { fallback });
      }

      if (isOneVOne) {
        if (!r.offense_group && r.offense_id) r.offense_group = groupFor(r.offense_id, { fallback });
        if (!r.defense_group && r.defense_id) r.defense_group = groupFor(r.defense_id, { fallback });
      }

      if (isTeam) {
        if (!r.offense_group) {
          const offPid = r.receiver_id || r.runner_id || r.qb_id;
          if (offPid) r.offense_group = groupFor(offPid, { fallback });
        }
        if (!r.defense_group && r.defender_id) {
          r.defense_group = groupFor(r.defender_id, { fallback });
        }
      }
    });

    return Array.isArray(rowOrRows) ? rows : rows[0];
  }

  // Build a stable-ish idempotency key for append writes
  function makeIdemKey_(route, row){
    const parts = [
      route,
      row.tryout_id || '',
      row.period_code || '',
      row.player_id || row.offense_id || row.qb_id || '',
      row.station_id || '',
      row.drill_id || '',
      row.lane || '',
      row.attempt || '',
      row.time_sec || '',
      row.matchup_type || '',
      row.rep_id || ''
    ];
    return parts.join('|').replace(/\s+/g,' ');
  }

  /* ============================
   * Writers (attachGroup + idempotency)
   * ============================ */
  function tryoutAgility(row){
    const r = attachGroup({ ...row });
    const key = makeIdemKey_('tryout_agility', r);
    return append('tryout_agility', r, TRYOUT_HEADERS.AGILITY, key);
  }
  function tryoutStation(row){
    const r = attachGroup({ ...row });
    const key = makeIdemKey_('tryout_station', r);
    return append('tryout_station', r, TRYOUT_HEADERS.STATION, key);
  }
  function tryout1v1(row){
    const r = attachGroup({ ...row });
    const key = makeIdemKey_('tryout_1v1', r);
    return append('tryout_1v1', r, TRYOUT_HEADERS.ONEVONE, key);
  }
  function tryoutTeam(row){
    const r = attachGroup({ ...row });
    const key = makeIdemKey_('tryout_team', r);
    return append('tryout_team', r, TRYOUT_HEADERS.TEAM, key);
  }

  /* ============================
   * Readers + Presence
   * ============================ */
  function presenceGet({ tryout_id, group }){
    const p = { action:'presence_get' };
    if (tryout_id) p.tryout_id = tryout_id;
    if (group) p.group = group;
    return apiGet(p);
  }
  function presenceSet({ tryout_id, group, players, meta }){
    return apiPost({ action:'presence_set', tryout_id, group, players, meta });
  }

  /** Expose */
  g.apiGet = apiGet;
  g.apiPost = apiPost;
  g.toLocalISO = toLocalISO;
  g.API = {
    getBase, setBase,
    apiGet, apiPost,
    table, nextId, append,
    toLocalISO,
    tryout: {
      headers: TRYOUT_HEADERS,
      write: { agility: tryoutAgility, station: tryoutStation, onevone: tryout1v1, team: tryoutTeam },
      read: { roster: getTryoutRoster, periods: getTryoutPeriods, drills: getTryoutDrillDict, groupsLatest: getTryoutGroupsLatest },
      groups: { set: setTryoutGroups },
      util: {
        refreshGroupIndex,
        assignPlayerGroup,
        groupFor,
        attachGroup
      }
    },
    config: state,
  };
})(window);
