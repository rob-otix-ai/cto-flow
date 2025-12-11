#!/usr/bin/env node
/**
 * Hive-Mind Epic Commands
 *
 * CLI commands for managing epic issues with hive-mind coordination:
 * - fetch: Pull tasks from GitHub epic issues for agents to work on
 * - watch: Monitor epic issues for new assignments (webhook or polling)
 * - complete: Mark an issue as complete when work is done
 * - status: Get status of epic tasks
 * - unassigned: List tasks waiting for assignment
 *
 * KEY BEHAVIOR: Agents WAIT for explicit GitHub assignment before picking up work.
 * This allows human review of task assignments before work begins.
 */

import { Command } from '../../commander-fix.js';
import { HiveMindGitHubOrchestrator, createHiveMindOrchestrator, CreatedTask } from '../../../teammate-agents/integration/hive-mind-github.js';
import { GitHubWebhookServer, createWebhookServer, getWebhookSetupInstructions, AssignmentEvent } from '../../../teammate-agents/github/webhook-server.js';
import { HiveMind } from '../../../hive-mind/core/HiveMind.js';
import { DatabaseManager } from '../../../hive-mind/core/DatabaseManager.js';

// ============================================================================
// Helper Functions
// ============================================================================

async function getHiveMind(): Promise<HiveMind | null> {
  try {
    const db = await DatabaseManager.getInstance();
    const activeSwarm = await db.getActiveSwarm();
    if (activeSwarm) {
      return await HiveMind.load(activeSwarm.id);
    }
  } catch (error) {
    // Swarm not initialized
  }
  return null;
}

async function startWorkOnTask(
  hiveMind: HiveMind,
  orchestrator: HiveMindGitHubOrchestrator,
  epic: { epicId: string },
  task: CreatedTask
): Promise<void> {
  // Submit task to hive-mind
  await hiveMind.submitTask({
    description: `[Epic #${task.issueNumber}] ${task.title}`,
    priority: 'high',
    strategy: 'adaptive',
    requiredCapabilities: task.assignedAgent?.skills || [],
    metadata: {
      epicId: epic.epicId,
      issueNumber: task.issueNumber,
      issueUrl: task.issueUrl,
      phase: task.phase,
      taskId: task.taskId,
      githubAssignees: task.githubAssignees,
    },
  });

  // Update task status in GitHub
  await orchestrator.updateTaskStatus(epic.epicId, task.taskId, 'In Progress');
}

// ============================================================================
// Epic Fetch Command
// ============================================================================

