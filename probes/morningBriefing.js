'use strict';

/**
 * morningBriefing.js — Built-in probe for the Reactive Execution Fabric
 *
 * Fires every morning (the job cron sets the exact time).
 * This probe always returns shouldFire = true — the cron expression
 * on the job definition (e.g. "0 8 * * *") controls when it runs.
 *
 * It enriches the agent's context with:
 *   - Current date and day of the week
 *   - IST timestamp
 *   - A hint to check memory for the user's name and preferences
 *
 * Usage:
 *   node cli.js schedule \
 *     --name "Morning Briefing" \
 *     --cron "0 8 * * *" \
 *     --condition "probe:morningBriefing" \
 *     --prompt "Give me a personalized morning briefing. Include today's date, a motivational thought, and any reminders I might have set." \
 *     --platform console
 */

module.exports = {
  name: 'morningBriefing',
  description: 'Enriches the morning briefing prompt with date/time context. Always fires.',

  async run({ job }) {
    const now  = new Date();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    // ISO week number
    const startOfYear  = new Date(now.getFullYear(), 0, 1);
    const weekNumber   = Math.ceil(((now - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);

    const data = [
      `Today is ${days[now.getDay()]}, ${now.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}.`,
      `ISO week: ${weekNumber} of ${now.getFullYear()}.`,
      `Current time (IST, UTC+5:30): ${now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}.`,
      `Automated morning context injected by the Reactive Execution Fabric.`,
    ].join('\n');

    return { shouldFire: true, data };
  },
};
