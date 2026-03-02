/**
 * GSDS Server-Side Validation + Idempotency (Phase 3)
 * Main entry point for Google Apps Script Web App
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  AUTH_USERS_SHEET: 'Auth_Users',
  SESSIONS_SHEET: 'Sessions',
  DEDUPE_LOG_SHEET: 'dedupe_log',
  TOKEN_TTL_HOURS: 12,
  LOCK_TIMEOUT_MS: 30000, // 30 seconds max for write operations
  GRACE_PERIOD: null // Set to ISO date like '2026-03-15T00:00:00Z' for transition
};

// Action permissions by role
const PERMISSIONS = {
  // Public actions (no auth required)
  auth_login: ['PUBLIC'],

  // Context actions
  ctx_get: ['ADMIN', 'COACH', 'STAFF'],
  ctx_set: ['ADMIN', 'COACH', 'STAFF'],

  // Presence actions
  presence_get: ['ADMIN', 'COACH', 'STAFF'],
  presence_set: ['ADMIN', 'COACH', 'STAFF'],

  // Data read actions
  table: ['ADMIN', 'COACH', 'STAFF', 'WELLNESS'],
  tryout_roster: ['ADMIN', 'COACH', 'STAFF'],
  tryout_periods: ['ADMIN', 'COACH', 'STAFF'],
  tryout_drilldict: ['ADMIN', 'COACH', 'STAFF'],
  tryout_groups_get: ['ADMIN', 'COACH', 'STAFF'],

  // Write actions
  append: ['ADMIN', 'COACH', 'STAFF', 'WELLNESS'],
  next_id: ['ADMIN', 'COACH', 'STAFF'],
  tryout_groups_set: ['ADMIN', 'COACH', 'STAFF']
};

// Sheet whitelist for append operations (security)
const ALLOWED_APPEND_SHEETS = [
  'wellness_daily',
  'tryout_station',
  'tryout_agility',
  'tryout_1v1',
  'tryout_team',
  'game_ol',
  'game_qb',
  'game_rb',
  'game_wr',
  'game_te',
  'game_db',
  'game_dl',
  'game_lb',
  'game_coverage',
  'practice_attendance',
  'practice_cond',
  'practice_ol',
  'practice_qb',
  'practice_rb',
  'practice_wr',
  'practice_db',
  'practice_dl',
  'practice_lb',
  'practice_st',
  'practice_team',
  'practice_1v1',
  'penalties',
  'pass_pro',
  'run_block',
  'tackles',
  'pass_rush',
  'run_defense'
];

// ============================================================================
// ENTRY POINTS
// ============================================================================

function doGet(e) {
  const requestId = generateRequestId();
  try {
    const params = e.parameter || {};
    return handleRequest(params, 'GET', requestId);
  } catch (err) {
    return jsonResponse({ ok: false, error: { code: 'INTERNAL_ERROR', message: err.message }, request_id: requestId }, 500);
  }
}

function doPost(e) {
  const requestId = generateRequestId();
  try {
    const payload = parsePayload(e);
    return handleRequest(payload, 'POST', requestId);
  } catch (err) {
    return jsonResponse({ ok: false, error: { code: 'INTERNAL_ERROR', message: err.message }, request_id: requestId }, 500);
  }
}

// ============================================================================
// REQUEST HANDLER
// ============================================================================

function handleRequest(data, method, requestId) {
  const action = data.action;

  // Validate action exists
  if (!action || typeof action !== 'string') {
    return jsonResponse({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing or invalid action' }, request_id: requestId }, 400);
  }

  // Auth login is special - no token required
  if (action === 'auth_login') {
    return handleAuthLogin(data, requestId);
  }

  // Grace period check (transition helper)
  if (isGracePeriod()) {
    // Log warning but allow request
    console.warn(`[${requestId}] Grace period: allowing request without token`);
  } else {
    // Require authentication for all other actions
    const authResult = validateToken(data.auth_token);
    if (!authResult.valid) {
      return jsonResponse({ ok: false, error: { code: 'AUTH_REQUIRED', message: authResult.error }, request_id: requestId }, 401);
    }

    // Check permissions
    const allowedRoles = PERMISSIONS[action] || [];
    if (!allowedRoles.includes('PUBLIC') && !allowedRoles.includes(authResult.role)) {
      return jsonResponse({ ok: false, error: { code: 'FORBIDDEN', message: `Role '${authResult.role}' not allowed for action '${action}'` }, request_id: requestId }, 403);
    }

    // Attach auth context to data
    data._auth = {
      user_id: authResult.user_id,
      username: authResult.username,
      role: authResult.role,
      token: authResult.token
    };

    // Update last seen
    updateSessionLastSeen(authResult.token);
  }

  // Route to action handler
  const handlers = {
    // Context
    ctx_get: handleCtxGet,
    ctx_set: handleCtxSet,

    // Presence
    presence_get: handlePresenceGet,
    presence_set: handlePresenceSet,

    // Data
    table: handleTable,
    next_id: handleNextId,
    append: handleAppend,

    // Tryout
    tryout_roster: handleTryoutRoster,
    tryout_periods: handleTryoutPeriods,
    tryout_drilldict: handleTryoutDrillDict,
    tryout_groups_get: handleTryoutGroupsGet,
    tryout_groups_set: handleTryoutGroupsSet
  };

  const handler = handlers[action];
  if (!handler) {
    return jsonResponse({ ok: false, error: { code: 'BAD_REQUEST', message: `Unknown action: ${action}` }, request_id: requestId }, 400);
  }

  return handler(data, requestId);
}

// ============================================================================
// AUTHENTICATION
// ============================================================================

function handleAuthLogin(data, requestId) {
  const { sheet_id, sheet_name, username, password } = data;

  // Validate required fields
  if (!username || !password) {
    return jsonResponse({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing username or password' }, request_id: requestId }, 400);
  }

  try {
    // Look up user in Auth_Users sheet
    const ss = SpreadsheetApp.openById(sheet_id);
    const sheet = ss.getSheetByName(sheet_name || CONFIG.AUTH_USERS_SHEET);
    if (!sheet) {
      return jsonResponse({ ok: false, error: { code: 'NOT_FOUND', message: 'Auth sheet not found' }, request_id: requestId }, 404);
    }

    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();
    const headers = values[0];

    // Find user row
    let userRow = null;
    for (let i = 1; i < values.length; i++) {
      if (values[i][0] === username) {
        userRow = values[i];
        break;
      }
    }

    if (!userRow) {
      return jsonResponse({ ok: false, error: { code: 'AUTH_FAILED', message: 'Invalid credentials' }, request_id: requestId }, 401);
    }

    // Check password (simple comparison for now - consider bcrypt in future)
    const passwordHash = userRow[1]; // column B
    const role = userRow[2] || 'STAFF'; // column C
    const active = userRow[4] !== false && userRow[4] !== 'false'; // column E

    if (!active) {
      return jsonResponse({ ok: false, error: { code: 'AUTH_FAILED', message: 'Account inactive' }, request_id: requestId }, 401);
    }

    // Simple password check (in production, use proper hashing)
    if (!verifyPassword(password, passwordHash)) {
      return jsonResponse({ ok: false, error: { code: 'AUTH_FAILED', message: 'Invalid credentials' }, request_id: requestId }, 401);
    }

    // Generate and store session token
    const userId = userRow[3] || username; // column D or fallback to username
    const token = generateToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CONFIG.TOKEN_TTL_HOURS * 60 * 60 * 1000);

    // Store session
    storeSession(token, userId, username, role, now.toISOString(), expiresAt.toISOString());

    return jsonResponse({
      ok: true,
      data: {
        token: token,
        user_id: userId,
        username: username,
        role: role,
        expires_at: expiresAt.toISOString()
      },
      request_id: requestId
    });

  } catch (err) {
    console.error(`[${requestId}] Auth error:`, err);
    return jsonResponse({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Authentication failed' }, request_id: requestId }, 500);
  }
}

function validateToken(token) {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Missing auth token' };
  }

  try {
    const sessions = getSessionsSheet();
    if (!sessions) {
      return { valid: false, error: 'Session store unavailable' };
    }

    const dataRange = sessions.getDataRange();
    const values = dataRange.getValues();

    // Find token row
    for (let i = 1; i < values.length; i++) {
      if (values[i][0] === token) {
        const revoked = values[i][5] === true || values[i][5] === 'true';
        const expiresAt = new Date(values[i][4]);
        const now = new Date();

        if (revoked) {
          return { valid: false, error: 'Token revoked' };
        }

        if (now > expiresAt) {
          return { valid: false, error: 'Token expired' };
        }

        return {
          valid: true,
          token: token,
          user_id: values[i][1],
          username: values[i][2],
          role: values[i][3]
        };
      }
    }

    return { valid: false, error: 'Invalid token' };
  } catch (err) {
    console.error('Token validation error:', err);
    return { valid: false, error: 'Token validation failed' };
  }
}

function storeSession(token, userId, username, role, issuedAt, expiresAt) {
  const sessions = getOrCreateSheet(CONFIG.SESSIONS_SHEET, ['token', 'user_id', 'username', 'role', 'issued_at', 'expires_at', 'revoked', 'last_seen_at']);

  // Check if token already exists (shouldn't happen, but handle gracefully)
  const dataRange = sessions.getDataRange();
  const values = dataRange.getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === token) {
      // Update existing
      sessions.getRange(i + 1, 7).setValue(false); // revoked = false
      sessions.getRange(i + 1, 8).setValue(new Date().toISOString()); // last_seen_at
      return;
    }
  }

  // Append new session
  sessions.appendRow([token, userId, username, role, issuedAt, expiresAt, false, new Date().toISOString()]);
}

function updateSessionLastSeen(token) {
  try {
    const sessions = getSessionsSheet();
    if (!sessions) return;

    const dataRange = sessions.getDataRange();
    const values = dataRange.getValues();

    for (let i = 1; i < values.length; i++) {
      if (values[i][0] === token) {
        sessions.getRange(i + 1, 8).setValue(new Date().toISOString());
        break;
      }
    }
  } catch (err) {
    console.error('Update last seen error:', err);
  }
}

function getSessionsSheet() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    return ss.getSheetByName(CONFIG.SESSIONS_SHEET);
  } catch (e) {
    return null;
  }
}

// ============================================================================
// IDEMPOTENCY
// ============================================================================

function checkIdempotency(idempotencyKey, userId, action, targetSheet, payloadHash) {
  if (!idempotencyKey) {
    return { ok: false, error: 'Missing idempotency_key' };
  }

  const dedupeSheet = getOrCreateSheet(CONFIG.DEDUPE_LOG_SHEET,
    ['idempotency_key', 'created_at', 'user_id', 'action', 'target_sheet', 'row_id', 'payload_hash', 'status', 'note']);

  const dataRange = dedupeSheet.getDataRange();
  const values = dataRange.getValues();

  // Search for existing key
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === idempotencyKey) {
      return {
        ok: true,
        duplicate: true,
        data: {
          status: 'already_saved',
          idempotency_key: idempotencyKey,
          created_at: values[i][1],
          user_id: values[i][2],
          action: values[i][3],
          target_sheet: values[i][4]
        }
      };
    }
  }

  return { ok: true, duplicate: false };
}

function recordIdempotency(idempotencyKey, userId, action, targetSheet, rowId, payloadHash, status, note) {
  const dedupeSheet = getOrCreateSheet(CONFIG.DEDUPE_LOG_SHEET,
    ['idempotency_key', 'created_at', 'user_id', 'action', 'target_sheet', 'row_id', 'payload_hash', 'status', 'note']);

  const now = new Date().toISOString();
  dedupeSheet.appendRow([idempotencyKey, now, userId, action, targetSheet || '', rowId || '', payloadHash || '', status, note || '']);
}

function hashPayload(payload) {
  // Simple hash for deduplication debugging
  const str = JSON.stringify(payload);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(16);
}

// ============================================================================
// ACTION HANDLERS (context)
// ============================================================================

function handleCtxGet(data, requestId) {
  // Context is stored in ScriptProperties for fast access
  const ctxJson = PropertiesService.getScriptProperties().getProperty('gsds_ctx');
  const ctx = ctxJson ? JSON.parse(ctxJson) : { game_id: '', drive_id: '', play_id: '', ts: 0 };

  return jsonResponse({ ok: true, data: { ctx: ctx, ok: true }, request_id: requestId });
}

function handleCtxSet(data, requestId) {
  // Validate required fields
  if (!data.game_id && !data.tryout_id) {
    return jsonResponse({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing game_id or tryout_id' }, request_id: requestId }, 400);
  }

  // Check idempotency if key provided
  if (data.idempotency_key) {
    const dedupeCheck = checkIdempotency(data.idempotency_key, data._auth?.user_id, 'ctx_set', 'ctx', hashPayload(data));
    if (!dedupeCheck.ok) {
      return jsonResponse({ ok: false, error: { code: 'IDEMPOTENCY_REQUIRED', message: dedupeCheck.error }, request_id: requestId }, 400);
    }
    if (dedupeCheck.duplicate) {
      return jsonResponse({ ok: true, data: dedupeCheck.data, request_id: requestId });
    }
  }

  // Update context
  const ctx = {
    game_id: data.game_id || data.tryout_id || '',
    drive_id: data.drive_id || data.station_id || '',
    play_id: data.play_id || data.rep_id || '',
    ts: Date.now()
  };

  PropertiesService.getScriptProperties().setProperty('gsds_ctx', JSON.stringify(ctx));

  // Record idempotency if key provided
  if (data.idempotency_key) {
    recordIdempotency(data.idempotency_key, data._auth?.user_id, 'ctx_set', 'ctx', '', hashPayload(data), 'saved', '');
  }

  return jsonResponse({ ok: true, data: { ctx: ctx, ok: true }, request_id: requestId });
}

// ============================================================================
// ACTION HANDLERS (presence)
// ============================================================================

function handlePresenceGet(data, requestId) {
  // Get presence data from ScriptProperties
  const key = 'gsds_presence:' + (data.tryout_id || 'default');
  const presenceJson = PropertiesService.getScriptProperties().getProperty(key);
  const presence = presenceJson ? JSON.parse(presenceJson) : { players: [], meta: {}, updated_at: Date.now() };

  return jsonResponse({ ok: true, data: { ...presence, ok: true }, request_id: requestId });
}

function handlePresenceSet(data, requestId) {
  // Validate required fields
  if (!data.tryout_id) {
    return jsonResponse({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing tryout_id' }, request_id: requestId }, 400);
  }

  // Check idempotency
  if (data.idempotency_key) {
    const dedupeCheck = checkIdempotency(data.idempotency_key, data._auth?.user_id, 'presence_set', 'presence', hashPayload(data));
    if (!dedupeCheck.ok) {
      return jsonResponse({ ok: false, error: { code: 'IDEMPOTENCY_REQUIRED', message: dedupeCheck.error }, request_id: requestId }, 400);
    }
    if (dedupeCheck.duplicate) {
      return jsonResponse({ ok: true, data: dedupeCheck.data, request_id: requestId });
    }
  }

  // Update presence
  const presence = {
    tryout_id: data.tryout_id,
    group: data.group || '',
    players: data.players || [],
    meta: data.meta || {},
    updated_at: Date.now(),
    updated_by: data._auth?.user_id || 'unknown'
  };

  const key = 'gsds_presence:' + data.tryout_id;
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(presence));

  // Record idempotency
  if (data.idempotency_key) {
    recordIdempotency(data.idempotency_key, data._auth?.user_id, 'presence_set', 'presence', '', hashPayload(data), 'saved', '');
  }

  return jsonResponse({ ok: true, data: { ...presence, ok: true }, request_id: requestId });
}

// ============================================================================
// ACTION HANDLERS (data)
// ============================================================================

function handleTable(data, requestId) {
  const { sheet_id, sheet_name } = data;

  if (!sheet_id || !sheet_name) {
    return jsonResponse({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing sheet_id or sheet_name' }, request_id: requestId }, 400);
  }

  try {
    const ss = SpreadsheetApp.openById(sheet_id);
    const sheet = ss.getSheetByName(sheet_name);
    if (!sheet) {
      return jsonResponse({ ok: false, error: { code: 'NOT_FOUND', message: `Sheet '${sheet_name}' not found` }, request_id: requestId }, 404);
    }

    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();
    const headers = values[0];

    const rows = [];
    for (let i = 1; i < values.length; i++) {
      const row = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]] = values[i][j];
      }
      rows.push(row);
    }

    return jsonResponse({ ok: true, data: { rows: rows, count: rows.length }, request_id: requestId });
  } catch (err) {
    console.error(`[${requestId}] Table error:`, err);
    return jsonResponse({ ok: false, error: { code: 'INTERNAL_ERROR', message: err.message }, request_id: requestId }, 500);
  }
}

function handleNextId(data, requestId) {
  const { prefix } = data;

  if (!prefix || typeof prefix !== 'string') {
    return jsonResponse({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing or invalid prefix' }, request_id: requestId }, 400);
  }

  try {
    // Get or create counter in ScriptProperties
    const countersJson = PropertiesService.getScriptProperties().getProperty('gsds_counters') || '{}';
    const counters = JSON.parse(countersJson);

    const current = counters[prefix] || 0;
    const next = current + 1;
    counters[prefix] = next;

    PropertiesService.getScriptProperties().setProperty('gsds_counters', JSON.stringify(counters));

    // Format ID with padding
    const id = `${prefix}_${String(next).padStart(6, '0')}`;

    return jsonResponse({ ok: true, data: { id: id, prefix: prefix, sequence: next }, request_id: requestId });
  } catch (err) {
    console.error(`[${requestId}] Next ID error:`, err);
    return jsonResponse({ ok: false, error: { code: 'INTERNAL_ERROR', message: err.message }, request_id: requestId }, 500);
  }
}

function handleAppend(data, requestId) {
  const { route, row, ensure_headers, idempotency_key } = data;

  // Validate target sheet
  if (!route || !ALLOWED_APPEND_SHEETS.includes(route)) {
    return jsonResponse({ ok: false, error: { code: 'FORBIDDEN', message: `Target sheet '${route}' not in allowlist` }, request_id: requestId }, 403);
  }

  // Validate row data
  if (!row || typeof row !== 'object') {
    return jsonResponse({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing or invalid row data' }, request_id: requestId }, 400);
  }

  // Require idempotency key for writes
  if (!idempotency_key) {
    return jsonResponse({ ok: false, error: { code: 'IDEMPOTENCY_REQUIRED', message: 'Missing idempotency_key for write operation' }, request_id: requestId }, 400);
  }

  // Check idempotency before acquiring lock (fast path)
  const payloadHash = hashPayload(data);
  const dedupeCheck = checkIdempotency(idempotency_key, data._auth?.user_id, 'append', route, payloadHash);
  if (!dedupeCheck.ok) {
    return jsonResponse({ ok: false, error: { code: 'IDEMPOTENCY_REQUIRED', message: dedupeCheck.error }, request_id: requestId }, 400);
  }
  if (dedupeCheck.duplicate) {
    return jsonResponse({ ok: true, data: { ...dedupeCheck.data, row_id: null }, request_id: requestId });
  }

  // Acquire lock for write + dedupe recording
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  } catch (err) {
    return jsonResponse({ ok: false, error: { code: 'LOCK_TIMEOUT', message: 'Could not acquire write lock' }, request_id: requestId }, 503);
  }

  try {
    // Double-check idempotency under lock
    const doubleCheck = checkIdempotency(idempotency_key, data._auth?.user_id, 'append', route, payloadHash);
    if (doubleCheck.duplicate) {
      lock.releaseLock();
      return jsonResponse({ ok: true, data: { ...doubleCheck.data, row_id: null }, request_id: requestId });
    }

    // Get or create target sheet
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getOrCreateSheet(route, ensure_headers || []);

    // Ensure headers if provided and sheet is new/empty
    if (ensure_headers && ensure_headers.length > 0) {
      const existingHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      if (existingHeaders.length === 0 || (existingHeaders.length === 1 && !existing_headers[0])) {
        // Sheet is empty, add headers
        sheet.appendRow(ensure_headers);
      }
    }

    // Build row array from headers or object keys
    let rowArray;
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    if (headers.length > 0 && headers[0]) {
      // Match object keys to headers
      rowArray = headers.map(h => row[h] !== undefined ? row[h] : '');
    } else {
      // No headers yet, use object values directly
      rowArray = Object.values(row);
      // Set headers from keys if this is first row
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(Object.keys(row));
      }
    }

    // Add metadata columns if not present
    const metaColumns = ['_created_at', '_created_by', '_idempotency_key'];
    const needsMeta = metaColumns.some(c => !headers.includes(c));
    if (needsMeta && headers.length > 0) {
      // Add meta headers if sheet already has headers
      const newHeaders = [...headers, ...metaColumns.filter(c => !headers.includes(c))];
      sheet.getRange(1, 1, 1, newHeaders.length).setValues([newHeaders]);
    }

    // Append metadata
    const now = new Date().toISOString();
    const rowWithMeta = [
      ...rowArray,
      now,
      data._auth?.user_id || 'unknown',
      idempotency_key
    ];

    // Append the row
    sheet.appendRow(rowWithMeta);
    const rowId = sheet.getLastRow();

    // Record idempotency
    recordIdempotency(idempotency_key, data._auth?.user_id, 'append', route, String(rowId), payloadHash, 'saved', '');

    lock.releaseLock();

    return jsonResponse({
      ok: true,
      data: {
        status: 'saved',
        row_id: rowId,
        idempotency_key: idempotency_key,
        created_at: now
      },
      request_id: requestId
    });

  } catch (err) {
    lock.releaseLock();
    console.error(`[${requestId}] Append error:`, err);
    return jsonResponse({ ok: false, error: { code: 'INTERNAL_ERROR', message: err.message }, request_id: requestId }, 500);
  }
}

// ============================================================================
// ACTION HANDLERS (tryout)
// ============================================================================

function handleTryoutRoster(data, requestId) {
  return handleTable({ ...data, sheet_name: '00_Dim_Roster' }, requestId);
}

function handleTryoutPeriods(data, requestId) {
  return handleTable({ ...data, sheet_name: 'tryout_periods' }, requestId);
}

function handleTryoutDrillDict(data, requestId) {
  return handleTable({ ...data, sheet_name: 'drill_dict' }, requestId);
}

function handleTryoutGroupsGet(data, requestId) {
  const { tryout_id, latest } = data;

  if (!tryout_id) {
    return jsonResponse({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing tryout_id' }, request_id: requestId }, 400);
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('tryout_groups');
    if (!sheet) {
      return jsonResponse({ ok: false, error: { code: 'NOT_FOUND', message: 'tryout_groups sheet not found' }, request_id: requestId }, 404);
    }

    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();
    const headers = values[0];

    const rows = [];
    for (let i = 1; i < values.length; i++) {
      const row = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]] = values[i][j];
      }
      if (row.tryout_id === tryout_id || !tryout_id) {
        rows.push(row);
      }
    }

    // If latest flag, return only most recent per group
    if (latest && rows.length > 0) {
      const byGroup = {};
      rows.forEach(r => {
        const key = r.group_code || r.group;
        if (!byGroup[key] || new Date(r.updated_at) > new Date(byGroup[key].updated_at)) {
          byGroup[key] = r;
        }
      });
      return jsonResponse({ ok: true, data: { groups: Object.values(byGroup), count: Object.values(byGroup).length }, request_id: requestId });
    }

    return jsonResponse({ ok: true, data: { groups: rows, count: rows.length }, request_id: requestId });
  } catch (err) {
    console.error(`[${requestId}] Groups get error:`, err);
    return jsonResponse({ ok: false, error: { code: 'INTERNAL_ERROR', message: err.message }, request_id: requestId }, 500);
  }
}

function handleTryoutGroupsSet(data, requestId) {
  const { assignments, idempotency_key } = data;

  if (!assignments || !Array.isArray(assignments) || assignments.length === 0) {
    return jsonResponse({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing or invalid assignments' }, request_id: requestId }, 400);
  }

  // Require idempotency key
  if (!idempotency_key) {
    return jsonResponse({ ok: false, error: { code: 'IDEMPOTENCY_REQUIRED', message: 'Missing idempotency_key' }, request_id: requestId }, 400);
  }

  const payloadHash = hashPayload(data);
  const dedupeCheck = checkIdempotency(idempotency_key, data._auth?.user_id, 'tryout_groups_set', 'tryout_groups', payloadHash);
  if (!dedupeCheck.ok) {
    return jsonResponse({ ok: false, error: { code: 'IDEMPOTENCY_REQUIRED', message: dedupeCheck.error }, request_id: requestId }, 400);
  }
  if (dedupeCheck.duplicate) {
    return jsonResponse({ ok: true, data: dedupeCheck.data, request_id: requestId });
  }

  // Acquire lock
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  } catch (err) {
    return jsonResponse({ ok: false, error: { code: 'LOCK_TIMEOUT', message: 'Could not acquire write lock' }, request_id: requestId }, 503);
  }

  try {
    // Double-check under lock
    const doubleCheck = checkIdempotency(idempotency_key, data._auth?.user_id, 'tryout_groups_set', 'tryout_groups', payloadHash);
    if (doubleCheck.duplicate) {
      lock.releaseLock();
      return jsonResponse({ ok: true, data: doubleCheck.data, request_id: requestId });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getOrCreateSheet('tryout_groups',
      ['tryout_id', 'group_code', 'player_ids', 'updated_at', 'updated_by']);

    const now = new Date().toISOString();
    const updatedBy = data._auth?.user_id || 'unknown';

    for (const assignment of assignments) {
      const { tryout_id, group_code, player_ids } = assignment;
      if (!tryout_id || !group_code) continue;

      sheet.appendRow([tryout_id, group_code, JSON.stringify(player_ids || []), now, updatedBy]);
    }

    // Record idempotency
    recordIdempotency(idempotency_key, data._auth?.user_id, 'tryout_groups_set', 'tryout_groups', '', payloadHash, 'saved', `Set ${assignments.length} groups`);

    lock.releaseLock();

    return jsonResponse({
      ok: true,
      data: {
        status: 'saved',
        count: assignments.length,
        idempotency_key: idempotency_key
      },
      request_id: requestId
    });

  } catch (err) {
    lock.releaseLock();
    console.error(`[${requestId}] Groups set error:`, err);
    return jsonResponse({ ok: false, error: { code: 'INTERNAL_ERROR', message: err.message }, request_id: requestId }, 500);
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

function parsePayload(e) {
  if (e.postData && e.postData.contents) {
    try {
      return JSON.parse(e.postData.contents);
    } catch (err) {
      // Try as form data
      return e.parameter || {};
    }
  }
  return e.parameter || {};
}

function jsonResponse(data, httpStatus) {
  const status = httpStatus || (data.ok ? 200 : 400);
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function generateRequestId() {
  return 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

function generateToken() {
  return 'tok_' + Date.now() + '_' + Math.random().toString(36).substr(2, 16) + '_' + Math.random().toString(36).substr(2, 16);
}

function verifyPassword(password, hash) {
  // Simple hash comparison for now
  // In production, use proper bcrypt or PBKDF2
  const computedHash = simpleHash(password);
  return computedHash === hash || password === hash; // Allow plain text for transition
}

function simpleHash(str) {
  // Simple string hash (NOT cryptographically secure, but works for basic auth)
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return 'hash_' + Math.abs(hash).toString(16);
}

function getOrCreateSheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers && headers.length > 0) {
      sheet.appendRow(headers);
    }
  }
  return sheet;
}

function isGracePeriod() {
  if (!CONFIG.GRACE_PERIOD) return false;
  const graceDate = new Date(CONFIG.GRACE_PERIOD);
  return new Date() < graceDate;
}
