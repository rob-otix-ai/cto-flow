/**
 * CTO-Flow Agent Management System - Main Index
 *
 * Provides the CtoFlowManager facade and exports all public components
 * for the CTO-Flow Agent Management system integrated with claude-flow.
 *
 * @module cto-flow-agents
 */

// ===== CORE TYPE EXPORTS =====
export type {
  // Epic State Machine Types (excluding EpicState - exported separately from epic-state-machine)
  CtoFlowConfig,
  CreateEpicParams,
  CreateTaskParams,
  CreateADRParams,
  StateTransitionParams,
  AssignAgentParams,
  EpicQueryFilter,
  TaskQueryFilter,
  ScoringContext,
  PerformanceMetrics,
  EpicStatistics,
  ValidationResult,
  EpicEventType,
  EpicEvent,

  // Core Epic Types
  Task,
  Assignment,
  AgentPerformance,
  AgentScore,
  AgentProfile,
  ADR,
  ProjectContext,
  BlockingReason,
  EpicContext,
  TaskPriority,
  TaskStatus,
  AgentAvailability,
  ADRStatus,
} from './core/types.js';

// Export core constants
export {
  EPIC_STATE_TRANSITIONS,
  DEFAULT_SCORING_WEIGHTS,
  MINIMUM_SCORE_THRESHOLD,
  DEFAULT_CTOFLOW_CONFIG,
  isValidStateTransition,
  meetsScoreThreshold,
  calculateTotalScore,
  validateScoringWeights,
} from './core/types.js';

// Export EpicState from epic-state-machine (the canonical source)
export { EpicState } from './core/epic-state-machine.js';

// ===== CORE CLASS EXPORTS =====
export { EpicStateMachine } from './core/epic-state-machine.js';
export type {
  TransitionMetadata,
  StateTransition,
  GuardFunction,
  TransitionHook,
  StateMachineConfig
} from './core/epic-state-machine.js';

export {
  CtoFlowConfigManager,
  DEFAULT_CONFIG,
  isCtoFlowModeEnabled,
  isGitHubConfigured,
  canUseCtoFlowMode,
  validateConfig,
  getConfig,
  loadConfig,
  getConfigManager,
} from './core/config-manager.js';

export {
  EpicMemoryManager,
  createEpicMemoryManager,
  EPIC_NAMESPACES,
  TTL_PRESETS,
} from './memory/epic-memory-manager.js';

export type {
  MemoryOptions,
  EpicMemoryConfig,
  ArchitecturalDecision,
  Alternative,
  TaskProgress,
  Checkpoint,
  AgentAssignment,
  SyncState,
  SyncConflict,
  Milestone,
} from './memory/epic-memory-manager.js';

// ===== IMPORTS FOR TEAMMATE MANAGER =====
// Use EpicState from epic-state-machine for state machine operations
import { EpicStateMachine, EpicState as StateMachineEpicState } from './core/epic-state-machine.js';
import { type CtoFlowConfig as CoreCtoFlowConfig, type Assignment, type AgentPerformance, TaskStatus } from './core/types.js';
import { CtoFlowConfigManager } from './core/config-manager.js';
import { EpicMemoryManager, type EpicContext as MemoryEpicContext, type AgentAssignment } from './memory/epic-memory-manager.js';
import { randomUUID } from 'crypto';

// ===== IMPORT REAL IMPLEMENTATIONS =====
// Agent Scoring System (6-factor algorithm)
import {
  AgentScorer as RealAgentScorer,
  createDefaultScorer,
  createCustomScorer,
  createCapabilityFocusedScorer,
  createAvailabilityFocusedScorer,
  createPerformanceFocusedScorer,
  DEFAULT_WEIGHTS as SCORER_DEFAULT_WEIGHTS,
  DEFAULT_SKILL_SYNONYMS,
  MINIMUM_SCORE_THRESHOLD as SCORER_MINIMUM_THRESHOLD,
  type AgentCapabilities,
  type AgentWorkload,
  type TaskRequirements,
  type AgentInfo,
  type ScoreBreakdown,
  type ScoringWeights,
  type SkillSynonyms,
} from './scoring/agent-scorer.js';

// GitHub Epic Sync Service
import {
  EpicSyncService as RealEpicSyncService,
  type SparcSpecification,
  type UserStory,
  type Risk,
  type SparcPhase,
  type EpicIssue,
  type ChildIssue,
  type EpicExportResult,
  type GitHubConfig,
  type EpicSyncConfig,
  type GitHubWebhookEvent,
  type ConflictResolution,
  type IMemoryManager,
} from './github/epic-sync-service.js';

// GitHub Projects Integration
import {
  CtoFlowProjectBridge,
  createCtoFlowProjectBridge,
  DEFAULT_PROJECT_CONFIG,
  type CtoFlowProjectConfig,
  type EpicProjectMapping,
  type AgentIssueAssignment,
  type IssueForSelection,
} from './github/cto-flow-project-bridge.js';

import {
  GitHubProjectManager,
  createUserProjectManager,
  createOrgProjectManager,
  DEFAULT_STATUS_OPTIONS,
  DEFAULT_STATUS_MAPPING,
  STATUS_COLORS,
  type GitHubProject,
  type ProjectField,
  type ProjectFieldOption,
  type ProjectItem,
  type ProjectConfig,
  type CreateProjectOptions,
  type AddItemOptions,
  type ProjectSyncState,
} from './github/project-manager.js';

// Epic Hooks System
import {
  registerEpicHooks as realRegisterEpicHooks,
  unregisterEpicHooks,
  PreEpicHook,
  PostEpicPhaseHook,
  PostSpecificationHook,
  type PreEpicPayload,
  type PostEpicPhasePayload,
  type PostSpecificationPayload,
} from './hooks/epic-hooks.js';

