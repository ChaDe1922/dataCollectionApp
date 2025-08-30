// /js/api.js  (pure JS)
(function(g){
  const BASE = () => g.GSDS_API_BASE || g.API_BASE || '';

  function toLocalISO(d){
    const dt = (d instanceof Date) ? d : new Date(d);
    const pad = n => String(n).padStart(2,'0');
    return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
  }

  async function apiGet(params){
    const base = BASE(); if(!base) throw new Error('GSDS_API_BASE not set');
    const url = new URL(base);
    Object.entries(params||{}).forEach(([k,v])=>url.searchParams.set(k,v));
    const r = await fetch(url.toString(), { method:'GET', credentials:'omit' });
    return r.json();
  }

  async function apiPost(payload){
    const base = BASE(); if(!base) throw new Error('GSDS_API_BASE not set');
    const r = await fetch(base, {
      method:'POST',
      headers:{ 'Content-Type':'text/plain;charset=utf-8' }, // avoid preflight
      body: JSON.stringify(payload),
      credentials:'omit'
    });
    return r.json();
  }

  g.apiGet = apiGet;
  g.apiPost = apiPost;
  g.toLocalISO = toLocalISO;
  g.API = { apiGet, apiPost, toLocalISO };
})(window);
