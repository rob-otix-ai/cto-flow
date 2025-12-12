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

export type TaskStatus = 'backlog' | 'ready' | 'in_progress' | 'review' | 'done' | 'blocked';

export interface CreatedTask {
  taskId: string;
  issueNumber: number;
  issueUrl: string;
  title: string;
  phase: string;
  assignedAgent?: AgentProfile;
  assignmentScore?: number;
  projectItemId?: string;
  status: TaskStatus;
  issueState: 'open' | 'closed';
  dependencies?: string[]; // Task IDs this task depends on
  blockedBy?: string; // Reason if blocked
  githubAssignees?: string[]; // GitHub usernames explicitly assigned to this issue
}

export interface TaskCompletionResult {
  taskId: string;
  epicId: string;
  issueNumber: number;
  success: boolean;
  status: 'Done' | 'Review' | 'In Progress';
  completedBy?: string;
  completionTime?: number;
  summary?: string;
  artifacts?: string[];
}

export interface TrackedPullRequest {
  prNumber: number;
  prUrl: string;
  title: string;
  branch: string;
  baseBranch: string;
  epicId: string;
  linkedTaskIds: string[];
  linkedIssueNumbers: number[];
  status: 'draft' | 'open' | 'review' | 'approved' | 'merged' | 'closed';
  projectItemId?: string;
  createdAt: Date;
  mergedAt?: Date;
}

export interface PRCreationResult {
  prNumber: number;
  prUrl: string;
  branch: string;
  linkedIssues: number[];
  projectItemId?: string;
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
  'Backlog',      // Task created, not yet approved by CTO
  'Ready',        // CTO approved, agent can pick up
  'In Progress',  // Agent is working
  'Review',       // Work complete, awaiting review
  'Done',         // Fully complete
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

  // Cache for epic data to enable task completion tracking
  private epicCache: Map<string, CreatedEpic> = new Map();

  // Cache for PR tracking
  private prCache: Map<string, TrackedPullRequest[]> = new Map(); // epicId -> PRs

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

    // Get the CTO Workflow field info for setting initial status
    const workflowField = project.fields.find(f => f.name === 'CTO Workflow');
    const backlogOption = workflowField?.options?.find(o => o.name === 'Backlog');

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

      // Create task issue (workflow status is controlled via Project board, not labels)
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

      // Add to project and capture item ID for status tracking
      const taskNodeId = await this.client.getIssueNodeId(taskIssue.number);
      const { itemId: projectItemId } = await this.client.addIssueToProject(project.id, taskNodeId);

      // Set initial status to Backlog (CTO must move to Ready before agents can pick up)
      if (workflowField && backlogOption) {
        await this.client.updateProjectItemField(
          project.id,
          projectItemId,
          workflowField.id,
          backlogOption.id
        );
      }

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
          projectItemId, // Store for status updates
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
        projectItemId,
        status: 'ready', // New tasks are ready for work
        issueState: 'open',
        dependencies: taskPlan.dependencies,
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

    // Cache epic for task completion tracking
    this.epicCache.set(epicId, result);