// Epic Work Hooks (for hive-mind integration)
import {
  registerEpicWorkHooks,
  unregisterEpicWorkHooks,
  triggerWorkComplete,
  PreWorkHook,
  PostWorkHook,
  WorkFailedHook,
  type PreWorkPayload,
  type PostWorkPayload,
  type WorkFailedPayload,
} from './hooks/epic-work-hooks.js';

// Post-SPARC Hook (auto-create epics from SPARC planning)
import {
  registerPostSparcHook,
  unregisterPostSparcHook,
  handleSparcComplete,
  PostSparcHook,
  type SparcOutput,
  type PostSparcPayload,
  type CreatedTask,
} from './hooks/post-sparc-hook.js';

// Post-Work Hook (auto-create PR and update issues)
import {
  registerPostWorkHook,
  unregisterPostWorkHook,
  handleWorkComplete,
  PostWorkHook as PostWorkPRHook,
  type WorkOutput,
  type PostWorkPayload as PostWorkPRPayload,
  type PRCreationResult as PostWorkPRResult,
} from './hooks/post-work-hook.js';

// Post-Review Hook (handle review completion and follow-up tasks)
import {
  registerPostReviewHook,
  unregisterPostReviewHook,
  handleReviewComplete,
  PostReviewHook,
  type ReviewResult,
  type ReviewerResult,
  type CriticalIssue,
  type PostReviewPayload,
  type FollowUpTask,
} from './hooks/post-review-hook.js';

// SPARC to Epic Parser
import {
  parseSparcOutput,
  extractTasks,
  detectDependencies,
  convertToSparcSpecification,
  type ParsedEpic,
  type ParsedTask,
} from './parsers/sparc-to-epic.js';

// Worker Configuration (local/codespace/hybrid modes)
import {
  getWorkerConfig,
  setWorkerMode,
  shouldUseCodespace,
  getDefaultConfig as getDefaultWorkerConfig,
  validateWorkerConfig,
  WorkerConfigManager,
  DEFAULT_WORKER_CONFIG,
  type WorkerMode,
  type WorkerConfig,
  type TaskContext as WorkerTaskContext,
  type LocalWorkerConfig,
  type HybridWorkerConfig,
  type WorkerConfigValidationResult,
} from './workers/worker-config.js';

// Codespace Worker (GitHub Codespaces task execution)
import {
  CodespaceWorker,
  createCodespaceWorker,
  DEFAULT_CODESPACE_CONFIG,
  type CodespaceWorkerConfig,
  type TaskExecutionContext,
  type CodespaceState,
  type TaskExecutionResult,
  type ProgressCallback,
} from './workers/codespace-worker.js';

// Advanced Task Routing (intelligent local/codespace task distribution)
import {
  AdvancedTaskRouter,
  getRouter,
  createRouter,
  routeTask,
  createTaskProfile,
  DEFAULT_ROUTING_RULES,
  type RoutingDecision,
  type TaskProfile,
  type RoutingRule,
  type TaskType,
  type ResourceRequirements,
  type RoutingFactor,
  type RoutingContext,
} from './workers/advanced-routing.js';

// Progress Tracker (epic velocity and health monitoring)
import {
  ProgressTracker,
  createProgressTracker,
  type ProgressTrackerConfig,
  type EpicProgressState,
  type TaskProgressEntry,
  type VelocityMetrics,
  type HealthStatus,
  type HealthCategory,
  type ProgressWebhook,
} from './tracking/progress-tracker.js';

// GitHub Webhook Server (for real-time issue assignment detection)
import {
  GitHubWebhookServer,
  createWebhookServer,
  startWebhookServer,
  getWebhookSetupInstructions,
  type WebhookConfig,
  type GitHubWebhookPayload,
  type AssignmentEvent,
  type IssueClosedEvent,
  type WebhookEvent,
} from './github/webhook-server.js';

// ===== TEAMMATE MANAGER TYPES =====

/**
 * Epic simplified interface for external use
 */
export interface Epic {
  id: string;
  epicId: string;
  name: string;
  description: string;
  state: StateMachineEpicState;
  createdAt: Date;
  updatedAt: Date;
  url?: string;
  issueNumber?: number;
  metadata: Record<string, unknown>;
}

/**
 * Epic creation options
 */
export interface EpicOptions {
  metadata?: Record<string, unknown>;
  labels?: string[];
  issueNumber?: number;
}

/**
 * Epic filter options
 */
export interface EpicFilter {
  state?: StateMachineEpicState | StateMachineEpicState[];
  createdAfter?: Date;
  createdBefore?: Date;
}

/**
 * Epic sync result
 */
export interface SyncResult {
  success: boolean;
  epicId: string;
  synced: boolean;
  conflicts?: number;
  error?: string;
  timestamp: Date;
}

/**
 * Simplified SPARC specification for CtoFlowManager facade
 * For full GitHub integration, use SparcSpecification from epic-sync-service
 */
export interface SimpleSparcSpec {
  title: string;
  description: string;
  requirements: string[];
  constraints: string[];
  technicalStack?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Simplified export result for CtoFlowManager facade
 * For full GitHub integration, use EpicExportResult from epic-sync-service
 */
export interface SimpleExportResult {
  success: boolean;
  epicId: string;
  epic: Epic;
  tasksCreated: number;
  error?: string;
}

// ===== TEAMMATE MANAGER CLASS =====

/**
 * CtoFlowManager - Main facade for CTO-Flow Agent Management
 *
 * Provides high-level API for:
 * - Epic lifecycle management
 * - Agent work assignment
 * - Context persistence and restoration
 * - SPARC integration
 */
export class CtoFlowManager {
  private configManager: CtoFlowConfigManager;
  private memoryManager: EpicMemoryManager;
  private agentScorer: RealAgentScorer;
  private projectBridge: CtoFlowProjectBridge | null = null;
  private stateMachines: Map<string, EpicStateMachine> = new Map();
  private epics: Map<string, Epic> = new Map();
  private assignments: Map<string, Assignment> = new Map();
  private initialized = false;

