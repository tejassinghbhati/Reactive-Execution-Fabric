'use strict';

/**
 * reminderCheck.js — Built-in probe for the Reactive Execution Fabric
 *
 * Reads reminders stored in the Cognitive Memory Substrate
 * (under keys matching "reminder.*" or category "reminder").
 * Fires when at least one reminder exists in memory.
 *
 * The agent then composes a natural language summary of pending reminders.
 *
 * Usage:
 *   # First, store a reminder via the Agent Execution Pipeline:
 *   #   "Remember that I have a standup meeting every Monday at 10am"
 *
 *   node cli.js schedule \
 *     --name "Reminder Check" \
 *     --cron "0 9 * * *" \
 *     --condition "probe:reminderCheck" \
 *     --prompt "Check my stored reminders and tell me what I should be aware of today." \
 *     --platform console
 */

require('dotenv').config();
const path = require('path');

// ── Memory Substrate (optional) ───────────────────────────────────────────────
const SUBSTRATE_PATH = path.resolve(__dirname, '../../../Cogntive Memory Substrate');
let memoryManager = null;
try {
  memoryManager = require(path.join(SUBSTRATE_PATH, 'src/memoryManager'));
} catch (_) {
  // Memory substrate unavailable
}

module.exports = {
  name: 'reminderCheck',
  description: 'Fires when reminders exist in the Cognitive Memory Substrate (category: reminder).',

  async run({ job }) {
    if (!memoryManager) {
      console.warn('⚠️  [reminderCheck] Cognitive Memory Substrate not available — probe skipped.');
      return { shouldFire: false, data: null };
    }

    let reminders = [];

    try {
      // Search for facts in the "reminder" category
      const hits = await memoryManager.recall('reminder', { topK: 10, category: 'reminder' });
      reminders = hits;
    } catch (err) {
      // Fall back to exact search
      try {
        const allFacts = memoryManager.getAllFacts(200);
        reminders = allFacts.filter(f =>
          f.category === 'reminder' ||
          f.key.toLowerCase().startsWith('reminder') ||
          f.key.toLowerCase().includes('remind')
        );
      } catch (innerErr) {
        console.error(`❌ [reminderCheck] Memory recall failed: ${innerErr.message}`);
        return { shouldFire: false, data: null };
      }
    }

    if (reminders.length === 0) {
      return { shouldFire: false, data: null };
    }

    const today = new Date().toLocaleDateString('en-IN', {
      weekday: 'long', day: 'numeric', month: 'long',
    });

    const lines = reminders.map(r =>
      `• [${r.category || 'reminder'}] ${r.key}: ${r.value}`
    );

    const data = `Today is ${today}.\nStored reminders (${reminders.length}):\n${lines.join('\n')}`;

    return { shouldFire: true, data };
  },
};
