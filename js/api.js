<!-- Save as /js/api.js -->
<script type="module">
export const API_BASE =
  window.API_BASE ||
  'https://script.google.com/macros/s/AKfycbxQk6BgJLkZltXX7xijq9QKmTEfB51M65cHzrYCe6SCTykrSWnFDMecXfiLGRTd9iOCLg/exec';

/** Local ISO string (no trailing 'Z') */
export function toLocalISO(d = new Date()) {
  const dt = new Date(d);
  const pad = n => String(n).padStart(2,'0');
  return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
}

export async function apiGet(params = {}) {
  const url = new URL(API_BASE);
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, v));
  const r = await fetch(url.toString(), { method: 'GET' });
  return r.json();
}

export async function apiPost(payload = {}) {
  const r = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // no preflight
    body: JSON.stringify(payload)
  });
  return r.json();
}

/** Lightweight page logger: writes to #log if present, else console */
export function log(msg, type='') {
  const el = document.getElementById('log');
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  if (!el) { (type==='error'?console.error:console.log)(line); return; }
  const row = document.createElement('div');
  row.textContent = line;
  if (type==='error') row.style.color = '#ff6b6b';
  if (type==='success') row.style.color = '#7CFC98';
  el.prepend(row);
}
</script>