  /**
   * Creates a new CtoFlowManager instance
   *
   * @param config - Optional configuration overrides
   */
  constructor(config?: Partial<CoreCtoFlowConfig>) {
    this.configManager = CtoFlowConfigManager.getInstance();
    this.memoryManager = new EpicMemoryManager();
    this.agentScorer = createDefaultScorer();

    if (config) {
      this.configManager.loadConfig(config);
    }
  }

  // ===== INITIALIZATION =====

  /**
   * Initialize the CtoFlowManager
   *
   * @param config - Optional configuration overrides
   */
  async initialize(config?: Partial<CoreCtoFlowConfig>): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Load configuration only if provided (constructor may have already loaded it)
    if (config) {
      this.configManager.loadConfig(config);
    } else if (!this.configManager.getValidationResult()) {
      // Only call loadConfig() if it hasn't been called yet
      this.configManager.loadConfig();
    }

    // Validate configuration
    const validation = this.configManager.validateConfig();
    if (!validation.valid) {
      throw new Error(`Configuration validation failed: ${validation.errors.join(', ')}`);
    }

    // Initialize memory manager
    await this.memoryManager.initialize();

    // Initialize GitHub Projects bridge if configured
    const fullConfig = this.configManager.getConfig();
    if (fullConfig.github?.owner && fullConfig.github?.repo) {
      const memoryAdapter: IMemoryManager = {
        store: async (key: string, value: any, namespace?: string) => {
          // Use the epic memory manager to store project data
          const storeKey = namespace ? `${namespace}:${key}` : key;
          await this.memoryManager.storeEpicContext({
            epicId: storeKey,
            title: key,
            description: JSON.stringify(value),
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
            createdBy: 'cto-flow-manager',
            owner: 'system',
            tags: [namespace || 'default'],
            metadata: { data: value },
            dependencies: [],
            milestones: [],
            objectives: [],
            constraints: [],
          });
        },
        retrieve: async (key: string, namespace?: string) => {
          const storeKey = namespace ? `${namespace}:${key}` : key;
          const context = await this.memoryManager.loadEpicContext(storeKey);
          return context?.metadata?.data || null;
        },
        delete: async (key: string, namespace?: string) => {
          const storeKey = namespace ? `${namespace}:${key}` : key;
          await this.memoryManager.deleteEpic(storeKey);
        },
      };

      this.projectBridge = createCtoFlowProjectBridge(
        {
          github: {
            owner: fullConfig.github.owner,
            repo: fullConfig.github.repo,
            ownerType: (fullConfig.github as any).ownerType || 'user',
          },
          sync: {
            enabled: true,
            autoCreateProject: true,
            autoAddIssues: true,
            autoUpdateStatus: true,
            pollIntervalMs: fullConfig.github.syncInterval || 60000,
          },
          agentSelection: {
            enabled: true,
            autoAssign: fullConfig.agents?.autoAssignment || false,
            minScore: fullConfig.agents?.assignmentThreshold || 50,
          },
        },
        memoryAdapter
      );
    }

    this.initialized = true;
  }

  /**
   * Check if CTO-Flow mode is enabled
   */
  isEnabled(): boolean {
    return this.configManager.isCtoFlowModeEnabled();
  }

  /**
   * Check if CTO-Flow mode can be used (enabled AND configured)
   */
  canUse(): boolean {
    return this.configManager.canUseCtoFlowMode();
  }

  // ===== EPIC OPERATIONS =====

