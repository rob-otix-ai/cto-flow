/**
 * CTO-Flow Agent Management - CLI Command Integration
 *
 * Bridges the claude-flow CLI to the cto-flow-agents module,
 * providing epic management, context restoration, and CTO-Flow mode control.
 *
 * @module cli/commands/cto-flow
 */

import { CLI, success, error, warning, info } from '../cli-core.js';
import type { CommandContext } from '../cli-core.js';
import chalk from 'chalk';

// Dynamic import for cto-flow-agents module (optional feature)
let ctoFlowModule: any = null;

async function getCtoFlowModule() {
  if (!ctoFlowModule) {
    try {
      ctoFlowModule = await import('../../cto-flow-agents/index.js');
    } catch (err) {
      return null;
    }
  }
  return ctoFlowModule;
}

/**
 * Check if CTO-Flow mode is enabled
 */
function isCtoFlowModeEnabled(flags: Record<string, any>): boolean {
  // Check flag override first
  if (flags['cto-flow-mode'] === true) return true;
  if (flags['no-cto-flow-mode'] === true) return false;

  // Check environment variable
  const envVar = process.env.CTOFLOW_MODE || process.env.CLAUDE_FLOW_CTOFLOW_MODE;
  if (envVar) {
    return envVar.toLowerCase() === 'true' || envVar === '1';
  }

  // Default: disabled
  return false;
}

/**
 * Show message when CTO-Flow mode is disabled
 */
function showCtoFlowModeDisabledMessage(command: string): void {
  console.log(chalk.yellow('\nCTO-Flow Mode is currently disabled\n'));
  console.log(chalk.dim('To enable CTO-Flow mode, you can:'));
  console.log(chalk.dim('  1. Set in config: ') + chalk.cyan('npx claude-flow config set ctoflow.enabled true'));
  console.log(chalk.dim('  2. Use flag: ') + chalk.cyan(`${command} --cto-flow-mode`));
  console.log(chalk.dim('  3. Set environment: ') + chalk.cyan('CTOFLOW_MODE=true'));
  console.log();
}

/**
 * Setup CTO-Flow CLI commands
 */
