# Phase 3 — Server-Side Validation + Idempotency

## Overview
This phase moves trust to the server by implementing:
1. **Token-based authentication** — All requests must include a valid auth token
2. **Role-based permissions** — Actions restricted by user role (ADMIN, COACH, STAFF, WELLNESS)
3. **Payload validation** — Server validates required fields and formats
4. **Idempotency enforcement** — Duplicate writes are prevented via idempotency keys

## Files Added/Modified

### GAS Backend (`/gas/`)
- `Code.gs` — Main server-side code with:
  - Token auth (Sessions sheet)
  - Permission enforcement
  - Payload validation
  - Idempotency with LockService + dedupe_log sheet
  - Standardized JSON responses
- `README.md` — Deployment instructions

### Frontend (`/js/`)
- `api.js` — Updated to:
  - Auto-attach auth_token to all requests
  - Store/retrieve token from localStorage
  - Handle AUTH_REQUIRED / TOKEN_EXPIRED with auto-redirect
  - Add `makeIdempotencyKey()` helper
  - Expose auth helpers: `getAuthToken()`, `setAuthToken()`, `isAuthenticated()`, etc.
- `status-ui.js` — Updated to handle "already_saved" as success

## New Sheet Tabs Required

### 1. Sessions (for token storage)
Columns: token, user_id, username, role, issued_at, expires_at, revoked, last_seen_at

### 2. dedupe_log (for idempotency)
Columns: idempotency_key, created_at, user_id, action, target_sheet, row_id, payload_hash, status, note

## Action Permissions

| Action | Allowed Roles |
|--------|--------------|
| auth_login | PUBLIC (no token required) |
| ctx_get/set | ADMIN, COACH, STAFF |
| presence_get/set | ADMIN, COACH, STAFF |
| table | ADMIN, COACH, STAFF, WELLNESS |
| append | ADMIN, COACH, STAFF, WELLNESS (sheet-restricted) |
| tryout_* | ADMIN, COACH, STAFF |
| next_id | ADMIN, COACH, STAFF |

## Testing Guide

### 1. Auth Token Validation
```bash
# Test without token (should fail)
curl -X POST "YOUR_GAS_URL" \
  -H "Content-Type: text/plain" \
  -d '{"action":"ctx_get"}'
# Expected: { ok: false, error: { code: "AUTH_REQUIRED" } }
```

### 2. Idempotency Test
```javascript
// In browser console
const key = API.makeIdempotencyKey('test');

// First request
const res1 = await API.append('test_sheet', { name: 'Test' }, [], key);
console.log(res1.data.status); // "saved"

// Second request with same key
const res2 = await API.append('test_sheet', { name: 'Test' }, [], key);
console.log(res2.data.status); // "already_saved"
```

### 3. Double-Click Prevention
1. Open any form page (e.g., tryout station)
2. Fill form and double-click Submit quickly
3. Check target sheet — only one row should appear
4. Check dedupe_log — should show one "saved" entry

### 4. Token Expiration
1. Login and wait 12+ hours (or manually delete token from localStorage)
2. Try to submit form
3. Should redirect to login page with message "Session expired"

## Migration Notes

### Backward Compatibility
- Set `CONFIG.GRACE_PERIOD` in `gas/Code.gs` to an ISO date for transition period
- During grace period, requests without tokens are allowed but logged
- Grace period should be removed after all users have refreshed and obtained new tokens

### Client Token Storage
Tokens are stored in localStorage under `gsds_auth_token`:
- Shared across tabs (localStorage)
- Auto-attached to all API requests
- Cleared on logout or when expired

### Deployment Steps
1. Deploy updated GAS code to Web App
2. Create Sessions and dedupe_log sheets in target spreadsheet
3. Set `GRACE_PERIOD` to 1 week from now for transition
4. Update frontend with new api.js
5. Test thoroughly
6. Remove `GRACE_PERIOD` after transition complete

## Debug Commands (Browser Console)

```javascript
// Check auth status
API.isAuthenticated()
API.getAuthUser()
API.getAuthToken()

// Generate idempotency key
API.makeIdempotencyKey('my_prefix')

// Force logout
API.clearAuth()

// Check last error
API._debug.lastError
```