  /**
   * Create a new epic
   *
   * @param title - Epic title
   * @param options - Epic creation options
   * @returns Created epic
   */
  async createEpic(title: string, options?: EpicOptions): Promise<Epic> {
    if (!this.initialized) {
      await this.initialize();
    }

    const epicId = `epic-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const now = new Date();

    const epic: Epic = {
      id: epicId,
      epicId,
      name: title,
      description: options?.metadata?.description as string || '',
      state: StateMachineEpicState.UNINITIALIZED,
      createdAt: now,
      updatedAt: now,
      issueNumber: options?.issueNumber,
      metadata: options?.metadata || {},
    };

    // Create state machine for epic (starts UNINITIALIZED)
    const stateMachine = new EpicStateMachine({
      initialState: StateMachineEpicState.UNINITIALIZED,
    });

    this.stateMachines.set(epicId, stateMachine);
    this.epics.set(epicId, epic);

    // Store in memory using MemoryEpicContext type
    const epicContext: MemoryEpicContext = {
      epicId,
      title,
      description: epic.description,
      status: 'planning',
      createdAt: now,
      updatedAt: now,
      createdBy: 'system',
      owner: 'system',
      tags: options?.labels || [],
      metadata: {
        ...options?.metadata,
        state: StateMachineEpicState.UNINITIALIZED,
        issueNumber: options?.issueNumber,
      },
      dependencies: [],
      milestones: [],
      objectives: [],
      constraints: [],
    };

    await this.memoryManager.storeEpicContext(epicContext);

    // Transition to ACTIVE state via proper state machine transition
    await stateMachine.transition(StateMachineEpicState.ACTIVE, {
      reason: 'Epic created and initialized',
      triggeredBy: 'system',
    });

    epic.state = StateMachineEpicState.ACTIVE;
    epic.updatedAt = new Date();

    // Update in memory
    epicContext.status = 'active';
    epicContext.metadata.state = StateMachineEpicState.ACTIVE;
    epicContext.updatedAt = new Date();
    await this.memoryManager.storeEpicContext(epicContext);

    // Auto-create GitHub Project if bridge is configured
    if (this.projectBridge) {
      try {
        const mapping = await this.projectBridge.createProjectForEpic(
          epicId,
          title,
          epic.description,
          [] // Initial tasks can be added later
        );
        epic.url = mapping.projectUrl;
        epic.metadata.projectNumber = mapping.projectNumber;
        epic.metadata.projectId = mapping.projectId;
      } catch (error) {
        // Log but don't fail epic creation if project creation fails
        console.error(`Failed to create GitHub Project for epic ${epicId}:`, error);
      }
    }

    return epic;
  }

  /**
   * Get an epic by ID
   *
   * @param epicId - Epic identifier
   * @returns Epic or null if not found
   */
  async getEpic(epicId: string): Promise<Epic | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Try to get from in-memory cache
    let epic = this.epics.get(epicId);

    if (!epic) {
      // Try to load from memory manager
      const context = await this.memoryManager.loadEpicContext(epicId);
      if (context) {
        // Convert MemoryEpicContext to Epic
        const storedState = context.metadata?.state as StateMachineEpicState | undefined;
        epic = {
          id: context.epicId,
          epicId: context.epicId,
          name: context.title,
          description: context.description,
          state: storedState || this.statusToState(context.status),
          createdAt: context.createdAt,
          updatedAt: context.updatedAt,
          issueNumber: context.metadata?.issueNumber as number | undefined,
          metadata: context.metadata,
        };
        this.epics.set(epicId, epic);
      }
    }

    return epic || null;
  }

  /**
   * Convert memory status to EpicState
   */
  private statusToState(status: string): StateMachineEpicState {
    const mapping: Record<string, StateMachineEpicState> = {
      planning: StateMachineEpicState.UNINITIALIZED,
      active: StateMachineEpicState.ACTIVE,
      paused: StateMachineEpicState.PAUSED,
      completed: StateMachineEpicState.COMPLETED,
      cancelled: StateMachineEpicState.ARCHIVED,
    };
    return mapping[status] || StateMachineEpicState.UNINITIALIZED;
  }

  /**
   * Convert EpicState to memory status
   */
  private stateToStatus(state: StateMachineEpicState): 'planning' | 'active' | 'paused' | 'completed' | 'cancelled' {
    const mapping: Record<StateMachineEpicState, 'planning' | 'active' | 'paused' | 'completed' | 'cancelled'> = {
      [StateMachineEpicState.UNINITIALIZED]: 'planning',
      [StateMachineEpicState.ACTIVE]: 'active',
      [StateMachineEpicState.PAUSED]: 'paused',
      [StateMachineEpicState.BLOCKED]: 'paused',
      [StateMachineEpicState.REVIEW]: 'active',
      [StateMachineEpicState.COMPLETED]: 'completed',
      [StateMachineEpicState.ARCHIVED]: 'cancelled',
    };
    return mapping[state] || 'planning';
  }

  /**
   * List epics with optional filtering
   *
   * @param filter - Optional filter criteria
   * @returns Array of epics
   */
  async listEpics(filter?: EpicFilter): Promise<Epic[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Load all epics from memory manager to ensure we have the latest
    const contexts = await this.memoryManager.listAllEpicContexts();
    for (const context of contexts) {
      if (!this.epics.has(context.epicId)) {
        const storedState = context.metadata?.state as StateMachineEpicState | undefined;
        const epic: Epic = {
          id: context.epicId,
          epicId: context.epicId,
          name: context.title,
          description: context.description,
          state: storedState || this.statusToState(context.status),
          createdAt: context.createdAt,
          updatedAt: context.updatedAt,
          issueNumber: context.metadata?.issueNumber as number | undefined,
          metadata: context.metadata,
        };
        this.epics.set(context.epicId, epic);
      }
    }

    let epics = Array.from(this.epics.values());

    if (filter) {
      // Filter by state
      if (filter.state) {
        const states = Array.isArray(filter.state) ? filter.state : [filter.state];
        epics = epics.filter(epic => states.includes(epic.state));
      }

      // Filter by creation date
      if (filter.createdAfter) {
        epics = epics.filter(epic => epic.createdAt >= filter.createdAfter!);
      }

      if (filter.createdBefore) {
        epics = epics.filter(epic => epic.createdAt <= filter.createdBefore!);
      }
    }

    return epics.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Sync an epic with GitHub
   *
   * @param epicId - Epic identifier
   * @returns Sync result
   */
  async syncEpic(epicId: string): Promise<SyncResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const epic = await this.getEpic(epicId);
    if (!epic) {
      return {
        success: false,
        epicId,
        synced: false,
        error: 'Epic not found',
        timestamp: new Date(),
      };
    }

    // Get sync state from memory
    const syncState = await this.memoryManager.getSyncState(epicId);

    return {
      success: true,
      epicId,
      synced: syncState?.status === 'synced',
      conflicts: syncState?.conflicts.filter(c => !c.resolved).length || 0,
      timestamp: new Date(),
    };
  }

  // ===== AGENT OPERATIONS =====

  /**
   * Assign work to an agent from epic
   *
   * Uses the 6-factor agent scoring algorithm to select the best agent
   * for the given task based on available registered agents.
   *
   * @param epicId - Epic identifier
   * @param issueNumber - GitHub issue number
   * @param availableAgents - Optional list of available agents to score
   * @returns Assignment or null if not possible
   */
  async assignWork(
    epicId: string,
    issueNumber: number,
    availableAgents?: AgentInfo[]
  ): Promise<Assignment | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    const epic = await this.getEpic(epicId);
    if (!epic) {
      return null;
    }

    // Load epic context to get constraints/requirements
    const context = await this.memoryManager.loadEpicContext(epicId);
    if (!context) {
      return null;
    }

    // Build task requirements from epic context
    const taskRequirements: TaskRequirements = {
      taskId: `task-${issueNumber}`,
      title: `Issue #${issueNumber}`,
      description: `Work item from epic ${epicId}`,
      requiredCapabilities: context.objectives || [],
      preferredCapabilities: [],
      languages: [],
      frameworks: [],
      domains: context.constraints || [],
      complexity: 'medium',
      priority: 'medium',
      estimatedDuration: 60,
      labels: context.tags || [],
      epicId,
    };

