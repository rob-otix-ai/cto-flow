/**
 * Epic Work Hooks for Hive-Mind Agent Coordination
 *
 * These hooks integrate agent work with epic issue lifecycle:
 * - pre-work: Claims issue, updates status to "In Progress"
 * - post-work: Completes issue, updates status to "Done" or "Review"
 * - work-failed: Handles failures, updates issue with error info
 *
 * All hooks check canUseTeammateMode() and gracefully no-op when disabled.
 */

import type {
  AgenticHookContext,
  HookHandler,
  HookHandlerResult,
  HookPayload,
  HookRegistration,
  SideEffect,
} from '../../claude-flow/src/services/agentic-flow-hooks/types.js';
import { agenticHookManager } from '../../claude-flow/src/services/agentic-flow-hooks/hook-manager.js';
import { Logger } from '../../claude-flow/src/core/logger.js';
import { canUseTeammateMode, getTeammateConfig } from '../core/config.js';
import { createHiveMindOrchestrator, HiveMindGitHubOrchestrator } from '../integration/hive-mind-github.js';

const logger = new Logger({
  level: 'info',
  format: 'text',
  destination: 'console'
}, { prefix: 'EpicWorkHooks' });

// ===== Hook Payload Type Definitions =====

export interface PreWorkPayload extends HookPayload {
  epicId: string;
  taskId: string;
  issueNumber: number;
  agentId: string;
  agentType: string;
  repo: string;
}

export interface PostWorkPayload extends HookPayload {
  epicId: string;
  taskId: string;
  issueNumber: number;
  agentId: string;
  agentType: string;
  repo: string;
  success: boolean;
  summary?: string;
  artifacts?: string[];
  prNumber?: number;
  prUrl?: string;
}

export interface WorkFailedPayload extends HookPayload {
  epicId: string;
  taskId: string;
  issueNumber: number;
  agentId: string;
  repo: string;
  error: string;
  recoverable: boolean;
}

// ===== Orchestrator Cache =====

const orchestratorCache: Map<string, HiveMindGitHubOrchestrator> = new Map();

async function getOrchestrator(repo: string): Promise<HiveMindGitHubOrchestrator | null> {
  if (!repo) return null;

  const parts = repo.split('/');
  if (parts.length !== 2) return null;

  const [owner, repoName] = parts;
  const cacheKey = `${owner}/${repoName}`;

  if (orchestratorCache.has(cacheKey)) {
    return orchestratorCache.get(cacheKey)!;
  }

  try {
    const orchestrator = createHiveMindOrchestrator({
      owner,
      repo: repoName,
      enableVectorSearch: false, // Minimize overhead for hooks
      enableLearning: true,
    });

    await orchestrator.initialize();
    orchestratorCache.set(cacheKey, orchestrator);

    return orchestrator;
  } catch (error) {
    logger.error('Failed to initialize orchestrator', error);
    return null;
  }
}

// ===== Pre-Work Hook =====

/**
 * Pre-Work Hook
 *
 * Executes when an agent starts working on an epic task:
 * - Claims the issue (updates assignment)
 * - Updates issue status to "In Progress"
 * - Adds "work started" comment to issue
 * - Stores work context in memory
 */
