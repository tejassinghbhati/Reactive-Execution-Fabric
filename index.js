'use strict';

/**
 * index.js — Reactive Execution Fabric entry point
 *
 * Starts the cron scheduler, loads all enabled jobs, and keeps the process
 * alive indefinitely. Handles SIGTERM and SIGINT for graceful shutdown.
 *
 * Usage:
 *   node index.js
 */

require('dotenv').config();
const scheduler = require('./src/scheduler');

// ── ASCII Banner ──────────────────────────────────────────────────────────────
console.log(`
╔══════════════════════════════════════════════════════════╗
║       ⚡  Reactive Execution Fabric  ⚡                  ║
║       OpenClaw — Project 6 / Heartbeat Layer             ║
║       by Tejas Singh Bhati                               ║
╚══════════════════════════════════════════════════════════╝
`);

// ── Start ─────────────────────────────────────────────────────────────────────
scheduler.start();

// ── Graceful Shutdown ─────────────────────────────────────────────────────────
async function shutdown(signal) {
  console.log(`\n📴 Received ${signal}. Shutting down gracefully...`);
  await scheduler.stop();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  console.error(`\n❌ [Fatal] Uncaught exception: ${err.message}`);
  console.error(err.stack);
  // Keep fabric alive — don't crash on one bad job
});

process.on('unhandledRejection', (reason) => {
  console.error(`\n❌ [Fatal] Unhandled promise rejection: ${reason}`);
  // Keep alive
});