    // Get registered agents from memory if not provided
    let agents = availableAgents;
    if (!agents || agents.length === 0) {
      const epicAgents = await this.memoryManager.getEpicAgents(epicId);
      if (epicAgents.length === 0) {
        return null;
      }
      // Convert AgentAssignment to AgentInfo for scoring
      agents = epicAgents
        .filter(a => a.status === 'active')
        .map(a => this.agentAssignmentToAgentInfo(a, epicId));
    }

    if (agents.length === 0) {
      return null;
    }

    // Use agent scorer to find best agent
    let selectedAgentId: string;
    let selectedScore: number;

    const qualifyingAgents = this.agentScorer.getQualifyingAgents(agents, taskRequirements);
    if (qualifyingAgents.length > 0) {
      const bestMatch = qualifyingAgents[0];
      selectedAgentId = bestMatch.agent.id;
      selectedScore = bestMatch.overallScore;
    } else {
      // No agents meet threshold - use best available anyway with lower confidence
      const allScores = this.agentScorer.scoreMultipleAgents(agents, taskRequirements);
      if (allScores.length > 0) {
        selectedAgentId = allScores[0].agent.id;
        selectedScore = allScores[0].overallScore;
      } else {
        selectedAgentId = agents[0].id;
        selectedScore = 30; // Low confidence fallback
      }
    }

    // Create assignment with real scoring
    const assignment: Assignment = {
      id: randomUUID(),
      taskId: taskRequirements.taskId,
      agentId: selectedAgentId,
      epicId,
      assignedAt: new Date(),
      score: selectedScore,
      status: TaskStatus.ASSIGNED,
    };

    // Record the task assignment
    const agentAssignment = await this.memoryManager.getAgentAssignment(epicId, selectedAgentId);
    if (agentAssignment) {
      agentAssignment.taskIds.push(taskRequirements.taskId);
      await this.memoryManager.recordAgentAssignment(agentAssignment);
    }

    // Store assignment in internal cache
    this.assignments.set(assignment.id, assignment);

