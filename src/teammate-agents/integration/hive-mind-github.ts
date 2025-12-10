/**
 * Hive-Mind GitHub Integration
 *
 * Unified orchestration layer combining:
 * - GitHub Projects v2 (via OctokitClient)
 * - Hive-Mind agent coordination
 * - AgentDB vector memory
 * - SPARC methodology phases
 *
 * This is the main entry point for CTO-level project orchestration.
 */

import { EventEmitter } from 'events';
import { createOctokitClient, OctokitClient } from '../github/octokit-client.js';
import { createUserProjectManager, GitHubProjectManager } from '../github/project-manager.js';
import { AgentDBEpicMemory, createAgentDBEpicMemory, AgentProfile } from '../memory/agentdb-epic-memory.js';
import {
  EpicContext,
  TaskProgress,
  AgentAssignment,
  ArchitecturalDecision,
} from '../memory/epic-memory-manager.js';

// ============================================================================
// Type Definitions
// ============================================================================

export interface HiveMindConfig {
  owner: string;
  repo?: string;
  token?: string;
  enableVectorSearch?: boolean;
  enableLearning?: boolean;
  autoCreateLabels?: boolean;
}

export interface SparcPhase {
  name: 'Specification' | 'Pseudocode' | 'Architecture' | 'Refinement' | 'Completion';
  status: string;
  agentTypes: string[];
}

export interface EpicPlan {
  title: string;
  description: string;
  objectives: string[];
  constraints: string[];
  tasks: TaskPlan[];
  metadata?: Record<string, unknown>;
}

export interface TaskPlan {
  title: string;
  description: string;
  phase: SparcPhase['name'];
  skills: string[];
  priority: 'low' | 'medium' | 'high' | 'critical';
  dependencies?: string[];
  estimatedHours?: number;
}

export interface CreatedEpic {
  epicId: string;
  repoUrl?: string;
  projectUrl: string;
  projectNumber: number;
  projectId: string;
  epicIssueNumber: number;
  epicIssueUrl: string;
  tasks: CreatedTask[];
}

export interface CreatedTask {
  taskId: string;
  issueNumber: number;
  issueUrl: string;
  title: string;
  phase: string;
  assignedAgent?: AgentProfile;
  assignmentScore?: number;
}

// ============================================================================
// SPARC Phase Configuration
// ============================================================================

export const SPARC_PHASES: SparcPhase[] = [
  { name: 'Specification', status: 'Specification', agentTypes: ['researcher'] },
  { name: 'Pseudocode', status: 'Design', agentTypes: ['architect', 'researcher'] },
  { name: 'Architecture', status: 'Architecture', agentTypes: ['architect'] },
  { name: 'Refinement', status: 'In Progress', agentTypes: ['coder', 'tester'] },
  { name: 'Completion', status: 'Review', agentTypes: ['reviewer', 'tester'] },
];

export const DEFAULT_PROJECT_STATUSES = [
  'Backlog',
  'Specification',
  'Design',
  'Architecture',
  'In Progress',
  'Review',
  'Done',
];

// ============================================================================
// Hive-Mind GitHub Orchestrator
// ============================================================================

export class HiveMindGitHubOrchestrator extends EventEmitter {
  private config: Required<HiveMindConfig>;
  private client: OctokitClient | null = null;
  private projectManager: GitHubProjectManager | null = null;
  private memory: AgentDBEpicMemory;
  private isInitialized = false;

  // Default agent profiles for Hive-Mind
  private static readonly DEFAULT_AGENTS: Omit<AgentProfile, 'embedding'>[] = [
    {
      agentId: 'hive-researcher',
      name: 'Research Agent',
      type: 'researcher',
      skills: ['research', 'analysis', 'documentation', 'requirements', 'specifications'],
      domains: ['backend', 'frontend', 'architecture', 'security'],
      capabilities: ['search', 'read', 'summarize', 'analyze'],
      performanceHistory: [],
      metadata: { role: 'Specification & Analysis' },
    },
    {
      agentId: 'hive-architect',
      name: 'Architect Agent',
      type: 'architect',
      skills: ['architecture', 'design', 'systems', 'patterns', 'diagrams', 'api-design'],
      domains: ['backend', 'frontend', 'database', 'infrastructure'],
      capabilities: ['design', 'document', 'review'],
      performanceHistory: [],
      metadata: { role: 'System Design & Architecture' },
    },
    {
      agentId: 'hive-coder',
      name: 'Coder Agent',
      type: 'coder',
      skills: ['typescript', 'nodejs', 'python', 'api', 'database', 'testing', 'implementation'],
      domains: ['backend', 'frontend', 'database'],
      capabilities: ['edit', 'bash', 'test', 'debug'],
      performanceHistory: [],
      metadata: { role: 'Implementation & TDD' },
    },
    {
      agentId: 'hive-tester',
      name: 'Tester Agent',
      type: 'tester',
      skills: ['testing', 'jest', 'integration', 'e2e', 'tdd', 'quality-assurance'],
      domains: ['testing', 'qa', 'security'],
      capabilities: ['bash', 'test', 'validate'],
      performanceHistory: [],
      metadata: { role: 'Testing & Quality Assurance' },
    },
    {
      agentId: 'hive-reviewer',
      name: 'Reviewer Agent',
      type: 'reviewer',
      skills: ['code-review', 'security', 'best-practices', 'documentation', 'standards'],
      domains: ['backend', 'frontend', 'security', 'devops'],
      capabilities: ['read', 'analyze', 'review', 'document'],
      performanceHistory: [],
      metadata: { role: 'Code Review & Security' },
    },
  ];

