/**
 * Hive-Mind Epic Flow Integration Tests
 *
 * Tests the complete CTO flow:
 * 1. SPARC creates epic with issues
 * 2. Hive-mind watches for assignments
 * 3. Agents pick up assigned issues
 * 4. Work is completed
 * 5. Issues are marked complete
 *
 * Note: These tests require a GitHub token and test repository.
 * Set GITHUB_TOKEN and TEST_REPO environment variables.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  HiveMindGitHubOrchestrator,
  createHiveMindOrchestrator,
  EpicPlan,
  CreatedEpic,
} from '../../teammate-agents/integration/hive-mind-github.js';
import { HiveMind } from '../../hive-mind/core/HiveMind.js';
import { DatabaseManager } from '../../hive-mind/core/DatabaseManager.js';
import {
  registerEpicWorkHooks,
  unregisterEpicWorkHooks,
  triggerWorkComplete,
} from '../../teammate-agents/hooks/epic-work-hooks.js';

// Skip tests if no GitHub token available
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const TEST_REPO = process.env.TEST_REPO; // e.g., 'owner/repo'
const SKIP_GITHUB_TESTS = !GITHUB_TOKEN || !TEST_REPO;

describe.skipIf(SKIP_GITHUB_TESTS)('Hive-Mind Epic Flow Integration', () => {
  let orchestrator: HiveMindGitHubOrchestrator;
  let hiveMind: HiveMind;
  let testEpic: CreatedEpic | null = null;

  const [testOwner, testRepoName] = (TEST_REPO || 'test/test').split('/');

  beforeAll(async () => {
    // Initialize orchestrator
    orchestrator = createHiveMindOrchestrator({
      owner: testOwner,
      repo: testRepoName,
      token: GITHUB_TOKEN,
      enableVectorSearch: true,
      enableLearning: true,
    });

    await orchestrator.initialize();

    // Initialize hive-mind
    hiveMind = new HiveMind({
      name: 'test-hive',
      topology: 'hierarchical',
      queenMode: 'centralized',
      maxAgents: 8,
      consensusThreshold: 0.6,
      memoryTTL: 3600000,
      autoSpawn: true,
    });

    await hiveMind.initialize();

    // Register work hooks
    registerEpicWorkHooks();
  });

  afterAll(async () => {
    unregisterEpicWorkHooks();

    if (orchestrator) {
      await orchestrator.shutdown();
    }

    if (hiveMind) {
      await hiveMind.shutdown();
    }
  });

  describe('Epic Creation via SPARC', () => {
    it('should create an epic with tasks from a plan', async () => {
      const epicPlan: EpicPlan = {
        title: 'Test Epic - Hive Mind Integration',
        description: 'Integration test epic for hive-mind flow validation',
        objectives: [
          'Test epic creation',
          'Test task assignment',
          'Test work completion',
        ],
        constraints: [
          'Must complete in test environment',
          'Should not affect production',
        ],
        tasks: [
          {
            title: 'Test Specification Task',
            description: 'A test task for the specification phase',
            phase: 'Specification',
            skills: ['research', 'analysis'],
            priority: 'high',
          },
          {
            title: 'Test Architecture Task',
            description: 'A test task for the architecture phase',
            phase: 'Architecture',
            skills: ['architecture', 'design'],
            priority: 'high',
            dependencies: [],
          },
          {
            title: 'Test Implementation Task',
            description: 'A test task for the refinement phase',
            phase: 'Refinement',
            skills: ['typescript', 'coding'],
            priority: 'medium',
          },
        ],
        metadata: {
          testRun: true,
          timestamp: Date.now(),
        },
      };

      testEpic = await orchestrator.createEpic(epicPlan);

      expect(testEpic).toBeDefined();
      expect(testEpic.epicId).toBeTruthy();
      expect(testEpic.projectNumber).toBeGreaterThan(0);
      expect(testEpic.tasks).toHaveLength(3);

      // Verify tasks have agent assignments
      for (const task of testEpic.tasks) {
        expect(task.issueNumber).toBeGreaterThan(0);
        expect(task.phase).toBeTruthy();
        expect(task.status).toBe('ready');
      }
    });
  });

  describe('Task Fetching', () => {
    it('should fetch ready tasks from epic', async () => {
      if (!testEpic) {
        throw new Error('Test epic not created');
      }

      // Refresh statuses
      await orchestrator.refreshTaskStatuses(testEpic.epicId);

      // Get ready tasks
      const readyTasks = orchestrator.getReadyTasks(testEpic.epicId, {
        includeDependencyCheck: true,
      });

      expect(readyTasks.length).toBeGreaterThan(0);

      // Specification tasks should be first (phase order)
      const specTask = readyTasks.find(t => t.phase === 'Specification');
      expect(specTask).toBeDefined();
    });

    it('should filter tasks by phase', async () => {
      if (!testEpic) {
        throw new Error('Test epic not created');
      }

      const archTasks = orchestrator.getReadyTasks(testEpic.epicId, {
        phase: 'Architecture',
      });

      for (const task of archTasks) {
        expect(task.phase.toLowerCase()).toBe('architecture');
      }
    });

    it('should get next recommended task', async () => {
      if (!testEpic) {
        throw new Error('Test epic not created');
      }

      const nextTask = orchestrator.getNextTask(testEpic.epicId);

      expect(nextTask).toBeDefined();
      expect(nextTask?.status).toBe('ready');
    });
  });

  describe('Task Status Summary', () => {
    it('should provide accurate task summary', async () => {
      if (!testEpic) {
        throw new Error('Test epic not created');
      }

      const summary = orchestrator.getTaskStatusSummary(testEpic.epicId);

      expect(summary.total).toBe(3);
      expect(summary.ready).toBeGreaterThanOrEqual(0);
      expect(summary.done).toBe(0); // None completed yet
      expect(summary.byPhase).toHaveProperty('Specification');
    });
  });

  describe('Work Completion Flow', () => {
    it('should mark task as in progress', async () => {
      if (!testEpic) {
        throw new Error('Test epic not created');
      }

      const task = testEpic.tasks[0];

      await orchestrator.updateTaskStatus(
        testEpic.epicId,
        task.taskId,
        'In Progress'
      );

      // Refresh and verify
      await orchestrator.refreshTaskStatuses(testEpic.epicId);
      const updatedEpic = orchestrator.getEpic(testEpic.epicId);
      const updatedTask = updatedEpic?.tasks.find(t => t.taskId === task.taskId);

      expect(updatedTask?.status).toBe('in_progress');
    });

    it('should complete a task successfully', async () => {
      if (!testEpic) {
        throw new Error('Test epic not created');
      }

      const task = testEpic.tasks[0];

      const result = await orchestrator.completeTask(
        testEpic.epicId,
        task.taskId,
        {
          success: true,
          completedBy: 'Test Suite',
          summary: 'Task completed during integration test',
          artifacts: ['test-artifact.txt'],
        }
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe('Done');
      expect(result.issueNumber).toBe(task.issueNumber);
    });

    it('should update summary after completion', async () => {
      if (!testEpic) {
        throw new Error('Test epic not created');
      }

      await orchestrator.refreshTaskStatuses(testEpic.epicId);
      const summary = orchestrator.getTaskStatusSummary(testEpic.epicId);

      expect(summary.done).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Work Hooks Integration', () => {
    it('should trigger post-work hook on completion', async () => {
      if (!testEpic) {
        throw new Error('Test epic not created');
      }

      const task = testEpic.tasks[1]; // Second task

      // Trigger work complete via hook helper
      await triggerWorkComplete({
        epicId: testEpic.epicId,
        taskId: task.taskId,
        issueNumber: task.issueNumber,
        agentId: 'test-agent',
        agentType: 'coder',
        repo: `${testOwner}/${testRepoName}`,
        success: true,
        summary: 'Completed via hook trigger',
      });

      // Verify task completed
      await orchestrator.refreshTaskStatuses(testEpic.epicId);
      const summary = orchestrator.getTaskStatusSummary(testEpic.epicId);

      expect(summary.done).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Hive-Mind Integration', () => {
    it('should submit epic task to hive-mind', async () => {
      if (!testEpic) {
        throw new Error('Test epic not created');
      }

      const task = testEpic.tasks[2]; // Third task

      // Submit to hive-mind
      const hiveMindTask = await hiveMind.submitTask({
        description: `[Epic #${task.issueNumber}] ${task.title}`,
        priority: 'high',
        strategy: 'adaptive',
        requiredCapabilities: task.assignedAgent?.skills || ['coding'],
        metadata: {
          epicId: testEpic.epicId,
          issueNumber: task.issueNumber,
          taskId: task.taskId,
        },
      });

      expect(hiveMindTask).toBeDefined();
      expect(hiveMindTask.id).toBeTruthy();
      expect(hiveMindTask.metadata?.epicId).toBe(testEpic.epicId);
    });

    it('should have agents available for work', async () => {
      const agents = await hiveMind.getAgents();

      expect(agents.length).toBeGreaterThan(0);

      // Should have different agent types
      const agentTypes = new Set(agents.map(a => a.type));
      expect(agentTypes.size).toBeGreaterThan(1);
    });
  });

  describe('Epic Loading', () => {
    it('should load existing epic from GitHub', async () => {
      if (!testEpic) {
        throw new Error('Test epic not created');
      }

      // Create new orchestrator to simulate fresh load
      const newOrchestrator = createHiveMindOrchestrator({
        owner: testOwner,
        repo: testRepoName,
        token: GITHUB_TOKEN,
      });

      await newOrchestrator.initialize();

      const loadedEpic = await newOrchestrator.loadEpicFromGitHub(
        testRepoName,
        testEpic.epicId
      );

      expect(loadedEpic).toBeDefined();
      expect(loadedEpic?.epicId).toBe(testEpic.epicId);
      expect(loadedEpic?.tasks.length).toBe(testEpic.tasks.length);

      await newOrchestrator.shutdown();
    });
  });
});

// Unit tests that don't require GitHub
describe('Hive-Mind Epic Flow Unit Tests', () => {
  describe('Task Status Mapping', () => {
    it('should map project status to task status correctly', () => {
      // This tests internal logic without GitHub
      const statusMap: Record<string, string> = {
        'Backlog': 'backlog',
        'Specification': 'ready',
        'Design': 'ready',
        'Architecture': 'ready',
        'In Progress': 'in_progress',
        'Review': 'review',
        'Done': 'done',
        'Blocked': 'blocked',
      };

      for (const [input, expected] of Object.entries(statusMap)) {
        // Simulated mapping logic
        const result = mapProjectStatusToTaskStatus(input, 'open');
        expect(result).toBe(expected);
      }
    });
  });

  describe('Phase Ordering', () => {
    it('should order SPARC phases correctly', () => {
      const phases = ['Completion', 'Specification', 'Refinement', 'Architecture', 'Pseudocode'];
      const expectedOrder = ['Specification', 'Pseudocode', 'Architecture', 'Refinement', 'Completion'];

      const phaseOrder = ['Specification', 'Pseudocode', 'Architecture', 'Refinement', 'Completion'];
      const sorted = [...phases].sort((a, b) => {
        const aIdx = phaseOrder.indexOf(a);
        const bIdx = phaseOrder.indexOf(b);
        return aIdx - bIdx;
      });

      expect(sorted).toEqual(expectedOrder);
    });
  });
});

// Helper function for testing (mirrors internal logic)
function mapProjectStatusToTaskStatus(
  projectStatus: string,
  issueState: 'open' | 'closed'
): string {
  if (issueState === 'closed') {
    return 'done';
  }

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
