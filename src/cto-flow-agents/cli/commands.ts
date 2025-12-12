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
import { EpicManager } from '../core/epic-manager.js';
import { ContextRestoration } from '../core/context-restoration.js';
import { EpicMemoryManager } from '../memory/epic-memory.js';
import { GitHubEpicClient } from '../github/epic-client.js';
import { CtoFlowConfig } from '../core/config.js';
import {
  Epic,
  EpicState,
  ContextRestorationStrategy,
  AutoAssignStrategy
} from '../core/types.js';

/**
 * Check if CTO-Flow mode is enabled from config or environment
 */
function isCtoFlowModeEnabled(overrideFlag?: boolean): boolean {
  if (overrideFlag !== undefined) {
    return overrideFlag;
  }

  const config = CtoFlowConfig.getInstance();
  return config.get('ctoflow.enabled', false);
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
    epic.title.substring(0, 50) + (epic.title.length > 50 ? '...' : ''),
    epic.state,
    epic.currentPhase || 'N/A',
    epic.childIssues.length.toString(),
    new Date(epic.createdAt).toLocaleDateString()
  ];
}

/**
 * Format epic details for display
 */
function formatEpicDetails(epic: Epic): void {
  console.log(chalk.bold.cyan(`\n📋 Epic: ${epic.title}\n`));

  const table = new Table({
    chars: { 'mid': '', 'left-mid': '', 'mid-mid': '', 'right-mid': '' }
  });

  table.push(
    ['ID', epic.id],
    ['GitHub Issue', epic.githubIssueNumber ? `#${epic.githubIssueNumber}` : 'Not synced'],
    ['Repository', epic.repository || 'N/A'],
    ['State', getStateEmoji(epic.state) + ' ' + epic.state],
    ['Current Phase', epic.currentPhase || 'Not started'],
    ['Created', new Date(epic.createdAt).toLocaleString()],
    ['Updated', new Date(epic.updatedAt).toLocaleString()]
  );

  console.log(table.toString());

  if (epic.description) {
    console.log(chalk.bold('\nDescription:'));
    console.log(chalk.dim(epic.description.substring(0, 200) + '...'));
  }

  if (epic.requirements.length > 0) {
    console.log(chalk.bold('\nRequirements:'));
    epic.requirements.slice(0, 5).forEach((req, i) => {
      console.log(chalk.dim(`  ${i + 1}. ${req.substring(0, 80)}`));
    });
    if (epic.requirements.length > 5) {
      console.log(chalk.dim(`  ... and ${epic.requirements.length - 5} more`));
    }
  }

  if (epic.childIssues.length > 0) {
    console.log(chalk.bold('\nChild Issues:'));
    const issuesTable = new Table({
      head: ['#', 'Title', 'State', 'Assigned'],
      colWidths: [8, 40, 12, 15]
    });

    epic.childIssues.slice(0, 10).forEach(issue => {
      issuesTable.push([
        issue.number?.toString() || 'N/A',
        issue.title.substring(0, 37) + '...',
        issue.state || 'open',
        issue.assignedAgent || 'unassigned'
      ]);
    });

    console.log(issuesTable.toString());

    if (epic.childIssues.length > 10) {
      console.log(chalk.dim(`  ... and ${epic.childIssues.length - 10} more issues`));
    }
  }

  console.log();
}

/**
 * Get emoji for epic state
 */
