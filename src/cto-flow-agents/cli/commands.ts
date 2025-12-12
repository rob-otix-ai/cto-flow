/**
 * CTO-Flow Agent Management - CLI Commands
 *
 * Comprehensive CLI implementation for epic management, context restoration,
 * and CTO-Flow mode control in the claude-flow framework.
 *
 * @module cto-flow-agents/cli/commands
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import ora from 'ora';
import { CtoFlowManager, type Epic as ManagerEpic } from '../index.js';
import { CtoFlowConfigManager, getConfig } from '../core/config-manager.js';
import { EpicMemoryManager } from '../memory/epic-memory-manager.js';
import { EpicState } from '../core/epic-state-machine.js';

// Re-export types for CLI usage
type Epic = ManagerEpic;
type ContextRestorationStrategy = 'full' | 'summary' | 'selective';
type AutoAssignStrategy = 'capability' | 'availability' | 'balanced';

// Singleton manager instance for CLI commands
let _manager: CtoFlowManager | null = null;

function getManager(): CtoFlowManager {
  if (!_manager) {
    _manager = new CtoFlowManager();
  }
  return _manager;
}

/**
 * Check if CTO-Flow mode is enabled from config or environment
 */
function isCtoFlowModeEnabled(overrideFlag?: boolean): boolean {
  if (overrideFlag !== undefined) {
    return overrideFlag;
  }

  // Check environment variable first
  if (process.env.CTOFLOW_MODE === 'true') {
    return true;
  }

  const configManager = CtoFlowConfigManager.getInstance();
  return configManager.isCtoFlowModeEnabled();
}

/**
 * Show helpful message when CTO-Flow mode is disabled
 */
function showCtoFlowModeDisabledMessage(command: string): void {
  console.log(chalk.yellow('\n⚠️  CTO-Flow Mode is currently disabled\n'));
  console.log(chalk.dim('To enable CTO-Flow mode, you can:'));
  console.log(chalk.dim('  1. Set in config: ') + chalk.cyan('npx claude-flow config set ctoflow.enabled true'));
  console.log(chalk.dim('  2. Use flag: ') + chalk.cyan(`${command} --cto-flow-mode`));
  console.log(chalk.dim('  3. Set environment: ') + chalk.cyan('CTOFLOW_MODE=true'));
  console.log();
}

/**
 * Format epic for display
 */
function formatEpic(epic: Epic): string[] {
  return [
    epic.id,
    (epic.name || '').substring(0, 50) + ((epic.name || '').length > 50 ? '...' : ''),
    epic.state,
    (epic.metadata?.currentPhase as string) || 'N/A',
    '0', // Tasks count - would need to query separately
    epic.createdAt ? new Date(epic.createdAt).toLocaleDateString() : 'N/A'
  ];
}

/**
 * Format epic details for display
 */
function formatEpicDetails(epic: Epic): void {
  console.log(chalk.bold.cyan(`\n📋 Epic: ${epic.name}\n`));

  const table = new Table({
    chars: { 'mid': '', 'left-mid': '', 'mid-mid': '', 'right-mid': '' }
  });

  table.push(
    ['ID', epic.id],
    ['GitHub Issue', epic.issueNumber ? `#${epic.issueNumber}` : 'Not synced'],
    ['URL', epic.url || 'N/A'],
    ['State', getStateEmoji(epic.state as EpicState) + ' ' + epic.state],
    ['Current Phase', (epic.metadata?.currentPhase as string) || 'Not started'],
    ['Created', epic.createdAt ? new Date(epic.createdAt).toLocaleString() : 'N/A'],
    ['Updated', epic.updatedAt ? new Date(epic.updatedAt).toLocaleString() : 'N/A']
  );

  console.log(table.toString());

  if (epic.description) {
    console.log(chalk.bold('\nDescription:'));
    console.log(chalk.dim(epic.description.substring(0, 200) + (epic.description.length > 200 ? '...' : '')));
  }

  const requirements = epic.metadata?.requirements as string[] | undefined;
  if (requirements && requirements.length > 0) {
    console.log(chalk.bold('\nRequirements:'));
    requirements.slice(0, 5).forEach((req: string, i: number) => {
      console.log(chalk.dim(`  ${i + 1}. ${req.substring(0, 80)}`));
    });
    if (requirements.length > 5) {
      console.log(chalk.dim(`  ... and ${requirements.length - 5} more`));
    }
  }

  console.log();
}

/**
 * Get emoji for epic state
 */
