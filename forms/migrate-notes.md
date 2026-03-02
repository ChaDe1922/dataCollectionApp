# Form Schemas Migration Guide

## Overview
This guide explains how to convert existing position forms to schema-driven forms using the new FormEngine.

## Quick Start: Creating a New Form

### 1. Create a Schema File

Create a new file in `/forms/schemas/{form-key}.schema.js`:

```javascript
const myFormSchema = {
  key: "my-form",
  title: "My Form Title",
  module: "game",  // game | tryout | practice
  version: 1,

  requirements: {
    auth: true,
    context: { type: "game" },  // game | tryout | practice | none
    playerPicker: true
  },

  sheet: {
    action: "append",
    tab: "Sheet_Tab_Name",        // exact sheet tab name
    idempotencyPrefix: "my_form"  // prefix for idempotency keys
  },

  ui: {
    showContextBanner: true,
    showRepCounter: false,
    repLabel: "Play",
    layout: "card",
    postSubmit: "clearFields"  // clearFields | clearAll | incrementRep | none
  },

  fields: [
    // Field definitions...
  ],

  payload: {
    builder: "myFormRow"  // Reference to PayloadBuilders function
  }
};
```

### 2. Define Fields

Supported field types:

```javascript
// Text input
{ id: "notes", label: "Notes", type: "text", required: false, placeholder: "Enter notes..." }

// Number with quick buttons
{
  id: "yards",
  label: "Yards",
  type: "number",
  required: true,
  step: 1,
  quickButtons: [
    { label: "-3", value: -3 },
    { label: "0", value: 0 },
    { label: "+5", value: 5 }
  ]
}

// Select dropdown
{
  id: "result",
  label: "Result",
  type: "select",
  required: true,
  options: [
    { value: "success", label: "Success" },
    { value: "failure", label: "Failure" }
  ]
}

// Toggle (Yes/No)
{ id: "td", label: "Touchdown", type: "toggle", default: "No" }

// Radio buttons (segmented)
{
  id: "gap",
  label: "Gap",
  type: "radio",
  default: "B",
  options: [
    { value: "A", label: "A" },
    { value: "B", label: "B" },
    { value: "C", label: "C" }
  ]
}

// Grade buttons (3-tier)
{
  id: "grade",
  label: "Grade",
  type: "grade",
  grading: { type: "tier3" }  // Above/Average/Below
}

// Notes textarea
{ id: "notes", label: "Notes", type: "notes", rows: 3 }

// Hidden (context-injected)
{ id: "game_id", type: "hidden", contextKey: "game_id" }
```

### 3. Add Payload Builder

Edit `/js/forms/payload-builders.js` and add your builder function:

```javascript
myFormRow(state) {
  const { context, player, values, user, rep } = state;

  return {
    timestamp: new Date().toISOString(),
    game_id: context.game_id || '',
    player_id: player?.player_id || '',
    
    // Field values
    field_name: values.field_id || '',
    
    submitted_by: user?.username || 'unknown'
  };
}
```

### 4. Create Navigation Link

Add a link to the generic form page with your schema:

```html
<a href="/forms/pages/game-form.html?schema=my-form">My Form</a>
```

## Field Reference

### Common Field Properties

| Property | Type | Description |
|----------|------|-------------|
| id | string | Unique field identifier (required) |
| label | string | Display label |
| type | string | Field type (see below) |
| required | boolean | Whether field is required |
| default | any | Default value |
| placeholder | string | Placeholder text |

### Field Types

| Type | Description | Additional Properties |
|------|-------------|---------------------|
| text | Text input | placeholder |
| number | Number input | min, max, step, quickButtons |
| select | Dropdown | options (array of {value, label}) |
| toggle | Yes/No toggle | default: "Yes" or "No" |
| radio | Segmented buttons | options |
| grade | Grade buttons | grading: { type: "tier3" } or { options } |
| notes | Textarea | rows, placeholder |
| hidden | Hidden input | contextKey |

### Quick Buttons (for number fields)

```javascript
quickButtons: [
  { label: "-3", value: -3 },
  { label: "0", value: 0 },
  { label: "+3", value: 3 }
]
```

### Grading Options

**3-Tier (Above/Average/Below):**
```javascript
grading: { type: "tier3" }
```

**Custom options:**
```javascript
grading: {
  options: [
    { value: "win", label: "Win", class: "btn success" },
    { value: "loss", label: "Loss", class: "btn warn" }
  ]
}
```

## UI Configuration

### Post-Submit Behavior

```javascript
ui: {
  postSubmit: "clearFields"  // Clears form fields, keeps context + player
  // OR
  postSubmit: "clearAll"     // Clears everything including player
  // OR
  postSubmit: "incrementRep" // Increments rep counter
  // OR
  postSubmit: "none"         // No automatic action
}
```

### Context Banner

Set `showContextBanner: true` to display the GameContext banner showing current game_id, drive_id, play_id.

### Rep Counter

Set `showRepCounter: true` to show +/- controls for tracking repetitions.

## Complete Example: Game RB

See `/forms/schemas/game-rb.schema.js` for a full example including:
- Player picker
- Radio buttons for scheme/gap
- Number fields with quick buttons
- Toggle fields
- Notes textarea

## Migration Checklist

When converting an existing page:

- [ ] Identify all form fields in original page
- [ ] Note the exact sheet tab name
- [ ] Check current payload shape (what columns are written)
- [ ] Create schema with matching field IDs
- [ ] Add payload builder preserving exact column names
- [ ] Test with real data submission
- [ ] Verify idempotency works (double-click = single row)
- [ ] Update navigation links

## Troubleshooting

### Schema not loading
- Check browser console for 404 errors
- Verify schema file path is correct
- Ensure schema variable is exposed to window object

### Payload not matching sheet
- Compare payload builder output with sheet columns
- Check exact capitalization of column names
- Verify all required fields are included

### Player picker not working
- Ensure roster is loaded (check API.tryout.read.roster)
- Verify player data has required fields (player_id, display_name)

## Architecture

```
Schema (JSON) → FormEngine → DOM → User Input → PayloadBuilder → API.request
     ↑                                      ↓
     └──────────────── Response ← GAS Server ←┘
```

The FormEngine handles:
- Rendering all UI components
- Managing form state
- Validation
- Submission with idempotency
- Status feedback (GSDSStatus)

You only define:
- What fields exist (schema)
- How data maps to sheet rows (payload builder)
