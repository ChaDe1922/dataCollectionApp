# Form Schemas System (Phase 4)

## Overview
The schema-driven form system allows creating new position forms with minimal code—just a JSON schema configuration and a thin HTML wrapper. No bespoke JavaScript logic required.

## Files

```
/js/forms/
  form-engine.js       # Core rendering and submission engine
  payload-builders.js  # Functions that map form state to sheet rows

/forms/schemas/
  game-rb.schema.js    # Example: RB rush tracking form

/forms/pages/
  game-form.html       # Generic page that loads schemas via query param

/forms/
  migrate-notes.md     # Detailed migration guide
```

## Quick Start

### Accessing the Schema-Driven Form

Open the generic form page with a schema parameter:

```
/forms/pages/game-form.html?schema=game-rb
```

### Creating a New Form

1. **Create schema file** in `/forms/schemas/{name}.schema.js`
2. **Add payload builder** in `/js/forms/payload-builders.js`
3. **Link to form** with query param: `?schema={name}`

See `/forms/migrate-notes.md` for detailed instructions.

## Schema Format

```javascript
const schema = {
  key: "game-rb",
  title: "Game Day — RB Tracking",
  module: "game",
  version: 1,

  requirements: {
    auth: true,
    context: { type: "game" },
    playerPicker: true
  },

  sheet: {
    action: "append",
    tab: "22_Fact_RushDetail",
    idempotencyPrefix: "game_rb"
  },

  ui: {
    showContextBanner: true,
    showRepCounter: false,
    postSubmit: "clearFields"
  },

  fields: [
    { id: "scheme", label: "Scheme", type: "radio", required: true, options: [...] },
    { id: "yards", label: "Yards", type: "number", quickButtons: [...] },
    { id: "td", label: "Touchdown", type: "toggle", default: "No" }
  ],

  payload: { builder: "gameRbRow" }
};
```

## Supported Field Types

- `text` — Text input
- `number` — Number input with optional quick buttons
- `select` — Dropdown
- `toggle` — Yes/No toggle button
- `radio` — Segmented button group
- `grade` — Grade buttons (3-tier or custom)
- `notes` — Textarea
- `hidden` — Hidden input from context

## Architecture

```
Schema (JSON config)
    ↓
FormEngine.render()
    ↓
DOM (player picker, fields, submit button)
    ↓
User input → State
    ↓
PayloadBuilders[schema.payload.builder](state)
    ↓
API.request() with idempotency_key
    ↓
GAS Server → Sheet
```

## Features

- ✅ Automatic auth token attachment
- ✅ Automatic idempotency key generation
- ✅ Consistent GSDSStatus UI (Saving → Saved/Failed + Retry)
- ✅ Player picker with roster integration
- ✅ Context banner from GameContext
- ✅ Validation (required fields, player selection)
- ✅ Post-submit behaviors (clear, increment rep)
- ✅ Works alongside existing pages (incremental migration)

## Testing

1. Open `/forms/pages/game-form.html?schema=game-rb`
2. Login if needed
3. Select a player
4. Fill fields and submit
5. Verify row appears in `22_Fact_RushDetail`
6. Double-click submit quickly — only one row should appear (idempotency)
7. Retry after failure — same idempotency key prevents duplicates

## Migration Status

| Page | Status | Schema |
|------|--------|--------|
| game-rb.html | Migrated | game-rb |
| Other pages | Not yet | — |

Existing pages continue to work. Migrate one at a time as needed.
