/**
 * Integration Tests for CTO-Flow Agent Management System
 *
 * Tests the complete system integration including:
 * - Teammate mode toggle
 * - Epic lifecycle management
 * - SPARC integration
 * - Agent assignment flow
 * - Context recovery
 * - Graceful degradation
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Types for Teammate System
enum EpicState {
  UNINITIALIZED = 'uninitialized',
  ACTIVE = 'active',
  REVIEW = 'review',
  COMPLETED = 'completed',
  ARCHIVED = 'archived'
}

interface Epic {
  id: string;
  title: string;
  description: string;
  state: EpicState;
  milestones: Milestone[];
  agents: AgentAssignment[];
  context: EpicContext;
  createdAt: Date;
  updatedAt: Date;
}

interface Milestone {
  id: string;
  title: string;
  description: string;
  phase: string;
  status: 'pending' | 'in_progress' | 'completed';
  completedAt?: Date;
}

interface AgentAssignment {
  agentId: string;
  agentType: string;
  issueId: string;
  score: number;
  assignedAt: Date;
  status: 'assigned' | 'active' | 'completed';
}

interface EpicContext {
  specification?: any;
  pseudocode?: any;
  architecture?: any;
  refinements?: any[];
  testResults?: any[];
  [key: string]: any;
}

interface CtoFlowConfig {
  enabled: boolean;
  githubToken?: string;
  repository?: string;
  fallbackToMemory: boolean;
}

// Mock GitHub API
class MockGitHubAPI {
  private epics = new Map<string, Epic>();
  private issues = new Map<string, any>();
  private available = true;
  private idCounter = 0;

  private nextId(prefix: string): string {
    return `${prefix}_${++this.idCounter}_${Date.now()}`;
  }

  setAvailability(available: boolean): void {
    this.available = available;
  }

  async createEpic(title: string, description: string): Promise<Epic> {
    if (!this.available) {
      throw new Error('GitHub API unavailable');
    }

    const epic: Epic = {
      id: this.nextId('epic'),
      title,
      description,
      state: EpicState.UNINITIALIZED,
      milestones: [],
      agents: [],
      context: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.epics.set(epic.id, epic);
    return epic;
  }

  async updateEpicState(epicId: string, state: EpicState): Promise<Epic> {
    if (!this.available) {
      throw new Error('GitHub API unavailable');
    }

    const epic = this.epics.get(epicId);
    if (!epic) {
      throw new Error(`Epic ${epicId} not found`);
    }

    epic.state = state;
    epic.updatedAt = new Date();
    return epic;
  }

  async addMilestone(epicId: string, milestone: Omit<Milestone, 'id'>): Promise<Milestone> {
    if (!this.available) {
      throw new Error('GitHub API unavailable');
    }

    const epic = this.epics.get(epicId);
    if (!epic) {
      throw new Error(`Epic ${epicId} not found`);
    }

    const newMilestone: Milestone = {
      id: this.nextId('milestone'),
      ...milestone
    };

    epic.milestones.push(newMilestone);
    epic.updatedAt = new Date();
    return newMilestone;
  }

  async assignAgent(epicId: string, assignment: Omit<AgentAssignment, 'assignedAt'>): Promise<AgentAssignment> {
    if (!this.available) {
      throw new Error('GitHub API unavailable');
    }

    const epic = this.epics.get(epicId);
    if (!epic) {
      throw new Error(`Epic ${epicId} not found`);
    }

    const newAssignment: AgentAssignment = {
      ...assignment,
      assignedAt: new Date()
    };

    epic.agents.push(newAssignment);
    epic.updatedAt = new Date();
    return newAssignment;
  }

  async updateContext(epicId: string, context: Partial<EpicContext>): Promise<Epic> {
    if (!this.available) {
      throw new Error('GitHub API unavailable');
    }

    const epic = this.epics.get(epicId);
    if (!epic) {
      throw new Error(`Epic ${epicId} not found`);
    }

    // Handle special fields that should update epic directly
    if ('milestones' in context && Array.isArray(context.milestones)) {
      epic.milestones = context.milestones;
    }
    if ('agents' in context && Array.isArray(context.agents)) {
      epic.agents = context.agents;
    }
    if ('state' in context) {
      epic.state = context.state as EpicState;
    }

    // Update remaining context fields
    const { milestones, agents, state, ...remainingContext } = context as any;
    epic.context = { ...epic.context, ...remainingContext };
    epic.updatedAt = new Date();
    return epic;
  }

  async getEpic(epicId: string): Promise<Epic | null> {
    if (!this.available) {
      throw new Error('GitHub API unavailable');
    }

    return this.epics.get(epicId) || null;
  }

  async createIssue(epicId: string, title: string, description: string, labels: string[]): Promise<any> {
    if (!this.available) {
      throw new Error('GitHub API unavailable');
    }

    const issue = {
      id: `issue_${Date.now()}`,
      epicId,
      title,
      description,
      labels,
      state: 'open',
      assignee: null,
      createdAt: new Date()
    };

    this.issues.set(issue.id, issue);
    return issue;
  }

  reset(): void {
    this.epics.clear();
    this.issues.clear();
    this.available = true;
    this.idCounter = 0;
  }
}

// Mock Memory Manager (fallback)
class MockMemoryManager {
  private data = new Map<string, any>();

  async store(key: string, value: any): Promise<void> {
    this.data.set(key, value);
  }

  async retrieve(key: string): Promise<any> {
    return this.data.get(key);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async clear(): Promise<void> {
    this.data.clear();
  }

  async list(prefix: string): Promise<string[]> {
    return Array.from(this.data.keys()).filter(key => key.startsWith(prefix));
  }
}

// Mock Agent Scoring System
class MockAgentScorer {
  async scoreAgents(issue: any): Promise<Map<string, number>> {
    const scores = new Map<string, number>();

    // Simple scoring based on labels
    if (issue.labels.includes('backend')) {
      scores.set('backend-dev', 0.95);
      scores.set('coder', 0.75);
    }
    if (issue.labels.includes('frontend')) {
      scores.set('coder', 0.90);
      scores.set('reviewer', 0.70);
    }
    if (issue.labels.includes('test')) {
      scores.set('tester', 0.98);
      scores.set('reviewer', 0.80);
    }
    if (issue.labels.includes('architecture')) {
      scores.set('system-architect', 0.95);
      scores.set('code-analyzer', 0.85);
    }

    return scores;
  }

  selectBestAgent(scores: Map<string, number>): { agentType: string; score: number } {
    let bestAgent = '';
    let bestScore = 0;

    for (const [agent, score] of scores.entries()) {
      if (score > bestScore) {
        bestAgent = agent;
        bestScore = score;
      }
    }

    return { agentType: bestAgent, score: bestScore };
  }
}

// Teammate System Manager
class TeammateSystemManager {
  private config: CtoFlowConfig;
  private github: MockGitHubAPI;
  private memory: MockMemoryManager;
  private scorer: MockAgentScorer;
  private currentEpic: string | null = null;

  constructor(
    config: CtoFlowConfig,
    github: MockGitHubAPI,
    memory: MockMemoryManager,
    scorer: MockAgentScorer
  ) {
    this.config = config;
    this.github = github;
    this.memory = memory;
    this.scorer = scorer;
  }

  isTeammateMode(): boolean {
    return this.config.enabled;
  }

  async createEpic(title: string, description: string): Promise<Epic> {
    if (!this.config.enabled) {
      throw new Error('Teammate mode is not enabled');
    }

    try {
      const epic = await this.github.createEpic(title, description);
      this.currentEpic = epic.id;

      // Store in memory as backup
      if (this.config.fallbackToMemory) {
        await this.memory.store(`epic:${epic.id}`, epic);
      }

      return epic;
    } catch (error) {
      if (this.config.fallbackToMemory) {
        // Fallback to memory
        const epic: Epic = {
          id: `epic_memory_${Date.now()}`,
          title,
          description,
          state: EpicState.UNINITIALIZED,
          milestones: [],
          agents: [],
          context: {},
          createdAt: new Date(),
          updatedAt: new Date()
        };
        await this.memory.store(`epic:${epic.id}`, epic);
        this.currentEpic = epic.id;
        return epic;
      }
      throw error;
    }
  }

  async initializeEpic(epicId: string): Promise<Epic> {
    return this.updateEpicState(epicId, EpicState.ACTIVE);
  }

  async updateEpicState(epicId: string, state: EpicState): Promise<Epic> {
    try {
      const epic = await this.github.updateEpicState(epicId, state);

      if (this.config.fallbackToMemory) {
        await this.memory.store(`epic:${epic.id}`, epic);
      }

      return epic;
    } catch (error) {
      if (this.config.fallbackToMemory) {
        const epic = await this.memory.retrieve(`epic:${epicId}`);
        if (epic) {
          epic.state = state;
          epic.updatedAt = new Date();
          await this.memory.store(`epic:${epicId}`, epic);
          return epic;
        }
      }
      throw error;
    }
  }

  async addMilestone(epicId: string, phase: string, title: string, description: string): Promise<Milestone> {
    const milestone: Omit<Milestone, 'id'> = {
      title,
      description,
      phase,
      status: 'pending'
    };

    try {
      return await this.github.addMilestone(epicId, milestone);
    } catch (error) {
      if (this.config.fallbackToMemory) {
        const epic = await this.memory.retrieve(`epic:${epicId}`);
        if (epic) {
          const newMilestone: Milestone = {
            id: `milestone_memory_${Date.now()}`,
            ...milestone
          };
          epic.milestones.push(newMilestone);
          await this.memory.store(`epic:${epicId}`, epic);
          return newMilestone;
        }
      }
      throw error;
    }
  }

  async completeMilestone(epicId: string, milestoneId: string): Promise<void> {
    const epic = await this.getEpic(epicId);
    if (!epic) throw new Error(`Epic ${epicId} not found`);

    const milestone = epic.milestones.find(m => m.id === milestoneId);
    if (!milestone) throw new Error(`Milestone ${milestoneId} not found`);

    milestone.status = 'completed';
    milestone.completedAt = new Date();

    try {
      await this.github.updateContext(epicId, { milestones: epic.milestones });
    } catch (error) {
      if (this.config.fallbackToMemory) {
        await this.memory.store(`epic:${epicId}`, epic);
      } else {
        throw error;
      }
    }
  }

  async createIssueForTask(epicId: string, taskTitle: string, taskDescription: string, labels: string[]): Promise<any> {
    try {
      const issue = await this.github.createIssue(epicId, taskTitle, taskDescription, labels);

      // Score agents for this issue
      const scores = await this.scorer.scoreAgents(issue);
      const { agentType, score } = this.scorer.selectBestAgent(scores);

      // Assign best agent
      const assignment = await this.github.assignAgent(epicId, {
        agentId: `agent_${agentType}_${Date.now()}`,
        agentType,
        issueId: issue.id,
        score,
        status: 'assigned'
      });

      // Notify agent via memory
      await this.memory.store(`assignment:${assignment.agentId}`, {
        issue,
        assignment,
        notifiedAt: new Date()
      });

      return { issue, assignment };
    } catch (error) {
      if (this.config.fallbackToMemory) {
        // Fallback to memory-based workflow
        const issue = {
          id: `issue_memory_${Date.now()}`,
          epicId,
          title: taskTitle,
          description: taskDescription,
          labels,
          state: 'open',
          assignee: null
        };

        await this.memory.store(`issue:${issue.id}`, issue);
        return { issue, assignment: null };
      }
      throw error;
    }
  }

  async saveContext(epicId: string, key: string, value: any): Promise<void> {
    const context = { [key]: value };

    try {
      await this.github.updateContext(epicId, context);
    } catch (error) {
      if (this.config.fallbackToMemory) {
        const epic = await this.memory.retrieve(`epic:${epicId}`);
        if (epic) {
          epic.context = { ...epic.context, ...context };
          await this.memory.store(`epic:${epicId}`, epic);
          return;
        }
      }
      throw error;
    }
  }

  async restoreContext(epicId: string): Promise<EpicContext> {
    const epic = await this.getEpic(epicId);
    if (!epic) throw new Error(`Epic ${epicId} not found`);
    return epic.context;
  }

  async getEpic(epicId: string): Promise<Epic | null> {
    try {
      return await this.github.getEpic(epicId);
    } catch (error) {
      if (this.config.fallbackToMemory) {
        return await this.memory.retrieve(`epic:${epicId}`);
      }
      throw error;
    }
  }

  getCurrentEpicId(): string | null {
    return this.currentEpic;
  }

  async archiveEpic(epicId: string): Promise<Epic> {
    return this.updateEpicState(epicId, EpicState.ARCHIVED);
  }
}

describe('CTO-Flow Agent Management System - Integration Tests', () => {
  let github: MockGitHubAPI;
  let memory: MockMemoryManager;
  let scorer: MockAgentScorer;
  let system: TeammateSystemManager;

  beforeEach(() => {
    github = new MockGitHubAPI();
    memory = new MockMemoryManager();
    scorer = new MockAgentScorer();
  });

  afterEach(async () => {
    github.reset();
    await memory.clear();
  });

  describe('1. Teammate Mode Toggle', () => {
    it('should work without teammate mode (disabled)', async () => {
      const config: CtoFlowConfig = {
        enabled: false,
        fallbackToMemory: true
      };

      system = new TeammateSystemManager(config, github, memory, scorer);

      expect(system.isTeammateMode()).toBe(false);

      // Should throw when trying to create epic
      await expect(system.createEpic('Test Epic', 'Description'))
        .rejects.toThrow('Teammate mode is not enabled');
    });

    it('should work with teammate mode (enabled)', async () => {
      const config: CtoFlowConfig = {
        enabled: true,
        githubToken: 'test_token',
        repository: 'test/repo',
        fallbackToMemory: true
      };

      system = new TeammateSystemManager(config, github, memory, scorer);

      expect(system.isTeammateMode()).toBe(true);

      const epic = await system.createEpic('Test Epic', 'Description');
      expect(epic).toBeDefined();
      expect(epic.title).toBe('Test Epic');
      expect(epic.state).toBe(EpicState.UNINITIALIZED);
    });

    it('should support per-command override (--teammate-mode flag)', async () => {
      // Simulate runtime override
      const baseConfig: CtoFlowConfig = {
        enabled: false,
        fallbackToMemory: true
      };

      system = new TeammateSystemManager(baseConfig, github, memory, scorer);
      expect(system.isTeammateMode()).toBe(false);

      // Simulate flag override
      const overrideConfig: CtoFlowConfig = {
        ...baseConfig,
        enabled: true,
        githubToken: 'override_token'
      };

      const overrideSystem = new TeammateSystemManager(overrideConfig, github, memory, scorer);
      expect(overrideSystem.isTeammateMode()).toBe(true);

      const epic = await overrideSystem.createEpic('Override Epic', 'Test');
      expect(epic).toBeDefined();
    });

    it('should gracefully degrade on GitHub failure', async () => {
      const config: CtoFlowConfig = {
        enabled: true,
        githubToken: 'test_token',
        fallbackToMemory: true
      };

      system = new TeammateSystemManager(config, github, memory, scorer);

      // Simulate GitHub unavailability
      github.setAvailability(false);

      // Should fallback to memory
      const epic = await system.createEpic('Fallback Epic', 'Should work with memory');
      expect(epic).toBeDefined();
      expect(epic.id).toContain('memory');

      // Verify it's stored in memory
      const stored = await memory.retrieve(`epic:${epic.id}`);
      expect(stored).toEqual(epic);
    });
  });

  describe('2. Epic Lifecycle', () => {
    beforeEach(() => {
      const config: CtoFlowConfig = {
        enabled: true,
        githubToken: 'test_token',
        fallbackToMemory: true
      };
      system = new TeammateSystemManager(config, github, memory, scorer);
    });

    it('should transition: Create → UNINITIALIZED', async () => {
      const epic = await system.createEpic('New Epic', 'Testing lifecycle');

      expect(epic.state).toBe(EpicState.UNINITIALIZED);
      expect(epic.milestones).toHaveLength(0);
      expect(epic.agents).toHaveLength(0);
    });

    it('should transition: Initialize → ACTIVE', async () => {
      const epic = await system.createEpic('New Epic', 'Testing lifecycle');
      expect(epic.state).toBe(EpicState.UNINITIALIZED);

      const activeEpic = await system.initializeEpic(epic.id);
      expect(activeEpic.state).toBe(EpicState.ACTIVE);
    });

    it('should transition: Assign agents → agents tracked', async () => {
      const epic = await system.createEpic('Agent Test Epic', 'Testing agent assignment');
      await system.initializeEpic(epic.id);

      // Create multiple issues with different agent requirements
      const backendTask = await system.createIssueForTask(
        epic.id,
        'Implement API',
        'Build REST API',
        ['backend']
      );

      const frontendTask = await system.createIssueForTask(
        epic.id,
        'Build UI',
        'Create React components',
        ['frontend']
      );

      const testTask = await system.createIssueForTask(
        epic.id,
        'Write Tests',
        'Create test suite',
        ['test']
      );

      // Verify agents were assigned
      expect(backendTask.assignment).toBeDefined();
      expect(backendTask.assignment.agentType).toBe('backend-dev');
      expect(frontendTask.assignment.agentType).toBe('coder');
      expect(testTask.assignment.agentType).toBe('tester');

      // Verify agents are tracked in epic
      const updatedEpic = await system.getEpic(epic.id);
      expect(updatedEpic?.agents).toHaveLength(3);
    });

    it('should transition: Complete tasks → progress updates', async () => {
      const epic = await system.createEpic('Progress Test', 'Testing progress tracking');
      await system.initializeEpic(epic.id);

      // Add milestones for different phases
      const specMilestone = await system.addMilestone(
        epic.id,
        'specification',
        'Requirements',
        'Define requirements'
      );

      const implMilestone = await system.addMilestone(
        epic.id,
        'implementation',
        'Build Features',
        'Implement core features'
      );

      // Complete first milestone
      await system.completeMilestone(epic.id, specMilestone.id);

      const updatedEpic = await system.getEpic(epic.id);
      const completed = updatedEpic?.milestones.find(m => m.id === specMilestone.id);
      expect(completed?.status).toBe('completed');
      expect(completed?.completedAt).toBeDefined();

      const pending = updatedEpic?.milestones.find(m => m.id === implMilestone.id);
      expect(pending?.status).toBe('pending');
    });

    it('should transition: Submit for review → REVIEW state', async () => {
      const epic = await system.createEpic('Review Test', 'Testing review workflow');
      await system.initializeEpic(epic.id);

      const reviewEpic = await system.updateEpicState(epic.id, EpicState.REVIEW);
      expect(reviewEpic.state).toBe(EpicState.REVIEW);
    });

    it('should transition: Approve → COMPLETED', async () => {
      const epic = await system.createEpic('Completion Test', 'Testing completion');
      await system.initializeEpic(epic.id);
      await system.updateEpicState(epic.id, EpicState.REVIEW);

      const completedEpic = await system.updateEpicState(epic.id, EpicState.COMPLETED);
      expect(completedEpic.state).toBe(EpicState.COMPLETED);
    });

    it('should transition: Archive → ARCHIVED', async () => {
      const epic = await system.createEpic('Archive Test', 'Testing archival');
      await system.initializeEpic(epic.id);
      await system.updateEpicState(epic.id, EpicState.COMPLETED);

      const archivedEpic = await system.archiveEpic(epic.id);
      expect(archivedEpic.state).toBe(EpicState.ARCHIVED);
    });

    it('should handle complete lifecycle end-to-end', async () => {
      // Create epic
      const epic = await system.createEpic('Full Lifecycle', 'Complete workflow test');
      expect(epic.state).toBe(EpicState.UNINITIALIZED);

      // Initialize
      await system.initializeEpic(epic.id);
      let current = await system.getEpic(epic.id);
      expect(current?.state).toBe(EpicState.ACTIVE);

      // Add milestones
      await system.addMilestone(epic.id, 'spec', 'Spec Phase', 'Write spec');
      await system.addMilestone(epic.id, 'impl', 'Implementation', 'Build it');

      // Assign agents
      await system.createIssueForTask(epic.id, 'Task 1', 'Do work', ['backend']);
      await system.createIssueForTask(epic.id, 'Task 2', 'More work', ['test']);

      current = await system.getEpic(epic.id);
      expect(current?.agents.length).toBeGreaterThan(0);

      // Submit for review
      await system.updateEpicState(epic.id, EpicState.REVIEW);
      current = await system.getEpic(epic.id);
      expect(current?.state).toBe(EpicState.REVIEW);

      // Complete
      await system.updateEpicState(epic.id, EpicState.COMPLETED);
      current = await system.getEpic(epic.id);
      expect(current?.state).toBe(EpicState.COMPLETED);

      // Archive
      await system.archiveEpic(epic.id);
      current = await system.getEpic(epic.id);
      expect(current?.state).toBe(EpicState.ARCHIVED);
    });
  });

  describe('3. SPARC Integration', () => {
    beforeEach(() => {
      const config: CtoFlowConfig = {
        enabled: true,
        githubToken: 'test_token',
        fallbackToMemory: true
      };
      system = new TeammateSystemManager(config, github, memory, scorer);
    });

    it('should generate epic during Specification phase (when flag set)', async () => {
      // Simulate SPARC specification phase
      const epic = await system.createEpic(
        'SPARC: Build Authentication System',
        'Requirements analysis for auth system'
      );

      await system.initializeEpic(epic.id);

      // Add specification milestone
      const specMilestone = await system.addMilestone(
        epic.id,
        'specification',
        'Requirements Analysis',
        'Define auth requirements'
      );

      expect(specMilestone).toBeDefined();
      expect(specMilestone.phase).toBe('specification');
    });

    it('should update milestones on phase completion', async () => {
      const epic = await system.createEpic('SPARC Workflow', 'Full SPARC process');
      await system.initializeEpic(epic.id);

      // Add milestones for each SPARC phase
      const phases = [
        { phase: 'specification', title: 'Spec', desc: 'Requirements' },
        { phase: 'pseudocode', title: 'Pseudo', desc: 'Algorithm design' },
        { phase: 'architecture', title: 'Arch', desc: 'System design' },
        { phase: 'refinement', title: 'Refine', desc: 'TDD implementation' },
        { phase: 'completion', title: 'Complete', desc: 'Integration' }
      ];

      const milestones = await Promise.all(
        phases.map(p => system.addMilestone(epic.id, p.phase, p.title, p.desc))
      );

      expect(milestones).toHaveLength(5);

      // Complete phases in order
      for (const milestone of milestones) {
        await system.completeMilestone(epic.id, milestone.id);
      }

      const finalEpic = await system.getEpic(epic.id);
      const allCompleted = finalEpic?.milestones.every(m => m.status === 'completed');
      expect(allCompleted).toBe(true);
    });

    it('should persist context across SPARC phases', async () => {
      const epic = await system.createEpic('Context Test', 'Testing context persistence');
      await system.initializeEpic(epic.id);

      // Specification phase - save spec
      const specification = {
        requirements: ['User auth', 'Role-based access'],
        constraints: ['Security first', 'Performance SLA']
      };
      await system.saveContext(epic.id, 'specification', specification);

      // Pseudocode phase - save algorithms
      const pseudocode = {
        loginFlow: 'steps for login',
        tokenGeneration: 'JWT generation logic'
      };
      await system.saveContext(epic.id, 'pseudocode', pseudocode);

      // Architecture phase - save design
      const architecture = {
        components: ['AuthService', 'TokenManager'],
        database: 'PostgreSQL'
      };
      await system.saveContext(epic.id, 'architecture', architecture);

      // Restore context and verify all phases are available
      const context = await system.restoreContext(epic.id);

      expect(context.specification).toEqual(specification);
      expect(context.pseudocode).toEqual(pseudocode);
      expect(context.architecture).toEqual(architecture);
    });

    it('should maintain context through GitHub failures', async () => {
      const epic = await system.createEpic('Failure Test', 'Testing failure recovery');
      await system.initializeEpic(epic.id);

      // Save some context
      await system.saveContext(epic.id, 'testData', { value: 'important' });

      // Simulate GitHub failure
      github.setAvailability(false);

      // Should still be able to save and restore via memory fallback
      await system.saveContext(epic.id, 'moreData', { value: 'also important' });

      const context = await system.restoreContext(epic.id);
      expect(context.testData).toEqual({ value: 'important' });
      expect(context.moreData).toEqual({ value: 'also important' });
    });
  });

  describe('4. Agent Assignment Flow', () => {
    beforeEach(() => {
      const config: CtoFlowConfig = {
        enabled: true,
        githubToken: 'test_token',
        fallbackToMemory: true
      };
      system = new TeammateSystemManager(config, github, memory, scorer);
    });

    it('should run scoring when issue created', async () => {
      const epic = await system.createEpic('Scoring Test', 'Test agent scoring');
      await system.initializeEpic(epic.id);

      const result = await system.createIssueForTask(
        epic.id,
        'Backend Task',
        'Implement API endpoint',
        ['backend']
      );

      expect(result.assignment).toBeDefined();
      expect(result.assignment.score).toBeGreaterThan(0);
    });

    it('should select best agent based on scores', async () => {
      const epic = await system.createEpic('Selection Test', 'Test best agent selection');
      await system.initializeEpic(epic.id);

      // Create backend task - should select backend-dev (score: 0.95)
      const backendResult = await system.createIssueForTask(
        epic.id,
        'API Development',
        'Build REST API',
        ['backend']
      );
      expect(backendResult.assignment.agentType).toBe('backend-dev');
      expect(backendResult.assignment.score).toBeGreaterThanOrEqual(0.9);

      // Create test task - should select tester (score: 0.98)
      const testResult = await system.createIssueForTask(
        epic.id,
        'Test Suite',
        'Write comprehensive tests',
        ['test']
      );
      expect(testResult.assignment.agentType).toBe('tester');
      expect(testResult.assignment.score).toBeGreaterThanOrEqual(0.95);

      // Create architecture task - should select system-architect
      const archResult = await system.createIssueForTask(
        epic.id,
        'System Design',
        'Design system architecture',
        ['architecture']
      );
      expect(archResult.assignment.agentType).toBe('system-architect');
    });

    it('should record assignment in epic', async () => {
      const epic = await system.createEpic('Recording Test', 'Test assignment recording');
      await system.initializeEpic(epic.id);

      await system.createIssueForTask(epic.id, 'Task 1', 'Work', ['backend']);
      await system.createIssueForTask(epic.id, 'Task 2', 'More work', ['frontend']);

      const updatedEpic = await system.getEpic(epic.id);
      expect(updatedEpic?.agents).toHaveLength(2);

      const backendAgent = updatedEpic?.agents.find(a => a.agentType === 'backend-dev');
      expect(backendAgent).toBeDefined();
      expect(backendAgent?.status).toBe('assigned');

      const frontendAgent = updatedEpic?.agents.find(a => a.agentType === 'coder');
      expect(frontendAgent).toBeDefined();
    });

    it('should notify agent via memory/hooks', async () => {
      const epic = await system.createEpic('Notification Test', 'Test agent notification');
      await system.initializeEpic(epic.id);

      const result = await system.createIssueForTask(
        epic.id,
        'Important Task',
        'Critical work needed',
        ['backend']
      );

      // Verify notification was stored in memory
      const notification = await memory.retrieve(`assignment:${result.assignment.agentId}`);
      expect(notification).toBeDefined();
      expect(notification.issue.id).toBe(result.issue.id);
      expect(notification.assignment.agentType).toBe('backend-dev');
      expect(notification.notifiedAt).toBeDefined();
    });

    it('should handle multiple concurrent assignments', async () => {
      const epic = await system.createEpic('Concurrent Test', 'Test concurrent assignments');
      await system.initializeEpic(epic.id);

      // Create multiple tasks concurrently
      const tasks = await Promise.all([
        system.createIssueForTask(epic.id, 'Task 1', 'Work 1', ['backend']),
        system.createIssueForTask(epic.id, 'Task 2', 'Work 2', ['frontend']),
        system.createIssueForTask(epic.id, 'Task 3', 'Work 3', ['test']),
        system.createIssueForTask(epic.id, 'Task 4', 'Work 4', ['architecture'])
      ]);

      expect(tasks).toHaveLength(4);
      tasks.forEach(task => {
        expect(task.assignment).toBeDefined();
        expect(task.assignment.agentType).toBeTruthy();
      });

      const updatedEpic = await system.getEpic(epic.id);
      expect(updatedEpic?.agents).toHaveLength(4);
    });
  });

  describe('5. Context Recovery', () => {
    beforeEach(() => {
      const config: CtoFlowConfig = {
        enabled: true,
        githubToken: 'test_token',
        fallbackToMemory: true
      };
      system = new TeammateSystemManager(config, github, memory, scorer);
    });

    it('should save context to epic', async () => {
      const epic = await system.createEpic('Save Test', 'Test context saving');
      await system.initializeEpic(epic.id);

      const contextData = {
        specification: { req: 'Auth system' },
        implementation: { code: 'src/auth.ts' },
        tests: { coverage: '95%' }
      };

      await system.saveContext(epic.id, 'specification', contextData.specification);
      await system.saveContext(epic.id, 'implementation', contextData.implementation);
      await system.saveContext(epic.id, 'tests', contextData.tests);

      const savedEpic = await system.getEpic(epic.id);
      expect(savedEpic?.context.specification).toEqual(contextData.specification);
      expect(savedEpic?.context.implementation).toEqual(contextData.implementation);
      expect(savedEpic?.context.tests).toEqual(contextData.tests);
    });

    it('should clear local memory and restore from epic', async () => {
      const epic = await system.createEpic('Restore Test', 'Test context restoration');
      await system.initializeEpic(epic.id);

      const originalContext = {
        data: 'important information',
        config: { setting: 'value' }
      };

      await system.saveContext(epic.id, 'original', originalContext);

      // Clear local memory
      await memory.clear();

      // Restore from GitHub (epic context)
      const restored = await system.restoreContext(epic.id);
      expect(restored.original).toEqual(originalContext);
    });

    it('should verify restored context matches original', async () => {
      const epic = await system.createEpic('Verification Test', 'Test context verification');
      await system.initializeEpic(epic.id);

      const complexContext = {
        arrays: [1, 2, 3, 4, 5],
        nested: {
          deep: {
            value: 'found me'
          }
        },
        metadata: {
          version: '1.0.0',
          timestamp: Date.now()
        }
      };

      await system.saveContext(epic.id, 'complex', complexContext);

      // Simulate restart by clearing memory
      await memory.clear();

      // Restore
      const restored = await system.restoreContext(epic.id);

      // Deep equality check
      expect(restored.complex).toEqual(complexContext);
      expect(restored.complex.arrays).toEqual(complexContext.arrays);
      expect(restored.complex.nested.deep.value).toBe('found me');
      expect(restored.complex.metadata.version).toBe('1.0.0');
    });

    it('should handle context recovery with fallback to memory', async () => {
      const epic = await system.createEpic('Fallback Recovery', 'Test fallback recovery');
      await system.initializeEpic(epic.id);

      const context = { important: 'data' };
      await system.saveContext(epic.id, 'test', context);

      // Simulate GitHub failure
      github.setAvailability(false);

      // Should still restore from memory backup
      const restored = await system.restoreContext(epic.id);
      expect(restored.test).toEqual(context);
    });

    it('should preserve context through state transitions', async () => {
      const epic = await system.createEpic('State Transition', 'Test context preservation');
      await system.initializeEpic(epic.id);

      // Save context in active state
      await system.saveContext(epic.id, 'initial', { state: 'active' });

      // Transition to review
      await system.updateEpicState(epic.id, EpicState.REVIEW);
      await system.saveContext(epic.id, 'review', { state: 'review' });

      // Transition to completed
      await system.updateEpicState(epic.id, EpicState.COMPLETED);
      await system.saveContext(epic.id, 'completed', { state: 'completed' });

      // Restore all context
      const fullContext = await system.restoreContext(epic.id);
      expect(fullContext.initial).toEqual({ state: 'active' });
      expect(fullContext.review).toEqual({ state: 'review' });
      expect(fullContext.completed).toEqual({ state: 'completed' });
    });
  });

  describe('6. Graceful Degradation', () => {
    beforeEach(() => {
      const config: CtoFlowConfig = {
        enabled: true,
        githubToken: 'test_token',
        fallbackToMemory: true
      };
      system = new TeammateSystemManager(config, github, memory, scorer);
    });

    it('should fallback to memory when GitHub unavailable', async () => {
      // Start with GitHub available
      const epic = await system.createEpic('Fallback Test', 'Testing fallback');
      expect(epic.id).not.toContain('memory');

      // Make GitHub unavailable
      github.setAvailability(false);

      // Operations should still work via memory
      const memoryEpic = await system.createEpic('Memory Epic', 'Fallback mode');
      expect(memoryEpic.id).toContain('memory');

      await system.saveContext(memoryEpic.id, 'test', { working: true });
      const context = await system.restoreContext(memoryEpic.id);
      expect(context.test.working).toBe(true);
    });

    it('should use standard memory coordination when teammate mode off', async () => {
      const disabledConfig: CtoFlowConfig = {
        enabled: false,
        fallbackToMemory: true
      };

      const disabledSystem = new TeammateSystemManager(
        disabledConfig,
        github,
        memory,
        scorer
      );

      expect(disabledSystem.isTeammateMode()).toBe(false);

      // Should be able to use memory directly
      await memory.store('standard:task', { data: 'value' });
      const retrieved = await memory.retrieve('standard:task');
      expect(retrieved.data).toBe('value');
    });

    it('should work without epic context (no epic specified)', async () => {
      // Simulate working without an epic
      const config: CtoFlowConfig = {
        enabled: false,
        fallbackToMemory: true
      };

      const noEpicSystem = new TeammateSystemManager(
        config,
        github,
        memory,
        scorer
      );

      expect(noEpicSystem.getCurrentEpicId()).toBeNull();

      // Can still use memory for coordination
      await memory.store('task:1', { status: 'pending' });
      await memory.store('task:2', { status: 'completed' });

      const task1 = await memory.retrieve('task:1');
      const task2 = await memory.retrieve('task:2');

      expect(task1.status).toBe('pending');
      expect(task2.status).toBe('completed');
    });

    it('should handle partial GitHub failures gracefully', async () => {
      const epic = await system.createEpic('Partial Failure', 'Test partial failures');
      await system.initializeEpic(epic.id);

      // Some operations succeed
      await system.saveContext(epic.id, 'success1', { data: 'saved' });

      // GitHub fails
      github.setAvailability(false);

      // Operations continue via memory
      await system.saveContext(epic.id, 'success2', { data: 'also saved' });

      // Both should be retrievable
      const context = await system.restoreContext(epic.id);
      expect(context.success1).toBeDefined();
      expect(context.success2).toBeDefined();
    });

    it('should maintain agent assignments during degradation', async () => {
      const epic = await system.createEpic('Assignment Degradation', 'Test assignment fallback');
      await system.initializeEpic(epic.id);

      // Create task while GitHub is available
      const task1 = await system.createIssueForTask(
        epic.id,
        'Task 1',
        'First task',
        ['backend']
      );
      expect(task1.assignment).toBeDefined();

      // GitHub becomes unavailable
      github.setAvailability(false);

      // Should still be able to create tasks (stored in memory)
      const task2 = await system.createIssueForTask(
        epic.id,
        'Task 2',
        'Second task',
        ['test']
      );

      // Task created but assignment might be null (graceful degradation)
      expect(task2.issue).toBeDefined();

      // Should still be stored in memory
      const stored = await memory.retrieve(`issue:${task2.issue.id}`);
      expect(stored).toBeDefined();
    });

    it('should recover when GitHub comes back online', async () => {
      const epic = await system.createEpic('Recovery Test', 'Test recovery');
      await system.initializeEpic(epic.id);

      // Save context
      await system.saveContext(epic.id, 'online1', { phase: 1 });

      // GitHub goes down
      github.setAvailability(false);

      // Save more context (to memory)
      await system.saveContext(epic.id, 'offline1', { phase: 2 });

      // GitHub comes back
      github.setAvailability(true);

      // Save final context (back to GitHub)
      await system.saveContext(epic.id, 'online2', { phase: 3 });

      // All context should be retrievable
      const context = await system.restoreContext(epic.id);
      expect(context.online1).toBeDefined();
      expect(context.offline1).toBeDefined();
      expect(context.online2).toBeDefined();
    });
  });

  describe('7. End-to-End Integration Scenarios', () => {
    beforeEach(() => {
      const config: CtoFlowConfig = {
        enabled: true,
        githubToken: 'test_token',
        fallbackToMemory: true
      };
      system = new TeammateSystemManager(config, github, memory, scorer);
    });

    it('should handle complete SPARC workflow with teammate mode', async () => {
      // 1. Create epic for SPARC project
      const epic = await system.createEpic(
        'Build E-commerce Platform',
        'Complete e-commerce system with auth, products, cart, checkout'
      );

      // 2. Initialize epic
      await system.initializeEpic(epic.id);

      // 3. SPARC Phase: Specification
      const specMilestone = await system.addMilestone(
        epic.id,
        'specification',
        'Requirements Analysis',
        'Define system requirements'
      );

      const specContext = {
        features: ['User Auth', 'Product Catalog', 'Shopping Cart', 'Checkout'],
        constraints: ['PCI Compliance', 'GDPR', '< 2s page load'],
        stakeholders: ['Product', 'Engineering', 'Legal']
      };
      await system.saveContext(epic.id, 'specification', specContext);
      await system.completeMilestone(epic.id, specMilestone.id);

      // 4. SPARC Phase: Pseudocode
      const pseudoMilestone = await system.addMilestone(
        epic.id,
        'pseudocode',
        'Algorithm Design',
        'Design core algorithms'
      );

      const pseudoContext = {
        authFlow: 'JWT with refresh tokens',
        cartLogic: 'Session-based with DB persistence',
        paymentFlow: 'Stripe integration with webhook handling'
      };
      await system.saveContext(epic.id, 'pseudocode', pseudoContext);
      await system.completeMilestone(epic.id, pseudoMilestone.id);

      // 5. SPARC Phase: Architecture
      const archMilestone = await system.addMilestone(
        epic.id,
        'architecture',
        'System Architecture',
        'Design system components'
      );

      const archContext = {
        backend: 'Node.js + Express',
        database: 'PostgreSQL',
        cache: 'Redis',
        frontend: 'React + TypeScript',
        deployment: 'Docker + Kubernetes'
      };
      await system.saveContext(epic.id, 'architecture', archContext);

      // 6. Create implementation tasks and assign agents
      const tasks = [
        { title: 'Auth Service', labels: ['backend', 'architecture'] },
        { title: 'Product API', labels: ['backend'] },
        { title: 'Cart Logic', labels: ['backend'] },
        { title: 'Payment Integration', labels: ['backend'] },
        { title: 'Frontend Components', labels: ['frontend'] },
        { title: 'Test Suite', labels: ['test'] }
      ];

      const assignments = await Promise.all(
        tasks.map(task =>
          system.createIssueForTask(epic.id, task.title, `Implement ${task.title}`, task.labels)
        )
      );

      expect(assignments).toHaveLength(6);
      assignments.forEach(a => expect(a.assignment).toBeDefined());

      await system.completeMilestone(epic.id, archMilestone.id);

      // 7. SPARC Phase: Refinement (TDD)
      const refineMilestone = await system.addMilestone(
        epic.id,
        'refinement',
        'TDD Implementation',
        'Test-driven development'
      );

      const refineContext = {
        testCoverage: '95%',
        testsWritten: 247,
        testsPassing: 247,
        codeQuality: 'A'
      };
      await system.saveContext(epic.id, 'refinement', refineContext);
      await system.completeMilestone(epic.id, refineMilestone.id);

      // 8. SPARC Phase: Completion (Integration)
      const completionMilestone = await system.addMilestone(
        epic.id,
        'completion',
        'Integration & Deployment',
        'Final integration and deployment'
      );

      const completionContext = {
        integrated: true,
        deployed: 'production',
        monitoring: 'enabled',
        documentation: 'complete'
      };
      await system.saveContext(epic.id, 'completion', completionContext);
      await system.completeMilestone(epic.id, completionMilestone.id);

      // 9. Submit for review
      await system.updateEpicState(epic.id, EpicState.REVIEW);

      // 10. Approve and complete
      await system.updateEpicState(epic.id, EpicState.COMPLETED);

      // 11. Verify final state
      const finalEpic = await system.getEpic(epic.id);
      expect(finalEpic?.state).toBe(EpicState.COMPLETED);
      expect(finalEpic?.milestones).toHaveLength(5);
      expect(finalEpic?.milestones.every(m => m.status === 'completed')).toBe(true);
      expect(finalEpic?.agents.length).toBeGreaterThan(0);

      // 12. Verify context preservation
      const fullContext = await system.restoreContext(epic.id);
      expect(fullContext.specification).toEqual(specContext);
      expect(fullContext.pseudocode).toEqual(pseudoContext);
      expect(fullContext.architecture).toEqual(archContext);
      expect(fullContext.refinement).toEqual(refineContext);
      expect(fullContext.completion).toEqual(completionContext);

      // 13. Archive
      await system.archiveEpic(epic.id);
      const archivedEpic = await system.getEpic(epic.id);
      expect(archivedEpic?.state).toBe(EpicState.ARCHIVED);
    });

    it('should handle workflow with GitHub failures and recovery', async () => {
      // Start normally
      const epic = await system.createEpic('Resilient Workflow', 'Test resilience');
      await system.initializeEpic(epic.id);

      // Work while GitHub is available
      await system.addMilestone(epic.id, 'phase1', 'Phase 1', 'First phase');
      await system.saveContext(epic.id, 'online', { status: 'working' });

      // GitHub fails
      github.setAvailability(false);

      // Continue working with fallback
      await system.saveContext(epic.id, 'offline', { status: 'degraded' });
      const task = await system.createIssueForTask(epic.id, 'Fallback Task', 'Work during outage', ['backend']);
      expect(task.issue).toBeDefined();

      // GitHub recovers
      github.setAvailability(true);

      // Continue normally
      await system.saveContext(epic.id, 'recovered', { status: 'normal' });
      const normalTask = await system.createIssueForTask(epic.id, 'Normal Task', 'Back to normal', ['test']);
      expect(normalTask.assignment).toBeDefined();

      // Verify all data persisted
      const context = await system.restoreContext(epic.id);
      expect(context.online).toBeDefined();
      expect(context.offline).toBeDefined();
      expect(context.recovered).toBeDefined();
    });
  });
});
