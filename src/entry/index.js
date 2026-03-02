/**
 * Entry point: index.html (Home/Login page)
 */
import { bootstrap } from './bootstrap.js';

// Bootstrap the page (auth check disabled for login page itself)
bootstrap({ auth: false });

// Page-specific initialization
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Entry] Index page loaded');
  initLoginOverlay();
});

// Auth configuration
const AUTH_SHEET_ID = '1PcHHdLAJMSV2R_5-uwax172FM7RMnMgA1p9n4VW24lk';
const AUTH_TAB = 'Auth_Users';

const $ = id => document.getElementById(id);

function authIsValid() {
  const ok = localStorage.getItem('auth_ok') === '1';
  const exp = Number(localStorage.getItem('auth_until') || 0);
  return ok && Date.now() < exp;
}

function setAuth(landing, username) {
  localStorage.setItem('auth_ok', '1');
  localStorage.setItem('auth_user', username || '');
  localStorage.setItem('auth_landing', landing || 'index.html');
  localStorage.setItem('auth_until', String(Date.now() + 12 * 60 * 60 * 1000));
}

function clearAuth() {
  ['auth_ok', 'auth_user', 'auth_landing', 'auth_until'].forEach(k => localStorage.removeItem(k));
}

async function loginRequest(username, password) {
  console.log('[Login] API Base:', window.GSDS_API_BASE);
  const url = new URL(window.GSDS_API_BASE);
  url.searchParams.set('action', 'auth_login');
  url.searchParams.set('sheet_id', AUTH_SHEET_ID);
  url.searchParams.set('sheet_name', AUTH_TAB);
  url.searchParams.set('username', username);
  url.searchParams.set('password', password);
  console.log('[Login] URL:', url.toString());
  const r = await fetch(url.toString());
  return r.json();
}

function initLoginOverlay() {
  const ov = $('loginOverlay');
  const frm = $('loginForm');
  const msg = $('loginMsg');
  const user = $('loginUser');

  // Check API config
  if (!window.GSDS_API_BASE) {
    msg.textContent = 'Missing API configuration. Check /js/config.js.';
    msg.className = 'error';
    console.error('[Login] GSDS_API_BASE is not set');
    return;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    msg.className = '';
    msg.textContent = 'Checking…';
    try {
      const u = $('loginUser').value.trim();
      const p = $('loginPass').value.trim();
      if (!u || !p) {
        msg.className = 'error';
        msg.textContent = 'Enter username & password.';
        return;
      }

      const res = await loginRequest(u, p);
      if (!res.ok) {
        msg.className = 'error';
        msg.textContent = res.error || 'Login failed.';
        return;
      }

      setAuth(res.landing, u);

      if (/wellness\.html$/i.test(res.landing)) {
        window.location.href = 'wellness/wellness.html';
      } else {
        ov.style.display = 'none';
        msg.className = 'ok';
        msg.textContent = 'Signed in.';
      }
    } catch (err) {
      msg.className = 'error';
      msg.textContent = 'Error: ' + String(err.message || err);
      console.error('[Login] Error:', err);
    }
  }

  frm.addEventListener('submit', handleSubmit);

  if (window.location.hash === '#logout') {
    clearAuth();
  }
  if (!authIsValid()) {
    clearAuth();
    ov.style.display = 'flex';
    setTimeout(() => user && user.focus(), 0);
  } else {
    ov.style.display = 'none';
  }
}
