/**
 * Epic Lifecycle Hooks for CTO-Flow Agent Management
 *
 * Integrates with claude-flow's hook system to provide epic-aware lifecycle management:
 * - pre-epic: Loads epic context before task execution
 * - post-epic-phase: Updates epic after phase completion
 * - post-specification: Optionally generates GitHub epic from SPARC specification
 *
 * All hooks check canUseCtoFlowMode() and gracefully no-op when disabled.
 */

import type {
  AgenticHookContext,
  HookHandler,
  HookHandlerResult,
  HookPayload,
  HookRegistration,
  SideEffect,
  WorkflowHookPayload,
} from '../../services/agentic-flow-hooks/types.js';
import { agenticHookManager } from '../../services/agentic-flow-hooks/hook-manager.js';
import { Logger } from '../../core/logger.js';
import { canUseCtoFlowMode, getConfig as getCtoFlowConfig } from '../core/config-manager.js';
import { EpicContextManager } from '../memory/epic-context-manager.js';
import { SparcEpicExporter } from '../github/sparc-epic-exporter.js';
import { EpicSyncService } from '../github/epic-sync-service.js';

const logger = new Logger({
  level: 'info',
  format: 'text',
  destination: 'console'
}, { prefix: 'EpicHooks' });

// ===== Hook Payload Type Definitions =====

interface PreEpicPayload extends HookPayload {
  epicId: string;
  action: 'create' | 'resume' | 'pause' | 'complete';
  repo?: string;
  restoreContext?: boolean;
}

interface PostEpicPhasePayload extends HookPayload {
  epicId: string;
  phase: 'specification' | 'pseudocode' | 'architecture' | 'refinement' | 'completion';
  phaseResult?: {
    artifacts: string[];
    decisions: any[];
    metrics: Record<string, number>;
  };
  syncToGithub?: boolean;
  updateMilestone?: boolean;
}

interface PostSpecificationPayload extends HookPayload {
  taskId: string;
  specPath: string;
  specification: {
    taskDescription: string;
    requirements: string[];
    userStories: string[];
    acceptanceCriteria: string[];
    designNotes?: string;
  };
  generateEpic?: boolean;
  repo?: string;
}

// ===== Pre-Epic Hook =====

/**
 * Pre-Epic Hook
 *
 * Executes before epic-related task execution:
 * - Loads epic context from memory and GitHub
 * - Restores agent assignments and progress
 * - Injects context into task execution environment
 *
 * Conditional execution: Only runs when CTO-Flow mode is enabled
 */
export class PreEpicHook {
  private contextManager: EpicContextManager;

  constructor() {
    this.contextManager = new EpicContextManager();
  }

  /**
   * Create hook handler
   */
  createHandler(): HookHandler {
    return async (payload: HookPayload, context: AgenticHookContext): Promise<HookHandlerResult> => {
      // Check if CTO-Flow mode is enabled
      if (!canUseCtoFlowMode()) {
        logger.debug('CTO-Flow mode disabled, skipping pre-epic hook');
        return {
          continue: true,
          modified: false,
        };
      }

      const epicPayload = payload as PreEpicPayload;
      logger.info(`Pre-epic hook: ${epicPayload.action} epic ${epicPayload.epicId}`);

      try {
        const sideEffects: SideEffect[] = [];

        switch (epicPayload.action) {
          case 'create':
            await this.handleEpicCreation(epicPayload, context, sideEffects);
            break;

          case 'resume':
            await this.handleEpicResumption(epicPayload, context, sideEffects);
            break;

          case 'pause':
            await this.handleEpicPause(epicPayload, context, sideEffects);
            break;

          case 'complete':
            await this.handleEpicCompletion(epicPayload, context, sideEffects);
            break;
        }

        return {
          continue: true,
          modified: true,
          payload: {
            ...epicPayload,
            contextLoaded: true,
            timestamp: Date.now(),
          },
          sideEffects,
          metadata: {
            teammateMode: true,
            epicId: epicPayload.epicId,
            action: epicPayload.action,
          },
        };

      } catch (error) {
        logger.error('Pre-epic hook failed', error);

        // Return graceful failure - allow execution to continue
        return {
          continue: true,
          modified: false,
          metadata: {
            error: error instanceof Error ? error.message : 'Unknown error',
            epicId: epicPayload.epicId,
          },
        };
      }
    };
  }

