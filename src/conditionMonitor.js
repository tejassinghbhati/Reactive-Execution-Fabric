'use strict';

/**
 * conditionMonitor.js — Evaluates whether a scheduled job should fire on a given tick
 *
 * Condition types:
 *   "always"          → always fires (default)
 *   "probe:<name>"    → runs a probe from probes/ directory; fires if probe.shouldFire === true
 *   "memory:<key>"    → reads a key from Cognitive Memory Substrate; fires if truthy value found
 *   "time:<HH:MM>"    → fires only within the ±5-minute window of the specified time
 *
 * Returns: { shouldFire: boolean, context: string }
 * The context string is appended to the job's prompt before calling runAgent().
 */

require('dotenv').config();
const path        = require('path');
const probeLoader = require('./probeLoader');

// ── Memory Substrate (optional) ───────────────────────────────────────────────
const SUBSTRATE_PATH = path.resolve(__dirname, '../../../Cogntive Memory Substrate');
let memoryManager = null;
try {
  memoryManager = require(path.join(SUBSTRATE_PATH, 'src/memoryManager'));
} catch (_) {
  // Memory substrate unavailable — memory: conditions will always fail gracefully
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse a "HH:MM" string into { hours, minutes }.
 * @param {string} timeStr
 * @returns {{ hours: number, minutes: number }|null}
 */
function parseTime(timeStr) {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return { hours: parseInt(match[1], 10), minutes: parseInt(match[2], 10) };
}

// ── Main Evaluate ─────────────────────────────────────────────────────────────

/**
 * Evaluate whether a job's condition is met right now.
 *
 * @param {object} job - A job row from jobStore
 * @returns {Promise<{ shouldFire: boolean, context: string }>}
 */
async function evaluate(job) {
  const condition = (job.condition || 'always').trim().toLowerCase();

  // ── "always" ──────────────────────────────────────────────────────────────
  if (condition === 'always' || condition === '') {
    return { shouldFire: true, context: '' };
  }

  // ── "probe:<name>" ────────────────────────────────────────────────────────
  if (condition.startsWith('probe:')) {
    const probeName = condition.slice('probe:'.length).trim();
    const probe     = probeLoader.getProbe(probeName);

    if (!probe) {
      console.warn(`⚠️  [ConditionMonitor] Probe not found: "${probeName}" — skipping job "${job.name}"`);
      return { shouldFire: false, context: '' };
    }

    try {
      const result = await probe.run({ job });
      return {
        shouldFire: !!result.shouldFire,
        context:    result.data ? `\n\nProbe data (${probeName}):\n${result.data}` : '',
      };
    } catch (err) {
      console.error(`❌ [ConditionMonitor] Probe "${probeName}" threw: ${err.message}`);
      return { shouldFire: false, context: '' };
    }
  }

  // ── "memory:<key>" ────────────────────────────────────────────────────────
  if (condition.startsWith('memory:')) {
    const key = condition.slice('memory:'.length).trim();

    if (!memoryManager) {
      console.warn(`⚠️  [ConditionMonitor] Memory substrate unavailable — "memory:${key}" condition cannot be evaluated`);
      return { shouldFire: false, context: '' };
    }

    try {
      const fact = memoryManager.getPreference
        ? memoryManager.getPreference(key)
        : null;

      if (fact && fact.value) {
        return {
          shouldFire: true,
          context:    `\n\nMemory context — ${key}: ${fact.value}`,
        };
      }

      // Try semantic recall as fallback
      const hits = await memoryManager.recall(key, { topK: 1 });
      if (hits.length > 0) {
        return {
          shouldFire: true,
          context:    `\n\nMemory context — ${hits[0].key}: ${hits[0].value}`,
        };
      }

      return { shouldFire: false, context: '' };
    } catch (err) {
      console.error(`❌ [ConditionMonitor] Memory recall failed for "${key}": ${err.message}`);
      return { shouldFire: false, context: '' };
    }
  }

  // ── "time:<HH:MM>" ───────────────────────────────────────────────────────
  if (condition.startsWith('time:')) {
    const timeStr = condition.slice('time:'.length).trim();
    const target  = parseTime(timeStr);

    if (!target) {
      console.warn(`⚠️  [ConditionMonitor] Invalid time condition: "${condition}"`);
      return { shouldFire: false, context: '' };
    }

    const now         = new Date();
    const nowMinutes  = now.getHours() * 60 + now.getMinutes();
    const tgtMinutes  = target.hours * 60 + target.minutes;
    const WINDOW_MINS = 5;

    const inWindow = Math.abs(nowMinutes - tgtMinutes) <= WINDOW_MINS;
    return {
      shouldFire: inWindow,
      context:    inWindow ? `\n\nNote: This job fired within the scheduled time window (${timeStr}).` : '',
    };
  }

  // ── Unknown condition type ────────────────────────────────────────────────
  console.warn(`⚠️  [ConditionMonitor] Unknown condition type: "${condition}" — defaulting to shouldFire=true`);
  return { shouldFire: true, context: '' };
}

module.exports = { evaluate };