export class PreWorkHook {
  createHandler(): HookHandler {
    return async (payload: HookPayload, context: AgenticHookContext): Promise<HookHandlerResult> => {
      if (!canUseTeammateMode()) {
        logger.debug('Teammate mode disabled, skipping pre-work hook');
        return { continue: true, modified: false };
      }

      const workPayload = payload as PreWorkPayload;

      // Validate required fields
      if (!workPayload.epicId || !workPayload.issueNumber || !workPayload.repo) {
        logger.debug('Missing required fields for pre-work hook');
        return { continue: true, modified: false };
      }

      logger.info(`Pre-work: Agent ${workPayload.agentId} starting issue #${workPayload.issueNumber}`);

      try {
        const sideEffects: SideEffect[] = [];
        const orchestrator = await getOrchestrator(workPayload.repo);

        if (!orchestrator) {
          logger.warn('Could not get orchestrator for repo');
          return { continue: true, modified: false };
        }

        // Load epic if not already cached
        let epic = orchestrator.getEpic(workPayload.epicId);
        if (!epic) {
          epic = await orchestrator.loadEpicFromGitHub(
            workPayload.repo.split('/')[1],
            workPayload.epicId
          );
        }

        if (!epic) {
          logger.warn(`Epic ${workPayload.epicId} not found`);
          return { continue: true, modified: false };
        }

        // Update task status to "In Progress"
        await orchestrator.updateTaskStatus(
          workPayload.epicId,
          workPayload.taskId || workPayload.issueNumber,
          'In Progress'
        );

        // Store work context
        sideEffects.push({
          type: 'memory',
          action: 'store',
          data: {
            namespace: 'epic:work',
            key: `${workPayload.epicId}:${workPayload.issueNumber}`,
            value: {
              epicId: workPayload.epicId,
              taskId: workPayload.taskId,
              issueNumber: workPayload.issueNumber,
              agentId: workPayload.agentId,
              agentType: workPayload.agentType,
              startedAt: new Date().toISOString(),
              status: 'in_progress',
            },
          },
        });

        // Track metric
        sideEffects.push({
          type: 'metric',
          action: 'increment',
          data: {
            name: 'epic.work.started',
            value: 1,
          },
        });

        logger.info(`Issue #${workPayload.issueNumber} marked as In Progress`);

        return {
          continue: true,
          modified: true,
          payload: {
            ...workPayload,
            workStarted: true,
            startedAt: Date.now(),
          },
          sideEffects,
          metadata: {
            epicId: workPayload.epicId,
            issueNumber: workPayload.issueNumber,
          },
        };

      } catch (error) {
        logger.error('Pre-work hook failed', error);
        return {
          continue: true,
          modified: false,
          metadata: {
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        };
      }
    };
  }

  register(): void {
    const registration: HookRegistration = {
      id: 'pre-work-issue-claim',
      type: 'workflow-start',
      handler: this.createHandler(),
      priority: 90,
      filter: {
        patterns: [/^epic:work/, /^hive-mind:work/],
      },
      options: {
        async: true,
        timeout: 30000,
        retries: 2,
      },
    };

    agenticHookManager.register(registration);
    logger.info('Registered pre-work hook');
  }
}

// ===== Post-Work Hook =====

/**
 * Post-Work Hook
 *
 * Executes when an agent completes work on an epic task:
 * - Updates issue status to "Done" or "Review"
 * - Adds completion comment with summary
 * - Closes issue if successful
 * - Links PR if provided
 * - Records outcome for learning
 */
export class PostWorkHook {
  createHandler(): HookHandler {
    return async (payload: HookPayload, context: AgenticHookContext): Promise<HookHandlerResult> => {
      if (!canUseTeammateMode()) {
        logger.debug('Teammate mode disabled, skipping post-work hook');
        return { continue: true, modified: false };
      }

      const workPayload = payload as PostWorkPayload;

      // Validate required fields
      if (!workPayload.epicId || !workPayload.issueNumber || !workPayload.repo) {
        logger.debug('Missing required fields for post-work hook');
        return { continue: true, modified: false };
      }

      logger.info(`Post-work: Agent ${workPayload.agentId} completed issue #${workPayload.issueNumber}`);

      try {
        const sideEffects: SideEffect[] = [];
        const orchestrator = await getOrchestrator(workPayload.repo);

        if (!orchestrator) {
          logger.warn('Could not get orchestrator for repo');
          return { continue: true, modified: false };
        }

        // Load epic if not already cached
        let epic = orchestrator.getEpic(workPayload.epicId);
        if (!epic) {
          epic = await orchestrator.loadEpicFromGitHub(
            workPayload.repo.split('/')[1],
            workPayload.epicId
          );
        }

        if (!epic) {
          logger.warn(`Epic ${workPayload.epicId} not found`);
          return { continue: true, modified: false };
        }

        // Complete the task
        const result = await orchestrator.completeTask(
          workPayload.epicId,
          workPayload.taskId || workPayload.issueNumber,
          {
            success: workPayload.success,
            completedBy: `Hive-Mind Agent: ${workPayload.agentType}`,
            summary: workPayload.summary,
            artifacts: workPayload.artifacts,
            moveToReview: !workPayload.success, // Failed tasks go to review
          }
        );

        // Link PR if provided
        if (workPayload.prNumber && workPayload.success) {
          try {
            await orchestrator.linkPullRequestToTasks(
              workPayload.epicId,
              workPayload.prNumber,
              [workPayload.taskId || workPayload.issueNumber],
              { addComments: true, updateEpic: true }
            );
          } catch (prError) {
            logger.warn('Could not link PR to task', prError);
          }
        }

        // Update work context in memory
        sideEffects.push({
          type: 'memory',
          action: 'store',
          data: {
            namespace: 'epic:work',
            key: `${workPayload.epicId}:${workPayload.issueNumber}`,
            value: {
              epicId: workPayload.epicId,
              taskId: workPayload.taskId,
              issueNumber: workPayload.issueNumber,
              agentId: workPayload.agentId,
              agentType: workPayload.agentType,
              completedAt: new Date().toISOString(),
              status: workPayload.success ? 'completed' : 'failed',
              summary: workPayload.summary,
              prNumber: workPayload.prNumber,
            },
          },
        });

        // Track metrics
        sideEffects.push({
          type: 'metric',
          action: 'increment',
          data: {
            name: workPayload.success ? 'epic.work.completed' : 'epic.work.failed',
            value: 1,
          },
        });

        // Notification
        sideEffects.push({
          type: 'notification',
          action: 'send',
          data: {
            title: workPayload.success ? 'Task Completed' : 'Task Failed',
            message: `Issue #${workPayload.issueNumber} ${workPayload.success ? 'completed' : 'failed'} by ${workPayload.agentType}`,
            severity: workPayload.success ? 'info' : 'warning',
          },
        });

        logger.info(`Issue #${workPayload.issueNumber} ${workPayload.success ? 'completed' : 'failed'}`);

        return {
          continue: true,
          modified: true,
          payload: {
            ...workPayload,
            workCompleted: true,
            completedAt: Date.now(),
            result,
          },
          sideEffects,
          metadata: {
            epicId: workPayload.epicId,
            issueNumber: workPayload.issueNumber,
            success: workPayload.success,
            status: result.status,
          },
        };

      } catch (error) {
        logger.error('Post-work hook failed', error);
        return {
          continue: true,
          modified: false,
          metadata: {
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        };
      }
    };
  }

  register(): void {
    const registration: HookRegistration = {
      id: 'post-work-issue-complete',
      type: 'workflow-complete',
      handler: this.createHandler(),
      priority: 90,
      filter: {
        patterns: [/^epic:work/, /^hive-mind:work/],
      },
      options: {
        async: true,
        timeout: 60000,
        retries: 2,
      },
    };

    agenticHookManager.register(registration);
    logger.info('Registered post-work hook');
  }
}

// ===== Work Failed Hook =====

/**
 * Work Failed Hook
 *
 * Handles work failures:
 * - Updates issue with error information
 * - Moves to "Blocked" status if not recoverable
 * - Adds failure comment for visibility
 * - Can trigger reassignment if recoverable
 */
export class WorkFailedHook {
  createHandler(): HookHandler {
    return async (payload: HookPayload, context: AgenticHookContext): Promise<HookHandlerResult> => {
      if (!canUseTeammateMode()) {
        return { continue: true, modified: false };
      }

      const failPayload = payload as WorkFailedPayload;

      if (!failPayload.epicId || !failPayload.issueNumber || !failPayload.repo) {
        return { continue: true, modified: false };
      }

      logger.info(`Work failed: Issue #${failPayload.issueNumber} - ${failPayload.error}`);

      try {
        const sideEffects: SideEffect[] = [];
        const orchestrator = await getOrchestrator(failPayload.repo);

        if (!orchestrator) {
          return { continue: true, modified: false };
        }

        // Load epic
        let epic = orchestrator.getEpic(failPayload.epicId);
        if (!epic) {
          epic = await orchestrator.loadEpicFromGitHub(
            failPayload.repo.split('/')[1],
            failPayload.epicId
          );
        }

        if (!epic) {
          return { continue: true, modified: false };
        }

        // Update task status based on recoverability
        const newStatus = failPayload.recoverable ? 'In Progress' : 'Blocked';

        // Note: This would need a method to update with blocked status
        // For now, we'll complete as failed which moves to Review
        const result = await orchestrator.completeTask(
          failPayload.epicId,
          failPayload.taskId || failPayload.issueNumber,
          {
            success: false,
            completedBy: `Hive-Mind Agent: ${failPayload.agentId}`,
            summary: `Work failed: ${failPayload.error}\n\nRecoverable: ${failPayload.recoverable ? 'Yes' : 'No'}`,
            moveToReview: true,
          }
        );

        // Store failure context
        sideEffects.push({
          type: 'memory',
          action: 'store',
          data: {
            namespace: 'epic:failures',
            key: `${failPayload.epicId}:${failPayload.issueNumber}:${Date.now()}`,
            value: {
              epicId: failPayload.epicId,
              issueNumber: failPayload.issueNumber,
              agentId: failPayload.agentId,
              error: failPayload.error,
              recoverable: failPayload.recoverable,
              timestamp: new Date().toISOString(),
            },
          },
        });

        // Track failure metric
        sideEffects.push({
          type: 'metric',
          action: 'increment',
          data: {
            name: 'epic.work.error',
            value: 1,
          },
        });

        return {
          continue: true,
          modified: true,
          sideEffects,
          metadata: {
            epicId: failPayload.epicId,
            issueNumber: failPayload.issueNumber,
            recoverable: failPayload.recoverable,
          },
        };

      } catch (error) {
        logger.error('Work-failed hook error', error);
        return { continue: true, modified: false };
      }
    };
  }

