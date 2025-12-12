/**
 * Advanced Task Routing System
 *
 * Intelligent task routing that determines optimal execution environment
 * based on multiple factors:
 * - Task complexity and resource requirements
 * - Historical performance data
 * - Current system load
 * - Agent availability and specialization
 * - Cost optimization
 *
 * Supports routing to:
 * - Local execution (fast, low-cost)
 * - GitHub Codespaces (high-resource, isolated)
 * - Hybrid mode (intelligent switching)
 *
 * @module workers/advanced-routing
 */

import { EventEmitter } from 'events';
import type { WorkerMode, TaskContext, WorkerConfig } from './worker-config.js';
import { getWorkerConfig, shouldUseCodespace } from './worker-config.js';
import { Logger } from '../../core/logger.js';

const logger = new Logger({
  level: 'info',
  format: 'text',
  destination: 'console'
}, { prefix: 'AdvancedRouting' });

// ============================================================================
// Type Definitions
// ============================================================================

export interface RoutingDecision {
  mode: WorkerMode;
  reason: string;
  confidence: number; // 0-1
  factors: RoutingFactor[];
  alternatives: AlternativeRoute[];
  estimatedCost: number;
  estimatedDuration: number; // minutes
}

export interface RoutingFactor {
  name: string;
  weight: number;
  value: number;
  contribution: 'local' | 'codespace' | 'neutral';
  description: string;
}

export interface AlternativeRoute {
  mode: WorkerMode;
  reason: string;
  confidence: number;
  tradeoffs: string[];
}

export interface TaskProfile {
  taskId: string;
  title: string;
  type: TaskType;
  complexity: 'low' | 'medium' | 'high';
  estimatedDuration: number; // minutes
  resourceRequirements: ResourceRequirements;
  labels: string[];
  dependencies: string[];
  priority: 'low' | 'medium' | 'high' | 'critical';
  agentType?: string;
}

export type TaskType =
  | 'feature'
  | 'bugfix'
  | 'refactor'
  | 'test'
  | 'documentation'
  | 'security'
  | 'performance'
  | 'infrastructure'
  | 'research';

export interface ResourceRequirements {
  cpu: 'low' | 'medium' | 'high';
  memory: 'low' | 'medium' | 'high'; // low: <2GB, medium: 2-8GB, high: >8GB
  disk: 'low' | 'medium' | 'high';
  gpu: boolean;
  network: 'low' | 'medium' | 'high';
  isolation: boolean; // Requires isolated environment
}

export interface SystemLoad {
  cpuUsage: number; // 0-100
  memoryUsage: number; // 0-100
  activeTasks: number;
  queuedTasks: number;
  avgTaskDuration: number; // minutes
}

export interface HistoricalPerformance {
  taskType: TaskType;
  localSuccessRate: number;
  codespaceSuccessRate: number;
  localAvgDuration: number;
  codespaceAvgDuration: number;
  localFailureReasons: string[];
  codespaceFailureReasons: string[];
}

export interface RoutingRule {
  id: string;
  name: string;
  description: string;
  priority: number; // Higher = more important
  condition: (task: TaskProfile, context: RoutingContext) => boolean;
  action: 'local' | 'codespace' | 'defer';
  reason: string;
}

export interface RoutingContext {
  systemLoad: SystemLoad;
  historicalPerformance: Map<TaskType, HistoricalPerformance>;
  activeRoutes: Map<string, RoutingDecision>;
  config: WorkerConfig;
}

export interface CostEstimate {
  local: number;
  codespace: number;
  factors: {
    compute: number;
    time: number;
    failure: number;
  };
}

// ============================================================================
// Default Routing Rules
// ============================================================================

