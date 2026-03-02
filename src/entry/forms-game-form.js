/**
 * Entry point: forms/pages/game-form.html (Schema-driven form)
 */
import { bootstrap } from '../../entry/bootstrap.js';

// Import form engine components
import '../../../js/forms/form-engine.js';
import '../../../js/forms/payload-builders.js';
import '../../../js/tryout-ui.js';

// Bootstrap
bootstrap({ auth: true, context: true });

// Schema registry and boot
const SchemaRegistry = {
  'game-rb': null,
  'game-qb': null,
  'game-wr': null,
  'tryout-rb': null,
  'tryout-wr': null
};

// Get schema from query param
function getSchemaKey() {
  const params = new URLSearchParams(window.location.search);
  return params.get('schema') || 'game-rb';
}

// Load schema - for now, rely on inline script tag in HTML
// Dynamic imports with variables cause issues in Vite builds
async function loadSchema(key) {
  // Schema should be loaded via <script> tag in HTML
  // Check window for schema object
  const schemaVar = window[key.replace(/-/g, '') + 'Schema'] ||
                   window[key + 'Schema'] ||
                   window.gameRbSchema;
  return schemaVar || null;
}

// Boot the form
async function boot() {
  const schemaKey = getSchemaKey();

  // Try inline schema first
  let schema = window[schemaKey.replace(/-/g, '') + 'Schema'] ||
               window[schemaKey + 'Schema'] ||
               window.gameRbSchema;

  if (!schema) {
    schema = await loadSchema(schemaKey);
  }

  if (!schema) {
    document.getElementById('app').innerHTML =
      `<p class="error">Error: Schema "${schemaKey}" not found.</p>`;
    return;
  }

  document.getElementById('pageTitle').textContent = schema.title || schemaKey;

  // Configure GameContext
  if (window.GameContext) {
    GameContext.configure({
      apiBase: window.GSDS_API_BASE,
      server: !!window.GSDS_SERVER_SYNC,
      pollMs: Number(window.GSDS_POLL_MS || 1000)
    });
  }

  // Initialize form engine
  if (window.FormEngine) {
    const engine = new FormEngine({
      schema: schema,
      mount: '#app',
      status: '#status'
    });

    await engine.init();
  }
}

// Start
document.addEventListener('DOMContentLoaded', boot);
