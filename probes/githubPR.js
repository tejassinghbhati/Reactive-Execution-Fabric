'use strict';

// githubPR.js — Built-in probe for the Reactive Execution Fabric
//
// Polls the GitHub REST API for recently merged PRs on a watched repository.
// Fires only when at least one PR was merged since the last check.
//
// Configuration (via .env):
//   GITHUB_TOKEN      — Personal access token (optional, avoids rate limiting)
//   GITHUB_WATCH_REPO — "owner/repo" e.g. "tejassinghbhati/openclaw"
//
// Usage:
//   node cli.js schedule
//     --name "PR Watcher"
//     --cron "*/15 * * * *"
//     --condition "probe:githubPR"
//     --prompt "Summarize the following recently merged pull requests."
//     --platform console

require('dotenv').config();
const https = require('https');

const GITHUB_TOKEN     = process.env.GITHUB_TOKEN;
const GITHUB_WATCH_REPO = process.env.GITHUB_WATCH_REPO;

// ── Internal state — tracks last seen PR number across ticks ──────────────────
let lastSeenPRNumber = null;

/**
 * Minimal GitHub API GET helper (no external deps needed — uses built-in https).
 * @param {string} endpoint - e.g. "/repos/owner/repo/pulls?state=closed&sort=updated"
 * @returns {Promise<any>}
 */
function githubGet(endpoint) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path:     endpoint,
      method:   'GET',
      headers: {
        'User-Agent':    'OpenClaw-REF/1.0',
        'Accept':        'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`GitHub API parse error: ${e.message}`)); }
      });
    });

    req.on('error', reject);
    req.setTimeout(10_000, () => { req.destroy(new Error('GitHub API request timed out')); });
    req.end();
  });
}

module.exports = {
  name: 'githubPR',
  description: 'Fires when new PRs are merged on the watched GitHub repository (GITHUB_WATCH_REPO in .env).',

  async run({ job }) {
    if (!GITHUB_WATCH_REPO) {
      console.warn('⚠️  [githubPR] GITHUB_WATCH_REPO not set in .env — probe will not fire.');
      return { shouldFire: false, data: null };
    }

    const endpoint = `/repos/${GITHUB_WATCH_REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=5`;

    let prs;
    try {
      prs = await githubGet(endpoint);
    } catch (err) {
      console.error(`❌ [githubPR] GitHub API error: ${err.message}`);
      return { shouldFire: false, data: null };
    }

    if (!Array.isArray(prs)) {
      console.warn(`⚠️  [githubPR] Unexpected GitHub response:`, prs.message || prs);
      return { shouldFire: false, data: null };
    }

    // Filter to only merged PRs
    const merged = prs.filter(pr => pr.merged_at !== null);

    if (merged.length === 0) {
      return { shouldFire: false, data: null };
    }

    const latestPRNumber = merged[0].number;

    // First run — establish baseline, don't fire
    if (lastSeenPRNumber === null) {
      lastSeenPRNumber = latestPRNumber;
      console.log(`ℹ️  [githubPR] Baseline set: last merged PR is #${latestPRNumber}`);
      return { shouldFire: false, data: null };
    }

    // Find PRs newer than the last seen
    const newPRs = merged.filter(pr => pr.number > lastSeenPRNumber);

    if (newPRs.length === 0) {
      return { shouldFire: false, data: null };
    }

    // Update baseline
    lastSeenPRNumber = latestPRNumber;

    // Build context block
    const lines = newPRs.map(pr =>
      `• PR #${pr.number}: "${pr.title}" — merged by @${pr.merged_by?.login || 'unknown'} on ${new Date(pr.merged_at).toLocaleDateString()}\n  URL: ${pr.html_url}`
    );

    const data = `Repository: ${GITHUB_WATCH_REPO}\nNew merged PRs (${newPRs.length}):\n${lines.join('\n')}`;

    return { shouldFire: true, data };
  },
};
