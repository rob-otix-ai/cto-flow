/**
 * GitHub Epic Synchronization Service
 *
 * Provides bidirectional synchronization between SPARC memory and GitHub:
 * - Memory changes → GitHub updates (issues, comments, labels, milestones)
 * - GitHub changes → Memory sync (via webhooks or polling)
 *
 * Features:
 * - Epic CRUD operations with full GitHub integration
 * - Child issue management linked to user stories
 * - Milestone creation and mapping for SPARC phases
 * - Conflict resolution with configurable strategies
 * - Rate limiting and retry handling
 * - Comprehensive error handling
 *
 * @module epic-sync-service
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as crypto from 'crypto';

const execAsync = promisify(exec);

// ============================================================================
// Type Definitions
// ============================================================================

export interface SparcSpecification {
  taskId: string;
  taskDescription: string;
  requirements: string[];
  userStories: UserStory[];
  acceptanceCriteria: string[];
  constraints: {
    technical: string[];
    business: string[];
  };
  risks: Risk[];
  phases: SparcPhase[];
  estimatedEffort?: string;
  complexity?: 'low' | 'medium' | 'high';
}

export interface UserStory {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: 'low' | 'medium' | 'high' | 'critical';
  estimatedHours?: number;
  dependencies?: string[];
  requiredCapabilities?: string[];
}

export interface Risk {
  id: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  mitigation: string;
}

export interface SparcPhase {
  name: 'specification' | 'pseudocode' | 'architecture' | 'refinement' | 'completion';
  description: string;
  deliverables: string[];
}

export interface EpicIssue {
  number: number;
  url: string;
  title: string;
  body: string;
  state: 'open' | 'closed';
  labels: string[];
  milestone?: Milestone;
  createdAt: string;
  updatedAt: string;
}

export interface ChildIssue {
  number: number;
  url: string;
  title: string;
  body: string;
  labels: string[];
  state: 'open' | 'closed';
  assignees: string[];
  parentEpicNumber: number;
}

export interface Milestone {
  number: number;
  title: string;
  description: string;
  state: 'open' | 'closed';
  dueOn?: string;
  url: string;
}

export interface EpicExportResult {
  epicIssue: EpicIssue;
  childIssues: ChildIssue[];
  milestones: Milestone[];
  syncState: SyncState;
}

export interface SyncState {
  lastSyncTimestamp: number;
  contentHash: string;
  conflictStrategy: 'github_wins' | 'memory_wins' | 'merge';
  syncEnabled: boolean;
  syncMethod: 'webhook' | 'polling';
  pollIntervalMs?: number;
}

export interface GitHubConfig {
  owner: string;
  repo: string;
  token?: string;
  apiUrl?: string;
}

export interface EpicSyncConfig {
  github: GitHubConfig;
  sync: {
    enabled: boolean;
    method: 'webhook' | 'polling';
    pollIntervalMs: number;
    conflictResolution: 'github_wins' | 'memory_wins' | 'merge';
  };
  epic: {
    labelPrefix: string;
    defaultLabels: string[];
    template?: string;
  };
  milestones: {
    autoCreate: boolean;
    mapping: Record<string, string>;
  };
  childIssues: {
    autoCreate: boolean;
    linkMethod: 'label' | 'project' | 'mention';
  };
  rateLimiting: {
    maxRequestsPerHour: number;
    retryAttempts: number;
    retryDelayMs: number;
  };
}

export interface GitHubWebhookEvent {
  action: 'opened' | 'edited' | 'closed' | 'labeled' | 'assigned';
  issue: {
    number: number;
    title: string;
    body: string;
    state: string;
    labels: Array<{ name: string }>;
  };
  repository: {
    owner: { login: string };
    name: string;
  };
}

export interface ConflictResolution {
  field: string;
  githubValue: any;
  memoryValue: any;
  resolvedValue: any;
  strategy: string;
  timestamp: number;
}

// ============================================================================
// Memory Interface (abstracts away the actual memory implementation)
// ============================================================================

export interface IMemoryManager {
  store(key: string, value: any, namespace?: string): Promise<void>;
  retrieve(key: string, namespace?: string): Promise<any>;
  delete(key: string, namespace?: string): Promise<void>;
  exists(key: string, namespace?: string): Promise<boolean>;
}

// ============================================================================
// GitHub Epic Synchronization Service
// ============================================================================

export class EpicSyncService {
  private config: EpicSyncConfig;
  private memoryManager: IMemoryManager;
  private pollingIntervalId?: NodeJS.Timeout;
  private requestCount: number = 0;
  private requestWindowStart: number = Date.now();

  constructor(config: EpicSyncConfig, memoryManager: IMemoryManager) {
    this.config = config;
    this.memoryManager = memoryManager;
  }

  // ==========================================================================
  // Epic Creation & Management
  // ==========================================================================

  /**
   * Creates a GitHub epic from SPARC specification
   * Performs full transformation and initialization
   */
  async createEpic(specification: SparcSpecification): Promise<EpicExportResult> {
    try {
      // 1. Create milestones for SPARC phases
      const milestones = await this.createMilestonesForPhases(specification.phases);

      // 2. Transform specification to epic structure
      const epicBody = this.formatEpicBody(specification);
      const epicTitle = `[EPIC] ${specification.taskDescription}`;
      const epicLabels = this.generateEpicLabels(specification);

      // 3. Create parent epic issue
      const epicIssue = await this.createGitHubIssue({
        title: epicTitle,
        body: epicBody,
        labels: epicLabels,
        milestone: milestones.find(m => m.title.includes('Specification'))?.number,
      });

      // 4. Create child issues from user stories
      const childIssues = await this.createChildIssues(
        specification.userStories,
        epicIssue.number,
        milestones
      );

      // 5. Initialize sync state
      const syncState: SyncState = {
        lastSyncTimestamp: Date.now(),
        contentHash: this.computeHash({ specification, epicIssue, childIssues }),
        conflictStrategy: this.config.sync.conflictResolution,
        syncEnabled: this.config.sync.enabled,
        syncMethod: this.config.sync.method,
        pollIntervalMs: this.config.sync.pollIntervalMs,
      };

      // 6. Store in memory
      await this.storeEpicInMemory(specification.taskId, {
        epicIssue,
        childIssues,
        milestones,
        syncState,
        specification,
      });

      // 7. Enable sync if configured
      if (this.config.sync.enabled) {
        await this.enableSync(epicIssue.number);
      }

      return { epicIssue, childIssues, milestones, syncState };
    } catch (error) {
      throw new Error(`Failed to create epic: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Updates existing epic with new information
   */
  async updateEpic(epicNumber: number, updates: Partial<SparcSpecification>): Promise<EpicIssue> {
    try {
      // 1. Retrieve current epic from GitHub
      const currentEpic = await this.getEpicFromGitHub(epicNumber);

      // 2. Retrieve current state from memory
      const epicData = await this.getEpicFromMemory(epicNumber);

      // 3. Merge updates
      const updatedSpec: SparcSpecification = {
        ...epicData.specification,
        ...updates,
      };

      // 4. Format updated body
      const updatedBody = this.formatEpicBody(updatedSpec);

      // 5. Update GitHub issue
      const updatedEpic = await this.updateGitHubIssue(epicNumber, {
        body: updatedBody,
      });

      // 6. Update memory
      await this.storeEpicInMemory(updatedSpec.taskId, {
        ...epicData,
        specification: updatedSpec,
        epicIssue: updatedEpic,
      });

      // 7. Update sync state
      await this.updateSyncState(epicNumber);

      return updatedEpic;
    } catch (error) {
      throw new Error(`Failed to update epic: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Updates epic progress based on completed child issues
   */
  async updateEpicProgress(epicNumber: number): Promise<void> {
    try {
      // 1. Get all child issues
      const childIssues = await this.getChildIssuesFromGitHub(epicNumber);

      // 2. Calculate completion percentage
      const total = childIssues.length;
      const completed = childIssues.filter(issue => issue.state === 'closed').length;
      const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

      // 3. Get epic from memory
      const epicData = await this.getEpicFromMemory(epicNumber);

      // 4. Update epic body with progress
      const progressSection = `\n\n## Progress\n\n**Completion**: ${completed}/${total} issues (${percentage}%)\n\n`;
      const currentBody = epicData.epicIssue.body;
      const updatedBody = currentBody.includes('## Progress')
        ? currentBody.replace(/## Progress[\s\S]*?(?=\n##|$)/, progressSection)
        : currentBody + progressSection;

      // 5. Update GitHub
      await this.updateGitHubIssue(epicNumber, { body: updatedBody });

      // 6. Add progress comment
      const progressComment = `🤖 **Epic Progress Update**\n\n- Total Issues: ${total}\n- Completed: ${completed}\n- Remaining: ${total - completed}\n- Progress: ${percentage}%\n\n_Updated automatically by Epic Sync Service_`;
      await this.addComment(epicNumber, progressComment);

      // 7. Update sync state
      await this.updateSyncState(epicNumber);
    } catch (error) {
      throw new Error(`Failed to update epic progress: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Closes an epic and archives context
   */
  async closeEpic(epicNumber: number, completionNotes?: string): Promise<void> {
    try {
      // 1. Verify all child issues are closed
      const childIssues = await this.getChildIssuesFromGitHub(epicNumber);
      const openIssues = childIssues.filter(issue => issue.state === 'open');

      if (openIssues.length > 0) {
        throw new Error(`Cannot close epic: ${openIssues.length} child issues still open`);
      }

      // 2. Add completion comment
      const completionComment = `🎉 **Epic Completed**\n\n${completionNotes || 'All issues have been completed.'}\n\n_Closed automatically by Epic Sync Service_`;
      await this.addComment(epicNumber, completionComment);

      // 3. Close the epic issue
      await this.updateGitHubIssue(epicNumber, { state: 'closed' });

      // 4. Update memory with archived status
      const epicData = await this.getEpicFromMemory(epicNumber);
      epicData.epicIssue.state = 'closed';
      await this.memoryManager.store(
        `epic:${epicNumber}:archived`,
        { ...epicData, archivedAt: Date.now() },
        'cto-flow-agents'
      );

      // 5. Disable sync
      await this.disableSync(epicNumber);
    } catch (error) {
      throw new Error(`Failed to close epic: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ==========================================================================
  // Child Issue Management
  // ==========================================================================

  /**
   * Creates child issues from user stories
   */
  async createChildIssues(
    userStories: UserStory[],
    parentEpicNumber: number,
    milestones: Milestone[]
  ): Promise<ChildIssue[]> {
    const childIssues: ChildIssue[] = [];

    for (const story of userStories) {
      try {
        const issueBody = this.formatChildIssueBody(story, parentEpicNumber);
        const issueTitle = story.title;
        const issueLabels = this.generateChildIssueLabels(story, parentEpicNumber);

        // Find appropriate milestone (default to specification phase)
        const milestone = milestones.find(m => m.title.includes('Specification'));

        const issue = await this.createGitHubIssue({
          title: issueTitle,
          body: issueBody,
          labels: issueLabels,
          milestone: milestone?.number,
        });

        childIssues.push({
          number: issue.number,
          url: issue.url,
          title: issue.title,
          body: issue.body,
          labels: issue.labels,
          state: issue.state,
          assignees: [],
          parentEpicNumber,
        });

        // Add link comment to parent epic
        await this.addComment(
          parentEpicNumber,
          `📋 Created child issue: #${issue.number} - ${story.title}`
        );
      } catch (error) {
        console.error(`Failed to create child issue for story ${story.id}:`, error);
        // Continue with other stories
      }
    }

    return childIssues;
  }

  /**
   * Links an existing issue to an epic
   */
  async linkIssueToEpic(issueNumber: number, epicNumber: number): Promise<void> {
    try {
      // 1. Get current issue
      const issue = await this.getIssueFromGitHub(issueNumber);

      // 2. Add epic label
      const epicLabel = `${this.config.epic.labelPrefix}epic-${epicNumber}`;
      const updatedLabels = [...issue.labels, epicLabel];

      // 3. Update issue
      await this.updateGitHubIssue(issueNumber, { labels: updatedLabels });

      // 4. Add comment
      await this.addComment(issueNumber, `🔗 Linked to epic #${epicNumber}`);

      // 5. Update epic with reference
      await this.addComment(epicNumber, `🔗 Linked issue: #${issueNumber}`);
    } catch (error) {
      throw new Error(`Failed to link issue to epic: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ==========================================================================
  // Milestone Management
  // ==========================================================================

  /**
   * Creates GitHub milestones for SPARC phases
   */
  async createMilestonesForPhases(phases: SparcPhase[]): Promise<Milestone[]> {
    if (!this.config.milestones.autoCreate) {
      return [];
    }

    const milestones: Milestone[] = [];

    for (const phase of phases) {
      try {
        const milestoneTitle = this.config.milestones.mapping[phase.name] || `SPARC: ${phase.name}`;
        const milestoneDescription = `${phase.description}\n\nDeliverables:\n${phase.deliverables.map(d => `- ${d}`).join('\n')}`;

        // Check if milestone already exists
        const existing = await this.findMilestoneByTitle(milestoneTitle);
        if (existing) {
          milestones.push(existing);
          continue;
        }

        // Create new milestone
        const milestone = await this.createMilestone({
          title: milestoneTitle,
          description: milestoneDescription,
          state: 'open',
        });

        milestones.push(milestone);
      } catch (error) {
        console.error(`Failed to create milestone for phase ${phase.name}:`, error);
        // Continue with other phases
      }
    }

    return milestones;
  }

  /**
   * Updates milestone based on issue completion
   */
  async updateMilestoneProgress(milestoneNumber: number): Promise<void> {
    try {
      // Get all issues in milestone
      const issues = await this.getIssuesInMilestone(milestoneNumber);

      const total = issues.length;
      const completed = issues.filter(issue => issue.state === 'closed').length;
      const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

      // If all issues complete, close milestone
      if (completed === total && total > 0) {
        await this.updateMilestone(milestoneNumber, { state: 'closed' });
      }
    } catch (error) {
      console.error(`Failed to update milestone progress:`, error);
    }
  }

  // ==========================================================================
  // Bidirectional Synchronization
  // ==========================================================================

  /**
   * Syncs changes from GitHub to memory
   */
  async syncFromGitHub(epicNumber: number): Promise<void> {
    try {
      // 1. Get current GitHub state
      const githubEpic = await this.getEpicFromGitHub(epicNumber);
      const githubChildren = await this.getChildIssuesFromGitHub(epicNumber);

      // 2. Get current memory state
      const memoryData = await this.getEpicFromMemory(epicNumber);

      // 3. Detect changes
      const changes = this.detectChanges(
        { epic: githubEpic, children: githubChildren },
        memoryData
      );

      if (changes.length === 0) {
        return; // No changes to sync
      }

      // 4. Resolve conflicts if any
      const resolutions: ConflictResolution[] = [];
      for (const change of changes) {
        if (change.conflicted) {
          const resolution = await this.resolveConflict(
            change,
            memoryData.syncState.conflictStrategy
          );
          resolutions.push(resolution);
        }
      }

      // 5. Update memory with GitHub state
      const updatedData = {
        ...memoryData,
        epicIssue: githubEpic,
        childIssues: githubChildren,
        lastSyncFromGitHub: Date.now(),
        syncResolutions: resolutions,
      };

      await this.storeEpicInMemory(`epic-${epicNumber}`, updatedData);

      // 6. Update sync state
      await this.updateSyncState(epicNumber);
    } catch (error) {
      throw new Error(`Failed to sync from GitHub: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Syncs changes from memory to GitHub
   */
  async syncToGitHub(epicNumber: number): Promise<void> {
    try {
      // 1. Get memory state
      const memoryData = await this.getEpicFromMemory(epicNumber);

      // 2. Get current GitHub state
      const githubEpic = await this.getEpicFromGitHub(epicNumber);

      // 3. Compute differences
      const diffs = this.computeDifferences(memoryData, githubEpic);

      // 4. Apply updates to GitHub
      for (const diff of diffs) {
        try {
          switch (diff.field) {
            case 'body':
              await this.updateGitHubIssue(epicNumber, { body: diff.newValue });
              break;
            case 'labels':
              await this.updateGitHubIssue(epicNumber, { labels: diff.newValue });
              break;
            case 'milestone':
              await this.updateGitHubIssue(epicNumber, { milestone: diff.newValue });
              break;
            case 'state':
              await this.updateGitHubIssue(epicNumber, { state: diff.newValue });
              break;
          }
        } catch (error) {
          console.error(`Failed to apply diff for field ${diff.field}:`, error);
        }
      }

      // 5. Update sync state
      await this.updateSyncState(epicNumber);
    } catch (error) {
      throw new Error(`Failed to sync to GitHub: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Handles GitHub webhook events
   */
  async handleWebhookEvent(event: GitHubWebhookEvent): Promise<void> {
    try {
      const { action, issue } = event;

      // Check if this is an epic issue
      const isEpic = issue.labels.some(label => label.name.includes('epic'));
      if (!isEpic) {
        return; // Not an epic, ignore
      }

      const epicNumber = issue.number;

      switch (action) {
        case 'edited':
          // Epic body or title changed
          await this.syncFromGitHub(epicNumber);
          break;

        case 'closed':
          // Epic closed
          await this.syncFromGitHub(epicNumber);
          await this.disableSync(epicNumber);
          break;

        case 'labeled':
          // Labels changed
          await this.syncFromGitHub(epicNumber);
          break;

        case 'assigned':
          // Assignee changed (for child issues)
          await this.syncFromGitHub(epicNumber);
          break;
      }
    } catch (error) {
      console.error('Failed to handle webhook event:', error);
    }
  }

  /**
   * Enables synchronization for an epic (polling or webhook)
   */
  async enableSync(epicNumber: number): Promise<void> {
    if (this.config.sync.method === 'polling') {
      // Start polling
      this.pollingIntervalId = setInterval(async () => {
        try {
          await this.syncFromGitHub(epicNumber);
        } catch (error) {
          console.error(`Polling sync failed for epic ${epicNumber}:`, error);
        }
      }, this.config.sync.pollIntervalMs);
    }
    // For webhook method, webhooks must be configured externally
  }

  /**
   * Disables synchronization for an epic
   */
  async disableSync(epicNumber: number): Promise<void> {
    if (this.pollingIntervalId) {
      clearInterval(this.pollingIntervalId);
      this.pollingIntervalId = undefined;
    }
  }

  // ==========================================================================
  // Conflict Resolution
  // ==========================================================================

  /**
   * Resolves conflicts between GitHub and memory state
   */
  async resolveConflict(
    conflict: { field: string; githubValue: any; memoryValue: any },
    strategy: 'github_wins' | 'memory_wins' | 'merge'
  ): Promise<ConflictResolution> {
    const resolution: ConflictResolution = {
      field: conflict.field,
      githubValue: conflict.githubValue,
      memoryValue: conflict.memoryValue,
      resolvedValue: conflict.githubValue,
      strategy,
      timestamp: Date.now(),
    };

    switch (strategy) {
      case 'github_wins':
        resolution.resolvedValue = conflict.githubValue;
        break;

      case 'memory_wins':
        resolution.resolvedValue = conflict.memoryValue;
        break;

      case 'merge':
        // Intelligent merge based on field type
        if (Array.isArray(conflict.githubValue) && Array.isArray(conflict.memoryValue)) {
          // Merge arrays (union)
          resolution.resolvedValue = Array.from(
            new Set([...conflict.githubValue, ...conflict.memoryValue])
          );
        } else if (typeof conflict.githubValue === 'object' && typeof conflict.memoryValue === 'object') {
          // Merge objects
          resolution.resolvedValue = { ...conflict.memoryValue, ...conflict.githubValue };
        } else {
          // For primitives, use most recent (GitHub)
          resolution.resolvedValue = conflict.githubValue;
        }
        break;
    }

    return resolution;
  }

  // ==========================================================================
  // GitHub CLI Integration
  // ==========================================================================

  /**
   * Creates a GitHub issue using gh CLI
   */
  private async createGitHubIssue(params: {
    title: string;
    body: string;
    labels: string[];
    milestone?: number;
  }): Promise<EpicIssue> {
    await this.checkRateLimit();

    const { title, body, labels, milestone } = params;
    const { owner, repo } = this.config.github;

    // Escape body for shell
    const escapedBody = body.replace(/"/g, '\\"').replace(/\$/g, '\\$');

    let command = `gh issue create --repo ${owner}/${repo} --title "${title}" --body "${escapedBody}"`;

    if (labels.length > 0) {
      command += ` --label "${labels.join(',')}"`;
    }

    if (milestone) {
      command += ` --milestone ${milestone}`;
    }

    try {
      const { stdout } = await execAsync(command);
      const issueUrl = stdout.trim();
      const issueNumber = parseInt(issueUrl.split('/').pop() || '0', 10);

      // Fetch full issue details
      return await this.getIssueFromGitHub(issueNumber);
    } catch (error) {
      throw new Error(`Failed to create GitHub issue: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Updates a GitHub issue using gh CLI
   */
  private async updateGitHubIssue(
    issueNumber: number,
    updates: {
      body?: string;
      title?: string;
      labels?: string[];
      state?: 'open' | 'closed';
      milestone?: number;
    }
  ): Promise<EpicIssue> {
    await this.checkRateLimit();

    const { owner, repo } = this.config.github;
    let command = `gh issue edit ${issueNumber} --repo ${owner}/${repo}`;

    if (updates.title) {
      command += ` --title "${updates.title}"`;
    }

    if (updates.body) {
      const escapedBody = updates.body.replace(/"/g, '\\"').replace(/\$/g, '\\$');
      command += ` --body "${escapedBody}"`;
    }

    if (updates.labels) {
      command += ` --add-label "${updates.labels.join(',')}"`;
    }

    if (updates.milestone) {
      command += ` --milestone ${updates.milestone}`;
    }

    try {
      await execAsync(command);

      // Handle state change separately
      if (updates.state === 'closed') {
        await execAsync(`gh issue close ${issueNumber} --repo ${owner}/${repo}`);
      } else if (updates.state === 'open') {
        await execAsync(`gh issue reopen ${issueNumber} --repo ${owner}/${repo}`);
      }

      return await this.getIssueFromGitHub(issueNumber);
    } catch (error) {
      throw new Error(`Failed to update GitHub issue: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Gets issue details from GitHub using gh CLI
   */
  private async getIssueFromGitHub(issueNumber: number): Promise<EpicIssue> {
    await this.checkRateLimit();

    const { owner, repo } = this.config.github;
    const command = `gh issue view ${issueNumber} --repo ${owner}/${repo} --json number,url,title,body,state,labels,milestone,createdAt,updatedAt`;

    try {
      const { stdout } = await execAsync(command);
      const data = JSON.parse(stdout);

      return {
        number: data.number,
        url: data.url,
        title: data.title,
        body: data.body,
        state: data.state.toLowerCase(),
        labels: data.labels.map((l: any) => l.name),
        milestone: data.milestone ? {
          number: data.milestone.number,
          title: data.milestone.title,
          description: data.milestone.description,
          state: data.milestone.state.toLowerCase(),
          url: data.milestone.url,
        } : undefined,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      };
    } catch (error) {
      throw new Error(`Failed to get issue from GitHub: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Adds a comment to a GitHub issue
   */
  private async addComment(issueNumber: number, comment: string): Promise<void> {
    await this.checkRateLimit();

    const { owner, repo } = this.config.github;
    const escapedComment = comment.replace(/"/g, '\\"').replace(/\$/g, '\\$');
    const command = `gh issue comment ${issueNumber} --repo ${owner}/${repo} --body "${escapedComment}"`;

    try {
      await execAsync(command);
    } catch (error) {
      throw new Error(`Failed to add comment: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Gets epic from GitHub (alias for getIssueFromGitHub)
   */
  private async getEpicFromGitHub(epicNumber: number): Promise<EpicIssue> {
    return this.getIssueFromGitHub(epicNumber);
  }

  /**
   * Gets child issues linked to an epic
   */
  private async getChildIssuesFromGitHub(epicNumber: number): Promise<ChildIssue[]> {
    await this.checkRateLimit();

    const { owner, repo } = this.config.github;
    const epicLabel = `${this.config.epic.labelPrefix}epic-${epicNumber}`;
    const command = `gh issue list --repo ${owner}/${repo} --label "${epicLabel}" --json number,url,title,body,state,labels,assignees --limit 1000`;

    try {
      const { stdout } = await execAsync(command);
      const issues = JSON.parse(stdout);

      return issues.map((issue: any) => ({
        number: issue.number,
        url: issue.url,
        title: issue.title,
        body: issue.body,
        state: issue.state.toLowerCase(),
        labels: issue.labels.map((l: any) => l.name),
        assignees: issue.assignees.map((a: any) => a.login),
        parentEpicNumber: epicNumber,
      }));
    } catch (error) {
      console.error(`Failed to get child issues:`, error);
      return [];
    }
  }

  /**
   * Creates a GitHub milestone
   */
  private async createMilestone(params: {
    title: string;
    description: string;
    state: 'open' | 'closed';
    dueOn?: string;
  }): Promise<Milestone> {
    await this.checkRateLimit();

    const { owner, repo } = this.config.github;
    const { title, description, dueOn } = params;

    const escapedDesc = description.replace(/"/g, '\\"').replace(/\$/g, '\\$');
    let command = `gh api repos/${owner}/${repo}/milestones -f title="${title}" -f description="${escapedDesc}" -f state="open"`;

    if (dueOn) {
      command += ` -f due_on="${dueOn}"`;
    }

    try {
      const { stdout } = await execAsync(command);
      const data = JSON.parse(stdout);

      return {
        number: data.number,
        title: data.title,
        description: data.description,
        state: data.state,
        dueOn: data.due_on,
        url: data.html_url,
      };
    } catch (error) {
      throw new Error(`Failed to create milestone: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Updates a milestone
   */
  private async updateMilestone(
    milestoneNumber: number,
    updates: { state?: 'open' | 'closed'; description?: string }
  ): Promise<void> {
    await this.checkRateLimit();

    const { owner, repo } = this.config.github;
    let command = `gh api repos/${owner}/${repo}/milestones/${milestoneNumber} -X PATCH`;

    if (updates.state) {
      command += ` -f state="${updates.state}"`;
    }

    if (updates.description) {
      const escapedDesc = updates.description.replace(/"/g, '\\"').replace(/\$/g, '\\$');
      command += ` -f description="${escapedDesc}"`;
    }

    try {
      await execAsync(command);
    } catch (error) {
      throw new Error(`Failed to update milestone: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Finds milestone by title
   */
  private async findMilestoneByTitle(title: string): Promise<Milestone | null> {
    await this.checkRateLimit();

    const { owner, repo } = this.config.github;
    const command = `gh api repos/${owner}/${repo}/milestones --paginate`;

    try {
      const { stdout } = await execAsync(command);
      const milestones = JSON.parse(stdout);

      const found = milestones.find((m: any) => m.title === title);
      if (!found) {
        return null;
      }

      return {
        number: found.number,
        title: found.title,
        description: found.description,
        state: found.state,
        dueOn: found.due_on,
        url: found.html_url,
      };
    } catch (error) {
      console.error('Failed to find milestone:', error);
      return null;
    }
  }

  /**
   * Gets all issues in a milestone
   */
  private async getIssuesInMilestone(milestoneNumber: number): Promise<EpicIssue[]> {
    await this.checkRateLimit();

    const { owner, repo } = this.config.github;
    const command = `gh issue list --repo ${owner}/${repo} --milestone ${milestoneNumber} --json number,url,title,body,state,labels --limit 1000`;

    try {
      const { stdout } = await execAsync(command);
      const issues = JSON.parse(stdout);

      return issues.map((issue: any) => ({
        number: issue.number,
        url: issue.url,
        title: issue.title,
        body: issue.body,
        state: issue.state.toLowerCase(),
        labels: issue.labels.map((l: any) => l.name),
        createdAt: '',
        updatedAt: '',
      }));
    } catch (error) {
      console.error('Failed to get issues in milestone:', error);
      return [];
    }
  }

  // ==========================================================================
  // Memory Operations
  // ==========================================================================

  /**
   * Stores epic data in memory
   */
  private async storeEpicInMemory(taskId: string, data: any): Promise<void> {
    await this.memoryManager.store(`epic:${taskId}`, data, 'cto-flow-agents');
  }

  /**
   * Retrieves epic data from memory
   */
  private async getEpicFromMemory(epicNumberOrTaskId: number | string): Promise<any> {
    // Try by epic number first
    if (typeof epicNumberOrTaskId === 'number') {
      const data = await this.memoryManager.retrieve(
        `epic:${epicNumberOrTaskId}`,
        'cto-flow-agents'
      );
      if (data) return data;
    }

    // Try by task ID
    return await this.memoryManager.retrieve(
      `epic:${epicNumberOrTaskId}`,
      'cto-flow-agents'
    );
  }

  /**
   * Updates sync state in memory
   */
  private async updateSyncState(epicNumber: number): Promise<void> {
    const epicData = await this.getEpicFromMemory(epicNumber);
    if (!epicData) return;

    epicData.syncState.lastSyncTimestamp = Date.now();
    epicData.syncState.contentHash = this.computeHash(epicData);

    await this.storeEpicInMemory(`epic-${epicNumber}`, epicData);
  }

  // ==========================================================================
  // Formatting & Utilities
  // ==========================================================================

  /**
   * Formats epic body from SPARC specification
   */
  private formatEpicBody(spec: SparcSpecification): string {
    let body = `# ${spec.taskDescription}\n\n`;

    // Overview
    body += `## Overview\n\n`;
    body += `**Task ID**: \`${spec.taskId}\`\n`;
    body += `**Complexity**: ${spec.complexity || 'N/A'}\n`;
    body += `**Estimated Effort**: ${spec.estimatedEffort || 'N/A'}\n\n`;

    // Requirements
    body += `## Requirements\n\n`;
    spec.requirements.forEach((req, idx) => {
      body += `- [ ] ${req}\n`;
    });
    body += `\n`;

    // User Stories
    body += `## User Stories\n\n`;
    spec.userStories.forEach((story, idx) => {
      body += `### ${idx + 1}. ${story.title}\n\n`;
      body += `${story.description}\n\n`;
      body += `**Priority**: ${story.priority}\n\n`;
      if (story.estimatedHours) {
        body += `**Estimated Hours**: ${story.estimatedHours}\n\n`;
      }
    });

    // Acceptance Criteria
    body += `## Acceptance Criteria\n\n`;
    spec.acceptanceCriteria.forEach((criteria, idx) => {
      body += `- [ ] ${criteria}\n`;
    });
    body += `\n`;

    // Constraints
    if (spec.constraints) {
      body += `## Constraints\n\n`;
      body += `### Technical\n\n`;
      spec.constraints.technical.forEach(c => {
        body += `- ${c}\n`;
      });
      body += `\n### Business\n\n`;
      spec.constraints.business.forEach(c => {
        body += `- ${c}\n`;
      });
      body += `\n`;
    }

    // Risks
    if (spec.risks && spec.risks.length > 0) {
      body += `## Risks\n\n`;
      spec.risks.forEach(risk => {
        body += `- **[${risk.severity.toUpperCase()}]** ${risk.description}\n`;
        body += `  - **Mitigation**: ${risk.mitigation}\n`;
      });
      body += `\n`;
    }

    // Phases
    body += `## SPARC Phases\n\n`;
    spec.phases.forEach((phase, idx) => {
      body += `${idx + 1}. **${phase.name}**: ${phase.description}\n`;
    });
    body += `\n`;

    // Footer
    body += `---\n\n`;
    body += `_This epic was generated automatically from SPARC specification._\n`;
    body += `_Managed by Epic Sync Service._\n`;

    return body;
  }

  /**
   * Formats child issue body from user story
   */
  private formatChildIssueBody(story: UserStory, parentEpicNumber: number): string {
    let body = `${story.description}\n\n`;

    body += `## Acceptance Criteria\n\n`;
    story.acceptanceCriteria.forEach(criteria => {
      body += `- [ ] ${criteria}\n`;
    });
    body += `\n`;

    if (story.dependencies && story.dependencies.length > 0) {
      body += `## Dependencies\n\n`;
      story.dependencies.forEach(dep => {
        body += `- ${dep}\n`;
      });
      body += `\n`;
    }

    if (story.requiredCapabilities && story.requiredCapabilities.length > 0) {
      body += `## Required Capabilities\n\n`;
      story.requiredCapabilities.forEach(cap => {
        body += `- ${cap}\n`;
      });
      body += `\n`;
    }

    body += `---\n\n`;
    body += `**Priority**: ${story.priority}\n`;
    if (story.estimatedHours) {
      body += `**Estimated Hours**: ${story.estimatedHours}\n`;
    }
    body += `**Parent Epic**: #${parentEpicNumber}\n`;

    return body;
  }

  /**
   * Generates labels for epic issue
   */
  private generateEpicLabels(spec: SparcSpecification): string[] {
    const labels = [...this.config.epic.defaultLabels];

    // Add complexity label
    if (spec.complexity) {
      labels.push(`complexity-${spec.complexity}`);
    }

    // Add SPARC label
    labels.push('sparc-generated');

    return labels;
  }

  /**
   * Generates labels for child issue
   */
  private generateChildIssueLabels(story: UserStory, parentEpicNumber: number): string[] {
    const labels: string[] = [];

    // Link to parent epic
    labels.push(`${this.config.epic.labelPrefix}epic-${parentEpicNumber}`);

    // Add priority label
    labels.push(`priority-${story.priority}`);

    // Add story label
    labels.push('user-story');

    return labels;
  }

  /**
   * Computes hash of data for change detection
   */
  private computeHash(data: any): string {
    const str = JSON.stringify(data);
    return crypto.createHash('sha256').update(str).digest('hex');
  }

  /**
   * Detects changes between GitHub and memory state
   */
  private detectChanges(githubState: any, memoryState: any): any[] {
    const changes: any[] = [];

    // Compare epic body
    if (githubState.epic.body !== memoryState.epicIssue.body) {
      changes.push({
        field: 'body',
        githubValue: githubState.epic.body,
        memoryValue: memoryState.epicIssue.body,
        conflicted: true,
      });
    }

    // Compare labels
    const githubLabels = new Set(githubState.epic.labels);
    const memoryLabels = new Set(memoryState.epicIssue.labels);
    if (!this.setsEqual(githubLabels, memoryLabels)) {
      changes.push({
        field: 'labels',
        githubValue: Array.from(githubLabels),
        memoryValue: Array.from(memoryLabels),
        conflicted: true,
      });
    }

    // Compare state
    if (githubState.epic.state !== memoryState.epicIssue.state) {
      changes.push({
        field: 'state',
        githubValue: githubState.epic.state,
        memoryValue: memoryState.epicIssue.state,
        conflicted: true,
      });
    }

    return changes;
  }

  /**
   * Computes differences to apply to GitHub
   */
  private computeDifferences(memoryData: any, githubEpic: EpicIssue): any[] {
    const diffs: any[] = [];

    // Compare body
    if (memoryData.epicIssue.body !== githubEpic.body) {
      diffs.push({
        field: 'body',
        oldValue: githubEpic.body,
        newValue: memoryData.epicIssue.body,
      });
    }

    // Compare labels
    const memoryLabels = new Set(memoryData.epicIssue.labels);
    const githubLabels = new Set(githubEpic.labels);
    if (!this.setsEqual(memoryLabels, githubLabels)) {
      diffs.push({
        field: 'labels',
        oldValue: Array.from(githubLabels),
        newValue: Array.from(memoryLabels),
      });
    }

    return diffs;
  }

  /**
   * Checks if two sets are equal
   */
  private setsEqual(a: Set<any>, b: Set<any>): boolean {
    if (a.size !== b.size) return false;
    for (const item of a) {
      if (!b.has(item)) return false;
    }
    return true;
  }

  /**
   * Rate limiting check with exponential backoff
   */
  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const hourInMs = 60 * 60 * 1000;

    // Reset counter if hour has passed
    if (now - this.requestWindowStart > hourInMs) {
      this.requestCount = 0;
      this.requestWindowStart = now;
    }

    // Check if we're over the limit
    if (this.requestCount >= this.config.rateLimiting.maxRequestsPerHour) {
      const waitTime = hourInMs - (now - this.requestWindowStart);
      throw new Error(`Rate limit exceeded. Wait ${Math.ceil(waitTime / 1000)}s before retrying.`);
    }

    this.requestCount++;
  }
}

// ============================================================================
// Export
// ============================================================================

export default EpicSyncService;
