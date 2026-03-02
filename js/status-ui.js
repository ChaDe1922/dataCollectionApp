// /js/status-ui.js — Consistent "Saved / Failed / Retry" status helper
(function (g) {
  'use strict';

  const DEFAULTS = {
    autoResetMs: 2000,      // Auto-return to idle after success
    showRetry: true,        // Show retry button on error
    ariaLive: 'polite'    // ARIA live region politeness
  };

  /**
   * Create a status controller attached to a target element
   * @param {string|HTMLElement} target - selector string or element
   * @param {object} opts - options
   * @returns {object} controller with idle/loading/success/error methods
   */
  function attach(target, opts = {}) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) {
      console.warn('[StatusUI] Target not found:', target);
      return createNoopController();
    }

    const options = { ...DEFAULTS, ...opts };
    let autoResetTimer = null;
    let retryCallback = null;

    // Ensure ARIA attributes for accessibility
    if (!el.hasAttribute('aria-live')) {
      el.setAttribute('aria-live', options.ariaLive);
    }
    if (!el.hasAttribute('role')) {
      el.setAttribute('role', 'status');
    }

    // Create retry button (initially hidden)
    let retryBtn = null;
    function getRetryBtn() {
      if (retryBtn) return retryBtn;

      // Check if we can insert a button inside the element
      const tag = el.tagName.toLowerCase();
      const canContainButton = !['input', 'textarea', 'select', 'span', 'code', 'strong', 'em', 'b', 'i'].includes(tag);

      retryBtn = document.createElement('button');
      retryBtn.textContent = 'Retry';
      retryBtn.type = 'button';
      Object.assign(retryBtn.style, {
        marginLeft: '8px',
        padding: '4px 12px',
        fontSize: 'inherit',
        cursor: 'pointer',
        border: '1px solid currentColor',
        borderRadius: '4px',
        background: 'transparent'
      });

      retryBtn.addEventListener('click', () => {
        if (retryCallback) retryCallback();
      });

      if (canContainButton) {
        el.appendChild(retryBtn);
      } else {
        // Insert as sibling for inline elements
        retryBtn.style.marginLeft = '8px';
        el.parentNode?.insertBefore(retryBtn, el.nextSibling);
      }

      retryBtn.style.display = 'none';
      return retryBtn;
    }

    function clearAutoReset() {
      if (autoResetTimer) {
        clearTimeout(autoResetTimer);
        autoResetTimer = null;
      }
    }

    function setClasses(status) {
      // Remove previous status classes
      el.classList.remove('status-idle', 'status-loading', 'status-success', 'status-error');
      // Add new status class
      el.classList.add(`status-${status}`);
    }

    function updateStyles(status) {
      // Default inline styles based on status
      const styles = {
        idle: { color: '#666' },
        loading: { color: '#0066cc' },
        success: { color: '#2e7d32' },
        error: { color: '#d32f2f' }
      };

      const style = styles[status];
      if (style) {
        Object.assign(el.style, style);
      }
    }

    const controller = {
      /**
       * Set idle state
       * @param {string} msg - message to display (default: 'Ready')
       */
      idle(msg = 'Ready') {
        clearAutoReset();
        el.textContent = msg;
        setClasses('idle');
        updateStyles('idle');
        const btn = retryBtn;
        if (btn) btn.style.display = 'none';
        retryCallback = null;
        return controller;
      },

      /**
       * Set loading state
       * @param {string} msg - message to display (default: 'Saving…')
       */
      loading(msg = 'Saving…') {
        clearAutoReset();
        el.textContent = msg;
        setClasses('loading');
        updateStyles('loading');
        const btn = retryBtn;
        if (btn) btn.style.display = 'none';
        return controller;
      },

      /**
       * Set success state
       * @param {string} msg - message to display (default: 'Saved')
       * @param {number} autoResetMs - ms before returning to idle (default: 2000)
       */
      success(msg = 'Saved', autoResetMs = options.autoResetMs) {
        clearAutoReset();
        el.textContent = msg;
        setClasses('success');
        updateStyles('success');
        const btn = retryBtn;
        if (btn) btn.style.display = 'none';

        if (autoResetMs > 0) {
          autoResetTimer = setTimeout(() => controller.idle(), autoResetMs);
        }
        return controller;
      },

      /**
       * Set error state with optional retry
       * @param {string} msg - message to display (default: 'Failed')
       * @param {function} onRetry - callback when retry is clicked
       */
      error(msg = 'Failed', onRetry = null) {
        clearAutoReset();
        el.textContent = msg;
        setClasses('error');
        updateStyles('error');

        if (onRetry && options.showRetry) {
          retryCallback = onRetry;
          const btn = getRetryBtn();
          btn.style.display = 'inline-block';
        } else {
          const btn = retryBtn;
          if (btn) btn.style.display = 'none';
        }
        return controller;
      },

      /**
       * Show result based on API response
       * @param {object} res - API response { ok, data, error }
       * @param {function} onRetry - callback for retry
       * @param {string} successMsg - message on success
       * @param {string} errorMsg - message on error
       */
      fromResponse(res, onRetry = null, successMsg = 'Saved', errorMsg = 'Failed') {
        if (res && res.ok) {
          // Handle idempotency "already_saved" as success
          if (res.data?.status === 'already_saved') {
            return this.success('Already saved');
          }
          return this.success(successMsg);
        } else {
          const msg = res?.error?.message || errorMsg;
          return this.error(msg, onRetry);
        }
      },

      /**
       * Destroy the controller and cleanup
       */
      destroy() {
        clearAutoReset();
        if (retryBtn && retryBtn.parentNode) {
          retryBtn.parentNode.removeChild(retryBtn);
        }
        retryBtn = null;
        retryCallback = null;
      }
    };

    // Initialize as idle
    controller.idle();

    return controller;
  }

  /**
   * Create a no-op controller when target is not found
   */
  function createNoopController() {
    return {
      idle: () => {},
      loading: () => {},
      success: () => {},
      error: () => {},
      fromResponse: () => {},
      destroy: () => {}
    };
  }

  /**
   * Global status helper for pages without a specific target
   * Creates a floating status bar at top of page
   */
  function createGlobalStatus(opts = {}) {
    const id = 'gsds-global-status';
    let host = document.getElementById(id);

    if (!host) {
      host = document.createElement('div');
      host.id = id;
      Object.assign(host.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        right: '0',
        zIndex: '9999',
        padding: '12px 16px',
        textAlign: 'center',
        fontWeight: '500',
        fontSize: '14px',
        transition: 'transform 0.2s ease, opacity 0.2s ease',
        transform: 'translateY(-100%)',
        opacity: '0'
      });
      document.body.appendChild(host);
    }

    const controller = attach(host, opts);

    // Override methods to handle visibility
    const originalIdle = controller.idle;
    const originalLoading = controller.loading;
    const originalSuccess = controller.success;
    const originalError = controller.error;

    controller.idle = function(msg) {
      originalIdle.call(this, msg);
      host.style.transform = 'translateY(-100%)';
      host.style.opacity = '0';
      return this;
    };

    controller.loading = function(msg) {
      originalLoading.call(this, msg);
      host.style.background = '#e3f2fd';
      host.style.color = '#0066cc';
      host.style.transform = 'translateY(0)';
      host.style.opacity = '1';
      return this;
    };

    controller.success = function(msg, autoResetMs) {
      originalSuccess.call(this, msg, autoResetMs);
      host.style.background = '#e8f5e9';
      host.style.color = '#2e7d32';
      host.style.transform = 'translateY(0)';
      host.style.opacity = '1';
      return this;
    };

    controller.error = function(msg, onRetry) {
      originalError.call(this, msg, onRetry);
      host.style.background = '#ffebee';
      host.style.color = '#d32f2f';
      host.style.transform = 'translateY(0)';
      host.style.opacity = '1';
      return this;
    };

    return controller;
  }

  // Expose
  g.GSDSStatus = {
    attach,
    createGlobal: createGlobalStatus,
    DEFAULTS
  };

})(window);
