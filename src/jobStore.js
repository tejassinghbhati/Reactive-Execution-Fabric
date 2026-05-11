'use strict';

/**
 * jobStore.js — SQLite persistence layer for the Reactive Execution Fabric
 *
 * Manages two tables:
 *   jobs      — job definitions (cron expression, prompt, target platform, etc.)
 *   job_runs  — immutable execution history (one row per fire)
 *
 * Uses better-sqlite3 (synchronous API) for simplicity and speed.
 * The DB file is auto-created at the path specified by JOB_DB_PATH env var.
 */

require('dotenv').config();
const Database = require('better-sqlite3');
const path     = require('path');
const { v4: uuidv4 } = require('uuid');
const fs       = require('fs');

// ── DB Setup ──────────────────────────────────────────────────────────────────
const DB_PATH = path.resolve(process.env.JOB_DB_PATH || './data/ref.db');

// Ensure the data directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// Schema version — increment when DDL changes to support future migrations
const SCHEMA_VERSION = 1;
db.pragma(`user_version = ${SCHEMA_VERSION}`);

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT DEFAULT '',
    cron_expr   TEXT NOT NULL,
    condition   TEXT DEFAULT 'always',
    prompt      TEXT NOT NULL,
    target      TEXT NOT NULL DEFAULT 'console',
    target_id   TEXT DEFAULT NULL,
    enabled     INTEGER DEFAULT 1,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS job_runs (
    id               TEXT PRIMARY KEY,
    job_id           TEXT NOT NULL,
    fired_at         INTEGER NOT NULL,
    condition_result TEXT DEFAULT NULL,
    agent_response   TEXT DEFAULT NULL,
    delivered        INTEGER DEFAULT 0,
    error            TEXT DEFAULT NULL,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
  );
