#!/usr/bin/env node
/**
 * Hive-Mind Epic Commands
 *
 * CLI commands for managing epic issues with hive-mind coordination:
 * - fetch: Pull tasks from GitHub epic issues for agents to work on
 * - watch: Monitor epic issues for new assignments
 * - complete: Mark an issue as complete when work is done
 * - status: Get status of epic tasks
 */

import { Command } from '../../commander-fix.js';
import { HiveMindGitHubOrchestrator, createHiveMindOrchestrator, CreatedTask } from '../../../teammate-agents/integration/hive-mind-github.js';
import { HiveMind } from '../../../hive-mind/core/HiveMind.js';
import { DatabaseManager } from '../../../hive-mind/core/DatabaseManager.js';

// ============================================================================
// Epic Fetch Command
// ============================================================================

export const epicFetchCommand = new Command('fetch')
  .description('Fetch tasks from GitHub epic issues for agents to work on')
  .option('--epic <epicId>', 'Epic ID to fetch tasks from')
  .option('--repo <repo>', 'Repository name (owner/repo format)')
  .option('--phase <phase>', 'Filter by SPARC phase (Specification, Architecture, Refinement, Completion)')
  .option('--agent-type <type>', 'Filter by agent type (coder, tester, reviewer, etc.)')
  .option('--limit <n>', 'Maximum number of tasks to fetch', '5')
  .option('--assign', 'Automatically assign fetched tasks to available agents')
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

      // Get ready tasks
      const readyTasks = orchestrator.getReadyTasks(epic.epicId, {
        phase: options.phase,
        agentType: options.agentType,
        includeDependencyCheck: true,
      });

      const limit = parseInt(options.limit) || 5;
      const tasksToFetch = readyTasks.slice(0, limit);

      if (tasksToFetch.length === 0) {
        console.log('No tasks available for pickup.\n');
        console.log('Task Status Summary:');
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
        console.log(`Found ${tasksToFetch.length} tasks ready for pickup:\n`);

        for (const task of tasksToFetch) {
          console.log(`  📋 #${task.issueNumber}: ${task.title}`);
          console.log(`     Phase: ${task.phase}`);
          console.log(`     Status: ${task.status}`);
          if (task.assignedAgent) {
            console.log(`     Agent: ${task.assignedAgent.name} (${task.assignedAgent.type})`);
            if (task.assignmentScore) {
              console.log(`     Match Score: ${task.assignmentScore.toFixed(1)}%`);
            }
          }
          console.log(`     URL: ${task.issueUrl}`);
          console.log('');
        }
      }

      // Auto-assign to hive-mind agents if requested
      if (options.assign) {
        console.log('Assigning tasks to hive-mind agents...\n');

        const db = await DatabaseManager.getInstance();
        const activeSwarm = await db.getActiveSwarm();

        if (!activeSwarm) {
          console.log('No active hive-mind swarm. Run "npx claude-flow hive-mind init" first.');
        } else {
          const hiveMind = await HiveMind.load(activeSwarm.id);
          const agents = await hiveMind.getAgents();

          for (const task of tasksToFetch) {
            // Find matching agent by type
            const matchingAgent = agents.find(a =>
              a.type === task.assignedAgent?.type ||
              a.capabilities.some(cap =>
                task.assignedAgent?.skills?.includes(cap)
              )
            );

            if (matchingAgent) {
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
                },
              });

              // Update task status in GitHub
              await orchestrator.updateTaskStatus(epic.epicId, task.taskId, 'In Progress');

              console.log(`  ✓ Assigned #${task.issueNumber} to ${matchingAgent.name}`);
            }
          }
        }
      }

      // Output next task recommendation
      const nextTask = orchestrator.getNextTask(epic.epicId);
      if (nextTask) {
        console.log(`\n🎯 Recommended next task: #${nextTask.issueNumber} - ${nextTask.title}`);
        console.log(`   Phase: ${nextTask.phase}`);
        console.log(`   URL: ${nextTask.issueUrl}`);
      }

      await orchestrator.shutdown();

    } catch (error) {
      console.error('Error fetching epic tasks:', error);
      process.exit(1);
    }
  });

// ============================================================================
// Epic Watch Command
// ============================================================================