  private async handleEpicCreation(
    payload: PreEpicPayload,
    context: AgenticHookContext,
    sideEffects: SideEffect[]
  ): Promise<void> {
    logger.info(`Creating new epic context: ${payload.epicId}`);

    // Initialize epic context in memory
    const epicContext = await this.contextManager.createEpicContext({
      epicId: payload.epicId,
      repo: payload.repo || '',
      title: 'New Epic',
      state: 'in-progress',
      createdAt: new Date(),
      agents: [],
      decisions: [],
      milestones: [],
    });

    // Store in memory for access by other components
    sideEffects.push({
      type: 'memory',
      action: 'store',
      data: {
        namespace: 'epic:context',
        key: payload.epicId,
        value: epicContext,
      },
    });

    // Emit metric
    sideEffects.push({
      type: 'metric',
      action: 'increment',
      data: {
        name: 'epic.created',
        value: 1,
      },
    });

    // Log creation
    sideEffects.push({
      type: 'log',
      action: 'info',
      data: {
        level: 'info',
        message: `Epic context created: ${payload.epicId}`,
        data: { epicId: payload.epicId },
      },
    });
  }

  private async handleEpicResumption(
    payload: PreEpicPayload,
    context: AgenticHookContext,
    sideEffects: SideEffect[]
  ): Promise<void> {
    logger.info(`Resuming epic: ${payload.epicId}`);

    // Load epic context from memory
    let epicContext = await this.contextManager.loadEpicContext(payload.epicId);

    // If not in memory, try to restore from GitHub
    if (!epicContext && payload.restoreContext && payload.repo) {
      logger.info('Context not found in memory, restoring from GitHub');

      const syncService = new EpicSyncService(payload.epicId, payload.repo);
      epicContext = await syncService.pullFromGitHub();

      if (epicContext) {
        // Store restored context in memory
        await this.contextManager.saveEpicContext(epicContext);

        sideEffects.push({
          type: 'log',
          action: 'info',
          data: {
            level: 'info',
            message: `Epic context restored from GitHub: ${payload.epicId}`,
            data: {
              epicId: payload.epicId,
              issueCount: epicContext.issues?.length || 0,
            },
          },
        });
      }
    }

    if (!epicContext) {
      throw new Error(`Epic context not found: ${payload.epicId}`);
    }

    // Inject context into execution environment
    context.metadata.epicContext = epicContext;

    // Update memory with loaded context
    sideEffects.push({
      type: 'memory',
      action: 'store',
      data: {
        namespace: 'epic:context',
        key: payload.epicId,
        value: epicContext,
      },
    });

    // Track resumption metric
    sideEffects.push({
      type: 'metric',
      action: 'increment',
      data: {
        name: 'epic.resumed',
        value: 1,
      },
    });
  }

  private async handleEpicPause(
    payload: PreEpicPayload,
    context: AgenticHookContext,
    sideEffects: SideEffect[]
  ): Promise<void> {
    logger.info(`Pausing epic: ${payload.epicId}`);

    // Load current context
    const epicContext = await this.contextManager.loadEpicContext(payload.epicId);

    if (epicContext) {
      // Update state to paused
      epicContext.state = 'paused';
      epicContext.pausedAt = new Date();

      // Save updated context
      await this.contextManager.saveEpicContext(epicContext);

      sideEffects.push({
        type: 'memory',
        action: 'store',
        data: {
          namespace: 'epic:context',
          key: payload.epicId,
          value: epicContext,
        },
      });
    }

    sideEffects.push({
      type: 'metric',
      action: 'increment',
      data: {
        name: 'epic.paused',
        value: 1,
      },
    });
  }

