/**
 * Work Assignment Manager
 *
 * Coordinates agent-to-task assignments using the 6-factor scoring algorithm.
 * Implements the core assignment workflow:
 * 1. Extract issue requirements
 * 2. Score all available agents
 * 3. Select best match (score >= 50)
 * 4. Record assignment
 * 5. Notify agent
 *
 * Graceful degradation: Returns null if CTO-Flow mode is off or no suitable agent found.
 */

import {
  AgentProfile,
  AgentScore,
  Assignment,
  Task,
  EpicContext,
  TaskStatus,
  AgentAvailability,
  DEFAULT_SCORING_WEIGHTS,
  MINIMUM_SCORE_THRESHOLD,
  calculateTotalScore
} from './types';
import { CtoFlowConfigManager } from './config-manager';

/**
 * GitHub issue requirements extracted for assignment
 */
export interface IssueRequirements {
  issueNumber: number;
  title: string;
  description: string;
  labels: string[];
  requiredCapabilities: string[];
  priority: string;
  estimatedEffort?: number;
  dependencies: number[];
}

/**
 * Assignment result with agent and score details
 */
export interface AssignmentResult extends Assignment {
  agentName: string;
  scoreBreakdown: AgentScore['breakdown'];
  reason: string;
}

/**
 * Reassignment context
 */
export interface ReassignmentContext {
  previousAgentId: string;
  reason: string;
  excludedAgents: string[];
}

/**
 * Workload balance recommendation
 */
export interface WorkloadRecommendation {
  fromAgentId: string;
  toAgentId: string;
  taskId: string;
  expectedImprovement: number;
  reason: string;
}

/**
 * Workload rebalancing result
 */
export interface RebalanceResult {
  epicId: string;
  overloadedAgents: Array<{
    agentId: string;
    currentLoad: number;
    maxLoad: number;
    overloadPercentage: number;
  }>;
  underutilizedAgents: Array<{
    agentId: string;
    currentLoad: number;
    maxLoad: number;
    utilizationPercentage: number;
  }>;
  recommendations: WorkloadRecommendation[];
  balanceScore: number;
  timestamp: Date;
}

/**
 * Assignment failure reason
 */
export interface AssignmentFailure {
  reason: string;
  details: string;
  availableAgentsCount: number;
  bestScore?: number;
  minimumRequired: number;
}

/**
 * Work Assignment Manager
 *
 * Manages the complete lifecycle of work assignments from issue to agent,
 * including scoring, selection, reassignment, and workload balancing.
 */
export class WorkAssignmentManager {
  private configManager: CtoFlowConfigManager;
  private assignments: Map<string, Assignment>;
  private assignmentHistory: Array<{
    assignment: Assignment;
    timestamp: Date;
    action: 'assigned' | 'reassigned' | 'completed' | 'failed';
  }>;

  constructor() {
    this.configManager = CtoFlowConfigManager.getInstance();
    this.assignments = new Map();
    this.assignmentHistory = [];
  }

  /**
   * Assign work to the best available agent
   *
   * Workflow:
   * 1. Check if CTO-Flow mode is enabled
   * 2. Get issue requirements
   * 3. Get available agents
   * 4. Score each agent using 6-factor algorithm
   * 5. Select best match (score >= 50)
   * 6. Create and record assignment
   * 7. Return assignment or null
   *
   * @param epicId - Epic identifier
   * @param issueNumber - GitHub issue number
   * @param epicContext - Epic context with agents and tasks
   * @param issueRequirements - Extracted issue requirements
   * @returns Assignment result or null if no suitable agent
   */
  public async assignWork(
    epicId: string,
    issueNumber: number,
    epicContext: EpicContext,
    issueRequirements: IssueRequirements
  ): Promise<AssignmentResult | null> {
    // Graceful degradation: Check if CTO-Flow mode is enabled
    if (!this.configManager.isCtoFlowModeEnabled()) {
      return null;
    }

    // Get available agents
    const availableAgents = await this.getAvailableAgents(epicId, epicContext);

    if (availableAgents.length === 0) {
      return null;
    }

    // Create task from issue requirements
    const task = this.createTaskFromIssue(epicId, issueRequirements);

    // Score all available agents
    const scores = await this.scoreAgents(task, availableAgents, epicContext);

    // Select best agent (highest score >= threshold)
    const bestMatch = this.selectBestAgent(scores);

    if (!bestMatch) {
      return null;
    }

    // Create assignment
    const assignment = this.createAssignment(
      epicId,
      task.id,
      bestMatch.agentId,
      bestMatch
    );

    // Record assignment
    this.recordAssignment(assignment, 'assigned');

    // Build result
    const agent = availableAgents.find(a => a.id === bestMatch.agentId)!;
    const result: AssignmentResult = {
      ...assignment,
      agentName: agent.name,
      scoreBreakdown: bestMatch.breakdown,
      reason: `Best match with score ${bestMatch.totalScore.toFixed(1)} (threshold: ${MINIMUM_SCORE_THRESHOLD})`
    };

    return result;
  }