    return assignment;
  }

  /**
   * Convert AgentAssignment from memory to AgentInfo for scoring
   */
  private agentAssignmentToAgentInfo(assignment: AgentAssignment, epicId: string): AgentInfo {
    const lastActivityDate = assignment.assignedAt instanceof Date
      ? assignment.assignedAt
      : new Date(assignment.assignedAt);

    return {
      id: assignment.agentId,
      type: assignment.role || 'general',
      capabilities: {
        core: assignment.responsibilities || [],
        languages: [],
        frameworks: [],
        domains: [],
      },
      performance: {
        tasksCompleted: assignment.taskIds.length,
        successRate: 0.8, // Default until we have performance tracking
        averageResponseTime: 1000,
        averageCompletionTime: 3600000,
        lastActivity: lastActivityDate,
        health: assignment.status === 'active' ? 1.0 : 0.5,
      },
      workload: {
        activeTasks: assignment.taskIds.length,
        maxConcurrentTasks: 5,
        workloadFactor: assignment.taskIds.length / 5,
      },
      status: assignment.status === 'active' ? 'idle' : 'busy',
      epicExperience: new Map([[epicId, 1]]),
      metadata: assignment.metadata || {},
    };
  }

  /**
   * Get all assignments for an epic
   *
   * @param epicId - Epic identifier
   * @returns Array of assignments
   */
  async getAssignments(epicId: string): Promise<Assignment[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Return assignments from internal cache that match this epic
    return Array.from(this.assignments.values())
      .filter(a => a.epicId === epicId);
  }

  // ===== CONTEXT OPERATIONS =====

  /**
   * Save epic context to memory
   *
   * @param epicId - Epic identifier
   */
  async saveContext(epicId: string): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    const epic = await this.getEpic(epicId);
    if (!epic) {
      throw new Error(`Epic ${epicId} not found`);
    }

    const context = await this.memoryManager.loadEpicContext(epicId);
    if (!context) {
      throw new Error(`Epic context ${epicId} not found`);
    }

    // Context is already in memory, just ensure it's up to date
    context.updatedAt = new Date();
    await this.memoryManager.storeEpicContext(context);
  }

  /**
   * Restore epic context from memory
   *
   * @param epicId - Epic identifier
   * @returns Restored epic context (as MemoryEpicContext)
   */
  async restoreContext(epicId: string): Promise<MemoryEpicContext> {
    if (!this.initialized) {
      await this.initialize();
    }

    const context = await this.memoryManager.loadEpicContext(epicId);
    if (!context) {
      throw new Error(`Epic context ${epicId} not found`);
    }

    // Restore state machine with state from metadata or derived from status
    const storedState = context.metadata?.state as StateMachineEpicState | undefined;
    const epicState = storedState || this.statusToState(context.status);

    if (!this.stateMachines.has(epicId)) {
      const stateMachine = new EpicStateMachine({
        initialState: epicState,
      });
      this.stateMachines.set(epicId, stateMachine);
    }

    // Restore epic in cache
    const epic: Epic = {
      id: context.epicId,
      epicId: context.epicId,
      name: context.title,
      description: context.description,
      state: epicState,
      createdAt: context.createdAt,
      updatedAt: context.updatedAt,
      metadata: context.metadata,
    };
    this.epics.set(epicId, epic);

    return context;
  }

  /**
   * Clear epic context from memory
   *
   * @param epicId - Epic identifier
   */
  async clearContext(epicId: string): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    await this.memoryManager.deleteEpic(epicId);
    this.epics.delete(epicId);
    this.stateMachines.delete(epicId);
  }

  // ===== SPARC INTEGRATION =====

  /**
   * Export SPARC specification to epic
   *
   * @param spec - SPARC specification
   * @returns Export result
   */
  async exportSpecToEpic(spec: SimpleSparcSpec): Promise<SimpleExportResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // Create epic from SPARC spec
      const epic = await this.createEpic(spec.title, {
        metadata: {
          description: spec.description,
          source: 'sparc',
          requirements: spec.requirements,
          technicalStack: spec.technicalStack,
          ...spec.metadata,
        },
      });

      // Load context and update with SPARC data
      const context = await this.memoryManager.loadEpicContext(epic.epicId);
      if (context) {
        // Store SPARC data in the context fields
        context.objectives = spec.requirements;
        context.constraints = spec.constraints;
        context.metadata = {
          ...context.metadata,
          technicalStack: spec.technicalStack || [],
        };
        context.updatedAt = new Date();

        await this.memoryManager.storeEpicContext(context);
      }

      return {
        success: true,
        epicId: epic.epicId,
        epic,
        tasksCreated: 0, // Would create tasks from requirements in full implementation
      };
    } catch (error) {
      return {
        success: false,
        epicId: '',
        epic: {} as Epic,
        tasksCreated: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ===== UTILITY METHODS =====

  /**
   * Get statistics for an epic
   *
   * @param epicId - Epic identifier
   */
  async getEpicStats(epicId: string) {
    if (!this.initialized) {
      await this.initialize();
    }

    return await this.memoryManager.getEpicStats(epicId);
  }

  /**
   * Export epic data
   *
   * @param epicId - Epic identifier
   */
  async exportEpic(epicId: string) {
    if (!this.initialized) {
      await this.initialize();
    }

    return await this.memoryManager.exportEpic(epicId);
  }

  /**
   * Shutdown the manager
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    // Stop project sync if running
    if (this.projectBridge) {
      this.projectBridge.stopSync();
    }

    await this.memoryManager.shutdown();
    this.stateMachines.clear();
    this.epics.clear();
    this.initialized = false;
  }

  // ===== GITHUB PROJECTS INTEGRATION =====

  /**
   * Get the GitHub Projects bridge
   * Returns null if GitHub is not configured
   */
  getProjectBridge(): CtoFlowProjectBridge | null {
    return this.projectBridge;
  }

  /**
   * Create a task in an epic's GitHub Project
   *
   * @param epicId - Epic identifier
   * @param title - Task title
   * @param description - Task description
   * @param options - Additional options (labels, priority)
   * @returns Issue number and project item ID
   */
  async createEpicTask(
    epicId: string,
    title: string,
    description: string,
    options?: { labels?: string[]; priority?: string }
  ): Promise<{ issueNumber: number; itemId: string } | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.projectBridge) {
      return null;
    }

    const epic = await this.getEpic(epicId);
    if (!epic) {
      throw new Error(`Epic ${epicId} not found`);
    }

    return await this.projectBridge.addTaskToEpic(
      epicId,
      title,
      description,
      options?.labels,
      options?.priority
    );
  }

  /**
   * Get progress of an epic from its GitHub Project
   *
   * @param epicId - Epic identifier
   * @returns Progress statistics
   */
  async getEpicProgress(epicId: string): Promise<{
    total: number;
    completed: number;
    inProgress: number;
    blocked: number;
    percentage: number;
    statusCounts: Record<string, number>;
  } | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.projectBridge) {
      return null;
    }

    try {
      return await this.projectBridge.getEpicProgress(epicId);
    } catch {
      return null;
    }
  }

  /**
   * Get available issues for agent self-selection
   *
   * @param agentCapabilities - Agent's capabilities
   * @param agentDomains - Agent's domain expertise
   * @returns List of available issues
   */
  async getAvailableIssuesForAgent(
    agentCapabilities: string[],
    agentDomains: string[]
  ): Promise<IssueForSelection[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.projectBridge) {
      return [];
    }

    return await this.projectBridge.getAvailableIssuesForAgent(
      agentCapabilities,
      agentDomains
    );
  }

  /**
   * Assign an agent to an issue
   *
   * @param agentId - Agent identifier
   * @param agentType - Agent type
   * @param issueNumber - GitHub issue number
   * @param epicId - Epic identifier
   * @param score - Assignment score
   * @returns Assignment record
   */
  async assignAgentToIssue(
    agentId: string,
    agentType: string,
    issueNumber: number,
    epicId: string,
    score: number
  ): Promise<AgentIssueAssignment | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.projectBridge) {
      return null;
    }

    return await this.projectBridge.assignAgentToIssue(
      agentId,
      agentType,
      issueNumber,
      epicId,
      score
    );
  }

  /**
   * Link a PR to an issue in an epic's project
   *
   * @param prNumber - Pull request number
   * @param issueNumber - Issue number
   * @param epicId - Epic identifier
   */
  async linkPRToIssue(
    prNumber: number,
    issueNumber: number,
    epicId: string
  ): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.projectBridge) {
      throw new Error('GitHub Projects not configured');
    }

    await this.projectBridge.linkPRToIssue(prNumber, issueNumber, epicId);
  }

  /**
   * Handle PR merge - closes linked issues and updates project status
   *
   * @param prNumber - Pull request number
   * @param closedIssues - Issue numbers closed by the PR
   */
  async handlePRMerge(prNumber: number, closedIssues: number[]): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.projectBridge) {
      return;
    }

    await this.projectBridge.handlePRMerge(prNumber, closedIssues);
  }

  /**
   * Start automatic synchronization with GitHub Projects
   */
  startProjectSync(): void {
    if (this.projectBridge) {
      this.projectBridge.startSync();
    }
  }

  /**
   * Stop automatic synchronization with GitHub Projects
   */
  stopProjectSync(): void {
    if (this.projectBridge) {
      this.projectBridge.stopSync();
    }
  }

  // ===== STATUS =====

  /**
   * Get the current status of CTO-Flow mode
   *
   * @returns Status object with enabled state, active epics, and total agents
   */
  async getStatus(): Promise<{
    enabled: boolean;
    activeEpics: number;
    totalAgents: number;
    configValid: boolean;
    githubConfigured: boolean;
  }> {
    const validation = this.configManager.validateConfig();

    return {
      enabled: this.configManager.isCtoFlowModeEnabled(),
      activeEpics: this.epics.size,
      totalAgents: this.assignments.size,
      configValid: validation.valid,
      githubConfigured: this.configManager.isGitHubConfigured(),
    };
  }
}

