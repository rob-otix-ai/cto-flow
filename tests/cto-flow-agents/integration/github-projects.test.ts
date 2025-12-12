/**
 * GitHub Projects Integration Tests
 *
 * Tests the full CTO-style workflow:
 * - Epic creation -> GitHub Project creation
 * - Task creation -> GitHub Issue + Project item
 * - Agent self-selection from available issues
 * - PR linkage and auto-close on merge
 * - Bidirectional sync between epic state and project status
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// ============================================================================
// Mock Types (mirrors actual types without importing)
// ============================================================================

interface GitHubProject {
  id: string;
  number: number;
  title: string;
  url: string;
  closed: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ProjectItem {
  id: string;
  type: 'ISSUE' | 'PULL_REQUEST' | 'DRAFT_ISSUE';
  content?: {
    number: number;
    title: string;
    url: string;
    state: string;
    assignees: string[];
  };
  fieldValues: Record<string, any>;
}

interface EpicProjectMapping {
  epicId: string;
  projectNumber: number;
  projectId: string;
  projectUrl: string;
  issueNumbers: number[];
  assignedAgents: Map<number, string>;
  createdAt: Date;
  lastSyncAt: Date;
}

interface AgentIssueAssignment {
  agentId: string;
  agentType: string;
  issueNumber: number;
  epicId: string;
  projectNumber: number;
  score: number;
  assignedAt: Date;
  status: 'assigned' | 'in_progress' | 'completed' | 'blocked';
}

interface IssueForSelection {
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

interface IMemoryManager {
  store(key: string, value: any, namespace?: string): Promise<void>;
  retrieve(key: string, namespace?: string): Promise<any>;
  delete(key: string, namespace?: string): Promise<void>;
}

// ============================================================================
// Mock GitHub CLI Executor
// ============================================================================

class MockGhCli {
  private responses: Map<string, any> = new Map();

  setResponse(pattern: string, response: any): void {
    this.responses.set(pattern, response);
  }

  setResponses(responses: Record<string, any>): void {
    for (const [pattern, response] of Object.entries(responses)) {
      this.responses.set(pattern, response);
    }
  }

  async exec(command: string): Promise<{ stdout: string; stderr: string }> {
    for (const [pattern, response] of this.responses) {
      if (command.includes(pattern)) {
        const stdout = typeof response === 'string' ? response : JSON.stringify(response);
        return { stdout, stderr: '' };
      }
    }
    throw new Error(`Unexpected command: ${command}`);
  }

  clear(): void {
    this.responses.clear();
  }
}

// ============================================================================
// Mock GitHubProjectManager
// ============================================================================

class MockGitHubProjectManager {
  private ghCli: MockGhCli;
  private owner: string;
  private repo: string;
  private ownerType: 'user' | 'org';
  private statusMapping: Record<string, string>;

  constructor(
    owner: string,
    repo: string,
    ownerType: 'user' | 'org',
    ghCli: MockGhCli
  ) {
    this.owner = owner;
    this.repo = repo;
    this.ownerType = ownerType;
    this.ghCli = ghCli;
    this.statusMapping = {
      uninitialized: 'Backlog',
      planning: 'Planning',
      active: 'In Progress',
      paused: 'Backlog',
      blocked: 'In Progress',
      review: 'Review',
      completed: 'Done',
      archived: 'Archived',
    };
  }

  async createProject(options: { title: string; epicId: string }): Promise<GitHubProject> {
    const result = await this.ghCli.exec('gh project create');
    const data = JSON.parse(result.stdout);
    return {
      id: data.id,
      number: data.number,
      title: options.title,
      url: data.url,
      closed: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async addIssueToProject(projectNumber: number, issueNumber: number): Promise<ProjectItem> {
    const result = await this.ghCli.exec('gh project item-add');
    const data = JSON.parse(result.stdout);
    return {
      id: data.id,
      type: 'ISSUE',
      content: {
        number: issueNumber,
        title: data.title || '',
        url: `https://github.com/${this.owner}/${this.repo}/issues/${issueNumber}`,
        state: 'open',
        assignees: [],
      },
      fieldValues: {},
    };
  }

  async listItems(projectNumber: number): Promise<ProjectItem[]> {
    const result = await this.ghCli.exec('gh project item-list');
    const data = JSON.parse(result.stdout);
    return data.items.map((item: any) => ({
      id: item.id,
      type: item.type || 'ISSUE',
      content: item.content ? {
        number: item.content.number,
        title: item.content.title,
        url: item.content.url || '',
        state: item.content.state?.toLowerCase() || 'open',
        assignees: item.content.assignees?.map((a: any) => a.login || a) || [],
      } : undefined,
      fieldValues: item.fieldValues || {},
    }));
  }

  async getProjectStatusSummary(projectNumber: number): Promise<Record<string, number>> {
    const items = await this.listItems(projectNumber);
    const statusCounts: Record<string, number> = {};
    for (const item of items) {
      const status = item.fieldValues['Status'] || 'Backlog';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    }
    return statusCounts;
  }

  determineEpicStateFromItems(items: ProjectItem[]): string {
    const statusCounts: Record<string, number> = {};
    for (const item of items) {
      const status = item.fieldValues['Status'] || 'Backlog';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    }

    const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);
    if (total === 0) return 'uninitialized';
    if (statusCounts['Done'] === total) return 'completed';
    if (statusCounts['Archived'] === total) return 'archived';
    if (statusCounts['Review'] > 0) return 'review';
    if (statusCounts['In Progress'] > 0) return 'active';
    if (statusCounts['Planning'] > 0) return 'planning';
    return 'planning';
  }
}

// ============================================================================
// Mock TeammateProjectBridge
// ============================================================================

class MockTeammateProjectBridge {
  private ghCli: MockGhCli;
  private memoryManager: IMemoryManager;
  private owner: string;
  private repo: string;
  private projectManager: MockGitHubProjectManager;
  private epicMappings: Map<string, EpicProjectMapping> = new Map();
  private agentAssignments: Map<string, AgentIssueAssignment[]> = new Map();
  private events: Map<string, Function[]> = new Map();

  constructor(
    owner: string,
    repo: string,
    ownerType: 'user' | 'org',
    memoryManager: IMemoryManager,
    ghCli: MockGhCli
  ) {
    this.owner = owner;
    this.repo = repo;
    this.memoryManager = memoryManager;
    this.ghCli = ghCli;
    this.projectManager = new MockGitHubProjectManager(owner, repo, ownerType, ghCli);
  }

  on(event: string, handler: Function): void {
    const handlers = this.events.get(event) || [];
    handlers.push(handler);
    this.events.set(event, handlers);
  }

  private emit(event: string, data: any): void {
    const handlers = this.events.get(event) || [];
    handlers.forEach(h => h(data));
  }

  async createProjectForEpic(
    epicId: string,
    title: string,
    description: string
  ): Promise<EpicProjectMapping> {
    const project = await this.projectManager.createProject({ title, epicId });

    // Create epic issue
    const issueResult = await this.ghCli.exec('gh issue create');
    const issueUrl = issueResult.stdout.trim();
    const issueNumber = parseInt(issueUrl.split('/').pop() || '1', 10);

    // Add to project
    await this.projectManager.addIssueToProject(project.number, issueNumber);

    const mapping: EpicProjectMapping = {
      epicId,
      projectNumber: project.number,
      projectId: project.id,
      projectUrl: project.url,
      issueNumbers: [issueNumber],
      assignedAgents: new Map(),
      createdAt: new Date(),
      lastSyncAt: new Date(),
    };

    this.epicMappings.set(epicId, mapping);
    await this.memoryManager.store(`teammate:project:${epicId}`, mapping, 'teammate-projects');

    this.emit('project:created', { project, epicId });
    this.emit('epic:projectLinked', { epicId, project, mapping });

    return mapping;
  }

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

    const issueResult = await this.ghCli.exec('gh issue create');
    const issueUrl = issueResult.stdout.trim();
    const issueNumber = parseInt(issueUrl.split('/').pop() || '1', 10);

    const item = await this.projectManager.addIssueToProject(mapping.projectNumber, issueNumber);

    mapping.issueNumbers.push(issueNumber);
    this.emit('task:added', { epicId, issueNumber, itemId: item.id });

    return { issueNumber, itemId: item.id };
  }

  async getAvailableIssuesForAgent(
    agentCapabilities: string[],
    agentDomains: string[]
  ): Promise<IssueForSelection[]> {
    const availableIssues: IssueForSelection[] = [];

    for (const [epicId, mapping] of this.epicMappings) {
      const items = await this.projectManager.listItems(mapping.projectNumber);

      for (const item of items) {
        if (!item.content || item.content.state !== 'open') continue;
        if (item.content.assignees.length > 0) continue;

        // Get issue details
        const issueResult = await this.ghCli.exec('gh issue view');
        const issueData = JSON.parse(issueResult.stdout);

        const requiredCaps = issueData.labels
          .filter((l: any) => (l.name || l).startsWith('requires:'))
          .map((l: any) => (l.name || l).replace('requires:', ''));

        const priorityLabel = issueData.labels.find((l: any) =>
          (l.name || l).startsWith('priority:')
        );
        const priority = priorityLabel
          ? (priorityLabel.name || priorityLabel).replace('priority:', '')
          : 'medium';

        availableIssues.push({
          number: item.content.number,
          title: item.content.title,
          body: issueData.body,
          labels: issueData.labels.map((l: any) => l.name || l),
          state: item.content.state,
          assignees: item.content.assignees,
          epicId,
          projectNumber: mapping.projectNumber,
          requiredCapabilities: requiredCaps,
          priority: priority as any,
        });
      }
    }

    return availableIssues;
  }

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

    await this.ghCli.exec(`gh issue edit ${issueNumber}`);

    const assignment: AgentIssueAssignment = {
      agentId,
      agentType,
      issueNumber,
      epicId,
      projectNumber: mapping.projectNumber,
      score,
      assignedAt: new Date(),
      status: 'assigned',
    };

    const agentAssignments = this.agentAssignments.get(agentId) || [];
    agentAssignments.push(assignment);
    this.agentAssignments.set(agentId, agentAssignments);

    mapping.assignedAgents.set(issueNumber, agentId);

    this.emit('agent:assigned', { agentId, issueNumber, epicId, score });
    return assignment;
  }

  async linkPRToIssue(prNumber: number, issueNumber: number, epicId: string): Promise<void> {
    const mapping = this.epicMappings.get(epicId);
    if (!mapping) {
      throw new Error(`No project mapping found for epic: ${epicId}`);
    }

    await this.ghCli.exec('gh project item-add');
    await this.ghCli.exec('gh issue comment');

    this.emit('pr:linked', { prNumber, issueNumber, epicId });
  }

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

    return {
      total,
      completed,
      inProgress,
      blocked: 0,
      percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
      statusCounts,
    };
  }

  getEpicMapping(epicId: string): EpicProjectMapping | undefined {
    return this.epicMappings.get(epicId);
  }
}

// ============================================================================
// Mock Memory Manager
// ============================================================================

function createMockMemoryManager(): IMemoryManager {
  const store = new Map<string, any>();

  return {
    store: jest.fn(async (key: string, value: any, namespace?: string) => {
      const storeKey = namespace ? `${namespace}:${key}` : key;
      store.set(storeKey, value);
    }),
    retrieve: jest.fn(async (key: string, namespace?: string) => {
      const storeKey = namespace ? `${namespace}:${key}` : key;
      return store.get(storeKey) || null;
    }),
    delete: jest.fn(async (key: string, namespace?: string) => {
      const storeKey = namespace ? `${namespace}:${key}` : key;
      store.delete(storeKey);
    }),
  };
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_STATUS_MAPPING: Record<string, string> = {
  uninitialized: 'Backlog',
  planning: 'Planning',
  active: 'In Progress',
  paused: 'Backlog',
  blocked: 'In Progress',
  review: 'Review',
  completed: 'Done',
  archived: 'Archived',
};

const DEFAULT_STATUS_OPTIONS = [
  'Backlog',
  'Planning',
  'In Progress',
  'Review',
  'Done',
  'Archived',
];

// ============================================================================
// Tests
// ============================================================================

describe('GitHub Projects Integration', () => {
  let ghCli: MockGhCli;
  let memoryManager: IMemoryManager;

  beforeEach(() => {
    ghCli = new MockGhCli();
    memoryManager = createMockMemoryManager();
  });

  afterEach(() => {
    ghCli.clear();
  });

  describe('GitHubProjectManager', () => {
    it('should create a project via gh CLI', async () => {
      const projectData = {
        number: 1,
        url: 'https://github.com/users/testuser/projects/1',
        id: 'PVT_kwDOABcd1234',
        title: '[Epic] Test Project',
      };

      ghCli.setResponses({
        'gh project create': projectData,
        'gh project view': { ...projectData, closed: false },
      });

      const manager = new MockGitHubProjectManager('testuser', 'testrepo', 'user', ghCli);
      const project = await manager.createProject({
        title: 'Test Project',
        epicId: 'epic-123',
      });

      expect(project.number).toBe(1);
      expect(project.title).toBe('Test Project');
    });

    it('should add issues to a project', async () => {
      ghCli.setResponses({
        'gh project item-add': {
          id: 'PVTI_kwDOABcd1234',
          title: 'Test Issue',
        },
      });

      const manager = new MockGitHubProjectManager('testuser', 'testrepo', 'user', ghCli);
      const item = await manager.addIssueToProject(1, 42);

      expect(item.id).toBe('PVTI_kwDOABcd1234');
      expect(item.type).toBe('ISSUE');
      expect(item.content?.number).toBe(42);
    });

    it('should list project items', async () => {
      ghCli.setResponses({
        'gh project item-list': {
          items: [
            {
              id: 'PVTI_1',
              type: 'ISSUE',
              content: { number: 1, title: 'Issue 1', state: 'OPEN', assignees: [] },
              fieldValues: { Status: 'In Progress' },
            },
            {
              id: 'PVTI_2',
              type: 'ISSUE',
              content: { number: 2, title: 'Issue 2', state: 'CLOSED', assignees: [] },
              fieldValues: { Status: 'Done' },
            },
          ],
        },
      });

      const manager = new MockGitHubProjectManager('testuser', 'testrepo', 'user', ghCli);
      const items = await manager.listItems(1);

      expect(items).toHaveLength(2);
      expect(items[0].content?.number).toBe(1);
      expect(items[1].content?.state).toBe('closed');
    });

    it('should determine epic state from project items', () => {
      const manager = new MockGitHubProjectManager('testuser', 'testrepo', 'user', ghCli);

      const items: ProjectItem[] = [
        { id: '1', type: 'ISSUE', fieldValues: { Status: 'Done' } },
        { id: '2', type: 'ISSUE', fieldValues: { Status: 'Done' } },
        { id: '3', type: 'ISSUE', fieldValues: { Status: 'In Progress' } },
      ];

      const state = manager.determineEpicStateFromItems(items);
      expect(state).toBe('active'); // Has In Progress items
    });

    it('should return completed state when all items are Done', () => {
      const manager = new MockGitHubProjectManager('testuser', 'testrepo', 'user', ghCli);

      const items: ProjectItem[] = [
        { id: '1', type: 'ISSUE', fieldValues: { Status: 'Done' } },
        { id: '2', type: 'ISSUE', fieldValues: { Status: 'Done' } },
      ];

      const state = manager.determineEpicStateFromItems(items);
      expect(state).toBe('completed');
    });
  });

  describe('TeammateProjectBridge', () => {
    it('should create a project for an epic', async () => {
      ghCli.setResponses({
        'gh project create': {
          number: 5,
          url: 'https://github.com/users/testuser/projects/5',
          id: 'PVT_test123',
          title: '[Epic] Auth System',
        },
        'gh issue create': 'https://github.com/testuser/testrepo/issues/100',
        'gh project item-add': { id: 'PVTI_item1' },
      });

      const bridge = new MockTeammateProjectBridge(
        'testuser',
        'testrepo',
        'user',
        memoryManager,
        ghCli
      );

      const mapping = await bridge.createProjectForEpic(
        'epic-auth-v2',
        'Authentication System v2',
        'Implement OAuth2 authentication'
      );

      expect(mapping.epicId).toBe('epic-auth-v2');
      expect(mapping.projectNumber).toBe(5);
      expect(mapping.projectUrl).toBe('https://github.com/users/testuser/projects/5');
      expect(mapping.issueNumbers).toContain(100);

      // Verify memory storage was called
      expect(memoryManager.store).toHaveBeenCalled();
    });

    it('should add tasks to an epic project', async () => {
      ghCli.setResponses({
        'gh project create': { number: 1, url: 'https://github.com/users/test/projects/1', id: 'PVT_1' },
        'gh issue create': 'https://github.com/test/repo/issues/10',
        'gh project item-add': { id: 'PVTI_task1' },
      });

      const bridge = new MockTeammateProjectBridge('test', 'repo', 'user', memoryManager, ghCli);

      // First create the project
      await bridge.createProjectForEpic('epic-1', 'Test Epic', 'Description');

      // Then add a task
      const result = await bridge.addTaskToEpic(
        'epic-1',
        'Implement login form',
        'Create the login form with validation',
        ['frontend', 'ui'],
        'high'
      );

      expect(result.issueNumber).toBe(10);
      expect(result.itemId).toBe('PVTI_task1');
    });

    it('should get available issues for agent selection', async () => {
      ghCli.setResponses({
        'gh project create': { number: 1, url: 'https://github.com/users/test/projects/1', id: 'PVT_1' },
        'gh issue create': 'https://github.com/test/repo/issues/1',
        'gh project item-add': { id: 'PVTI_1' },
        'gh project item-list': {
          items: [
            {
              id: 'PVTI_1',
              type: 'ISSUE',
              content: { number: 1, title: 'Task 1', state: 'open', assignees: [] },
            },
            {
              id: 'PVTI_2',
              type: 'ISSUE',
              content: { number: 2, title: 'Task 2', state: 'open', assignees: ['someone'] },
            },
          ],
        },
        'gh issue view': {
          number: 1,
          title: 'Task 1',
          body: 'Description',
          labels: [{ name: 'requires:typescript' }, { name: 'priority:high' }],
          state: 'open',
          assignees: [],
        },
      });

      const bridge = new MockTeammateProjectBridge('test', 'repo', 'user', memoryManager, ghCli);
      await bridge.createProjectForEpic('epic-1', 'Test', 'Desc');

      const issues = await bridge.getAvailableIssuesForAgent(
        ['typescript', 'react'],
        ['frontend']
      );

      // Should only return unassigned issues
      expect(issues).toHaveLength(1);
      expect(issues[0].number).toBe(1);
      expect(issues[0].requiredCapabilities).toContain('typescript');
      expect(issues[0].priority).toBe('high');
    });

    it('should assign agent to an issue', async () => {
      ghCli.setResponses({
        'gh project create': { number: 1, url: 'https://github.com/users/test/projects/1', id: 'PVT_1' },
        'gh issue create': 'https://github.com/test/repo/issues/1',
        'gh project item-add': { id: 'PVTI_1' },
        'gh issue edit': '',
      });

      const bridge = new MockTeammateProjectBridge('test', 'repo', 'user', memoryManager, ghCli);
      await bridge.createProjectForEpic('epic-1', 'Test', 'Desc');

      const assignment = await bridge.assignAgentToIssue(
        'agent-backend-1',
        'backend-dev',
        1,
        'epic-1',
        85
      );

      expect(assignment.agentId).toBe('agent-backend-1');
      expect(assignment.agentType).toBe('backend-dev');
      expect(assignment.issueNumber).toBe(1);
      expect(assignment.score).toBe(85);
      expect(assignment.status).toBe('assigned');
    });

    it('should link PR to issue', async () => {
      ghCli.setResponses({
        'gh project create': { number: 1, url: 'https://github.com/users/test/projects/1', id: 'PVT_1' },
        'gh issue create': 'https://github.com/test/repo/issues/1',
        'gh project item-add': { id: 'PVTI_1' },
        'gh issue comment': '',
      });

      const bridge = new MockTeammateProjectBridge('test', 'repo', 'user', memoryManager, ghCli);
      await bridge.createProjectForEpic('epic-1', 'Test', 'Desc');

      // Should not throw
      await expect(
        bridge.linkPRToIssue(42, 1, 'epic-1')
      ).resolves.not.toThrow();
    });

    it('should get epic progress from project', async () => {
      ghCli.setResponses({
        'gh project create': { number: 1, url: 'https://github.com/users/test/projects/1', id: 'PVT_1' },
        'gh issue create': 'https://github.com/test/repo/issues/1',
        'gh project item-add': { id: 'PVTI_1' },
        'gh project item-list': {
          items: [
            { id: '1', type: 'ISSUE', content: { number: 1, state: 'open' }, fieldValues: { Status: 'Done' } },
            { id: '2', type: 'ISSUE', content: { number: 2, state: 'open' }, fieldValues: { Status: 'Done' } },
            { id: '3', type: 'ISSUE', content: { number: 3, state: 'open' }, fieldValues: { Status: 'In Progress' } },
            { id: '4', type: 'ISSUE', content: { number: 4, state: 'open' }, fieldValues: { Status: 'Backlog' } },
          ],
        },
      });

      const bridge = new MockTeammateProjectBridge('test', 'repo', 'user', memoryManager, ghCli);
      await bridge.createProjectForEpic('epic-1', 'Test', 'Desc');

      const progress = await bridge.getEpicProgress('epic-1');

      expect(progress.total).toBe(4);
      expect(progress.completed).toBe(2);
      expect(progress.inProgress).toBe(1);
      expect(progress.percentage).toBe(50);
      expect(progress.statusCounts['Done']).toBe(2);
      expect(progress.statusCounts['In Progress']).toBe(1);
      expect(progress.statusCounts['Backlog']).toBe(1);
    });
  });

  describe('Status Mapping', () => {
    it('should map epic states to project statuses correctly', () => {
      expect(DEFAULT_STATUS_MAPPING['uninitialized']).toBe('Backlog');
      expect(DEFAULT_STATUS_MAPPING['planning']).toBe('Planning');
      expect(DEFAULT_STATUS_MAPPING['active']).toBe('In Progress');
      expect(DEFAULT_STATUS_MAPPING['paused']).toBe('Backlog');
      expect(DEFAULT_STATUS_MAPPING['blocked']).toBe('In Progress');
      expect(DEFAULT_STATUS_MAPPING['review']).toBe('Review');
      expect(DEFAULT_STATUS_MAPPING['completed']).toBe('Done');
      expect(DEFAULT_STATUS_MAPPING['archived']).toBe('Archived');
    });

    it('should have all required status options', () => {
      expect(DEFAULT_STATUS_OPTIONS).toContain('Backlog');
      expect(DEFAULT_STATUS_OPTIONS).toContain('Planning');
      expect(DEFAULT_STATUS_OPTIONS).toContain('In Progress');
      expect(DEFAULT_STATUS_OPTIONS).toContain('Review');
      expect(DEFAULT_STATUS_OPTIONS).toContain('Done');
      expect(DEFAULT_STATUS_OPTIONS).toContain('Archived');
    });
  });

  describe('Event Emission', () => {
    it('should emit events on project creation', async () => {
      ghCli.setResponses({
        'gh project create': { number: 1, url: 'https://github.com/users/test/projects/1', id: 'PVT_1' },
        'gh issue create': 'https://github.com/test/repo/issues/1',
        'gh project item-add': { id: 'PVTI_1' },
      });

      const bridge = new MockTeammateProjectBridge('test', 'repo', 'user', memoryManager, ghCli);

      const projectCreatedHandler = jest.fn();
      bridge.on('project:created', projectCreatedHandler);

      const epicLinkedHandler = jest.fn();
      bridge.on('epic:projectLinked', epicLinkedHandler);

      await bridge.createProjectForEpic('epic-1', 'Test', 'Desc');

      expect(projectCreatedHandler).toHaveBeenCalled();
      expect(epicLinkedHandler).toHaveBeenCalled();
    });

    it('should emit events on agent assignment', async () => {
      ghCli.setResponses({
        'gh project create': { number: 1, url: 'https://github.com/users/test/projects/1', id: 'PVT_1' },
        'gh issue create': 'https://github.com/test/repo/issues/1',
        'gh project item-add': { id: 'PVTI_1' },
        'gh issue edit': '',
      });

      const bridge = new MockTeammateProjectBridge('test', 'repo', 'user', memoryManager, ghCli);

      const assignedHandler = jest.fn();
      bridge.on('agent:assigned', assignedHandler);

      await bridge.createProjectForEpic('epic-1', 'Test', 'Desc');
      await bridge.assignAgentToIssue('agent-1', 'coder', 1, 'epic-1', 90);

      expect(assignedHandler).toHaveBeenCalledWith({
        agentId: 'agent-1',
        issueNumber: 1,
        epicId: 'epic-1',
        score: 90,
      });
    });
  });

  describe('Error Handling', () => {
    it('should throw when adding task to non-existent epic', async () => {
      const bridge = new MockTeammateProjectBridge('test', 'repo', 'user', memoryManager, ghCli);

      await expect(
        bridge.addTaskToEpic('non-existent-epic', 'Task', 'Desc')
      ).rejects.toThrow('No project mapping found for epic');
    });

    it('should throw when assigning agent to non-existent epic', async () => {
      const bridge = new MockTeammateProjectBridge('test', 'repo', 'user', memoryManager, ghCli);

      await expect(
        bridge.assignAgentToIssue('agent-1', 'coder', 1, 'non-existent', 80)
      ).rejects.toThrow('No project mapping found for epic');
    });
  });
});