export const epicWatchCommand = new Command('watch')
  .description('Watch epic issues for new assignments and pick up work')
  .option('--epic <epicId>', 'Epic ID to watch')
  .option('--repo <repo>', 'Repository name (owner/repo format)')
  .option('--interval <seconds>', 'Poll interval in seconds', '30')
  .option('--agent-type <type>', 'Only watch for tasks matching this agent type')
  .option('--auto-work', 'Automatically start working on assigned tasks')
  .option('--once', 'Check once and exit (no continuous watching)')
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

      const interval = parseInt(options.interval) * 1000;

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
      console.log(`Poll interval: ${options.interval}s`);
      console.log(`Agent type filter: ${options.agentType || 'all'}\n`);

      // Get hive-mind agents
      const db = await DatabaseManager.getInstance();
      const activeSwarm = await db.getActiveSwarm();
      let hiveMind: HiveMind | null = null;

      if (activeSwarm) {
        hiveMind = await HiveMind.load(activeSwarm.id);
        console.log(`Connected to swarm: ${activeSwarm.name}`);
      } else {
        console.log('No active swarm - watching only (no auto-assignment)');
      }

      // Track known tasks to detect new assignments
      let knownTaskIds = new Set(epic.tasks.map(t => t.taskId));
      let lastCheckTime = new Date();

      const checkForUpdates = async () => {
        try {
          console.log(`\n[${new Date().toISOString()}] Checking for updates...`);

          // Refresh from GitHub
          await orchestrator.refreshTaskStatuses(epic.epicId);
          const currentEpic = orchestrator.getEpic(epic.epicId);

          if (!currentEpic) return;

          // Get ready tasks
          const readyTasks = orchestrator.getReadyTasks(epic.epicId, {
            agentType: options.agentType,
            includeDependencyCheck: true,
          });

          // Check for newly ready tasks
          const newReadyTasks = readyTasks.filter(t => !knownTaskIds.has(t.taskId));

          if (newReadyTasks.length > 0) {
            console.log(`\n🆕 ${newReadyTasks.length} new task(s) ready for pickup:`);

            for (const task of newReadyTasks) {
              console.log(`  📋 #${task.issueNumber}: ${task.title}`);
              console.log(`     Phase: ${task.phase}`);
              if (task.assignedAgent) {
                console.log(`     Assigned to: ${task.assignedAgent.name}`);
              }

              // Auto-work if enabled and we have hive-mind
              if (options.autoWork && hiveMind) {
                await hiveMind.submitTask({
                  description: `[Epic #${task.issueNumber}] ${task.title}`,
                  priority: 'high',
                  strategy: 'adaptive',
                  requiredCapabilities: task.assignedAgent?.skills || [],
                  metadata: {
                    epicId: epic.epicId,
                    issueNumber: task.issueNumber,
                    taskId: task.taskId,
                  },
                });

                await orchestrator.updateTaskStatus(epic.epicId, task.taskId, 'In Progress');
                console.log(`     ✓ Started work via hive-mind`);
              }

              knownTaskIds.add(task.taskId);
            }
          }

          // Summary
          const summary = orchestrator.getTaskStatusSummary(epic.epicId);
          console.log(`Status: Ready=${summary.ready}, InProgress=${summary.inProgress}, Done=${summary.done}`);

          lastCheckTime = new Date();

        } catch (error) {
          console.error('Check failed:', error);
        }
      };

      // Initial check
      await checkForUpdates();

      if (options.once) {
        await orchestrator.shutdown();
        return;
      }

      // Continuous watching
      console.log('\nWatching for changes... (Ctrl+C to stop)\n');

      const watchInterval = setInterval(checkForUpdates, interval);

      // Handle shutdown
      process.on('SIGINT', async () => {
        console.log('\n\nStopping watcher...');
        clearInterval(watchInterval);
        await orchestrator.shutdown();
        process.exit(0);
      });

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

      // Show next task recommendation
      const nextTask = orchestrator.getNextTask(epic.epicId);
      if (nextTask) {
        console.log(`\n🎯 Next recommended task: #${nextTask.issueNumber} - ${nextTask.title}`);
      }

      await orchestrator.shutdown();

    } catch (error) {
      console.error('Error completing task:', error);
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

      if (options.json) {
        console.log(JSON.stringify({
          epicId: epic.epicId,
          projectNumber: epic.projectNumber,
          projectUrl: epic.projectUrl,
          summary,
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
        console.log(`  Ready: ${summary.ready}`);
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
            'ready': '📋',
            'backlog': '📦',
            'blocked': '🚫',
          }[task.status] || '❓';

          console.log(`  ${statusIcon} #${task.issueNumber}: ${task.title}`);
          console.log(`     Phase: ${task.phase} | Status: ${task.status}`);
          if (task.assignedAgent) {
            console.log(`     Agent: ${task.assignedAgent.name}`);
          }
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
  .addCommand(epicStatusCommand);

export default epicCommand;
