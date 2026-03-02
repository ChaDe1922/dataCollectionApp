/**
 * Bootstrap module - loads config and global libraries in correct order
 * This module is imported by all entry points to ensure consistent initialization
 */

// Import config first (sets up window.GSDS_* globals)
import '../../js/config.js';

// Import core libraries (these attach to window)
import '../../js/api.js';
import '../../js/status-ui.js';
import '../../js/leader-election.js';
import '../../js/context.js';

// Re-export for convenience
export const { API, GameContext, GSDSStatus, GSDSLeader } = window;

/**
 * Initialize common page functionality
 */
export function bootstrap(options = {}) {
  // Check auth if required
  if (options.auth !== false) {
    const ok = localStorage.getItem('auth_ok') === '1' &&
               Number(localStorage.getItem('auth_until') || 0) > Date.now();
    if (!ok && !window.location.href.includes('index.html')) {
      window.location.href = '/index.html#login';
      return false;
    }
  }

  // Configure GameContext
  if (window.GameContext && options.context !== false) {
    GameContext.configure({
      apiBase: window.GSDS_API_BASE,
      server: !!window.GSDS_SERVER_SYNC,
      pollMs: Number(window.GSDS_POLL_MS || 1000)
    });
  }

  return true;
}

/**
 * Mount status UI to an element
 */
export function mountStatus(selector) {
  if (window.GSDSStatus) {
    return GSDSStatus.attach(selector);
  }
  return null;
}

/**
 * Create global status bar
 */
export function createGlobalStatus() {
  if (window.GSDSStatus) {
    return GSDSStatus.createGlobal();
  }
  return null;
}
