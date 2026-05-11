# Reactive Execution Fabric

**OpenClaw — Module 6**
A cron-driven scheduling and condition-monitoring layer that enables the OpenClaw agent to operate proactively — running background jobs, evaluating trigger conditions, and delivering synthesized outputs to configured notification channels without explicit user invocation.

---

## Architecture

```
Scheduler Core (node-cron)
    |
    v
Condition Monitor              -- evaluates whether a job should fire
    |
    |-- probe:<name>           -- dynamically loaded probe module
    |-- memory:<key>           -- query against Cognitive Memory Substrate
    |-- time:<HH:MM>           -- time-window predicate
    `-- always                 -- unconditional (default)
    |
    v
Agent Execution Pipeline       -- runAgent(prompt + context)
    |
    v
Proactive Notifier
    |-- Discord
    |-- Telegram
    `-- Console
    |
    v
Job Store (SQLite)             -- persists every execution record
```

---

## Setup

### 1. Install dependencies

```bash
cd "Reactive Execution Fabric"
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `NOTIFY_PLATFORM` | Yes | `console` / `discord` / `telegram` |
| `DISCORD_TOKEN` | Discord only | Bot token from Discord Developer Portal |
| `DISCORD_NOTIFY_CHANNEL_ID` | Discord only | Default channel ID |
| `TELEGRAM_TOKEN` | Telegram only | Bot token from BotFather |
| `TELEGRAM_NOTIFY_CHAT_ID` | Telegram only | Default chat or group ID |
| `GITHUB_TOKEN` | PR probe only | Personal access token |
| `GITHUB_WATCH_REPO` | PR probe only | Repository in `owner/repo` format |

### 3. Verify sibling module dependencies

REF integrates directly with other OpenClaw modules. Ensure their dependencies are installed:

```bash
cd "../Agent Execution Pipeline" && npm install
cd "../Cogntive Memory Substrate" && npm install
```

---

## Usage

### Start the scheduler

```bash
node index.js
```

The process loads all enabled jobs from the database, registers cron tasks, and runs indefinitely. Send `SIGINT` or `SIGTERM` to trigger graceful shutdown.

---

## CLI Reference

### schedule — Create a job

```bash
node cli.js schedule \
  --name "Morning Briefing" \
  --cron "0 8 * * *" \
  --prompt "Provide a morning briefing including today's date and any outstanding reminders." \
  --condition "probe:morningBriefing" \
  --platform console
