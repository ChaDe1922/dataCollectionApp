# Vite Migration Guide

## Overview
This project has been migrated to Vite for improved development experience and build optimization while maintaining the existing vanilla JS architecture.

## Quick Start

### Development
```bash
npm install
npm run dev
```

### Production Build
```bash
npm run build
npm run preview
```

## What Changed

### Added Files
- `package.json` — Node.js dependencies and scripts
- `vite.config.js` — Vite configuration for multi-page app
- `src/entry/bootstrap.js` — Shared initialization module
- `src/entry/*.js` — Page-specific entry points

### Migrated Pages
These pages now use ES module entry points:

| Page | Entry Point |
|------|-------------|
| `index.html` | `src/entry/index.js` |
| `game/game-day.html` | `src/entry/game-day.js` |
| `forms/pages/game-form.html` | `src/entry/forms-game-form.js` |

### Unchanged Pages
All other pages continue to work with their existing `<script>` tags. They can be migrated incrementally following the pattern above.

## Migration Pattern

To migrate an existing page to ESM:

### 1. Create Entry Point
Create `src/entry/{page-name}.js`:

```javascript
import { bootstrap } from './bootstrap.js';

// Initialize common functionality
bootstrap({ auth: true, context: true });

// Add page-specific logic
document.addEventListener('DOMContentLoaded', () => {
  // Page initialization
});
```

### 2. Update HTML
Replace script tags with single module tag:

```html
<!-- Before -->
<script src="../js/config.js"></script>
<script src="../js/api.js"></script>
<script src="../js/context.js"></script>
<script>
  // inline page logic
</script>

<!-- After -->
<script type="module" src="../src/entry/{page-name}.js"></script>
```

### 3. Update vite.config.js
Add the HTML file to the input object:

```javascript
const input = {
  // ...existing entries
  'your-page': resolve(__dirname, 'path/to/your-page.html'),
};
```

## Architecture

### Multi-Page App (MPA)
This is a multi-page application, not a SPA. Each HTML file is a separate entry point.

### Bootstrap Flow
1. `bootstrap.js` imports config and global libraries (API, GameContext, etc.)
2. Entry point imports bootstrap and adds page-specific logic
3. HTML loads only the entry point module

### Path Handling
- **Dev**: Absolute paths from root (`/src/entry/...`)
- **Build**: Relative paths (`./`) for GitHub Pages compatibility

## GitHub Pages Deployment

The build is configured for GitHub Pages subfolder deployment:

1. Build: `npm run build`
2. Output: `dist/` folder
3. Deploy `dist/` contents to GitHub Pages

Base path is automatically set to `./` for builds, making assets resolve correctly in subfolders.

## Preserved Functionality

All existing behavior is preserved:
- ✅ Phase 0: Config system (GSDS_API_BASE, etc.)
- ✅ Phase 1: API.request with normalized responses
- ✅ Phase 2: Leader election + BroadcastChannel sync
- ✅ Phase 3: Auth tokens + idempotency
- ✅ Phase 4: Schema-driven forms

## Troubleshooting

### 404 on module scripts
Ensure vite.config.js includes the HTML file in `input`.

### Auth not working
Check that `bootstrap({ auth: true })` is called in the entry point.

### Context not syncing
Verify `bootstrap({ context: true })` and GameContext configuration.

### Assets not loading
Use relative paths in HTML. With base `./`, assets resolve relative to each page.

## Incremental Migration Strategy

Not all pages need immediate migration. The system supports mixed mode:

1. **Migrated pages**: Use `type="module"` entry points
2. **Legacy pages**: Keep existing `<script>` tags

Migrate pages as you work on them, following the pattern in this guide.