  constructor(config: HiveMindConfig) {
    super();

    this.config = {
      owner: config.owner,
      repo: config.repo || '',
      token: config.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '',
      enableVectorSearch: config.enableVectorSearch ?? true,
      enableLearning: config.enableLearning ?? true,
      autoCreateLabels: config.autoCreateLabels ?? true,
    };

    this.memory = createAgentDBEpicMemory({
      enableVectorSearch: this.config.enableVectorSearch,
      enableLearning: this.config.enableLearning,
    });
  }

  /**
   * Initialize the orchestrator
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Initialize memory
    await this.memory.initialize();

    // Register default agents
    for (const agent of HiveMindGitHubOrchestrator.DEFAULT_AGENTS) {
      await this.memory.registerAgent(agent);
    }

    // Initialize GitHub client if repo is set
    if (this.config.repo) {
      this.client = createOctokitClient({
        owner: this.config.owner,
        repo: this.config.repo,
        token: this.config.token,
      });
      this.projectManager = createUserProjectManager(this.config.owner, this.config.repo);
    }

    this.isInitialized = true;
    this.emit('initialized');
  }

  /**
   * Shutdown the orchestrator
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) return;

    await this.memory.shutdown();
    this.isInitialized = false;
    this.emit('shutdown');
  }

  // ==========================================================================
  // Repository Management
  // ==========================================================================

  /**
   * Create a new repository for an epic
   */
  async createRepository(options: {
    name: string;
    description?: string;
    private?: boolean;
  }): Promise<{ name: string; fullName: string; url: string; cloneUrl: string }> {
    // Create temporary client for repo creation
    const tempClient = createOctokitClient({
      owner: this.config.owner,
      repo: 'placeholder',
      token: this.config.token,
    });

    const repo = await tempClient.createRepository({
      name: options.name,
      description: options.description || 'Created by Hive-Mind Orchestrator',
      private: options.private ?? false,
      autoInit: true,
    });

    // Update config and client
    this.config.repo = repo.name;
    this.client = createOctokitClient({
      owner: this.config.owner,
      repo: repo.name,
      token: this.config.token,
    });
    this.projectManager = createUserProjectManager(this.config.owner, repo.name);

    this.emit('repo:created', repo);
    return repo;
  }

  // ==========================================================================
  // Epic Orchestration
  // ==========================================================================

