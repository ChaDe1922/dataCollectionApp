/**
 * Payload Builders — Map form state to sheet row shapes
 * These ensure compatibility with existing sheet schemas
 */
(function(global) {
  'use strict';

  const PayloadBuilders = {
    // ============================================================================
    // Game Forms
    // ============================================================================

    /**
     * Game RB Rush Detail (22_Fact_RushDetail)
     */
    gameRbRow(state) {
      const { context, player, values, user, rep } = state;

      return {
        timestamp: new Date().toISOString(),
        game_id: context.game_id || '',
        drive_id: context.drive_id || '',
        play_id: context.play_id || '',
        player_id: player?.player_id || player?.id || values.rusher_id || '',
        player_name: player?.display_name || player?.name || values.rusher_name || '',
        
        // Core rush data
        Scheme: values.scheme || '',
        Gap: values.gap || '',
        Yards: values.yards ?? '',
        'Yds Before Contact': values.yds_bc ?? '',
        'Yds After Contact': values.yds_ac ?? '',
        'Broken Tackles': values.broken_tackles ?? 0,
        
        // Toggles (Yes/No converted to 1/0)
        Touchdown: values.td === 'Yes' ? 1 : 0,
        Fumble: values.fumble === 'Yes' ? 1 : 0,
        'Fumble Lost': values.fumble_lost === 'Yes' ? 1 : 0,
        'Explosive Run': values.explosive === 'Yes' ? 1 : 0,
        
        // Metadata
        submitted_by: user?.username || user?.name || 'unknown',
        rep: rep?.n || 1
      };
    },

    /**
     * Game QB Detail (21_Fact_PassDetail)
     */
    gameQbRow(state) {
      const { context, player, values, user, rep } = state;

      return {
        timestamp: new Date().toISOString(),
        game_id: context.game_id || '',
        drive_id: context.drive_id || '',
        play_id: context.play_id || '',
        qb_id: player?.player_id || player?.id || '',
        qb_name: player?.display_name || player?.name || '',
        
        // Pass data
        'Pass Result': values.pass_result || '',
        'Target ID': values.target_id || '',
        'Target Name': values.target_name || '',
        'Yards': values.yards ?? '',
        'Air Yards': values.air_yards ?? '',
        'YAC': values.yac ?? '',
        
        // Toggles
        'TD': values.td === 'Yes' ? 1 : 0,
        'INT': values.int === 'Yes' ? 1 : 0,
        'Sack': values.sack === 'Yes' ? 1 : 0,
        'Pressure': values.pressure === 'Yes' ? 1 : 0,
        
        // Drop/location
        'Drop Type': values.drop_type || '',
        'Target Location': values.target_location || '',
        
        submitted_by: user?.username || 'unknown',
        rep: rep?.n || 1
      };
    },

    /**
     * Game WR Detail (23_Fact_ReceivingDetail)
     */
    gameWrRow(state) {
      const { context, player, values, user, rep } = state;

      return {
        timestamp: new Date().toISOString(),
        game_id: context.game_id || '',
        drive_id: context.drive_id || '',
        play_id: context.play_id || '',
        receiver_id: player?.player_id || player?.id || '',
        receiver_name: player?.display_name || player?.name || '',
        
        // Receiving data
        Route: values.route || '',
        Target: values.target === 'Yes' ? 1 : 0,
        Catch: values.catch === 'Yes' ? 1 : 0,
        'Yards': values.yards ?? '',
        'YAC': values.yac ?? '',
        
        // Toggles
        TD: values.td === 'Yes' ? 1 : 0,
        'Drop': values.drop === 'Yes' ? 1 : 0,
        'Contested': values.contested === 'Yes' ? 1 : 0,
        
        submitted_by: user?.username || 'unknown',
        rep: rep?.n || 1
      };
    },

    // ============================================================================
    // Tryout Forms
    // ============================================================================

    /**
     * Tryout RB Station
     */
    tryoutRbRow(state) {
      const { context, player, values, user, rep } = state;

      return {
        timestamp: new Date().toISOString(),
        tryout_id: context.tryout_id || '',
        period_code: context.period_code || '',
        station_id: 'RB',
        
        player_id: player?.player_id || player?.id || '',
        tryout_number: player?.tryout_num || player?.jersey_number || '',
        group_code: player?.group_code || player?.primary_pos || '',
        
        // Drill info
        drill_id: values.drill_id || '',
        drill_name: values.drill_name || '',
        attempt: rep?.n || 1,
        
        // Measurements
        primary_measurement: values.primary_measurement || '',
        primary_value: values.primary_value ?? '',
        secondary_measurement: values.secondary_measurement || '',
        secondary_value: values.secondary_value ?? '',
        
        // Rating
        rating: values.rating || '',
        
        // Notes
        notes: values.notes || '',
        
        submitted_by: user?.username || 'unknown'
      };
    },

    /**
     * Tryout WR Station
     */
    tryoutWrRow(state) {
      const { context, player, values, user, rep } = state;

      return {
        timestamp: new Date().toISOString(),
        tryout_id: context.tryout_id || '',
        period_code: context.period_code || '',
        station_id: 'WR',
        
        player_id: player?.player_id || '',
        tryout_number: player?.tryout_num || '',
        group_code: player?.group_code || player?.primary_pos || '',
        
        drill_id: values.drill_id || '',
        drill_name: values.drill_name || '',
        attempt: rep?.n || 1,
        
        primary_measurement: values.primary_measurement || '',
        primary_value: values.primary_value ?? '',
        secondary_measurement: values.secondary_measurement || '',
        secondary_value: values.secondary_value ?? '',
        
        rating: values.rating || '',
        notes: values.notes || '',
        
        submitted_by: user?.username || 'unknown'
      };
    },

    // ============================================================================
    // Practice Forms
    // ============================================================================

    /**
     * Practice Attendance
     */
    practiceAttendanceRow(state) {
      const { context, player, values, user } = state;

      return {
        timestamp: new Date().toISOString(),
        practice_id: context.practice_id || context.tryout_id || '',
        period_code: context.period_code || '',
        
        player_id: player?.player_id || '',
        player_name: player?.display_name || player?.name || '',
        
        status: values.status || 'present', // present, absent, late
        checkin_time: values.checkin_time || new Date().toISOString(),
        notes: values.notes || '',
        
        submitted_by: user?.username || 'unknown'
      };
    },

    /**
     * Practice RB Drills
     */
    practiceRbRow(state) {
      const { context, player, values, user, rep } = state;

      return {
        timestamp: new Date().toISOString(),
        practice_id: context.practice_id || '',
        period_code: context.period_code || '',
        drill_name: values.drill_name || '',
        
        player_id: player?.player_id || '',
        player_name: player?.display_name || '',
        
        reps: rep?.n || 1,
        scheme: values.scheme || '',
        result: values.result || '',
        notes: values.notes || '',
        
        submitted_by: user?.username || 'unknown'
      };
    }
  };

  // ============================================================================
  // EXPOSE
  // ============================================================================
  global.PayloadBuilders = PayloadBuilders;
})(window);