function getStateEmoji(state: EpicState | string): string {
  const emojis: Record<string, string> = {
    [EpicState.ACTIVE]: '🟢',
    [EpicState.PAUSED]: '🟡',
    [EpicState.BLOCKED]: '🔴',
    [EpicState.REVIEW]: '🔵',
    [EpicState.COMPLETED]: '✅',
    [EpicState.ARCHIVED]: '❌',
    [EpicState.UNINITIALIZED]: '⚪',
    // Also support lowercase keys
    'active': '🟢',
    'paused': '🟡',
    'blocked': '🔴',
    'review': '🔵',
    'completed': '✅',
    'archived': '❌',
    'cancelled': '❌'
  };
  return emojis[state] || '⚪';
}

/**
 * Create epic command
 */
export function createEpicCommand(): Command {
  const epic = new Command('epic')
    .description('Manage epics in cto-flow agent system');

  // epic create
  epic
    .command('create')
    .argument('<title>', 'Epic title')
    .option('-d, --description <text>', 'Epic description')
    .option('-r, --repo <owner/repo>', 'GitHub repository')
    .option('--requirements <items...>', 'List of requirements')
    .option('--user-stories <items...>', 'List of user stories')
    .option('--generate-from-sparc <file>', 'Generate from SPARC specification file')
    .option('--cto-flow-mode', 'Enable CTO-Flow mode for this command')
    .option('--no-cto-flow-mode', 'Disable CTO-Flow mode for this command')
    .description('Create a new epic')
    .action(async (title: string, options: any) => {
      const ctoFlowEnabled = isCtoFlowModeEnabled(
        options.ctoFlowMode === true ? true :
        options.ctoFlowMode === false ? false :
        undefined
      );

      if (!ctoFlowEnabled) {
        showCtoFlowModeDisabledMessage('npx claude-flow epic create');
        return;
      }

      const spinner = ora('Creating epic...').start();

      try {
        const manager = getManager();
        await manager.initialize();

        let epicMetadata: Record<string, unknown> = {
          description: options.description || '',
          repository: options.repo,
          requirements: options.requirements || [],
          userStories: options.userStories || []
        };

        // Generate from SPARC specification if provided
        if (options.generateFromSparc) {
          const fs = await import('fs-extra');
          const sparcSpec = await fs.readJSON(options.generateFromSparc);

          epicMetadata = {
            description: sparcSpec.problemStatement || '',
            repository: options.repo,
            requirements: sparcSpec.requirements || [],
            userStories: sparcSpec.userStories || [],
            acceptanceCriteria: sparcSpec.acceptanceCriteria || [],
            constraints: sparcSpec.constraints || [],
            risks: sparcSpec.risks || []
          };
        }

        const epic = await manager.createEpic(title, { metadata: epicMetadata });

        spinner.succeed(chalk.green('Epic created successfully!'));

        console.log(chalk.bold.cyan(`\n✨ Epic Created: ${epic.name}\n`));
        console.log(chalk.dim('ID:'), epic.id);
        if (epic.issueNumber) {
          console.log(chalk.dim('GitHub Issue:'), `#${epic.issueNumber}`);
        }
        console.log(chalk.dim('State:'), epic.state);
        console.log();

        console.log(chalk.dim('Next steps:'));
        console.log(chalk.cyan(`  npx claude-flow epic show ${epic.id}`));
        console.log(chalk.cyan(`  npx claude-flow epic assign ${epic.id} --auto-assign`));
        console.log();
      } catch (error: any) {
        spinner.fail(chalk.red('Failed to create epic'));
        console.error(chalk.red('\nError:'), error.message);
        process.exit(1);
      }
    });

  // epic list
  epic
    .command('list')
    .option('--status <state>', 'Filter by state (active|paused|completed|all)', 'active')
    .option('--repo <owner/repo>', 'Filter by repository')
    .option('--phase <phase>', 'Filter by current phase')
    .option('--cto-flow-mode', 'Enable CTO-Flow mode for this command')
    .option('--no-cto-flow-mode', 'Disable CTO-Flow mode for this command')
    .description('List epics')
    .action(async (options: any) => {
      const ctoFlowEnabled = isCtoFlowModeEnabled(
        options.ctoFlowMode === true ? true :
        options.ctoFlowMode === false ? false :
        undefined
      );

      if (!ctoFlowEnabled) {
        showCtoFlowModeDisabledMessage('npx claude-flow epic list');
        return;
      }

      const spinner = ora('Loading epics...').start();

      try {
        const manager = getManager();
        await manager.initialize();

        const filter: any = {};
        if (options.status && options.status !== 'all') {
          filter.state = options.status;
        }

        const epics = await manager.listEpics(filter);

        spinner.stop();

        if (epics.length === 0) {
          console.log(chalk.yellow('\nNo epics found matching the criteria.'));
          console.log(chalk.dim('\nCreate a new epic with:'));
          console.log(chalk.cyan('  npx claude-flow epic create "Epic Title"'));
          console.log();
          return;
        }

        console.log(chalk.bold.cyan(`\n📋 Epics (${epics.length} found)\n`));

        const table = new Table({
          head: ['ID', 'Title', 'State', 'Phase', 'Issues', 'Created'],
          colWidths: [40, 52, 12, 15, 8, 12]
        });

        epics.forEach(epic => {
          table.push(formatEpic(epic));
        });

        console.log(table.toString());
        console.log();
      } catch (error: any) {
        spinner.fail(chalk.red('Failed to list epics'));
        console.error(chalk.red('\nError:'), error.message);
        process.exit(1);
      }
    });

  // epic show
  epic
    .command('show')
    .argument('<epic-id>', 'Epic ID or GitHub issue number')
    .option('--cto-flow-mode', 'Enable CTO-Flow mode for this command')
    .option('--no-cto-flow-mode', 'Disable CTO-Flow mode for this command')
    .description('Show epic details')
    .action(async (epicId: string, options: any) => {
      const ctoFlowEnabled = isCtoFlowModeEnabled(
        options.ctoFlowMode === true ? true :
        options.ctoFlowMode === false ? false :
        undefined
      );

      if (!ctoFlowEnabled) {
        showCtoFlowModeDisabledMessage('npx claude-flow epic show');
        return;
      }

      const spinner = ora('Loading epic...').start();

      try {
        const manager = getManager();
        await manager.initialize();
        const epic = await manager.getEpic(epicId);

        if (!epic) {
          spinner.fail(chalk.red('Epic not found'));
          console.log(chalk.yellow(`\nNo epic found with ID: ${epicId}`));
          console.log();
          process.exit(1);
        }

        spinner.stop();
        formatEpicDetails(epic);
      } catch (error: any) {
        spinner.fail(chalk.red('Failed to load epic'));
        console.error(chalk.red('\nError:'), error.message);
        process.exit(1);
      }
    });

  // epic update
  epic
    .command('update')
    .argument('<epic-id>', 'Epic ID or GitHub issue number')
    .option('--state <state>', 'Update state (active|paused|completed|cancelled)')
    .option('--phase <phase>', 'Update current phase')
    .option('--title <title>', 'Update title')
    .option('--description <text>', 'Update description')
    .option('--cto-flow-mode', 'Enable CTO-Flow mode for this command')
    .option('--no-cto-flow-mode', 'Disable CTO-Flow mode for this command')
    .description('Update epic properties')
    .action(async (epicId: string, options: any) => {
      const ctoFlowEnabled = isCtoFlowModeEnabled(
        options.ctoFlowMode === true ? true :
        options.ctoFlowMode === false ? false :
        undefined
      );

      if (!ctoFlowEnabled) {
        showCtoFlowModeDisabledMessage('npx claude-flow epic update');
        return;
      }

      const spinner = ora('Updating epic...').start();

      try {
        // Note: Update is not fully implemented in CtoFlowManager yet
        // This shows the pattern but would need epicManager.updateEpic()
        const manager = getManager();
        await manager.initialize();
        const epic = await manager.getEpic(epicId);

        if (!epic) {
          spinner.fail(chalk.red('Epic not found'));
          console.log(chalk.yellow(`\nNo epic found with ID: ${epicId}`));
          process.exit(1);
        }

        if (!options.state && !options.phase && !options.title && !options.description) {
          spinner.fail(chalk.red('No updates provided'));
          console.log(chalk.yellow('\nPlease provide at least one field to update.'));
          console.log(chalk.dim('Available options: --state, --phase, --title, --description'));
          console.log();
          process.exit(1);
        }

        // For now, just acknowledge the update - full implementation would need state machine transitions
        spinner.succeed(chalk.green('Epic update acknowledged!'));

        console.log(chalk.bold.cyan(`\n✅ Epic: ${epic.name}\n`));
        console.log(chalk.dim('Note: Full update functionality coming soon'));
        console.log(chalk.dim('State:'), epic.state);
        console.log();
      } catch (error: any) {
        spinner.fail(chalk.red('Failed to update epic'));
        console.error(chalk.red('\nError:'), error.message);
        process.exit(1);
      }
    });

  // epic sync
  epic
    .command('sync')
    .argument('<epic-id>', 'Epic ID or GitHub issue number')
    .option('--direction <dir>', 'Sync direction (github-to-memory|memory-to-github|bidirectional)', 'bidirectional')
    .option('--force', 'Force sync ignoring conflicts')
    .option('--cto-flow-mode', 'Enable CTO-Flow mode for this command')
    .option('--no-cto-flow-mode', 'Disable CTO-Flow mode for this command')
    .description('Sync epic with GitHub')
    .action(async (epicId: string, options: any) => {
      const ctoFlowEnabled = isCtoFlowModeEnabled(
        options.ctoFlowMode === true ? true :
        options.ctoFlowMode === false ? false :
        undefined
      );

      if (!ctoFlowEnabled) {
        showCtoFlowModeDisabledMessage('npx claude-flow epic sync');
        return;
      }

      const spinner = ora('Syncing epic...').start();

      try {
        const manager = getManager();
        await manager.initialize();

        const direction = options.direction;

        // Use the built-in sync functionality
        const result = await manager.syncEpic(epicId);

        if (!result.success) {
          spinner.fail(chalk.red('Sync failed'));
          console.log(chalk.yellow(`\nError: ${result.error}`));
          process.exit(1);
        }

        spinner.succeed(chalk.green('Epic synced successfully!'));

        console.log(chalk.bold.cyan('\n✅ Sync Complete\n'));
        console.log(chalk.dim('Direction:'), direction);
        console.log(chalk.dim('Epic ID:'), epicId);
        console.log(chalk.dim('Synced:'), result.synced ? 'Yes' : 'No');
        if (result.conflicts && result.conflicts > 0) {
          console.log(chalk.yellow('Conflicts:'), result.conflicts);
        }
        console.log();
      } catch (error: any) {
        spinner.fail(chalk.red('Failed to sync epic'));
        console.error(chalk.red('\nError:'), error.message);
        if (error.conflicts) {
          console.log(chalk.yellow('\nConflicts detected:'));
          error.conflicts.forEach((conflict: any) => {
            console.log(chalk.yellow(`  - ${conflict.field}: ${conflict.message}`));
          });
          console.log(chalk.dim('\nUse --force to override conflicts'));
        }
        console.log();
        process.exit(1);
      }
    });

  // epic assign
  epic
    .command('assign')
    .argument('<epic-id>', 'Epic ID or GitHub issue number')
    .option('--auto-assign', 'Automatically assign agents based on capabilities')
    .option('--strategy <strategy>', 'Assignment strategy (capability|availability|balanced)', 'capability')
    .option('--agent <agent-id>', 'Manually assign specific agent to epic')
    .option('--issue <issue-number>', 'Issue number to assign (if not specified, assigns all unassigned)')
    .option('--cto-flow-mode', 'Enable CTO-Flow mode for this command')
    .option('--no-cto-flow-mode', 'Disable CTO-Flow mode for this command')
    .description('Assign agents to epic issues')
    .action(async (epicId: string, options: any) => {
      const ctoFlowEnabled = isCtoFlowModeEnabled(
        options.ctoFlowMode === true ? true :
        options.ctoFlowMode === false ? false :
        undefined
      );

      if (!ctoFlowEnabled) {
        showCtoFlowModeDisabledMessage('npx claude-flow epic assign');
        return;
      }

      const spinner = ora('Assigning agents...').start();

      try {
        const manager = getManager();
        await manager.initialize();

        if (options.autoAssign || options.agent) {
          const issueNumber = options.issue ? parseInt(options.issue) : 0;

          if (!issueNumber) {
            spinner.fail(chalk.red('Issue number required'));
            console.log(chalk.yellow('\nPlease specify --issue <number> for assignment.'));
            process.exit(1);
          }

          // Use the assignWork method from CtoFlowManager
          const assignment = await manager.assignWork(epicId, issueNumber);

          if (!assignment) {
            spinner.fail(chalk.red('No agents available for assignment'));
            console.log(chalk.yellow('\nNo suitable agents found for this task.'));
            process.exit(1);
          }

          spinner.succeed(chalk.green('Agent assigned successfully!'));

          console.log(chalk.bold.cyan('\n✅ Assignment Complete\n'));
          console.log(chalk.dim('Issue:'), `#${issueNumber}`);
          console.log(chalk.dim('Agent:'), assignment.agentId);
          console.log(chalk.dim('Score:'), `${assignment.score}%`);
          console.log();
        } else {
          spinner.fail(chalk.red('No assignment method specified'));
          console.log(chalk.yellow('\nPlease specify either --auto-assign or --agent <agent-id>.'));
          console.log();
          process.exit(1);
        }
      } catch (error: any) {
        spinner.fail(chalk.red('Failed to assign agents'));
        console.error(chalk.red('\nError:'), error.message);
        process.exit(1);
      }
    });

  return epic;
}

