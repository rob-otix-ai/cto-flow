/**
 * CTO-Flow Commands - Simple command handlers for epic management
 *
 * Provides CLI integration for CTO-Flow agent management system.
 */

import process from 'process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Check if CTO-Flow mode is enabled
 */
function isCtoFlowModeEnabled(flags = {}) {
  // Check flag override first
  if (flags['cto-flow-mode'] === true || flags.ctoFlowMode === true) return true;
  if (flags['no-cto-flow-mode'] === true || flags.noCtoFlowMode === true) return false;

  // Check environment variable
  const envVar = process.env.CTOFLOW_MODE || process.env.CLAUDE_FLOW_CTOFLOW_MODE;
  if (envVar) {
    return envVar.toLowerCase() === 'true' || envVar === '1';
  }

  // Default: disabled
  return false;
}

/**
 * Get CTO-Flow module dynamically
 * The CTO-Flow module is TypeScript, so we import from the dist directory
 */

let ctoFlowModule = null;
async function getCtoFlowModule() {
  if (!ctoFlowModule) {
    try {
      // First try dist path (for production use with simple-cli.js)
      const distPath = join(__dirname, '../../../dist/src/cto-flow-agents/index.js');
      ctoFlowModule = await import(distPath);
    } catch (err1) {
      try {
        // Fallback: try relative TypeScript import (for tsx/development)
        ctoFlowModule = await import('../../cto-flow-agents/index.js');
      } catch (err2) {
        // Log the actual error for debugging
        if (process.env.DEBUG || process.env.CTOFLOW_DEBUG) {
          console.error('CTO-Flow module import error (dist):', err1.message);
          console.error('CTO-Flow module import error (src):', err2.message);
        }
        return null;
      }
    }
  }
  return ctoFlowModule;
}

/**
 * Parse owner/repo from --repo flag
 */
function parseRepoFlag(flags) {
  const repoFlag = flags.repo || flags.repository;
  if (repoFlag && typeof repoFlag === 'string' && repoFlag.includes('/')) {
    const [owner, repo] = repoFlag.split('/');
    return { owner, repo };
  }
  return { owner: '', repo: '' };
}

/**
 * Epic command handler
 */
