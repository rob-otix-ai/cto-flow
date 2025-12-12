/**
 * Teammate-Project Bridge
 *
 * Bridges the CtoFlowManager with GitHub Projects for full lifecycle tracking.
 * Enables the CTO-style workflow where:
 * - Epics become GitHub Projects
 * - Tasks become GitHub Issues linked to the project
 * - Agents self-select issues based on scoring
 * - Progress syncs bidirectionally
 *
 * @module github/cto-flow-project-bridge
 */

import { EventEmitter } from 'events';
import {
  GitHubProjectManager,
  createUserProjectManager,
  createOrgProjectManager,
  DEFAULT_STATUS_MAPPING,
  type GitHubProject,
  type ProjectItem,
  type ProjectSyncState
} from './project-manager.js';
import { EpicSyncService, type GitHubConfig, type EpicSyncConfig, type IMemoryManager } from './epic-sync-service.js';
import type { OctokitClient } from './octokit-client.js';

// ============================================================================
// Type Definitions
// ============================================================================

export interface CtoFlowProjectConfig {
  github: {
    owner: string;
    repo: string;
    ownerType: 'user' | 'org';
    token?: string;
  };
  sync: {
    enabled: boolean;
    autoCreateProject: boolean;
    autoAddIssues: boolean;
    autoUpdateStatus: boolean;
    pollIntervalMs: number;
  };
  agentSelection: {
    enabled: boolean;
    autoAssign: boolean;
    minScore: number;
  };
  labels: {
    epicPrefix: string;
    taskPrefix: string;
    agentPrefix: string;
    priorityPrefix: string;
  };
}

export interface EpicProjectMapping {
  epicId: string;
  projectNumber: number;
  projectId: string;
  projectUrl: string;
  issueNumbers: number[];
  assignedAgents: Map<number, string>; // issueNumber -> agentId
  createdAt: Date;
  lastSyncAt: Date;
}

export interface AgentIssueAssignment {
  agentId: string;
  agentType: string;
  issueNumber: number;
  epicId: string;
  projectNumber: number;
  score: number;
  assignedAt: Date;
  status: 'assigned' | 'in_progress' | 'completed' | 'blocked';
}

export interface IssueForSelection {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: string;
  assignees: string[];
  epicId?: string;
  projectNumber?: number;
  requiredCapabilities: string[];
  priority: 'low' | 'medium' | 'high' | 'critical';
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_PROJECT_CONFIG: CtoFlowProjectConfig = {
  github: {
    owner: '',
    repo: '',
    ownerType: 'user'
  },
  sync: {
    enabled: true,
    autoCreateProject: true,
    autoAddIssues: true,
    autoUpdateStatus: true,
    pollIntervalMs: 60000
  },
  agentSelection: {
    enabled: true,
    autoAssign: false,
    minScore: 50
  },
  labels: {
    epicPrefix: 'epic:',
    taskPrefix: 'task:',
    agentPrefix: 'agent:',
    priorityPrefix: 'priority:'
  }
};

// ============================================================================
// Teammate-Project Bridge Class
// ============================================================================

export class CtoFlowProjectBridge extends EventEmitter {
  private config: CtoFlowProjectConfig;
  private projectManager: GitHubProjectManager;
  private epicSyncService: EpicSyncService | null = null;
  private memoryManager: IMemoryManager;
  private epicMappings: Map<string, EpicProjectMapping> = new Map();
  private agentAssignments: Map<string, AgentIssueAssignment[]> = new Map();
  private pollIntervalId?: NodeJS.Timeout;

  constructor(
    config: Partial<CtoFlowProjectConfig>,
    memoryManager: IMemoryManager
  ) {
    super();
    this.config = { ...DEFAULT_PROJECT_CONFIG, ...config };
    this.memoryManager = memoryManager;

    // Initialize project manager with token
    if (this.config.github.ownerType === 'org') {
      this.projectManager = createOrgProjectManager(
        this.config.github.owner,
        this.config.github.repo,
        this.config.github.token
      );
    } else {
      this.projectManager = createUserProjectManager(
        this.config.github.owner,
        this.config.github.repo,
        this.config.github.token
      );
    }

    // Forward events
    this.projectManager.on('project:created', (data) => this.emit('project:created', data));
    this.projectManager.on('item:added', (data) => this.emit('item:added', data));
    this.projectManager.on('error', (data) => this.emit('error', data));
  }