// ===== CONVENIENCE FUNCTIONS =====

/**
 * Create a CtoFlowManager instance with optional configuration
 *
 * @param config - Optional configuration overrides
 * @returns Configured CtoFlowManager instance
 */
export function createCtoFlowManager(config?: Partial<CoreCtoFlowConfig>): CtoFlowManager {
  return new CtoFlowManager(config);
}

/**
 * Execute an action with CTO-Flow mode if enabled, otherwise use fallback
 *
 * @param action - Action to execute if CTO-Flow mode is enabled
 * @param fallback - Fallback value if CTO-Flow mode is disabled
 * @returns Action result or fallback value
 */
export async function withCtoFlowMode<T>(
  action: () => Promise<T>,
  fallback: T
): Promise<T> {
  const manager = createCtoFlowManager();
  await manager.initialize();

  if (manager.canUse()) {
    try {
      return await action();
    } finally {
      await manager.shutdown();
    }
  }

  return fallback;
}

// ===== RE-EXPORT REAL IMPLEMENTATIONS =====

/**
 * Agent Scorer - 6-factor scoring algorithm for intelligent agent assignment
 * Factors: capability (40%), performance (20%), availability (20%), specialization (10%), experience (10%)
 */
export {
  RealAgentScorer as AgentScorer,
  createDefaultScorer,
  createCustomScorer,
  createCapabilityFocusedScorer,
  createAvailabilityFocusedScorer,
  createPerformanceFocusedScorer,
  SCORER_DEFAULT_WEIGHTS,
  DEFAULT_SKILL_SYNONYMS,
  SCORER_MINIMUM_THRESHOLD,
};

export type {
  AgentCapabilities,
  AgentWorkload,
  TaskRequirements,
  AgentInfo,
  ScoreBreakdown,
  ScoringWeights,
  SkillSynonyms,
};

/**
 * Epic Sync Service - Bidirectional GitHub sync with conflict resolution
 */
export { RealEpicSyncService as EpicSyncService };

export type {
  SparcSpecification,
  UserStory,
  Risk,
  SparcPhase,
  EpicIssue,
  ChildIssue,
  EpicExportResult,
  GitHubConfig,
  EpicSyncConfig,
  GitHubWebhookEvent,
  ConflictResolution,
  IMemoryManager,
};

/**
 * Epic Hooks - Lifecycle hooks for epic-related events
 */
export {
  realRegisterEpicHooks as registerEpicHooks,
  unregisterEpicHooks,
  PreEpicHook,
  PostEpicPhaseHook,
  PostSpecificationHook,
};

export type {
  PreEpicPayload,
  PostEpicPhasePayload,
  PostSpecificationPayload,
};

/**
 * Epic Work Hooks - Hooks for hive-mind agent work lifecycle
 * Handles issue claiming, work completion, and failure handling
 */
export {
  registerEpicWorkHooks,
  unregisterEpicWorkHooks,
  triggerWorkComplete,
  PreWorkHook,
  PostWorkHook,
  WorkFailedHook,
};

export type {
  PreWorkPayload,
  PostWorkPayload,
  WorkFailedPayload,
};

/**
 * Post-SPARC Hook - Auto-create epics from SPARC planning output
 * Triggers when SPARC planning completes, parses output, and creates GitHub epic
 */
export {
  registerPostSparcHook,
  unregisterPostSparcHook,
  handleSparcComplete,
  PostSparcHook,
};

export type {
  SparcOutput,
  PostSparcPayload,
  CreatedTask,
};

/**
 * Post-Work PR Hook - Auto-create PRs and update issues after work completion
 * Creates PR, links to issue, updates status, and tracks epic progress
 */
export {
  registerPostWorkHook,
  unregisterPostWorkHook,
  handleWorkComplete,
  PostWorkPRHook,
};

export type {
  WorkOutput,
  PostWorkPRPayload,
  PostWorkPRResult,
};

/**
 * Post-Review Hook - Handle review completion and auto-create follow-up tasks
 * Processes reviewer feedback, updates status, and creates issues for fixes
 */
export {
  registerPostReviewHook,
  unregisterPostReviewHook,
  handleReviewComplete,
  PostReviewHook,
};

export type {
  ReviewResult,
  ReviewerResult,
  CriticalIssue,
  PostReviewPayload,
  FollowUpTask,
};