export function setupCtoFlowCommands(cli: CLI): void {
  // Epic management command
  cli.command({
    name: 'epic',
    description: 'Manage epics in cto-flow agent system',
    options: [
      {
        name: 'cto-flow-mode',
        description: 'Enable CTO-Flow mode for this command',
        type: 'boolean',
      },
      {
        name: 'no-cto-flow-mode',
        description: 'Disable CTO-Flow mode for this command',
        type: 'boolean',
      },
    ],
    action: async (ctx: CommandContext) => {
      const subcommand = ctx.args[0];

      if (!isCtoFlowModeEnabled(ctx.flags)) {
        showCtoFlowModeDisabledMessage('npx claude-flow epic');
        return;
      }

      const module = await getCtoFlowModule();
      if (!module) {
        error('CTO-Flow agents module not available. Please ensure it is properly installed.');
        return;
      }

      const { CtoFlowManager } = module;

      // Parse repo flag to get owner and repo
      const repoFlag = ctx.flags.repo as string;
      let owner = '';
      let repo = '';
      if (repoFlag && repoFlag.includes('/')) {
        [owner, repo] = repoFlag.split('/');
      }

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
          const title = ctx.args.slice(1).join(' ');
          if (!title) {
            error('Usage: epic create <title> [--repo owner/repo]');
            return;
          }

          // Require --repo flag for epic creation
          if (!owner || !repo) {
            error('Usage: epic create <title> --repo owner/repo');
            warning('The --repo flag is required to create an epic');
            return;
          }

          try {
            const epic = await manager.createEpic(title, {
              repository: repoFlag,
              metadata: {
                description: ctx.flags.description as string,
              },
            });

            success('Epic created successfully!');
            console.log(chalk.bold.cyan(`\nEpic: ${epic.name}`));
            console.log(chalk.dim('ID:'), epic.id);
            console.log(chalk.dim('State:'), epic.state);
            console.log();
          } catch (err: any) {
            error(`Failed to create epic: ${err.message}`);
          }
          break;
        }

        case 'list': {
          try {
            const epics = await manager.listEpics({
              state: ctx.flags.status as string,
              repository: ctx.flags.repo as string,
            });

            if (epics.length === 0) {
              warning('No epics found matching the criteria.');
              console.log(chalk.dim('\nCreate a new epic with:'));
              console.log(chalk.cyan('  npx claude-flow epic create "Epic Title"'));
              return;
            }

            success(`Found ${epics.length} epics:`);
            console.log();

            for (const epic of epics) {
              const stateEmoji = {
                active: '🟢',
                paused: '🟡',
                completed: '✅',
                cancelled: '❌',
              }[epic.state] || '⚪';

              console.log(`${stateEmoji} ${chalk.bold(epic.name || epic.title || 'Untitled')}`);
              console.log(chalk.dim(`   ID: ${epic.id} | Phase: ${epic.currentPhase || 'N/A'} | Issues: ${epic.childIssues?.length || 0}`));
            }
            console.log();
          } catch (err: any) {
            error(`Failed to list epics: ${err.message}`);
          }
          break;
        }

        case 'show': {
          const epicId = ctx.args[1];
          if (!epicId) {
            error('Usage: epic show <epic-id>');
            return;
          }

          try {
            const epic = await manager.getEpic(epicId);
            if (!epic) {
              error(`Epic not found: ${epicId}`);
              return;
            }

            console.log(chalk.bold.cyan(`\nEpic: ${epic.name || epic.title || 'Untitled'}\n`));
            console.log(chalk.dim('ID:'), epic.id);
            console.log(chalk.dim('State:'), epic.state);
            console.log(chalk.dim('Phase:'), epic.currentPhase || 'Not started');
            console.log(chalk.dim('Repository:'), epic.repository || 'N/A');
            console.log(chalk.dim('Created:'), new Date(epic.createdAt).toLocaleString());

            if (epic.description) {
              console.log(chalk.bold('\nDescription:'));
              console.log(chalk.dim(epic.description));
            }

            if (epic.childIssues?.length > 0) {
              console.log(chalk.bold(`\nChild Issues (${epic.childIssues.length}):`));
              for (const issue of epic.childIssues.slice(0, 10)) {
                console.log(`  - #${issue.number || 'N/A'}: ${issue.title}`);
              }
              if (epic.childIssues.length > 10) {
                console.log(chalk.dim(`  ... and ${epic.childIssues.length - 10} more`));
              }
            }
            console.log();
          } catch (err: any) {
            error(`Failed to show epic: ${err.message}`);
          }
          break;
        }

        case 'update': {
          const epicId = ctx.args[1];
          if (!epicId) {
            error('Usage: epic update <epic-id> --state <state> | --phase <phase>');
            return;
          }

          try {
            const updates: any = {};
            if (ctx.flags.state) updates.state = ctx.flags.state;
            if (ctx.flags.phase) updates.currentPhase = ctx.flags.phase;
            if (ctx.flags.title) updates.title = ctx.flags.title;

            if (Object.keys(updates).length === 0) {
              error('No updates provided. Use --state, --phase, or --title');
              return;
            }

            const epic = await manager.updateEpic(epicId, updates);
            success('Epic updated successfully!');
            console.log(chalk.dim('ID:'), epic.id);
            console.log(chalk.dim('State:'), epic.state);
            console.log();
          } catch (err: any) {
            error(`Failed to update epic: ${err.message}`);
          }
          break;
        }

        case 'sync': {
          const epicId = ctx.args[1];
          if (!epicId) {
            error('Usage: epic sync <epic-id>');
            return;
          }

          try {
            info('Syncing epic with GitHub...');
            await manager.syncEpic(epicId, {
              direction: ctx.flags.direction as string || 'bidirectional',
              force: ctx.flags.force as boolean,
            });
            success('Epic synced successfully!');
          } catch (err: any) {
            error(`Failed to sync epic: ${err.message}`);
          }
          break;
        }

        case 'assign': {
          const epicId = ctx.args[1];
          if (!epicId) {
            error('Usage: epic assign <epic-id> --auto-assign | --agent <agent-id> --issue <number>');
            return;
          }

          try {
            if (ctx.flags['auto-assign']) {
              const assignments = await manager.autoAssignAgents(epicId, {
                strategy: ctx.flags.strategy as string || 'capability',
              });
              success(`Auto-assigned ${assignments.length} agents!`);
              for (const a of assignments) {
                console.log(`  - Issue #${a.issueNumber} -> ${a.agentId} (${Math.round(a.matchScore * 100)}% match)`);
              }
            } else if (ctx.flags.agent && ctx.flags.issue) {
              await manager.assignAgent(epicId, parseInt(ctx.flags.issue as string), ctx.flags.agent as string);
              success(`Assigned agent ${ctx.flags.agent} to issue #${ctx.flags.issue}`);
            } else {
              error('Use --auto-assign or provide --agent and --issue');
            }
          } catch (err: any) {
            error(`Failed to assign agents: ${err.message}`);
          }
          break;
        }

        default: {
          console.log(chalk.bold('\nEpic Commands:\n'));
          console.log('  ' + chalk.cyan('epic create <title>') + '     Create a new epic');
          console.log('  ' + chalk.cyan('epic list') + '              List all epics');
          console.log('  ' + chalk.cyan('epic show <epic-id>') + '    Show epic details');
          console.log('  ' + chalk.cyan('epic update <epic-id>') + '  Update epic properties');
          console.log('  ' + chalk.cyan('epic sync <epic-id>') + '    Sync with GitHub');
          console.log('  ' + chalk.cyan('epic assign <epic-id>') + '  Assign agents to issues');
          console.log();
          console.log(chalk.dim('Options:'));
          console.log(chalk.dim('  --cto-flow-mode     Enable CTO-Flow mode'));
          console.log(chalk.dim('  --repo <owner/repo> GitHub repository'));
          console.log(chalk.dim('  --status <state>    Filter by state (list)'));
          console.log(chalk.dim('  --auto-assign       Auto-assign agents (assign)'));
          console.log();
        }
      }
    },
  });

  // CTO-Flow context management command
  cli.command({
    name: 'cto-flow',
    description: 'Manage CTO-Flow mode and context restoration',
    options: [
      {
        name: 'cto-flow-mode',
        description: 'Enable CTO-Flow mode for this command',
        type: 'boolean',
      },
      {
        name: 'no-cto-flow-mode',
        description: 'Disable CTO-Flow mode for this command',
        type: 'boolean',
      },
      {
        name: 'repo',
        description: 'GitHub repository (owner/repo)',
        type: 'string',
      },
    ],
    action: async (ctx: CommandContext) => {
      const subcommand = ctx.args[0];

      if (!isCtoFlowModeEnabled(ctx.flags)) {
        showCtoFlowModeDisabledMessage('npx claude-flow cto-flow');
        return;
      }

      const module = await getCtoFlowModule();
      if (!module) {
        error('CTO-Flow agents module not available. Please ensure it is properly installed.');
        return;
      }

      const { CtoFlowManager } = module;

      // Parse repo flag to get owner and repo
      const repoFlag = ctx.flags.repo as string;
      let owner = '';
      let repo = '';
      if (repoFlag && repoFlag.includes('/')) {
        [owner, repo] = repoFlag.split('/');
      }

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
        case 'context-restore': {
          const epicId = ctx.flags.epic as string;
          if (!epicId) {
            error('Usage: cto-flow context-restore --epic <epic-id>');
            return;
          }

          try {
            info('Restoring context...');
            const context = await manager.restoreContext(epicId, {
              strategy: ctx.flags.strategy as string || 'summary',
              targetAgent: ctx.flags.agent as string,
              maxTokens: parseInt(ctx.flags['max-tokens'] as string || '4000'),
            });

            success('Context restored successfully!');
            console.log(chalk.dim('Epic:'), context.epicId);
            console.log(chalk.dim('Token Count:'), context.tokenCount);
            if (context.summary) {
              console.log(chalk.bold('\nSummary:'));
              console.log(chalk.dim(context.summary.substring(0, 300) + '...'));
            }
            console.log();
          } catch (err: any) {
            error(`Failed to restore context: ${err.message}`);
          }
          break;
        }

        case 'context-save': {
          const epicId = ctx.flags.epic as string;
          if (!epicId) {
            error('Usage: cto-flow context-save --epic <epic-id> --data <json> | --file <path>');
            return;
          }

          try {
            let contextData: any;
            if (ctx.flags.file) {
              const fs = await import('fs-extra');
              contextData = await fs.readJSON(ctx.flags.file as string);
            } else if (ctx.flags.data) {
              contextData = JSON.parse(ctx.flags.data as string);
            } else {
              error('Provide context data via --data or --file');
              return;
            }

            await manager.saveContext(epicId, contextData);
            success('Context saved successfully!');
          } catch (err: any) {
            error(`Failed to save context: ${err.message}`);
          }
          break;
        }

        case 'context-clear': {
          const epicId = ctx.flags.epic as string;
          if (!epicId) {
            error('Usage: cto-flow context-clear --epic <epic-id> [--confirm]');
            return;
          }

          if (!ctx.flags.confirm) {
            warning(`This will clear all context for epic ${epicId}`);
            console.log(chalk.dim('Use --confirm to proceed'));
            return;
          }

          try {
            await manager.clearContext(epicId);
            success('Context cleared successfully!');
          } catch (err: any) {
            error(`Failed to clear context: ${err.message}`);
          }
          break;
        }

        case 'status': {
          try {
            const status = await manager.getStatus();
            console.log(chalk.bold.cyan('\nCTO-Flow Mode Status\n'));
            console.log(chalk.dim('Enabled:'), status.enabled ? chalk.green('Yes') : chalk.red('No'));
            console.log(chalk.dim('Active Epics:'), status.activeEpics || 0);
            console.log(chalk.dim('Total Agents:'), status.totalAgents || 0);
            console.log();
          } catch (err: any) {
            error(`Failed to get status: ${err.message}`);
          }
          break;
        }

        default: {
          console.log(chalk.bold('\nCTO-Flow Commands:\n'));
          console.log('  ' + chalk.cyan('cto-flow context-restore') + '  Restore epic context for an agent');
          console.log('  ' + chalk.cyan('cto-flow context-save') + '     Save context to epic memory');
          console.log('  ' + chalk.cyan('cto-flow context-clear') + '    Clear epic context from memory');
          console.log('  ' + chalk.cyan('cto-flow status') + '           Show CTO-Flow mode status');
          console.log();
          console.log(chalk.dim('Options:'));
          console.log(chalk.dim('  --epic <epic-id>       Epic to operate on'));
          console.log(chalk.dim('  --strategy <strategy>  Restoration strategy (full|summary|selective)'));
          console.log(chalk.dim('  --agent <agent-id>     Target agent for context'));
          console.log(chalk.dim('  --cto-flow-mode        Enable CTO-Flow mode'));
          console.log();
        }
      }
    },
  });

  // GitHub Project management command (CTO-Flow workflow)
  cli.command({
    name: 'cto-project',
    description: 'Manage GitHub Projects V2 for CTO-Flow epic lifecycle tracking',
    options: [
      {
        name: 'cto-flow-mode',
        description: 'Enable CTO-Flow mode for this command',
        type: 'boolean',
      },
      {
        name: 'repo',
        description: 'GitHub repository (owner/repo)',
        type: 'string',
      },
      {
        name: 'org',
        description: 'GitHub organization (for org-owned projects)',
        type: 'string',
      },
    ],
    action: async (ctx: CommandContext) => {
      const subcommand = ctx.args[0];

      if (!isCtoFlowModeEnabled(ctx.flags)) {
        showCtoFlowModeDisabledMessage('npx claude-flow cto-project');
        return;
      }

      const module = await getCtoFlowModule();
      if (!module) {
        error('CTO-Flow agents module not available. Please ensure it is properly installed.');
        return;
      }

      // Parse repo from flag or try to detect from git
      let owner = '';
      let repo = '';
      const repoFlag = ctx.flags.repo as string;
      if (repoFlag && repoFlag.includes('/')) {
        [owner, repo] = repoFlag.split('/');
      }

      const orgFlag = ctx.flags.org as string;
      if (orgFlag) {
        owner = orgFlag;
      }

      switch (subcommand) {
        case 'create': {
          const epicId = ctx.args[1];
          const title = ctx.args.slice(2).join(' ') || ctx.flags.title as string;

          if (!epicId || !title) {
            error('Usage: cto-project create <epic-id> <title> [--repo owner/repo]');
            console.log(chalk.dim('\nExample:'));
            console.log(chalk.cyan('  npx claude-flow cto-project create auth-system "User Authentication System" --repo myorg/myapp'));
            return;
          }

          if (!owner || !repo) {
            error('Repository required. Use --repo owner/repo');
            return;
          }

          try {
            info('Creating GitHub Project...');

            const { CtoFlowProjectBridge } = module;
            const bridge = new CtoFlowProjectBridge({
              github: {
                owner,
                repo,
                ownerType: orgFlag ? 'org' : 'user',
              },
            });

            const description = ctx.flags.description as string || `Epic: ${title}`;
            const mapping = await bridge.createProjectForEpic(epicId, title, description);

            success('GitHub Project created successfully!');
            console.log();
            console.log(chalk.bold.cyan('Project Details:'));
            console.log(chalk.dim('  Epic ID:'), epicId);
            console.log(chalk.dim('  Project #:'), mapping.projectNumber);
            console.log(chalk.dim('  URL:'), chalk.underline(mapping.projectUrl));
            console.log(chalk.dim('  Issues:'), mapping.issueNumbers.length);
            console.log();
            console.log(chalk.dim('Next steps:'));
            console.log(chalk.dim('  1. Add tasks: ') + chalk.cyan(`npx claude-flow cto-project add-task ${epicId} "Task title"`));
            console.log(chalk.dim('  2. View progress: ') + chalk.cyan(`npx claude-flow cto-project progress ${epicId}`));
            console.log();
          } catch (err: any) {
            error(`Failed to create project: ${err.message}`);
          }
          break;
        }

        case 'add-task': {
          const epicId = ctx.args[1];
          const taskTitle = ctx.args.slice(2).join(' ') || ctx.flags.title as string;

          if (!epicId || !taskTitle) {
            error('Usage: cto-project add-task <epic-id> <task-title> [--description "..."] [--priority high]');
            return;
          }

          try {
            info('Adding task to project...');

            const { CtoFlowProjectBridge } = module;
            const bridge = new CtoFlowProjectBridge({
              github: { owner, repo, ownerType: orgFlag ? 'org' : 'user' },
            });

            const description = ctx.flags.description as string || '';
            const priority = ctx.flags.priority as string;
            const labels = ctx.flags.labels ? (ctx.flags.labels as string).split(',') : [];

            const result = await bridge.addTaskToEpic(epicId, taskTitle, description, labels, priority);

            success('Task added successfully!');
            console.log(chalk.dim('Issue #:'), result.issueNumber);
            console.log();
          } catch (err: any) {
            error(`Failed to add task: ${err.message}`);
          }
          break;
        }

        case 'progress': {
          const epicId = ctx.args[1];

          if (!epicId) {
            error('Usage: cto-project progress <epic-id>');
            return;
          }

          try {
            const { CtoFlowProjectBridge } = module;
            const bridge = new CtoFlowProjectBridge({
              github: { owner, repo, ownerType: orgFlag ? 'org' : 'user' },
            });

            const progress = await bridge.getEpicProgress(epicId);

            console.log(chalk.bold.cyan(`\nEpic Progress: ${epicId}\n`));
            console.log(chalk.dim('Total Items:'), progress.total);
            console.log(chalk.dim('Completed:'), chalk.green(progress.completed));
            console.log(chalk.dim('In Progress:'), chalk.yellow(progress.inProgress));
            console.log(chalk.dim('Blocked:'), chalk.red(progress.blocked));
            console.log();

            // Progress bar
            const barWidth = 30;
            const filledWidth = Math.round((progress.percentage / 100) * barWidth);
            const emptyWidth = barWidth - filledWidth;
            const progressBar = chalk.green('█'.repeat(filledWidth)) + chalk.gray('░'.repeat(emptyWidth));
            console.log(`Progress: ${progressBar} ${progress.percentage}%`);
            console.log();

            // Status breakdown
            if (Object.keys(progress.statusCounts).length > 0) {
              console.log(chalk.bold('Status Breakdown:'));
              for (const [status, count] of Object.entries(progress.statusCounts)) {
                console.log(`  ${status}: ${count}`);
              }
              console.log();
            }
          } catch (err: any) {
            error(`Failed to get progress: ${err.message}`);
          }
          break;
        }

        case 'assign': {
          const epicId = ctx.args[1];
          const issueNumber = parseInt(ctx.args[2] || '0', 10);
          const agentType = ctx.flags.agent as string;

          if (!epicId || !issueNumber || !agentType) {
            error('Usage: cto-project assign <epic-id> <issue-number> --agent <agent-type>');
            console.log(chalk.dim('\nExample:'));
            console.log(chalk.cyan('  npx claude-flow cto-project assign auth-system 42 --agent coder'));
            return;
          }

          try {
            info('Assigning agent to issue...');

            const { CtoFlowProjectBridge } = module;
            const bridge = new CtoFlowProjectBridge({
              github: { owner, repo, ownerType: orgFlag ? 'org' : 'user' },
            });

            const agentId = `${agentType}-${Date.now()}`;
            const score = parseInt(ctx.flags.score as string || '80', 10);

            const assignment = await bridge.assignAgentToIssue(
              agentId,
              agentType,
              issueNumber,
              epicId,
              score
            );

            success('Agent assigned successfully!');
            console.log(chalk.dim('Agent:'), assignment.agentId);
            console.log(chalk.dim('Issue #:'), assignment.issueNumber);
            console.log(chalk.dim('Score:'), assignment.score);
            console.log();
          } catch (err: any) {
            error(`Failed to assign agent: ${err.message}`);
          }
          break;
        }

        case 'available': {
          try {
            info('Finding available issues for agents...');

            const { CtoFlowProjectBridge } = module;
            const bridge = new CtoFlowProjectBridge({
              github: { owner, repo, ownerType: orgFlag ? 'org' : 'user' },
            });

            const capabilities = ctx.flags.capabilities
              ? (ctx.flags.capabilities as string).split(',')
              : [];
            const domains = ctx.flags.domains
              ? (ctx.flags.domains as string).split(',')
              : [];

            const issues = await bridge.getAvailableIssuesForAgent(capabilities, domains);

            if (issues.length === 0) {
              warning('No available issues found matching the criteria.');
              return;
            }

            console.log(chalk.bold.cyan(`\nAvailable Issues (${issues.length}):\n`));

            for (const issue of issues) {
              const priorityColor = {
                critical: chalk.red,
                high: chalk.yellow,
                medium: chalk.blue,
                low: chalk.gray,
              }[issue.priority] || chalk.white;

              console.log(`#${issue.number} ${issue.title}`);
              console.log(chalk.dim(`  Epic: ${issue.epicId || 'N/A'} | Priority: `) + priorityColor(issue.priority));
              if (issue.requiredCapabilities.length > 0) {
                console.log(chalk.dim(`  Required: ${issue.requiredCapabilities.join(', ')}`));
              }
              console.log();
            }
          } catch (err: any) {
            error(`Failed to get available issues: ${err.message}`);
          }
          break;
        }

        case 'link-pr': {
          const prNumber = parseInt(ctx.args[1] || '0', 10);
          const issueNumber = parseInt(ctx.args[2] || '0', 10);
          const epicId = ctx.args[3] || ctx.flags.epic as string;

          if (!prNumber || !issueNumber || !epicId) {
            error('Usage: cto-project link-pr <pr-number> <issue-number> <epic-id>');
            return;
          }

          try {
            info('Linking PR to issue...');

            const { CtoFlowProjectBridge } = module;
            const bridge = new CtoFlowProjectBridge({
              github: { owner, repo, ownerType: orgFlag ? 'org' : 'user' },
            });

            await bridge.linkPRToIssue(prNumber, issueNumber, epicId);

            success(`PR #${prNumber} linked to issue #${issueNumber}`);
          } catch (err: any) {
            error(`Failed to link PR: ${err.message}`);
          }
          break;
        }

        default: {
          console.log(chalk.bold('\nCTO-Flow GitHub Project Commands:\n'));
          console.log('  ' + chalk.cyan('cto-project create <epic-id> <title>') + '  Create a GitHub Project for an epic');
          console.log('  ' + chalk.cyan('cto-project add-task <epic-id> <title>') + ' Add a task issue to the project');
          console.log('  ' + chalk.cyan('cto-project progress <epic-id>') + '        View epic progress');
          console.log('  ' + chalk.cyan('cto-project assign <epic-id> <issue> --agent <type>') + '  Assign agent to issue');
          console.log('  ' + chalk.cyan('cto-project available') + '                 List available issues for agents');
          console.log('  ' + chalk.cyan('cto-project link-pr <pr> <issue> <epic>') + '  Link a PR to an issue');
          console.log();
          console.log(chalk.dim('Options:'));
          console.log(chalk.dim('  --cto-flow-mode        Enable CTO-Flow mode'));
          console.log(chalk.dim('  --repo <owner/repo>    GitHub repository'));
          console.log(chalk.dim('  --org <org-name>       Organization (for org-owned projects)'));
          console.log(chalk.dim('  --description "..."    Description for project/task'));
          console.log(chalk.dim('  --priority <level>     Task priority (low|medium|high|critical)'));
          console.log();
          console.log(chalk.bold('Example Workflow:\n'));
          console.log(chalk.dim('  1. Create epic with project:'));
          console.log(chalk.cyan('     npx claude-flow cto-project create auth-v2 "Auth System v2" --repo myorg/app'));
          console.log();
          console.log(chalk.dim('  2. Add tasks:'));
          console.log(chalk.cyan('     npx claude-flow cto-project add-task auth-v2 "Implement OAuth2" --priority high'));
          console.log(chalk.cyan('     npx claude-flow cto-project add-task auth-v2 "Add MFA support" --priority medium'));
          console.log();
          console.log(chalk.dim('  3. Assign agents:'));
          console.log(chalk.cyan('     npx claude-flow cto-project assign auth-v2 42 --agent backend-dev'));
          console.log();
          console.log(chalk.dim('  4. Track progress:'));
          console.log(chalk.cyan('     npx claude-flow cto-project progress auth-v2'));
          console.log();
        }
      }
    },
  });
}