  // ==========================================================================
  // Epic-Project Lifecycle
  // ==========================================================================

  /**
   * Creates a GitHub Project from an epic
   * This is the main entry point for the CTO workflow
   */
  async createProjectForEpic(
    epicId: string,
    title: string,
    description: string,
    tasks?: Array<{ title: string; description: string; labels?: string[]; priority?: string }>
  ): Promise<EpicProjectMapping> {
    // 1. Create the GitHub Project
    const project = await this.projectManager.createProject({
      title: `[Epic] ${title}`,
      description: this.formatProjectDescription(epicId, description),
      epicId,
      createStatusField: true
    });

    // 2. Create the epic issue (parent tracking issue)
    const epicIssue = await this.createEpicIssue(epicId, title, description, project.number);

    // 3. Create task issues if provided
    const issueNumbers: number[] = [epicIssue.number];
    if (tasks && tasks.length > 0) {
      for (const task of tasks) {
        const taskIssue = await this.createTaskIssue(
          epicId,
          task.title,
          task.description,
          epicIssue.number,
          task.labels,
          task.priority
        );
        issueNumbers.push(taskIssue.number);

        // Add to project
        await this.projectManager.addIssueToProject(
          project.number,
          taskIssue.number,
          `${this.config.github.owner}/${this.config.github.repo}`
        );
      }
    }

    // 4. Add epic issue to project
    await this.projectManager.addIssueToProject(
      project.number,
      epicIssue.number,
      `${this.config.github.owner}/${this.config.github.repo}`
    );

    // 5. Create mapping
    const mapping: EpicProjectMapping = {
      epicId,
      projectNumber: project.number,
      projectId: project.id,
      projectUrl: project.url,
      issueNumbers,
      assignedAgents: new Map(),
      createdAt: new Date(),
      lastSyncAt: new Date()
    };

    this.epicMappings.set(epicId, mapping);

    // 6. Store mapping in memory for persistence
    await this.memoryManager.store(
      `cto-flow:project:${epicId}`,
      {
        ...mapping,
        assignedAgents: Array.from(mapping.assignedAgents.entries())
      },
      'cto-flow-projects'
    );

    this.emit('epic:projectLinked', { epicId, project, mapping });
    return mapping;
  }

  /**
   * Adds a task to an existing epic's project
   */
  async addTaskToEpic(
    epicId: string,
    title: string,
    description: string,
    labels?: string[],
    priority?: string
  ): Promise<{ issueNumber: number; itemId: string }> {
    const mapping = this.epicMappings.get(epicId);
    if (!mapping) {
      throw new Error(`No project mapping found for epic: ${epicId}`);
    }

    // Find the epic issue number (first in the list)
    const epicIssueNumber = mapping.issueNumbers[0];

    // Create the task issue
    const taskIssue = await this.createTaskIssue(
      epicId,
      title,
      description,
      epicIssueNumber,
      labels,
      priority
    );

    // Add to project
    const item = await this.projectManager.addIssueToProject(
      mapping.projectNumber,
      taskIssue.number,
      `${this.config.github.owner}/${this.config.github.repo}`
    );

    // Update mapping
    mapping.issueNumbers.push(taskIssue.number);
    mapping.lastSyncAt = new Date();

    this.emit('task:added', { epicId, issueNumber: taskIssue.number, itemId: item.id });
    return { issueNumber: taskIssue.number, itemId: item.id };
  }

  /**
   * Updates epic state and syncs to project
   */
  async updateEpicState(epicId: string, newState: string): Promise<void> {
    const mapping = this.epicMappings.get(epicId);
    if (!mapping) {
      throw new Error(`No project mapping found for epic: ${epicId}`);
    }

    // Sync state to project
    await this.projectManager.syncEpicStateToProject(
      mapping.projectNumber,
      newState
    );

    // Update epic issue labels
    await this.updateEpicIssueState(mapping.issueNumbers[0], newState);

    mapping.lastSyncAt = new Date();
    this.emit('epic:stateUpdated', { epicId, newState });
  }

