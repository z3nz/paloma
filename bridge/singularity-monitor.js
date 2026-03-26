/**
 * @file bridge/singularity-monitor.js
 * @description Observability and health monitoring for singularity chains.
 * Part of the Paloma Singularity Completion Sprint (Stream B - Gemini).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * ChainMonitor class — tracks the health and progress of a singularity chain.
 */
export class ChainMonitor {
  /**
   * @param {string} singularityDir - Path to .singularity/ directory
   */
  constructor(singularityDir) {
    this.singularityDir = singularityDir;
    this.monitorPath = join(singularityDir, 'chain-monitor.json');
    this.data = {
      chainId: randomUUID(),
      startedAt: new Date().toISOString(),
      generations: [],
      currentGeneration: 0,
      isActive: true,
      totalErrors: 0
    };
    this.initialized = false;
  }

  /**
   * Initialize the monitor by loading existing data if it exists.
   */
  async init() {
    try {
      await mkdir(this.singularityDir, { recursive: true });
      const content = await readFile(this.monitorPath, 'utf8');
      this.data = JSON.parse(content);
      this.initialized = true;
      console.log(`[singularity-monitor] Loaded existing chain ${this.data.chainId}`);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error(`[singularity-monitor] Failed to load monitor data: ${err.message}`);
      }
      // If file doesn't exist, we'll start fresh on the first save
      this.initialized = true;
    }
  }

  /**
   * Save the current monitor state to disk.
   * @private
   */
  async _save() {
    if (!this.initialized) await this.init();
    try {
      await writeFile(this.monitorPath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      console.error(`[singularity-monitor] Failed to save monitor data: ${err.message}`);
    }
  }

  /**
   * Record a new spawn event.
   * @param {number} generation
   * @param {string} pillarId
   * @param {string} promptHash
   */
  async recordSpawn(generation, pillarId, promptHash) {
    if (!this.initialized) await this.init();
    
    // Check if we already have this generation
    let genData = this.data.generations.find(g => g.generation === generation);
    if (!genData) {
      genData = {
        generation,
        pillarId,
        promptHash,
        spawnedAt: new Date().toISOString(),
        completedAt: null,
        durationMs: null,
        summary: null,
        errors: []
      };
      this.data.generations.push(genData);
    } else {
      genData.pillarId = pillarId;
      genData.promptHash = promptHash;
      genData.spawnedAt = new Date().toISOString();
    }

    this.data.currentGeneration = generation;
    this.data.isActive = true;
    await this._save();
    console.log(`[singularity-monitor] Recorded spawn for generation ${generation}`);
  }

  /**
   * Record a completion event for a generation.
   * @param {number} generation
   * @param {string} pillarId
   * @param {number} durationMs
   * @param {string} summary
   */
  async recordCompletion(generation, pillarId, durationMs, summary) {
    if (!this.initialized) await this.init();

    const genData = this.data.generations.find(g => g.generation === generation);
    if (genData) {
      genData.completedAt = new Date().toISOString();
      genData.durationMs = durationMs;
      genData.summary = summary;
      await this._save();
      console.log(`[singularity-monitor] Recorded completion for generation ${generation} (${durationMs}ms)`);
    } else {
      console.warn(`[singularity-monitor] Attempted to record completion for unknown generation ${generation}`);
    }
  }

  /**
   * Record an error event.
   * @param {number} generation
   * @param {string} pillarId
   * @param {string|Error} error
   */
  async recordError(generation, pillarId, error) {
    if (!this.initialized) await this.init();

    const errorMessage = error instanceof Error ? error.message : String(error);
    const genData = this.data.generations.find(g => g.generation === generation);
    
    if (genData) {
      genData.errors.push({
        timestamp: new Date().toISOString(),
        message: errorMessage
      });
    } else {
      // Record global error if generation not found
      this.data.globalErrors = this.data.globalErrors || [];
      this.data.globalErrors.push({
        generation,
        timestamp: new Date().toISOString(),
        message: errorMessage
      });
    }

    this.data.totalErrors++;
    await this._save();
    console.error(`[singularity-monitor] Recorded error for generation ${generation}: ${errorMessage}`);
  }

  /**
   * Record a handoff between generations.
   * @param {number} fromGeneration
   * @param {number} toGeneration
   * @param {number} promptSizeTokens
   */
  async recordHandoff(fromGeneration, toGeneration, promptSizeTokens) {
    if (!this.initialized) await this.init();
    
    const genData = this.data.generations.find(g => g.generation === fromGeneration);
    if (genData) {
      genData.handoffTo = toGeneration;
      genData.handoffPromptTokens = promptSizeTokens;
      await this._save();
      console.log(`[singularity-monitor] Recorded handoff: G${fromGeneration} -> G${toGeneration}`);
    }
  }

  /**
   * Get the current chain health summary.
   * @returns {object}
   */
  getChainHealth() {
    const total = this.data.generations.length;
    const completed = this.data.generations.filter(g => g.completedAt).length;
    const durations = this.data.generations
      .filter(g => g.durationMs !== null)
      .map(g => g.durationMs);
    
    const avgDuration = durations.length > 0 
      ? durations.reduce((a, b) => a + b, 0) / durations.length 
      : 0;

    return {
      chainId: this.data.chainId,
      generations: total,
      successRate: total > 0 ? completed / total : 0,
      avgDuration,
      currentGeneration: this.data.currentGeneration,
      isActive: this.data.isActive,
      errors: this.data.totalErrors,
      startedAt: this.data.startedAt
    };
  }

  /**
   * Get a report for a specific generation.
   * @param {number} generation
   * @returns {object|null}
   */
  getGenerationReport(generation) {
    const genData = this.data.generations.find(g => g.generation === generation);
    if (!genData) return null;

    return {
      generation: genData.generation,
      pillarId: genData.pillarId,
      spawnedAt: genData.spawnedAt,
      completedAt: genData.completedAt,
      duration: genData.durationMs,
      promptHash: genData.promptHash,
      summary: genData.summary,
      errors: genData.errors,
      handoffTo: genData.handoffTo,
      handoffTokens: genData.handoffPromptTokens
    };
  }

  /**
   * Get a full chain report as a markdown string.
   * @returns {string}
   */
  getFullReport() {
    const health = this.getChainHealth();
    let md = formatHealthReport(health);

    md += '\n\n### Generation Details\n\n';
    md += '| Gen | Status | Duration | Errors | Summary |\n';
    md += '|-----|--------|----------|--------|---------|\n';

    for (const gen of this.data.generations) {
      const status = gen.completedAt ? '✅' : (gen.errors.length > 0 ? '❌' : '⏳');
      const duration = gen.durationMs ? `${(gen.durationMs / 1000).toFixed(1)}s` : '-';
      const summary = gen.summary ? gen.summary.replace(/\n/g, ' ').slice(0, 50) + '...' : '-';
      md += `| ${gen.generation} | ${status} | ${duration} | ${gen.errors.length} | ${summary} |\n`;
    }

    if (this.data.globalErrors && this.data.globalErrors.length > 0) {
      md += '\n### Global Errors\n\n';
      for (const err of this.data.globalErrors) {
        md += `- [${err.timestamp}] Gen ${err.generation}: ${err.message}\n`;
      }
    }

    return md;
  }

  /**
   * Write the full report to a file.
   * @param {string} filepath
   */
  async saveReport(filepath) {
    const report = this.getFullReport();
    await writeFile(filepath, report, 'utf8');
    console.log(`[singularity-monitor] Saved full report to ${filepath}`);
  }
}

/**
 * Create a new chain monitor instance.
 * @param {string} singularityDir - Path to .singularity/ directory
 * @returns {ChainMonitor}
 */
export function createChainMonitor(singularityDir) {
  return new ChainMonitor(singularityDir);
}

/**
 * Format a chain health report as a beautiful, readable markdown string.
 * @param {object} health - Output from getChainHealth()
 * @returns {string} - Markdown-formatted report
 */
export function formatHealthReport(health) {
  const status = health.isActive ? '🟢 Active' : '⚪ Inactive';
  const successPercent = (health.successRate * 100).toFixed(1);
  
  return `## ⛓️ Singularity Chain Health Report
**Chain ID:** \`${health.chainId}\`
**Status:** ${status}
**Started:** ${new Date(health.startedAt).toLocaleString()}

### 📊 Summary
- **Current Generation:** ${health.currentGeneration}
- **Total Generations:** ${health.generations}
- **Success Rate:** ${successPercent}%
- **Average Duration:** ${(health.avgDuration / 1000).toFixed(1)}s
- **Total Errors:** ${health.errors}
`;
}