export const DEFAULT_ROUTING_RULES: RoutingRule[] = [
  // Rule 1: GPU tasks always go to Codespace
  {
    id: 'gpu-required',
    name: 'GPU Required',
    description: 'Route GPU-intensive tasks to Codespace',
    priority: 100,
    condition: (task) => task.resourceRequirements.gpu,
    action: 'codespace',
    reason: 'GPU processing required'
  },

  // Rule 2: Security-sensitive tasks need isolation
  {
    id: 'security-isolation',
    name: 'Security Isolation',
    description: 'Route security-sensitive tasks to isolated Codespace',
    priority: 95,
    condition: (task) => task.resourceRequirements.isolation || task.type === 'security',
    action: 'codespace',
    reason: 'Security isolation required'
  },

  // Rule 3: High memory tasks
  {
    id: 'high-memory',
    name: 'High Memory',
    description: 'Route memory-intensive tasks to Codespace',
    priority: 90,
    condition: (task) => task.resourceRequirements.memory === 'high',
    action: 'codespace',
    reason: 'High memory requirements (>8GB)'
  },

  // Rule 4: Long-running tasks
  {
    id: 'long-running',
    name: 'Long Running',
    description: 'Route tasks >60 minutes to Codespace for reliability',
    priority: 85,
    condition: (task) => task.estimatedDuration > 60,
    action: 'codespace',
    reason: 'Long-running task benefits from isolated environment'
  },

  // Rule 5: Documentation tasks stay local
  {
    id: 'documentation-local',
    name: 'Documentation Local',
    description: 'Keep documentation tasks local for speed',
    priority: 80,
    condition: (task) => task.type === 'documentation',
    action: 'local',
    reason: 'Documentation tasks are lightweight'
  },

  // Rule 6: Quick fixes stay local
  {
    id: 'quick-fix-local',
    name: 'Quick Fix Local',
    description: 'Keep quick fixes local',
    priority: 75,
    condition: (task) => task.labels.includes('quick-fix') || task.estimatedDuration < 10,
    action: 'local',
    reason: 'Quick task benefits from local execution speed'
  },

  // Rule 7: System overload - defer to Codespace
  {
    id: 'system-overload',
    name: 'System Overload',
    description: 'Route to Codespace when local system is overloaded',
    priority: 70,
    condition: (_, context) => context.systemLoad.cpuUsage > 80 || context.systemLoad.memoryUsage > 85,
    action: 'codespace',
    reason: 'Local system is under heavy load'
  },

  // Rule 8: Too many active tasks locally
  {
    id: 'queue-overflow',
    name: 'Queue Overflow',
    description: 'Route to Codespace when local queue is full',
    priority: 65,
    condition: (_, context) => context.systemLoad.activeTasks >= (context.config.local?.maxConcurrentTasks || 5),
    action: 'codespace',
    reason: 'Local task queue is at capacity'
  },

  // Rule 9: Research tasks benefit from isolation
  {
    id: 'research-codespace',
    name: 'Research Codespace',
    description: 'Route research tasks to Codespace for clean environment',
    priority: 60,
    condition: (task) => task.type === 'research',
    action: 'codespace',
    reason: 'Research tasks benefit from clean, isolated environment'
  },

  // Rule 10: Critical priority tasks
  {
    id: 'critical-priority',
    name: 'Critical Priority',
    description: 'Route critical tasks based on historical success rate',
    priority: 55,
    condition: (task, context) => {
      if (task.priority !== 'critical') return false;
      const history = context.historicalPerformance.get(task.type);
      if (!history) return false;
      return history.codespaceSuccessRate > history.localSuccessRate;
    },
    action: 'codespace',
    reason: 'Critical task routed to most reliable environment'
  },

  // Rule 11: Infrastructure tasks
  {
    id: 'infrastructure-codespace',
    name: 'Infrastructure Codespace',
    description: 'Route infrastructure tasks to Codespace',
    priority: 50,
    condition: (task) => task.type === 'infrastructure',
    action: 'codespace',
    reason: 'Infrastructure changes benefit from isolated testing'
  },

  // Rule 12: Default to local for efficiency
  {
    id: 'default-local',
    name: 'Default Local',
    description: 'Default to local execution for efficiency',
    priority: 0,
    condition: () => true,
    action: 'local',
    reason: 'Default routing for efficiency'
  }
];

// ============================================================================
// Advanced Router Class
// ============================================================================

export class AdvancedTaskRouter extends EventEmitter {
  private rules: RoutingRule[];
  private context: RoutingContext;
  private decisionCache: Map<string, { decision: RoutingDecision; timestamp: number }>;
  private cacheLifetime: number = 60000; // 1 minute

  constructor(customRules?: RoutingRule[]) {
    super();
    this.rules = [...DEFAULT_ROUTING_RULES, ...(customRules || [])].sort(
      (a, b) => b.priority - a.priority
    );
    this.decisionCache = new Map();

    // Initialize context with defaults
    this.context = {
      systemLoad: {
        cpuUsage: 0,
        memoryUsage: 0,
        activeTasks: 0,
        queuedTasks: 0,
        avgTaskDuration: 15
      },
      historicalPerformance: new Map(),
      activeRoutes: new Map(),
      config: getWorkerConfig()
    };
  }