`);

// ── Prepared Statements ───────────────────────────────────────────────────────
const stmts = {
  insertJob: db.prepare(`
    INSERT INTO jobs (id, name, description, cron_expr, condition, prompt, target, target_id, enabled, created_at, updated_at)
    VALUES (@id, @name, @description, @cron_expr, @condition, @prompt, @target, @target_id, @enabled, @created_at, @updated_at)
  `),
  getJob:    db.prepare('SELECT * FROM jobs WHERE id = ?'),
  listJobs:  db.prepare('SELECT * FROM jobs ORDER BY created_at DESC'),
  updateJob: db.prepare(`
    UPDATE jobs SET name=@name, description=@description, cron_expr=@cron_expr,
      condition=@condition, prompt=@prompt, target=@target, target_id=@target_id,
      enabled=@enabled, updated_at=@updated_at
    WHERE id=@id
  `),
  deleteJob:  db.prepare('DELETE FROM jobs WHERE id = ?'),
  enableJob:  db.prepare('UPDATE jobs SET enabled=1, updated_at=? WHERE id=?'),
  disableJob: db.prepare('UPDATE jobs SET enabled=0, updated_at=? WHERE id=?'),

  insertRun: db.prepare(`
    INSERT INTO job_runs (id, job_id, fired_at, condition_result, agent_response, delivered, error)
    VALUES (@id, @job_id, @fired_at, @condition_result, @agent_response, @delivered, @error)
  `),
  getRuns: db.prepare('SELECT * FROM job_runs WHERE job_id = ? ORDER BY fired_at DESC LIMIT ?'),
  getAllRuns: db.prepare('SELECT * FROM job_runs ORDER BY fired_at DESC LIMIT ?'),
};

// ── CRUD — Jobs ───────────────────────────────────────────────────────────────

/**
 * Create a new scheduled job.
 * @param {object} def
 * @param {string} def.name         - Human-readable name
 * @param {string} [def.description]
 * @param {string} def.cron_expr    - Cron expression e.g. "0 8 * * *"
 * @param {string} [def.condition]  - "always" | "probe:<name>" | "memory:<key>" | "time:<HH:MM>"
 * @param {string} def.prompt       - Natural language prompt for the agent
 * @param {string} [def.target]     - "console" | "discord" | "telegram"
 * @param {string} [def.target_id]  - Channel/chat ID override
 * @returns {string} The new job's UUID
 */
function createJob(def) {
  const now = Date.now();
  const id  = uuidv4();
  stmts.insertJob.run({
    id,
    name:        def.name,
    description: def.description || '',
    cron_expr:   def.cron_expr,
    condition:   def.condition  || 'always',
    prompt:      def.prompt,
    target:      def.target     || process.env.NOTIFY_PLATFORM || 'console',
    target_id:   def.target_id  || null,
    enabled:     1,
    created_at:  now,
    updated_at:  now,
  });
  return id;
}

/**
 * Fetch a single job by ID.
 * @param {string} id
 * @returns {object|null}
 */
function getJob(id) {
  return stmts.getJob.get(id) || null;
}

/**
 * List all jobs (enabled and disabled), newest first.
 * @returns {object[]}
 */
function listJobs() {
  return stmts.listJobs.all();
}

/**
 * List only enabled jobs — used by the scheduler at startup.
 * @returns {object[]}
 */
function listEnabledJobs() {
  return listJobs().filter(j => j.enabled === 1);
}

/**
 * Find a job by its human-readable name (case-insensitive, first match).
 * @param {string} name
 * @returns {object|null}
 */
function findJobByName(name) {
  const lower = name.toLowerCase();
  return listJobs().find(j => j.name.toLowerCase() === lower) || null;
}

/**
 * Return the total number of jobs in the database.
 * @returns {{ total: number, enabled: number, disabled: number }}
 */
function countJobs() {
  const all     = listJobs();
  const enabled = all.filter(j => j.enabled === 1).length;
  return { total: all.length, enabled, disabled: all.length - enabled };
}

/**
 * Patch a job's fields. Only supplied fields are updated.
 * @param {string} id
 * @param {object} patch
 */
function updateJob(id, patch) {
  const existing = getJob(id);
  if (!existing) throw new Error(`Job not found: ${id}`);
  stmts.updateJob.run({
    ...existing,
    ...patch,
    id,
    updated_at: Date.now(),
  });
}

/**
 * Permanently delete a job and all its run history (CASCADE).
 * @param {string} id
 */
function deleteJob(id) {
  stmts.deleteJob.run(id);
}

/** Enable a job (will be picked up on next scheduler.reloadJobs()). */
function enableJob(id)  { stmts.enableJob.run(Date.now(), id); }

/** Disable a job without deleting it. */
function disableJob(id) { stmts.disableJob.run(Date.now(), id); }

// ── CRUD — Runs ───────────────────────────────────────────────────────────────

/**
 * Log a job execution record.
 * @param {object} record
 * @param {string} record.job_id
 * @param {string} [record.condition_result]
 * @param {string} [record.agent_response]
 * @param {boolean} [record.delivered]
 * @param {string} [record.error]
 * @returns {string} Run UUID
 */
function logRun(record) {
  const id = uuidv4();
  stmts.insertRun.run({
    id,
    job_id:           record.job_id,
    fired_at:         Date.now(),
    condition_result: record.condition_result || null,
    agent_response:   record.agent_response   || null,
    delivered:        record.delivered ? 1 : 0,
    error:            record.error            || null,
  });
  return id;
}

/**
 * Get recent run history for a specific job.
 * @param {string} jobId
 * @param {number} [limit=10]
 * @returns {object[]}
 */
function getRunHistory(jobId, limit = 10) {
  return stmts.getRuns.all(jobId, limit);
}

/**
 * Get the most recent runs across all jobs.
 * @param {number} [limit=20]
 * @returns {object[]}
 */
function getAllRunHistory(limit = 20) {
  return stmts.getAllRuns.all(limit);
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  createJob,
  getJob,
  findJobByName,
  countJobs,
  listJobs,
  listEnabledJobs,
  updateJob,
  deleteJob,
  enableJob,
  disableJob,
  logRun,
  getRunHistory,
  getAllRunHistory,
};
