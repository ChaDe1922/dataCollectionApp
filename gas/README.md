# Google Apps Script (GAS) Backend

This folder contains the server-side Google Apps Script code for the GSDS application.

## Sheet Tabs Required

### Auth_Users (existing)
Stores user credentials and roles.
- username (string)
- password_hash (string)
- role (string: ADMIN, COACH, STAFF, WELLNESS)
- user_id (string)
- active (boolean)

### Sessions (new for Phase 3)
Stores active authentication tokens.
- token (string, unique)
- user_id (string)
- username (string)
- role (string)
- issued_at (ISO timestamp)
- expires_at (ISO timestamp)
- revoked (boolean)
- last_seen_at (ISO timestamp)

### dedupe_log (new for Phase 3)
Stores idempotency keys for write deduplication.
- idempotency_key (string, unique)
- created_at (ISO timestamp)
- user_id (string)
- action (string)
- target_sheet (string)
- row_id (string, optional)
- payload_hash (string)
- status (string: "saved" | "already_saved")
- note (string, optional)

## Deployment

1. Open Google Apps Script: https://script.google.com
2. Create new project
3. Copy all .gs files into the script editor
4. Deploy as Web App:
   - Execute as: Me
   - Who has access: Anyone
5. Copy the Web App URL to js/config.js as GSDS_API_BASE

## Script Properties (for secrets)

Set in File > Project Properties > Script Properties:
- TOKEN_SECRET: A random string for HMAC (if using stateless tokens)
- GRACE_PERIOD_UNTIL: ISO timestamp for auth grace period (optional)
