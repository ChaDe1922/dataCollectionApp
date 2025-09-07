// /js/api.js  (pure JS) — resilient GET/POST helpers + small convenience API
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
    catch (e) { return { ok: false, error: 'Bad JSON from server', status: res.status, raw: text }; }
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
    // cache-bust GETs so dropdowns/playbook refresh reliably
    url.searchParams.set('_', Date.now());

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
            await sleep(300 * (i + 1)); // backoff
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

  /** Core POST with no-preflight content-type, retries, and friendly errors */
  async function apiPost(payload = {}, opts = {}) {
    const base = getBase();
    if (!base) return { ok: false, error: 'GSDS_API_BASE not set' };

    const tries = (opts.retry == null ? state.maxRetries : opts.retry) + 1;
    let lastErr = null;

    for (let i = 0; i < tries; i++) {
      try {
        const res = await fetchWithTimeout_(base, {
          method: 'POST',
          // Keep text/plain to avoid CORS preflight; server should JSON.parse the body
          headers: {
            'Content-Type': 'text/plain;charset=utf-8',
            'Accept': 'application/json',
            'X-GSDS-Client': 'web',
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

  /** Convenience helpers for your routes/endpoints */
  function table({ sheet_id, sheet_name }) {
    return apiGet({ action: 'table', sheet_id, sheet_name });
  }
  function nextId(prefix) {
    return apiGet({ action: 'next_id', prefix });
  }
  function append(route, row, ensure_headers, idempotency_key) {
    return apiPost({ action: 'append', route, row, ensure_headers, idempotency_key });
  }

  /** Expose (backward compatible) */
  g.apiGet = apiGet;
  g.apiPost = apiPost;
  g.toLocalISO = toLocalISO;
  g.API = {
    getBase, setBase,
    apiGet, apiPost,
    table, nextId, append,
    toLocalISO,
    config: state,
  };
})(window);
