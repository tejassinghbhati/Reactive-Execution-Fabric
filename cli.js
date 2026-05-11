#!/usr/bin/env node
'use strict';

/**
 * cli.js — Command-line interface for managing Reactive Execution Fabric jobs
 *
 * Commands:
 *   schedule   Create and persist a new scheduled job
 *   list       List all jobs with status
 *   remove     Delete a job permanently
 *   enable     Re-enable a disabled job
 *   disable    Disable a job without deleting it
 *   run        Manually trigger a job immediately (bypasses cron)
 *   history    Show execution history for a job
 *   reload     Hot-reload all jobs (signal running fabric process)
 *   probes     List all available probes
 *   stats      Show aggregate job and run statistics
 */

require('dotenv').config();
const { program } = require('commander');
const chalk       = require('chalk');
const jobStore    = require('./src/jobStore');
const { listProbes } = require('./src/probeLoader');

// ── Formatting Helpers ────────────────────────────────────────────────────────

function fmtDate(ts) {
  if (!ts) return chalk.gray('—');
  return new Date(ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

function fmtBool(v) {
  return v ? chalk.green('✔ enabled') : chalk.red('✘ disabled');
}

function printJobRow(job) {
  console.log(`
${chalk.bold.cyan('Job:')}       ${job.name}
${chalk.bold('ID:')}        ${chalk.gray(job.id)}
${chalk.bold('Status:')}    ${fmtBool(job.enabled)}
${chalk.bold('Cron:')}      ${chalk.yellow(job.cron_expr)}
${chalk.bold('Condition:')} ${job.condition || 'always'}
${chalk.bold('Platform:')}  ${chalk.magenta(job.target)}${job.target_id ? chalk.gray(` → ${job.target_id}`) : ''}
${chalk.bold('Prompt:')}    ${job.prompt.slice(0, 80)}${job.prompt.length > 80 ? '…' : ''}
${chalk.bold('Created:')}   ${fmtDate(job.created_at)}
${'─'.repeat(60)}`);
}

// ── schedule ──────────────────────────────────────────────────────────────────
program
  .command('schedule')
  .description('Create a new scheduled job')
  .requiredOption('-n, --name <name>',       'Human-readable job name')
  .requiredOption('-c, --cron <expr>',       'Cron expression (e.g. "0 8 * * *")')
  .requiredOption('-p, --prompt <prompt>',   'Natural language prompt for the agent')
  .option('-d, --description <desc>',        'Optional description')
  .option('--condition <cond>',              'Condition type: always | probe:<name> | memory:<key> | time:<HH:MM>', 'always')
  .option('--platform <platform>',           'Notification platform: console | discord | telegram', process.env.NOTIFY_PLATFORM || 'console')
  .option('--target-id <id>',               'Channel/chat ID override (overrides .env default)')
  .action((opts) => {
    const id = jobStore.createJob({
      name:        opts.name,
      description: opts.description,
      cron_expr:   opts.cron,
      condition:   opts.condition,
      prompt:      opts.prompt,
      target:      opts.platform,
      target_id:   opts.targetId || null,
    });

    console.log(chalk.green(`\n✅ Job created successfully!`));
    console.log(`   ${chalk.bold('ID:')} ${chalk.gray(id)}`);
    console.log(`   ${chalk.bold('Name:')} ${opts.name}`);
    console.log(`   ${chalk.bold('Cron:')} ${chalk.yellow(opts.cron)}`);
    console.log(`   ${chalk.bold('Platform:')} ${chalk.magenta(opts.platform)}`);
    console.log(chalk.dim(`\n   Start the fabric to activate: ${chalk.white('node index.js')}\n`));
  });

// ── list ──────────────────────────────────────────────────────────────────────
program
  .command('list')
  .description('List all scheduled jobs')
  .option('--enabled-only', 'Show only enabled jobs')
  .action((opts) => {
    const jobs = opts.enabledOnly
      ? jobStore.listJobs().filter(j => j.enabled === 1)
      : jobStore.listJobs();

    if (jobs.length === 0) {
      console.log(chalk.yellow('\nNo jobs found. Create one: node cli.js schedule --help\n'));
      return;
    }

    console.log(chalk.bold.cyan(`\n${'═'.repeat(60)}`));
    console.log(chalk.bold.cyan(`  Reactive Execution Fabric — ${jobs.length} Job(s)`));
    console.log(chalk.bold.cyan(`${'═'.repeat(60)}`));
    jobs.forEach(printJobRow);
  });

// ── remove ────────────────────────────────────────────────────────────────────
program
  .command('remove <id>')
  .description('Permanently delete a job and its run history')
  .action((id) => {
    const job = jobStore.getJob(id);
    if (!job) { console.error(chalk.red(`\n❌ Job not found: ${id}\n`)); process.exit(1); }
    jobStore.deleteJob(id);
    console.log(chalk.green(`\n✅ Job "${job.name}" [${id}] deleted.\n`));
  });

// ── enable / disable ──────────────────────────────────────────────────────────
program
  .command('enable <id>')
  .description('Enable a disabled job')
  .action((id) => {
    jobStore.enableJob(id);
    console.log(chalk.green(`\n✅ Job [${id}] enabled. Run 'node cli.js reload' to pick it up.\n`));
  });

program
  .command('disable <id>')
  .description('Disable a job without deleting it')
  .action((id) => {
    jobStore.disableJob(id);
    console.log(chalk.yellow(`\n⏸  Job [${id}] disabled.\n`));
  });

// ── run ───────────────────────────────────────────────────────────────────────
program
  .command('run <id>')
  .description('Manually fire a job immediately, bypassing the cron schedule')
  .action(async (id) => {
    const job = jobStore.getJob(id);
    if (!job) { console.error(chalk.red(`\n❌ Job not found: ${id}\n`)); process.exit(1); }

    console.log(chalk.cyan(`\n🔥 Manually triggering job: "${job.name}"...\n`));
    const scheduler = require('./src/scheduler');
    await scheduler.triggerNow(id);
    console.log(chalk.green('\n✅ Manual trigger complete. Check history: node cli.js history ' + id + '\n'));
    process.exit(0);
  });

// ── history ───────────────────────────────────────────────────────────────────
program
  .command('history <id>')
  .description('Show execution history for a job')
  .option('-l, --limit <n>', 'Number of runs to show', '10')
  .action((id, opts) => {
    const job  = jobStore.getJob(id);
    if (!job) { console.error(chalk.red(`\n❌ Job not found: ${id}\n`)); process.exit(1); }

    const runs = jobStore.getRunHistory(id, parseInt(opts.limit, 10));

    console.log(chalk.bold.cyan(`\n${'═'.repeat(60)}`));
    console.log(chalk.bold.cyan(`  Run History — "${job.name}" (last ${runs.length})`));
    console.log(chalk.bold.cyan(`${'═'.repeat(60)}\n`));

    if (runs.length === 0) {
      console.log(chalk.yellow('  No runs recorded yet.\n'));
      return;
    }

    for (const run of runs) {
      const status = run.error
        ? chalk.red('✘ error')
        : run.delivered
          ? chalk.green('✔ delivered')
          : chalk.yellow('⚠ not delivered');

      console.log(`${chalk.bold(fmtDate(run.fired_at))}  ${status}`);
      console.log(`  Condition: ${run.condition_result || '—'}`);
      if (run.agent_response) {
        const preview = run.agent_response.slice(0, 120);
        console.log(`  Response:  ${chalk.gray(preview)}${run.agent_response.length > 120 ? '…' : ''}`);
      }
      if (run.error) console.log(`  ${chalk.red('Error:')} ${run.error}`);
      console.log();
    }
  });

// ── reload ────────────────────────────────────────────────────────────────────
program
  .command('reload')
  .description('Hot-reload all jobs in the running fabric (standalone reload)')
  .action(() => {
    console.log(chalk.cyan('\n♻️  Triggering in-process hot-reload...\n'));
    const scheduler = require('./src/scheduler');
    scheduler.reloadJobs();
    console.log(chalk.green('✅ Jobs reloaded.\n'));
    process.exit(0);
  });

// ── probes ────────────────────────────────────────────────────────────────────
program
  .command('probes')
  .description('List all available probe files in the probes/ directory')
  .action(() => {
    const probes = listProbes();
    console.log(chalk.bold.cyan(`\n${'═'.repeat(60)}`));
    console.log(chalk.bold.cyan(`  Available Probes (${probes.length})`));
    console.log(chalk.bold.cyan(`${'═'.repeat(60)}\n`));

    if (probes.length === 0) {
      console.log(chalk.yellow('  No probes found in probes/ directory.\n'));
      return;
    }

    for (const p of probes) {
      console.log(`  ${chalk.bold.green(p.name)}`);
      console.log(`  ${chalk.gray(p.description || '(no description)')}`);
      console.log(`  Usage: ${chalk.yellow(`--condition "probe:${p.name}"`)}\n`);
    }
  });

// ── stats ─────────────────────────────────────────────────────────────────────
program
  .command('stats')
  .description('Show aggregate job and run statistics')
  .action(() => {
    const counts = jobStore.countJobs();
    const recent = jobStore.getAllRunHistory(5);

    console.log(chalk.bold.cyan(`\n${'═'.repeat(60)}`));
    console.log(chalk.bold.cyan('  Reactive Execution Fabric — Statistics'));
    console.log(chalk.bold.cyan(`${'═'.repeat(60)}\n`));

    console.log(`  ${chalk.bold('Jobs total:')}    ${counts.total}`);
    console.log(`  ${chalk.bold('Jobs enabled:')}  ${chalk.green(counts.enabled)}`);
    console.log(`  ${chalk.bold('Jobs disabled:')} ${chalk.red(counts.disabled)}`);

    console.log(`\n  ${chalk.bold('Recent runs (last 5):')}`);
    if (recent.length === 0) {
      console.log(chalk.gray('  No runs recorded yet.'));
    } else {
      for (const r of recent) {
        const job    = jobStore.getJob(r.job_id);
        const name   = job ? job.name : chalk.gray('[deleted]');
        const status = r.error ? chalk.red('error') : r.delivered ? chalk.green('ok') : chalk.yellow('skipped');
        console.log(`  ${fmtDate(r.fired_at)}  ${name}  ${status}`);
      }
    }

    console.log();
  });

program.parse(process.argv);