/**
 * Create teammate command (context management)
 */
export function createCtoFlowCommand(): Command {
  const teammate = new Command('teammate')
    .description('Manage CTO-Flow mode and context restoration');

  // teammate context-restore
  teammate
    .command('context-restore')
    .option('--epic <epic-id>', 'Epic ID to restore context for')
    .option('--strategy <strategy>', 'Restoration strategy (full|summary|selective)', 'summary')
    .option('--agent <agent-id>', 'Target agent for context restoration')
    .option('--max-tokens <number>', 'Maximum tokens for restored context', '4000')
    .option('--cto-flow-mode', 'Enable CTO-Flow mode for this command')
    .option('--no-cto-flow-mode', 'Disable CTO-Flow mode for this command')
    .description('Restore epic context for an agent')
    .action(async (options: any) => {
      const ctoFlowEnabled = isCtoFlowModeEnabled(
        options.ctoFlowMode === true ? true :
        options.ctoFlowMode === false ? false :
        undefined
      );

      if (!ctoFlowEnabled) {
        showCtoFlowModeDisabledMessage('npx claude-flow teammate context-restore');
        return;
      }

      if (!options.epic) {
        console.log(chalk.red('\nError: --epic <epic-id> is required'));
        console.log();
        process.exit(1);
      }

      const spinner = ora('Restoring context...').start();

      try {
        const manager = getManager();
        await manager.initialize();

        const context = await manager.restoreContext(options.epic);

        spinner.succeed(chalk.green('Context restored successfully!'));

        console.log(chalk.bold.cyan('\n✅ Context Restored\n'));
        console.log(chalk.dim('Epic:'), context.epicId);
        console.log(chalk.dim('Strategy:'), options.strategy);
        console.log(chalk.dim('Title:'), context.title);
        console.log(chalk.dim('Status:'), context.status);
        console.log();

        if (context.description) {
          console.log(chalk.bold('Description:'));
          console.log(chalk.dim(context.description.substring(0, 200) + '...'));
          console.log();
        }

        console.log(chalk.dim('Context loaded for:'), context.epicId);
        console.log();
      } catch (error: any) {
        spinner.fail(chalk.red('Failed to restore context'));
        console.error(chalk.red('\nError:'), error.message);
        process.exit(1);
      }
    });

  // teammate context-save
  teammate
    .command('context-save')
    .option('--epic <epic-id>', 'Epic ID to save context for')
    .option('--data <json>', 'JSON data to save')
    .option('--file <path>', 'File containing context data')
    .option('--cto-flow-mode', 'Enable CTO-Flow mode for this command')
    .option('--no-cto-flow-mode', 'Disable CTO-Flow mode for this command')
    .description('Save context to epic memory')
    .action(async (options: any) => {
      const ctoFlowEnabled = isCtoFlowModeEnabled(
        options.ctoFlowMode === true ? true :
        options.ctoFlowMode === false ? false :
        undefined
      );

      if (!ctoFlowEnabled) {
        showCtoFlowModeDisabledMessage('npx claude-flow teammate context-save');
        return;
      }

      if (!options.epic) {
        console.log(chalk.red('\nError: --epic <epic-id> is required'));
        console.log();
        process.exit(1);
      }

      const spinner = ora('Saving context...').start();

      try {
        const manager = getManager();
        await manager.initialize();

        // Verify epic exists
        const epic = await manager.getEpic(options.epic);
        if (!epic) {
          spinner.fail(chalk.red('Epic not found'));
          console.log(chalk.yellow(`\nNo epic found with ID: ${options.epic}`));
          process.exit(1);
        }

        // Save context using the manager
        await manager.saveContext(options.epic);

        spinner.succeed(chalk.green('Context saved successfully!'));

        console.log(chalk.bold.cyan('\n✅ Context Saved\n'));
        console.log(chalk.dim('Epic:'), options.epic);
        console.log();
      } catch (error: any) {
        spinner.fail(chalk.red('Failed to save context'));
        console.error(chalk.red('\nError:'), error.message);
        process.exit(1);
      }
    });

  // teammate context-clear
  teammate
    .command('context-clear')
    .option('--epic <epic-id>', 'Epic ID to clear context for')
    .option('--confirm', 'Confirm deletion without prompt')
    .option('--cto-flow-mode', 'Enable CTO-Flow mode for this command')
    .option('--no-cto-flow-mode', 'Disable CTO-Flow mode for this command')
    .description('Clear epic context from memory')
    .action(async (options: any) => {
      const ctoFlowEnabled = isCtoFlowModeEnabled(
        options.ctoFlowMode === true ? true :
        options.ctoFlowMode === false ? false :
        undefined
      );

      if (!ctoFlowEnabled) {
        showCtoFlowModeDisabledMessage('npx claude-flow teammate context-clear');
        return;
      }

      if (!options.epic) {
        console.log(chalk.red('\nError: --epic <epic-id> is required'));
        console.log();
        process.exit(1);
      }

      if (!options.confirm) {
        const inquirer = (await import('inquirer')).default;
        const answers = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirmed',
            message: `Are you sure you want to clear context for epic ${options.epic}?`,
            default: false
          }
        ]);

        if (!answers.confirmed) {
          console.log(chalk.yellow('\nCancelled.'));
          console.log();
          return;
        }
      }

      const spinner = ora('Clearing context...').start();

      try {
        const manager = getManager();
        await manager.initialize();

        await manager.clearContext(options.epic);

        spinner.succeed(chalk.green('Context cleared successfully!'));

        console.log(chalk.bold.cyan('\n✅ Context Cleared\n'));
        console.log(chalk.dim('Epic:'), options.epic);
        console.log();
      } catch (error: any) {
        spinner.fail(chalk.red('Failed to clear context'));
        console.error(chalk.red('\nError:'), error.message);
        process.exit(1);
      }
    });

  return teammate;
}