export async function epicCommand(args, flags) {
  const subcommand = args[0];

  if (!isCtoFlowModeEnabled(flags)) {
    console.log('\n⚠️  CTO-Flow Mode is currently disabled\n');
    console.log('To enable CTO-Flow mode, you can:');
    console.log('  1. Use flag: npx claude-flow epic <command> --cto-flow-mode');
    console.log('  2. Set environment: CTOFLOW_MODE=true');
    console.log();
    return;
  }

  const module = await getCtoFlowModule();
  if (!module) {
    console.error('❌ CTO-Flow agents module not available.');
    console.log('Please ensure the cto-flow-agents module is properly built.');
    return;
  }

  const { CtoFlowManager } = module;
  const { owner, repo } = parseRepoFlag(flags);

  // Initialize manager with GitHub config if provided
  const managerConfig = owner && repo ? {
    enabled: true,
    github: {
      owner,
      repo,
      token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
    }
  } : undefined;

  const manager = new CtoFlowManager(managerConfig);

  switch (subcommand) {
    case 'create': {
      const title = args.slice(1).join(' ');
      if (!title) {
        console.error('Usage: epic create <title> --repo owner/repo --cto-flow-mode');
        return;
      }
      if (!owner || !repo) {
        console.error('Usage: epic create <title> --repo owner/repo --cto-flow-mode');
        console.log('The --repo flag is required to create an epic');
        return;
      }

      try {
        const epic = await manager.createEpic(title, {
          repository: flags.repo,
          metadata: { description: flags.description || '' },
        });

        console.log('✅ Epic created successfully!');
        console.log(`\nEpic: ${epic.name}`);
        console.log(`ID: ${epic.id}`);
        console.log(`State: ${epic.state}`);
        console.log();
      } catch (err) {
        console.error(`❌ Failed to create epic: ${err.message}`);
      }
      break;
    }

    case 'list': {
      try {
        const epics = await manager.listEpics({
          state: flags.status,
          repository: flags.repo,
        });

        if (epics.length === 0) {
          console.log('⚠️  No epics found.');
          console.log('\nCreate a new epic with:');
          console.log('  npx claude-flow epic create "Epic Title" --repo owner/repo --cto-flow-mode');
          return;
        }

        console.log(`✅ Found ${epics.length} epics:\n`);
        for (const epic of epics) {
          const stateEmoji = {
            active: '🟢',
            paused: '🟡',
            completed: '✅',
            cancelled: '❌',
          }[epic.state] || '⚪';

          console.log(`${stateEmoji} ${epic.name || epic.title || 'Untitled'}`);
          console.log(`   ID: ${epic.id} | Phase: ${epic.currentPhase || 'N/A'} | Issues: ${epic.childIssues?.length || 0}`);
        }
        console.log();
      } catch (err) {
        console.error(`❌ Failed to list epics: ${err.message}`);
      }
      break;
    }

    case 'show': {
      const epicId = args[1];
      if (!epicId) {
        console.error('Usage: epic show <epic-id> --cto-flow-mode');
        return;
      }

      try {
        const epic = await manager.getEpic(epicId);
        if (!epic) {
          console.error(`❌ Epic not found: ${epicId}`);
          return;
        }

        console.log(`\nEpic: ${epic.name || epic.title || 'Untitled'}\n`);
        console.log(`ID: ${epic.id}`);
        console.log(`State: ${epic.state}`);
        console.log(`Phase: ${epic.currentPhase || 'Not started'}`);
        console.log(`Created: ${new Date(epic.createdAt).toLocaleString()}`);
        if (epic.description) {
          console.log(`\nDescription: ${epic.description}`);
        }
        console.log();
      } catch (err) {
        console.error(`❌ Failed to show epic: ${err.message}`);
      }
      break;
    }

    default: {
      console.log('\nCTO-Flow Epic Commands:\n');
      console.log('  epic create <title>     Create a new epic');
      console.log('  epic list               List all epics');
      console.log('  epic show <epic-id>     Show epic details');
      console.log();
      console.log('Options:');
      console.log('  --cto-flow-mode         Enable CTO-Flow mode');
      console.log('  --repo <owner/repo>     GitHub repository');
      console.log('  --status <state>        Filter by state (list)');
      console.log();
    }
  }
}

/**
 * CTO-Flow command handler (context management)
 */
export async function ctoFlowCommand(args, flags) {
  const subcommand = args[0];

  if (!isCtoFlowModeEnabled(flags)) {
    console.log('\n⚠️  CTO-Flow Mode is currently disabled\n');
    console.log('To enable CTO-Flow mode, you can:');
    console.log('  1. Use flag: npx claude-flow cto-flow <command> --cto-flow-mode');
    console.log('  2. Set environment: CTOFLOW_MODE=true');
    console.log();
    return;
  }

  const module = await getCtoFlowModule();
  if (!module) {
    console.error('❌ CTO-Flow agents module not available.');
    return;
  }

  const { CtoFlowManager } = module;
  const { owner, repo } = parseRepoFlag(flags);

  const managerConfig = owner && repo ? {
    enabled: true,
    github: { owner, repo, token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN }
  } : undefined;

  const manager = new CtoFlowManager(managerConfig);

  switch (subcommand) {
    case 'context-restore': {
      const epicId = flags.epic;
      if (!epicId) {
        console.error('Usage: cto-flow context-restore --epic <epic-id> --cto-flow-mode');
        return;
      }

      try {
        console.log('Restoring context...');
        const context = await manager.restoreContext(epicId);
        console.log('✅ Context restored successfully!');
        console.log(`Epic: ${context.epicId}`);
        console.log();
      } catch (err) {
        console.error(`❌ Failed to restore context: ${err.message}`);
      }
      break;
    }

    case 'status': {
      try {
        const status = await manager.getStatus();
        console.log('\nCTO-Flow Mode Status\n');
        console.log(`Enabled: ${status.enabled ? 'Yes' : 'No'}`);
        console.log(`Active Epics: ${status.activeEpics || 0}`);
        console.log(`Total Agents: ${status.totalAgents || 0}`);
        console.log();
      } catch (err) {
        console.error(`❌ Failed to get status: ${err.message}`);
      }
      break;
    }

    default: {
      console.log('\nCTO-Flow Commands:\n');
      console.log('  cto-flow context-restore   Restore epic context for an agent');
      console.log('  cto-flow status            Show CTO-Flow mode status');
      console.log();
      console.log('Options:');
      console.log('  --epic <epic-id>           Epic to operate on');
      console.log('  --cto-flow-mode            Enable CTO-Flow mode');
      console.log();
    }
  }
}