  /**
   * Create a full epic with project, issues, and agent assignments
   */
  async createEpic(plan: EpicPlan): Promise<CreatedEpic> {
    if (!this.client || !this.projectManager) {
      throw new Error('GitHub client not initialized. Call createRepository() or set repo in config.');
    }

    const epicId = `epic-${Date.now()}`;

    this.emit('epic:creating', { epicId, title: plan.title });

    // Step 1: Create GitHub Project
    const project = await this.projectManager.createProject({
      title: `[SPARC Epic] ${plan.title}`,
      description: this.generateProjectDescription(plan, epicId),
      epicId,
      createStatusField: true,
      statusOptions: DEFAULT_PROJECT_STATUSES,
    });

    this.emit('project:created', { projectNumber: project.number, url: project.url });

    // Step 2: Create Epic Labels
    if (this.config.autoCreateLabels) {
      await this.ensureLabels(epicId);
    }

    // Step 3: Create Epic Issue
    const epicIssue = await this.client.createIssue(
      `[SPARC EPIC] ${plan.title}`,
      this.generateEpicBody(plan, epicId, project.number),
      [`epic:${epicId}`, 'epic', 'sparc', 'hive-mind']
    );

    // Add epic to project
    const epicNodeId = await this.client.getIssueNodeId(epicIssue.number);
    await this.client.addIssueToProject(project.id, epicNodeId);

    this.emit('epic:issue:created', { number: epicIssue.number, url: epicIssue.url });

    // Step 4: Store epic context in memory
    const epicContext: EpicContext = {
      epicId,
      title: plan.title,
      description: plan.description,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 'hive-mind',
      owner: this.config.owner,
      tags: ['sparc', 'hive-mind'],
      metadata: plan.metadata || {},
      dependencies: [],
      milestones: [],
      objectives: plan.objectives,
      constraints: plan.constraints,
    };

    await this.memory.getBaseMemory().storeEpicContext(epicContext);

    // Step 5: Create Task Issues with Agent Assignments
    const createdTasks: CreatedTask[] = [];

    for (let i = 0; i < plan.tasks.length; i++) {
      const taskPlan = plan.tasks[i];
      const taskId = `task-${epicId}-${i + 1}`;

      // Find best matching agent
      const matches = await this.memory.findMatchingAgents({
        title: taskPlan.title,
        description: taskPlan.description,
        skills: taskPlan.skills,
        priority: taskPlan.priority,
      }, 1);

      const bestMatch = matches[0];

      // Create task issue
      const taskLabels = [
        `epic:${epicId}`,
        'task:child',
        `priority:${taskPlan.priority}`,
        `sparc:${taskPlan.phase.toLowerCase()}`,
      ];

      if (bestMatch) {
        taskLabels.push(`agent:${bestMatch.agent.type}`);
      }

      const taskIssue = await this.client.createIssue(
        taskPlan.title,
        this.generateTaskBody(taskPlan, epicId, epicIssue.number, bestMatch),
        taskLabels
      );

      // Add to project
      const taskNodeId = await this.client.getIssueNodeId(taskIssue.number);
      await this.client.addIssueToProject(project.id, taskNodeId);

      // Store task in memory with embedding
      const taskProgress: TaskProgress = {
        taskId,
        epicId,
        title: taskPlan.title,
        status: 'pending',
        progress: 0,
        assignedTo: bestMatch?.agent.agentId,
        dependencies: taskPlan.dependencies || [],
        checkpoints: [],
        metadata: {
          phase: taskPlan.phase,
          priority: taskPlan.priority,
          issueNumber: taskIssue.number,
        },
      };

      await this.memory.storeTaskWithEmbedding(taskProgress, {
        skills: taskPlan.skills,
        phase: taskPlan.phase,
      });

      // Record agent assignment
      if (bestMatch) {
        const assignment: AgentAssignment = {
          agentId: bestMatch.agent.agentId,
          epicId,
          role: taskPlan.phase,
          assignedAt: new Date(),
          assignedBy: 'hive-mind',
          responsibilities: [taskPlan.title],
          permissions: ['read', 'write', 'execute'],
          taskIds: [taskId],
          status: 'active',
          metadata: { score: bestMatch.score },
        };

        await this.memory.getBaseMemory().recordAgentAssignment(assignment);
      }

      createdTasks.push({
        taskId,
        issueNumber: taskIssue.number,
        issueUrl: taskIssue.url,
        title: taskPlan.title,
        phase: taskPlan.phase,
        assignedAgent: bestMatch?.agent,
        assignmentScore: bestMatch?.score,
      });

      this.emit('task:created', {
        taskId,
        issueNumber: taskIssue.number,
        agent: bestMatch?.agent.name,
        score: bestMatch?.score,
      });
    }

    const result: CreatedEpic = {
      epicId,
      projectUrl: project.url,
      projectNumber: project.number,
      projectId: project.id,
      epicIssueNumber: epicIssue.number,
      epicIssueUrl: epicIssue.url,
      tasks: createdTasks,
    };

    this.emit('epic:created', result);
    return result;
  }

  // ==========================================================================
  // Agent Management
  // ==========================================================================

  /**
   * Register a custom agent
   */
  async registerAgent(profile: Omit<AgentProfile, 'embedding'>): Promise<string> {
    return this.memory.registerAgent(profile);
  }

  /**
   * Get all registered agents
   */
  getAgents(): AgentProfile[] {
    return this.memory.getAgents();
  }

  /**
   * Find best agents for a task
   */
  async findAgentsForTask(
    task: { title: string; description: string; skills: string[]; priority: string },
    limit: number = 3
  ): Promise<Array<{ agent: AgentProfile; score: number; breakdown: Record<string, number> }>> {
    return this.memory.findMatchingAgents(task, limit);
  }

  // ==========================================================================
  // Similarity Search
  // ==========================================================================

  /**
   * Find similar tasks across all epics
   */
  async findSimilarTasks(description: string, limit: number = 5) {
    return this.memory.findSimilarTasks(description, limit);
  }

  /**
   * Find similar architectural decisions
   */
  async findSimilarDecisions(context: string, limit: number = 5) {
    return this.memory.findSimilarDecisions(context, limit);
  }

  // ==========================================================================
  // Learning & Feedback
  // ==========================================================================