  /**
   * Reassign work to a different agent
   *
   * Workflow:
   * 1. Release current assignment
   * 2. Exclude previous agent from consideration
   * 3. Find next best agent
   * 4. Create new assignment with reassignment reason
   *
   * @param epicId - Epic identifier
   * @param issueNumber - GitHub issue number
   * @param reason - Reason for reassignment
   * @param epicContext - Epic context with agents and tasks
   * @param issueRequirements - Extracted issue requirements
   * @param currentAssignment - Current assignment to replace
   * @returns New assignment or null if no suitable agent
   */
  public async reassignWork(
    epicId: string,
    issueNumber: number,
    reason: string,
    epicContext: EpicContext,
    issueRequirements: IssueRequirements,
    currentAssignment: Assignment
  ): Promise<AssignmentResult | null> {
    // Graceful degradation: Check if CTO-Flow mode is enabled
    if (!this.configManager.isCtoFlowModeEnabled()) {
      return null;
    }

    // Mark current assignment as reassigned
    const updatedAssignment: Assignment = {
      ...currentAssignment,
      status: TaskStatus.FAILED,
      completedAt: new Date()
    };
    this.recordAssignment(updatedAssignment, 'reassigned');

    // Get available agents (excluding the previous agent)
    const availableAgents = await this.getAvailableAgents(epicId, epicContext, [currentAssignment.agentId]);

    if (availableAgents.length === 0) {
      return null;
    }

    // Create task from issue requirements
    const task = this.createTaskFromIssue(epicId, issueRequirements);

    // Score all available agents
    const scores = await this.scoreAgents(task, availableAgents, epicContext);

    // Select best agent
    const bestMatch = this.selectBestAgent(scores);

    if (!bestMatch) {
      return null;
    }

    // Create new assignment with reassignment metadata
    const assignment = this.createAssignment(
      epicId,
      task.id,
      bestMatch.agentId,
      bestMatch,
      {
        reassignedFrom: currentAssignment.agentId,
        reassignmentReason: reason,
        originalAssignmentId: currentAssignment.id
      }
    );

    // Record new assignment
    this.recordAssignment(assignment, 'reassigned');

    // Build result
    const agent = availableAgents.find(a => a.id === bestMatch.agentId)!;
    const result: AssignmentResult = {
      ...assignment,
      agentName: agent.name,
      scoreBreakdown: bestMatch.breakdown,
      reason: `Reassigned from ${currentAssignment.agentId} - ${reason}`
    };

    return result;
  }

  /**
   * Get available agents for an epic
   *
   * Filters agents by:
   * - Availability status
   * - Current workload vs. max capacity
   * - Epic membership
   * - Exclusion list (for reassignments)
   *
   * @param epicId - Epic identifier
   * @param epicContext - Epic context with agent profiles
   * @param excludeAgentIds - Agent IDs to exclude (optional)
   * @returns Array of available agents
   */
  public async getAvailableAgents(
    epicId: string,
    epicContext: EpicContext,
    excludeAgentIds: string[] = []
  ): Promise<AgentProfile[]> {
    const config = this.configManager.getConfig();
    const maxTasksPerAgent = config.agents.autoAssignment ? 5 : 3;

    const availableAgents: AgentProfile[] = [];

    for (const agent of epicContext.agents.values()) {
      // Skip excluded agents
      if (excludeAgentIds.includes(agent.id)) {
        continue;
      }

      // Check availability status
      if (agent.availability !== AgentAvailability.AVAILABLE) {
        continue;
      }

      // Check workload capacity
      if (agent.currentLoad >= agent.maxConcurrentTasks) {
        continue;
      }

      // Additional capacity check against configured max
      if (agent.currentLoad >= maxTasksPerAgent) {
        continue;
      }

      availableAgents.push(agent);
    }

    return availableAgents;
  }