export const epicFetchCommand = new Command('fetch')
  .description('Fetch ASSIGNED tasks from GitHub epic issues for agents to work on')
  .option('--epic <epicId>', 'Epic ID to fetch tasks from')
  .option('--repo <repo>', 'Repository name (owner/repo format)')
  .option('--phase <phase>', 'Filter by SPARC phase (Specification, Architecture, Refinement, Completion)')
  .option('--assignee <username>', 'Filter by GitHub assignee username')
  .option('--include-unassigned', 'Also show unassigned tasks (default: only assigned)')
  .option('--limit <n>', 'Maximum number of tasks to fetch', '5')
  .option('--start-work', 'Automatically start working on fetched tasks')
  .option('--json', 'Output in JSON format')
  .action(async (options) => {
    try {
      console.log('🐝 Hive-Mind Epic Task Fetch\n');

      // Parse repo
      let owner = '';
      let repoName = '';
      if (options.repo) {
        const parts = options.repo.split('/');
        if (parts.length === 2) {
          [owner, repoName] = parts;
        } else {
          console.error('Error: Repository must be in owner/repo format');
          process.exit(1);
        }
      } else {
        console.error('Error: --repo is required');
        process.exit(1);
      }

      // Initialize orchestrator
      const orchestrator = createHiveMindOrchestrator({
        owner,
        repo: repoName,
        enableVectorSearch: true,
        enableLearning: true,
      });

      await orchestrator.initialize();

      // Load epic from GitHub
      console.log(`Loading epic from ${owner}/${repoName}...`);
      const epic = await orchestrator.loadEpicFromGitHub(repoName, options.epic);

      if (!epic) {
        console.error('Error: No epic found in repository');
        await orchestrator.shutdown();
        process.exit(1);
      }

      console.log(`✓ Loaded epic: ${epic.epicId}`);
      console.log(`  Project: #${epic.projectNumber}`);
      console.log(`  Total tasks: ${epic.tasks.length}\n`);

      // Refresh task statuses from GitHub
      await orchestrator.refreshTaskStatuses(epic.epicId);

      // Get ready tasks - DEFAULT: only assigned tasks
      const readyTasks = orchestrator.getReadyTasks(epic.epicId, {
        phase: options.phase,
        assignee: options.assignee,
        requireAssignment: !options.includeUnassigned,
        includeDependencyCheck: true,
      });

      const limit = parseInt(options.limit) || 5;
      const tasksToFetch = readyTasks.slice(0, limit);

      if (tasksToFetch.length === 0) {
        console.log('No ASSIGNED tasks available for pickup.\n');

        // Show unassigned tasks waiting for review
        const unassigned = orchestrator.getUnassignedTasks(epic.epicId);
        if (unassigned.length > 0) {
          console.log(`⏳ ${unassigned.length} task(s) waiting for assignment:`);
          for (const task of unassigned.slice(0, 5)) {
            console.log(`   #${task.issueNumber}: ${task.title} (${task.phase})`);
          }
          console.log('\nAssign tasks on GitHub to enable pickup.');
        }

        console.log('\nTask Status Summary:');
        const summary = orchestrator.getTaskStatusSummary(epic.epicId);
        console.log(`  Backlog: ${summary.backlog}`);
        console.log(`  Ready: ${summary.ready}`);
        console.log(`  In Progress: ${summary.inProgress}`);
        console.log(`  Review: ${summary.review}`);
        console.log(`  Done: ${summary.done}`);
        await orchestrator.shutdown();
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(tasksToFetch, null, 2));
      } else {
        console.log(`Found ${tasksToFetch.length} ASSIGNED task(s) ready for pickup:\n`);

        for (const task of tasksToFetch) {
          console.log(`  📋 #${task.issueNumber}: ${task.title}`);
          console.log(`     Phase: ${task.phase}`);
          console.log(`     Status: ${task.status}`);
          console.log(`     Assignees: ${task.githubAssignees?.join(', ') || 'none'}`);
          if (task.assignedAgent) {
            console.log(`     Recommended Agent: ${task.assignedAgent.name} (${task.assignedAgent.type})`);
            if (task.assignmentScore) {
              console.log(`     Match Score: ${task.assignmentScore.toFixed(1)}%`);
            }
          }
          console.log(`     URL: ${task.issueUrl}`);
          console.log('');
        }
      }

      // Start work if requested
      if (options.startWork) {
        console.log('Starting work on assigned tasks...\n');

        const hiveMind = await getHiveMind();

        if (!hiveMind) {
          console.log('No active hive-mind swarm. Run "npx claude-flow hive-mind init" first.');
        } else {
          for (const task of tasksToFetch) {
            await startWorkOnTask(hiveMind, orchestrator, epic, task);
            console.log(`  ✓ Started work on #${task.issueNumber}`);
          }
        }
      }

      await orchestrator.shutdown();

    } catch (error) {
      console.error('Error fetching epic tasks:', error);
      process.exit(1);
    }
  });

// ============================================================================
// Epic Watch Command (with Webhook Support)
// ============================================================================

