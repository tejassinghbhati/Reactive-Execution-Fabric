# Reactive Execution Fabric ⚡

> **OpenClaw — Project 6 (Final Module)**
> The heartbeat layer that makes OpenClaw feel alive.

The Reactive Execution Fabric (REF) is a cron-driven, proactive agent scheduler. It runs background jobs on a schedule, evaluates conditions before firing, calls the OpenClaw AI agent to compose intelligent messages, and delivers them to Discord, Telegram, or the console — all without you having to ask.

---

## Architecture

```
⏰ Scheduler Core (node-cron)
    │
    ▼
🔍 Condition Monitor        ← evaluates "should this fire?"
    │
    ├── probe:<name>         ← hot-loaded probe files
    ├── memory:<key>         ← Cognitive Memory Substrate
    ├── time:<HH:MM>         ← time-window check
    └── always               ← default, always fires
    │
    ▼
🤖 Agent Execution Pipeline ← runAgent(prompt + context)
    │
    ▼
📡 Proactive Notifier
    ├── Discord
    ├── Telegram
    └── Console
    │
    ▼
🗄️  Job Store (SQLite)       ← logs every run
```

---

## Setup

### 1. Install dependencies

```bash
cd "Reactive Execution Fabric"
npm install
```

### 2. Configure `.env`

```bash
cp .env.example .env
```

Fill in:

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | Your Anthropic API key |
| `NOTIFY_PLATFORM` | ✅ | `console` / `discord` / `telegram` |
| `DISCORD_TOKEN` | Discord only | Bot token from Discord Developer Portal |
| `DISCORD_NOTIFY_CHANNEL_ID` | Discord only | Default channel to post into |
| `TELEGRAM_TOKEN` | Telegram only | Bot token from @BotFather |
| `TELEGRAM_NOTIFY_CHAT_ID` | Telegram only | Default chat/group ID |
| `GITHUB_TOKEN` | PR probe only | Personal access token |
| `GITHUB_WATCH_REPO` | PR probe only | `owner/repo` to watch |

### 3. Ensure sibling projects are installed

REF integrates with the other OpenClaw modules. Make sure they have their `node_modules`:

```bash
cd "../Agent Execution Pipeline" && npm install
cd "../Cogntive Memory Substrate" && npm install
```

---

## Usage

### Start the Fabric

```bash
node index.js
```

The fabric loads all enabled jobs, registers cron schedules, and stays alive.

---

## CLI Reference

### Create a job

```bash
node cli.js schedule \
  --name "Morning Briefing" \
  --cron "0 8 * * *" \
  --prompt "Give me a personalized morning briefing with today's date and a motivational thought." \
  --condition "probe:morningBriefing" \
  --platform console
```

**Options:**

| Flag | Required | Description |
|---|---|---|
| `--name` | ✅ | Human-readable job name |
| `--cron` | ✅ | Cron expression (e.g. `"0 8 * * *"`) |
| `--prompt` | ✅ | Natural language prompt for the agent |
| `--condition` | | `always` \| `probe:<name>` \| `memory:<key>` \| `time:<HH:MM>` |
| `--platform` | | `console` \| `discord` \| `telegram` |
| `--target-id` | | Per-job channel/chat ID override |
| `--description` | | Optional description |

### List all jobs

```bash
node cli.js list
node cli.js list --enabled-only
```

### Remove a job

```bash
node cli.js remove <job-id>
```

### Enable / Disable a job

```bash
node cli.js enable <job-id>
node cli.js disable <job-id>
```

### Fire a job manually (bypass cron)

```bash
node cli.js run <job-id>
```

Useful for testing without waiting for the next cron tick.

### View run history

```bash
node cli.js history <job-id>
node cli.js history <job-id> --limit 20
```

### Hot-reload jobs

```bash
node cli.js reload
```

Re-reads the database and re-registers all cron tasks without restarting the process.

### List available probes

```bash
node cli.js probes
```

---

## Condition Types

