/**
 * GSDS Centralized Configuration
 * =================================
 * Single source of truth for API endpoints and feature flags.
 *
 * HOW TO SWITCH ENVIRONMENTS:
 *   1. Edit the ENV constant below to "prod" or "dev"
 *   2. Reload the page
 *   3. Done! All modules will use the selected environment.
 *
 * CONFIGURATION OPTIONS:
 *   - apiBase: URL to the Google Apps Script Web App endpoint
 *   - serverSync: Enable cross-device sync via server polling (true/false)
 *   - pollMs: Polling interval in milliseconds (default: 1000)
 *
 * BACKWARDS COMPATIBILITY:
 *   - window.API_BASE is set to window.GSDS_API_BASE for legacy code
 *   - Meta tag detection still works as fallback in api.js
 */

// ==========================================
// ENVIRONMENT SWITCH - EDIT THIS LINE ONLY
// ==========================================
const ENV = "prod"; // Change to "dev" for development

// ==========================================
// ENVIRONMENT CONFIGURATIONS
// ==========================================
const CONFIG = {
  prod: {
    apiBase: "https://script.google.com/macros/s/AKfycbxQk6BgJLkZltXX7xijq9QKmTEfB51M65cHzrYCe6SCTykrSWnFDMecXfiLGRTd9iOCLg/exec",
    serverSync: true,
    pollMs: 1000
  },
  dev: {
    // For now, dev points to the same endpoint as prod.
    // To use a different dev endpoint, replace the URL below:
    // apiBase: "https://script.google.com/macros/s/YOUR_DEV_DEPLOYMENT_ID/exec",
    apiBase: "https://script.google.com/macros/s/AKfycbxQk6BgJLkZltXX7xijq9QKmTEfB51M65cHzrYCe6SCTykrSWnFDMecXfiLGRTd9iOCLg/exec",
    serverSync: true,
    pollMs: 1000
  }
};

// ==========================================
// APPLY SELECTED ENVIRONMENT
// ==========================================
const active = CONFIG[ENV] || CONFIG.prod;

window.GSDS_ENV = ENV;
window.GSDS_API_BASE = active.apiBase;
window.GSDS_SERVER_SYNC = !!active.serverSync;
window.GSDS_POLL_MS = Number(active.pollMs || 1000);

// Backwards compatibility: also set window.API_BASE
window.API_BASE = window.GSDS_API_BASE;

// ==========================================
// DEBUG LOGGING (optional)
// ==========================================
if (window.GSDS_DEBUG === true) {
  console.log("[GSDS Config] Environment:", ENV);
  console.log("[GSDS Config] API Base:", window.GSDS_API_BASE);
  console.log("[GSDS Config] Server Sync:", window.GSDS_SERVER_SYNC);
  console.log("[GSDS Config] Poll Interval:", window.GSDS_POLL_MS, "ms");
}