function getStateEmoji(state: EpicState): string {
  const emojis = {
    active: '🟢',
    paused: '🟡',
    completed: '✅',
    cancelled: '❌'
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
        const epicManager = new EpicManager();

        let epicData: any = {
          title,
          description: options.description || '',
          repository: options.repo,
          requirements: options.requirements || [],
          userStories: options.userStories || []
        };

        // Generate from SPARC specification if provided
        if (options.generateFromSparc) {
          const fs = await import('fs-extra');
          const sparcSpec = await fs.readJSON(options.generateFromSparc);

          epicData = {
            title: sparcSpec.taskDescription || title,
            description: sparcSpec.problemStatement || '',
            repository: options.repo,
            requirements: sparcSpec.requirements || [],
            userStories: sparcSpec.userStories || [],
            acceptanceCriteria: sparcSpec.acceptanceCriteria || [],
            constraints: sparcSpec.constraints || [],
            risks: sparcSpec.risks || []
          };
        }

        const epic = await epicManager.createEpic(epicData);

        spinner.succeed(chalk.green('Epic created successfully!'));

        console.log(chalk.bold.cyan(`\n✨ Epic Created: ${epic.title}\n`));
        console.log(chalk.dim('ID:'), epic.id);
        if (epic.githubIssueNumber) {
          console.log(chalk.dim('GitHub Issue:'), `#${epic.githubIssueNumber}`);
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
        const epicManager = new EpicManager();

        const filters: any = {};
        if (options.status && options.status !== 'all') {
          filters.state = options.status as EpicState;
        }
        if (options.repo) {
          filters.repository = options.repo;
        }
        if (options.phase) {
          filters.currentPhase = options.phase;
        }

        const epics = await epicManager.listEpics(filters);

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
        const epicManager = new EpicManager();
        const epic = await epicManager.getEpic(epicId);

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
        const epicManager = new EpicManager();

        const updates: any = {};
        if (options.state) updates.state = options.state as EpicState;
        if (options.phase) updates.currentPhase = options.phase;
        if (options.title) updates.title = options.title;
        if (options.description) updates.description = options.description;

        if (Object.keys(updates).length === 0) {
          spinner.fail(chalk.red('No updates provided'));
          console.log(chalk.yellow('\nPlease provide at least one field to update.'));
          console.log(chalk.dim('Available options: --state, --phase, --title, --description'));
          console.log();
          process.exit(1);
        }

        const epic = await epicManager.updateEpic(epicId, updates);

        spinner.succeed(chalk.green('Epic updated successfully!'));

        console.log(chalk.bold.cyan(`\n✅ Epic Updated: ${epic.title}\n`));
        if (options.state) console.log(chalk.dim('State:'), epic.state);
        if (options.phase) console.log(chalk.dim('Phase:'), epic.currentPhase);
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
        const epicManager = new EpicManager();
        const githubClient = new GitHubEpicClient();

        const direction = options.direction;
        const force = options.force || false;

        if (direction === 'github-to-memory' || direction === 'bidirectional') {
          spinner.text = 'Syncing from GitHub to memory...';
          await epicManager.syncFromGitHub(epicId, { force });
        }

        if (direction === 'memory-to-github' || direction === 'bidirectional') {
          spinner.text = 'Syncing from memory to GitHub...';
          await epicManager.syncToGitHub(epicId, { force });
        }

        spinner.succeed(chalk.green('Epic synced successfully!'));

        console.log(chalk.bold.cyan('\n✅ Sync Complete\n'));
        console.log(chalk.dim('Direction:'), direction);
        console.log(chalk.dim('Epic ID:'), epicId);
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
        const epicManager = new EpicManager();

        if (options.autoAssign) {
          const strategy = options.strategy as AutoAssignStrategy;
          const assignments = await epicManager.autoAssignAgents(epicId, {
            strategy,
            issueNumber: options.issue ? parseInt(options.issue) : undefined
          });

          spinner.succeed(chalk.green('Agents assigned successfully!'));

          console.log(chalk.bold.cyan('\n✅ Auto-Assignment Complete\n'));
          console.log(chalk.dim('Strategy:'), strategy);
          console.log(chalk.dim('Assignments:'), assignments.length);
          console.log();

          if (assignments.length > 0) {
            const table = new Table({
              head: ['Issue', 'Agent', 'Capability Match'],
              colWidths: [20, 30, 20]
            });

            assignments.forEach(assignment => {
              table.push([
                `#${assignment.issueNumber}`,
                assignment.agentId,
                `${Math.round(assignment.matchScore * 100)}%`
              ]);
            });

            console.log(table.toString());
            console.log();
          }
        } else if (options.agent) {
          if (!options.issue) {
            spinner.fail(chalk.red('Issue number required for manual assignment'));
            console.log(chalk.yellow('\nPlease specify --issue <number> for manual assignment.'));
            console.log();
            process.exit(1);
          }

          await epicManager.assignAgent(epicId, parseInt(options.issue), options.agent);

          spinner.succeed(chalk.green('Agent assigned successfully!'));

          console.log(chalk.bold.cyan('\n✅ Assignment Complete\n'));
          console.log(chalk.dim('Issue:'), `#${options.issue}`);
          console.log(chalk.dim('Agent:'), options.agent);
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
        const contextRestoration = new ContextRestoration();

        const context = await contextRestoration.restore(options.epic, {
          strategy: options.strategy as ContextRestorationStrategy,
          targetAgent: options.agent,
          maxTokens: parseInt(options.maxTokens)
        });

        spinner.succeed(chalk.green('Context restored successfully!'));

        console.log(chalk.bold.cyan('\n✅ Context Restored\n'));
        console.log(chalk.dim('Epic:'), context.epicId);
        console.log(chalk.dim('Strategy:'), options.strategy);
        console.log(chalk.dim('Token Count:'), context.tokenCount);
        console.log();

        if (context.summary) {
          console.log(chalk.bold('Summary:'));
          console.log(chalk.dim(context.summary.substring(0, 200) + '...'));
          console.log();
        }

        console.log(chalk.dim('Context saved to:'), context.memoryKey);
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
        const memoryManager = new EpicMemoryManager();

        let contextData: any;

        if (options.file) {
          const fs = await import('fs-extra');
          contextData = await fs.readJSON(options.file);
        } else if (options.data) {
          contextData = JSON.parse(options.data);
        } else {
          spinner.fail(chalk.red('No context data provided'));
          console.log(chalk.yellow('\nPlease provide context data via --data or --file.'));
          console.log();
          process.exit(1);
        }

        await memoryManager.saveContext(options.epic, contextData);

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
        const memoryManager = new EpicMemoryManager();
        await memoryManager.clearContext(options.epic);

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
 * Register all teammate-related commands to a parent command
 */
export function registerCtoFlowCommands(program: Command): void {
  program.addCommand(createEpicCommand());
  program.addCommand(createCtoFlowCommand());
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