  private async handleEpicCompletion(
    payload: PreEpicPayload,
    context: AgenticHookContext,
    sideEffects: SideEffect[]
  ): Promise<void> {
    logger.info(`Completing epic: ${payload.epicId}`);

    // Load current context
    const epicContext = await this.contextManager.loadEpicContext(payload.epicId);

    if (epicContext) {
      // Update state to completed
      epicContext.state = 'completed';
      epicContext.completedAt = new Date();

      // Calculate final metrics
      const duration = epicContext.completedAt.getTime() - epicContext.createdAt.getTime();
      const durationHours = duration / (1000 * 60 * 60);

      // Save updated context
      await this.contextManager.saveEpicContext(epicContext);

      sideEffects.push({
        type: 'memory',
        action: 'store',
        data: {
          namespace: 'epic:context',
          key: payload.epicId,
          value: epicContext,
        },
      });

      // Track completion metrics
      sideEffects.push({
        type: 'metric',
        action: 'update',
        data: {
          name: 'epic.duration_hours',
          value: durationHours,
        },
      });
    }

    sideEffects.push({
      type: 'metric',
      action: 'increment',
      data: {
        name: 'epic.completed',
        value: 1,
      },
    });

    // Send completion notification
    sideEffects.push({
      type: 'notification',
      action: 'send',
      data: {
        title: 'Epic Completed',
        message: `Epic ${payload.epicId} has been completed`,
        severity: 'info',
      },
    });
  }

  /**
   * Register this hook with the agentic hook manager
   */
  register(): void {
    const registration: HookRegistration = {
      id: 'pre-epic-context-loader',
      type: 'workflow-start',
      handler: this.createHandler(),
      priority: 100, // High priority - runs before most hooks
      filter: {
        patterns: [/^epic:/],
      },
      options: {
        async: true,
        timeout: 30000, // 30 second timeout for context loading
        retries: 2,
      },
    };

    agenticHookManager.register(registration);
    logger.info('Registered pre-epic hook');
  }
}

// ===== Post-Epic-Phase Hook =====

/**
 * Post-Epic-Phase Hook
 *
 * Executes after completing a SPARC phase within an epic:
 * - Updates milestone progress in memory and GitHub
 * - Stores phase artifacts and decisions
 * - Synchronizes epic state bidirectionally
 *
 * Conditional execution: Only runs when CTO-Flow mode is enabled
 */
export class PostEpicPhaseHook {
  private contextManager: EpicContextManager;

  constructor() {
    this.contextManager = new EpicContextManager();
  }

  /**
   * Create hook handler
   */
  createHandler(): HookHandler {
    return async (payload: HookPayload, context: AgenticHookContext): Promise<HookHandlerResult> => {
      // Check if CTO-Flow mode is enabled
      if (!canUseCtoFlowMode()) {
        logger.debug('CTO-Flow mode disabled, skipping post-epic-phase hook');
        return {
          continue: true,
          modified: false,
        };
      }

      const phasePayload = payload as PostEpicPhasePayload;
      logger.info(`Post-epic-phase hook: ${phasePayload.phase} for epic ${phasePayload.epicId}`);

      try {
        const sideEffects: SideEffect[] = [];

        // Load epic context
        const epicContext = await this.contextManager.loadEpicContext(phasePayload.epicId);

        if (!epicContext) {
          logger.warn(`Epic context not found: ${phasePayload.epicId}`);
          return {
            continue: true,
            modified: false,
          };
        }

        // Update milestone progress
        await this.updateMilestoneProgress(epicContext, phasePayload, sideEffects);

        // Store phase artifacts in memory
        if (phasePayload.phaseResult) {
          await this.storePhaseArtifacts(epicContext, phasePayload, sideEffects);
        }

        // Sync to GitHub if requested
        if (phasePayload.syncToGithub) {
          await this.syncToGitHub(epicContext, phasePayload, sideEffects);
        }

        // Save updated context
        await this.contextManager.saveEpicContext(epicContext);

        return {
          continue: true,
          modified: true,
          sideEffects,
          metadata: {
            teammateMode: true,
            epicId: phasePayload.epicId,
            phase: phasePayload.phase,
            synced: phasePayload.syncToGithub || false,
          },
        };

      } catch (error) {
        logger.error('Post-epic-phase hook failed', error);

        return {
          continue: true,
          modified: false,
          metadata: {
            error: error instanceof Error ? error.message : 'Unknown error',
            epicId: phasePayload.epicId,
            phase: phasePayload.phase,
          },
        };
      }
    };
  }