```

| Flag | Required | Description |
|---|---|---|
| `--name` | Yes | Human-readable job identifier |
| `--cron` | Yes | Standard cron expression (e.g. `"0 8 * * *"`) |
| `--prompt` | Yes | Natural language prompt passed to the agent |
| `--condition` | No | Condition type (see Condition Types section) |
| `--platform` | No | Notification target: `console`, `discord`, or `telegram` |
| `--target-id` | No | Per-job channel or chat ID, overrides environment default |
| `--description` | No | Optional free-text description |

### list — Enumerate jobs

```bash
node cli.js list
node cli.js list --enabled-only
```

### remove — Delete a job

```bash
node cli.js remove <job-id>
```

Permanently removes the job record and all associated run history.

### enable / disable — Toggle job state

```bash
node cli.js enable <job-id>
node cli.js disable <job-id>
```

Disabling a job retains its definition without removing it from the database.

### run — Manual execution

```bash
node cli.js run <job-id>
```

Triggers the full fire sequence immediately, bypassing the cron schedule. Useful for testing and one-off invocations.

### history — Execution log

```bash
node cli.js history <job-id>
node cli.js history <job-id> --limit 20
```

### reload — Hot-reload jobs

```bash
node cli.js reload
```

Re-reads the job database and re-registers all cron tasks without restarting the process.

### probes — List available probes

```bash
node cli.js probes
```

---

## Condition Types

Each job has an optional `condition` field that is evaluated before the agent is invoked. If the condition is not met, the tick is skipped and recorded as such in the run log.

| Condition | Example | Semantics |
|---|---|---|
| `always` | `--condition always` | Fires unconditionally on every scheduled tick |
| `probe:<name>` | `--condition "probe:githubPR"` | Delegates to the named probe module; fires if `shouldFire === true` |
| `memory:<key>` | `--condition "memory:user.reminders"` | Fires if the Cognitive Memory Substrate contains a matching fact |
| `time:<HH:MM>` | `--condition "time:08:00"` | Fires only if the current time falls within a +/- 5-minute window |

---

## Built-in Probes

### morningBriefing

Injects the current date, day of week, and local time into the agent context. Always returns `shouldFire: true` — the cron expression on the job definition controls frequency.

```bash
--condition "probe:morningBriefing"
--prompt "Provide a morning briefing including today's date and any outstanding reminders."
```

### githubPR

Queries the GitHub REST API for recently merged pull requests on the configured repository. Maintains an in-process baseline and fires only when new merges are detected since the last tick.

```bash
--condition "probe:githubPR"
--prompt "Summarize the following merged pull requests, noting key changes."
```

Requires `GITHUB_WATCH_REPO` in `.env`. Set `GITHUB_TOKEN` to avoid API rate limits.

### reminderCheck

Queries the `reminder` category in the Cognitive Memory Substrate. Fires if one or more reminder facts are present.

```bash
--condition "probe:reminderCheck"
--prompt "Review my stored reminders and identify any that are relevant to today."
```

---

## Writing a Custom Probe

Place a `.js` file in the `probes/` directory. The probe loader performs a hot-reload on each reference — no process restart is required.

**Required module exports:**

```js
module.exports = {
  name: 'myProbe',                  // Unique identifier; used in --condition "probe:myProbe"
  description: 'What this probe does',

  async run({ job }) {
    const shouldFire = true;        // boolean — controls whether the agent is called
    const data = 'Context string';  // string — appended to the agent prompt if shouldFire is true

    return { shouldFire, data };
  },
};
```

**Referencing in a job:**

```bash
--condition "probe:myProbe"
```

---

## Example Jobs

### Daily morning briefing

```bash
node cli.js schedule \
  --name "Morning Briefing" \
  --cron "0 8 * * *" \
  --prompt "Provide a personalized morning briefing." \
  --condition "probe:morningBriefing" \
  --platform telegram
```

### GitHub pull request monitor

```bash
node cli.js schedule \
  --name "PR Monitor" \
  --cron "*/15 * * * *" \
  --prompt "Summarize the following merged pull requests." \
  --condition "probe:githubPR" \
  --platform discord \
  --target-id "YOUR_CHANNEL_ID"
```

### Scheduler health check

```bash
node cli.js schedule \
  --name "Health Check" \
  --cron "* * * * *" \
  --prompt "Confirm that the Reactive Execution Fabric is operational." \
  --platform console
```

---

## Integration Map

| Module | Integration Point |
|---|---|
| Agent Execution Pipeline | `runAgent(prompt, sessionId)` — invoked on each qualifying tick to compose the outbound message |
| Cognitive Memory Substrate | `recall()` and `injectContext()` — used by the condition monitor and agent prompt enrichment |
| Runtime Extension Engine | Probe loading pattern adopted verbatim — same hot-reload and require-cache-busting mechanism |
| Multi-Platform Messaging Bot | `discord.js` and `node-telegram-bot-api` SDKs reused in `notifier.js` for outbound-only message delivery |

---

## Project Structure

```
Reactive Execution Fabric/
├── index.js                    # Entry point; starts the scheduler process
├── cli.js                      # Command-line interface for job management
├── package.json
├── .env.example
├── .gitignore
├── README.md
├── data/
│   └── ref.db                  # SQLite job store (created automatically on first run)
├── probes/                     # Hot-loadable condition probe modules
│   ├── morningBriefing.js
│   ├── githubPR.js
│   └── reminderCheck.js
└── src/
    ├── jobStore.js             # SQLite persistence layer for jobs and run records
    ├── conditionMonitor.js     # Condition evaluation engine
    ├── scheduler.js            # Cron registration and fire-sequence orchestration
    ├── notifier.js             # Outbound message dispatch
    └── probeLoader.js          # Dynamic probe module loader
```

---

*Reactive Execution Fabric — OpenClaw Module 6*
*Author: Tejas Singh Bhati*
#   R e a c t i v e - E x e c u t i o n - F a b r i c  
 