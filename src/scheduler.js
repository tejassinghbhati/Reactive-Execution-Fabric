'use strict';

/**
 * scheduler.js — Cron engine and fire orchestration for the Reactive Execution Fabric
 *
 * Responsibilities:
 *   1. Load all enabled jobs from jobStore on startup
 *   2. Register each job with node-cron using its cron_expr
 *   3. On each tick — evaluate condition → call agent → notify platform → log run
 *   4. Support hot-reload (reloadJobs()) without process restart
 *   5. Graceful shutdown (stop())
 *
 * Fire sequence per tick:
 *   conditionMonitor.evaluate(job)
 *     → if shouldFire: runAgent(`${job.prompt}\n\nContext: ${context}`)
 *     → notifier.send(platform, targetId, agentResponse)
 *     → jobStore.logRun(...)
 */

require('dotenv').config();
const cron             = require('node-cron');
const path             = require('path');
const jobStore                   = require('./jobStore');
const { countJobs }              = jobStore;
const conditionMonitor           = require('./conditionMonitor');
const notifier                   = require('./notifier');
const { watchProbes }            = require('./probeLoader');

// ── Agent Execution Pipeline ──────────────────────────────────────────────────
const AGENT_PATH = path.resolve(__dirname, '../../../Agent Execution Pipeline/src/agent');
let runAgent = null;
try {
  runAgent = require(AGENT_PATH).runAgent;
  console.log('🤖 [Scheduler] Agent Execution Pipeline connected.');
} catch (_) {
  console.warn('⚠️  [Scheduler] Agent Execution Pipeline not found. Jobs will log prompt instead of calling AI.');
}

// ── Internal State ────────────────────────────────────────────────────────────
/** @type {Map<string, import('node-cron').ScheduledTask>} job.id → cron task */
const activeTasks = new Map();
/** @type {import('fs').FSWatcher|null} */
let probeWatcher = null;

// ── Logger ────────────────────────────────────────────────────────────────────
const log = {
  info:  (msg) => console.log(`⏰ [Scheduler] ${msg}`),
  warn:  (msg) => console.warn(`⚠️  [Scheduler] ${msg}`),
  error: (msg) => console.error(`❌ [Scheduler] ${msg}`),
  fire:  (msg) => console.log(`🔥 [Scheduler] ${msg}`),
};

// ── Fire Sequence ─────────────────────────────────────────────────────────────

/**
 * Execute the full fire sequence for a job.
 * This runs inside a try/catch so one bad job never crashes the process.
 *
 * @param {object} job - A job row from jobStore
 */
async function fireJob(job) {
  log.fire(`Firing job: "${job.name}" [${job.id}]`);
  const startTime = Date.now();

  let conditionResult  = 'skipped';
  let agentResponse    = null;
  let delivered        = false;
  let errorMsg         = null;

  try {
    // ── Step 1: Evaluate condition ───────────────────────────────────────────
    const { shouldFire, context } = await conditionMonitor.evaluate(job);
    conditionResult = shouldFire ? 'passed' : 'failed';

    if (!shouldFire) {
      log.info(`Condition failed for "${job.name}" — skipping this tick.`);
      jobStore.logRun({ job_id: job.id, condition_result: conditionResult, delivered: false });
      return;
    }

    // ── Step 2: Build the full prompt ────────────────────────────────────────
    const fullPrompt = context
      ? `${job.prompt}\n\n[Condition context]${context}`
      : job.prompt;

    // ── Step 3: Call the Agent ───────────────────────────────────────────────
    if (runAgent) {
      agentResponse = await runAgent(fullPrompt);
    } else {
      // Fallback when agent pipeline isn't installed
      agentResponse = `[No agent connected]\n\nScheduled prompt:\n${fullPrompt}`;
      log.warn('Delivering raw prompt (agent not connected).');
    }

    // ── Step 4: Notify ───────────────────────────────────────────────────────
    await notifier.send(job.target, job.target_id, agentResponse);
    delivered = true;

    log.info(`Job "${job.name}" completed in ${Date.now() - startTime}ms.`);
  } catch (err) {
    errorMsg = err.message;
    log.error(`Job "${job.name}" failed: ${err.message}`);
  } finally {
    // ── Step 5: Log the run ──────────────────────────────────────────────────
    jobStore.logRun({
      job_id:           job.id,
      condition_result: conditionResult,
      agent_response:   agentResponse,
      delivered,
      error:            errorMsg,
    });
  }
}

