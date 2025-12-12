/**
 * Epic Progress Tracker
 *
 * Comprehensive progress tracking system for epics with:
 * - Real-time progress metrics
 * - Velocity calculation (tasks per day)
 * - Completion prediction using historical velocity
 * - Health status monitoring (healthy, at-risk, blocked)
 * - Progress webhooks and notifications
 * - Integration with EpicMemoryManager for persistence
 *
 * @module tracking/progress-tracker
 */

import { EventEmitter } from 'events';
import type { EpicMemoryManager, TaskProgress } from '../memory/epic-memory-manager.js';

// ============================================================================
// Type Definitions
// ============================================================================

export interface EpicProgress {
  epicId: string;
  title: string;
  totalTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  blockedTasks: number;
  pendingTasks: number;
  percentage: number;
  estimatedCompletion?: Date;
  velocity: number; // tasks per day
  health: 'healthy' | 'at-risk' | 'blocked';
  lastUpdated: Date;
  trends: {
    velocityTrend: 'increasing' | 'stable' | 'decreasing';
    completionRate: number; // percentage per day
    averageTaskDuration: number; // hours
  };
  milestones: MilestoneProgress[];
}

export interface MilestoneProgress {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  dueDate?: Date;
  completedAt?: Date;
  tasksTotal: number;
  tasksCompleted: number;
  percentage: number;
  isOverdue: boolean;
}

export interface TaskMetrics {
  taskId: string;
  issueNumber?: number;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked';
  assignedAgent?: string;
  startedAt?: Date;
  completedAt?: Date;
  duration?: number; // hours
  estimatedHours?: number;
  actualHours?: number;
  reviewRounds: number;
  blockers: string[];
  checkpoints: number;
  velocity: number; // percentage completion per day
}

export interface VelocityMetrics {
  currentVelocity: number; // tasks per day
  averageVelocity: number; // over last 7 days
  peakVelocity: number;
  trend: 'increasing' | 'stable' | 'decreasing';
  samples: Array<{
    date: Date;
    tasksCompleted: number;
    velocity: number;
  }>;
}

export interface ProgressReport {
  epic: EpicProgress;
  tasks: TaskMetrics[];
  velocity: VelocityMetrics;
  recommendations: string[];
  warnings: string[];
  celebratory: string[];
  generatedAt: Date;
}

export interface ProgressWebhook {
  url: string;
  events: Array<'task_completed' | 'milestone_reached' | 'epic_completed' | 'health_changed' | 'velocity_changed'>;
  enabled: boolean;
}

export interface ProgressNotificationConfig {
  webhooks: ProgressWebhook[];
  emailEnabled: boolean;
  slackEnabled: boolean;
  thresholds: {
    velocityDropPercent: number; // Alert if velocity drops by this percent
    healthDegradation: boolean; // Alert on health status change
    milestoneApproaching: number; // Days before milestone due
    blockedTaskDuration: number; // Hours before alerting on blocked tasks
  };
}

// ============================================================================
// Progress Tracker Class
// ============================================================================

export class ProgressTracker extends EventEmitter {
  private memoryManager: EpicMemoryManager;
  private notificationConfig: ProgressNotificationConfig;
  private progressCache: Map<string, EpicProgress> = new Map();
  private velocityCache: Map<string, VelocityMetrics> = new Map();

  constructor(
    memoryManager: EpicMemoryManager,
    notificationConfig?: Partial<ProgressNotificationConfig>
  ) {
    super();
    this.memoryManager = memoryManager;
    this.notificationConfig = {
      webhooks: [],
      emailEnabled: false,
      slackEnabled: false,
      thresholds: {
        velocityDropPercent: 30,
        healthDegradation: true,
        milestoneApproaching: 3,
        blockedTaskDuration: 24
      },
      ...notificationConfig
    };
  }

  // ==========================================================================
  // Progress Tracking
  // ==========================================================================