/**
 * Create dashboard command
 */
export function createDashboardCommand(): Command {
  const dashboard = new Command('dashboard')
    .description('Interactive CTO-Flow dashboard for epic monitoring');

  // dashboard show
  dashboard
    .command('show')
    .option('--epic <epic-id>', 'Show specific epic dashboard')
    .option('--format <format>', 'Output format (table|json|minimal)', 'table')
    .option('--cto-flow-mode', 'Enable CTO-Flow mode for this command')
    .option('--no-cto-flow-mode', 'Disable CTO-Flow mode for this command')
    .description('Display CTO-Flow dashboard')
    .action(async (options: any) => {
      const ctoFlowEnabled = isCtoFlowModeEnabled(
        options.ctoFlowMode === true ? true :
        options.ctoFlowMode === false ? false :
        undefined
      );

      if (!ctoFlowEnabled) {
        showCtoFlowModeDisabledMessage('npx claude-flow dashboard show');
        return;
      }

      const spinner = ora('Loading dashboard...').start();

      try {
        const manager = getManager();
        await manager.initialize();

        // Get all epics
        const epics = await manager.listEpics();

        spinner.stop();

        console.log(chalk.bold.cyan('\n📊 CTO-Flow Dashboard\n'));
        console.log(chalk.dim('─'.repeat(60)));

        // Summary stats
        const activeEpics = epics.filter(e => e.state === EpicState.ACTIVE).length;
        const pausedEpics = epics.filter(e => e.state === EpicState.PAUSED).length;
        const completedEpics = epics.filter(e => e.state === EpicState.COMPLETED).length;

        // Count tasks across all epics
        let totalTasks = 0;
        for (const epic of epics) {
          const progress = await manager.getEpicProgress(epic.id);
          totalTasks += progress?.total || 0;
        }

        const summaryTable = new Table({
          chars: { 'mid': '', 'left-mid': '', 'mid-mid': '', 'right-mid': '' }
        });

        summaryTable.push(
          [chalk.bold('Total Epics'), epics.length.toString()],
          [chalk.bold('Active'), chalk.green(activeEpics.toString())],
          [chalk.bold('Paused'), chalk.yellow(pausedEpics.toString())],
          [chalk.bold('Completed'), chalk.blue(completedEpics.toString())],
          [chalk.bold('Total Tasks'), totalTasks.toString()]
        );

        console.log(summaryTable.toString());
        console.log(chalk.dim('─'.repeat(60)));

        // Active epics table
        if (activeEpics > 0) {
          console.log(chalk.bold('\n🟢 Active Epics\n'));

          const activeTable = new Table({
            head: ['Epic', 'Phase', 'Tasks', 'Progress', 'Health'],
            colWidths: [30, 15, 8, 15, 10]
          });

          const activeEpicsList = epics.filter(e => e.state === EpicState.ACTIVE);
          for (const epic of activeEpicsList.slice(0, 5)) {
            const projectProgress = await manager.getEpicProgress(epic.id);
            const totalTasksForEpic = projectProgress?.total || 0;
            const completedTasks = projectProgress?.completed || 0;
            const blockedTasks = projectProgress?.blocked || 0;
            const progress = projectProgress?.percentage || 0;

            let healthIcon = '🟢';
            if (blockedTasks > 0) healthIcon = '🔴';
            else if (progress < 25 && totalTasksForEpic > 0) healthIcon = '🟡';

            activeTable.push([
              (epic.name || '').substring(0, 27) + ((epic.name || '').length > 27 ? '...' : ''),
              (epic.metadata?.currentPhase as string) || 'N/A',
              `${completedTasks}/${totalTasksForEpic}`,
              `${'█'.repeat(Math.floor(progress / 10))}${'░'.repeat(10 - Math.floor(progress / 10))} ${progress}%`,
              healthIcon
            ]);
          }

          console.log(activeTable.toString());

          if (activeEpicsList.length > 5) {
            console.log(chalk.dim(`  ... and ${activeEpicsList.length - 5} more active epics`));
          }
        }

        // Recent activity
        console.log(chalk.bold('\n📈 Quick Actions\n'));
        console.log(chalk.dim('  Create epic:  ') + chalk.cyan('npx claude-flow epic create "Epic Title"'));
        console.log(chalk.dim('  List epics:   ') + chalk.cyan('npx claude-flow epic list'));
        console.log(chalk.dim('  View epic:    ') + chalk.cyan('npx claude-flow epic show <id>'));
        console.log(chalk.dim('  Progress:     ') + chalk.cyan('npx claude-flow progress <epic-id>'));
        console.log();

      } catch (error: any) {
        spinner.fail(chalk.red('Failed to load dashboard'));
        console.error(chalk.red('\nError:'), error.message);
        process.exit(1);
      }
    });

  // dashboard progress
  dashboard
    .command('progress')
    .argument('[epic-id]', 'Epic ID to show progress for')
    .option('--format <format>', 'Output format (table|json|minimal)', 'table')
    .option('--cto-flow-mode', 'Enable CTO-Flow mode for this command')
    .option('--no-cto-flow-mode', 'Disable CTO-Flow mode for this command')
    .description('Show epic progress details')
    .action(async (epicId: string | undefined, options: any) => {
      const ctoFlowEnabled = isCtoFlowModeEnabled(
        options.ctoFlowMode === true ? true :
        options.ctoFlowMode === false ? false :
        undefined
      );

      if (!ctoFlowEnabled) {
        showCtoFlowModeDisabledMessage('npx claude-flow dashboard progress');
        return;
      }

      const spinner = ora('Loading progress...').start();

      try {
        const manager = getManager();
        await manager.initialize();

        if (epicId) {
          // Show specific epic progress
          const epic = await manager.getEpic(epicId);

          if (!epic) {
            spinner.fail(chalk.red('Epic not found'));
            process.exit(1);
          }

          spinner.stop();

          // Try to get project progress if available
          const projectProgress = await manager.getEpicProgress(epicId);

          const totalTasks = projectProgress?.total || 0;
          const completedTasks = projectProgress?.completed || 0;
          const inProgressTasks = projectProgress?.inProgress || 0;
          const blockedTasks = projectProgress?.blocked || 0;
          const pendingTasks = totalTasks - completedTasks - inProgressTasks - blockedTasks;
          const progress = projectProgress?.percentage || 0;

          console.log(chalk.bold.cyan(`\n📊 Progress: ${epic.name}\n`));

          // Progress bar
          const barLength = 40;
          const filledLength = Math.round((progress / 100) * barLength);
          const progressBar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
          console.log(chalk.dim('Progress: ') + `[${progressBar}] ${progress}%`);
          console.log();

          // Stats table
          const statsTable = new Table({
            chars: { 'mid': '', 'left-mid': '', 'mid-mid': '', 'right-mid': '' }
          });

          statsTable.push(
            [chalk.bold('Total Tasks'), totalTasks.toString()],
            [chalk.green('✓ Completed'), completedTasks.toString()],
            [chalk.blue('⟳ In Progress'), inProgressTasks.toString()],
            [chalk.red('✗ Blocked'), blockedTasks.toString()],
            [chalk.dim('○ Pending'), pendingTasks.toString()]
          );

          console.log(statsTable.toString());

          // Velocity estimate
          if (completedTasks > 0 && epic.createdAt) {
            const daysSinceStart = Math.max(1, Math.ceil((Date.now() - new Date(epic.createdAt).getTime()) / (1000 * 60 * 60 * 24)));
            const velocity = completedTasks / daysSinceStart;
            const remainingDays = velocity > 0 ? Math.ceil((totalTasks - completedTasks) / velocity) : 'N/A';

            console.log(chalk.bold('\n📈 Velocity\n'));
            console.log(chalk.dim('  Tasks/day: ') + velocity.toFixed(1));
            console.log(chalk.dim('  Est. completion: ') + (typeof remainingDays === 'number' ? `${remainingDays} days` : remainingDays));
          }

          console.log();
        } else {
          // Show progress for all active epics
          const epics = await manager.listEpics({ state: EpicState.ACTIVE });

          spinner.stop();

          console.log(chalk.bold.cyan('\n📊 All Active Epics Progress\n'));

          const progressTable = new Table({
            head: ['Epic', 'Completed', 'In Progress', 'Blocked', 'Progress'],
            colWidths: [25, 12, 12, 10, 20]
          });

          for (const epic of epics) {
            const projectProgress = await manager.getEpicProgress(epic.id);
            const totalTasks = projectProgress?.total || 0;
            const completedTasks = projectProgress?.completed || 0;
            const inProgressTasks = projectProgress?.inProgress || 0;
            const blockedTasks = projectProgress?.blocked || 0;
            const progress = projectProgress?.percentage || 0;

            const barLength = 10;
            const filledLength = Math.round((progress / 100) * barLength);
            const progressBar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);

            progressTable.push([
              (epic.name || '').substring(0, 22) + ((epic.name || '').length > 22 ? '...' : ''),
              chalk.green(completedTasks.toString()),
              chalk.blue(inProgressTasks.toString()),
              blockedTasks > 0 ? chalk.red(blockedTasks.toString()) : '0',
              `${progressBar} ${progress}%`
            ]);
          }

          console.log(progressTable.toString());
          console.log();
        }
      } catch (error: any) {
        spinner.fail(chalk.red('Failed to load progress'));
        console.error(chalk.red('\nError:'), error.message);
        process.exit(1);
      }
    });

  // dashboard health
  dashboard
    .command('health')
    .option('--epic <epic-id>', 'Show health for specific epic')
    .option('--cto-flow-mode', 'Enable CTO-Flow mode for this command')
    .option('--no-cto-flow-mode', 'Disable CTO-Flow mode for this command')
    .description('Show system health and recommendations')
    .action(async (options: any) => {
      const ctoFlowEnabled = isCtoFlowModeEnabled(
        options.ctoFlowMode === true ? true :
        options.ctoFlowMode === false ? false :
        undefined
      );

      if (!ctoFlowEnabled) {
        showCtoFlowModeDisabledMessage('npx claude-flow dashboard health');
        return;
      }

      const spinner = ora('Checking health...').start();

      try {
        const manager = getManager();
        await manager.initialize();
        const epics = await manager.listEpics();

        spinner.stop();

        console.log(chalk.bold.cyan('\n🏥 CTO-Flow Health Check\n'));

        let healthyCount = 0;
        let atRiskCount = 0;
        let blockedCount = 0;
        const recommendations: string[] = [];

        for (const epic of epics.filter(e => e.state === EpicState.ACTIVE)) {
          const projectProgress = await manager.getEpicProgress(epic.id);
          const totalTasks = projectProgress?.total || 0;
          const blockedTasks = projectProgress?.blocked || 0;
          const completedTasks = projectProgress?.completed || 0;
          const progress = projectProgress?.percentage || 0;

          if (blockedTasks > 0) {
            blockedCount++;
            recommendations.push(`🔴 Epic "${epic.name}" has ${blockedTasks} blocked task(s)`);
          } else if (progress < 20 && totalTasks > 0) {
            atRiskCount++;
            recommendations.push(`🟡 Epic "${epic.name}" is progressing slowly (${progress.toFixed(0)}%)`);
          } else {
            healthyCount++;
          }
        }

        // Health summary
        const healthTable = new Table({
          chars: { 'mid': '', 'left-mid': '', 'mid-mid': '', 'right-mid': '' }
        });

        healthTable.push(
          [chalk.green('🟢 Healthy'), healthyCount.toString()],
          [chalk.yellow('🟡 At Risk'), atRiskCount.toString()],
          [chalk.red('🔴 Blocked'), blockedCount.toString()]
        );

        console.log(healthTable.toString());

        // Overall status
        let overallStatus = '🟢 Healthy';
        if (blockedCount > 0) {
          overallStatus = '🔴 Issues Detected';
        } else if (atRiskCount > 0) {
          overallStatus = '🟡 At Risk';
        }

        console.log(chalk.bold('\nOverall Status: ') + overallStatus);

        // Recommendations
        if (recommendations.length > 0) {
          console.log(chalk.bold('\n💡 Recommendations\n'));
          recommendations.slice(0, 5).forEach(rec => {
            console.log(`  ${rec}`);
          });
          if (recommendations.length > 5) {
            console.log(chalk.dim(`  ... and ${recommendations.length - 5} more`));
          }
        } else {
          console.log(chalk.green('\n✅ All systems operating normally'));
        }

        console.log();
      } catch (error: any) {
        spinner.fail(chalk.red('Failed to check health'));
        console.error(chalk.red('\nError:'), error.message);
        process.exit(1);
      }
    });

  return dashboard;
}

/**
 * Register all teammate-related commands to a parent command
 */
export function registerCtoFlowCommands(program: Command): void {
  program.addCommand(createEpicCommand());
  program.addCommand(createCtoFlowCommand());
  program.addCommand(createDashboardCommand());
}

/**
 * Parse and execute teammate commands
 */
export async function executeCtoFlowCommand(args: string[]): Promise<void> {
  const program = new Command();

  program
    .name('claude-flow')
    .description('Claude Flow with CTO-Flow Agent Management')
    .version('2.7.47');

  registerCtoFlowCommands(program);

  await program.parseAsync(args);
}
