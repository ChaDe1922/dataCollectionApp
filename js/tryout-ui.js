// /js/tryout-ui.js — Phase 4 shared UI (top bar, filter, roster chips, write log, selection + recorded indicator)
(function (g) {
  const TU = {
    el: null,
    roster: [],
    groups: [],
    bands: [],           // [{label,min,max}]
    filtered: [],
    presentIds: new Set(),

    // selection + filtering state
    selectedGroup: 'ALL',
    selectedBand: 'ALL',
    searchTerm: '',
    hideDone: false,           // NEW: toggle to hide recorded
    doneIds: new Set(),        // NEW: players recorded this session

    // options
    config: {
      showGroup: true,            // show group in ctx badge
      filterMode: 'groups',       // 'groups' | 'numberBands'
      allowPresence: true,        // Save/Load Presence UI
      clickSelects: true,         // click = select; Alt/Option-click toggles presence
      showHideDoneToggle: true    // NEW: show "Hide recorded" chip
    },

    // selection & callbacks
    selected: null,
    onSelectCb: null,

    // logging
    logItems: [],
    logLimit: 5,

    pollId: null
  };

  /* ---------- tiny CSS (scoped) ---------- */
  const CSS = `
  .tu-wrap{margin:10px 0}
  .tu-top{display:flex;gap:10px;align-items:center;justify-content:space-between;
          background:rgba(255,255,255,.06);border:1px solid var(--border);
          border-radius:14px;padding:10px 12px}
  .tu-top .ctx{font-weight:700}
  .tu-top .ctx span{opacity:.9}
  .tu-top .ctx b{font-weight:800}
  .tu-top .actions{display:flex;gap:8px;flex-wrap:wrap}
  .tu-top .actions .btn{font-weight:700;font-size:12px;padding:8px 10px;border-radius:10px;border:1px solid var(--border);background:#2a2a39;color:#fff}
  .tu-top .actions .btn[disabled]{opacity:.5;cursor:not-allowed}

  .tu-filter{display:flex;gap:10px;align-items:center;margin:10px 0 8px;flex-wrap:wrap}
  .tu-chips{display:flex;gap:8px;flex-wrap:wrap}
  .tu-chip{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;
           background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.20);cursor:pointer;
           font-weight:700;font-size:12px;color:#fff}
  .tu-chip[aria-pressed="true"]{background:#43b581;color:#071a12;border-color:#43b581}
  .tu-search{margin-left:auto}
  .tu-search input{height:36px;border-radius:10px;border:1px solid var(--border);
                   background:#1d1d29;color:#fff;padding:0 10px;min-width:180px}

  .tu-roster{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px}
  .tu-player{position:relative;display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:12px;border:1px solid var(--border);
             background:rgba(255,255,255,.05);cursor:pointer;min-width:180px;transition:transform .12s ease, background .12s ease, opacity .12s ease}
  .tu-player:hover{transform:translateY(-1px);background:rgba(255,255,255,.08)}
  .tu-player.selected{outline:2px solid #8B5CF6; outline-offset:2px; background:rgba(139,92,246,.14)}
  .tu-num{font-weight:800;font-size:18px;min-width:34px;text-align:center;line-height:1}
  .tu-name{font-weight:700}
  .tu-pos{opacity:.8;font-size:12px}
  .tu-player.present{background:rgba(67,181,129,.14);border-color:#43b581}

  /* NEW: recorded styling */
  .tu-player.done{opacity:.55}
  .tu-player.done::after{
    content:'✓';
    position:absolute; right:8px; top:8px;
    width:18px; height:18px; border-radius:999px;
    background:#43b581; color:#071a12; font-weight:900; font-size:12px;
    display:flex; align-items:center; justify-content:center;
    box-shadow:0 0 0 2px rgba(0,0,0,.25);
  }

  .tu-hint{opacity:.75;font-size:12px;margin-left:6px}

  .tu-log{margin-top:12px;background:rgba(255,255,255,.05);border:1px solid var(--border);
          border-radius:12px;padding:8px 10px}
  .tu-log h4{margin:0 0 6px 0;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#c7c9da}
  .tu-log ul{margin:0;padding-left:18px}
  .tu-log li{margin:4px 0}
  `;

  function injectCss_() {
    if (document.getElementById('tu-css')) return;
    const s = document.createElement('style');
    s.id = 'tu-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function h_(html){ const d=document.createElement('div'); d.innerHTML=html.trim(); return d.firstElementChild; }
  const escHtml_ = (s)=> String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  /* ---------- DOM skeleton ---------- */
  function renderShell_(mount) {
    const el = h_(`
      <section class="tu-wrap">
        <div class="tu-top">
          <div class="ctx" id="tuCtx"></div>
          <div class="actions" id="tuActions">
            <button class="btn" id="tuLoadPres">Load Presence</button>
            <button class="btn" id="tuSavePres">Save Presence</button>
            <span class="tu-hint" id="tuPresHint"></span>
          </div>
        </div>

        <div class="tu-filter">
          <div class="tu-chips" id="tuChips"></div>
          <button class="tu-chip" id="tuHideDone" style="display:none">Hide recorded</button>
          <div class="tu-search">
            <input id="tuSearch" type="search" placeholder="Search name/#…"/>
          </div>
        </div>

        <div class="tu-roster" id="tuRoster"></div>

        <div class="tu-log">
          <h4>Recent writes</h4>
          <ul id="tuLogList"></ul>
        </div>
      </section>
    `);
    mount.innerHTML = '';
    mount.appendChild(el);
    TU.el = el;

    // wire search
    el.querySelector('#tuSearch').addEventListener('input', (e)=>{
      TU.searchTerm = (e.target.value||'').trim();
      applyFilter_();
    });

    // recorded toggle
    if (TU.config.showHideDoneToggle) {
      const btn = el.querySelector('#tuHideDone');
      btn.style.display = '';
      // restore preference
      const pref = localStorage.getItem('tu_hide_done');
      if (pref != null) TU.hideDone = pref === '1';
      btn.setAttribute('aria-pressed', TU.hideDone ? 'true' : 'false');
      btn.addEventListener('click', ()=>{
        TU.hideDone = !TU.hideDone;
        localStorage.setItem('tu_hide_done', TU.hideDone ? '1' : '0');
        btn.setAttribute('aria-pressed', TU.hideDone ? 'true' : 'false');
        applyFilter_();
      });
    }

    // reflect context initially and on change (fallback: poll)
    updateCtxBar_();
    if (g.GameContext && typeof g.GameContext.on === 'function') {
      g.GameContext.on(updateCtxBar_);
    } else {
      TU.pollId = setInterval(updateCtxBar_, 1000);
    }

    // presence buttons
    if (!TU.config.allowPresence) {
      el.querySelector('#tuActions').style.display = 'none';
    } else {
      el.querySelector('#tuLoadPres').addEventListener('click', onLoadPresence_);
      el.querySelector('#tuSavePres').addEventListener('click', onSavePresence_);
    }

    // listen for "recorded" events from pages (e.g., Agility)
    g.addEventListener('tryoutui:done', (ev)=>{
      const pid = String(ev?.detail?.player_id || '');
      if (!pid) return;
      TU.doneIds.add(pid);
      renderRoster_();
    });
  }

  /* ---------- Context helpers ---------- */
  function ctx_(){ return (g.GameContext && g.GameContext.get && g.GameContext.get()) || {}; }

  function updateCtxBar_() {
    const c = ctx_();
    const showGroup = TU.config.showGroup !== false;
    const parts = [
      `Tryout: <b>${c.tryout_id || '—'}</b>`,
      `Period: <b>${c.period_code || '—'}</b>`,
    ];
    if (showGroup) parts.push(`Group: <b>${c.group_code || '—'}</b>`);
    TU.el.querySelector('#tuCtx').innerHTML = parts.join(' • ');

    if (TU.config.allowPresence) {
      const need = !(c.tryout_id && c.group_code);
      TU.el.querySelector('#tuLoadPres').disabled = need;
      TU.el.querySelector('#tuSavePres').disabled = need;
      TU.el.querySelector('#tuPresHint').textContent = need ? 'Select a group to use Presence' : '';
    }

    // keep chip selection aligned (groups mode only)
    if (TU.config.filterMode === 'groups') {
      TU.selectedGroup = c.group_code || 'ALL';
      markActiveGroupChip_();
    }
  }

  /* ---------- Data loading ---------- */
  async function loadRoster_() {
    const res = await g.API.tryout.read.roster();
    if (!res || !res.ok) return;

    TU.roster = (res.roster || []).map(r => ({
      tryout_id: String(r.tryout_id||'').trim(),
      player_id: String(r.player_id||'').trim(),
      tryout_num: r.tryout_num || r.jersey_number || '',
      display_name: r.display_name || r.player_name || '',
      primary_pos: r.primary_pos || r.position || '',
      group_code: r.group_code || r.subgroup || r.primary_pos || ''
    }));

    if (TU.config.filterMode === 'numberBands' || TU.config.filterMode === 'bands') {
      buildNumberChips_();
    } else {
      buildGroupChips_();
    }
    applyFilter_();
  }

  /* ---------- Group chips ---------- */
  function buildGroupChips_() {
    const wrap = TU.el.querySelector('#tuChips');
    const set = new Set(TU.roster.map(r => (r.group_code||'').toString().trim()).filter(Boolean));
    TU.groups = ['ALL', ...Array.from(set).sort((a,b)=>a.localeCompare(b))];

    wrap.innerHTML = TU.groups.map(gcode =>
      `<button type="button" class="tu-chip" data-g="${escAttr_(gcode)}">${escHtml_(gcode)}</button>`
    ).join('');

    wrap.addEventListener('click', (e)=>{
      const btn = e.target.closest('.tu-chip'); if(!btn) return;
      const gcode = btn.getAttribute('data-g');
      TU.selectedGroup = gcode;
      if (gcode === 'ALL') g.GameContext?.setGroup('');
      else g.GameContext?.setGroup(gcode);
      markActiveGroupChip_();
      applyFilter_();
    });

    markActiveGroupChip_();
  }

  function markActiveGroupChip_() {
    const wrap = TU.el.querySelector('#tuChips');
    if (!wrap) return;
    wrap.querySelectorAll('.tu-chip').forEach(b => b.removeAttribute('aria-pressed'));
    const sel = TU.selectedGroup || 'ALL';
    const active = wrap.querySelector(`.tu-chip[data-g="${CSSescape_(sel)}"]`) ||
                   wrap.querySelector('.tu-chip[data-g="ALL"]');
    if (active) active.setAttribute('aria-pressed','true');
  }

  /* ---------- Number band chips (1–10, 11–20, …) ---------- */
  function buildNumberChips_() {
    const nums = TU.roster
      .map(r => parseInt(String(r.tryout_num||'').replace(/[^\d]/g,''), 10))
      .filter(n => !isNaN(n));
    const min = nums.length ? Math.min(...nums) : 1;
    const max = nums.length ? Math.max(...nums) : 99;

    const start = Math.max(1, Math.floor((min-1)/10)*10 + 1);
    const endBand = Math.ceil(max/10)*10;
    const bands = [];
    for (let a=start; a<=endBand; a+=10) {
      const b = a+9;
      bands.push({ label: `${a}–${b}`, min:a, max:b });
    }
    TU.bands = [{ label:'ALL', min:null, max:null }, ...bands];

    const wrap = TU.el.querySelector('#tuChips');
    wrap.innerHTML = TU.bands.map(b =>
      `<button type="button" class="tu-chip" data-band="${escAttr_(b.label)}">${escHtml_(b.label)}</button>`
    ).join('');

    wrap.addEventListener('click', (e)=>{
      const btn = e.target.closest('.tu-chip'); if(!btn) return;
      TU.selectedBand = btn.getAttribute('data-band') || 'ALL';
      wrap.querySelectorAll('.tu-chip').forEach(x=>x.removeAttribute('aria-pressed'));
      btn.setAttribute('aria-pressed','true');
      applyFilter_();
    });

    TU.selectedBand = 'ALL';
    wrap.querySelector('.tu-chip[data-band="ALL"]')?.setAttribute('aria-pressed','true');
  }

  /* ---------- Filtering + roster render ---------- */
  function applyFilter_() {
    const term = (TU.searchTerm||'').toLowerCase();

    TU.filtered = TU.roster.filter(r => {
      // hide recorded players if toggled
      if (TU.hideDone && TU.doneIds.has(r.player_id)) return false;

      // mode filter
      if (TU.config.filterMode === 'groups') {
        const inGroup = (TU.selectedGroup==='ALL') ? true : (String(r.group_code||'')===TU.selectedGroup);
        if (!inGroup) return false;
      } else {
        if (TU.selectedBand !== 'ALL') {
          const band = TU.bands.find(b => b.label === TU.selectedBand);
          const num = parseInt(String(r.tryout_num||'').replace(/[^\d]/g,''), 10);
          if (!band || isNaN(num)) return false;
          if (num < band.min || num > band.max) return false;
        }
      }

      // search
      if (!term) return true;
      const numStr = String(r.tryout_num||'');
      const name = String(r.display_name||'').toLowerCase();
      return numStr.includes(term) || name.includes(term);
    });

    renderRoster_();
  }

  function renderRoster_() {
    const box = TU.el.querySelector('#tuRoster');
    if (!TU.filtered.length){
      box.innerHTML = `<div class="tu-hint">No players match.</div>`;
      return;
    }
    box.innerHTML = TU.filtered.map(p => `
      <div class="tu-player ${TU.presentIds.has(p.player_id)?'present':''} ${TU.selected?.player_id===p.player_id?'selected':''} ${TU.doneIds.has(p.player_id)?'done':''}" data-id="${escAttr_(p.player_id)}">
        <div class="tu-num">${escHtml_(p.tryout_num||'—')}</div>
        <div>
          <div class="tu-name">${escHtml_(p.display_name||'Unknown')}</div>
          <div class="tu-pos">${escHtml_(p.primary_pos||p.group_code||'')}</div>
        </div>
      </div>
    `).join('');

    // click behavior
    box.querySelectorAll('.tu-player').forEach(card=>{
      card.addEventListener('click', (evt)=>{
        const pid = card.getAttribute('data-id');
        const rec = TU.roster.find(r => r.player_id === pid);
        if (!rec) return;

        // Alt/Option click toggles presence (if allowed)
        if (evt.altKey && TU.config.allowPresence) {
          togglePresence_(pid, card);
          return;
        }

        if (TU.config.clickSelects) {
          TU.selected = rec;
          box.querySelectorAll('.tu-player').forEach(x=>x.classList.remove('selected'));
          card.classList.add('selected');
          const search = TU.el.querySelector('#tuSearch');
          if (search) search.value = labelFor_(rec);
          emitSelect_(rec);
        }
      });
    });
  }

  function togglePresence_(pid, cardEl){
    if (TU.presentIds.has(pid)) TU.presentIds.delete(pid);
    else TU.presentIds.add(pid);
    cardEl.classList.toggle('present');
  }

  function labelFor_(r){
    const num = (r.tryout_num==null?'':String(r.tryout_num)).trim();
    const nm = (r.display_name || r.player_name || r.name || '').trim();
    const pos = (r.primary_pos || r.position || '').trim();
    return [num, '•', nm, pos?`(${pos})`:'' ].filter(Boolean).join(' ');
  }

  /* ---------- Presence ---------- */
  async function onLoadPresence_() {
    const c = ctx_();
    if (!c.tryout_id || !c.group_code) return;
    const res = await g.API.tryout.presence.get({ tryout_id:c.tryout_id, group:c.group_code });
    if (res && res.ok && res.presence && Array.isArray(res.presence.players)) {
      TU.presentIds = new Set(res.presence.players.map(String));
      renderRoster_();
      addLog_('presence_load', `Loaded ${TU.presentIds.size} present (${c.group_code})`);
    }
  }

  async function onSavePresence_() {
    const c = ctx_();
    if (!c.tryout_id || !c.group_code) return;
    const players = Array.from(TU.presentIds);
    const meta = { by:'ui', at: g.toLocalISO ? g.toLocalISO(new Date()) : new Date().toISOString() };
    const res = await g.API.tryout.presence.set({ tryout_id:c.tryout_id, group:c.group_code, players, meta });
    if (res && res.ok) addLog_('presence_save', `Saved ${players.length} present (${c.group_code})`);
  }

  /* ---------- Write logging (auto) ---------- */
  function hookWriteLogging_() {
    if (!g.API || !g.API.tryout || !g.API.tryout.write) return;

    const wrap = (fn, routeName) => async (row) => {
      const out = await fn(row);
      if (out && out.ok !== false) {
        const name = (row && (row.display_name || row.player_id || row.offense_id || row.defense_id)) || '—';
        addLog_(routeName, `Write → ${routeName} :: ${name}`);
      }
      return out;
    };

    const w = g.API.tryout.write;
    w.agility = wrap(w.agility, 'agility');
    w.station = wrap(w.station, 'station');
    w.onevone = wrap(w.onevone, '1v1');
    w.team    = wrap(w.team, 'team');
  }

  function addLog_(route, summary) {
    TU.logItems.unshift({ ts: new Date(), route, summary });
    TU.logItems = TU.logItems.slice(0, TU.logLimit);
    const ul = TU.el.querySelector('#tuLogList');
    ul.innerHTML = TU.logItems.map(it => (
      `<li><strong>${fmtTime_(it.ts)}</strong> — ${escHtml_(it.summary)}</li>`
    )).join('');
  }
  function fmtTime_(d){ const pad=n=>String(n).padStart(2,'0'); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }

  /* ---------- Selection events ---------- */
  function emitSelect_(player){
    try { g.dispatchEvent(new CustomEvent('tryoutui:select', { detail:{ player } })); } catch {}
    if (typeof TU.onSelectCb === 'function') TU.onSelectCb(player);
  }

  /* ---------- Public API ---------- */
  async function init(mountSel, opts) {
    TU.config = { ...TU.config, ...(opts || {}) };
    if (TU.config.showGroup === false && opts?.allowPresence == null) {
      TU.config.allowPresence = false;
    }

    injectCss_();
    const mount = document.querySelector(mountSel || '#tryout-shared');
    if (!mount) return;
    renderShell_(mount);
    hookWriteLogging_();
    await loadRoster_();
    updateCtxBar_();
  }

  function getSelectedPlayers(){ return TU.selected ? [TU.selected] : []; }
  function onSelect(cb){ TU.onSelectCb = (typeof cb === 'function') ? cb : null; }

  // NEW: mark a player as recorded (adds check + optional hide)
  function markDone(player_id){
    const pid = String(player_id||'');
    if (!pid) return;
    TU.doneIds.add(pid);
    renderRoster_();
  }

  /* ---------- utils ---------- */
  function CSSescape_(s){ return String(s).replace(/"/g,'\\"'); }
  function escAttr_(s){ return String(s).replace(/"/g,'&quot;'); }

  // expose
  g.TryoutUI = { init, getSelectedPlayers, onSelect, markDone };

})(window);
