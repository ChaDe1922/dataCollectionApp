/* ============================================================================
 * GSDS Leader Election - Single-tab polling coordination
 * Lease-based localStorage lock with BroadcastChannel/localStorage fallback
 * ========================================================================== */
(function(global) {
  'use strict';

  const DEBUG = !!global.GSDS_DEBUG;

  // Generate or retrieve stable tab ID
  function getTabId() {
    const STORAGE_KEY = 'GSDS_TAB_ID';
    let id = sessionStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = 'tab_' + Math.random().toString(36).slice(2, 11) + '_' + Date.now().toString(36);
      sessionStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  }

  const TAB_ID = getTabId();

  function log(label, ...args) {
    if (!DEBUG) return;
    console.log(`[LEADER][${label}]`, ...args);
  }

  function now() { return Date.now(); }

  /**
   * Create a leader election controller
   * @param {Object} opts
   * @param {string} opts.key - localStorage key for the lock
   * @param {number} [opts.ttlMs] - lease duration (default: max(4*pollMs, 6000))
   * @param {number} [opts.heartbeatMs] - leader renew interval (default: max(pollMs, 1000))
   * @param {number} [opts.pollMs] - reference poll interval from GSDS_POLL_MS
   * @param {Function} opts.onBecameLeader - Called when this tab becomes leader
   * @param {Function} opts.onLostLeadership - Called when this tab loses leadership
   * @param {string} [opts.debugLabel] - Label for debug logs
   */
  function createLeaderElection(opts) {
    const key = opts.key;
    if (!key) throw new Error('Leader election requires a key');

    const pollMs = opts.pollMs || 1000;
    const ttlMs = opts.ttlMs || Math.max(4 * pollMs, 6000);
    const heartbeatMs = opts.heartbeatMs || Math.max(pollMs, 1000);
    const label = opts.debugLabel || key.split(':').pop() || 'LEADER';

    let isLeader = false;
    let heartbeatTimer = null;
    let acquireTimer = null;
    let stopped = false;

    function readLock() {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw);
      } catch (e) {
        return null;
      }
    }

    function writeLock(lock) {
      try {
        localStorage.setItem(key, JSON.stringify(lock));
        return true;
      } catch (e) {
        return false;
      }
    }

    function clearLock() {
      try {
        localStorage.removeItem(key);
      } catch (e) {}
    }

    function attemptAcquire() {
      if (stopped) return false;

      const current = readLock();
      const t = now();

      // If no lock or lock expired, try to acquire
      if (!current || current.expiresAt < t) {
        const newLock = {
          tabId: TAB_ID,
          expiresAt: t + ttlMs,
          lastBeatAt: t
        };
        writeLock(newLock);

        // Re-read to verify we won (another tab might have raced)
        const verify = readLock();
        if (verify && verify.tabId === TAB_ID) {
          return true;
        }
      }

      return false;
    }

    function releaseLock() {
      if (!isLeader) return;
      const current = readLock();
      if (current && current.tabId === TAB_ID) {
        // Set expired to force election
        writeLock({ tabId: TAB_ID, expiresAt: 0, lastBeatAt: now() });
      }
    }

    function renewLock() {
      if (!isLeader || stopped) return false;

      const t = now();
      const current = readLock();

      // Check if lock was stolen
      if (!current || current.tabId !== TAB_ID) {
        log(label, 'Lock stolen, losing leadership');
        loseLeadership();
        return false;
      }

      // Renew
      const renewed = {
        tabId: TAB_ID,
        expiresAt: t + ttlMs,
        lastBeatAt: t
      };
      writeLock(renewed);
      return true;
    }

    function gainLeadership() {
      if (isLeader) return;
      isLeader = true;
      log(label, 'Became leader, tab=' + TAB_ID);

      // Start heartbeat
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (!renewLock()) {
          // If renew failed, stop heartbeat
          if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
          }
        }
      }, heartbeatMs);

      if (opts.onBecameLeader) {
        try {
          opts.onBecameLeader({ tabId: TAB_ID, key, ttlMs, heartbeatMs });
        } catch (e) {
          console.error('onBecameLeader error:', e);
        }
      }
    }

    function loseLeadership() {
      if (!isLeader) return;
      isLeader = false;
      log(label, 'Lost leadership, tab=' + TAB_ID);

      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }

      if (opts.onLostLeadership) {
        try {
          opts.onLostLeadership({ tabId: TAB_ID, key, ttlMs, heartbeatMs });
        } catch (e) {
          console.error('onLostLeadership error:', e);
        }
      }

      // Try to re-acquire after jitter
      scheduleAcquireAttempt();
    }

    function scheduleAcquireAttempt() {
      if (stopped || isLeader) return;
      if (acquireTimer) clearTimeout(acquireTimer);

      // Add jitter to avoid thundering herd
      const jitter = Math.floor(Math.random() * 200) - 100; // +/- 100ms
      const delay = Math.max(heartbeatMs + jitter, 100);

      acquireTimer = setTimeout(() => {
        if (!isLeader && !stopped) {
          tryElect();
        }
      }, delay);
    }

    function tryElect() {
      if (stopped || isLeader) return;

      if (attemptAcquire()) {
        gainLeadership();
      } else {
        // Still not leader, schedule next attempt
        scheduleAcquireAttempt();
      }
    }

    // Listen for storage events (leader changes)
    function onStorage(e) {
      if (e.key !== key) return;

      const current = readLock();

      if (isLeader) {
        // If we're leader but lock changed to someone else, we lost leadership
        if (!current || current.tabId !== TAB_ID) {
          log(label, 'Lock changed while leader, losing leadership');
          loseLeadership();
        }
      } else {
        // If we're not leader, check if leader expired
        if (!current || current.expiresAt < now()) {
          scheduleAcquireAttempt();
        }
      }
    }

    // Handle page unload (best-effort release)
    function onBeforeUnload() {
      if (isLeader) {
        releaseLock();
      }
    }

    // Visibility handling - don't immediately resign when hidden
    // (browsers throttle timers, so TTL must be forgiving)
    function onVisibilityChange() {
      if (document.hidden) {
        // Page hidden - our heartbeat may be throttled
        // TTL is designed to be > heartbeat to handle this
        log(label, 'Page hidden, heartbeat may throttle');
      } else {
        // Page visible again - check if we need to re-acquire
        log(label, 'Page visible, checking leadership');
        if (!isLeader) {
          scheduleAcquireAttempt();
        } else {
          // Verify we still hold the lock
          if (!renewLock()) {
            scheduleAcquireAttempt();
          }
        }
      }
    }

    // Start the election process
    function start() {
      if (stopped) return controller;

      // Try to become leader immediately
      tryElect();

      // If not leader, schedule follow-up attempts
      if (!isLeader) {
        scheduleAcquireAttempt();
      }

      // Listen for changes
      window.addEventListener('storage', onStorage);
      window.addEventListener('beforeunload', onBeforeUnload);
      document.addEventListener('visibilitychange', onVisibilityChange);

      log(label, 'Started, isLeader=' + isLeader + ', tab=' + TAB_ID);

      return controller;
    }

    function stop() {
      stopped = true;

      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (acquireTimer) {
        clearTimeout(acquireTimer);
        acquireTimer = null;
      }

      if (isLeader) {
        releaseLock();
      }

      window.removeEventListener('storage', onStorage);
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibilityChange);

      isLeader = false;
      log(label, 'Stopped');
    }

    const controller = {
      isLeader: () => isLeader,
      stop,
      _debug: {
        get tabId() { return TAB_ID; },
        get key() { return key; },
        get ttlMs() { return ttlMs; },
        get heartbeatMs() { return heartbeatMs; },
        get expiresAt() {
          const lock = readLock();
          return lock ? lock.expiresAt : null;
        },
        get currentLeader() {
          const lock = readLock();
          return lock ? lock.tabId : null;
        }
      }
    };

    // Auto-start
    start();

    return controller;
  }

  // Global status for debugging
  const elections = new Map();

  global.GSDSLeader = {
    /**
     * Start a leader election
     * @param {Object} opts
     * @returns {Object} controller with isLeader() and stop()
     */
    start(opts) {
      const controller = createLeaderElection(opts);
      elections.set(opts.key, controller);
      return controller;
    },

    /**
     * Get debug status for all elections
     */
    get status() {
      const result = {};
      elections.forEach((ctrl, key) => {
        result[key] = {
          isLeader: ctrl.isLeader(),
          ...ctrl._debug
        };
      });
      return result;
    },

    /**
     * Get current tab ID
     */
    get tabId() {
      return TAB_ID;
    }
  };

  if (DEBUG) {
    log('INIT', 'GSDSLeader ready, tab=' + TAB_ID);
  }
})(window);