  /**
   * Make a routing decision for a task
   */
  async route(task: TaskProfile): Promise<RoutingDecision> {
    // Check cache
    const cached = this.decisionCache.get(task.taskId);
    if (cached && Date.now() - cached.timestamp < this.cacheLifetime) {
      logger.debug(`Using cached routing decision for task ${task.taskId}`);
      return cached.decision;
    }

    // Update context
    await this.refreshContext();

    // Evaluate all factors
    const factors = this.evaluateFactors(task);

    // Apply rules
    const matchedRule = this.applyRules(task);

    // Calculate confidence
    const confidence = this.calculateConfidence(factors, matchedRule);

    // Get alternatives
    const alternatives = this.getAlternatives(task, matchedRule, factors);

    // Estimate cost
    const cost = this.estimateCost(task, matchedRule.action as WorkerMode);

    // Build decision
    const decision: RoutingDecision = {
      mode: matchedRule.action === 'defer' ? 'local' : matchedRule.action,
      reason: matchedRule.reason,
      confidence,
      factors,
      alternatives,
      estimatedCost: cost.local + cost.codespace,
      estimatedDuration: task.estimatedDuration
    };

    // Cache decision
    this.decisionCache.set(task.taskId, {
      decision,
      timestamp: Date.now()
    });

    // Track active route
    this.context.activeRoutes.set(task.taskId, decision);

    // Emit event
    this.emit('route:decided', { task, decision });

    logger.info(`Routed task ${task.taskId} to ${decision.mode}: ${decision.reason}`);

    return decision;
  }

  /**
   * Evaluate all routing factors for a task
   */
  private evaluateFactors(task: TaskProfile): RoutingFactor[] {
    const factors: RoutingFactor[] = [];

    // Complexity factor
    const complexityValue = task.complexity === 'high' ? 1 : task.complexity === 'medium' ? 0.5 : 0;
    factors.push({
      name: 'complexity',
      weight: 0.2,
      value: complexityValue,
      contribution: complexityValue > 0.5 ? 'codespace' : 'local',
      description: `Task complexity is ${task.complexity}`
    });

    // Duration factor
    const durationValue = Math.min(task.estimatedDuration / 120, 1); // Normalize to 0-1 (max 2 hours)
    factors.push({
      name: 'duration',
      weight: 0.15,
      value: durationValue,
      contribution: durationValue > 0.5 ? 'codespace' : 'local',
      description: `Estimated ${task.estimatedDuration} minutes`
    });

    // Resource factor
    const resourceValue = this.calculateResourceScore(task.resourceRequirements);
    factors.push({
      name: 'resources',
      weight: 0.25,
      value: resourceValue,
      contribution: resourceValue > 0.5 ? 'codespace' : 'local',
      description: `Resource requirements: CPU=${task.resourceRequirements.cpu}, Memory=${task.resourceRequirements.memory}`
    });

    // System load factor
    const loadValue = (this.context.systemLoad.cpuUsage + this.context.systemLoad.memoryUsage) / 200;
    factors.push({
      name: 'systemLoad',
      weight: 0.15,
      value: loadValue,
      contribution: loadValue > 0.7 ? 'codespace' : 'neutral',
      description: `System load: CPU=${this.context.systemLoad.cpuUsage}%, Memory=${this.context.systemLoad.memoryUsage}%`
    });

    // Historical success factor
    const history = this.context.historicalPerformance.get(task.type);
    if (history) {
      const historyValue = history.codespaceSuccessRate > history.localSuccessRate ? 1 : 0;
      factors.push({
        name: 'historicalSuccess',
        weight: 0.15,
        value: historyValue,
        contribution: historyValue > 0.5 ? 'codespace' : 'local',
        description: `Historical: Local=${(history.localSuccessRate * 100).toFixed(0)}%, Codespace=${(history.codespaceSuccessRate * 100).toFixed(0)}%`
      });
    }

    // Priority factor
    const priorityValue = task.priority === 'critical' ? 1 : task.priority === 'high' ? 0.7 : task.priority === 'medium' ? 0.4 : 0.1;
    factors.push({
      name: 'priority',
      weight: 0.1,
      value: priorityValue,
      contribution: 'neutral', // Priority alone doesn't determine route
      description: `Task priority: ${task.priority}`
    });

    return factors;
  }

  /**
   * Calculate resource requirements score
   */
  private calculateResourceScore(requirements: ResourceRequirements): number {
    const levels = { low: 0, medium: 0.5, high: 1 };

    let score = 0;
    score += levels[requirements.cpu] * 0.3;
    score += levels[requirements.memory] * 0.3;
    score += levels[requirements.disk] * 0.1;
    score += levels[requirements.network] * 0.1;
    score += requirements.gpu ? 0.1 : 0;
    score += requirements.isolation ? 0.1 : 0;

    return score;
  }