/**
 * CTO-Project command handler
 */
export async function ctoProjectCommand(args, flags) {
  const subcommand = args[0];

  if (!isCtoFlowModeEnabled(flags)) {
    console.log('\n⚠️  CTO-Flow Mode is currently disabled\n');
    console.log('To enable CTO-Flow mode, you can:');
    console.log('  1. Use flag: npx claude-flow cto-project <command> --cto-flow-mode');
    console.log('  2. Set environment: CTOFLOW_MODE=true');
    console.log();
    return;
  }

  const module = await getCtoFlowModule();
  if (!module) {
    console.error('❌ CTO-Flow agents module not available.');
    return;
  }

  const { CtoFlowProjectBridge } = module;
  const { owner, repo } = parseRepoFlag(flags);

  if (!owner || !repo) {
    console.error('The --repo flag is required for cto-project commands');
    console.log('Usage: cto-project <command> --repo owner/repo --cto-flow-mode');
    return;
  }

  const bridge = new CtoFlowProjectBridge({
    github: {
      owner,
      repo,
      ownerType: flags.org ? 'org' : 'user',
    },
  });

  switch (subcommand) {
    case 'create': {
      const epicId = args[1];
      const title = args.slice(2).join(' ') || flags.title;
      if (!epicId || !title) {
        console.error('Usage: cto-project create <epic-id> <title> --repo owner/repo --cto-flow-mode');
        return;
      }

      try {
        console.log('Creating GitHub Project...');
        const description = flags.description || `Epic: ${title}`;
        const mapping = await bridge.createProjectForEpic(epicId, title, description);
        console.log('✅ GitHub Project created successfully!\n');
        console.log('Project Details:');
        console.log(`  Epic ID: ${epicId}`);
        console.log(`  Project #: ${mapping.projectNumber}`);
        console.log(`  URL: ${mapping.projectUrl}`);
        console.log();
      } catch (err) {
        console.error(`❌ Failed to create project: ${err.message}`);
      }
      break;
    }

    case 'progress': {
      const epicId = args[1];
      if (!epicId) {
        console.error('Usage: cto-project progress <epic-id> --repo owner/repo --cto-flow-mode');
        return;
      }

      try {
        const progress = await bridge.getEpicProgress(epicId);
        console.log(`\nEpic Progress: ${epicId}\n`);
        console.log(`Total Items: ${progress.total}`);
        console.log(`Completed: ${progress.completed}`);
        console.log(`In Progress: ${progress.inProgress}`);
        console.log(`Blocked: ${progress.blocked}`);
        console.log(`Progress: ${progress.percentage}%`);
        console.log();
      } catch (err) {
        console.error(`❌ Failed to get progress: ${err.message}`);
      }
      break;
    }

    default: {
      console.log('\nCTO-Project Commands:\n');
      console.log('  cto-project create <epic-id> <title>   Create a GitHub Project for an epic');
      console.log('  cto-project progress <epic-id>         View epic progress');
      console.log();
      console.log('Options:');
      console.log('  --cto-flow-mode          Enable CTO-Flow mode');
      console.log('  --repo <owner/repo>      GitHub repository');
      console.log('  --description "..."      Description for project');
      console.log();
    }
  }
}
