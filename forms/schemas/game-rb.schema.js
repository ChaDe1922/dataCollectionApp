/**
 * Game RB Schema — Schema-driven form for RB rush tracking
 * Migrated from game/game-rb.html
 */
const gameRbSchema = {
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
    layout: "card",
    postSubmit: "clearFields"
  },

  fields: [
    // Scheme selection
    {
      id: "scheme",
      label: "Scheme",
      type: "radio",
      required: true,
      default: "Inside Zone",
      options: [
        { value: "Inside Zone", label: "Inside Zone" },
        { value: "Outside Zone", label: "Outside Zone" },
        { value: "Duo", label: "Duo" },
        { value: "Power", label: "Power" },
        { value: "Counter", label: "Counter" },
        { value: "Pin-Pull", label: "Pin-Pull" },
        { value: "Toss", label: "Toss" },
        { value: "Draw", label: "Draw" }
      ]
    },

    // Gap selection
    {
      id: "gap",
      label: "Gap",
      type: "radio",
      required: true,
      default: "B",
      options: [
        { value: "A", label: "A" },
        { value: "B", label: "B" },
        { value: "C", label: "C" },
        { value: "D", label: "D" }
      ]
    },

    // Yardage
    {
      id: "yards",
      label: "Yards",
      type: "number",
      required: true,
      step: 1,
      quickButtons: [
        { label: "-3", value: -3 },
        { label: "0", value: 0 },
        { label: "+3", value: 3 },
        { label: "+5", value: 5 },
        { label: "+10", value: 10 }
      ]
    },

    // Yds Before Contact
    {
      id: "yds_bc",
      label: "Yds Before Contact",
      type: "number",
      required: false,
      step: 1,
      default: 0
    },

    // Yds After Contact (auto-calculated but editable)
    {
      id: "yds_ac",
      label: "Yds After Contact",
      type: "number",
      required: false,
      step: 1,
      default: 0
    },

    // Broken Tackles
    {
      id: "broken_tackles",
      label: "Broken Tackles",
      type: "number",
      required: false,
      min: 0,
      step: 1,
      default: 0
    },

    // Toggles
    {
      id: "td",
      label: "Touchdown",
      type: "toggle",
      required: false,
      default: "No"
    },
    {
      id: "fumble",
      label: "Fumble",
      type: "toggle",
      required: false,
      default: "No"
    },
    {
      id: "fumble_lost",
      label: "Fumble Lost",
      type: "toggle",
      required: false,
      default: "No"
    },
    {
      id: "explosive",
      label: "Explosive Run (≥10 yds)",
      type: "toggle",
      required: false,
      default: "No"
    },

    // Notes
    {
      id: "notes",
      label: "Notes",
      type: "notes",
      required: false,
      placeholder: "Additional observations...",
      rows: 2
    }
  ],

  payload: {
    builder: "gameRbRow"
  }
};

// Auto-calculate explosive based on yards
// This would be done via event listener in a real implementation
// For now, the server or manual toggle handles it

// Export for use
if (typeof module !== 'undefined') {
  module.exports = gameRbSchema;
}