  /**
   * Balance workload across agents in an epic
   *
   * Identifies:
   * - Overloaded agents (>80% capacity)
   * - Underutilized agents (<40% capacity)
   * - Potential reassignments to improve balance
   *
   * @param epicId - Epic identifier
   * @param epicContext - Epic context with agents and assignments
   * @returns Rebalancing result with recommendations
   */
  public async balanceWorkload(
    epicId: string,
    epicContext: EpicContext
  ): Promise<RebalanceResult> {
    const overloadedAgents: RebalanceResult['overloadedAgents'] = [];
    const underutilizedAgents: RebalanceResult['underutilizedAgents'] = [];
    const recommendations: WorkloadRecommendation[] = [];

    // Analyze each agent's workload
    for (const agent of epicContext.agents.values()) {
      const utilizationPercentage = (agent.currentLoad / agent.maxConcurrentTasks) * 100;

      if (utilizationPercentage > 80) {
        overloadedAgents.push({
          agentId: agent.id,
          currentLoad: agent.currentLoad,
          maxLoad: agent.maxConcurrentTasks,
          overloadPercentage: utilizationPercentage
        });
      } else if (utilizationPercentage < 40 && agent.availability === AgentAvailability.AVAILABLE) {
        underutilizedAgents.push({
          agentId: agent.id,
          currentLoad: agent.currentLoad,
          maxLoad: agent.maxConcurrentTasks,
          utilizationPercentage: utilizationPercentage
        });
      }
    }

    // Generate recommendations for rebalancing
    if (overloadedAgents.length > 0 && underutilizedAgents.length > 0) {
      recommendations.push(...this.generateRebalanceRecommendations(
        overloadedAgents,
        underutilizedAgents,
        epicContext
      ));
    }

    // Calculate overall balance score (0-100, higher is better)
    const balanceScore = this.calculateBalanceScore(epicContext);

    return {
      epicId,
      overloadedAgents,
      underutilizedAgents,
      recommendations,
      balanceScore,
      timestamp: new Date()
    };
  }

  /**
   * Score all agents for a task using 6-factor algorithm
   *
   * Factors:
   * 1. Capability Match (40%)
   * 2. Performance History (20%)
   * 3. Availability (20%)
   * 4. Specialization (10%)
   * 5. Experience (10%)
   *
   * @param task - Task to assign
   * @param agents - Available agents to score
   * @param epicContext - Epic context for historical data
   * @returns Array of agent scores
   */
  private async scoreAgents(
    task: Task,
    agents: AgentProfile[],
    epicContext: EpicContext
  ): Promise<AgentScore[]> {
    const config = this.configManager.getConfig();
    const weights = config.agents.autoAssignment
      ? DEFAULT_SCORING_WEIGHTS
      : {
          capabilityMatch: 0.5,
          performanceHistory: 0.15,
          availability: 0.15,
          specialization: 0.1,
          experience: 0.1
        };

    const scores: AgentScore[] = [];

    for (const agent of agents) {
      const breakdown = {
        capabilityMatch: this.scoreCapabilityMatch(task, agent),
        performanceHistory: this.scorePerformanceHistory(agent, epicContext),
        availability: this.scoreAvailability(agent),
        specialization: this.scoreSpecialization(task, agent),
        experience: this.scoreExperience(agent)
      };

      const totalScore = calculateTotalScore(breakdown, weights);
      const meetsThreshold = totalScore >= config.agents.assignmentThreshold;

      scores.push({
        agentId: agent.id,
        taskId: task.id,
        totalScore,
        breakdown,
        weights,
        meetsThreshold,
        calculatedAt: new Date(),
        metadata: {
          agentName: agent.name,
          agentType: agent.type,
          taskTitle: task.title
        }
      });
    }

    // Sort by total score descending
    scores.sort((a, b) => b.totalScore - a.totalScore);

    return scores;
  }

  /**
   * Score capability match (40% weight)
   *
   * Compares task requirements against agent capabilities.
   * Perfect match = 100, partial match = percentage of matched capabilities
   */
  private scoreCapabilityMatch(task: Task, agent: AgentProfile): number {
    if (task.requiredCapabilities.length === 0) {
      return 70; // Default score if no specific requirements
    }

    const matchedCapabilities = task.requiredCapabilities.filter(
      cap => agent.capabilities.includes(cap)
    );

    const matchPercentage = (matchedCapabilities.length / task.requiredCapabilities.length) * 100;

    return matchPercentage;
  }