  private async updateMilestoneProgress(
    epicContext: any,
    payload: PostEpicPhasePayload,
    sideEffects: SideEffect[]
  ): Promise<void> {
    const phaseMilestoneMap: Record<string, string> = {
      'specification': 'SPARC: Requirements Complete',
      'pseudocode': 'SPARC: Design Complete',
      'architecture': 'SPARC: Architecture Complete',
      'refinement': 'SPARC: Implementation Complete',
      'completion': 'SPARC: Ready for Release',
    };

    const milestoneName = phaseMilestoneMap[payload.phase];
    if (!milestoneName) {
      logger.warn(`Unknown phase: ${payload.phase}`);
      return;
    }

    // Find or create milestone
    let milestone = epicContext.milestones?.find((m: any) => m.name === milestoneName);

    if (!milestone) {
      milestone = {
        name: milestoneName,
        phase: payload.phase,
        state: 'in-progress',
        progress: 0,
        createdAt: new Date(),
      };

      if (!epicContext.milestones) {
        epicContext.milestones = [];
      }
      epicContext.milestones.push(milestone);
    }

    // Update milestone state and progress
    milestone.state = 'completed';
    milestone.progress = 100;
    milestone.completedAt = new Date();

    logger.info(`Updated milestone: ${milestoneName}`);

    // Store milestone update in memory
    sideEffects.push({
      type: 'memory',
      action: 'store',
      data: {
        namespace: 'epic:milestones',
        key: `${payload.epicId}:${payload.phase}`,
        value: milestone,
      },
    });

    // Track phase completion metric
    sideEffects.push({
      type: 'metric',
      action: 'increment',
      data: {
        name: `epic.phase.${payload.phase}.completed`,
        value: 1,
      },
    });
  }

  private async storePhaseArtifacts(
    epicContext: any,
    payload: PostEpicPhasePayload,
    sideEffects: SideEffect[]
  ): Promise<void> {
    const { artifacts, decisions, metrics } = payload.phaseResult!;

    // Store artifacts
    if (artifacts && artifacts.length > 0) {
      sideEffects.push({
        type: 'memory',
        action: 'store',
        data: {
          namespace: 'epic:artifacts',
          key: `${payload.epicId}:${payload.phase}`,
          value: {
            phase: payload.phase,
            artifacts,
            timestamp: Date.now(),
          },
        },
      });

      logger.info(`Stored ${artifacts.length} artifacts for phase ${payload.phase}`);
    }

    // Store decisions
    if (decisions && decisions.length > 0) {
      if (!epicContext.decisions) {
        epicContext.decisions = [];
      }

      for (const decision of decisions) {
        epicContext.decisions.push({
          ...decision,
          phase: payload.phase,
          timestamp: new Date(),
        });
      }

      sideEffects.push({
        type: 'memory',
        action: 'store',
        data: {
          namespace: 'epic:decisions',
          key: `${payload.epicId}:${payload.phase}`,
          value: decisions,
        },
      });

      logger.info(`Stored ${decisions.length} decisions for phase ${payload.phase}`);
    }

    // Store metrics
    if (metrics && Object.keys(metrics).length > 0) {
      sideEffects.push({
        type: 'memory',
        action: 'store',
        data: {
          namespace: 'epic:metrics',
          key: `${payload.epicId}:${payload.phase}`,
          value: metrics,
        },
      });

      logger.info(`Stored metrics for phase ${payload.phase}`);
    }
  }

