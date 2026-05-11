'use strict';

/**
 * probeLoader.js — Hot-loads probe files from the probes/ directory
 *
 * Mirrors the Runtime Extension Engine's dynamic skill loading pattern.
 * Each probe must export: { name, description, run(context) → { shouldFire, data } }
 *
 * Probes are reloaded on every conditionMonitor.evaluate() call that references
 * them — no restart needed when you drop a new .js file into probes/.
 */

const path = require('path');
const fs   = require('fs');

const PROBES_DIR = path.resolve(__dirname, '../probes');

/** @type {Map<string, object>} name → probe module */
const registry = new Map();

/**
 * Load (or hot-reload) all .js files from the probes/ directory.
 * Previously loaded probes that still exist are refreshed.
 * Stale probes (deleted files) are removed from the registry.
 */
function loadProbes() {
  if (!fs.existsSync(PROBES_DIR)) {
    fs.mkdirSync(PROBES_DIR, { recursive: true });
    return;
  }

  const files = fs.readdirSync(PROBES_DIR).filter(f => f.endsWith('.js'));

  // Track which probe names are still on disk
  const onDisk = new Set();

  for (const file of files) {
    const fullPath = path.join(PROBES_DIR, file);
    try {
      // Bust the require cache so hot-reload works
      delete require.cache[require.resolve(fullPath)];
      const probe = require(fullPath);

      if (!probe.name || typeof probe.run !== 'function') {
        console.warn(`⚠️  [ProbeLoader] Skipping "${file}" — missing 'name' or 'run' export`);
        continue;
      }

      registry.set(probe.name, probe);
      onDisk.add(probe.name);
      console.log(`🔌 [ProbeLoader] Loaded probe: "${probe.name}" (${file})`);
    } catch (err) {
      console.error(`❌ [ProbeLoader] Failed to load "${file}": ${err.message}`);
    }
  }

  // Evict stale probes that no longer have a file on disk
  for (const name of registry.keys()) {
    if (!onDisk.has(name)) {
      registry.delete(name);
      console.log(`🗑️  [ProbeLoader] Evicted stale probe: "${name}"`);
    }
  }
}

/**
 * Get a probe by name. Auto-loads from disk if not cached.
 * @param {string} name
 * @returns {object|null}
 */
function getProbe(name) {
  if (!registry.has(name)) loadProbes();
  return registry.get(name) || null;
}

/**
 * Return an array of all registered probe descriptors.
 * @returns {Array<{name: string, description: string}>}
 */
function listProbes() {
  loadProbes();
  return [...registry.values()].map(p => ({ name: p.name, description: p.description || '' }));
}

module.exports = { loadProbes, getProbe, listProbes };