  /**
   * Score performance history (20% weight)
   *
   * Based on agent's historical performance metrics:
   * - Quality score
   * - Accuracy
   * - Efficiency
   * - Error rate
   */
  private scorePerformanceHistory(agent: AgentProfile, epicContext: EpicContext): number {
    if (agent.performanceHistory.length === 0) {
      return 70; // Default score for new agents
    }

    // Calculate average metrics from recent performance
    const recentPerformance = agent.performanceHistory.slice(-10);
    const avgQuality = recentPerformance.reduce((sum, p) => sum + p.qualityScore, 0) / recentPerformance.length;
    const avgAccuracy = recentPerformance.reduce((sum, p) => sum + p.accuracy, 0) / recentPerformance.length;
    const avgEfficiency = recentPerformance.reduce((sum, p) => sum + p.efficiency, 0) / recentPerformance.length;
    const avgErrorRate = recentPerformance.reduce((sum, p) => sum + p.errorRate, 0) / recentPerformance.length;

    // Combine metrics (quality and accuracy are most important)
    const performanceScore = (
      avgQuality * 0.4 +
      avgAccuracy * 0.3 +
      avgEfficiency * 0.2 +
      (100 - avgErrorRate) * 0.1
    );

    return performanceScore;
  }

  /**
   * Score availability (20% weight)
   *
   * Based on current workload relative to capacity.
   * Lower workload = higher score
   */
  private scoreAvailability(agent: AgentProfile): number {
    if (agent.availability !== AgentAvailability.AVAILABLE) {
      return 0;
    }

    const utilizationPercentage = (agent.currentLoad / agent.maxConcurrentTasks) * 100;

    // Inverse relationship: less busy = higher score
    const availabilityScore = 100 - utilizationPercentage;

    return Math.max(0, availabilityScore);
  }

  /**
   * Score specialization (10% weight)
   *
   * Bonus points if agent specializes in areas relevant to the task
   */
  private scoreSpecialization(task: Task, agent: AgentProfile): number {
    if (agent.specializations.length === 0) {
      return 50; // Generalist baseline
    }

    // Check if any task requirements match agent specializations
    const matchedSpecializations = task.requiredCapabilities.filter(
      cap => agent.specializations.some(spec =>
        spec.toLowerCase().includes(cap.toLowerCase()) ||
        cap.toLowerCase().includes(spec.toLowerCase())
      )
    );

    if (matchedSpecializations.length > 0) {
      // Specialist bonus
      return 80 + (matchedSpecializations.length * 10);
    }

    // Generalist score
    return 50;
  }

  /**
   * Score experience (10% weight)
   *
   * Based on:
   * - Experience level (1-100)
   * - Number of completed assignments
   * - Time in system
   */
  private scoreExperience(agent: AgentProfile): number {
    const experienceScore = agent.experienceLevel || 50;

    // Bonus for proven track record
    const completedAssignments = agent.assignmentHistory.filter(
      a => a.status === TaskStatus.COMPLETED
    ).length;

    const experienceBonus = Math.min(20, completedAssignments * 2);

    return Math.min(100, experienceScore + experienceBonus);
  }

  /**
   * Select best agent from scores
   *
   * Returns the agent with the highest score that meets the threshold,
   * or null if no agent qualifies.
   */
  private selectBestAgent(scores: AgentScore[]): AgentScore | null {
    const config = this.configManager.getConfig();
    const threshold = config.agents.assignmentThreshold;

    for (const score of scores) {
      if (score.totalScore >= threshold) {
        return score;
      }
    }

    return null;
  }