  /**
   * Apply routing rules and find matching rule
   */
  private applyRules(task: TaskProfile): RoutingRule {
    for (const rule of this.rules) {
      try {
        if (rule.condition(task, this.context)) {
          logger.debug(`Rule matched: ${rule.name} for task ${task.taskId}`);
          return rule;
        }
      } catch (error) {
        logger.warn(`Rule evaluation failed: ${rule.name}`, error);
      }
    }

    // Should never reach here due to default rule, but just in case
    return this.rules[this.rules.length - 1];
  }

  /**
   * Calculate confidence score for the decision
   */
  private calculateConfidence(factors: RoutingFactor[], matchedRule: RoutingRule): number {
    // Base confidence from rule priority
    const rulePriorityScore = matchedRule.priority / 100;

    // Factor alignment score
    let alignmentScore = 0;
    let totalWeight = 0;

    for (const factor of factors) {
      const expectedContribution = matchedRule.action === 'local' ? 'local' : 'codespace';
      if (factor.contribution === expectedContribution || factor.contribution === 'neutral') {
        alignmentScore += factor.weight * factor.value;
      }
      totalWeight += factor.weight;
    }

    const normalizedAlignment = totalWeight > 0 ? alignmentScore / totalWeight : 0.5;

    // Combined confidence
    return Math.min(0.95, (rulePriorityScore * 0.4 + normalizedAlignment * 0.6));
  }

  /**
   * Get alternative routing options
   */
  private getAlternatives(
    task: TaskProfile,
    matchedRule: RoutingRule,
    factors: RoutingFactor[]
  ): AlternativeRoute[] {
    const alternatives: AlternativeRoute[] = [];
    const primaryMode = matchedRule.action === 'defer' ? 'local' : matchedRule.action;
    const alternativeMode: WorkerMode = primaryMode === 'local' ? 'codespace' : 'local';

    // Calculate alternative confidence
    const alternativeFactors = factors.filter(
      f => f.contribution === alternativeMode || f.contribution === 'neutral'
    );
    const alternativeConfidence = alternativeFactors.reduce(
      (sum, f) => sum + f.weight * f.value, 0
    ) / factors.reduce((sum, f) => sum + f.weight, 0);

    // Determine tradeoffs
    const tradeoffs: string[] = [];
    if (alternativeMode === 'local') {
      tradeoffs.push('Faster startup time');
      tradeoffs.push('Lower cost');
      if (task.resourceRequirements.memory === 'high') {
        tradeoffs.push('May hit memory limits');
      }
    } else {
      tradeoffs.push('More reliable for complex tasks');
      tradeoffs.push('Better isolation');
      tradeoffs.push('Higher latency to start');
      tradeoffs.push('Additional cost');
    }

    alternatives.push({
      mode: alternativeMode,
      reason: `Alternative route to ${alternativeMode}`,
      confidence: alternativeConfidence,
      tradeoffs
    });

    // Add hybrid option if not already primary
    if (primaryMode !== 'hybrid') {
      alternatives.push({
        mode: 'hybrid',
        reason: 'Dynamic routing based on runtime conditions',
        confidence: 0.7,
        tradeoffs: [
          'Flexible but less predictable',
          'May switch environments mid-task',
          'Good for uncertain workloads'
        ]
      });
    }

    return alternatives;
  }

  /**
   * Estimate cost for routing decision
   */
  private estimateCost(task: TaskProfile, mode: WorkerMode): CostEstimate {
    const baseCost = {
      local: 0,
      codespace: 0,
      factors: { compute: 0, time: 0, failure: 0 }
    };

    // Codespace has compute cost
    if (mode === 'codespace' || mode === 'hybrid') {
      const hourlyRate = this.context.config.codespace?.machine === 'largePremiumLinux' ? 0.36 : 0.18;
      baseCost.codespace = (task.estimatedDuration / 60) * hourlyRate;
      baseCost.factors.compute = baseCost.codespace;
    }

    // Time cost (opportunity cost)
    const timeValue = 0.5; // $0.50 per minute of developer time
    baseCost.factors.time = task.estimatedDuration * timeValue * 0.1; // 10% of time is overhead

    // Failure cost (based on historical data)
    const history = this.context.historicalPerformance.get(task.type);
    if (history) {
      const failureRate = mode === 'local' ? (1 - history.localSuccessRate) : (1 - history.codespaceSuccessRate);
      baseCost.factors.failure = failureRate * task.estimatedDuration * timeValue;
    }

    return baseCost;
  }