/**
 * SPARC to Epic Parser - Extract structured epic data from SPARC output
 * Parses specifications, architecture, and refinement phases into tasks
 */
export {
  parseSparcOutput,
  extractTasks,
  detectDependencies,
  convertToSparcSpecification,
};

export type {
  ParsedEpic,
  ParsedTask,
};

/**
 * Worker Configuration - Local/Codespace/Hybrid execution modes
 * Controls where and how tasks are executed
 */
export {
  getWorkerConfig,
  setWorkerMode,
  shouldUseCodespace,
  getDefaultWorkerConfig,
  validateWorkerConfig,
  WorkerConfigManager,
  DEFAULT_WORKER_CONFIG,
};

export type {
  WorkerMode,
  WorkerConfig,
  WorkerTaskContext,
  LocalWorkerConfig,
  HybridWorkerConfig,
  WorkerConfigValidationResult,
};

/**
 * Codespace Worker - GitHub Codespaces task execution
 * Executes tasks in isolated codespace environments with agentic-flow
 */
export {
  CodespaceWorker,
  createCodespaceWorker,
  DEFAULT_CODESPACE_CONFIG,
};

export type {
  CodespaceWorkerConfig,
  TaskExecutionContext,
  CodespaceState,
  TaskExecutionResult,
  ProgressCallback,
};

/**
 * Advanced Task Routing - Intelligent local/codespace task distribution
 * Routes tasks based on 12 default factors including GPU, security, memory, duration
 */
export {
  AdvancedTaskRouter,
  getRouter,
  createRouter,
  routeTask,
  createTaskProfile,
  DEFAULT_ROUTING_RULES,
};

export type {
  RoutingDecision,
  TaskProfile,
  RoutingRule,
  TaskType,
  ResourceRequirements,
  RoutingFactor,
  RoutingContext,
};

/**
 * Progress Tracker - Epic velocity and health monitoring
 * Tracks task completion velocity, calculates estimates, and monitors health
 */
export {
  ProgressTracker,
  createProgressTracker,
};

export type {
  ProgressTrackerConfig,
  EpicProgressState,
  TaskProgressEntry,
  VelocityMetrics,
  HealthStatus,
  HealthCategory,
  ProgressWebhook,
};

/**
 * GitHub Projects Integration - Full project lifecycle management
 */
export {
  CtoFlowProjectBridge,
  createCtoFlowProjectBridge,
  DEFAULT_PROJECT_CONFIG,
  GitHubProjectManager,
  createUserProjectManager,
  createOrgProjectManager,
  DEFAULT_STATUS_OPTIONS,
  DEFAULT_STATUS_MAPPING,
  STATUS_COLORS,
};

export type {
  CtoFlowProjectConfig,
  EpicProjectMapping,
  AgentIssueAssignment,
  IssueForSelection,
  GitHubProject,
  ProjectField,
  ProjectFieldOption,
  ProjectItem,
  ProjectConfig,
  CreateProjectOptions,
  AddItemOptions,
  ProjectSyncState,
};

/**
 * GitHub Octokit Client - Direct GitHub API access
 */
export {
  OctokitClient,
  createOctokitClient,
} from './github/octokit-client.js';

export type {
  GitHubClientConfig,
  ProjectV2,
  IssueData,
  CreateProjectResult,
  CreateIssueResult,
} from './github/octokit-client.js';

/**
 * AgentDB Epic Memory - Vector-enhanced memory with semantic search
 */
export {
  AgentDBEpicMemory,
  createAgentDBEpicMemory,
  VECTOR_NAMESPACES,
} from './memory/agentdb-epic-memory.js';

export type {
  VectorSearchResult,
  AgentProfile as VectorAgentProfile,
  PerformanceMetric,
  TaskEmbedding,
  SimilarityMatch,
  AgentDBEpicConfig,
} from './memory/agentdb-epic-memory.js';

/**
 * Hive-Mind GitHub Orchestrator - Unified project lifecycle management
 */
export {
  HiveMindGitHubOrchestrator,
  createHiveMindOrchestrator,
  SPARC_PHASES,
  DEFAULT_PROJECT_STATUSES,
} from './integration/hive-mind-github.js';

export type {
  HiveMindConfig,
  SparcPhase as HiveMindSparcPhase,
  EpicPlan,
  TaskPlan,
  CreatedEpic,
  CreatedTask,
} from './integration/hive-mind-github.js';

/**
 * GitHub Webhook Server - Real-time issue assignment detection
 * Listens for GitHub webhook events to detect agent assignments
 */
export {
  GitHubWebhookServer,
  createWebhookServer,
  startWebhookServer,
  getWebhookSetupInstructions,
};

export type {
  WebhookConfig,
  GitHubWebhookPayload,
  AssignmentEvent,
  IssueClosedEvent,
  WebhookEvent,
};

// Track registration state
let epicCommandsRegistered = false;

/**
 * Register epic CLI commands with claude-flow
 *
 * CLI commands are registered via src/cli/commands/teammate.ts which is
 * imported and initialized by the main CLI entry point. This function
 * provides a programmatic hook for custom integrations that may want
 * to verify or trigger command registration.
 *
 * @returns true if commands are now registered, false if already registered
 */
export function registerEpicCommands(): boolean {
  if (epicCommandsRegistered) {
    return false;
  }
  // Commands are registered via static import in src/cli/commands/index.ts
  // This function marks that registration has been acknowledged
  epicCommandsRegistered = true;
  return true;
}

/**
 * Check if epic CLI commands have been registered
 *
 * @returns true if registerEpicCommands() has been called
 */
export function areEpicCommandsRegistered(): boolean {
  return epicCommandsRegistered;
}

// ===== DEFAULT EXPORT =====

export default CtoFlowManager;