  /**
   * Gets the project status summary for an epic
   */
  async getEpicProgress(epicId: string): Promise<{
    total: number;
    completed: number;
    inProgress: number;
    blocked: number;
    percentage: number;
    statusCounts: Record<string, number>;
  }> {
    const mapping = this.epicMappings.get(epicId);
    if (!mapping) {
      throw new Error(`No project mapping found for epic: ${epicId}`);
    }

    const statusCounts = await this.projectManager.getProjectStatusSummary(mapping.projectNumber);
    const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);
    const completed = statusCounts['Done'] || 0;
    const inProgress = statusCounts['In Progress'] || 0;
    const blocked = 0; // TODO: Add blocked status tracking

    return {
      total,
      completed,
      inProgress,
      blocked,
      percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
      statusCounts
    };
  }

  // ==========================================================================
  // Agent Selection & Assignment
  // ==========================================================================

  /**
   * Gets available issues for agent selection
   */
  async getAvailableIssuesForAgent(
    agentCapabilities: string[],
    agentDomains: string[]
  ): Promise<IssueForSelection[]> {
    const availableIssues: IssueForSelection[] = [];

    // Get all unassigned issues from all epic projects
    for (const [epicId, mapping] of this.epicMappings) {
      const items = await this.projectManager.listItems(mapping.projectNumber);

      for (const item of items) {
        if (!item.content || item.content.state !== 'open') continue;
        if (item.content.assignees.length > 0) continue; // Already assigned

        // Get full issue details
        const issue = await this.getIssueDetails(item.content.number);
        if (!issue) continue;

        // Parse required capabilities from labels
        const requiredCaps = issue.labels
          .filter(l => l.startsWith('requires:'))
          .map(l => l.replace('requires:', ''));

        // Parse priority
        const priorityLabel = issue.labels.find(l => l.startsWith(this.config.labels.priorityPrefix));
        const priority = priorityLabel
          ? priorityLabel.replace(this.config.labels.priorityPrefix, '') as any
          : 'medium';

        availableIssues.push({
          number: issue.number,
          title: issue.title,
          body: issue.body,
          labels: issue.labels,
          state: issue.state,
          assignees: issue.assignees,
          epicId,
          projectNumber: mapping.projectNumber,
          requiredCapabilities: requiredCaps,
          priority
        });
      }
    }

    return availableIssues;
  }

  /**
   * Assigns an agent to an issue
   */
  async assignAgentToIssue(
    agentId: string,
    agentType: string,
    issueNumber: number,
    epicId: string,
    score: number
  ): Promise<AgentIssueAssignment> {
    const mapping = this.epicMappings.get(epicId);
    if (!mapping) {
      throw new Error(`No project mapping found for epic: ${epicId}`);
    }

    // Update GitHub issue assignee
    await this.addIssueAssignee(issueNumber, agentId);

    // Add agent label
    await this.addIssueLabel(issueNumber, `${this.config.labels.agentPrefix}${agentType}`);

    // Create assignment record
    const assignment: AgentIssueAssignment = {
      agentId,
      agentType,
      issueNumber,
      epicId,
      projectNumber: mapping.projectNumber,
      score,
      assignedAt: new Date(),
      status: 'assigned'
    };

    // Store assignment
    const agentAssignments = this.agentAssignments.get(agentId) || [];
    agentAssignments.push(assignment);
    this.agentAssignments.set(agentId, agentAssignments);

    // Update mapping
    mapping.assignedAgents.set(issueNumber, agentId);

    // Store in memory
    await this.memoryManager.store(
      `cto-flow:assignment:${agentId}:${issueNumber}`,
      assignment,
      'cto-flow-assignments'
    );

    this.emit('agent:assigned', { agentId, issueNumber, epicId, score });
    return assignment;
  }

  /**
   * Updates agent's issue status
   */
  async updateAgentIssueStatus(
    agentId: string,
    issueNumber: number,
    status: 'in_progress' | 'completed' | 'blocked'
  ): Promise<void> {
    // Find the assignment
    const assignments = this.agentAssignments.get(agentId);
    const assignment = assignments?.find(a => a.issueNumber === issueNumber);

    if (!assignment) {
      throw new Error(`No assignment found for agent ${agentId} on issue #${issueNumber}`);
    }

    // Update project item status
    const projectStatus = status === 'completed' ? 'Done'
      : status === 'blocked' ? 'In Progress'  // We could add a Blocked status
      : 'In Progress';

    // Get the item ID for this issue
    const items = await this.projectManager.listItems(assignment.projectNumber);
    const item = items.find(i => i.content?.number === issueNumber);

    if (item) {
      await this.projectManager.updateItemStatus(
        assignment.projectNumber,
        item.id,
        projectStatus
      );
    }

    // Update GitHub issue state if completed
    if (status === 'completed') {
      await this.closeIssue(issueNumber);
    }

    // Update local assignment
    assignment.status = status;

    this.emit('agent:statusUpdated', { agentId, issueNumber, status });
  }

