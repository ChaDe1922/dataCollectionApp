/**
 * Form Engine — Schema-driven form rendering and submission
 * Phase 4: Creates forms from JSON schemas instead of bespoke HTML/JS
 */
(function(global) {
  'use strict';

  // ============================================================================
  // DEFAULTS & CONFIG
  // ============================================================================
  const DEFAULTS = {
    mountSelector: '#app',
    statusSelector: '#status',
    autoResetMs: 2000
  };

  // ============================================================================
  // FormEngine Class
  // ============================================================================
  class FormEngine {
    constructor(options = {}) {
      this.schema = options.schema || null;
      this.mountEl = typeof options.mount === 'string'
        ? document.querySelector(options.mount)
        : options.mount;
      this.status = options.status ? GSDSStatus.attach(options.status) : null;

      // Runtime state
      this.state = {
        context: {},      // From GameContext (game_id, play_id, etc.)
        user: {},         // From auth
        player: null,     // Selected player
        rep: { n: 1 },    // Rep counter
        values: {},       // Field values
        idempotencyKey: null // Current submission key
      };

      this.unsubscribers = [];
    }

    // ============================================================================
    // BOOTSTRAP
    // ============================================================================
    async init() {
      if (!this.schema) throw new Error('FormEngine: schema required');
      if (!this.mountEl) throw new Error('FormEngine: mount element not found');

      // Validate requirements
      await this.validateRequirements();

      // Subscribe to context changes
      this.subscribeToContext();

      // Subscribe to auth changes
      this.loadUserFromAuth();

      // Render the form
      this.render();

      return this;
    }

    async validateRequirements() {
      const req = this.schema.requirements || {};

      // Check auth
      if (req.auth && !API.isAuthenticated()) {
        window.location.href = '../index.html#login';
        throw new Error('Authentication required');
      }

      // Check context
      if (req.context) {
        const ctx = GameContext.get ? GameContext.get() : {};
        if (req.context.type === 'game' && !ctx.game_id) {
          console.warn('FormEngine: No game context set');
        }
        if (req.context.type === 'tryout' && !ctx.tryout_id) {
          console.warn('FormEngine: No tryout context set');
        }
      }
    }

    subscribeToContext() {
      if (!GameContext.subscribe) return;

      const unsub = GameContext.subscribe((ctx) => {
        this.state.context = { ...ctx };
        this.updateContextDisplay();
      });
      this.unsubscribers.push(unsub);
    }

    loadUserFromAuth() {
      const user = API.getAuthUser ? API.getAuthUser() : null;
      if (user) {
        this.state.user = user;
      }
    }

    // ============================================================================
    // RENDERING
    // ============================================================================
    render() {
      const { schema, mountEl } = this;

      // Clear mount point
      mountEl.innerHTML = '';

      // Create container
      const container = document.createElement('div');
      container.className = 'form-engine-container';

      // 1. Title
      if (schema.title) {
        const title = document.createElement('h1');
        title.textContent = schema.title;
        title.className = 'form-title';
        container.appendChild(title);
      }

      // 2. Context Banner (if enabled)
      if (schema.ui?.showContextBanner !== false) {
        const banner = this.renderContextBanner();
        container.appendChild(banner);
      }

      // 3. Rep Counter (if enabled)
      if (schema.ui?.showRepCounter) {
        const repCounter = this.renderRepCounter();
        container.appendChild(repCounter);
      }

      // 4. Player Picker (if required)
      if (schema.requirements?.playerPicker) {
        const playerPicker = this.renderPlayerPicker();
        container.appendChild(playerPicker);
      }

      // 5. Fields
      const fieldsCard = document.createElement('div');
      fieldsCard.className = 'card';

      if (schema.fields) {
        schema.fields.forEach(field => {
          const fieldEl = this.renderField(field);
          if (fieldEl) fieldsCard.appendChild(fieldEl);
        });
      }

      container.appendChild(fieldsCard);

      // 6. Submit Section
      const submitSection = this.renderSubmitSection();
      container.appendChild(submitSection);

      // 7. Log (if needed)
      if (schema.ui?.showLog !== false) {
        const logSection = this.renderLogSection();
        container.appendChild(logSection);
      }

      mountEl.appendChild(container);

      // Apply initial values
      this.initializeValues();
    }

    renderContextBanner() {
      const banner = document.createElement('div');
      banner.className = 'card context-banner';
      banner.id = 'ctxBanner';

      // Use existing GameContext banner if available
      if (GameContext.mountBanner) {
        // Defer to let DOM settle
        setTimeout(() => GameContext.mountBanner('#ctxBanner'), 0);
      }

      return banner;
    }

    renderRepCounter() {
      const wrapper = document.createElement('div');
      wrapper.className = 'card rep-counter';

      const label = document.createElement('label');
      label.className = 'label';
      label.textContent = this.schema.ui?.repLabel || 'Rep';
      wrapper.appendChild(label);

      const controls = document.createElement('div');
      controls.className = 'rep-controls';

      const decBtn = document.createElement('button');
      decBtn.className = 'btn subtle';
      decBtn.textContent = '−';
      decBtn.onclick = () => this.setRep(Math.max(1, this.state.rep.n - 1));

      const value = document.createElement('span');
      value.className = 'rep-value';
      value.id = 'repCounter';
      value.textContent = this.state.rep.n;

      const incBtn = document.createElement('button');
      incBtn.className = 'btn subtle';
      incBtn.textContent = '+';
      incBtn.onclick = () => this.setRep(this.state.rep.n + 1);

      controls.appendChild(decBtn);
      controls.appendChild(value);
      controls.appendChild(incBtn);
      wrapper.appendChild(controls);

      return wrapper;
    }

    setRep(n) {
      this.state.rep.n = n;
      const el = document.getElementById('repCounter');
      if (el) el.textContent = n;
    }

    renderPlayerPicker() {
      const wrapper = document.createElement('div');
      wrapper.className = 'card player-picker';

      const label = document.createElement('label');
      label.className = 'label';
      label.textContent = 'Player';
      wrapper.appendChild(label);

      const input = document.createElement('input');
      input.className = 'form-input';
      input.placeholder = 'Search by name or number...';
      input.id = 'playerSearch';
      input.setAttribute('list', 'playerDatalist');

      // Load roster into datalist
      this.loadPlayerDatalist();

      input.addEventListener('change', (e) => this.handlePlayerSelect(e.target.value));

      wrapper.appendChild(input);

      // Selected player display
      const selected = document.createElement('div');
      selected.className = 'selected-player';
      selected.id = 'selectedPlayer';
      selected.style.display = 'none';
      wrapper.appendChild(selected);

      return wrapper;
    }

    async loadPlayerDatalist() {
      // Try to use existing roster loading logic
      try {
        const res = await API.tryout.read.roster();
        if (res?.ok) {
          const roster = res.data?.roster || res.roster || [];
          const dl = document.createElement('datalist');
          dl.id = 'playerDatalist';

          roster.forEach(r => {
            const opt = document.createElement('option');
            opt.value = `${r.tryout_num || r.jersey_number} • ${r.display_name || r.player_name}`;
            opt.dataset.playerId = r.player_id;
            opt.dataset.player = JSON.stringify(r);
            dl.appendChild(opt);
          });

          this.mountEl.appendChild(dl);
        }
      } catch (e) {
        console.warn('FormEngine: Could not load roster', e);
      }
    }

    handlePlayerSelect(value) {
      // Parse value like "22 • Player Name"
      const parts = value.split('•').map(s => s.trim());
      const num = parts[0];

      // Find in datalist
      const dl = document.getElementById('playerDatalist');
      if (!dl) return;

      const opts = Array.from(dl.querySelectorAll('option'));
      const match = opts.find(o => o.value === value || o.value.includes(num));

      if (match) {
        try {
          const player = JSON.parse(match.dataset.player);
          this.state.player = player;
          this.updateSelectedPlayerDisplay();
        } catch (e) {
          console.error('FormEngine: Failed to parse player data', e);
        }
      }
    }

    updateSelectedPlayerDisplay() {
      const el = document.getElementById('selectedPlayer');
      if (!el) return;

      if (this.state.player) {
        const p = this.state.player;
        el.innerHTML = `
          <span class="chip">${p.tryout_num || p.jersey_number}</span>
          <strong>${p.display_name || p.player_name}</strong>
          <span class="muted">${p.primary_pos || p.position || ''}</span>
        `;
        el.style.display = 'block';
      } else {
        el.style.display = 'none';
      }
    }

    renderField(field) {
      const wrapper = document.createElement('div');
      wrapper.className = 'field';

      // Label
      if (field.label) {
        const label = document.createElement('label');
        label.className = 'label';
        label.textContent = field.required ? `${field.label} *` : field.label;
        wrapper.appendChild(label);
      }

      // Input based on type
      let input;
      switch (field.type) {
        case 'text':
          input = this.renderTextInput(field);
          break;
        case 'number':
          input = this.renderNumberInput(field);
          break;
        case 'select':
          input = this.renderSelectInput(field);
          break;
        case 'toggle':
          input = this.renderToggleInput(field);
          break;
        case 'radio':
          input = this.renderRadioInput(field);
          break;
        case 'grade':
          input = this.renderGradeInput(field);
          break;
        case 'notes':
          input = this.renderNotesInput(field);
          break;
        case 'hidden':
          input = this.renderHiddenInput(field);
          break;
        default:
          input = this.renderTextInput(field);
      }

      if (input) wrapper.appendChild(input);

      return wrapper;
    }

    renderTextInput(field) {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'form-input';
      input.id = `field_${field.id}`;
      input.placeholder = field.placeholder || '';

      if (field.default) input.value = field.default;

      input.addEventListener('change', (e) => {
        this.state.values[field.id] = e.target.value;
      });

      return input;
    }

    renderNumberInput(field) {
      const wrapper = document.createElement('div');

      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'form-input';
      input.id = `field_${field.id}`;

      if (field.min !== undefined) input.min = field.min;
      if (field.max !== undefined) input.max = field.max;
      if (field.step !== undefined) input.step = field.step;
      if (field.default !== undefined) input.value = field.default;

      input.addEventListener('change', (e) => {
        this.state.values[field.id] = parseFloat(e.target.value) || 0;
      });

      wrapper.appendChild(input);

      // Quick buttons if specified
      if (field.quickButtons) {
        const btnBar = document.createElement('div');
        btnBar.className = 'btnbar';
        btnBar.style.marginTop = '0.35rem';

        field.quickButtons.forEach(btn => {
          const button = document.createElement('button');
          button.className = 'btn subtle';
          button.textContent = btn.label;
          button.onclick = () => {
            input.value = btn.value;
            this.state.values[field.id] = btn.value;
          };
          btnBar.appendChild(button);
        });

        wrapper.appendChild(btnBar);
      }

      return wrapper;
    }

    renderSelectInput(field) {
      const select = document.createElement('select');
      select.className = 'form-select';
      select.id = `field_${field.id}`;

      field.options.forEach(opt => {
        const option = document.createElement('option');
        option.value = typeof opt === 'object' ? opt.value : opt;
        option.textContent = typeof opt === 'object' ? opt.label : opt;
        select.appendChild(option);
      });

      if (field.default) select.value = field.default;

      select.addEventListener('change', (e) => {
        this.state.values[field.id] = e.target.value;
      });

      return select;
    }

    renderToggleInput(field) {
      const wrapper = document.createElement('div');
      wrapper.className = 'toggle-row';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tgl';
      button.setAttribute('aria-checked', 'false');
      button.id = `toggle_${field.id}`;

      const hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.id = `field_${field.id}`;
      hidden.value = field.default || 'No';

      button.addEventListener('click', () => {
        const current = button.getAttribute('aria-checked') === 'true';
        const next = !current;
        button.setAttribute('aria-checked', next ? 'true' : 'false');
        hidden.value = next ? 'Yes' : 'No';
        this.state.values[field.id] = hidden.value;
      });

      wrapper.appendChild(button);
      wrapper.appendChild(hidden);

      return wrapper;
    }

    renderRadioInput(field) {
      const wrapper = document.createElement('div');
      wrapper.className = 'seg';

      field.options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'seg-btn';
        btn.type = 'button';
        btn.dataset.value = typeof opt === 'object' ? opt.value : opt;
        btn.textContent = typeof opt === 'object' ? opt.label : opt;

        if (field.default && btn.dataset.value === field.default) {
          btn.setAttribute('aria-pressed', 'true');
        }

        btn.addEventListener('click', () => {
          // Clear others
          wrapper.querySelectorAll('.seg-btn').forEach(b => {
            b.setAttribute('aria-pressed', 'false');
          });
          // Set this one
          btn.setAttribute('aria-pressed', 'true');
          this.state.values[field.id] = btn.dataset.value;
        });

        wrapper.appendChild(btn);
      });

      return wrapper;
    }

    renderGradeInput(field) {
      const wrapper = document.createElement('div');
      wrapper.className = 'grade-buttons';

      const grading = field.grading || this.schema.grading;
      if (!grading) return wrapper;

      let options;
      if (grading.type === 'tier3') {
        options = [
          { value: 'above', label: 'Above Average', class: 'btn success' },
          { value: 'average', label: 'Average', class: 'btn subtle' },
          { value: 'below', label: 'Below Average', class: 'btn warn' }
        ];
      } else if (grading.options) {
        options = grading.options;
      }

      options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = opt.class || 'btn subtle';
        btn.type = 'button';
        btn.textContent = opt.label;
        btn.dataset.value = opt.value;

        btn.addEventListener('click', () => {
          // Clear others
          wrapper.querySelectorAll('button').forEach(b => {
            b.classList.remove('active');
          });
          // Set this one
          btn.classList.add('active');
          this.state.values[field.id] = opt.value;
        });

        wrapper.appendChild(btn);
      });

      return wrapper;
    }

    renderNotesInput(field) {
      const textarea = document.createElement('textarea');
      textarea.className = 'form-input';
      textarea.id = `field_${field.id}`;
      textarea.rows = field.rows || 3;
      textarea.placeholder = field.placeholder || '';

      textarea.addEventListener('change', (e) => {
        this.state.values[field.id] = e.target.value;
      });

      return textarea;
    }

    renderHiddenInput(field) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.id = `field_${field.id}`;

      // Value comes from context or computed
      if (field.contextKey) {
        input.value = this.state.context[field.contextKey] || '';
        this.state.values[field.id] = input.value;
      }

      return input;
    }

    renderSubmitSection() {
      const wrapper = document.createElement('div');
      wrapper.className = 'submit-section';

      const btnBar = document.createElement('div');
      btnBar.className = 'btnbar';

      // Submit button
      const submitBtn = document.createElement('button');
      submitBtn.className = 'btn primary';
      submitBtn.textContent = 'Save';
      submitBtn.onclick = () => this.handleSubmit();

      // Clear button
      const clearBtn = document.createElement('button');
      clearBtn.className = 'btn subtle';
      clearBtn.textContent = 'Clear';
      clearBtn.onclick = () => this.handleClear();

      btnBar.appendChild(submitBtn);
      btnBar.appendChild(clearBtn);
      wrapper.appendChild(btnBar);

      // Status element if not already attached
      if (!this.status) {
        const status = document.createElement('span');
        status.id = 'formStatus';
        status.className = 'tiny';
        wrapper.appendChild(status);
        this.status = GSDSStatus.attach('#formStatus');
      }

      return wrapper;
    }

    renderLogSection() {
      const wrapper = document.createElement('div');
      wrapper.className = 'card log-section';

      const title = document.createElement('h2');
      title.textContent = 'Log';
      wrapper.appendChild(title);

      const log = document.createElement('div');
      log.id = 'formLog';
      log.className = 'tiny';
      wrapper.appendChild(log);

      return wrapper;
    }

    initializeValues() {
      // Set initial values from defaults
      this.schema.fields.forEach(field => {
        if (field.default !== undefined) {
          this.state.values[field.id] = field.default;
        }
      });
    }

    updateContextDisplay() {
      // Context updates are handled by the banner if mounted
    }

    // ============================================================================
    // SUBMISSION
    // ============================================================================
    async handleSubmit() {
      // Validate
      const validation = this.validate();
      if (!validation.ok) {
        this.status?.error(validation.error);
        return;
      }

      // Generate idempotency key if not already set
      if (!this.state.idempotencyKey) {
        this.state.idempotencyKey = API.makeIdempotencyKey
          ? API.makeIdempotencyKey(this.schema.sheet?.idempotencyPrefix || this.schema.key)
          : `${this.schema.key}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      }

      // Show loading
      this.status?.loading('Saving…');

      try {
        // Build payload
        const payload = this.buildPayload();

        // Submit via API
        const res = await API.request(payload);

        if (res.ok) {
          // Handle already_saved as success
          if (res.data?.status === 'already_saved') {
            this.status?.success('Already saved');
          } else {
            this.status?.success('Saved');
          }

          // Log
          this.log(`Saved to ${this.schema.sheet?.tab}`);

          // Post-submit behavior
          this.handlePostSubmit();
        } else {
          // Handle errors
          if (res.error?.code === 'AUTH_REQUIRED' || res.error?.code === 'TOKEN_EXPIRED') {
            this.status?.error('Session expired. Please log in.');
          } else if (res.error?.code === 'FORBIDDEN') {
            this.status?.error('Permission denied.');
          } else {
            this.status?.error(res.error?.message || 'Failed', () => this.handleSubmit());
          }
        }
      } catch (err) {
        this.status?.error(err.message || 'Failed', () => this.handleSubmit());
      }
    }

    validate() {
      const errors = [];

      // Check required context
      if (this.schema.requirements?.context) {
        const ctx = this.state.context;
        if (this.schema.requirements.context.type === 'game') {
          if (!ctx.game_id) errors.push('Game ID required');
          if (!ctx.play_id) errors.push('Play ID required');
        }
        if (this.schema.requirements.context.type === 'tryout') {
          if (!ctx.tryout_id) errors.push('Tryout ID required');
        }
      }

      // Check player required
      if (this.schema.requirements?.playerPicker && !this.state.player) {
        errors.push('Player selection required');
      }

      // Check required fields
      this.schema.fields.forEach(field => {
        if (field.required && !this.state.values[field.id]) {
          errors.push(`${field.label} required`);
        }
      });

      if (errors.length > 0) {
        return { ok: false, error: errors.join('; ') };
      }

      return { ok: true };
    }

    buildPayload() {
      const { schema, state } = this;

      // Get row from payload builder
      const builderName = schema.payload?.builder;
      let row;

      if (builderName && PayloadBuilders && PayloadBuilders[builderName]) {
        row = PayloadBuilders[builderName](state);
      } else {
        // Default: map values directly
        row = { ...state.values };
      }

      // Construct final payload
      return {
        action: schema.sheet?.action || 'append',
        route: schema.sheet?.tab,
        row,
        idempotency_key: state.idempotencyKey,
        ...this.buildContextParams()
      };
    }

    buildContextParams() {
      const params = {};
      const ctx = this.state.context;

      // Add context fields based on schema requirements
      if (this.schema.requirements?.context?.type === 'game') {
        if (ctx.game_id) params.game_id = ctx.game_id;
        if (ctx.drive_id) params.drive_id = ctx.drive_id;
        if (ctx.play_id) params.play_id = ctx.play_id;
      }

      if (this.schema.requirements?.context?.type === 'tryout') {
        if (ctx.tryout_id) params.tryout_id = ctx.tryout_id;
        if (ctx.period_code) params.period_code = ctx.period_code;
        if (ctx.station_id) params.station_id = ctx.station_id;
      }

      return params;
    }

    handlePostSubmit() {
      const behavior = this.schema.ui?.postSubmit;

      if (behavior === 'clearAll') {
        this.handleClear();
      } else if (behavior === 'clearFields') {
        this.clearFieldsOnly();
      } else if (behavior === 'incrementRep') {
        this.setRep(this.state.rep.n + 1);
      }

      // Reset idempotency key for next submission
      this.state.idempotencyKey = null;
    }

    handleClear() {
      this.state.values = {};
      this.state.player = null;
      this.state.idempotencyKey = null;

      // Reset UI
      this.render();
    }

    clearFieldsOnly() {
      this.state.values = {};
      this.state.idempotencyKey = null;

      // Reset field inputs but keep player/context
      this.schema.fields.forEach(field => {
        const el = document.getElementById(`field_${field.id}`);
        if (el) {
          if (field.type === 'toggle') {
            el.value = field.default || 'No';
            const toggle = document.getElementById(`toggle_${field.id}`);
            if (toggle) toggle.setAttribute('aria-checked', 'false');
          } else if (field.type === 'radio') {
            // Reset to default
            const btns = document.querySelectorAll(`#field_${field.id} .seg-btn`);
            btns.forEach(btn => {
              btn.setAttribute('aria-pressed', btn.dataset.value === field.default ? 'true' : 'false');
            });
          } else {
            el.value = field.default || '';
          }
        }
      });
    }

    log(message) {
      const logEl = document.getElementById('formLog');
      if (logEl) {
        const entry = document.createElement('div');
        entry.textContent = `${new Date().toLocaleTimeString()} — ${message}`;
        logEl.insertBefore(entry, logEl.firstChild);
      }
    }

    destroy() {
      // Cleanup subscriptions
      this.unsubscribers.forEach(fn => fn());
      this.unsubscribers = [];
    }
  }

  // ============================================================================
  // EXPOSE
  // ============================================================================
  global.FormEngine = FormEngine;
})(window);