| Condition | Example | Behavior |
|---|---|---|
| `always` | `--condition always` | Always fires on every cron tick |
| `probe:<name>` | `--condition "probe:githubPR"` | Fires only if the probe returns `shouldFire: true` |
| `memory:<key>` | `--condition "memory:user.reminders"` | Fires if the Cognitive Memory Substrate has a matching fact |
| `time:<HH:MM>` | `--condition "time:08:00"` | Fires only within ±5 minutes of the target time |

---

## Built-in Probes

### `morningBriefing`
Enriches the agent prompt with today's date and time. Always fires.

```bash
--condition "probe:morningBriefing"
--prompt "Give me a morning briefing with today's date, a motivational thought, and any reminders I have."
```

### `githubPR`
Polls your watched GitHub repo for newly merged PRs. Fires only when new merges are detected.

```bash
--condition "probe:githubPR"
--prompt "Summarize the following newly merged pull requests and highlight what changed."
```

Requires `GITHUB_WATCH_REPO` and optionally `GITHUB_TOKEN` in `.env`.

### `reminderCheck`
Reads `reminder` category facts from the Cognitive Memory Substrate. Fires if any exist.

```bash
--condition "probe:reminderCheck"
--prompt "Check my stored reminders and tell me what I should be aware of today."
```

---

## Writing a Custom Probe

Drop a `.js` file into the `probes/` directory. It will be hot-loaded automatically — no restart needed.

**Required exports:**

```js
module.exports = {
  name: 'myProbe',                    // Must be unique
  description: 'What this probe does',

  async run({ job }) {
    // Your logic here
    const shouldFire = true;          // boolean
    const data = 'Context string';    // appended to the agent prompt

    return { shouldFire, data };
  },
};
```

**Use the condition:**
```bash
--condition "probe:myProbe"
```

---

## Example Jobs

### Daily morning briefing at 8am
```bash
node cli.js schedule \
  --name "Morning Briefing" \
  --cron "0 8 * * *" \
  --prompt "Give me a personalized morning briefing." \
  --condition "probe:morningBriefing" \
  --platform telegram
```

### GitHub PR watcher (every 15 minutes)
```bash
node cli.js schedule \
  --name "PR Watcher" \
  --cron "*/15 * * * *" \
  --prompt "Summarize the following merged PRs." \
  --condition "probe:githubPR" \
  --platform discord \
  --target-id "YOUR_CHANNEL_ID"
```

### Test job (fires every minute, console only)
```bash
node cli.js schedule \
  --name "Test Ping" \
  --cron "* * * * *" \
  --prompt "Say hello and confirm that the Reactive Execution Fabric is running correctly." \
  --platform console
```

---

## Integration Map

| Module | How REF uses it |
|---|---|
| **Agent Execution Pipeline** | `runAgent(prompt)` — called on every fire to compose the outbound message |
| **Cognitive Memory Substrate** | `recall()` / `injectContext()` — personalizes prompts; `memory:` conditions read from it |
| **Runtime Extension Engine** | Probe loading pattern — same hot-reload / cache-busting technique |
| **Multi-Platform Messaging Bot** | Discord.js + node-telegram-bot-api SDKs reused in `notifier.js` for outbound delivery |

---

## Project Structure

```
Reactive Execution Fabric/
├── index.js                    # Entry point — starts the fabric
├── cli.js                      # Job management CLI
├── package.json
├── .env.example
├── .gitignore
├── README.md
├── data/
│   └── ref.db                  # SQLite job store (auto-created)
├── probes/                     # Hot-loadable condition probes
│   ├── morningBriefing.js
│   ├── githubPR.js
│   └── reminderCheck.js
└── src/
    ├── jobStore.js             # SQLite persistence for jobs & runs
    ├── conditionMonitor.js     # Evaluates whether a job should fire
    ├── scheduler.js            # Cron engine & orchestration loop
    ├── notifier.js             # Outbound message dispatch
    └── probeLoader.js          # Hot-loads probe files from probes/
```

---

*Built by Tejas Singh Bhati — OpenClaw Project 6*
