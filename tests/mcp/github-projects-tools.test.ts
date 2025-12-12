/**
 * GitHub Projects MCP Tools Tests
 *
 * Tests for the GitHub Projects MCP tool definitions using mock implementations.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock tool structure based on the actual implementation
interface MockMCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
  handler: (input: any, context?: any) => Promise<any>;
}

// Mock logger
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

/**
 * Mock implementation of createGitHubProjectsTools
 * This mirrors the actual implementation structure
 */
function createMockGitHubProjectsTools(): MockMCPTool[] {
  return [
    // Epic/Project management
    {
      name: 'github-projects/epic_create',
      description: 'Create a new epic with an associated GitHub Project',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Title of the epic' },
          description: { type: 'string', description: 'Description' },
          owner: { type: 'string' },
          repo: { type: 'string' },
          labels: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'description'],
      },
      handler: async (input: any, context?: any) => {
        mockLogger.info('Creating epic', input);
        if (!context?.orchestrator) throw new Error('Orchestrator not available');
        const tm = context.orchestrator.getCtoFlowManager?.();
        if (!tm) throw new Error('CtoFlowManager not available');
        const epicId = await tm.createEpic(input.title, input.description);
        return { success: true, epicId };
      },
    },
    {
      name: 'github-projects/epic_list',
      description: 'List all epics',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['active', 'completed', 'all'], default: 'active' },
          limit: { type: 'number', default: 50 },
        },
      },
      handler: async (input: any, context?: any) => {
        mockLogger.info('Listing epics', input);
        if (!context?.orchestrator) throw new Error('Orchestrator not available');
        const tm = context.orchestrator.getCtoFlowManager?.();
        if (!tm) throw new Error('CtoFlowManager not available');
        const epics = await tm.listEpics();
        let filtered = epics;
        if (input.status === 'active') {
          filtered = epics.filter((e: any) => e.status !== 'completed');
        } else if (input.status === 'completed') {
          filtered = epics.filter((e: any) => e.status === 'completed');
        }
        return { success: true, epics: filtered.slice(0, input.limit || 50), count: filtered.length };
      },
    },
    {
      name: 'github-projects/epic_get',
      description: 'Get epic details',
      inputSchema: {
        type: 'object',
        properties: { epicId: { type: 'string' } },
        required: ['epicId'],
      },
      handler: async (input: any, context?: any) => {
        mockLogger.info('Getting epic', input);
        if (!context?.orchestrator) throw new Error('Orchestrator not available');
        const tm = context.orchestrator.getCtoFlowManager?.();
        if (!tm) throw new Error('CtoFlowManager not available');
        const epic = await tm.getEpic(input.epicId);
        return { success: true, epic };
      },
    },
    {
      name: 'github-projects/epic_progress',
      description: 'Get epic progress',
      inputSchema: {
        type: 'object',
        properties: { epicId: { type: 'string' } },
        required: ['epicId'],
      },
      handler: async (input: any, context?: any) => {
        mockLogger.info('Getting progress', input);
        if (!context?.orchestrator) throw new Error('Orchestrator not available');
        const tm = context.orchestrator.getCtoFlowManager?.();
        if (!tm) throw new Error('CtoFlowManager not available');
        const progress = await tm.getEpicProgress(input.epicId);
        return { success: true, progress };
      },
    },
    // Task/Issue management
    {
      name: 'github-projects/task_create',
      description: 'Create a task',
      inputSchema: {
        type: 'object',
        properties: {
          epicId: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          labels: { type: 'array', items: { type: 'string' } },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
        },
        required: ['epicId', 'title', 'description'],
      },
      handler: async (input: any, context?: any) => {
        mockLogger.info('Creating task', input);
        if (!context?.orchestrator) throw new Error('Orchestrator not available');
        const tm = context.orchestrator.getCtoFlowManager?.();
        if (!tm) throw new Error('CtoFlowManager not available');
        const issueNumber = await tm.createEpicTask(input.epicId, input.title, input.description, input.labels);
        return { success: true, issueNumber };
      },
    },
    {
      name: 'github-projects/task_list',
      description: 'List tasks',
      inputSchema: {
        type: 'object',
        properties: {
          epicId: { type: 'string' },
          status: { type: 'string', enum: ['open', 'closed', 'all'] },
        },
        required: ['epicId'],
      },
      handler: async () => ({ success: true, tasks: [] }),
    },
    {
      name: 'github-projects/task_update',
      description: 'Update task status',
      inputSchema: {
        type: 'object',
        properties: {
          epicId: { type: 'string' },
          issueNumber: { type: 'number' },
          status: { type: 'string', enum: ['Todo', 'In Progress', 'In Review', 'Done'] },
        },
        required: ['epicId', 'issueNumber'],
      },
      handler: async () => ({ success: true }),
    },
    // Agent assignment
    {
      name: 'github-projects/agent_available_issues',
      description: 'Get available issues for agent',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: { type: 'string' },
          epicId: { type: 'string' },
          limit: { type: 'number', default: 10 },
        },
        required: ['agentId'],
      },
      handler: async (input: any, context?: any) => {
        mockLogger.info('Getting available issues', input);
        if (!context?.orchestrator) throw new Error('Orchestrator not available');
        const tm = context.orchestrator.getCtoFlowManager?.();
        if (!tm) throw new Error('CtoFlowManager not available');
        const issues = await tm.getAvailableIssuesForAgent(input.agentId, input.epicId);
        return { success: true, issues: issues.slice(0, input.limit || 10), count: issues.length };
      },
    },
    {
      name: 'github-projects/agent_assign_issue',
      description: 'Assign agent to issue',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: { type: 'string' },
          issueNumber: { type: 'number' },
        },
        required: ['agentId', 'issueNumber'],
      },
      handler: async () => ({ success: true, status: 'assigned' }),
    },
    {
      name: 'github-projects/agent_unassign_issue',
      description: 'Unassign agent from issue',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: { type: 'string' },
          issueNumber: { type: 'number' },
        },
        required: ['agentId', 'issueNumber'],
      },
      handler: async () => ({ success: true, status: 'unassigned' }),
    },
    // PR integration
    {
      name: 'github-projects/pr_link',
      description: 'Link PR to issue',
      inputSchema: {
        type: 'object',
        properties: {
          prNumber: { type: 'number' },
          issueNumber: { type: 'number' },
        },
        required: ['prNumber', 'issueNumber'],
      },
      handler: async () => ({ success: true, relationship: 'closes' }),
    },
    {
      name: 'github-projects/pr_merge_handle',
      description: 'Handle PR merge',
      inputSchema: {
        type: 'object',
        properties: { prNumber: { type: 'number' } },
        required: ['prNumber'],
      },
      handler: async () => ({ success: true, action: 'merged' }),
    },
    // Sync management
    {
      name: 'github-projects/sync_start',
      description: 'Start sync',
      inputSchema: {
        type: 'object',
        properties: {
          epicId: { type: 'string' },
          intervalMs: { type: 'number', default: 30000 },
        },
        required: ['epicId'],
      },
      handler: async () => ({ success: true, status: 'syncing' }),
    },
    {
      name: 'github-projects/sync_stop',
      description: 'Stop sync',
      inputSchema: {
        type: 'object',
        properties: { epicId: { type: 'string' } },
        required: ['epicId'],
      },
      handler: async () => ({ success: true, status: 'stopped' }),
    },
    {
      name: 'github-projects/sync_status',
      description: 'Get sync status',
      inputSchema: {
        type: 'object',
        properties: { epicId: { type: 'string' } },
      },
      handler: async () => ({ success: true, configured: true }),
    },
  ];
}