  /**
   * Get current epic progress with all metrics
   */
  async getEpicProgress(epicId: string): Promise<EpicProgress> {
    // Check cache first
    const cached = this.progressCache.get(epicId);
    if (cached && this.isCacheFresh(cached.lastUpdated)) {
      return cached;
    }

    // Load epic context
    const context = await this.memoryManager.loadEpicContext(epicId);
    if (!context) {
      throw new Error(`Epic not found: ${epicId}`);
    }

    // Load all tasks
    const tasks = await this.memoryManager.getEpicTasks(epicId);

    // Calculate task counts
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => t.status === 'completed').length;
    const inProgressTasks = tasks.filter(t => t.status === 'in_progress').length;
    const blockedTasks = tasks.filter(t => t.status === 'blocked').length;
    const pendingTasks = tasks.filter(t => t.status === 'pending').length;

    // Calculate percentage
    const percentage = totalTasks > 0
      ? Math.round((completedTasks / totalTasks) * 100)
      : 0;

    // Calculate velocity
    const velocity = await this.calculateVelocity(epicId);

    // Predict completion
    const estimatedCompletion = this.predictCompletion(
      totalTasks - completedTasks,
      velocity.currentVelocity
    );

    // Determine health status
    const health = this.determineHealthStatus(
      blockedTasks,
      velocity.trend,
      totalTasks,
      estimatedCompletion,
      context.milestones
    );

    // Calculate trends
    const trends = this.calculateTrends(tasks, velocity);

    // Process milestone progress
    const milestones = await this.calculateMilestoneProgress(context.milestones, tasks);

    const progress: EpicProgress = {
      epicId,
      title: context.title,
      totalTasks,
      completedTasks,
      inProgressTasks,
      blockedTasks,
      pendingTasks,
      percentage,
      estimatedCompletion,
      velocity: velocity.currentVelocity,
      health,
      lastUpdated: new Date(),
      trends,
      milestones
    };

    // Cache the result
    this.progressCache.set(epicId, progress);

    // Emit progress event
    this.emit('progress:calculated', { epicId, progress });