  /**
   * Create task from issue requirements
   */
  private createTaskFromIssue(epicId: string, issue: IssueRequirements): Task {
    return {
      id: `task-${issue.issueNumber}`,
      epicId,
      title: issue.title,
      description: issue.description,
      priority: this.mapPriorityFromString(issue.priority),
      status: TaskStatus.PENDING,
      requiredCapabilities: issue.requiredCapabilities,
      estimatedEffort: issue.estimatedEffort,
      dependencies: issue.dependencies.map(n => `task-${n}`),
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        issueNumber: issue.issueNumber,
        labels: issue.labels
      }
    };
  }

  /**
   * Map priority string to TaskPriority enum
   */
  private mapPriorityFromString(priority: string): Task['priority'] {
    const priorityMap: Record<string, Task['priority']> = {
      'critical': 'CRITICAL' as any,
      'high': 'HIGH' as any,
      'medium': 'MEDIUM' as any,
      'low': 'LOW' as any
    };

    return priorityMap[priority.toLowerCase()] || 'MEDIUM' as any;
  }

  /**
   * Create assignment record
   */
  private createAssignment(
    epicId: string,
    taskId: string,
    agentId: string,
    score: AgentScore,
    metadata: Record<string, unknown> = {}
  ): Assignment {
    return {
      id: `assignment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      taskId,
      agentId,
      epicId,
      assignedAt: new Date(),
      score: score.totalScore,
      status: TaskStatus.ASSIGNED,
      performance: undefined
    };
  }

  /**
   * Record assignment in history
   */
  private recordAssignment(
    assignment: Assignment,
    action: 'assigned' | 'reassigned' | 'completed' | 'failed'
  ): void {
    this.assignments.set(assignment.id, assignment);
    this.assignmentHistory.push({
      assignment,
      timestamp: new Date(),
      action
    });
  }

  /**
   * Generate rebalance recommendations
   */
  private generateRebalanceRecommendations(
    overloadedAgents: RebalanceResult['overloadedAgents'],
    underutilizedAgents: RebalanceResult['underutilizedAgents'],
    epicContext: EpicContext
  ): WorkloadRecommendation[] {
    const recommendations: WorkloadRecommendation[] = [];

    for (const overloaded of overloadedAgents) {
      // Find tasks assigned to overloaded agent
      const agentAssignments = Array.from(epicContext.assignments.values())
        .filter(a => a.agentId === overloaded.agentId && a.status === TaskStatus.ASSIGNED);

      // Try to reassign lowest priority tasks
      for (const assignment of agentAssignments.slice(0, 2)) {
        for (const underutilized of underutilizedAgents) {
          const capacityAvailable = underutilized.maxLoad - underutilized.currentLoad;

          if (capacityAvailable > 0) {
            const expectedImprovement =
              (overloaded.overloadPercentage - 80) +
              (40 - underutilized.utilizationPercentage);

            recommendations.push({
              fromAgentId: overloaded.agentId,
              toAgentId: underutilized.agentId,
              taskId: assignment.taskId,
              expectedImprovement,
              reason: `Balance workload: ${overloaded.agentId} is at ${overloaded.overloadPercentage.toFixed(1)}% capacity`
            });

            break; // Only one recommendation per task
          }
        }
      }
    }

    return recommendations;
  }

  /**
   * Calculate overall workload balance score (0-100)
   *
   * Higher score = better balance
   */
  private calculateBalanceScore(epicContext: EpicContext): number {
    const agents = Array.from(epicContext.agents.values());

    if (agents.length === 0) {
      return 100;
    }

    // Calculate standard deviation of utilization percentages
    const utilizations = agents.map(a =>
      (a.currentLoad / a.maxConcurrentTasks) * 100
    );

    const mean = utilizations.reduce((sum, u) => sum + u, 0) / utilizations.length;
    const variance = utilizations.reduce((sum, u) => sum + Math.pow(u - mean, 2), 0) / utilizations.length;
    const stdDev = Math.sqrt(variance);

    // Convert std dev to balance score (lower std dev = higher score)
    // Perfect balance (stdDev = 0) = 100, high variance = lower score
    const balanceScore = Math.max(0, 100 - stdDev);

    return balanceScore;
  }

  /**
   * Get assignment by ID
   */
  public getAssignment(assignmentId: string): Assignment | undefined {
    return this.assignments.get(assignmentId);
  }

  /**
   * Get all assignments for an epic
   */
  public getEpicAssignments(epicId: string): Assignment[] {
    return Array.from(this.assignments.values())
      .filter(a => a.epicId === epicId);
  }

  /**
   * Get assignment history
   */
  public getAssignmentHistory(): typeof this.assignmentHistory {
    return [...this.assignmentHistory];
  }

  /**
   * Clear assignment data (useful for testing)
   */
  public clearAssignments(): void {
    this.assignments.clear();
    this.assignmentHistory = [];
  }
}

/**
 * Singleton instance getter
 */
let instance: WorkAssignmentManager | null = null;

export function getWorkAssignmentManager(): WorkAssignmentManager {
  if (!instance) {
    instance = new WorkAssignmentManager();
  }
  return instance;
}

/**
 * Reset singleton (useful for testing)
 */
export function resetWorkAssignmentManager(): void {
  instance = null;
}