  private async syncToGitHub(
    epicContext: any,
    payload: PostEpicPhasePayload,
    sideEffects: SideEffect[]
  ): Promise<void> {
    const config = getCtoFlowConfig();

    if (!config?.github?.owner || !config?.github?.repo) {
      logger.warn('GitHub config not available, skipping sync');
      return;
    }

    const repo = `${config.github.owner}/${config.github.repo}`;
    const syncService = new EpicSyncService(payload.epicId, repo);

    try {
      await syncService.pushToGitHub(epicContext);

      logger.info(`Synced phase ${payload.phase} to GitHub`);

      sideEffects.push({
        type: 'metric',
        action: 'increment',
        data: {
          name: 'epic.github.sync.success',
          value: 1,
        },
      });

      sideEffects.push({
        type: 'log',
        action: 'info',
        data: {
          level: 'info',
          message: `Phase ${payload.phase} synced to GitHub`,
          data: {
            epicId: payload.epicId,
            phase: payload.phase,
          },
        },
      });

    } catch (error) {
      logger.error('GitHub sync failed', error);

      sideEffects.push({
        type: 'metric',
        action: 'increment',
        data: {
          name: 'epic.github.sync.failure',
          value: 1,
        },
      });
    }
  }

  /**
   * Register this hook with the agentic hook manager
   */
  register(): void {
    const registration: HookRegistration = {
      id: 'post-epic-phase-updater',
      type: 'workflow-step',
      handler: this.createHandler(),
      priority: 80, // High priority - runs early in post-step hooks
      filter: {
        patterns: [/^epic:/],
      },
      options: {
        async: true,
        timeout: 60000, // 60 second timeout for sync operations
        retries: 1,
      },
    };

    agenticHookManager.register(registration);
    logger.info('Registered post-epic-phase hook');
  }
}

// ===== Post-Specification Hook =====

/**
 * Post-Specification Hook
 *
 * Executes after SPARC specification phase completion:
 * - Optionally generates GitHub epic from specification
 * - Creates child issues and milestones
 * - Maps specification requirements to epic structure
 *
 * Conditional execution: Only runs when:
 * 1. CTO-Flow mode is enabled
 * 2. generateEpic flag is set to true
 */
export class PostSpecificationHook {
  /**
   * Create hook handler
   */
  createHandler(): HookHandler {
    return async (payload: HookPayload, context: AgenticHookContext): Promise<HookHandlerResult> => {
      // Check if CTO-Flow mode is enabled
      if (!canUseCtoFlowMode()) {
        logger.debug('CTO-Flow mode disabled, skipping post-specification hook');
        return {
          continue: true,
          modified: false,
        };
      }

      const specPayload = payload as PostSpecificationPayload;

      // Check if epic generation is requested
      if (!specPayload.generateEpic) {
        logger.debug('Epic generation not requested, skipping');
        return {
          continue: true,
          modified: false,
        };
      }

      // Validate repo is provided
      if (!specPayload.repo) {
        logger.warn('Epic generation requested but no repo provided');
        return {
          continue: true,
          modified: false,
          metadata: {
            warning: 'Epic generation skipped: no repository specified',
          },
        };
      }

      logger.info(`Post-specification hook: generating epic for task ${specPayload.taskId}`);

      try {
        const sideEffects: SideEffect[] = [];

        // Create epic exporter
        const exporter = new SparcEpicExporter(specPayload.repo);

        // Export specification to GitHub epic
        const epicResult = await exporter.exportToEpic({
          taskId: specPayload.taskId,
          taskDescription: specPayload.specification.taskDescription,
          requirements: specPayload.specification.requirements,
          userStories: specPayload.specification.userStories,
          acceptanceCriteria: specPayload.specification.acceptanceCriteria,
          designNotes: specPayload.specification.designNotes,
        });

        logger.info(`Epic created: ${epicResult.epicUrl}`);
        logger.info(`Created ${epicResult.childIssues.length} child issues and ${epicResult.milestones.length} milestones`);

        // Store epic reference in memory
        sideEffects.push({
          type: 'memory',
          action: 'store',
          data: {
            namespace: 'sparc:epic-refs',
            key: specPayload.taskId,
            value: {
              epicId: epicResult.epicId,
              epicNumber: epicResult.epicNumber,
              epicUrl: epicResult.epicUrl,
              childIssues: epicResult.childIssues,
              milestones: epicResult.milestones,
              createdAt: new Date(),
            },
          },
        });

        // Track epic generation metric
        sideEffects.push({
          type: 'metric',
          action: 'increment',
          data: {
            name: 'epic.generated.from_spec',
            value: 1,
          },
        });

        sideEffects.push({
          type: 'metric',
          action: 'update',
          data: {
            name: 'epic.child_issues.created',
            value: epicResult.childIssues.length,
          },
        });

        // Send notification
        sideEffects.push({
          type: 'notification',
          action: 'send',
          data: {
            title: 'Epic Generated from Specification',
            message: `Epic #${epicResult.epicNumber} created with ${epicResult.childIssues.length} issues`,
            severity: 'info',
            link: epicResult.epicUrl,
          },
        });

        // Log epic creation
        sideEffects.push({
          type: 'log',
          action: 'info',
          data: {
            level: 'info',
            message: `Epic generated from specification: ${specPayload.taskId}`,
            data: {
              taskId: specPayload.taskId,
              epicId: epicResult.epicId,
              epicUrl: epicResult.epicUrl,
              childIssues: epicResult.childIssues.length,
              milestones: epicResult.milestones.length,
            },
          },
        });

        return {
          continue: true,
          modified: true,
          payload: {
            ...specPayload,
            epicGenerated: true,
            epicResult,
          },
          sideEffects,
          metadata: {
            teammateMode: true,
            epicGenerated: true,
            epicId: epicResult.epicId,
            epicUrl: epicResult.epicUrl,
          },
        };

      } catch (error) {
        logger.error('Post-specification hook failed', error);

        // Track failure metric
        const sideEffects: SideEffect[] = [{
          type: 'metric',
          action: 'increment',
          data: {
            name: 'epic.generated.failure',
            value: 1,
          },
        }];

        return {
          continue: true,
          modified: false,
          sideEffects,
          metadata: {
            error: error instanceof Error ? error.message : 'Unknown error',
            taskId: specPayload.taskId,
          },
        };
      }
    };
  }