// ── Scheduling ────────────────────────────────────────────────────────────────

/**
 * Schedule a single job with node-cron.
 * Validates the cron expression before registering.
 *
 * @param {object} job
 */
function scheduleJob(job) {
  if (!cron.validate(job.cron_expr)) {
    log.warn(`Invalid cron expression "${job.cron_expr}" for job "${job.name}" — skipping.`);
    return;
  }

  // Stop any existing task for this job ID
  if (activeTasks.has(job.id)) {
    activeTasks.get(job.id).stop();
    activeTasks.delete(job.id);
  }

  const task = cron.schedule(job.cron_expr, () => fireJob(job), {
    scheduled: true,
    timezone:  process.env.TZ || 'Asia/Kolkata',
  });

  activeTasks.set(job.id, task);
  log.info(`Scheduled: "${job.name}" → [${job.cron_expr}] on ${job.target}`);
}

/**
 * Unregister and stop a job's cron task.
 * @param {string} jobId
 */
function removeJob(jobId) {
  if (activeTasks.has(jobId)) {
    activeTasks.get(jobId).stop();
    activeTasks.delete(jobId);
    log.info(`Removed job [${jobId}] from scheduler.`);
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

/**
 * Start the Reactive Execution Fabric.
 * Loads all enabled jobs from the DB and schedules them.
 */
function start() {
  log.info('Starting Reactive Execution Fabric...');

  const counts = countJobs();
  log.info(`Job store: ${counts.total} total, ${counts.enabled} enabled, ${counts.disabled} disabled.`);

  const jobs = jobStore.listEnabledJobs();

  if (jobs.length === 0) {
    log.info('No enabled jobs found. Add jobs with: node cli.js schedule --help');
  }

  for (const job of jobs) {
    scheduleJob(job);
  }

  log.info(`Fabric is alive. ${jobs.length} cron task(s) registered. Waiting for next tick...`);

  // Start filesystem watcher for probe hot-reload
  probeWatcher = watchProbes();
}

/**
 * Hot-reload all jobs from the DB without restarting the process.
 * Stops all existing tasks, then re-schedules enabled jobs.
 */
function reloadJobs() {
  log.info('Hot-reloading jobs...');

  // Stop all active tasks
  for (const [id, task] of activeTasks) {
    task.stop();
    activeTasks.delete(id);
  }

  // Re-schedule enabled jobs
  const jobs = jobStore.listEnabledJobs();
  for (const job of jobs) {
    scheduleJob(job);
  }

  log.info(`Reload complete. ${jobs.length} job(s) active.`);
}

/**
 * Gracefully stop all cron tasks and release platform clients.
 */
async function stop() {
  log.info('Stopping Reactive Execution Fabric...');
  for (const [, task] of activeTasks) task.stop();
  activeTasks.clear();
  if (probeWatcher) { probeWatcher.close(); probeWatcher = null; }
  await notifier.destroy();
  log.info('Fabric stopped cleanly.');
}

/**
 * Manually trigger a job's fire sequence immediately (bypasses cron schedule).
 * Used by `node cli.js run <id>`.
 * @param {string} jobId
 */
async function triggerNow(jobId) {
  const job = jobStore.getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  log.fire(`Manual trigger: "${job.name}" [${job.id}]`);
  await fireJob(job);
}

/**
 * Return the number of currently active (registered) cron tasks.
 * @returns {number}
 */
function activeCount() {
  return activeTasks.size;
}

module.exports = { start, stop, reloadJobs, scheduleJob, removeJob, triggerNow, activeCount };