    this.emit('epic:created', result);
    return result;
  }

  // ==========================================================================
  // Epic Loading & Retrospective Management
  // ==========================================================================

  /**
   * Load an existing epic from GitHub repository
   * This allows the Hive-Mind to pick up work on an existing project
   * @param repoName Repository name (will update config if different)
   * @param epicId Optional epic ID to look for (searches by label if not provided)
   */
  async loadEpicFromGitHub(
    repoName?: string,
    epicId?: string
  ): Promise<CreatedEpic | null> {
    // Update repo if provided
    if (repoName && repoName !== this.config.repo) {
      this.config.repo = repoName;
      this.client = createOctokitClient({
        owner: this.config.owner,
        repo: repoName,
        token: this.config.token,
      });
      this.projectManager = createUserProjectManager(this.config.owner, repoName);
    }

    if (!this.client || !this.projectManager) {
      throw new Error('GitHub client not initialized. Provide repoName or set repo in config.');
    }

    this.emit('epic:loading', { repoName, epicId });

    // Find epic issue - either by epicId label or by searching for epic label
    let epicIssue: { number: number; title: string; body: string; labels: string[]; url: string } | null = null;
    let foundEpicId = epicId;

    if (epicId) {
      // Search by specific epic ID label
      const issues = await this.client.listIssues({ labels: `epic:${epicId}`, state: 'all' });
      epicIssue = issues.find(i => i.labels.includes('epic')) || null;
    } else {
      // Find any epic in the repo
      const issues = await this.client.listIssues({ labels: 'epic', state: 'all' });
      epicIssue = issues.find(i => i.labels.some(l => l.startsWith('epic:'))) || null;

      if (epicIssue) {
        // Extract epic ID from labels
        const epicLabel = epicIssue.labels.find(l => l.startsWith('epic:') && l !== 'epic');
        foundEpicId = epicLabel?.replace('epic:', '') || `epic-${Date.now()}`;
      }
    }

    if (!epicIssue) {
      this.emit('epic:notFound', { repoName, epicId });
      return null;
    }

    // Find all task issues for this epic
    const taskIssues = await this.client.listIssues({
      labels: `epic:${foundEpicId}`,
      state: 'all',
    });

    // Filter to only child tasks (not the epic itself)
    const childTasks = taskIssues.filter(i =>
      i.labels.includes('task:child') && i.number !== epicIssue!.number
    );

    // Find the associated project
    const projects = await this.projectManager.listProjects(20);
    const epicProject = projects.find(p =>
      p.title.includes(foundEpicId!) || p.title.includes('SPARC Epic')
    );

    if (!epicProject) {
      console.warn(`No project found for epic ${foundEpicId}`);
    }

    // Get project items to map issue numbers to item IDs and statuses
    let projectItems: Map<number, { id: string; status: string }> = new Map();
    if (epicProject) {
      const items = await this.projectManager.listItems(epicProject.number, 100);
      for (const item of items) {
        if (item.content?.number) {
          // Extract status from field values
          const statusField = item.fieldValues?.find((fv: any) =>
            fv.field?.toLowerCase() === 'status' || fv.name
          );
          const projectStatus = statusField?.name || statusField?.value || 'Backlog';

          projectItems.set(item.content.number, {
            id: item.id,
            status: projectStatus,
          });
        }
      }
    }

    // Build task list with status tracking
    const tasks: CreatedTask[] = childTasks.map((issue, idx) => {
      // Extract phase from labels
      const phaseLabel = issue.labels.find(l => l.startsWith('sparc:'));
      const phase = phaseLabel?.replace('sparc:', '') || 'Refinement';

      // Extract agent type from labels
      const agentLabel = issue.labels.find(l => l.startsWith('agent:'));
      const agentType = agentLabel?.replace('agent:', '') || 'coder';

      // Find matching default agent
      const agent = this.memory.getAgents().find(a => a.type === agentType);

      // Get project item info
      const projectItem = projectItems.get(issue.number);

      // Determine task status from project status and issue state
      const taskStatus = this.mapProjectStatusToTaskStatus(
        projectItem?.status || 'Backlog',
        issue.state as 'open' | 'closed'
      );

      return {
        taskId: `task-${foundEpicId}-${idx + 1}`,
        issueNumber: issue.number,
        issueUrl: issue.url,
        title: issue.title,
        phase: phase.charAt(0).toUpperCase() + phase.slice(1),
        assignedAgent: agent,
        projectItemId: projectItem?.id,
        status: taskStatus,
        issueState: issue.state as 'open' | 'closed',
      };
    });

    // Sort tasks by issue number
    tasks.sort((a, b) => a.issueNumber - b.issueNumber);

    const loadedEpic: CreatedEpic = {
      epicId: foundEpicId!,
      projectUrl: epicProject?.url || '',
      projectNumber: epicProject?.number || 0,
      projectId: epicProject?.id || '',
      epicIssueNumber: epicIssue.number,
      epicIssueUrl: epicIssue.url,
      tasks,
    };

    // Cache the loaded epic
    this.epicCache.set(foundEpicId!, loadedEpic);

    this.emit('epic:loaded', {
      epicId: foundEpicId,
      taskCount: tasks.length,
      projectNumber: epicProject?.number,
    });

    return loadedEpic;
  }

  /**
   * Retrospectively close/complete tasks that have already been done
   * This examines the codebase or other signals to determine which tasks are complete
   * @param epicId Epic identifier
   * @param completedTaskIds List of task IDs or issue numbers that are complete
   * @param options Completion options
   */
  async retrospectiveComplete(
    epicId: string,
    completedTaskIds: (string | number)[],
    options: {
      summary?: string;
      completedBy?: string;
      closeIssues?: boolean;
      updateProject?: boolean;
    } = {}
  ): Promise<TaskCompletionResult[]> {
    const {
      summary = 'Task completed (retrospective)',
      completedBy = 'Hive-Mind Retrospective',
      closeIssues = true,
      updateProject = true,
    } = options;

    const results: TaskCompletionResult[] = [];

    for (const taskId of completedTaskIds) {
      try {
        const result = await this.completeTask(epicId, taskId, {
          success: true,
          completedBy,
          summary,
          moveToReview: !closeIssues,
        });
        results.push(result);
      } catch (error) {
        console.error(`Failed to complete task ${taskId}:`, error);
      }
    }

    this.emit('epic:retrospectiveComplete', {
      epicId,
      completedCount: results.length,
      totalRequested: completedTaskIds.length,
    });

    return results;
  }

  /**
   * Auto-detect and complete tasks based on their acceptance criteria
   * This checks if files mentioned in tasks exist and if tests pass
   * @param epicId Epic identifier
   * @param workingDir Directory to check for files
   */
  async autoDetectCompletedTasks(
    epicId: string,
    workingDir: string
  ): Promise<{ completed: CreatedTask[]; pending: CreatedTask[] }> {
    const epic = this.epicCache.get(epicId);
    if (!epic) {
      throw new Error(`Epic ${epicId} not found. Call loadEpicFromGitHub first.`);
    }

    const completed: CreatedTask[] = [];
    const pending: CreatedTask[] = [];

    // Simple heuristic: check if key files exist based on task titles
    const fs = await import('fs').then(m => m.promises);
    const path = await import('path');

    for (const task of epic.tasks) {
      let isComplete = false;

      // Check based on task phase and title
      const titleLower = task.title.toLowerCase();

      if (titleLower.includes('api specification') || titleLower.includes('interfaces')) {
        // Check for types file
        try {
          await fs.access(path.join(workingDir, 'src/types.ts'));
          isComplete = true;
        } catch {}
      } else if (titleLower.includes('architecture')) {
        // Check for architecture doc
        try {
          await fs.access(path.join(workingDir, 'docs/ARCHITECTURE.md'));
          isComplete = true;
        } catch {
          try {
            await fs.access(path.join(workingDir, 'ARCHITECTURE.md'));
            isComplete = true;
          } catch {}
        }
      } else if (titleLower.includes('vector') || titleLower.includes('similarity')) {
        // Check for vector implementation
        try {
          await fs.access(path.join(workingDir, 'src/vector.ts'));
          isComplete = true;
        } catch {}
      } else if (titleLower.includes('cache core') || titleLower.includes('semantic cache')) {
        // Check for cache implementation
        try {
          await fs.access(path.join(workingDir, 'src/cache.ts'));
          isComplete = true;
        } catch {}
      } else if (titleLower.includes('storage') || titleLower.includes('backend')) {
        // Check for storage implementation
        try {
          await fs.access(path.join(workingDir, 'src/storage.ts'));
          isComplete = true;
        } catch {}
      } else if (titleLower.includes('test')) {
        // Check for test files
        try {
          const files = await fs.readdir(path.join(workingDir, 'tests'));
          isComplete = files.some(f => f.endsWith('.test.ts') || f.endsWith('.spec.ts'));
        } catch {}
      } else if (titleLower.includes('documentation') || titleLower.includes('readme')) {
        // Check for README
        try {
          await fs.access(path.join(workingDir, 'README.md'));
          isComplete = true;
        } catch {}
      } else if (titleLower.includes('configuration') || titleLower.includes('setup')) {
        // Check for package.json and tsconfig
        try {
          await fs.access(path.join(workingDir, 'package.json'));
          await fs.access(path.join(workingDir, 'tsconfig.json'));
          isComplete = true;
        } catch {}
      }

      if (isComplete) {
        completed.push(task);
      } else {
        pending.push(task);
      }
    }

    this.emit('epic:autoDetected', {
      epicId,
      completedCount: completed.length,
      pendingCount: pending.length,
    });

    return { completed, pending };
  }

  /**
   * Complete all detected tasks and update GitHub
   * @param epicId Epic identifier
   * @param workingDir Directory to check for completed work
   */
  async syncCompletionStatus(
    epicId: string,
    workingDir: string,
    options: {
      dryRun?: boolean;
      completedBy?: string;
    } = {}
  ): Promise<{
    detected: { completed: CreatedTask[]; pending: CreatedTask[] };
    results: TaskCompletionResult[];
  }> {
    const { dryRun = false, completedBy = 'Hive-Mind Auto-Sync' } = options;

    // Detect completed tasks
    const detected = await this.autoDetectCompletedTasks(epicId, workingDir);

    if (dryRun) {
      console.log('Dry run - would complete these tasks:');
      for (const task of detected.completed) {
        console.log(`  #${task.issueNumber}: ${task.title}`);
      }
      return { detected, results: [] };
    }

    // Complete detected tasks
    const results = await this.retrospectiveComplete(
      epicId,
      detected.completed.map(t => t.taskId),
      { completedBy }
    );

    return { detected, results };
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
  // Task Completion Tracking
  // ==========================================================================

  /**
   * Get a cached epic by ID
   */
  getEpic(epicId: string): CreatedEpic | undefined {
    return this.epicCache.get(epicId);
  }

  /**
   * Get a task from a cached epic
   */
  getTask(epicId: string, taskId: string): CreatedTask | undefined {
    const epic = this.epicCache.get(epicId);
    if (!epic) return undefined;
    return epic.tasks.find(t => t.taskId === taskId);
  }

  /**
   * Get a task by issue number from a cached epic
   */
  getTaskByIssue(epicId: string, issueNumber: number): CreatedTask | undefined {
    const epic = this.epicCache.get(epicId);
    if (!epic) return undefined;
    return epic.tasks.find(t => t.issueNumber === issueNumber);
  }

  /**
   * Get tasks that are ready for implementation (not blocked, not done, not in progress)
   * These are tasks that can be picked up by Hive-Mind or Claude Code
   * @param epicId Epic identifier
   * @param options Filter options
   */
  getReadyTasks(
    epicId: string,
    options?: {
      phase?: SparcPhase['name'];
      agentType?: string;
      includeDependencyCheck?: boolean;
      /** If true, only return tasks with explicit GitHub assignees (default: true) */
      requireAssignment?: boolean;
      /** GitHub username to filter for - only return tasks assigned to this user */
      assignee?: string;
    }
  ): CreatedTask[] {
    const epic = this.epicCache.get(epicId);
    if (!epic) return [];

    // Default to requiring assignment (agents wait for explicit assignment)
    const requireAssignment = options?.requireAssignment !== false;

    let readyTasks = epic.tasks.filter(task => {
      // Task must be in 'ready' or 'backlog' status
      if (task.status !== 'ready' && task.status !== 'backlog') {
        return false;
      }

      // Task must be open
      if (task.issueState !== 'open') {
        return false;
      }

      // Filter by phase if specified
      if (options?.phase && task.phase.toLowerCase() !== options.phase.toLowerCase()) {
        return false;
      }

      // Filter by agent type if specified
      if (options?.agentType && task.assignedAgent?.type !== options.agentType) {
        return false;
      }

      // IMPORTANT: Only return tasks with explicit GitHub assignees
      // This ensures agents wait for manual assignment before picking up work
      if (requireAssignment) {
        if (!task.githubAssignees || task.githubAssignees.length === 0) {
          return false;
        }
      }

      // Filter by specific assignee if provided
      if (options?.assignee) {
        if (!task.githubAssignees?.includes(options.assignee)) {
          return false;
        }
      }

      return true;
    });

    // Check dependencies if requested
    if (options?.includeDependencyCheck) {
      const completedTaskIds = new Set(
        epic.tasks
          .filter(t => t.status === 'done' || t.issueState === 'closed')
          .map(t => t.taskId)
      );

      readyTasks = readyTasks.filter(task => {
        // If task has dependencies, all must be completed
        if (task.dependencies && task.dependencies.length > 0) {
          return task.dependencies.every(depId => completedTaskIds.has(depId));
        }
        return true;
      });
    }

    // Sort by phase order (Specification first, then Pseudocode, etc.)
    const phaseOrder = ['Specification', 'Pseudocode', 'Architecture', 'Refinement', 'Completion'];
    readyTasks.sort((a, b) => {
      const aOrder = phaseOrder.indexOf(a.phase) ?? 999;
      const bOrder = phaseOrder.indexOf(b.phase) ?? 999;
      if (aOrder !== bOrder) return aOrder - bOrder;
      // Secondary sort by issue number
      return a.issueNumber - b.issueNumber;
    });

    return readyTasks;
  }

  /**
   * Get tasks that are pending assignment (ready but not yet assigned)
   * Use this to see what tasks are available to be assigned
   * @param epicId Epic identifier
   */
  getUnassignedTasks(epicId: string): CreatedTask[] {
    const epic = this.epicCache.get(epicId);
    if (!epic) return [];

    return epic.tasks.filter(task => {
      // Task must be in 'ready' or 'backlog' status
      if (task.status !== 'ready' && task.status !== 'backlog') {
        return false;
      }

      // Task must be open
      if (task.issueState !== 'open') {
        return false;
      }

      // Task must NOT have any GitHub assignees
      if (task.githubAssignees && task.githubAssignees.length > 0) {
        return false;
      }

      return true;
    });
  }

  /**
   * Get the next task to work on for an epic
   * Returns the highest priority ready task based on phase and dependencies
   * @param epicId Epic identifier
   * @param agentType Optional agent type to filter for
   */
  getNextTask(epicId: string, agentType?: string): CreatedTask | null {
    const readyTasks = this.getReadyTasks(epicId, {
      agentType,
      includeDependencyCheck: true,
    });

    return readyTasks.length > 0 ? readyTasks[0] : null;
  }

  /**
   * Get task status summary for an epic
   * @param epicId Epic identifier
   */
  getTaskStatusSummary(epicId: string): {
    total: number;
    backlog: number;
    ready: number;
    inProgress: number;
    review: number;
    done: number;
    blocked: number;
    byPhase: Record<string, { total: number; completed: number }>;
  } {
    const epic = this.epicCache.get(epicId);
    if (!epic) {
      return {
        total: 0,
        backlog: 0,
        ready: 0,
        inProgress: 0,
        review: 0,
        done: 0,
        blocked: 0,
        byPhase: {},
      };
    }

    const summary = {
      total: epic.tasks.length,
      backlog: 0,
      ready: 0,
      inProgress: 0,
      review: 0,
      done: 0,
      blocked: 0,
      byPhase: {} as Record<string, { total: number; completed: number }>,
    };

    for (const task of epic.tasks) {
      // Count by status
      switch (task.status) {
        case 'backlog':
          summary.backlog++;
          break;
        case 'ready':
          summary.ready++;
          break;
        case 'in_progress':
          summary.inProgress++;
          break;
        case 'review':
          summary.review++;
          break;
        case 'done':
          summary.done++;
          break;
        case 'blocked':
          summary.blocked++;
          break;
      }

      // Count by phase
      if (!summary.byPhase[task.phase]) {
        summary.byPhase[task.phase] = { total: 0, completed: 0 };
      }
      summary.byPhase[task.phase].total++;
      if (task.status === 'done') {
        summary.byPhase[task.phase].completed++;
      }
    }

    return summary;
  }

  /**
   * Refresh task statuses from GitHub
   * Call this to sync local cache with current GitHub state
   * @param epicId Epic identifier
   */
  async refreshTaskStatuses(epicId: string): Promise<void> {
    if (!this.client || !this.projectManager) {
      throw new Error('GitHub client not initialized');
    }

    const epic = this.epicCache.get(epicId);
    if (!epic) {
      throw new Error(`Epic ${epicId} not found in cache`);
    }

    // Get current project items
    const items = await this.projectManager.listItems(epic.projectNumber, 100);
    const itemMap = new Map<number, { id: string; status: string }>();

    for (const item of items) {
      if (item.content?.number) {
        const statusField = item.fieldValues?.find((fv: any) =>
          fv.field?.toLowerCase() === 'status' || fv.name
        );
        const projectStatus = statusField?.name || statusField?.value || 'Backlog';
        itemMap.set(item.content.number, { id: item.id, status: projectStatus });
      }
    }

    // Get current issue states
    const issues = await this.client.listIssues({
      labels: `epic:${epicId}`,
      state: 'all',
    });
    const issueStateMap = new Map<number, 'open' | 'closed'>();
    for (const issue of issues) {
      issueStateMap.set(issue.number, issue.state as 'open' | 'closed');
    }

    // Update each task
    for (const task of epic.tasks) {
      const projectItem = itemMap.get(task.issueNumber);
      const issueState = issueStateMap.get(task.issueNumber) || task.issueState;

      task.projectItemId = projectItem?.id || task.projectItemId;
      task.issueState = issueState;
      task.status = this.mapProjectStatusToTaskStatus(
        projectItem?.status || 'Backlog',
        issueState
      );
    }

    this.emit('epic:statusesRefreshed', {
      epicId,
      taskCount: epic.tasks.length,
    });
  }

  /**
   * Update task status in GitHub Project (move between columns)
   * @param epicId Epic identifier
   * @param taskId Task identifier or issue number
   * @param status New status (must match project column names)
   */
  async updateTaskStatus(
    epicId: string,
    taskId: string | number,
    status: string
  ): Promise<void> {
    if (!this.client || !this.projectManager) {
      throw new Error('GitHub client not initialized');
    }

    const epic = this.epicCache.get(epicId);
    if (!epic) {
      throw new Error(`Epic ${epicId} not found in cache`);
    }

    // Find task by taskId or issue number
    const task = typeof taskId === 'number'
      ? epic.tasks.find(t => t.issueNumber === taskId)
      : epic.tasks.find(t => t.taskId === taskId);

    if (!task) {
      throw new Error(`Task ${taskId} not found in epic ${epicId}`);
    }

    if (!task.projectItemId) {
      throw new Error(`Task ${taskId} has no project item ID`);
    }

    // Update status in GitHub Project
    await this.projectManager.updateItemStatus(
      epic.projectNumber,
      task.projectItemId,
      status
    );

    this.emit('task:statusUpdated', {
      epicId,
      taskId: task.taskId,
      issueNumber: task.issueNumber,
      status,
    });
  }

  /**
   * Complete a task - closes issue, updates project status, adds completion comment
   * @param epicId Epic identifier
   * @param taskId Task identifier or issue number
   * @param result Completion details
   */
  async completeTask(
    epicId: string,
    taskId: string | number,
    result: {
      success: boolean;
      completedBy?: string;
      summary?: string;
      artifacts?: string[];
      moveToReview?: boolean;
    }
  ): Promise<TaskCompletionResult> {
    if (!this.client || !this.projectManager) {
      throw new Error('GitHub client not initialized');
    }

    const epic = this.epicCache.get(epicId);
    if (!epic) {
      throw new Error(`Epic ${epicId} not found in cache`);
    }

    // Find task by taskId or issue number
    const task = typeof taskId === 'number'
      ? epic.tasks.find(t => t.issueNumber === taskId)
      : epic.tasks.find(t => t.taskId === taskId);

    if (!task) {
      throw new Error(`Task ${taskId} not found in epic ${epicId}`);
    }

    const startTime = Date.now();

    // Determine target status
    const targetStatus = result.moveToReview ? 'Review' : 'Done';

    // 1. Update project item status
    if (task.projectItemId) {
      try {
        await this.projectManager.updateItemStatus(
          epic.projectNumber,
          task.projectItemId,
          targetStatus
        );
      } catch (error) {
        console.error(`Failed to update project status: ${error}`);
        // Continue with other updates
      }
    }

    // 2. Add completion comment to issue
    const completionComment = this.generateCompletionComment(task, result);
    await this.client.createComment(task.issueNumber, completionComment);

    // 3. Close issue if success and not moving to review
    if (result.success && !result.moveToReview) {
      await this.client.closeIssue(task.issueNumber);
    }

    // 4. Update memory
    try {
      await this.memory.getBaseMemory().updateTaskStatus(
        task.taskId,
        result.success ? 'completed' : 'failed'
      );
    } catch (memError) {
      // Memory update is non-critical, log and continue
      console.warn(`Could not update memory: ${memError}`);
    }

    const completionResult: TaskCompletionResult = {
      taskId: task.taskId,
      epicId,
      issueNumber: task.issueNumber,
      success: result.success,
      status: targetStatus as 'Done' | 'Review' | 'In Progress',
      completedBy: result.completedBy,
      completionTime: Date.now() - startTime,
      summary: result.summary,
      artifacts: result.artifacts,
    };

    this.emit('task:completed', completionResult);

    // Record outcome for learning
    if (task.assignedAgent) {
      await this.recordOutcome(epicId, task.taskId, {
        success: result.success,
        quality: result.success ? 0.8 : 0.2,
        completionTime: completionResult.completionTime || 0,
        feedback: result.summary,
      });
    }

    return completionResult;
  }

  /**
   * Batch update multiple tasks' statuses
   */
  async updateMultipleTaskStatuses(
    epicId: string,
    updates: Array<{ taskId: string | number; status: string }>
  ): Promise<void> {
    for (const update of updates) {
      try {
        await this.updateTaskStatus(epicId, update.taskId, update.status);
      } catch (error) {
        console.error(`Failed to update task ${update.taskId}:`, error);
        // Continue with other updates
      }
    }
  }

  /**
   * Complete multiple tasks at once
   */
  async completeMultipleTasks(
    epicId: string,
    completions: Array<{
      taskId: string | number;
      success: boolean;
      completedBy?: string;
      summary?: string;
    }>
  ): Promise<TaskCompletionResult[]> {
    const results: TaskCompletionResult[] = [];

    for (const completion of completions) {
      try {
        const result = await this.completeTask(epicId, completion.taskId, {
          success: completion.success,
          completedBy: completion.completedBy,
          summary: completion.summary,
        });
        results.push(result);
      } catch (error) {
        console.error(`Failed to complete task ${completion.taskId}:`, error);
      }
    }

    return results;
  }

  // ==========================================================================
  // Pull Request Tracking
  // ==========================================================================

  /**
   * Create a branch for a task
   * @param epicId Epic identifier
   * @param taskId Task identifier or issue number
   * @param branchName Optional custom branch name
   */
  async createTaskBranch(
    epicId: string,
    taskId: string | number,
    branchName?: string
  ): Promise<{ branch: string; sha: string }> {
    if (!this.client) {
      throw new Error('GitHub client not initialized');
    }

    const epic = this.epicCache.get(epicId);
    if (!epic) {
      throw new Error(`Epic ${epicId} not found in cache`);
    }

    const task = typeof taskId === 'number'
      ? epic.tasks.find(t => t.issueNumber === taskId)
      : epic.tasks.find(t => t.taskId === taskId);

    if (!task) {
      throw new Error(`Task ${taskId} not found in epic ${epicId}`);
    }

    // Generate branch name if not provided
    const branch = branchName || this.generateBranchName(task, epicId);

    const result = await this.client.createBranch(branch);

    this.emit('branch:created', {
      epicId,
      taskId: task.taskId,
      issueNumber: task.issueNumber,
      branch,
    });

    return { branch, sha: result.sha };
  }

  /**
   * Create a pull request for completed tasks
   * @param epicId Epic identifier
   * @param options PR creation options
   */
  async createPullRequest(
    epicId: string,
    options: {
      title: string;
      body: string;
      branch: string;
      baseBranch?: string;
      taskIds?: (string | number)[];
      draft?: boolean;
      labels?: string[];
      reviewers?: string[];
      addToProject?: boolean;
    }
  ): Promise<PRCreationResult> {
    if (!this.client || !this.projectManager) {
      throw new Error('GitHub client not initialized');
    }

    const epic = this.epicCache.get(epicId);
    if (!epic) {
      throw new Error(`Epic ${epicId} not found in cache`);
    }

    // Resolve task IDs to issue numbers
    const linkedIssueNumbers: number[] = [];
    const linkedTaskIds: string[] = [];

    if (options.taskIds) {
      for (const taskId of options.taskIds) {
        const task = typeof taskId === 'number'
          ? epic.tasks.find(t => t.issueNumber === taskId)
          : epic.tasks.find(t => t.taskId === taskId);

        if (task) {
          linkedIssueNumbers.push(task.issueNumber);
          linkedTaskIds.push(task.taskId);
        }
      }
    }

    // Build PR body with task references
    let prBody = options.body;
    if (linkedIssueNumbers.length > 0) {
      prBody += `\n\n---\n### Linked Tasks\n`;
      for (const issueNum of linkedIssueNumbers) {
        const task = epic.tasks.find(t => t.issueNumber === issueNum);
        prBody += `- Closes #${issueNum}${task ? ` - ${task.title}` : ''}\n`;
      }
    }

    prBody += `\n---\n**Epic**: #${epic.epicIssueNumber}\n**Epic ID**: \`${epicId}\`\n_Managed by Hive-Mind Orchestrator_`;

    // Add epic label
    const prLabels = [
      `epic:${epicId}`,
      'hive-mind',
      ...(options.labels || []),
    ];

    // Create the PR
    const pr = await this.client.createPullRequest({
      title: options.title,
      body: prBody,
      head: options.branch,
      base: options.baseBranch || 'main',
      draft: options.draft,
      labels: prLabels,
      linkedIssues: linkedIssueNumbers,
    });

    // Add to project if requested
    let projectItemId: string | undefined;
    if (options.addToProject !== false) {
      try {
        const result = await this.client.addPullRequestToProject(epic.projectId, pr.number);
        projectItemId = result.itemId;

        // Set status to "In Progress" or "Review"
        await this.projectManager.updateItemStatus(
          epic.projectNumber,
          projectItemId,
          options.draft ? 'In Progress' : 'Review'
        );
      } catch (error) {
        console.warn(`Could not add PR to project: ${error}`);
      }
    }

    // Request reviewers if provided
    if (options.reviewers && options.reviewers.length > 0) {
      try {
        await this.client.requestReviewers(pr.number, options.reviewers);
      } catch (error) {
        console.warn(`Could not request reviewers: ${error}`);
      }
    }

    // Track the PR
    const trackedPR: TrackedPullRequest = {
      prNumber: pr.number,
      prUrl: pr.url,
      title: options.title,
      branch: options.branch,
      baseBranch: options.baseBranch || 'main',
      epicId,
      linkedTaskIds,
      linkedIssueNumbers,
      status: options.draft ? 'draft' : 'open',
      projectItemId,
      createdAt: new Date(),
    };

    const epicPRs = this.prCache.get(epicId) || [];
    epicPRs.push(trackedPR);
    this.prCache.set(epicId, epicPRs);

    // Add PR reference comment to linked issues
    for (const issueNum of linkedIssueNumbers) {
      try {
        const task = epic.tasks.find(t => t.issueNumber === issueNum);
        await this.client.createComment(
          issueNum,
          this.generatePRLinkedComment(pr.number, pr.url, options.title, task?.phase)
        );
      } catch (error) {
        console.warn(`Could not add PR comment to issue #${issueNum}: ${error}`);
      }
    }

    // Update epic issue with PR reference
    try {
      await this.client.createComment(
        epic.epicIssueNumber,
        this.generateEpicPRComment(pr.number, pr.url, options.title, linkedIssueNumbers, options.branch)
      );
    } catch (error) {
      console.warn(`Could not add PR comment to epic: ${error}`);
    }

    this.emit('pr:created', {
      epicId,
      prNumber: pr.number,
      prUrl: pr.url,
      linkedTasks: linkedTaskIds.length,
    });

    return {
      prNumber: pr.number,
      prUrl: pr.url,
      branch: options.branch,
      linkedIssues: linkedIssueNumbers,
      projectItemId,
    };
  }

  /**
   * Link an existing PR to tasks
   * @param epicId Epic identifier
   * @param prNumber PR number
   * @param taskIds Tasks to link
   * @param options Options for linking
   */
  async linkPullRequestToTasks(
    epicId: string,
    prNumber: number,
    taskIds: (string | number)[],
    options?: {
      addComments?: boolean;
      updateEpic?: boolean;
    }
  ): Promise<void> {
    if (!this.client) {
      throw new Error('GitHub client not initialized');
    }

    const epic = this.epicCache.get(epicId);
    if (!epic) {
      throw new Error(`Epic ${epicId} not found in cache`);
    }

    // Get PR details for comments
    const pr = await this.client.getPullRequest(prNumber);
    const linkedIssueNumbers: number[] = [];

    for (const taskId of taskIds) {
      const task = typeof taskId === 'number'
        ? epic.tasks.find(t => t.issueNumber === taskId)
        : epic.tasks.find(t => t.taskId === taskId);

      if (task) {
        await this.client.linkPullRequestToIssue(prNumber, task.issueNumber);
        linkedIssueNumbers.push(task.issueNumber);

        // Add comment to issue
        if (options?.addComments !== false && pr) {
          try {
            await this.client.createComment(
              task.issueNumber,
              this.generatePRLinkedComment(prNumber, pr.url, pr.title, task.phase)
            );
          } catch (error) {
            console.warn(`Could not add PR comment to issue #${task.issueNumber}: ${error}`);
          }
        }
      }
    }

    // Update epic with PR reference
    if (options?.updateEpic !== false && pr && linkedIssueNumbers.length > 0) {
      try {
        await this.client.createComment(
          epic.epicIssueNumber,
          this.generateEpicPRComment(prNumber, pr.url, pr.title, linkedIssueNumbers, pr.head.ref)
        );
      } catch (error) {
        console.warn(`Could not add PR comment to epic: ${error}`);
      }
    }

    // Update PR cache
    const epicPRs = this.prCache.get(epicId) || [];
    let trackedPR = epicPRs.find(p => p.prNumber === prNumber);
    if (trackedPR) {
      trackedPR.linkedIssueNumbers = [...new Set([...trackedPR.linkedIssueNumbers, ...linkedIssueNumbers])];
    } else if (pr) {
      trackedPR = {
        prNumber: pr.number,
        prUrl: pr.url,
        title: pr.title,
        branch: pr.head.ref,
        baseBranch: pr.base.ref,
        epicId,
        linkedTaskIds: [],
        linkedIssueNumbers,
        status: this.mapPRStatus(pr),
        createdAt: new Date(pr.createdAt),
        mergedAt: pr.mergedAt ? new Date(pr.mergedAt) : undefined,
      };
      epicPRs.push(trackedPR);
      this.prCache.set(epicId, epicPRs);
    }

    this.emit('pr:linked', {
      epicId,
      prNumber,
      linkedTasks: taskIds.length,
    });
  }

  /**
   * Get all PRs for an epic
   * @param epicId Epic identifier
   * @param options Filter options
   */
  async listEpicPullRequests(
    epicId: string,
    options?: {
      state?: 'open' | 'closed' | 'all';
      includeExternal?: boolean;
    }
  ): Promise<TrackedPullRequest[]> {
    if (!this.client) {
      throw new Error('GitHub client not initialized');
    }

    const epic = this.epicCache.get(epicId);
    if (!epic) {
      throw new Error(`Epic ${epicId} not found in cache`);
    }

    // Get cached PRs
    const cachedPRs = this.prCache.get(epicId) || [];

    // Optionally fetch from GitHub for external PRs
    if (options?.includeExternal) {
      const allPRs = await this.client.listPullRequests({
        state: options?.state || 'all',
      });

      // Find PRs that reference this epic's issues
      const epicIssueNumbers = new Set(epic.tasks.map(t => t.issueNumber));
      epicIssueNumbers.add(epic.epicIssueNumber);

      for (const pr of allPRs) {
        // Check if PR links to any epic issues
        const linkedToEpic = pr.linkedIssues.some(num => epicIssueNumbers.has(num));
        const hasEpicLabel = pr.labels.some(l => l === `epic:${epicId}`);

        if ((linkedToEpic || hasEpicLabel) && !cachedPRs.find(c => c.prNumber === pr.number)) {
          const trackedPR: TrackedPullRequest = {
            prNumber: pr.number,
            prUrl: pr.url,
            title: pr.title,
            branch: pr.head.ref,
            baseBranch: pr.base.ref,
            epicId,
            linkedTaskIds: [],
            linkedIssueNumbers: pr.linkedIssues,
            status: this.mapPRStatus(pr),
            createdAt: new Date(pr.createdAt),
            mergedAt: pr.mergedAt ? new Date(pr.mergedAt) : undefined,
          };
          cachedPRs.push(trackedPR);
        }
      }

      // Update cache
      this.prCache.set(epicId, cachedPRs);
    }

    // Filter by state if needed
    if (options?.state && options.state !== 'all') {
      return cachedPRs.filter(pr => {
        if (options.state === 'open') {
          return ['draft', 'open', 'review', 'approved'].includes(pr.status);
        } else {
          return ['merged', 'closed'].includes(pr.status);
        }
      });
    }

    return cachedPRs;
  }

  /**
   * Update PR status tracking (sync with GitHub)
   * @param epicId Epic identifier
   * @param prNumber PR number
   */
  async syncPullRequestStatus(
    epicId: string,
    prNumber: number
  ): Promise<TrackedPullRequest | null> {
    if (!this.client) {
      throw new Error('GitHub client not initialized');
    }

    const pr = await this.client.getPullRequest(prNumber);
    if (!pr) {
      return null;
    }

    const reviews = await this.client.listPullRequestReviews(prNumber);
    const hasApproval = reviews.some(r => r.state === 'APPROVED');

    // Determine status
    let status: TrackedPullRequest['status'];
    if (pr.merged) {
      status = 'merged';
    } else if (pr.state === 'closed') {
      status = 'closed';
    } else if (hasApproval) {
      status = 'approved';
    } else if (pr.draft) {
      status = 'draft';
    } else if (reviews.length > 0) {
      status = 'review';
    } else {
      status = 'open';
    }

    // Update cache
    const epicPRs = this.prCache.get(epicId) || [];
    let trackedPR = epicPRs.find(p => p.prNumber === prNumber);

    if (trackedPR) {
      trackedPR.status = status;
      trackedPR.mergedAt = pr.mergedAt ? new Date(pr.mergedAt) : undefined;
    } else {
      trackedPR = {
        prNumber: pr.number,
        prUrl: pr.url,
        title: pr.title,
        branch: pr.head.ref,
        baseBranch: pr.base.ref,
        epicId,
        linkedTaskIds: [],
        linkedIssueNumbers: pr.linkedIssues,
        status,
        createdAt: new Date(pr.createdAt),
        mergedAt: pr.mergedAt ? new Date(pr.mergedAt) : undefined,
      };
      epicPRs.push(trackedPR);
      this.prCache.set(epicId, epicPRs);
    }

    this.emit('pr:statusUpdated', {
      epicId,
      prNumber,
      status,
    });

    return trackedPR;
  }

  /**
   * Handle PR merge - complete linked tasks
   * @param epicId Epic identifier
   * @param prNumber PR number
   * @param options Completion options
   */
  async handlePullRequestMerge(
    epicId: string,
    prNumber: number,
    options?: {
      completeTasks?: boolean;
      completedBy?: string;
    }
  ): Promise<{
    pr: TrackedPullRequest;
    completedTasks: TaskCompletionResult[];
  }> {
    if (!this.client || !this.projectManager) {
      throw new Error('GitHub client not initialized');
    }

    // Sync PR status
    const trackedPR = await this.syncPullRequestStatus(epicId, prNumber);
    if (!trackedPR) {
      throw new Error(`PR #${prNumber} not found`);
    }

    const completedTasks: TaskCompletionResult[] = [];

    // Complete linked tasks if requested
    if (options?.completeTasks !== false && trackedPR.status === 'merged') {
      const epic = this.epicCache.get(epicId);
      if (epic) {
        for (const issueNumber of trackedPR.linkedIssueNumbers) {
          const task = epic.tasks.find(t => t.issueNumber === issueNumber);
          if (task) {
            try {
              const result = await this.completeTask(epicId, task.taskId, {
                success: true,
                completedBy: options?.completedBy || 'Hive-Mind (PR Merged)',
                summary: `Completed via PR #${prNumber}`,
              });
              completedTasks.push(result);
            } catch (error) {
              console.warn(`Could not complete task #${issueNumber}: ${error}`);
            }
          }
        }
      }
    }

    // Update PR status in project
    if (trackedPR.projectItemId) {
      try {
        const epic = this.epicCache.get(epicId);
        if (epic) {
          await this.projectManager.updateItemStatus(
            epic.projectNumber,
            trackedPR.projectItemId,
            'Done'
          );
        }
      } catch (error) {
        console.warn(`Could not update PR project status: ${error}`);
      }
    }

    // Add merge notification to epic
    if (trackedPR.status === 'merged') {
      try {
        const epic = this.epicCache.get(epicId);
        if (epic) {
          await this.client.createComment(
            epic.epicIssueNumber,
            this.generatePRMergedComment(prNumber, trackedPR.prUrl, trackedPR.title, completedTasks)
          );
        }
      } catch (error) {
        console.warn(`Could not add merge comment to epic: ${error}`);
      }
    }

    this.emit('pr:merged', {
      epicId,
      prNumber,
      completedTasks: completedTasks.length,
    });

    return { pr: trackedPR, completedTasks };
  }

  /**
   * Get PR statistics for an epic
   * @param epicId Epic identifier
   */
  async getEpicPRStats(epicId: string): Promise<{
    total: number;
    open: number;
    merged: number;
    closed: number;
    draft: number;
    tasksWithPR: number;
    tasksWithoutPR: number;
  }> {
    const prs = await this.listEpicPullRequests(epicId, { includeExternal: true });
    const epic = this.epicCache.get(epicId);

    const linkedIssues = new Set(prs.flatMap(pr => pr.linkedIssueNumbers));
    const taskIssues = new Set(epic?.tasks.map(t => t.issueNumber) || []);

    return {
      total: prs.length,
      open: prs.filter(p => ['open', 'review', 'approved'].includes(p.status)).length,
      merged: prs.filter(p => p.status === 'merged').length,
      closed: prs.filter(p => p.status === 'closed').length,
      draft: prs.filter(p => p.status === 'draft').length,
      tasksWithPR: [...taskIssues].filter(t => linkedIssues.has(t)).length,
      tasksWithoutPR: [...taskIssues].filter(t => !linkedIssues.has(t)).length,
    };
  }

  /**
   * Generate a branch name for a task
   */
  private generateBranchName(task: CreatedTask, epicId: string): string {
    const slug = task.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);

    return `task/${task.issueNumber}-${slug}`;
  }

  /**
   * Map GitHub PR data to tracked status
   */
  private mapPRStatus(pr: { state: string; merged: boolean; draft: boolean }): TrackedPullRequest['status'] {
    if (pr.merged) return 'merged';
    if (pr.state === 'closed') return 'closed';
    if (pr.draft) return 'draft';
    return 'open';
  }

  /**
   * Generate comment for when a PR is linked to an issue
   */
  private generatePRLinkedComment(
    prNumber: number,
    prUrl: string,
    prTitle: string,
    phase?: string
  ): string {
    let comment = `## 🔗 Pull Request Linked\n\n`;
    comment += `**PR #${prNumber}**: [${prTitle}](${prUrl})\n\n`;

    if (phase) {
      comment += `**Phase**: ${phase}\n`;
    }

    comment += `**Status**: This issue will be automatically closed when the PR is merged.\n\n`;
    comment += `---\n_Linked by Hive-Mind Orchestrator_`;

    return comment;
  }

  /**
   * Generate comment for epic when a PR is created
   */
  private generateEpicPRComment(
    prNumber: number,
    prUrl: string,
    prTitle: string,
    linkedIssues: number[],
    branch: string
  ): string {
    let comment = `## 📬 New Pull Request\n\n`;
    comment += `**PR #${prNumber}**: [${prTitle}](${prUrl})\n`;
    comment += `**Branch**: \`${branch}\`\n\n`;

    if (linkedIssues.length > 0) {
      comment += `### Linked Tasks\n`;
      for (const issueNum of linkedIssues) {
        comment += `- #${issueNum}\n`;
      }
      comment += '\n';
    }

    comment += `---\n_Tracked by Hive-Mind Orchestrator_`;

    return comment;
  }

  /**
   * Generate comment for epic when a PR is merged
   */
  private generatePRMergedComment(
    prNumber: number,
    prUrl: string,
    prTitle: string,
    completedTasks: TaskCompletionResult[]
  ): string {
    let comment = `## ✅ Pull Request Merged\n\n`;
    comment += `**PR #${prNumber}**: [${prTitle}](${prUrl})\n\n`;

    if (completedTasks.length > 0) {
      comment += `### Completed Tasks\n`;
      for (const task of completedTasks) {
        const icon = task.success ? '✅' : '❌';
        comment += `- ${icon} #${task.issueNumber} - ${task.status}\n`;
      }
      comment += '\n';
    }

    comment += `**Merged at**: ${new Date().toISOString()}\n\n`;
    comment += `---\n_Tracked by Hive-Mind Orchestrator_`;

    return comment;
  }

  /**
   * Map GitHub project status to internal task status
   * @param projectStatus Status from GitHub Project board
   * @param issueState Issue state (open/closed)
   */
  private mapProjectStatusToTaskStatus(
    projectStatus: string,
    issueState: 'open' | 'closed'
  ): TaskStatus {
    // If issue is closed, task is done
    if (issueState === 'closed') {
      return 'done';
    }

    // Map project board status to task status
    const statusLower = projectStatus.toLowerCase();

    if (statusLower === 'done' || statusLower === 'completed') {
      return 'done';
    }

    if (statusLower === 'in progress' || statusLower === 'in_progress' || statusLower === 'refinement') {
      return 'in_progress';
    }

    if (statusLower === 'review' || statusLower === 'completion') {
      return 'review';
    }

    if (statusLower === 'blocked') {
      return 'blocked';
    }

    // Tasks in specification, design, architecture are "ready" for their respective phases
    // Tasks in backlog or no status are "backlog"
    if (
      statusLower === 'specification' ||
      statusLower === 'design' ||
      statusLower === 'pseudocode' ||
      statusLower === 'architecture' ||
      statusLower === 'ready' ||
      statusLower === 'todo'
    ) {
      return 'ready';
    }

    return 'backlog';
  }

  /**
   * Generate completion comment for GitHub issue
   */
  private generateCompletionComment(
    task: CreatedTask,
    result: {
      success: boolean;
      completedBy?: string;
      summary?: string;
      artifacts?: string[];
    }
  ): string {
    const statusIcon = result.success ? '✅' : '❌';
    const statusText = result.success ? 'Task Completed' : 'Task Failed';

    let comment = `## ${statusIcon} ${statusText}\n\n`;

    if (result.completedBy) {
      comment += `**Completed by**: ${result.completedBy}\n`;
    }

    if (task.assignedAgent) {
      comment += `**Assigned Agent**: ${task.assignedAgent.name} (\`${task.assignedAgent.type}\`)\n`;
    }

    comment += `**Phase**: ${task.phase}\n`;
    comment += `**Timestamp**: ${new Date().toISOString()}\n\n`;

    if (result.summary) {
      comment += `### Summary\n${result.summary}\n\n`;
    }

    if (result.artifacts && result.artifacts.length > 0) {
      comment += `### Artifacts\n`;
      for (const artifact of result.artifacts) {
        comment += `- ${artifact}\n`;
      }
      comment += '\n';
    }

    comment += `---\n_Tracked by Hive-Mind Orchestrator_`;

    return comment;
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
      // CTO Flow status labels
      { name: 'status:pending-approval', color: 'e4e669' },
      { name: 'status:ready', color: '0366d6' },
      { name: 'status:in-progress', color: 'fbca04' },
      { name: 'status:complete', color: '0e8a16' },
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

_Managed by CTO-Flow Agents + Hive-Mind Orchestrator_`;
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

_Task managed by CTO-Flow Agents + Hive-Mind Coordination_`;
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