  /**
   * Gets all assignments for an agent
   */
  getAgentAssignments(agentId: string): AgentIssueAssignment[] {
    return this.agentAssignments.get(agentId) || [];
  }

  // ==========================================================================
  // PR Linkage
  // ==========================================================================

  /**
   * Links a PR to an issue and project
   */
  async linkPRToIssue(
    prNumber: number,
    issueNumber: number,
    epicId: string
  ): Promise<void> {
    const mapping = this.epicMappings.get(epicId);
    if (!mapping) {
      throw new Error(`No project mapping found for epic: ${epicId}`);
    }

    // Add PR to project
    await this.projectManager.addPRToProject(
      mapping.projectNumber,
      prNumber,
      `${this.config.github.owner}/${this.config.github.repo}`
    );

    // Add comment linking PR to issue
    await this.addIssueComment(
      issueNumber,
      `🔗 PR #${prNumber} linked to this issue`
    );

    this.emit('pr:linked', { prNumber, issueNumber, epicId });
  }

  /**
   * Handles PR merge - closes linked issues and updates status
   */
  async handlePRMerge(prNumber: number, closedIssues: number[]): Promise<void> {
    for (const issueNumber of closedIssues) {
      // Find which epic this issue belongs to
      for (const [epicId, mapping] of this.epicMappings) {
        if (mapping.issueNumbers.includes(issueNumber)) {
          // Update the project item status to Done
          const items = await this.projectManager.listItems(mapping.projectNumber);
          const item = items.find(i => i.content?.number === issueNumber);

          if (item) {
            await this.projectManager.updateItemStatus(
              mapping.projectNumber,
              item.id,
              'Done'
            );
          }

          // Find and update agent assignment if exists
          const agentId = mapping.assignedAgents.get(issueNumber);
          if (agentId) {
            await this.updateAgentIssueStatus(agentId, issueNumber, 'completed');
          }

          this.emit('issue:completedViaPR', { prNumber, issueNumber, epicId });
          break;
        }
      }
    }
  }

  // ==========================================================================
  // Synchronization
  // ==========================================================================

  /**
   * Starts automatic synchronization
   */
  startSync(): void {
    if (!this.config.sync.enabled || this.pollIntervalId) return;

    this.pollIntervalId = setInterval(async () => {
      try {
        await this.syncAll();
      } catch (error) {
        this.emit('error', { operation: 'sync', error });
      }
    }, this.config.sync.pollIntervalMs);

    this.emit('sync:started');
  }

