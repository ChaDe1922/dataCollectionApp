// /js/rules.js — Drill dictionary + threshold evaluation
(function(g){
  'use strict';

  let DRILLS = [];

  /* ===== Threshold parsing ===== */
  function parseThreshold(th) {
    if (th == null || th === '') return null;
    const s = String(th).trim();
    
    // Boolean (Yes/No)
    if (/^(yes|no|true|false)$/i.test(s)) {
      return { kind:'bool', value:/^(yes|true)$/i.test(s) };
    }
    
    // Range (2.5-4.0)
    let m = s.match(/^(-?\d+(?:\.\d+)?)\s*[-–]\s*(-?\d+(?:\.\d+)?)/);
    if (m) {
      return { kind:'range', min:parseFloat(m[1]), max:parseFloat(m[2]) };
    }
    
    // Comparators (<=1.90, >=2.10, <5, >10, =8)
    m = s.match(/^(<=|≥|>=|≤|<|>|=|==)\s*(-?\d+(?:\.\d+)?)/);
    if (m) {
      const op = m[1].replace('≤','<=').replace('≥','>=').replace('==','=');
      return { kind:'cmp', op, value:parseFloat(m[2]) };
    }
    
    // Plain number (assume >=)
    const num = parseFloat(s);
    if (!isNaN(num)) {
      return { kind:'cmp', op:'>=', value:num };
    }
    
    return null;
  }

  function meetsThreshold(thObj, value) {
    if (!thObj) return true;
    if (value == null || value === '') return false;
    
    if (thObj.kind === 'bool') {
      return !!value === thObj.value;
    }
    
    if (thObj.kind === 'range') {
      return (value >= thObj.min && value <= thObj.max);
    }
    
    if (thObj.kind === 'cmp') {
      const v = Number(value);
      if (isNaN(v)) return false;
      
      switch(thObj.op) {
        case '<=': return v <= thObj.value;
        case '>=': return v >= thObj.value;
        case '<':  return v < thObj.value;
        case '>':  return v > thObj.value;
        case '=':  return v === thObj.value;
        default:   return false;
      }
    }
    
    return false;
  }

  /* ===== Value normalization ===== */
  function normalizeVal(unit, raw) {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'boolean') return raw;
    
    const s = String(raw).trim();
    
    // Boolean text
    if (/^(yes|no|true|false)$/i.test(s)) {
      return /^(yes|true)$/i.test(s);
    }
    
    // Numeric
    let v = parseFloat(s);
    if (isNaN(v)) return null;
    
    // Percentage adjustment (0-1 → 0-100)
    if (String(unit||'').toLowerCase().includes('percent')) {
      if (v <= 1) v = v * 100;
    }
    
    return v;
  }

  /* ===== 3-tier evaluation ===== */
  function evaluate(drillRow, primaryVal, secondaryVal) {
    const success = parseThreshold(drillRow.success_threshold);
    const failure = parseThreshold(drillRow.failure_threshold);
    const secondary = parseThreshold(drillRow.secondary_threshold);
    
    // Normalize values
    const pVal = normalizeVal(drillRow.measurement_unit, primaryVal);
    const sVal = secondaryVal != null 
      ? normalizeVal(drillRow.secondary_unit, secondaryVal) 
      : null;
    
    // Check secondary first (if exists)
    const secondaryPasses = secondary && sVal != null 
      ? meetsThreshold(secondary, sVal) 
      : true;
    
    // Primary checks
    const meetsSuccess = success ? meetsThreshold(success, pVal) : false;
    const meetsFailure = failure ? meetsThreshold(failure, pVal) : false;
    
    // 3-tier logic
    let verdict, label, className;
    
    if (meetsSuccess && secondaryPasses) {
      verdict = 'success';
      label = 'Above Average';
      className = 'ok';
    } else if (meetsFailure || !secondaryPasses) {
      verdict = 'fail';
      label = 'Below Average';
      className = 'err';
    } else {
      verdict = 'average';
      label = 'Average';
      className = 'warn';
    }
    
    // Build explanation
    let explain = '';
    if (success && drillRow.success_threshold) {
      explain += `Target: ${drillRow.success_threshold}`;
    }
    if (failure && drillRow.failure_threshold) {
      if (explain) explain += ' • ';
      explain += `Min: ${drillRow.failure_threshold}`;
    }
    if (secondary && drillRow.secondary_measurement) {
      if (explain) explain += ' • ';
      explain += `${drillRow.secondary_measurement}: ${drillRow.secondary_threshold}`;
    }
    
    return {
      verdict,      // 'success' | 'average' | 'fail'
      label,        // 'Above Average' | 'Average' | 'Below Average'
      className,    // 'ok' | 'warn' | 'err'
      explain,
      is_success: verdict === 'success',
      is_failure: verdict === 'fail'
    };
  }

  /* ===== Drill loading ===== */
  async function loadDrills(filterFn) {
    if (DRILLS.length === 0) {
      try {
        const res = await g.API.tryout.read.drills();
        if (res && res.ok) {
          DRILLS = res.drills || res.dict || res.rows || [];
        }
      } catch(e) {
        console.warn('Failed to load drills:', e);
        DRILLS = [];
      }
    }
    
    return filterFn ? DRILLS.filter(filterFn) : DRILLS;
  }

  function getByStation(stationId) {
    const upper = String(stationId).toUpperCase();
    return DRILLS.filter(d => 
      String(d.station_id||'').toUpperCase() === upper ||
      String(d.position_group||'').toUpperCase() === upper
    );
  }

  function getById(drillId) {
    return DRILLS.find(d => String(d.drill_id) === String(drillId));
  }

  function clearCache() {
    DRILLS = [];
  }

  /* ===== Public API ===== */
  g.Rules = {
    parseThreshold,
    meetsThreshold,
    normalizeVal,
    evaluate,           // NEW: 3-tier evaluation
    evaluateRep: evaluate, // alias for compatibility
    loadDrills,
    getByStation,
    getById,
    clearCache
  };

})(window);