  register(): void {
    const registration: HookRegistration = {
      id: 'work-failed-handler',
      type: 'workflow-error',
      handler: this.createHandler(),
      priority: 100,
      filter: {
        patterns: [/^epic:work/, /^hive-mind:work/],
      },
      options: {
        async: true,
        timeout: 30000,
        retries: 1,
      },
    };

    agenticHookManager.register(registration);
    logger.info('Registered work-failed hook');
  }
}

// ===== Hook Registration =====

/**
 * Register all epic work hooks
 */
export function registerEpicWorkHooks(): void {
  logger.info('Registering epic work hooks...');

  try {
    const preWorkHook = new PreWorkHook();
    preWorkHook.register();

    const postWorkHook = new PostWorkHook();
    postWorkHook.register();

    const workFailedHook = new WorkFailedHook();
    workFailedHook.register();

    logger.info('Successfully registered 3 epic work hooks');
  } catch (error) {
    logger.error('Failed to register epic work hooks', error);
    throw error;
  }
}

/**
 * Unregister all epic work hooks
 */
export function unregisterEpicWorkHooks(): void {
  logger.info('Unregistering epic work hooks...');

  try {
    agenticHookManager.unregister('pre-work-issue-claim');
    agenticHookManager.unregister('post-work-issue-complete');
    agenticHookManager.unregister('work-failed-handler');

    // Clear orchestrator cache
    for (const [key, orchestrator] of orchestratorCache) {
      orchestrator.shutdown().catch(() => {});
    }
    orchestratorCache.clear();

    logger.info('Successfully unregistered epic work hooks');
  } catch (error) {
    logger.error('Failed to unregister epic work hooks', error);
  }
}

/**
 * Helper to trigger post-work hook programmatically
 * Use this when an agent completes work outside of the normal hook flow
 */
export async function triggerWorkComplete(options: {
  epicId: string;
  taskId: string;
  issueNumber: number;
  agentId: string;
  agentType: string;
  repo: string;
  success: boolean;
  summary?: string;
  artifacts?: string[];
  prNumber?: number;
}): Promise<void> {
  const payload: PostWorkPayload = {
    ...options,
  };

  const context: AgenticHookContext = {
    executionId: `work-complete-${Date.now()}`,
    timestamp: Date.now(),
    metadata: {},
  };

  const hook = new PostWorkHook();
  await hook.createHandler()(payload, context);
}

// Export for direct import
export { PreWorkHook, PostWorkHook, WorkFailedHook };
