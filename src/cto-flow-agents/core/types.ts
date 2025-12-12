/**
 * CTO-Flow Agent Management System - Core Types
 *
 * Implements Epic state machine, context management, and 6-factor agent scoring
 * based on SPARC specification for claude-flow.
 */

/**
 * Epic State Machine - 6 states with defined transitions
 *
 * State transitions:
 * UNINITIALIZED → ACTIVE (epic creation)
 * ACTIVE ⟷ PAUSED (manual pause/resume)
 * ACTIVE → BLOCKED (dependency/error blocking)
 * BLOCKED → ACTIVE (unblock resolution)
 * ACTIVE → REVIEW (all tasks completed)
 * REVIEW → ACTIVE (changes requested)
 * REVIEW → COMPLETED (approval)
 * COMPLETED → ARCHIVED (archival)
 */
export enum EpicState {
  UNINITIALIZED = 'UNINITIALIZED',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  BLOCKED = 'BLOCKED',
  REVIEW = 'REVIEW',
  COMPLETED = 'COMPLETED',
  ARCHIVED = 'ARCHIVED'
}

/**
 * Valid state transitions for Epic state machine
 */
export const EPIC_STATE_TRANSITIONS: Record<EpicState, EpicState[]> = {
  [EpicState.UNINITIALIZED]: [EpicState.ACTIVE],
  [EpicState.ACTIVE]: [EpicState.PAUSED, EpicState.BLOCKED, EpicState.REVIEW],
  [EpicState.PAUSED]: [EpicState.ACTIVE],
  [EpicState.BLOCKED]: [EpicState.ACTIVE],
  [EpicState.REVIEW]: [EpicState.ACTIVE, EpicState.COMPLETED],
  [EpicState.COMPLETED]: [EpicState.ARCHIVED],
  [EpicState.ARCHIVED]: []
};

/**
 * Task priority levels
 */
export enum TaskPriority {
  CRITICAL = 'CRITICAL',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW'
}

/**
 * Task status in workflow
 */
export enum TaskStatus {
  PENDING = 'PENDING',
  ASSIGNED = 'ASSIGNED',
  IN_PROGRESS = 'IN_PROGRESS',
  BLOCKED = 'BLOCKED',
  REVIEW = 'REVIEW',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED'
}

/**
 * Agent availability status
 */
export enum AgentAvailability {
  AVAILABLE = 'AVAILABLE',
  BUSY = 'BUSY',
  OFFLINE = 'OFFLINE'
}

/**
 * ADR (Architectural Decision Record) status
 */
export enum ADRStatus {
  PROPOSED = 'PROPOSED',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  DEPRECATED = 'DEPRECATED',
  SUPERSEDED = 'SUPERSEDED'
}

/**
 * Task interface representing a unit of work
 */
export interface Task {
  id: string;
  epicId: string;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  requiredCapabilities: string[];
  estimatedEffort?: number;
  actualEffort?: number;
  dependencies: string[];
  assignedAgentId?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  blockedReason?: string;
  metadata: Record<string, unknown>;
}

/**
 * Agent assignment to a task
 */
export interface Assignment {
  id: string;
  taskId: string;
  agentId: string;
  epicId: string;
  assignedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  score: number;
  status: TaskStatus;
  performance?: AgentPerformance;
}

/**
 * Agent performance metrics for a specific assignment
 */
export interface AgentPerformance {
  taskId: string;
  agentId: string;
  completionTime: number;
  qualityScore: number;
  accuracy: number;
  efficiency: number;
  codeReviewScore?: number;
  testCoverage?: number;
  errorRate: number;
  timestamp: Date;
}

/**
 * 6-Factor Agent Scoring System
 *
 * Scoring weights:
 * - Capability Match: 40%
 * - Performance History: 20%
 * - Availability: 20%
 * - Specialization: 10%
 * - Experience: 10%
 *
 * Minimum threshold: 50 points (out of 100)
 */
export interface AgentScore {
  agentId: string;
  taskId: string;
  totalScore: number;
  breakdown: {
    capabilityMatch: number;
    performanceHistory: number;
    availability: number;
    specialization: number;
    experience: number;
  };
  weights: {
    capabilityMatch: number;
    performanceHistory: number;
    availability: number;
    specialization: number;
    experience: number;
  };
  meetsThreshold: boolean;
  calculatedAt: Date;
  metadata: Record<string, unknown>;
}

/**
 * Default scoring weights for 6-factor system
 */
export const DEFAULT_SCORING_WEIGHTS = {
  capabilityMatch: 0.4,
  performanceHistory: 0.2,
  availability: 0.2,
  specialization: 0.1,
  experience: 0.1
} as const;

/**
 * Minimum score threshold for agent assignment
 */
export const MINIMUM_SCORE_THRESHOLD = 50;

/**
 * Agent profile with capabilities and history
 */