export const epicWatchCommand = new Command('watch')
  .description('Watch epic issues for new assignments and pick up work')
  .option('--epic <epicId>', 'Epic ID to watch')
  .option('--repo <repo>', 'Repository name (owner/repo format)')
  .option('--mode <mode>', 'Watch mode: webhook, poll, or hybrid (default: hybrid)', 'hybrid')
  .option('--interval <seconds>', 'Poll interval in seconds (for poll/hybrid mode)', '30')
  .option('--webhook-port <port>', 'Webhook server port (for webhook/hybrid mode)', '3456')
  .option('--webhook-secret <secret>', 'Webhook secret for signature verification')
  .option('--auto-work', 'Automatically start working on assigned tasks')
  .option('--once', 'Check once and exit (no continuous watching)')
  .option('--catch-up', 'Sync any missed assignments on startup (default: true)')
  .action(async (options) => {
    try {
      console.log('🐝 Hive-Mind Epic Watcher\n');

      // Parse repo
      let owner = '';
      let repoName = '';
      if (options.repo) {
        const parts = options.repo.split('/');
        if (parts.length === 2) {
          [owner, repoName] = parts;
        } else {
          console.error('Error: Repository must be in owner/repo format');
          process.exit(1);
        }
      } else {
        console.error('Error: --repo is required');
        process.exit(1);
      }

      const pollInterval = parseInt(options.interval) * 1000;
      const webhookPort = parseInt(options.webhookPort);
      const mode = options.mode as 'webhook' | 'poll' | 'hybrid';

      // Initialize orchestrator
      const orchestrator = createHiveMindOrchestrator({
        owner,
        repo: repoName,
        enableVectorSearch: true,
        enableLearning: true,
      });

      await orchestrator.initialize();

      // Load epic
      const epic = await orchestrator.loadEpicFromGitHub(repoName, options.epic);

      if (!epic) {
        console.error('Error: No epic found in repository');
        await orchestrator.shutdown();
        process.exit(1);
      }

      console.log(`Watching epic: ${epic.epicId}`);
      console.log(`Mode: ${mode}`);
      if (mode !== 'webhook') console.log(`Poll interval: ${options.interval}s`);
      if (mode !== 'poll') console.log(`Webhook port: ${webhookPort}`);
      console.log('');

      // Get hive-mind
      const hiveMind = await getHiveMind();
      if (hiveMind) {
        console.log(`Connected to hive-mind swarm`);
      } else {
        console.log('No active swarm - watching only (no auto-work)');
      }

      // Track known assigned tasks to detect new assignments
      let knownAssignedIssues = new Set<number>();

      // Initialize with currently assigned tasks
      const initialAssigned = orchestrator.getReadyTasks(epic.epicId, {
        requireAssignment: true,
        includeDependencyCheck: false,
      });
      for (const task of initialAssigned) {
        knownAssignedIssues.add(task.issueNumber);
      }
      console.log(`Initially assigned tasks: ${knownAssignedIssues.size}`);

      // Catch-up sync: process any assigned tasks that haven't been started
      if (options.catchUp !== false) {
        console.log('\nCatch-up sync: Checking for missed assignments...');
        const readyAssigned = orchestrator.getReadyTasks(epic.epicId, {
          requireAssignment: true,
          includeDependencyCheck: true,
        });

        if (readyAssigned.length > 0) {
          console.log(`Found ${readyAssigned.length} assigned task(s) ready for work:`);
          for (const task of readyAssigned) {
            console.log(`  📋 #${task.issueNumber}: ${task.title}`);
            console.log(`     Assignees: ${task.githubAssignees?.join(', ')}`);

            if (options.autoWork && hiveMind) {
              await startWorkOnTask(hiveMind, orchestrator, epic, task);
              console.log(`     ✓ Started work`);
            }
          }
        } else {
          console.log('No missed assignments found.');
        }
      }

      // Handler for new assignments
      const handleNewAssignment = async (issueNumber: number, assignee: string) => {
        // Refresh from GitHub
        await orchestrator.refreshTaskStatuses(epic.epicId);

        const task = orchestrator.getTaskByIssue(epic.epicId, issueNumber);
        if (!task) {
          console.log(`  Issue #${issueNumber} not part of epic`);
          return;
        }

        if (task.status === 'in_progress' || task.status === 'done') {
          console.log(`  Task #${issueNumber} already ${task.status}`);
          return;
        }

        console.log(`\n🆕 New assignment: #${issueNumber} → ${assignee}`);
        console.log(`   ${task.title}`);
        console.log(`   Phase: ${task.phase}`);

        if (options.autoWork && hiveMind) {
          await startWorkOnTask(hiveMind, orchestrator, epic, task);
          console.log(`   ✓ Started work via hive-mind`);
        } else {
          console.log(`   Ready for pickup (--auto-work not enabled)`);
        }

        knownAssignedIssues.add(issueNumber);
      };

      // Setup webhook server if needed
      let webhookServer: GitHubWebhookServer | null = null;
      if (mode === 'webhook' || mode === 'hybrid') {
        webhookServer = createWebhookServer({
          port: webhookPort,
          secret: options.webhookSecret,
          repos: [`${owner}/${repoName}`],
          epicLabelPrefix: 'epic:',
        });

        // Handle assignment events
        webhookServer.on('issue:assigned', async (event: AssignmentEvent) => {
          if (event.epicId === epic.epicId || event.epicId === undefined) {
            await handleNewAssignment(event.issueNumber, event.assignee);
          }
        });

        webhookServer.on('issue:closed', async (event) => {
          console.log(`\n✅ Issue #${event.issueNumber} closed by ${event.closedBy}`);
        });

        webhookServer.on('error', (error) => {
          console.error('Webhook error:', error);
        });

        await webhookServer.start();
        console.log(`\nWebhook server listening on port ${webhookPort}`);
        console.log(getWebhookSetupInstructions(
          webhookServer.getWebhookUrl('your-server.com'),
          options.webhookSecret
        ));
      }

      // Setup polling if needed
      let pollIntervalId: NodeJS.Timeout | null = null;
      if (mode === 'poll' || mode === 'hybrid') {
        const checkForUpdates = async () => {
          try {
            // Refresh from GitHub
            await orchestrator.refreshTaskStatuses(epic.epicId);

            // Get currently assigned tasks
            const assignedTasks = orchestrator.getReadyTasks(epic.epicId, {
              requireAssignment: true,
              includeDependencyCheck: true,
            });

            // Find new assignments
            for (const task of assignedTasks) {
              if (!knownAssignedIssues.has(task.issueNumber)) {
                const assignees = task.githubAssignees?.join(', ') || 'unknown';
                await handleNewAssignment(task.issueNumber, assignees);
              }
            }

            // Summary
            const summary = orchestrator.getTaskStatusSummary(epic.epicId);
            const timestamp = new Date().toISOString().substring(11, 19);
            console.log(`[${timestamp}] Ready=${summary.ready}, InProgress=${summary.inProgress}, Done=${summary.done}`);

          } catch (error) {
            console.error('Poll check failed:', error);
          }
        };

        // Initial check
        if (!options.once) {
          console.log(`\nPolling every ${options.interval}s for new assignments...`);
          pollIntervalId = setInterval(checkForUpdates, pollInterval);
        }

        // Do one check now
        await checkForUpdates();

        if (options.once) {
          if (webhookServer) await webhookServer.stop();
          await orchestrator.shutdown();
          return;
        }
      }

      // Handle shutdown
      console.log('\nWatching for assignments... (Ctrl+C to stop)\n');

      const shutdown = async () => {
        console.log('\n\nStopping watcher...');
        if (pollIntervalId) clearInterval(pollIntervalId);
        if (webhookServer) await webhookServer.stop();
        await orchestrator.shutdown();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

    } catch (error) {
      console.error('Error starting watcher:', error);
      process.exit(1);
    }
  });

// ============================================================================
// Epic Complete Command
// ============================================================================

export const epicCompleteCommand = new Command('complete')
  .description('Mark an epic task as complete')
  .requiredOption('--repo <repo>', 'Repository name (owner/repo format)')
  .requiredOption('--issue <number>', 'Issue number to complete')
  .option('--epic <epicId>', 'Epic ID (auto-detected if not provided)')
  .option('--summary <text>', 'Completion summary')
  .option('--success', 'Mark as successful completion (default)', true)
  .option('--failed', 'Mark as failed')
  .option('--review', 'Move to review instead of closing')
  .option('--artifacts <files>', 'Comma-separated list of artifact files')
  .action(async (options) => {
    try {
      console.log('🐝 Hive-Mind Task Completion\n');

      // Parse repo
      const parts = options.repo.split('/');
      if (parts.length !== 2) {
        console.error('Error: Repository must be in owner/repo format');
        process.exit(1);
      }
      const [owner, repoName] = parts;

      // Initialize orchestrator
      const orchestrator = createHiveMindOrchestrator({
        owner,
        repo: repoName,
        enableVectorSearch: true,
        enableLearning: true,
      });

      await orchestrator.initialize();

      // Load epic
      const epic = await orchestrator.loadEpicFromGitHub(repoName, options.epic);

      if (!epic) {
        console.error('Error: No epic found in repository');
        await orchestrator.shutdown();
        process.exit(1);
      }

      const issueNumber = parseInt(options.issue);
      const task = orchestrator.getTaskByIssue(epic.epicId, issueNumber);

      if (!task) {
        console.error(`Error: Issue #${issueNumber} not found in epic`);
        await orchestrator.shutdown();
        process.exit(1);
      }

      console.log(`Completing task: #${task.issueNumber} - ${task.title}`);
      console.log(`Phase: ${task.phase}`);

      // Complete the task
      const result = await orchestrator.completeTask(epic.epicId, task.taskId, {
        success: !options.failed,
        completedBy: 'Hive-Mind CLI',
        summary: options.summary,
        artifacts: options.artifacts?.split(','),
        moveToReview: options.review,
      });

      if (result.success) {
        console.log(`\n✅ Task completed successfully!`);
        console.log(`   Status: ${result.status}`);
        if (result.completionTime) {
          console.log(`   Time: ${result.completionTime}ms`);
        }
      } else {
        console.log(`\n❌ Task marked as failed`);
      }

      // Show next task recommendation (assigned tasks only)
      const nextTask = orchestrator.getNextTask(epic.epicId);
      if (nextTask) {
        console.log(`\n🎯 Next assigned task: #${nextTask.issueNumber} - ${nextTask.title}`);
        console.log(`   Assignees: ${nextTask.githubAssignees?.join(', ')}`);
      } else {
        // Check for unassigned tasks
        const unassigned = orchestrator.getUnassignedTasks(epic.epicId);
        if (unassigned.length > 0) {
          console.log(`\n⏳ ${unassigned.length} task(s) waiting for assignment`);
        }
      }

      await orchestrator.shutdown();

    } catch (error) {
      console.error('Error completing task:', error);
      process.exit(1);
    }
  });

// ============================================================================
// Epic Unassigned Command
// ============================================================================

export const epicUnassignedCommand = new Command('unassigned')
  .description('List tasks waiting for assignment (for human review)')
  .requiredOption('--repo <repo>', 'Repository name (owner/repo format)')
  .option('--epic <epicId>', 'Epic ID (auto-detected if not provided)')
  .option('--json', 'Output in JSON format')
  .action(async (options) => {
    try {
      // Parse repo
      const parts = options.repo.split('/');
      if (parts.length !== 2) {
        console.error('Error: Repository must be in owner/repo format');
        process.exit(1);
      }
      const [owner, repoName] = parts;

      // Initialize orchestrator
      const orchestrator = createHiveMindOrchestrator({
        owner,
        repo: repoName,
        enableVectorSearch: true,
        enableLearning: true,
      });

      await orchestrator.initialize();

      // Load epic
      const epic = await orchestrator.loadEpicFromGitHub(repoName, options.epic);

      if (!epic) {
        console.error('Error: No epic found in repository');
        await orchestrator.shutdown();
        process.exit(1);
      }

      // Refresh statuses
      await orchestrator.refreshTaskStatuses(epic.epicId);

      const unassigned = orchestrator.getUnassignedTasks(epic.epicId);

      if (options.json) {
        console.log(JSON.stringify(unassigned, null, 2));
      } else {
        console.log('🐝 Hive-Mind Epic - Tasks Awaiting Assignment\n');
        console.log(`Epic: ${epic.epicId}`);
        console.log(`URL: ${epic.projectUrl}\n`);

        if (unassigned.length === 0) {
          console.log('✅ All tasks are assigned!\n');
        } else {
          console.log(`⏳ ${unassigned.length} task(s) waiting for assignment:\n`);

          for (const task of unassigned) {
            console.log(`  📋 #${task.issueNumber}: ${task.title}`);
            console.log(`     Phase: ${task.phase}`);
            console.log(`     Status: ${task.status}`);
            if (task.assignedAgent) {
              console.log(`     Recommended: ${task.assignedAgent.name} (${task.assignedAgent.type})`);
            }
            console.log(`     URL: ${task.issueUrl}`);
            console.log('');
          }

          console.log('Assign tasks on GitHub to enable agents to pick them up.');
          console.log(`  gh issue edit <number> --repo ${owner}/${repoName} --add-assignee <username>`);
        }
      }

      await orchestrator.shutdown();

    } catch (error) {
      console.error('Error listing unassigned tasks:', error);
      process.exit(1);
    }
  });

// ============================================================================
// Epic Status Command
// ============================================================================

export const epicStatusCommand = new Command('epic-status')
  .description('Get status of epic tasks')
  .requiredOption('--repo <repo>', 'Repository name (owner/repo format)')
  .option('--epic <epicId>', 'Epic ID (auto-detected if not provided)')
  .option('--json', 'Output in JSON format')
  .action(async (options) => {
    try {
      // Parse repo
      const parts = options.repo.split('/');
      if (parts.length !== 2) {
        console.error('Error: Repository must be in owner/repo format');
        process.exit(1);
      }
      const [owner, repoName] = parts;

      // Initialize orchestrator
      const orchestrator = createHiveMindOrchestrator({
        owner,
        repo: repoName,
        enableVectorSearch: true,
        enableLearning: true,
      });

      await orchestrator.initialize();

      // Load epic
      const epic = await orchestrator.loadEpicFromGitHub(repoName, options.epic);

      if (!epic) {
        console.error('Error: No epic found in repository');
        await orchestrator.shutdown();
        process.exit(1);
      }

      // Refresh statuses
      await orchestrator.refreshTaskStatuses(epic.epicId);

      const summary = orchestrator.getTaskStatusSummary(epic.epicId);
      const unassigned = orchestrator.getUnassignedTasks(epic.epicId);
      const assigned = orchestrator.getReadyTasks(epic.epicId, { requireAssignment: true });

      if (options.json) {
        console.log(JSON.stringify({
          epicId: epic.epicId,
          projectNumber: epic.projectNumber,
          projectUrl: epic.projectUrl,
          summary,
          unassignedCount: unassigned.length,
          assignedCount: assigned.length,
          tasks: epic.tasks,
        }, null, 2));
      } else {
        console.log('🐝 Hive-Mind Epic Status\n');
        console.log(`Epic: ${epic.epicId}`);
        console.log(`Project: #${epic.projectNumber}`);
        console.log(`URL: ${epic.projectUrl}\n`);

        console.log('Task Summary:');
        console.log(`  Total: ${summary.total}`);
        console.log(`  Backlog: ${summary.backlog}`);
        console.log(`  Ready: ${summary.ready} (${unassigned.length} unassigned, ${assigned.length} assigned)`);
        console.log(`  In Progress: ${summary.inProgress}`);
        console.log(`  Review: ${summary.review}`);
        console.log(`  Done: ${summary.done}`);
        console.log(`  Blocked: ${summary.blocked}\n`);

        console.log('By Phase:');
        for (const [phase, stats] of Object.entries(summary.byPhase)) {
          const progress = stats.total > 0
            ? Math.round((stats.completed / stats.total) * 100)
            : 0;
          console.log(`  ${phase}: ${stats.completed}/${stats.total} (${progress}%)`);
        }

        console.log('\nTasks:');
        for (const task of epic.tasks) {
          const statusIcon = {
            'done': '✅',
            'in_progress': '🔄',
            'review': '👀',
            'ready': task.githubAssignees?.length ? '📋' : '⏳',
            'backlog': '📦',
            'blocked': '🚫',
          }[task.status] || '❓';

          const assigneeInfo = task.githubAssignees?.length
            ? `[${task.githubAssignees.join(', ')}]`
            : '[unassigned]';

          console.log(`  ${statusIcon} #${task.issueNumber}: ${task.title}`);
          console.log(`     Phase: ${task.phase} | Status: ${task.status} ${assigneeInfo}`);
        }
      }

      await orchestrator.shutdown();

    } catch (error) {
      console.error('Error getting status:', error);
      process.exit(1);
    }
  });

// ============================================================================
// Main Epic Command
// ============================================================================

export const epicCommand = new Command('epic')
  .description('Manage GitHub epic issues with hive-mind coordination')
  .addCommand(epicFetchCommand)
  .addCommand(epicWatchCommand)
  .addCommand(epicCompleteCommand)
  .addCommand(epicUnassignedCommand)
  .addCommand(epicStatusCommand);

export default epicCommand;