  /**
   * Refresh routing context with current system state
   */
  private async refreshContext(): Promise<void> {
    // Update system load (in real implementation, query actual system metrics)
    // For now, use simulated values
    this.context.systemLoad = {
      cpuUsage: Math.random() * 60 + 20, // 20-80%
      memoryUsage: Math.random() * 50 + 30, // 30-80%
      activeTasks: this.context.activeRoutes.size,
      queuedTasks: 0,
      avgTaskDuration: 15
    };

    // Refresh config
    this.context.config = getWorkerConfig();
  }

  /**
   * Update historical performance data
   */
  updateHistoricalPerformance(
    taskType: TaskType,
    mode: WorkerMode,
    success: boolean,
    duration: number
  ): void {
    let history = this.context.historicalPerformance.get(taskType);

    if (!history) {
      history = {
        taskType,
        localSuccessRate: 0.8,
        codespaceSuccessRate: 0.9,
        localAvgDuration: 15,
        codespaceAvgDuration: 20,
        localFailureReasons: [],
        codespaceFailureReasons: []
      };
    }

    // Update success rate with exponential moving average
    const alpha = 0.2; // Smoothing factor

    if (mode === 'local') {
      history.localSuccessRate = alpha * (success ? 1 : 0) + (1 - alpha) * history.localSuccessRate;
      history.localAvgDuration = alpha * duration + (1 - alpha) * history.localAvgDuration;
    } else if (mode === 'codespace') {
      history.codespaceSuccessRate = alpha * (success ? 1 : 0) + (1 - alpha) * history.codespaceSuccessRate;
      history.codespaceAvgDuration = alpha * duration + (1 - alpha) * history.codespaceAvgDuration;
    }

    this.context.historicalPerformance.set(taskType, history);

    this.emit('performance:updated', { taskType, history });
  }

  /**
   * Mark a route as complete
   */
  completeRoute(taskId: string, success: boolean): void {
    const decision = this.context.activeRoutes.get(taskId);
    if (decision) {
      this.context.activeRoutes.delete(taskId);
      this.decisionCache.delete(taskId);
      this.emit('route:completed', { taskId, decision, success });
    }
  }

  /**
   * Add a custom routing rule
   */
  addRule(rule: RoutingRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => b.priority - a.priority);
    this.emit('rule:added', { rule });
    logger.info(`Added routing rule: ${rule.name}`);
  }

  /**
   * Remove a routing rule
   */
  removeRule(ruleId: string): void {
    const index = this.rules.findIndex(r => r.id === ruleId);
    if (index >= 0) {
      const removed = this.rules.splice(index, 1)[0];
      this.emit('rule:removed', { rule: removed });
      logger.info(`Removed routing rule: ${removed.name}`);
    }
  }

  /**
   * Get all routing rules
   */
  getRules(): RoutingRule[] {
    return [...this.rules];
  }

  /**
   * Get current routing context
   */
  getContext(): RoutingContext {
    return { ...this.context };
  }

  /**
   * Clear decision cache
   */
  clearCache(): void {
    this.decisionCache.clear();
    this.emit('cache:cleared');
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

let routerInstance: AdvancedTaskRouter | null = null;

/**
 * Get the singleton router instance
 */
export function getRouter(): AdvancedTaskRouter {
  if (!routerInstance) {
    routerInstance = new AdvancedTaskRouter();
  }
  return routerInstance;
}

/**
 * Create a new router with custom rules
 */
export function createRouter(customRules?: RoutingRule[]): AdvancedTaskRouter {
  return new AdvancedTaskRouter(customRules);
}

/**
 * Quick route a task using the singleton router
 */
export async function routeTask(task: TaskProfile): Promise<RoutingDecision> {
  return getRouter().route(task);
}

/**
 * Create a task profile from minimal input
 */
export function createTaskProfile(
  taskId: string,
  title: string,
  options: Partial<TaskProfile> = {}
): TaskProfile {
  return {
    taskId,
    title,
    type: options.type || 'feature',
    complexity: options.complexity || 'medium',
    estimatedDuration: options.estimatedDuration || 30,
    resourceRequirements: options.resourceRequirements || {
      cpu: 'medium',
      memory: 'medium',
      disk: 'low',
      gpu: false,
      network: 'low',
      isolation: false
    },
    labels: options.labels || [],
    dependencies: options.dependencies || [],
    priority: options.priority || 'medium',
    agentType: options.agentType
  };
}

export default AdvancedTaskRouter;