  /**
   * Record task completion outcome for learning
   */
  async recordOutcome(
    epicId: string,
    taskId: string,
    outcome: {
      success: boolean;
      quality: number;
      completionTime: number;
      feedback?: string;
    }
  ): Promise<void> {
    const agents = await this.memory.getBaseMemory().getEpicAgents(epicId);
    const assignment = agents.find(a => a.taskIds.includes(taskId));

    if (assignment) {
      await this.memory.recordAssignmentOutcome(assignment, outcome);
    }
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  private async ensureLabels(epicId: string): Promise<void> {
    if (!this.client) return;

    const labels = [
      { name: `epic:${epicId}`, color: '7057ff' },
      { name: 'epic', color: 'c5def5' },
      { name: 'sparc', color: '0366d6' },
      { name: 'hive-mind', color: '28a745' },
      { name: 'task:child', color: 'bfd4f2' },
      { name: 'priority:critical', color: 'd73a4a' },
      { name: 'priority:high', color: 'ff6b6b' },
      { name: 'priority:medium', color: 'fbca04' },
      { name: 'priority:low', color: '0e8a16' },
      ...SPARC_PHASES.map(p => ({ name: `sparc:${p.name.toLowerCase()}`, color: '0366d6' })),
      ...HiveMindGitHubOrchestrator.DEFAULT_AGENTS.map(a => ({
        name: `agent:${a.type}`,
        color: '28a745',
      })),
    ];

    for (const label of labels) {
      try {
        await this.client.ensureLabel(label.name, label.color);
      } catch {
        // Ignore label creation errors
      }
    }
  }

  private generateProjectDescription(plan: EpicPlan, epicId: string): string {
    return `${plan.description}

## SPARC Phases
- **Specification**: Requirements and constraints
- **Pseudocode**: Algorithm design
- **Architecture**: System design
- **Refinement**: TDD implementation
- **Completion**: Review and documentation

## Hive-Mind Coordination
Tasks are automatically assigned to specialized agents based on skill matching.

**Epic ID**: \`${epicId}\`
**Managed by**: Hive-Mind Orchestrator`;
  }

  private generateEpicBody(plan: EpicPlan, epicId: string, projectNumber: number): string {
    const objectivesList = plan.objectives.map(o => `- [ ] ${o}`).join('\n');
    const constraintsList = plan.constraints.map(c => `- ${c}`).join('\n');
    const tasksList = plan.tasks
      .map((t, i) => `${i + 1}. **[${t.phase}]** ${t.title} (${t.priority})`)
      .join('\n');

    return `## Epic Overview

${plan.description}

## Objectives
${objectivesList}

## Constraints
${constraintsList}

## SPARC Tasks
${tasksList}

---
**Epic ID**: \`${epicId}\`
**Project**: #${projectNumber}
**Methodology**: SPARC
**Coordination**: Hive-Mind

_Managed by Teammate-Agents + Hive-Mind Orchestrator_`;
  }

  private generateTaskBody(
    task: TaskPlan,
    epicId: string,
    epicIssueNumber: number,
    match?: { agent: AgentProfile; score: number; breakdown: Record<string, number> }
  ): string {
    let assignmentSection = '';
    if (match) {
      assignmentSection = `## Hive-Mind Assignment
**Assigned Agent**: ${match.agent.name} (\`${match.agent.type}\`)
**Match Score**: ${match.score.toFixed(1)}%
**Agent Skills**: ${match.agent.skills.slice(0, 5).join(', ')}

### Score Breakdown
- Vector Similarity: ${match.breakdown.vectorSimilarity.toFixed(1)}%
- Skill Match: ${match.breakdown.skillMatch.toFixed(1)}%
- Performance: ${match.breakdown.performance.toFixed(1)}%

`;
    }

    return `${task.description}

---
${assignmentSection}## SPARC Metadata
**Phase**: ${task.phase}
**Parent Epic**: #${epicIssueNumber}
**Epic ID**: \`${epicId}\`
**Priority**: ${task.priority}
**Required Skills**: ${task.skills.join(', ')}

## Acceptance Criteria
- [ ] Implementation complete
- [ ] Tests passing
- [ ] Code reviewed
- [ ] Documentation updated

_Task managed by Teammate-Agents + Hive-Mind Coordination_`;
  }

  /**
   * Get orchestrator statistics
   */
  async getStats(): Promise<{
    initialized: boolean;
    repo: string;
    agents: number;
    memoryStats: any;
  }> {
    return {
      initialized: this.isInitialized,
      repo: this.config.repo,
      agents: this.memory.getAgents().length,
      memoryStats: await this.memory.getStats(),
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createHiveMindOrchestrator(config: HiveMindConfig): HiveMindGitHubOrchestrator {
  return new HiveMindGitHubOrchestrator(config);
}

export default HiveMindGitHubOrchestrator;