export interface AgentProfile {
  id: string;
  name: string;
  type: string;
  capabilities: string[];
  specializations: string[];
  availability: AgentAvailability;
  currentLoad: number;
  maxConcurrentTasks: number;
  experienceLevel: number;
  performanceHistory: AgentPerformance[];
  assignmentHistory: Assignment[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  lastActiveAt: Date;
}

/**
 * Architectural Decision Record (ADR)
 */
export interface ADR {
  id: string;
  epicId: string;
  title: string;
  status: ADRStatus;
  context: string;
  decision: string;
  consequences: string[];
  alternatives: Array<{
    description: string;
    prosAndCons: string[];
    rejectionReason?: string;
  }>;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  supersededBy?: string;
  tags: string[];
  metadata: Record<string, unknown>;
}

/**
 * Project context stored in EpicContext
 */
export interface ProjectContext {
  goals: string[];
  constraints: string[];
  decisions: Array<{
    id: string;
    description: string;
    rationale: string;
    timestamp: Date;
  }>;
  technicalStack: string[];
  requirements: string[];
  stakeholders: string[];
  timeline?: {
    startDate: Date;
    targetDate: Date;
    milestones: Array<{
      name: string;
      date: Date;
      completed: boolean;
    }>;
  };
  metadata: Record<string, unknown>;
}

/**
 * Epic blocking reason
 */
export interface BlockingReason {
  id: string;
  description: string;
  blockedBy?: string;
  createdAt: Date;
  resolvedAt?: Date;
  resolution?: string;
}

/**
 * Epic Context - Complete state and history for an epic
 *
 * Stores:
 * - Project context (goals, constraints, decisions)
 * - Task state tracking
 * - Agent assignments
 * - ADRs (Architectural Decision Records)
 * - State machine history
 */
export interface EpicContext {
  epicId: string;
  name: string;
  description: string;
  state: EpicState;
  projectContext: ProjectContext;
  tasks: Map<string, Task>;
  assignments: Map<string, Assignment>;
  adrs: Map<string, ADR>;
  agents: Map<string, AgentProfile>;
  stateHistory: Array<{
    fromState: EpicState;
    toState: EpicState;
    timestamp: Date;
    reason?: string;
    triggeredBy?: string;
  }>;
  blockingReasons: BlockingReason[];
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  archivedAt?: Date;
  metadata: Record<string, unknown>;
}

/**
 * Epic creation parameters
 */
export interface CreateEpicParams {
  name: string;
  description: string;
  projectContext: Omit<ProjectContext, 'metadata'> & { metadata?: Record<string, unknown> };
  metadata?: Record<string, unknown>;
}

/**
 * Task creation parameters
 */
export interface CreateTaskParams {
  title: string;
  description: string;
  priority: TaskPriority;
  requiredCapabilities: string[];
  estimatedEffort?: number;
  dependencies?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * ADR creation parameters
 */
export interface CreateADRParams {
  title: string;
  context: string;
  decision: string;
  consequences: string[];
  alternatives: Array<{
    description: string;
    prosAndCons: string[];
    rejectionReason?: string;
  }>;
  createdBy: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * State transition parameters
 */
export interface StateTransitionParams {
  targetState: EpicState;
  reason?: string;
  triggeredBy?: string;
}

/**
 * Agent assignment parameters
 */
export interface AssignAgentParams {
  taskId: string;
  agentId: string;
  score: AgentScore;
}

/**
 * Teammate system configuration
 */
export interface CtoFlowConfig {
  enabled: boolean;
  maxConcurrentEpics: number;
  maxTasksPerAgent: number;
  autoAssignment: boolean;
  scoringWeights: {
    capabilityMatch: number;
    performanceHistory: number;
    availability: number;
    specialization: number;
    experience: number;
  };
  minimumScoreThreshold: number;
  enableADRTracking: boolean;
  enablePerformanceTracking: boolean;
  stateTransitionValidation: boolean;
  metadata: Record<string, unknown>;
}

/**
 * Default teammate configuration with enabled: false
 */
export const DEFAULT_CTOFLOW_CONFIG: CtoFlowConfig = {
  enabled: false,
  maxConcurrentEpics: 10,
  maxTasksPerAgent: 5,
  autoAssignment: true,
  scoringWeights: DEFAULT_SCORING_WEIGHTS,
  minimumScoreThreshold: MINIMUM_SCORE_THRESHOLD,
  enableADRTracking: true,
  enablePerformanceTracking: true,
  stateTransitionValidation: true,
  metadata: {}
};

/**
 * Epic query filters
 */
export interface EpicQueryFilter {
  state?: EpicState | EpicState[];
  createdAfter?: Date;
  createdBefore?: Date;
  hasBlockingReasons?: boolean;
  agentId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Task query filters
 */
export interface TaskQueryFilter {
  epicId?: string;
  status?: TaskStatus | TaskStatus[];
  priority?: TaskPriority | TaskPriority[];
  assignedAgentId?: string;
  hasCapability?: string;
  isBlocked?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Agent scoring context for calculating scores
 */
export interface ScoringContext {
  task: Task;
  agent: AgentProfile;
  epicContext: EpicContext;
  currentTime: Date;
  weights?: Partial<typeof DEFAULT_SCORING_WEIGHTS>;
}

/**
 * Performance metrics aggregation
 */
export interface PerformanceMetrics {
  agentId: string;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  averageCompletionTime: number;
  averageQualityScore: number;
  averageAccuracy: number;
  averageEfficiency: number;
  totalEffort: number;
  successRate: number;
  errorRate: number;
  period: {
    start: Date;
    end: Date;
  };
}

/**
 * Epic statistics
 */
export interface EpicStatistics {
  epicId: string;
  totalTasks: number;
  tasksByStatus: Record<TaskStatus, number>;
  tasksByPriority: Record<TaskPriority, number>;
  totalAgents: number;
  activeAssignments: number;
  completedAssignments: number;
  averageTaskCompletionTime: number;
  blockedTasksCount: number;
  adrCount: number;
  stateChangeCount: number;
  timeInState: Record<EpicState, number>;
  createdAt: Date;
  lastUpdatedAt: Date;
}

/**
 * Validation result for operations
 */
export interface ValidationResult {
  valid: boolean;
  errors: Array<{
    field: string;
    message: string;
    code: string;
  }>;
  warnings: Array<{
    field: string;
    message: string;
  }>;
}

/**
 * Event types for epic lifecycle
 */
export enum EpicEventType {
  EPIC_CREATED = 'EPIC_CREATED',
  EPIC_STATE_CHANGED = 'EPIC_STATE_CHANGED',
  TASK_CREATED = 'TASK_CREATED',
  TASK_ASSIGNED = 'TASK_ASSIGNED',
  TASK_COMPLETED = 'TASK_COMPLETED',
  TASK_FAILED = 'TASK_FAILED',
  TASK_BLOCKED = 'TASK_BLOCKED',
  AGENT_ASSIGNED = 'AGENT_ASSIGNED',
  AGENT_UNASSIGNED = 'AGENT_UNASSIGNED',
  ADR_CREATED = 'ADR_CREATED',
  ADR_STATUS_CHANGED = 'ADR_STATUS_CHANGED',
  BLOCKING_REASON_ADDED = 'BLOCKING_REASON_ADDED',
  BLOCKING_REASON_RESOLVED = 'BLOCKING_REASON_RESOLVED'
}

/**
 * Epic event for audit trail
 */
export interface EpicEvent {
  id: string;
  epicId: string;
  type: EpicEventType;
  timestamp: Date;
  triggeredBy?: string;
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

/**
 * Type guard to check if state transition is valid
 */
export function isValidStateTransition(from: EpicState, to: EpicState): boolean {
  return EPIC_STATE_TRANSITIONS[from].includes(to);
}

/**
 * Type guard to check if agent meets minimum score threshold
 */
export function meetsScoreThreshold(score: AgentScore, threshold: number = MINIMUM_SCORE_THRESHOLD): boolean {
  return score.totalScore >= threshold;
}

/**
 * Calculate total score from breakdown and weights
 */
export function calculateTotalScore(
  breakdown: AgentScore['breakdown'],
  weights: AgentScore['weights'] = DEFAULT_SCORING_WEIGHTS
): number {
  return (
    breakdown.capabilityMatch * weights.capabilityMatch +
    breakdown.performanceHistory * weights.performanceHistory +
    breakdown.availability * weights.availability +
    breakdown.specialization * weights.specialization +
    breakdown.experience * weights.experience
  );
}

/**
 * Validate scoring weights sum to 1.0
 */
export function validateScoringWeights(weights: AgentScore['weights']): ValidationResult {
  const errors: ValidationResult['errors'] = [];
  const warnings: ValidationResult['warnings'] = [];

  const sum = Object.values(weights).reduce((acc, val) => acc + val, 0);
  const tolerance = 0.001;

  if (Math.abs(sum - 1.0) > tolerance) {
    errors.push({
      field: 'weights',
      message: `Scoring weights must sum to 1.0, got ${sum}`,
      code: 'INVALID_WEIGHT_SUM'
    });
  }

  for (const [key, value] of Object.entries(weights)) {
    if (value < 0 || value > 1) {
      errors.push({
        field: `weights.${key}`,
        message: `Weight must be between 0 and 1, got ${value}`,
        code: 'INVALID_WEIGHT_RANGE'
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Serializable version of EpicContext (for storage/transfer)
 */
export interface SerializableEpicContext {
  epicId: string;
  name: string;
  description: string;
  state: EpicState;
  projectContext: ProjectContext;
  tasks: Array<Task>;
  assignments: Array<Assignment>;
  adrs: Array<ADR>;
  agents: Array<AgentProfile>;
  stateHistory: EpicContext['stateHistory'];
  blockingReasons: BlockingReason[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  archivedAt?: string;
  metadata: Record<string, unknown>;
}