  /**
   * Stops automatic synchronization
   */
  stopSync(): void {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = undefined;
      this.emit('sync:stopped');
    }
  }

  /**
   * Syncs all epic-project mappings
   */
  async syncAll(): Promise<void> {
    for (const [epicId, mapping] of this.epicMappings) {
      try {
        await this.syncEpicProject(epicId);
      } catch (error) {
        console.error(`Failed to sync epic ${epicId}:`, error);
      }
    }
  }

  /**
   * Syncs a single epic-project mapping
   */
  async syncEpicProject(epicId: string): Promise<void> {
    const mapping = this.epicMappings.get(epicId);
    if (!mapping) return;

    // Get current project state
    const items = await this.projectManager.listItems(mapping.projectNumber);

    // Update issue numbers from project
    const issueNumbers = items
      .filter(item => item.type === 'ISSUE' && item.content)
      .map(item => item.content!.number);

    mapping.issueNumbers = issueNumbers;
    mapping.lastSyncAt = new Date();

    // Determine epic state from project
    const derivedState = await this.projectManager.determineEpicStateFromProject(
      mapping.projectNumber
    );

    this.emit('sync:completed', { epicId, derivedState, itemCount: items.length });
  }

  // ==========================================================================
  // GitHub API Helpers (using Octokit)
  // ==========================================================================

  /**
   * Gets the OctokitClient for direct API access
   */
  private getClient(): OctokitClient {
    return this.projectManager.getClient();
  }

  private async createEpicIssue(
    epicId: string,
    title: string,
    description: string,
    projectNumber: number
  ): Promise<{ number: number; url: string }> {
    const labels = [
      `${this.config.labels.epicPrefix}${epicId}`,
      'epic',
      'tracking'
    ];

    const body = `# ${title}\n\n${description}\n\n---\n**Epic ID**: \`${epicId}\`\n**Project**: #${projectNumber}\n\n_Managed by CTO-Flow Agents_`;

    const result = await this.getClient().createIssue(
      `[EPIC] ${title}`,
      body,
      labels
    );

    return { number: result.number, url: result.url };
  }

  private async createTaskIssue(
    epicId: string,
    title: string,
    description: string,
    parentIssueNumber: number,
    labels?: string[],
    priority?: string
  ): Promise<{ number: number; url: string }> {
    const allLabels = [
      `${this.config.labels.epicPrefix}${epicId}`,
      `${this.config.labels.taskPrefix}child`,
      ...(labels || [])
    ];

    if (priority) {
      allLabels.push(`${this.config.labels.priorityPrefix}${priority}`);
    }

    const body = `${description}\n\n---\n**Parent Epic**: #${parentIssueNumber}\n**Epic ID**: \`${epicId}\`\n\n_Task managed by CTO-Flow Agents_`;

    const result = await this.getClient().createIssue(title, body, allLabels);

    return { number: result.number, url: result.url };
  }

  private async getIssueDetails(issueNumber: number): Promise<{
    number: number;
    title: string;
    body: string;
    labels: string[];
    state: string;
    assignees: string[];
  } | null> {
    const issue = await this.getClient().getIssue(issueNumber);
    if (!issue) return null;

    return {
      number: issue.number,
      title: issue.title,
      body: issue.body,
      labels: issue.labels,
      state: issue.state.toLowerCase(),
      assignees: issue.assignees
    };
  }

  private async addIssueAssignee(issueNumber: number, assignee: string): Promise<void> {
    await this.getClient().addAssignees(issueNumber, [assignee]);
  }

  private async addIssueLabel(issueNumber: number, label: string): Promise<void> {
    await this.getClient().addLabels(issueNumber, [label]);
  }

  private async addIssueComment(issueNumber: number, comment: string): Promise<void> {
    await this.getClient().createComment(issueNumber, comment);
  }

  private async closeIssue(issueNumber: number): Promise<void> {
    await this.getClient().closeIssue(issueNumber);
  }

  private async updateEpicIssueState(issueNumber: number, state: string): Promise<void> {
    const stateLabel = `state:${state}`;
    await this.addIssueLabel(issueNumber, stateLabel);
  }

  private formatProjectDescription(epicId: string, description: string): string {
    return `${description}\n\n---\nEpic ID: ${epicId}\nManaged by CTO-Flow Agents`;
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  /**
   * Loads saved mappings from memory
   */
  async loadMappings(): Promise<void> {
    // This would load from memory manager on startup
    // Implementation depends on memory manager's query capabilities
  }

  /**
   * Gets an epic mapping
   */
  getEpicMapping(epicId: string): EpicProjectMapping | undefined {
    return this.epicMappings.get(epicId);
  }

  /**
   * Gets all epic mappings
   */
  getAllMappings(): Map<string, EpicProjectMapping> {
    return new Map(this.epicMappings);
  }

  // ==========================================================================
  // Additional MCP Tool Support Methods
  // ==========================================================================

  /**
   * Gets all issues in a project for an epic
   */
  async getProjectIssues(epicId: string): Promise<Array<{
    number: number;
    title: string;
    state: string;
    labels: string[];
    assignees: string[];
  }>> {
    const mapping = this.epicMappings.get(epicId);
    if (!mapping) {
      throw new Error(`No project mapping found for epic: ${epicId}`);
    }

    const items = await this.projectManager.listItems(mapping.projectNumber);
    const issues: Array<{
      number: number;
      title: string;
      state: string;
      labels: string[];
      assignees: string[];
    }> = [];

    for (const item of items) {
      if (item.type === 'ISSUE' && item.content) {
        const details = await this.getIssueDetails(item.content.number);
        if (details) {
          issues.push({
            number: details.number,
            title: details.title,
            state: details.state === 'open' ? 'OPEN' : 'CLOSED',
            labels: details.labels,
            assignees: details.assignees
          });
        }
      }
    }

    return issues;
  }

  /**
   * Updates an issue's status in the project
   */
  async updateIssueStatus(
    epicId: string,
    issueNumber: number,
    updates: { status?: string; priority?: string }
  ): Promise<void> {
    const mapping = this.epicMappings.get(epicId);
    if (!mapping) {
      throw new Error(`No project mapping found for epic: ${epicId}`);
    }

    // Get the project item for this issue
    const items = await this.projectManager.listItems(mapping.projectNumber);
    const item = items.find(i => i.content?.number === issueNumber);

    if (!item) {
      throw new Error(`Issue #${issueNumber} not found in project`);
    }

    if (updates.status) {
      await this.projectManager.updateItemStatus(
        mapping.projectNumber,
        item.id,
        updates.status
      );
    }

    if (updates.priority) {
      // Add priority label
      await this.addIssueLabel(issueNumber, `${this.config.labels.priorityPrefix}${updates.priority.toLowerCase()}`);
    }
  }

  /**
   * Unassigns an agent from an issue
   */
  async unassignAgent(agentId: string, issueNumber: number): Promise<void> {
    // Remove the assignment from local tracking
    const assignments = this.agentAssignments.get(agentId);
    if (assignments) {
      const index = assignments.findIndex(a => a.issueNumber === issueNumber);
      if (index >= 0) {
        assignments.splice(index, 1);
      }
    }

    // Update the epic mapping
    for (const [_epicId, mapping] of this.epicMappings) {
      if (mapping.assignedAgents.get(issueNumber) === agentId) {
        mapping.assignedAgents.delete(issueNumber);
        break;
      }
    }

    // Remove assignee from GitHub issue using Octokit
    try {
      await this.getClient().removeAssignees(issueNumber, [agentId]);
    } catch (error) {
      // Ignore if unassign fails (user might not be a collaborator)
      console.warn(`Failed to remove assignee from issue #${issueNumber}:`, error);
    }

    this.emit('agent:unassigned', { agentId, issueNumber });
  }

  /**
   * Gets the sync status for epics
   */
  getSyncStatus(epicId?: string): {
    isSyncing: boolean;
    intervalMs: number;
    epics: Array<{
      epicId: string;
      projectNumber: number;
      lastSyncAt: Date;
      issueCount: number;
    }>;
  } {
    const epics: Array<{
      epicId: string;
      projectNumber: number;
      lastSyncAt: Date;
      issueCount: number;
    }> = [];

    if (epicId) {
      const mapping = this.epicMappings.get(epicId);
      if (mapping) {
        epics.push({
          epicId,
          projectNumber: mapping.projectNumber,
          lastSyncAt: mapping.lastSyncAt,
          issueCount: mapping.issueNumbers.length
        });
      }
    } else {
      for (const [id, mapping] of this.epicMappings) {
        epics.push({
          epicId: id,
          projectNumber: mapping.projectNumber,
          lastSyncAt: mapping.lastSyncAt,
          issueCount: mapping.issueNumbers.length
        });
      }
    }

    return {
      isSyncing: !!this.pollIntervalId,
      intervalMs: this.config.sync.pollIntervalMs,
      epics
    };
  }

  /**
   * Starts sync for a specific epic
   */
  startEpicSync(epicId: string, intervalMs?: number): void {
    const mapping = this.epicMappings.get(epicId);
    if (!mapping) {
      throw new Error(`No project mapping found for epic: ${epicId}`);
    }

    // If not already syncing globally, start global sync
    if (!this.pollIntervalId) {
      const interval = intervalMs || this.config.sync.pollIntervalMs;
      this.config.sync.pollIntervalMs = interval;
      this.startSync();
    }

    this.emit('sync:epicStarted', { epicId });
  }

  /**
   * Stops sync for a specific epic (removes from tracking)
   */
  stopEpicSync(epicId: string): void {
    // For now, we don't support per-epic sync control
    // This is a placeholder that emits an event
    this.emit('sync:epicStopped', { epicId });
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createCtoFlowProjectBridge(
  config: Partial<CtoFlowProjectConfig>,
  memoryManager: IMemoryManager
): CtoFlowProjectBridge {
  return new CtoFlowProjectBridge(config, memoryManager);
}

export default CtoFlowProjectBridge;
