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

    const data = [
      `Today is ${days[now.getDay()]}, ${now.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}.`,
      `Current time (IST): ${now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}.`,
      `This is the automated morning briefing from the Reactive Execution Fabric.`,
    ].join('\n');

    return { shouldFire: true, data };
  },
};
