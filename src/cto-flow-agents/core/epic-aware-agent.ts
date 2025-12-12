/**
 * Epic-Aware Agent - Agent with Epic Integration Capabilities
 *
 * Extends base agent functionality with epic-awareness, enabling:
 * - Epic context caching and management
 * - Issue claiming with 6-factor scoring algorithm
 * - Progress reporting and synchronization
 * - Reviewer workflow coordination
 * - GitHub integration for issue management
 *
 * Part of the CTO-Flow Agent Management system.
 */

import { EventEmitter } from 'events';
import type {
  EpicContext,
  Task,
  Assignment,
  AgentProfile,
  AgentScore,
  TaskStatus,
  AgentAvailability,
  DEFAULT_SCORING_WEIGHTS,
  MINIMUM_SCORE_THRESHOLD,
  AgentPerformance,
} from './types.js';
import type { EpicMemoryManager, TaskProgress } from '../memory/epic-memory-manager.js';

/**
 * Epic role types for agents
 */
export type EpicRole = 'coordinator' | 'developer' | 'reviewer' | null;

/**
 * Issue claim result with scoring details
 */
export interface ClaimResult {
  success: boolean;
  score: AgentScore;
  assignmentId?: string;
  reason?: string;
}

/**
 * Progress update payload
 */
export interface ProgressUpdate {
  progress: number;
  status: TaskStatus;
  notes?: string;
  blockers?: string[];
  timeSpent?: number;
}

/**
 * Review request payload
 */
export interface ReviewRequest {
  epicId: string;
  issueNumber: number;
  prUrl?: string;
  reviewType: 'code' | 'design' | 'architecture' | 'testing';
  priority: 'low' | 'medium' | 'high' | 'critical';
  notes?: string;
}

/**
 * Agent configuration for epic awareness
 */
export interface EpicAwareAgentConfig {
  id: string;
  profile: AgentProfile;
  memoryManager: EpicMemoryManager;
  githubClient?: any;
  scoringWeights?: typeof DEFAULT_SCORING_WEIGHTS;
  minimumScoreThreshold?: number;
  autoReviewEnabled?: boolean;
  maxConcurrentEpics?: number;
}

/**
 * Cached epic context with metadata
 */
interface CachedEpicContext {
  context: EpicContext;
  cachedAt: Date;
  lastAccessedAt: Date;
  accessCount: number;
}

/**
 * EpicAwareAgent - Agent with Epic Integration
 *
 * Core capabilities:
 * - Claim issues from epics based on capability scoring
 * - Maintain epic context cache for performance
 * - Report progress to memory and GitHub
 * - Coordinate with reviewers
 * - Manage epic role assignments
 */
export class EpicAwareAgent extends EventEmitter {
  // Core identity
  private readonly id: string;
  private readonly profile: AgentProfile;

  // Epic state
  private currentEpicId: string | null = null;
  private epicRole: EpicRole = null;
  private epicContextCache: Map<string, CachedEpicContext> = new Map();

  // Dependencies
  private readonly memoryManager: EpicMemoryManager;
  private readonly githubClient: any;

  // Configuration
  private readonly scoringWeights: typeof DEFAULT_SCORING_WEIGHTS;
  private readonly minimumScoreThreshold: number;
  private readonly autoReviewEnabled: boolean;
  private readonly maxConcurrentEpics: number;

  // State tracking
  private activeAssignments: Map<string, Assignment> = new Map();
  private completedTaskCount = 0;
  private isInitialized = false;

  constructor(config: EpicAwareAgentConfig) {
    super();

    this.id = config.id;
    this.profile = config.profile;
    this.memoryManager = config.memoryManager;
    this.githubClient = config.githubClient;
    this.scoringWeights = config.scoringWeights || DEFAULT_SCORING_WEIGHTS;
    this.minimumScoreThreshold = config.minimumScoreThreshold || MINIMUM_SCORE_THRESHOLD;
    this.autoReviewEnabled = config.autoReviewEnabled ?? false;
    this.maxConcurrentEpics = config.maxConcurrentEpics || 3;
  }