    return progress;
  }

  /**
   * Update task status and recalculate progress
   */
  async updateTaskStatus(
    epicId: string,
    taskId: string,
    status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked',
    metadata?: {
      reviewRounds?: number;
      blockers?: string[];
      actualHours?: number;
    }
  ): Promise<EpicProgress> {
    // Get current task
    const task = await this.memoryManager.getTaskProgress(epicId, taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const previousStatus = task.status;

    // Update task status
    task.status = status;

    if (status === 'completed' && !task.completedAt) {
      task.completedAt = new Date();

      // Calculate actual duration if started
      if (task.startedAt) {
        const durationMs = task.completedAt.getTime() - task.startedAt.getTime();
        task.actualHours = durationMs / (1000 * 60 * 60);
      }
    }

    if (status === 'in_progress' && !task.startedAt) {
      task.startedAt = new Date();
    }

    if (status === 'blocked') {
      task.blockers = metadata?.blockers || task.blockers || [];
    }

    if (metadata?.actualHours !== undefined) {
      task.actualHours = metadata.actualHours;
    }

    // Save updated task
    await this.memoryManager.trackTaskProgress(task);

    // Invalidate cache
    this.progressCache.delete(epicId);
    this.velocityCache.delete(epicId);

    // Recalculate progress
    const progress = await this.getEpicProgress(epicId);

    // Emit status change event
    this.emit('task:statusChanged', {
      epicId,
      taskId,
      previousStatus,
      newStatus: status,
      progress
    });

    // Check for notification triggers
    await this.checkNotificationTriggers(epicId, status, previousStatus, progress);

    return progress;
  }

  /**
   * Calculate velocity (tasks completed per day)
   */
  async calculateVelocity(epicId: string): Promise<VelocityMetrics> {
    // Check cache
    const cached = this.velocityCache.get(epicId);
    if (cached) {
      return cached;
    }

    const tasks = await this.memoryManager.getEpicTasks(epicId);
    const completedTasks = tasks.filter(t => t.status === 'completed' && t.completedAt);

    if (completedTasks.length === 0) {
      const emptyMetrics: VelocityMetrics = {
        currentVelocity: 0,
        averageVelocity: 0,
        peakVelocity: 0,
        trend: 'stable',
        samples: []
      };
      this.velocityCache.set(epicId, emptyMetrics);
      return emptyMetrics;
    }

    // Group completions by day
    const completionsByDay = new Map<string, number>();

    for (const task of completedTasks) {
      if (!task.completedAt) continue;

      const dateKey = task.completedAt.toISOString().split('T')[0];
      completionsByDay.set(dateKey, (completionsByDay.get(dateKey) || 0) + 1);
    }

    // Calculate daily velocities
    const samples = Array.from(completionsByDay.entries())
      .map(([dateStr, count]) => ({
        date: new Date(dateStr),
        tasksCompleted: count,
        velocity: count // tasks per day
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    // Current velocity (last 3 days average)
    const recentSamples = samples.slice(-3);
    const currentVelocity = recentSamples.length > 0
      ? recentSamples.reduce((sum, s) => sum + s.velocity, 0) / recentSamples.length
      : 0;

    // Average velocity (last 7 days)
    const last7Days = samples.slice(-7);
    const averageVelocity = last7Days.length > 0
      ? last7Days.reduce((sum, s) => sum + s.velocity, 0) / last7Days.length
      : currentVelocity;

    // Peak velocity
    const peakVelocity = Math.max(...samples.map(s => s.velocity), 0);

    // Determine trend
    let trend: 'increasing' | 'stable' | 'decreasing' = 'stable';
    if (samples.length >= 2) {
      const recent = samples.slice(-3).reduce((sum, s) => sum + s.velocity, 0) / 3;
      const previous = samples.slice(-6, -3).reduce((sum, s) => sum + s.velocity, 0) / 3;

      if (recent > previous * 1.2) {
        trend = 'increasing';
      } else if (recent < previous * 0.8) {
        trend = 'decreasing';
      }
    }

    const metrics: VelocityMetrics = {
      currentVelocity,
      averageVelocity,
      peakVelocity,
      trend,
      samples
    };

    this.velocityCache.set(epicId, metrics);
    return metrics;
  }

  /**
   * Predict epic completion date based on velocity
   */
  predictCompletion(remainingTasks: number, velocity: number): Date | undefined {
    if (velocity <= 0 || remainingTasks <= 0) {
      return undefined;
    }

    const daysRemaining = remainingTasks / velocity;
    const completionDate = new Date();
    completionDate.setDate(completionDate.getDate() + Math.ceil(daysRemaining));

    return completionDate;
  }

  /**
   * Determine epic health status
   */
  private determineHealthStatus(
    blockedTasks: number,
    velocityTrend: 'increasing' | 'stable' | 'decreasing',
    totalTasks: number,
    estimatedCompletion: Date | undefined,
    milestones: any[]
  ): 'healthy' | 'at-risk' | 'blocked' {
    // Blocked if any tasks are blocked
    if (blockedTasks > 0) {
      return 'blocked';
    }

    // At-risk if velocity is decreasing
    if (velocityTrend === 'decreasing') {
      return 'at-risk';
    }

    // At-risk if estimated completion is past any milestone
    if (estimatedCompletion && milestones.length > 0) {
      for (const milestone of milestones) {
        if (milestone.dueDate && milestone.status !== 'completed') {
          const dueDate = new Date(milestone.dueDate);
          if (estimatedCompletion > dueDate) {
            return 'at-risk';
          }
        }
      }
    }

    // At-risk if blocked percentage is high
    const blockedPercent = (blockedTasks / totalTasks) * 100;
    if (blockedPercent > 20) {
      return 'at-risk';
    }

    return 'healthy';
  }

  /**
   * Get health status for an epic
   */
  async getHealthStatus(epicId: string): Promise<{
    status: 'healthy' | 'at-risk' | 'blocked';
    reasons: string[];
    recommendations: string[];
  }> {
    const progress = await this.getEpicProgress(epicId);
    const reasons: string[] = [];
    const recommendations: string[] = [];

    if (progress.health === 'blocked') {
      reasons.push(`${progress.blockedTasks} task(s) are currently blocked`);
      recommendations.push('Review and resolve blockers immediately');
      recommendations.push('Consider reassigning blocked tasks if blockers persist');
    }

    if (progress.health === 'at-risk') {
      if (progress.trends.velocityTrend === 'decreasing') {
        reasons.push('Velocity is decreasing');
        recommendations.push('Review team capacity and adjust workload');
        recommendations.push('Identify and remove impediments to task completion');
      }

      if (progress.estimatedCompletion) {
        for (const milestone of progress.milestones) {
          if (milestone.dueDate && !milestone.completedAt) {
            const dueDate = new Date(milestone.dueDate);
            if (progress.estimatedCompletion > dueDate) {
              reasons.push(`Milestone "${milestone.title}" may miss deadline`);
              recommendations.push(`Prioritize tasks for milestone: ${milestone.title}`);
            }
          }
        }
      }

      const blockedPercent = (progress.blockedTasks / progress.totalTasks) * 100;
      if (blockedPercent > 10) {
        reasons.push(`${blockedPercent.toFixed(0)}% of tasks are blocked`);
        recommendations.push('High percentage of blocked tasks requires attention');
      }
    }

    if (progress.health === 'healthy' && reasons.length === 0) {
      reasons.push('Epic is progressing well');
      reasons.push(`Current velocity: ${progress.velocity.toFixed(1)} tasks/day`);
      reasons.push(`${progress.percentage}% complete`);
    }

    return {
      status: progress.health,
      reasons,
      recommendations
    };
  }

  /**
   * Generate full progress report
   */
  async generateProgressReport(epicId: string): Promise<ProgressReport> {
    const progress = await this.getEpicProgress(epicId);
    const velocity = await this.calculateVelocity(epicId);
    const tasks = await this.memoryManager.getEpicTasks(epicId);

    // Build task metrics
    const taskMetrics: TaskMetrics[] = tasks.map(task => {
      let duration: number | undefined;
      if (task.startedAt && task.completedAt) {
        duration = (task.completedAt.getTime() - task.startedAt.getTime()) / (1000 * 60 * 60);
      }

      // Calculate task velocity (percentage per day)
      let taskVelocity = 0;
      if (task.startedAt) {
        const daysElapsed = (new Date().getTime() - task.startedAt.getTime()) / (1000 * 60 * 60 * 24);
        taskVelocity = daysElapsed > 0 ? (task.progress / daysElapsed) : 0;
      }

      return {
        taskId: task.taskId,
        title: task.title,
        status: task.status,
        assignedAgent: task.assignedTo,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        duration,
        estimatedHours: task.estimatedHours,
        actualHours: task.actualHours,
        reviewRounds: task.checkpoints.length,
        blockers: task.blockers || [],
        checkpoints: task.checkpoints.length,
        velocity: taskVelocity
      };
    });

    // Generate recommendations
    const recommendations: string[] = [];
    const warnings: string[] = [];
    const celebratory: string[] = [];

    // Health-based recommendations
    const healthStatus = await this.getHealthStatus(epicId);
    recommendations.push(...healthStatus.recommendations);

    // Velocity recommendations
    if (velocity.trend === 'decreasing') {
      warnings.push('⚠️ Velocity is trending downward');
      recommendations.push('Review team capacity and identify bottlenecks');
    } else if (velocity.trend === 'increasing') {
      celebratory.push('🎉 Velocity is improving!');
    }

    // Progress milestones
    if (progress.percentage >= 25 && progress.percentage < 50) {
      celebratory.push('✨ Epic is 25% complete!');
    } else if (progress.percentage >= 50 && progress.percentage < 75) {
      celebratory.push('🚀 Epic is halfway done!');
    } else if (progress.percentage >= 75 && progress.percentage < 100) {
      celebratory.push('🎯 Epic is 75% complete - almost there!');
    } else if (progress.percentage === 100) {
      celebratory.push('🎊 Epic complete! Excellent work!');
    }

    // Blocked tasks warnings
    if (progress.blockedTasks > 0) {
      warnings.push(`🚫 ${progress.blockedTasks} task(s) are blocked`);
    }

    // Long-running tasks
    const longRunningTasks = taskMetrics.filter(t =>
      t.status === 'in_progress' &&
      t.startedAt &&
      (new Date().getTime() - t.startedAt.getTime()) > (7 * 24 * 60 * 60 * 1000)
    );
    if (longRunningTasks.length > 0) {
      warnings.push(`⏰ ${longRunningTasks.length} task(s) have been in progress for over 7 days`);
      recommendations.push('Review long-running tasks for potential blockers');
    }

    // Estimate accuracy
    const completedWithEstimates = taskMetrics.filter(t =>
      t.status === 'completed' && t.estimatedHours && t.actualHours
    );
    if (completedWithEstimates.length > 0) {
      const avgAccuracy = completedWithEstimates.reduce((sum, t) => {
        const accuracy = Math.min(t.estimatedHours!, t.actualHours!) / Math.max(t.estimatedHours!, t.actualHours!);
        return sum + accuracy;
      }, 0) / completedWithEstimates.length;

      if (avgAccuracy < 0.7) {
        warnings.push('📊 Time estimates are frequently off by >30%');
        recommendations.push('Review estimation process and improve accuracy');
      }
    }

    return {
      epic: progress,
      tasks: taskMetrics,
      velocity,
      recommendations,
      warnings,
      celebratory,
      generatedAt: new Date()
    };
  }

  // ==========================================================================
  // Milestone Progress
  // ==========================================================================

  /**
   * Calculate progress for each milestone
   */
  private async calculateMilestoneProgress(
    milestones: any[],
    tasks: TaskProgress[]
  ): Promise<MilestoneProgress[]> {
    return milestones.map(milestone => {
      // Tasks associated with this milestone would need to be tagged
      // For now, we'll distribute tasks evenly across milestones
      const milestoneTasks = tasks; // In real impl, filter by milestone

      const tasksTotal = milestoneTasks.length;
      const tasksCompleted = milestoneTasks.filter(t => t.status === 'completed').length;
      const percentage = tasksTotal > 0 ? Math.round((tasksCompleted / tasksTotal) * 100) : 0;

      const isOverdue = milestone.dueDate
        ? new Date(milestone.dueDate) < new Date() && milestone.status !== 'completed'
        : false;

      return {
        id: milestone.id,
        title: milestone.title,
        status: milestone.status,
        dueDate: milestone.dueDate ? new Date(milestone.dueDate) : undefined,
        completedAt: milestone.completedAt ? new Date(milestone.completedAt) : undefined,
        tasksTotal,
        tasksCompleted,
        percentage,
        isOverdue
      };
    });
  }

  // ==========================================================================
  // Trends & Analytics
  // ==========================================================================

  /**
   * Calculate progress trends
   */
  private calculateTrends(tasks: TaskProgress[], velocity: VelocityMetrics) {
    const completedTasks = tasks.filter(t => t.status === 'completed');

    // Calculate average task duration
    const tasksWithDuration = completedTasks.filter(t =>
      t.startedAt && t.completedAt
    );

    const averageTaskDuration = tasksWithDuration.length > 0
      ? tasksWithDuration.reduce((sum, t) => {
          const duration = (t.completedAt!.getTime() - t.startedAt!.getTime()) / (1000 * 60 * 60);
          return sum + duration;
        }, 0) / tasksWithDuration.length
      : 0;

    // Calculate completion rate (percentage per day)
    const completionRate = velocity.currentVelocity > 0 && tasks.length > 0
      ? (velocity.currentVelocity / tasks.length) * 100
      : 0;

    return {
      velocityTrend: velocity.trend,
      completionRate,
      averageTaskDuration
    };
  }

  // ==========================================================================
  // Notifications & Webhooks
  // ==========================================================================

  /**
   * Check if any notification triggers should fire
   */
  private async checkNotificationTriggers(
    epicId: string,
    newStatus: string,
    previousStatus: string,
    progress: EpicProgress
  ): Promise<void> {
    // Task completed
    if (newStatus === 'completed' && previousStatus !== 'completed') {
      await this.sendNotification(epicId, 'task_completed', {
        progress,
        message: `Task completed! Epic is now ${progress.percentage}% complete`
      });
    }

    // Milestone reached
    if (progress.percentage === 25 || progress.percentage === 50 ||
        progress.percentage === 75 || progress.percentage === 100) {
      await this.sendNotification(epicId, 'milestone_reached', {
        progress,
        message: `Milestone: ${progress.percentage}% complete!`
      });
    }

    // Epic completed
    if (progress.percentage === 100) {
      await this.sendNotification(epicId, 'epic_completed', {
        progress,
        message: 'Epic completed! 🎉'
      });
    }

    // Velocity changed significantly
    const velocity = await this.calculateVelocity(epicId);
    if (velocity.trend === 'decreasing') {
      const dropPercent = ((velocity.averageVelocity - velocity.currentVelocity) / velocity.averageVelocity) * 100;
      if (dropPercent >= this.notificationConfig.thresholds.velocityDropPercent) {
        await this.sendNotification(epicId, 'velocity_changed', {
          progress,
          velocity,
          message: `Warning: Velocity has dropped by ${dropPercent.toFixed(0)}%`
        });
      }
    }
  }

  /**
   * Send notification to configured webhooks
   */
  private async sendNotification(
    epicId: string,
    event: ProgressWebhook['events'][number],
    data: any
  ): Promise<void> {
    const enabledWebhooks = this.notificationConfig.webhooks.filter(
      wh => wh.enabled && wh.events.includes(event)
    );

    for (const webhook of enabledWebhooks) {
      try {
        // In production, this would make HTTP requests
        this.emit('webhook:triggered', {
          epicId,
          event,
          url: webhook.url,
          data
        });
      } catch (error) {
        this.emit('webhook:error', { webhook, error });
      }
    }

    // Emit event for internal listeners
    this.emit('notification:sent', { epicId, event, data });
  }

  /**
   * Add a webhook
   */
  addWebhook(webhook: ProgressWebhook): void {
    this.notificationConfig.webhooks.push(webhook);
    this.emit('webhook:added', { webhook });
  }

  /**
   * Remove a webhook
   */
  removeWebhook(url: string): void {
    const index = this.notificationConfig.webhooks.findIndex(wh => wh.url === url);
    if (index >= 0) {
      const removed = this.notificationConfig.webhooks.splice(index, 1)[0];
      this.emit('webhook:removed', { webhook: removed });
    }
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Check if cached data is still fresh (5 minutes)
   */
  private isCacheFresh(lastUpdated: Date): boolean {
    const cacheLifetime = 5 * 60 * 1000; // 5 minutes
    return (new Date().getTime() - lastUpdated.getTime()) < cacheLifetime;
  }

  /**
   * Clear all caches
   */
  clearCache(epicId?: string): void {
    if (epicId) {
      this.progressCache.delete(epicId);
      this.velocityCache.delete(epicId);
    } else {
      this.progressCache.clear();
      this.velocityCache.clear();
    }
    this.emit('cache:cleared', { epicId });
  }

  /**
   * Get task metrics for a specific task
   */
  async getTaskMetrics(epicId: string, taskId: string): Promise<TaskMetrics | null> {
    const task = await this.memoryManager.getTaskProgress(epicId, taskId);
    if (!task) return null;

    let duration: number | undefined;
    if (task.startedAt && task.completedAt) {
      duration = (task.completedAt.getTime() - task.startedAt.getTime()) / (1000 * 60 * 60);
    }

    let taskVelocity = 0;
    if (task.startedAt) {
      const daysElapsed = (new Date().getTime() - task.startedAt.getTime()) / (1000 * 60 * 60 * 24);
      taskVelocity = daysElapsed > 0 ? (task.progress / daysElapsed) : 0;
    }

    return {
      taskId: task.taskId,
      title: task.title,
      status: task.status,
      assignedAgent: task.assignedTo,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      duration,
      estimatedHours: task.estimatedHours,
      actualHours: task.actualHours,
      reviewRounds: task.checkpoints.length,
      blockers: task.blockers || [],
      checkpoints: task.checkpoints.length,
      velocity: taskVelocity
    };
  }

  /**
   * Export progress data
   */
  async exportProgressData(epicId: string): Promise<{
    progress: EpicProgress;
    velocity: VelocityMetrics;
    tasks: TaskMetrics[];
  }> {
    const progress = await this.getEpicProgress(epicId);
    const velocity = await this.calculateVelocity(epicId);
    const tasks = await this.memoryManager.getEpicTasks(epicId);

    const taskMetrics: TaskMetrics[] = [];
    for (const task of tasks) {
      const metrics = await this.getTaskMetrics(epicId, task.taskId);
      if (metrics) {
        taskMetrics.push(metrics);
      }
    }

    return {
      progress,
      velocity,
      tasks: taskMetrics
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a ProgressTracker instance
 */
export function createProgressTracker(
  memoryManager: EpicMemoryManager,
  notificationConfig?: Partial<ProgressNotificationConfig>
): ProgressTracker {
  return new ProgressTracker(memoryManager, notificationConfig);
}

export default ProgressTracker;