  /**
   * Register this hook with the agentic hook manager
   */
  register(): void {
    const registration: HookRegistration = {
      id: 'post-specification-epic-generator',
      type: 'workflow-complete',
      handler: this.createHandler(),
      priority: 90, // High priority - runs early in completion hooks
      filter: {
        patterns: [/^sparc:/, /^specification:/],
      },
      options: {
        async: true,
        timeout: 120000, // 2 minute timeout for GitHub API operations
        retries: 2,
        errorHandler: (error: Error) => {
          logger.error('Epic generation failed, continuing workflow', error);
        },
      },
    };

    agenticHookManager.register(registration);
    logger.info('Registered post-specification hook');
  }
}

// ===== Hook Registration Function =====

/**
 * Register all epic hooks with the agentic hook manager
 *
 * This function should be called during claude-flow initialization
 * to register all cto-flow agent management hooks.
 *
 * All hooks check canUseCtoFlowMode() internally and gracefully
 * no-op when CTO-Flow mode is disabled.
 */
export function registerEpicHooks(): void {
  logger.info('Registering epic lifecycle hooks...');

  try {
    // Register pre-epic hook
    const preEpicHook = new PreEpicHook();
    preEpicHook.register();

    // Register post-epic-phase hook
    const postEpicPhaseHook = new PostEpicPhaseHook();
    postEpicPhaseHook.register();

    // Register post-specification hook
    const postSpecificationHook = new PostSpecificationHook();
    postSpecificationHook.register();

    logger.info('Successfully registered 3 epic lifecycle hooks');

  } catch (error) {
    logger.error('Failed to register epic hooks', error);
    throw error;
  }
}

/**
 * Unregister all epic hooks from the agentic hook manager
 *
 * Useful for testing or when disabling CTO-Flow mode at runtime
 */
export function unregisterEpicHooks(): void {
  logger.info('Unregistering epic lifecycle hooks...');

  try {
    agenticHookManager.unregister('pre-epic-context-loader');
    agenticHookManager.unregister('post-epic-phase-updater');
    agenticHookManager.unregister('post-specification-epic-generator');

    logger.info('Successfully unregistered epic lifecycle hooks');

  } catch (error) {
    logger.error('Failed to unregister epic hooks', error);
  }
}

// Hook classes are exported at definition (export class ...)
// Payload types are exported at definition (export interface ...)