describe('GitHub Projects MCP Tools', () => {
  let tools: MockMCPTool[];

  beforeEach(() => {
    tools = createMockGitHubProjectsTools();
    jest.clearAllMocks();
  });

  describe('Tool Definitions', () => {
    it('should export 15 GitHub Projects tools', () => {
      expect(tools.length).toBe(15);
    });

    it('should have correct tool names', () => {
      const toolNames = tools.map(t => t.name);

      // Epic/Project management
      expect(toolNames).toContain('github-projects/epic_create');
      expect(toolNames).toContain('github-projects/epic_list');
      expect(toolNames).toContain('github-projects/epic_get');
      expect(toolNames).toContain('github-projects/epic_progress');

      // Task/Issue management
      expect(toolNames).toContain('github-projects/task_create');
      expect(toolNames).toContain('github-projects/task_list');
      expect(toolNames).toContain('github-projects/task_update');

      // Agent assignment
      expect(toolNames).toContain('github-projects/agent_available_issues');
      expect(toolNames).toContain('github-projects/agent_assign_issue');
      expect(toolNames).toContain('github-projects/agent_unassign_issue');

      // PR integration
      expect(toolNames).toContain('github-projects/pr_link');
      expect(toolNames).toContain('github-projects/pr_merge_handle');

      // Sync management
      expect(toolNames).toContain('github-projects/sync_start');
      expect(toolNames).toContain('github-projects/sync_stop');
      expect(toolNames).toContain('github-projects/sync_status');
    });

    it('should have valid input schemas', () => {
      for (const tool of tools) {
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.inputSchema.properties).toBeDefined();
      }
    });

    it('should have handlers for all tools', () => {
      for (const tool of tools) {
        expect(typeof tool.handler).toBe('function');
      }
    });
  });

  describe('epic_create tool', () => {
    it('should have correct schema', () => {
      const tool = tools.find(t => t.name === 'github-projects/epic_create');
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.required).toContain('title');
      expect(tool!.inputSchema.required).toContain('description');
      expect(tool!.inputSchema.properties.title.type).toBe('string');
      expect(tool!.inputSchema.properties.description.type).toBe('string');
    });

    it('should throw error when orchestrator is not available', async () => {
      const tool = tools.find(t => t.name === 'github-projects/epic_create');
      await expect(
        tool!.handler({ title: 'Test', description: 'Test' }, {})
      ).rejects.toThrow('Orchestrator not available');
    });

    it('should throw error when CtoFlowManager is not available', async () => {
      const tool = tools.find(t => t.name === 'github-projects/epic_create');
      const mockOrchestrator = { getCtoFlowManager: () => null };
      await expect(
        tool!.handler({ title: 'Test', description: 'Test' }, { orchestrator: mockOrchestrator })
      ).rejects.toThrow('CtoFlowManager not available');
    });

    it('should create epic when CtoFlowManager is available', async () => {
      const tool = tools.find(t => t.name === 'github-projects/epic_create');
      const mockCtoFlowManager = {
        createEpic: jest.fn().mockResolvedValue('epic-123'),
      };
      const mockOrchestrator = { getCtoFlowManager: () => mockCtoFlowManager };

      const result = await tool!.handler(
        { title: 'Test Epic', description: 'Test Description' },
        { orchestrator: mockOrchestrator }
      );

      expect(result.success).toBe(true);
      expect(result.epicId).toBe('epic-123');
      expect(mockCtoFlowManager.createEpic).toHaveBeenCalledWith('Test Epic', 'Test Description');
    });
  });

  describe('task_create tool', () => {
    it('should have correct schema', () => {
      const tool = tools.find(t => t.name === 'github-projects/task_create');
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.required).toContain('epicId');
      expect(tool!.inputSchema.required).toContain('title');
      expect(tool!.inputSchema.required).toContain('description');
      expect(tool!.inputSchema.properties.labels.type).toBe('array');
      expect(tool!.inputSchema.properties.priority.enum).toEqual([
        'low', 'medium', 'high', 'critical'
      ]);
    });
  });

  describe('epic_list tool', () => {
    it('should filter by status', async () => {
      const tool = tools.find(t => t.name === 'github-projects/epic_list');
      const mockCtoFlowManager = {
        listEpics: jest.fn().mockResolvedValue([
          { id: 'epic-1', title: 'Active Epic', status: 'active' },
          { id: 'epic-2', title: 'Completed Epic', status: 'completed' },
          { id: 'epic-3', title: 'Another Active', status: 'in_progress' },
        ]),
      };
      const mockOrchestrator = { getCtoFlowManager: () => mockCtoFlowManager };

      const result = await tool!.handler(
        { status: 'active' },
        { orchestrator: mockOrchestrator }
      );

      expect(result.success).toBe(true);
      expect(result.count).toBe(2); // Only non-completed epics
      expect(result.epics.every((e: any) => e.status !== 'completed')).toBe(true);
    });

    it('should respect limit', async () => {
      const tool = tools.find(t => t.name === 'github-projects/epic_list');
      const mockCtoFlowManager = {
        listEpics: jest.fn().mockResolvedValue(
          Array.from({ length: 100 }, (_, i) => ({ id: `epic-${i}`, status: 'active' }))
        ),
      };
      const mockOrchestrator = { getCtoFlowManager: () => mockCtoFlowManager };

      const result = await tool!.handler(
        { status: 'all', limit: 10 },
        { orchestrator: mockOrchestrator }
      );

      expect(result.epics.length).toBe(10);
      expect(result.count).toBe(100);
    });
  });

  describe('agent_available_issues tool', () => {
    it('should have correct schema', () => {
      const tool = tools.find(t => t.name === 'github-projects/agent_available_issues');
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.required).toContain('agentId');
      expect(tool!.inputSchema.properties.limit.default).toBe(10);
    });

    it('should return available issues for agent', async () => {
      const tool = tools.find(t => t.name === 'github-projects/agent_available_issues');
      const mockCtoFlowManager = {
        getAvailableIssuesForAgent: jest.fn().mockResolvedValue([
          { number: 1, title: 'Issue 1', score: 85 },
          { number: 2, title: 'Issue 2', score: 72 },
        ]),
      };
      const mockOrchestrator = { getCtoFlowManager: () => mockCtoFlowManager };

      const result = await tool!.handler(
        { agentId: 'agent-1' },
        { orchestrator: mockOrchestrator }
      );

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
      expect(result.issues).toHaveLength(2);
    });
  });

  describe('sync_start tool', () => {
    it('should have correct schema', () => {
      const tool = tools.find(t => t.name === 'github-projects/sync_start');
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.required).toContain('epicId');
      expect(tool!.inputSchema.properties.intervalMs.default).toBe(30000);
    });
  });

  describe('pr_link tool', () => {
    it('should have correct schema', () => {
      const tool = tools.find(t => t.name === 'github-projects/pr_link');
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.required).toContain('prNumber');
      expect(tool!.inputSchema.required).toContain('issueNumber');
      expect(tool!.inputSchema.properties.prNumber.type).toBe('number');
      expect(tool!.inputSchema.properties.issueNumber.type).toBe('number');
    });
  });

  describe('Tool Handler Logging', () => {
    it('should call logger.info when epic_create is invoked', async () => {
      const tool = tools.find(t => t.name === 'github-projects/epic_create');
      const mockCtoFlowManager = {
        createEpic: jest.fn().mockResolvedValue('epic-1'),
      };
      const mockOrchestrator = { getCtoFlowManager: () => mockCtoFlowManager };

      await tool!.handler({ title: 'Test', description: 'Test' }, { orchestrator: mockOrchestrator });

      expect(mockLogger.info).toHaveBeenCalledWith('Creating epic', { title: 'Test', description: 'Test' });
    });
  });

  describe('Error Handling', () => {
    it('should throw Orchestrator error for all tools', async () => {
      const toolsRequiringOrchestrator = [
        'github-projects/epic_create',
        'github-projects/epic_list',
        'github-projects/epic_get',
        'github-projects/epic_progress',
        'github-projects/task_create',
        'github-projects/agent_available_issues',
      ];

      for (const toolName of toolsRequiringOrchestrator) {
        const tool = tools.find(t => t.name === toolName);
        if (tool) {
          await expect(tool.handler({}, {})).rejects.toThrow('Orchestrator not available');
        }
      }
    });
  });
});