  /**
   * Initialize the epic-aware agent
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    await this.memoryManager.initialize();
    this.isInitialized = true;
    this.emit('initialized', { agentId: this.id });
  }

  /**
   * Shutdown the agent gracefully
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    // Release all active assignments
    for (const [taskKey, assignment] of this.activeAssignments) {
      const [epicId, issueNumber] = taskKey.split(':');
      await this.releaseIssue(epicId, parseInt(issueNumber, 10));
    }

    this.epicContextCache.clear();
    this.isInitialized = false;
    this.emit('shutdown', { agentId: this.id });
  }

  /**
   * Claim an issue from an epic using 6-factor scoring
   *
   * Scoring factors:
   * 1. Capability Match (40%) - Agent has required capabilities
   * 2. Performance History (20%) - Past performance on similar tasks
   * 3. Availability (20%) - Current workload and capacity
   * 4. Specialization (10%) - Domain expertise alignment
   * 5. Experience (10%) - Overall experience level
   * 6. Context Relevance (bonus) - Familiarity with epic context
   *
   * @param epicId - Epic identifier
   * @param issueNumber - GitHub issue number
   * @returns Claim result with scoring details
   */
  async claimIssue(epicId: string, issueNumber: number): Promise<ClaimResult> {
    try {
      // Load epic context
      const epicContext = await this.loadEpicContext(epicId);
      if (!epicContext) {
        return {
          success: false,
          score: this.createEmptyScore(issueNumber.toString()),
          reason: 'Epic context not found',
        };
      }

      // Find task in epic
      const task = epicContext.tasks.get(issueNumber.toString());
      if (!task) {
        return {
          success: false,
          score: this.createEmptyScore(issueNumber.toString()),
          reason: 'Task not found in epic',
        };
      }

      // Check if task is already assigned
      if (task.assignedAgentId && task.assignedAgentId !== this.id) {
        return {
          success: false,
          score: this.createEmptyScore(issueNumber.toString()),
          reason: 'Task already assigned to another agent',
        };
      }

      // Calculate match score
      const score = await this.calculateMatchScore(task, epicContext);

      // Check threshold
      if (score.totalScore < this.minimumScoreThreshold) {
        this.emit('claim:rejected', {
          agentId: this.id,
          epicId,
          issueNumber,
          score: score.totalScore,
          threshold: this.minimumScoreThreshold,
        });

        return {
          success: false,
          score,
          reason: `Score ${score.totalScore.toFixed(1)} below threshold ${this.minimumScoreThreshold}`,
        };
      }

      // Create assignment
      const assignment: Assignment = {
        id: `${epicId}:${issueNumber}:${this.id}`,
        taskId: task.id,
        agentId: this.id,
        epicId,
        assignedAt: new Date(),
        score: score.totalScore,
        status: 'ASSIGNED' as TaskStatus,
      };

      // Record in memory
      await this.memoryManager.recordAgentAssignment({
        agentId: this.id,
        epicId,
        role: this.epicRole || 'developer',
        assignedAt: assignment.assignedAt,
        assignedBy: 'self',
        responsibilities: task.requiredCapabilities,
        permissions: ['read', 'write', 'comment'],
        taskIds: [task.id],
        status: 'active',
        metadata: {
          score: score.totalScore,
          scoreBreakdown: score.breakdown,
          issueNumber,
        },
      });

      // Update task in memory
      task.assignedAgentId = this.id;
      task.status = 'ASSIGNED' as TaskStatus;
      task.updatedAt = new Date();

      // Track assignment locally
      const assignmentKey = `${epicId}:${issueNumber}`;
      this.activeAssignments.set(assignmentKey, assignment);

      // Update GitHub issue if client available
      if (this.githubClient && typeof this.githubClient.assignIssue === 'function') {
        await this.githubClient.assignIssue(issueNumber, this.id);
      }

      // Set current epic if not set
      if (!this.currentEpicId) {
        this.currentEpicId = epicId;
        await this.onEpicAssigned(epicId);
      }

      this.emit('issue:claimed', {
        agentId: this.id,
        epicId,
        issueNumber,
        score: score.totalScore,
        assignmentId: assignment.id,
      });

      return {
        success: true,
        score,
        assignmentId: assignment.id,
      };
    } catch (error) {
      this.emit('error', {
        operation: 'claimIssue',
        agentId: this.id,
        epicId,
        issueNumber,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        score: this.createEmptyScore(issueNumber.toString()),
        reason: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Release an issue assignment
   *
   * @param epicId - Epic identifier
   * @param issueNumber - Issue number to release
   */
  async releaseIssue(epicId: string, issueNumber: number): Promise<void> {
    try {
      const assignmentKey = `${epicId}:${issueNumber}`;
      const assignment = this.activeAssignments.get(assignmentKey);

      if (!assignment) {
        return; // Not assigned to this agent
      }

      // Update agent assignment status in memory
      await this.memoryManager.updateAgentStatus(epicId, this.id, 'completed');

      // Update GitHub issue if client available
      if (this.githubClient && typeof this.githubClient.unassignIssue === 'function') {
        await this.githubClient.unassignIssue(issueNumber, this.id);
      }

      // Remove from active assignments
      this.activeAssignments.delete(assignmentKey);

      this.emit('issue:released', {
        agentId: this.id,
        epicId,
        issueNumber,
        assignmentId: assignment.id,
      });
    } catch (error) {
      this.emit('error', {
        operation: 'releaseIssue',
        agentId: this.id,
        epicId,
        issueNumber,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Load epic context with caching
   *
   * @param epicId - Epic identifier
   * @returns Epic context or null if not found
   */
  async loadEpicContext(epicId: string): Promise<EpicContext | null> {
    try {
      // Check cache first
      const cached = this.epicContextCache.get(epicId);
      if (cached) {
        // Update access metadata
        cached.lastAccessedAt = new Date();
        cached.accessCount++;

        // Cache is valid for 5 minutes
        const cacheAge = Date.now() - cached.cachedAt.getTime();
        if (cacheAge < 5 * 60 * 1000) {
          this.emit('context:cache:hit', { epicId, age: cacheAge });
          return cached.context;
        }
      }

      // Load from memory
      const context = await this.memoryManager.loadEpicContext(epicId);
      if (!context) {
        return null;
      }

      // Cache the context
      this.epicContextCache.set(epicId, {
        context,
        cachedAt: new Date(),
        lastAccessedAt: new Date(),
        accessCount: cached ? cached.accessCount + 1 : 1,
      });

      // Maintain cache size (max 10 epics)
      if (this.epicContextCache.size > 10) {
        const oldestKey = this.findOldestCacheKey();
        if (oldestKey) {
          this.epicContextCache.delete(oldestKey);
        }
      }

      await this.onContextUpdated(context);

      this.emit('context:loaded', { epicId });
      return context;
    } catch (error) {
      this.emit('error', {
        operation: 'loadEpicContext',
        agentId: this.id,
        epicId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Report progress on an issue
   *
   * @param epicId - Epic identifier
   * @param issueNumber - Issue number
   * @param progress - Progress update payload
   */
  async reportProgress(
    epicId: string,
    issueNumber: number,
    progress: ProgressUpdate
  ): Promise<void> {
    try {
      const assignmentKey = `${epicId}:${issueNumber}`;
      const assignment = this.activeAssignments.get(assignmentKey);

      if (!assignment) {
        throw new Error('No active assignment found for this issue');
      }

      // Update task progress in memory
      const existingProgress = await this.memoryManager.getTaskProgress(
        epicId,
        issueNumber.toString()
      );

      const taskProgress: TaskProgress = {
        taskId: issueNumber.toString(),
        epicId,
        title: existingProgress?.title || `Issue #${issueNumber}`,
        status: progress.status || 'IN_PROGRESS',
        progress: progress.progress,
        assignedTo: this.id,
        startedAt: existingProgress?.startedAt || assignment.startedAt || new Date(),
        estimatedHours: existingProgress?.estimatedHours,
        actualHours: progress.timeSpent,
        blockers: progress.blockers,
        dependencies: existingProgress?.dependencies || [],
        checkpoints: [
          ...(existingProgress?.checkpoints || []),
          {
            id: `checkpoint-${Date.now()}`,
            timestamp: new Date(),
            progress: progress.progress,
            notes: progress.notes || '',
            recordedBy: this.id,
          },
        ],
        metadata: {
          issueNumber,
          lastUpdate: new Date().toISOString(),
        },
      };

      if (progress.status === 'COMPLETED') {
        taskProgress.completedAt = new Date();
        this.completedTaskCount++;
      }

      await this.memoryManager.trackTaskProgress(taskProgress);

      // Update assignment status
      assignment.status = progress.status;
      if (progress.status === 'COMPLETED') {
        assignment.completedAt = new Date();
      }

      // Sync to GitHub issue if client available
      if (this.githubClient && typeof this.githubClient.updateIssue === 'function') {
        const comment = this.formatProgressComment(progress);
        await this.githubClient.addIssueComment(issueNumber, comment);

        // Update labels based on status
        const labels = this.getLabelsForStatus(progress.status);
        await this.githubClient.updateIssueLabels(issueNumber, labels);
      }

      this.emit('progress:reported', {
        agentId: this.id,
        epicId,
        issueNumber,
        progress: progress.progress,
        status: progress.status,
      });

      // Trigger issue completed hook if finished
      if (progress.status === 'COMPLETED') {
        await this.onIssueCompleted(issueNumber);
      }
    } catch (error) {
      this.emit('error', {
        operation: 'reportProgress',
        agentId: this.id,
        epicId,
        issueNumber,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Request review for an issue
   *
   * @param epicId - Epic identifier
   * @param issueNumber - Issue number to review
   */
  async requestReview(epicId: string, issueNumber: number): Promise<void> {
    try {
      const assignmentKey = `${epicId}:${issueNumber}`;
      const assignment = this.activeAssignments.get(assignmentKey);

      if (!assignment) {
        throw new Error('No active assignment found for this issue');
      }

      // Update task status to review
      await this.reportProgress(epicId, issueNumber, {
        progress: 100,
        status: 'REVIEW' as TaskStatus,
        notes: 'Ready for review',
      });

      // Find reviewer agents from epic
      const epicContext = await this.loadEpicContext(epicId);
      const reviewers = epicContext
        ? Array.from(epicContext.agents.values()).filter(
            (agent) =>
              agent.capabilities.includes('code-review') &&
              agent.id !== this.id &&
              agent.availability === 'AVAILABLE'
          )
        : [];

      // Request review via GitHub if client available
      if (this.githubClient && typeof this.githubClient.requestReview === 'function') {
        const reviewerIds = reviewers.map((r) => r.id);
        if (reviewerIds.length > 0) {
          await this.githubClient.requestReview(issueNumber, reviewerIds);
        }
      }

      this.emit('review:requested', {
        agentId: this.id,
        epicId,
        issueNumber,
        reviewers: reviewers.map((r) => r.id),
      });
    } catch (error) {
      this.emit('error', {
        operation: 'requestReview',
        agentId: this.id,
        epicId,
        issueNumber,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ===== LIFECYCLE HOOKS =====

  /**
   * Called when agent is assigned to an epic
   *
   * @param epicId - Epic identifier
   */
  protected async onEpicAssigned(epicId: string): Promise<void> {
    this.currentEpicId = epicId;

    // Load and cache epic context
    await this.loadEpicContext(epicId);

    this.emit('epic:assigned', { agentId: this.id, epicId });
  }

  /**
   * Called when an issue is completed
   *
   * @param issueNumber - Completed issue number
   */
  protected async onIssueCompleted(issueNumber: number): Promise<void> {
    this.emit('issue:completed', {
      agentId: this.id,
      issueNumber,
      totalCompleted: this.completedTaskCount,
    });

    // Update agent performance metrics
    await this.updatePerformanceMetrics(issueNumber);
  }

  /**
   * Called when epic context is updated
   *
   * @param context - Updated epic context
   */
  protected async onContextUpdated(context: EpicContext): Promise<void> {
    this.emit('context:updated', {
      agentId: this.id,
      epicId: context.epicId,
      state: context.state,
    });
  }

  // ===== SCORING ALGORITHM =====

  /**
   * Calculate 6-factor match score for a task
   *
   * @param task - Task to score
   * @param epicContext - Epic context for additional scoring
   * @returns Agent score with breakdown
   */
  private async calculateMatchScore(
    task: Task,
    epicContext: EpicContext
  ): Promise<AgentScore> {
    const breakdown = {
      capabilityMatch: this.calculateCapabilityMatch(task),
      performanceHistory: this.calculatePerformanceScore(task),
      availability: this.calculateAvailabilityScore(),
      specialization: this.calculateSpecializationScore(task),
      experience: this.calculateExperienceScore(),
    };

    const totalScore =
      breakdown.capabilityMatch * this.scoringWeights.capabilityMatch +
      breakdown.performanceHistory * this.scoringWeights.performanceHistory +
      breakdown.availability * this.scoringWeights.availability +
      breakdown.specialization * this.scoringWeights.specialization +
      breakdown.experience * this.scoringWeights.experience;

    return {
      agentId: this.id,
      taskId: task.id,
      totalScore,
      breakdown,
      weights: this.scoringWeights,
      meetsThreshold: totalScore >= this.minimumScoreThreshold,
      calculatedAt: new Date(),
      metadata: {
        epicId: epicContext.epicId,
        taskPriority: task.priority,
        requiredCapabilities: task.requiredCapabilities,
      },
    };
  }

  /**
   * Calculate capability match score (0-100)
   */
  private calculateCapabilityMatch(task: Task): number {
    const requiredCaps = new Set(task.requiredCapabilities);
    const agentCaps = new Set(this.profile.capabilities);

    if (requiredCaps.size === 0) {
      return 100; // No specific requirements
    }

    let matchCount = 0;
    for (const cap of requiredCaps) {
      if (agentCaps.has(cap)) {
        matchCount++;
      }
    }

    return (matchCount / requiredCaps.size) * 100;
  }

  /**
   * Calculate performance history score (0-100)
   */
  private calculatePerformanceScore(task: Task): number {
    if (this.profile.performanceHistory.length === 0) {
      return 60; // Neutral score for new agents
    }

    // Calculate average quality score from recent performance
    const recentPerformance = this.profile.performanceHistory.slice(-10);
    const avgQuality =
      recentPerformance.reduce((sum, p) => sum + p.qualityScore, 0) /
      recentPerformance.length;

    return avgQuality * 100;
  }

  /**
   * Calculate availability score (0-100)
   */
  private calculateAvailabilityScore(): number {
    const currentLoad = this.activeAssignments.size;
    const maxLoad = this.profile.maxConcurrentTasks;

    if (currentLoad >= maxLoad) {
      return 0; // No capacity
    }

    const loadFactor = currentLoad / maxLoad;
    return (1 - loadFactor) * 100;
  }

  /**
   * Calculate specialization score (0-100)
   */
  private calculateSpecializationScore(task: Task): number {
    const taskCaps = new Set(task.requiredCapabilities);
    const specializations = new Set(this.profile.specializations);

    let matchCount = 0;
    for (const cap of taskCaps) {
      if (specializations.has(cap)) {
        matchCount++;
      }
    }

    if (taskCaps.size === 0) {
      return 50; // Neutral if no specific requirements
    }

    return (matchCount / taskCaps.size) * 100;
  }

  /**
   * Calculate experience score (0-100)
   */
  private calculateExperienceScore(): number {
    return Math.min(this.profile.experienceLevel * 10, 100);
  }

  // ===== HELPER METHODS =====

  /**
   * Create empty score for failed claims
   */
  private createEmptyScore(taskId: string): AgentScore {
    return {
      agentId: this.id,
      taskId,
      totalScore: 0,
      breakdown: {
        capabilityMatch: 0,
        performanceHistory: 0,
        availability: 0,
        specialization: 0,
        experience: 0,
      },
      weights: this.scoringWeights,
      meetsThreshold: false,
      calculatedAt: new Date(),
      metadata: {},
    };
  }

  /**
   * Find oldest cache key for eviction
   */
  private findOldestCacheKey(): string | null {
    let oldestKey: string | null = null;
    let oldestTime = Date.now();

    for (const [key, cached] of this.epicContextCache) {
      if (cached.lastAccessedAt.getTime() < oldestTime) {
        oldestTime = cached.lastAccessedAt.getTime();
        oldestKey = key;
      }
    }

    return oldestKey;
  }

  /**
   * Format progress comment for GitHub
   */
  private formatProgressComment(progress: ProgressUpdate): string {
    const lines = [
      `**Progress Update by ${this.profile.name}**`,
      ``,
      `- Progress: ${progress.progress}%`,
      `- Status: ${progress.status}`,
    ];

    if (progress.notes) {
      lines.push(`- Notes: ${progress.notes}`);
    }

    if (progress.blockers && progress.blockers.length > 0) {
      lines.push(`- Blockers:`);
      progress.blockers.forEach((blocker) => lines.push(`  - ${blocker}`));
    }

    if (progress.timeSpent) {
      lines.push(`- Time Spent: ${progress.timeSpent}h`);
    }

    return lines.join('\n');
  }

  /**
   * Get GitHub labels for task status
   */
  private getLabelsForStatus(status: TaskStatus): string[] {
    const statusLabels: Record<TaskStatus, string[]> = {
      PENDING: ['status:pending'],
      ASSIGNED: ['status:assigned'],
      IN_PROGRESS: ['status:in-progress'],
      BLOCKED: ['status:blocked', 'needs-attention'],
      REVIEW: ['status:review', 'needs-review'],
      COMPLETED: ['status:completed'],
      FAILED: ['status:failed', 'needs-attention'],
    };

    return statusLabels[status] || [];
  }

  /**
   * Update agent performance metrics
   */
  private async updatePerformanceMetrics(issueNumber: number): Promise<void> {
    // This would integrate with the performance tracking system
    // For now, emit an event for external tracking
    this.emit('metrics:update', {
      agentId: this.id,
      issueNumber,
      completedTaskCount: this.completedTaskCount,
      timestamp: new Date(),
    });
  }

  // ===== PUBLIC ACCESSORS =====

  /**
   * Get agent ID
   */
  getId(): string {
    return this.id;
  }

  /**
   * Get agent profile
   */
  getProfile(): AgentProfile {
    return this.profile;
  }

  /**
   * Get current epic ID
   */
  getCurrentEpicId(): string | null {
    return this.currentEpicId;
  }

  /**
   * Get current epic role
   */
  getEpicRole(): EpicRole {
    return this.epicRole;
  }

  /**
   * Set epic role
   */
  setEpicRole(role: EpicRole): void {
    this.epicRole = role;
    this.emit('role:changed', { agentId: this.id, role });
  }

  /**
   * Get active assignments count
   */
  getActiveAssignmentCount(): number {
    return this.activeAssignments.size;
  }

  /**
   * Get completed task count
   */
  getCompletedTaskCount(): number {
    return this.completedTaskCount;
  }

  /**
   * Check if agent is available for new assignments
   */
  isAvailable(): boolean {
    return (
      this.profile.availability === 'AVAILABLE' &&
      this.activeAssignments.size < this.profile.maxConcurrentTasks
    );
  }

  /**
   * Get cached epic context (if available)
   */
  getCachedEpicContext(epicId: string): EpicContext | null {
    const cached = this.epicContextCache.get(epicId);
    return cached ? cached.context : null;
  }

  /**
   * Clear epic context cache
   */
  clearCache(epicId?: string): void {
    if (epicId) {
      this.epicContextCache.delete(epicId);
    } else {
      this.epicContextCache.clear();
    }
    this.emit('cache:cleared', { agentId: this.id, epicId });
  }
}

// ===== FACTORY FUNCTION =====

/**
 * Create an Epic-Aware Agent instance
 *
 * @param config - Agent configuration
 * @returns Initialized EpicAwareAgent
 */
export async function createEpicAwareAgent(
  config: EpicAwareAgentConfig
): Promise<EpicAwareAgent> {
  const agent = new EpicAwareAgent(config);
  await agent.initialize();
  return agent;
}

// ===== DEFAULT EXPORT =====

export default EpicAwareAgent;
