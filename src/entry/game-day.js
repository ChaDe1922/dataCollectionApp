/**
 * Entry point: game/game-day.html
 */
import { bootstrap, mountStatus } from '../entry/bootstrap.js';

// Bootstrap with auth and context
bootstrap({ auth: true, context: true });

// Page initialization
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Entry] Game Day page loaded');

  // Mount GameContext banner
  if (window.GameContext) {
    // Banner shows "Game / Drive / Play" live
    GameContext.mountBanner('#ctxBanner');

    // Two-way bind inputs to shared context
    GameContext.bindInputs({
      game_id:  '#ctx_game',
      drive_id: '#ctx_drive',
      play_id:  '#ctx_play'
    });

    // Tiny "synced" hint feedback
    const hint = document.getElementById('ctxSyncHint');
    if (hint) {
      GameContext.subscribe(() => { hint.textContent = 'Synced'; });
    }
  }
});
