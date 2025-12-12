/**
 * GitHub Projects MCP Tools
 *
 * MCP tools for GitHub Projects v2 integration with cto-flow-agents.
 * Enables project creation, task management, agent assignment, and progress tracking.
 */

import type { MCPTool } from '../utils/types.js';
import type { ILogger } from '../core/logger.js';
import type { ClaudeFlowToolContext } from './claude-flow-tools.js';

/**
 * Create all GitHub Projects MCP tools
 */
export function createGitHubProjectsTools(logger: ILogger): MCPTool[] {
  return [
    // Epic/Project management
    createEpicCreateTool(logger),
    createEpicListTool(logger),
    createEpicGetTool(logger),
    createEpicProgressTool(logger),

    // Task/Issue management
    createEpicTaskCreateTool(logger),
    createEpicTaskListTool(logger),
    createEpicTaskUpdateTool(logger),

    // Agent assignment
    createAgentAvailableIssuesTool(logger),
    createAgentAssignIssueTool(logger),
    createAgentUnassignIssueTool(logger),

    // PR integration
    createPRLinkTool(logger),
    createPRMergeTool(logger),

    // Sync management
    createProjectSyncStartTool(logger),
    createProjectSyncStopTool(logger),
    createProjectSyncStatusTool(logger),

    // Hive-Mind tools
    createHiveMindEpicLoadTool(logger),
    createHiveMindTaskCompleteTool(logger),
    createHiveMindTaskStatusUpdateTool(logger),
    createHiveMindDetectCompletedTool(logger),
    createHiveMindSyncCompletionTool(logger),
    createHiveMindRetrospectiveCompleteTool(logger),

    // Hive-Mind PR tools
    createHiveMindPRCreateTool(logger),
    createHiveMindPRListTool(logger),
    createHiveMindPRLinkTool(logger),
    createHiveMindPRStatusTool(logger),
    createHiveMindPRMergeTool(logger),
    createHiveMindPRStatsTool(logger),
    createHiveMindBranchCreateTool(logger),

    // Hive-Mind Task Status tools
    createHiveMindReadyTasksTool(logger),
    createHiveMindNextTaskTool(logger),
    createHiveMindTaskStatusSummaryTool(logger),
    createHiveMindRefreshStatusTool(logger),

    // CTO Flow tools
    createCTOFlowCreateEpicTool(logger),
    createCTOFlowUnassignedTasksTool(logger),
    createCTOFlowWatchAssignmentsTool(logger),
    createCTOFlowEpicTool(logger),

    // CTO Flow: Label-based agent assignment (since agents aren't GitHub users)
    createCTOFlowReleaseTaskTool(logger),
    createCTOFlowAssignAgentTool(logger),
    createCTOFlowMyAssignmentsTool(logger),
    createCTOFlowClaimTaskTool(logger),
    createCTOFlowCompleteTaskTool(logger),
  ];
}

/**
 * Create a new epic with GitHub Project
 */
function createEpicCreateTool(logger: ILogger): MCPTool {
  return {
    name: 'github-projects/epic_create',
    description: 'Create a new epic with an associated GitHub Project for tracking tasks and progress',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title of the epic',
        },
        description: {
          type: 'string',
          description: 'Detailed description of the epic',
        },
        owner: {
          type: 'string',
          description: 'GitHub owner (user or org) for the project',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name',
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Labels to apply to the epic issue',
        },
        milestone: {
          type: 'string',
          description: 'Milestone to associate with the epic',
        },
      },
      required: ['title', 'description'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('Creating epic with GitHub Project', { title: input.title, sessionId: context?.sessionId });

      if (!context?.orchestrator) {
        throw new Error('Orchestrator not available');
      }

      const ctoFlowManager = context.orchestrator.getCtoFlowManager?.();
      if (!ctoFlowManager) {
        throw new Error('CtoFlowManager not available - ensure cto-flow-agents is configured');
      }

      const epicId = await ctoFlowManager.createEpic(input.title, input.description);
      const epic = await ctoFlowManager.getEpic(epicId);

      return {
        success: true,
        epicId,
        epic,
        projectUrl: epic?.url,
        projectNumber: epic?.metadata?.projectNumber,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * List all epics
 */
function createEpicListTool(logger: ILogger): MCPTool {
  return {
    name: 'github-projects/epic_list',
    description: 'List all epics with their GitHub Project status',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['active', 'completed', 'all'],
          default: 'active',
          description: 'Filter epics by status',
        },
        limit: {
          type: 'number',
          default: 50,
          description: 'Maximum number of epics to return',
        },
      },
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('Listing epics', { status: input.status, sessionId: context?.sessionId });

      if (!context?.orchestrator) {
        throw new Error('Orchestrator not available');
      }

      const ctoFlowManager = context.orchestrator.getCtoFlowManager?.();
      if (!ctoFlowManager) {
        throw new Error('CtoFlowManager not available');
      }

      const epics = await ctoFlowManager.listEpics();

      let filtered = epics;
      if (input.status === 'active') {
        filtered = epics.filter((e: any) => e.status !== 'completed');
      } else if (input.status === 'completed') {
        filtered = epics.filter((e: any) => e.status === 'completed');
      }

      return {
        success: true,
        epics: filtered.slice(0, input.limit || 50),
        count: filtered.length,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Get epic details
 */
function createEpicGetTool(logger: ILogger): MCPTool {
  return {
    name: 'github-projects/epic_get',
    description: 'Get detailed information about a specific epic and its GitHub Project',
    inputSchema: {
      type: 'object',
      properties: {
        epicId: {
          type: 'string',
          description: 'ID of the epic to retrieve',
        },
      },
      required: ['epicId'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('Getting epic', { epicId: input.epicId, sessionId: context?.sessionId });

      if (!context?.orchestrator) {
        throw new Error('Orchestrator not available');
      }

      const ctoFlowManager = context.orchestrator.getCtoFlowManager?.();
      if (!ctoFlowManager) {
        throw new Error('CtoFlowManager not available');
      }

      const epic = await ctoFlowManager.getEpic(input.epicId);
      if (!epic) {
        throw new Error(`Epic not found: ${input.epicId}`);
      }

      return {
        success: true,
        epic,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Get epic progress from GitHub Project
 */
function createEpicProgressTool(logger: ILogger): MCPTool {
  return {
    name: 'github-projects/epic_progress',
    description: 'Get progress statistics for an epic from its GitHub Project',
    inputSchema: {
      type: 'object',
      properties: {
        epicId: {
          type: 'string',
          description: 'ID of the epic to get progress for',
        },
      },
      required: ['epicId'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('Getting epic progress', { epicId: input.epicId, sessionId: context?.sessionId });

      if (!context?.orchestrator) {
        throw new Error('Orchestrator not available');
      }

      const ctoFlowManager = context.orchestrator.getCtoFlowManager?.();
      if (!ctoFlowManager) {
        throw new Error('CtoFlowManager not available');
      }

      const progress = await ctoFlowManager.getEpicProgress(input.epicId);

      return {
        success: true,
        epicId: input.epicId,
        progress,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Create a task/issue for an epic
 */
function createEpicTaskCreateTool(logger: ILogger): MCPTool {
  return {
    name: 'github-projects/task_create',
    description: 'Create a new task (GitHub Issue) linked to an epic\'s project',
    inputSchema: {
      type: 'object',
      properties: {
        epicId: {
          type: 'string',
          description: 'ID of the epic to add the task to',
        },
        title: {
          type: 'string',
          description: 'Title of the task/issue',
        },
        description: {
          type: 'string',
          description: 'Description of the task',
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Labels to apply to the issue',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          default: 'medium',
          description: 'Task priority',
        },
        assignee: {
          type: 'string',
          description: 'GitHub username to assign the issue to',
        },
      },
      required: ['epicId', 'title', 'description'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('Creating epic task', {
        epicId: input.epicId,
        title: input.title,
        sessionId: context?.sessionId
      });

      if (!context?.orchestrator) {
        throw new Error('Orchestrator not available');
      }

      const ctoFlowManager = context.orchestrator.getCtoFlowManager?.();
      if (!ctoFlowManager) {
        throw new Error('CtoFlowManager not available');
      }

      const issueNumber = await ctoFlowManager.createEpicTask(
        input.epicId,
        input.title,
        input.description,
        input.labels || []
      );

      return {
        success: true,
        epicId: input.epicId,
        issueNumber,
        title: input.title,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * List tasks for an epic
 */
function createEpicTaskListTool(logger: ILogger): MCPTool {
  return {
    name: 'github-projects/task_list',
    description: 'List all tasks (issues) in an epic\'s GitHub Project',
    inputSchema: {
      type: 'object',
      properties: {
        epicId: {
          type: 'string',
          description: 'ID of the epic',
        },
        status: {
          type: 'string',
          enum: ['open', 'closed', 'all'],
          default: 'all',
          description: 'Filter tasks by status',
        },
      },
      required: ['epicId'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('Listing epic tasks', { epicId: input.epicId, sessionId: context?.sessionId });

      if (!context?.orchestrator) {
        throw new Error('Orchestrator not available');
      }

      const ctoFlowManager = context.orchestrator.getCtoFlowManager?.();
      if (!ctoFlowManager) {
        throw new Error('CtoFlowManager not available');
      }

      const bridge = ctoFlowManager.getProjectBridge();
      if (!bridge) {
        throw new Error('GitHub Projects not configured');
      }

      // Get issues from the project
      const issues = await bridge.getProjectIssues(input.epicId);

      let filtered = issues;
      if (input.status === 'open') {
        filtered = issues.filter((i: any) => i.state === 'OPEN');
      } else if (input.status === 'closed') {
        filtered = issues.filter((i: any) => i.state === 'CLOSED');
      }

      return {
        success: true,
        epicId: input.epicId,
        tasks: filtered,
        count: filtered.length,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Update a task's status
 */
function createEpicTaskUpdateTool(logger: ILogger): MCPTool {
  return {
    name: 'github-projects/task_update',
    description: 'Update a task\'s status in the GitHub Project',
    inputSchema: {
      type: 'object',
      properties: {
        epicId: {
          type: 'string',
          description: 'ID of the epic',
        },
        issueNumber: {
          type: 'number',
          description: 'Issue number to update',
        },
        status: {
          type: 'string',
          enum: ['Todo', 'In Progress', 'In Review', 'Done'],
          description: 'New status for the task',
        },
        priority: {
          type: 'string',
          enum: ['Low', 'Medium', 'High', 'Critical'],
          description: 'New priority for the task',
        },
      },
      required: ['epicId', 'issueNumber'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('Updating epic task', {
        epicId: input.epicId,
        issueNumber: input.issueNumber,
        sessionId: context?.sessionId
      });

      if (!context?.orchestrator) {
        throw new Error('Orchestrator not available');
      }

      const ctoFlowManager = context.orchestrator.getCtoFlowManager?.();
      if (!ctoFlowManager) {
        throw new Error('CtoFlowManager not available');
      }

      const bridge = ctoFlowManager.getProjectBridge();
      if (!bridge) {
        throw new Error('GitHub Projects not configured');
      }

      await bridge.updateIssueStatus(input.epicId, input.issueNumber, {
        status: input.status,
        priority: input.priority,
      });

      return {
        success: true,
        epicId: input.epicId,
        issueNumber: input.issueNumber,
        updates: { status: input.status, priority: input.priority },
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Get available issues for an agent to work on
 */
function createAgentAvailableIssuesTool(logger: ILogger): MCPTool {
  return {
    name: 'github-projects/agent_available_issues',
    description: 'Get issues available for an agent to work on, scored by relevance',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'ID of the agent looking for work',
        },
        epicId: {
          type: 'string',
          description: 'Optional: limit to specific epic',
        },
        limit: {
          type: 'number',
          default: 10,
          description: 'Maximum number of issues to return',
        },
      },
      required: ['agentId'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('Getting available issues for agent', {
        agentId: input.agentId,
        sessionId: context?.sessionId
      });

      if (!context?.orchestrator) {
        throw new Error('Orchestrator not available');
      }

      const ctoFlowManager = context.orchestrator.getCtoFlowManager?.();
      if (!ctoFlowManager) {
        throw new Error('CtoFlowManager not available');
      }

      const issues = await ctoFlowManager.getAvailableIssuesForAgent(
        input.agentId,
        input.epicId
      );

      return {
        success: true,
        agentId: input.agentId,
        issues: issues.slice(0, input.limit || 10),
        count: issues.length,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Assign an agent to an issue
 */
function createAgentAssignIssueTool(logger: ILogger): MCPTool {
  return {
    name: 'github-projects/agent_assign_issue',
    description: 'Assign an agent to work on a specific issue',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'ID of the agent to assign',
        },
        issueNumber: {
          type: 'number',
          description: 'Issue number to assign to the agent',
        },
      },
      required: ['agentId', 'issueNumber'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('Assigning agent to issue', {
        agentId: input.agentId,
        issueNumber: input.issueNumber,
        sessionId: context?.sessionId
      });

      if (!context?.orchestrator) {
        throw new Error('Orchestrator not available');
      }

      const ctoFlowManager = context.orchestrator.getCtoFlowManager?.();
      if (!ctoFlowManager) {
        throw new Error('CtoFlowManager not available');
      }

      await ctoFlowManager.assignAgentToIssue(input.agentId, input.issueNumber);

      return {
        success: true,
        agentId: input.agentId,
        issueNumber: input.issueNumber,
        status: 'assigned',
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Unassign an agent from an issue
 */
function createAgentUnassignIssueTool(logger: ILogger): MCPTool {
  return {
    name: 'github-projects/agent_unassign_issue',
    description: 'Remove an agent\'s assignment from an issue',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'ID of the agent to unassign',
        },
        issueNumber: {
          type: 'number',
          description: 'Issue number to unassign from',
        },
      },
      required: ['agentId', 'issueNumber'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('Unassigning agent from issue', {
        agentId: input.agentId,
        issueNumber: input.issueNumber,
        sessionId: context?.sessionId
      });

      if (!context?.orchestrator) {
        throw new Error('Orchestrator not available');
      }

      const ctoFlowManager = context.orchestrator.getCtoFlowManager?.();
      if (!ctoFlowManager) {
        throw new Error('CtoFlowManager not available');
      }

      const bridge = ctoFlowManager.getProjectBridge();
      if (!bridge) {
        throw new Error('GitHub Projects not configured');
      }

      await bridge.unassignAgent(input.agentId, input.issueNumber);

      return {
        success: true,
        agentId: input.agentId,
        issueNumber: input.issueNumber,
        status: 'unassigned',
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Link a PR to an issue
 */
function createPRLinkTool(logger: ILogger): MCPTool {
  return {
    name: 'github-projects/pr_link',
    description: 'Link a pull request to an issue (adds "Closes #N" relationship)',
    inputSchema: {
      type: 'object',
      properties: {
        prNumber: {
          type: 'number',
          description: 'Pull request number',
        },
        issueNumber: {
          type: 'number',
          description: 'Issue number to link to',
        },
      },
      required: ['prNumber', 'issueNumber'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('Linking PR to issue', {
        prNumber: input.prNumber,
        issueNumber: input.issueNumber,
        sessionId: context?.sessionId
      });

      if (!context?.orchestrator) {
        throw new Error('Orchestrator not available');
      }

      const ctoFlowManager = context.orchestrator.getCtoFlowManager?.();
      if (!ctoFlowManager) {
        throw new Error('CtoFlowManager not available');
      }

      await ctoFlowManager.linkPRToIssue(input.prNumber, input.issueNumber);

      return {
        success: true,
        prNumber: input.prNumber,
        issueNumber: input.issueNumber,
        relationship: 'closes',
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Handle PR merge (auto-close linked issues)
 */
function createPRMergeTool(logger: ILogger): MCPTool {
  return {
    name: 'github-projects/pr_merge_handle',
    description: 'Handle a merged PR by auto-closing linked issues and updating project status',
    inputSchema: {
      type: 'object',
      properties: {
        prNumber: {
          type: 'number',
          description: 'Pull request number that was merged',
        },
      },
      required: ['prNumber'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('Handling PR merge', { prNumber: input.prNumber, sessionId: context?.sessionId });

      if (!context?.orchestrator) {
        throw new Error('Orchestrator not available');
      }

      const ctoFlowManager = context.orchestrator.getCtoFlowManager?.();
      if (!ctoFlowManager) {
        throw new Error('CtoFlowManager not available');
      }

      await ctoFlowManager.handlePRMerge(input.prNumber);

      return {
        success: true,
        prNumber: input.prNumber,
        action: 'merged',
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Start project sync
 */
function createProjectSyncStartTool(logger: ILogger): MCPTool {
  return {
    name: 'github-projects/sync_start',
    description: 'Start bidirectional sync between internal state and GitHub Project',
    inputSchema: {
      type: 'object',
      properties: {
        epicId: {
          type: 'string',
          description: 'ID of the epic to sync',
        },
        intervalMs: {
          type: 'number',
          default: 30000,
          description: 'Sync interval in milliseconds (default: 30 seconds)',
        },
      },
      required: ['epicId'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('Starting project sync', { epicId: input.epicId, sessionId: context?.sessionId });

      if (!context?.orchestrator) {
        throw new Error('Orchestrator not available');
      }

      const ctoFlowManager = context.orchestrator.getCtoFlowManager?.();
      if (!ctoFlowManager) {
        throw new Error('CtoFlowManager not available');
      }

      ctoFlowManager.startProjectSync(input.epicId, input.intervalMs || 30000);

      return {
        success: true,
        epicId: input.epicId,
        intervalMs: input.intervalMs || 30000,
        status: 'syncing',
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Stop project sync
 */
function createProjectSyncStopTool(logger: ILogger): MCPTool {
  return {
    name: 'github-projects/sync_stop',
    description: 'Stop bidirectional sync for an epic',
    inputSchema: {
      type: 'object',
      properties: {
        epicId: {
          type: 'string',
          description: 'ID of the epic to stop syncing',
        },
      },
      required: ['epicId'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('Stopping project sync', { epicId: input.epicId, sessionId: context?.sessionId });

      if (!context?.orchestrator) {
        throw new Error('Orchestrator not available');
      }

      const ctoFlowManager = context.orchestrator.getCtoFlowManager?.();
      if (!ctoFlowManager) {
        throw new Error('CtoFlowManager not available');
      }

      ctoFlowManager.stopProjectSync(input.epicId);

      return {
        success: true,
        epicId: input.epicId,
        status: 'stopped',
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Get sync status
 */
function createProjectSyncStatusTool(logger: ILogger): MCPTool {
  return {
    name: 'github-projects/sync_status',
    description: 'Get the current sync status for all epics or a specific epic',
    inputSchema: {
      type: 'object',
      properties: {
        epicId: {
          type: 'string',
          description: 'Optional: ID of specific epic to check',
        },
      },
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('Getting sync status', { epicId: input.epicId, sessionId: context?.sessionId });

      if (!context?.orchestrator) {
        throw new Error('Orchestrator not available');
      }

      const ctoFlowManager = context.orchestrator.getCtoFlowManager?.();
      if (!ctoFlowManager) {
        throw new Error('CtoFlowManager not available');
      }

      const bridge = ctoFlowManager.getProjectBridge();
      if (!bridge) {
        return {
          success: true,
          configured: false,
          message: 'GitHub Projects not configured',
          timestamp: new Date().toISOString(),
        };
      }

      const syncStatus = bridge.getSyncStatus(input.epicId);

      return {
        success: true,
        configured: true,
        syncStatus,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

// ============================================================================
// Hive-Mind Tools
// ============================================================================

/**
 * Load an existing epic from GitHub
 */
function createHiveMindEpicLoadTool(logger: ILogger): MCPTool {
  return {
    name: 'hivemind/epic_load',
    description: 'Load an existing epic from a GitHub repository. This allows Hive-Mind to pick up work on existing projects with SPARC-phased tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub owner (user or organization)',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name',
        },
        epicId: {
          type: 'string',
          description: 'Optional: specific epic ID to load (searches by label if not provided)',
        },
      },
      required: ['owner', 'repo'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('Loading epic from GitHub', { owner: input.owner, repo: input.repo, sessionId: context?.sessionId });

      const { createHiveMindOrchestrator } = await import('../cto-flow-agents/integration/hive-mind-github.js');

      const orchestrator = createHiveMindOrchestrator({
        owner: input.owner,
        enableVectorSearch: true,
        enableLearning: true,
      });

      await orchestrator.initialize();

      const epic = await orchestrator.loadEpicFromGitHub(input.repo, input.epicId);

      if (!epic) {
        return {
          success: false,
          error: 'Epic not found in repository',
          owner: input.owner,
          repo: input.repo,
          timestamp: new Date().toISOString(),
        };
      }

      // Store orchestrator in context for subsequent calls
      if (context) {
        (context as any).hiveMindOrchestrator = orchestrator;
      }

      return {
        success: true,
        epicId: epic.epicId,
        epicIssueNumber: epic.epicIssueNumber,
        epicIssueUrl: epic.epicIssueUrl,
        projectUrl: epic.projectUrl,
        projectNumber: epic.projectNumber,
        tasks: epic.tasks.map(t => ({
          taskId: t.taskId,
          issueNumber: t.issueNumber,
          title: t.title,
          phase: t.phase,
          assignedAgent: t.assignedAgent?.name,
          hasProjectItemId: !!t.projectItemId,
        })),
        taskCount: epic.tasks.length,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Complete a task in Hive-Mind
 */
function createHiveMindTaskCompleteTool(logger: ILogger): MCPTool {
  return {
    name: 'hivemind/task_complete',
    description: 'Mark a task as complete. This closes the GitHub issue, updates project status to Done, and adds a completion comment.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub owner (user or organization)',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name',
        },
        epicId: {
          type: 'string',
          description: 'Epic ID (from epic_load)',
        },
        taskId: {
          type: 'string',
          description: 'Task ID or issue number to complete',
        },
        success: {
          type: 'boolean',
          default: true,
          description: 'Whether the task was completed successfully',
        },
        completedBy: {
          type: 'string',
          description: 'Name of the agent or person who completed the task',
        },
        summary: {
          type: 'string',
          description: 'Summary of what was accomplished',
        },
        artifacts: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of files or artifacts created',
        },
        moveToReview: {
          type: 'boolean',
          default: false,
          description: 'Move to Review instead of Done (keeps issue open)',
        },
      },
      required: ['owner', 'repo', 'epicId', 'taskId'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('Completing task', { epicId: input.epicId, taskId: input.taskId, sessionId: context?.sessionId });

      const { createHiveMindOrchestrator } = await import('../cto-flow-agents/integration/hive-mind-github.js');

      // Get or create orchestrator
      let orchestrator = (context as any)?.hiveMindOrchestrator;
      if (!orchestrator) {
        orchestrator = createHiveMindOrchestrator({
          owner: input.owner,
          enableVectorSearch: true,
          enableLearning: true,
        });
        await orchestrator.initialize();
        await orchestrator.loadEpicFromGitHub(input.repo, input.epicId);
      }

      const result = await orchestrator.completeTask(input.epicId, input.taskId, {
        success: input.success !== false,
        completedBy: input.completedBy || 'Hive-Mind Agent',
        summary: input.summary,
        artifacts: input.artifacts,
        moveToReview: input.moveToReview,
      });

      return {
        success: true,
        taskId: result.taskId,
        issueNumber: result.issueNumber,
        status: result.status,
        completionTime: result.completionTime,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Update task status in Hive-Mind
 */
function createHiveMindTaskStatusUpdateTool(logger: ILogger): MCPTool {
  return {
    name: 'hivemind/task_status_update',
    description: 'Update a task\'s status in the GitHub Project (move between columns)',
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub owner (user or organization)',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name',
        },
        epicId: {
          type: 'string',
          description: 'Epic ID',
        },
        taskId: {
          type: 'string',
          description: 'Task ID or issue number',
        },
        status: {
          type: 'string',
          enum: ['Todo', 'In Progress', 'Done'],
          description: 'New status for the task',
        },
      },
      required: ['owner', 'repo', 'epicId', 'taskId', 'status'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('Updating task status', { epicId: input.epicId, taskId: input.taskId, status: input.status, sessionId: context?.sessionId });

      const { createHiveMindOrchestrator } = await import('../cto-flow-agents/integration/hive-mind-github.js');

      let orchestrator = (context as any)?.hiveMindOrchestrator;
      if (!orchestrator) {
        orchestrator = createHiveMindOrchestrator({
          owner: input.owner,
          enableVectorSearch: true,
          enableLearning: true,
        });
        await orchestrator.initialize();
        await orchestrator.loadEpicFromGitHub(input.repo, input.epicId);
      }

      await orchestrator.updateTaskStatus(input.epicId, input.taskId, input.status);

      return {
        success: true,
        epicId: input.epicId,
        taskId: input.taskId,
        status: input.status,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Auto-detect completed tasks
 */
function createHiveMindDetectCompletedTool(logger: ILogger): MCPTool {
  return {
    name: 'hivemind/detect_completed',
    description: 'Auto-detect which tasks are completed by checking if expected files exist in the working directory',
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub owner (user or organization)',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name',
        },
        epicId: {
          type: 'string',
          description: 'Epic ID',
        },
        workingDir: {
          type: 'string',
          description: 'Local directory where the project files are located',
        },
      },
      required: ['owner', 'repo', 'epicId', 'workingDir'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('Detecting completed tasks', { epicId: input.epicId, workingDir: input.workingDir, sessionId: context?.sessionId });

      const { createHiveMindOrchestrator } = await import('../cto-flow-agents/integration/hive-mind-github.js');

      let orchestrator = (context as any)?.hiveMindOrchestrator;
      if (!orchestrator) {
        orchestrator = createHiveMindOrchestrator({
          owner: input.owner,
          enableVectorSearch: true,
          enableLearning: true,
        });
        await orchestrator.initialize();
        await orchestrator.loadEpicFromGitHub(input.repo, input.epicId);
      }

      const detected = await orchestrator.autoDetectCompletedTasks(input.epicId, input.workingDir);

      return {
        success: true,
        epicId: input.epicId,
        completed: detected.completed.map((t: any) => ({
          taskId: t.taskId,
          issueNumber: t.issueNumber,
          title: t.title,
          phase: t.phase,
        })),
        pending: detected.pending.map((t: any) => ({
          taskId: t.taskId,
          issueNumber: t.issueNumber,
          title: t.title,
          phase: t.phase,
        })),
        completedCount: detected.completed.length,
        pendingCount: detected.pending.length,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Sync completion status to GitHub
 */
function createHiveMindSyncCompletionTool(logger: ILogger): MCPTool {
  return {
    name: 'hivemind/sync_completion',
    description: 'Auto-detect completed tasks and sync their status to GitHub (close issues, update project board)',
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub owner (user or organization)',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name',
        },
        epicId: {
          type: 'string',
          description: 'Epic ID',
        },
        workingDir: {
          type: 'string',
          description: 'Local directory where the project files are located',
        },
        dryRun: {
          type: 'boolean',
          default: false,
          description: 'If true, only report what would be done without making changes',
        },
        completedBy: {
          type: 'string',
          default: 'Hive-Mind Auto-Sync',
          description: 'Name to attribute completions to',
        },
      },
      required: ['owner', 'repo', 'epicId', 'workingDir'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('Syncing completion status', { epicId: input.epicId, workingDir: input.workingDir, dryRun: input.dryRun, sessionId: context?.sessionId });

      const { createHiveMindOrchestrator } = await import('../cto-flow-agents/integration/hive-mind-github.js');

      let orchestrator = (context as any)?.hiveMindOrchestrator;
      if (!orchestrator) {
        orchestrator = createHiveMindOrchestrator({
          owner: input.owner,
          enableVectorSearch: true,
          enableLearning: true,
        });
        await orchestrator.initialize();
        await orchestrator.loadEpicFromGitHub(input.repo, input.epicId);
      }

      const syncResult = await orchestrator.syncCompletionStatus(input.epicId, input.workingDir, {
        dryRun: input.dryRun,
        completedBy: input.completedBy || 'Hive-Mind Auto-Sync',
      });

      return {
        success: true,
        epicId: input.epicId,
        dryRun: input.dryRun,
        detected: {
          completed: syncResult.detected.completed.map((t: any) => ({
            taskId: t.taskId,
            issueNumber: t.issueNumber,
            title: t.title,
          })),
          pending: syncResult.detected.pending.map((t: any) => ({
            taskId: t.taskId,
            issueNumber: t.issueNumber,
            title: t.title,
          })),
        },
        results: syncResult.results.map((r: any) => ({
          taskId: r.taskId,
          issueNumber: r.issueNumber,
          success: r.success,
          status: r.status,
        })),
        completedCount: syncResult.results.length,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Retrospectively complete specific tasks
 */
function createHiveMindRetrospectiveCompleteTool(logger: ILogger): MCPTool {
  return {
    name: 'hivemind/retrospective_complete',
    description: 'Retrospectively complete specific tasks that were already done. Closes issues and updates project status.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub owner (user or organization)',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name',
        },
        epicId: {
          type: 'string',
          description: 'Epic ID',
        },
        taskIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of task IDs or issue numbers to complete',
        },
        completedBy: {
          type: 'string',
          default: 'Hive-Mind Retrospective',
          description: 'Name to attribute completions to',
        },
        summary: {
          type: 'string',
          default: 'Task completed (retrospective)',
          description: 'Summary for completion comment',
        },
        closeIssues: {
          type: 'boolean',
          default: true,
          description: 'Whether to close the issues',
        },
      },
      required: ['owner', 'repo', 'epicId', 'taskIds'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('Retrospective complete', { epicId: input.epicId, taskIds: input.taskIds, sessionId: context?.sessionId });

      const { createHiveMindOrchestrator } = await import('../cto-flow-agents/integration/hive-mind-github.js');

      let orchestrator = (context as any)?.hiveMindOrchestrator;
      if (!orchestrator) {
        orchestrator = createHiveMindOrchestrator({
          owner: input.owner,
          enableVectorSearch: true,
          enableLearning: true,
        });
        await orchestrator.initialize();
        await orchestrator.loadEpicFromGitHub(input.repo, input.epicId);
      }

      const results = await orchestrator.retrospectiveComplete(input.epicId, input.taskIds, {
        completedBy: input.completedBy || 'Hive-Mind Retrospective',
        summary: input.summary || 'Task completed (retrospective)',
        closeIssues: input.closeIssues !== false,
      });

      return {
        success: true,
        epicId: input.epicId,
        results: results.map((r: any) => ({
          taskId: r.taskId,
          issueNumber: r.issueNumber,
          success: r.success,
          status: r.status,
          completionTime: r.completionTime,
        })),
        completedCount: results.length,
        requestedCount: input.taskIds.length,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

// ============================================================================
// Hive-Mind PR Tools
// ============================================================================

/**
 * Create a branch for a task
 */
function createHiveMindBranchCreateTool(logger: ILogger): MCPTool {
  return {
    name: 'hivemind/branch_create',
    description: 'Create a Git branch for a specific task. Generates a branch name based on the task if not provided.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub owner (user or organization)',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name',
        },
        epicId: {
          type: 'string',
          description: 'Epic ID',
        },
        taskId: {
          type: 'string',
          description: 'Task ID or issue number to create branch for',
        },
        branchName: {
          type: 'string',
          description: 'Optional: custom branch name (auto-generated if not provided)',
        },
      },
      required: ['owner', 'repo', 'epicId', 'taskId'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('Creating task branch', { epicId: input.epicId, taskId: input.taskId, sessionId: context?.sessionId });

      const { createHiveMindOrchestrator } = await import('../cto-flow-agents/integration/hive-mind-github.js');

      let orchestrator = (context as any)?.hiveMindOrchestrator;
      if (!orchestrator) {
        orchestrator = createHiveMindOrchestrator({
          owner: input.owner,
          enableVectorSearch: true,
          enableLearning: true,
        });
        await orchestrator.initialize();
        await orchestrator.loadEpicFromGitHub(input.repo, input.epicId);
        if (context) {
          (context as any).hiveMindOrchestrator = orchestrator;
        }
      }

      const result = await orchestrator.createTaskBranch(input.epicId, input.taskId, input.branchName);

      return {
        success: true,
        epicId: input.epicId,
        taskId: input.taskId,
        branch: result.branch,
        sha: result.sha,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Create a pull request for tasks
 */
function createHiveMindPRCreateTool(logger: ILogger): MCPTool {
  return {
    name: 'hivemind/pr_create',
    description: 'Create a pull request linked to epic tasks. Automatically updates task issues and epic with PR references.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub owner (user or organization)',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name',
        },
        epicId: {
          type: 'string',
          description: 'Epic ID',
        },
        title: {
          type: 'string',
          description: 'PR title',
        },
        body: {
          type: 'string',
          description: 'PR description',
        },
        branch: {
          type: 'string',
          description: 'Source branch name',
        },
        baseBranch: {
          type: 'string',
          default: 'main',
          description: 'Target branch to merge into',
        },
        taskIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Task IDs or issue numbers to link to this PR',
        },
        draft: {
          type: 'boolean',
          default: false,
          description: 'Create as draft PR',
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional labels to add',
        },
        reviewers: {
          type: 'array',
          items: { type: 'string' },
          description: 'GitHub usernames to request as reviewers',
        },
        addToProject: {
          type: 'boolean',
          default: true,
          description: 'Add PR to epic project board',
        },
      },
      required: ['owner', 'repo', 'epicId', 'title', 'body', 'branch'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('Creating PR', { epicId: input.epicId, branch: input.branch, sessionId: context?.sessionId });

      const { createHiveMindOrchestrator } = await import('../cto-flow-agents/integration/hive-mind-github.js');

      let orchestrator = (context as any)?.hiveMindOrchestrator;
      if (!orchestrator) {
        orchestrator = createHiveMindOrchestrator({
          owner: input.owner,
          enableVectorSearch: true,
          enableLearning: true,
        });
        await orchestrator.initialize();
        await orchestrator.loadEpicFromGitHub(input.repo, input.epicId);
        if (context) {
          (context as any).hiveMindOrchestrator = orchestrator;
        }
      }

      const result = await orchestrator.createPullRequest(input.epicId, {
        title: input.title,
        body: input.body,
        branch: input.branch,
        baseBranch: input.baseBranch || 'main',
        taskIds: input.taskIds,
        draft: input.draft,
        labels: input.labels,
        reviewers: input.reviewers,
        addToProject: input.addToProject !== false,
      });

      return {
        success: true,
        epicId: input.epicId,
        prNumber: result.prNumber,
        prUrl: result.prUrl,
        branch: result.branch,
        linkedIssues: result.linkedIssues,
        projectItemId: result.projectItemId,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * List PRs for an epic
 */
function createHiveMindPRListTool(logger: ILogger): MCPTool {
  return {
    name: 'hivemind/pr_list',
    description: 'List all pull requests associated with an epic',
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub owner (user or organization)',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name',
        },
        epicId: {
          type: 'string',
          description: 'Epic ID',
        },
        state: {
          type: 'string',
          enum: ['open', 'closed', 'all'],
          default: 'all',
          description: 'Filter by PR state',
        },
        includeExternal: {
          type: 'boolean',
          default: true,
          description: 'Include PRs not created via Hive-Mind but linked to epic issues',
        },
      },
      required: ['owner', 'repo', 'epicId'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('Listing PRs', { epicId: input.epicId, sessionId: context?.sessionId });

      const { createHiveMindOrchestrator } = await import('../cto-flow-agents/integration/hive-mind-github.js');

      let orchestrator = (context as any)?.hiveMindOrchestrator;
      if (!orchestrator) {
        orchestrator = createHiveMindOrchestrator({
          owner: input.owner,
          enableVectorSearch: true,
          enableLearning: true,
        });
        await orchestrator.initialize();
        await orchestrator.loadEpicFromGitHub(input.repo, input.epicId);
        if (context) {
          (context as any).hiveMindOrchestrator = orchestrator;
        }
      }

      const prs = await orchestrator.listEpicPullRequests(input.epicId, {
        state: input.state,
        includeExternal: input.includeExternal !== false,
      });

      return {
        success: true,
        epicId: input.epicId,
        pullRequests: prs.map((pr: any) => ({
          prNumber: pr.prNumber,
          prUrl: pr.prUrl,
          title: pr.title,
          branch: pr.branch,
          baseBranch: pr.baseBranch,
          status: pr.status,
          linkedIssues: pr.linkedIssueNumbers,
          createdAt: pr.createdAt,
          mergedAt: pr.mergedAt,
        })),
        total: prs.length,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Link PR to tasks
 */
function createHiveMindPRLinkTool(logger: ILogger): MCPTool {
  return {
    name: 'hivemind/pr_link',
    description: 'Link an existing pull request to epic tasks. Updates PR body, adds comments to issues, and notifies epic.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub owner (user or organization)',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name',
        },
        epicId: {
          type: 'string',
          description: 'Epic ID',
        },
        prNumber: {
          type: 'number',
          description: 'PR number to link',
        },
        taskIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Task IDs or issue numbers to link',
        },
        addComments: {
          type: 'boolean',
          default: true,
          description: 'Add comments to linked issues',
        },
        updateEpic: {
          type: 'boolean',
          default: true,
          description: 'Add notification comment to epic issue',
        },
      },
      required: ['owner', 'repo', 'epicId', 'prNumber', 'taskIds'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('Linking PR to tasks', { epicId: input.epicId, prNumber: input.prNumber, sessionId: context?.sessionId });

      const { createHiveMindOrchestrator } = await import('../cto-flow-agents/integration/hive-mind-github.js');

      let orchestrator = (context as any)?.hiveMindOrchestrator;
      if (!orchestrator) {
        orchestrator = createHiveMindOrchestrator({
          owner: input.owner,
          enableVectorSearch: true,
          enableLearning: true,
        });
        await orchestrator.initialize();
        await orchestrator.loadEpicFromGitHub(input.repo, input.epicId);
        if (context) {
          (context as any).hiveMindOrchestrator = orchestrator;
        }
      }

      await orchestrator.linkPullRequestToTasks(input.epicId, input.prNumber, input.taskIds, {
        addComments: input.addComments !== false,
        updateEpic: input.updateEpic !== false,
      });

      return {
        success: true,
        epicId: input.epicId,
        prNumber: input.prNumber,
        linkedTasks: input.taskIds.length,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Sync PR status
 */
function createHiveMindPRStatusTool(logger: ILogger): MCPTool {
  return {
    name: 'hivemind/pr_status',
    description: 'Get or sync the status of a pull request. Checks reviews, approvals, and merge state.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub owner (user or organization)',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name',
        },
        epicId: {
          type: 'string',
          description: 'Epic ID',
        },
        prNumber: {
          type: 'number',
          description: 'PR number to check',
        },
      },
      required: ['owner', 'repo', 'epicId', 'prNumber'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('Getting PR status', { epicId: input.epicId, prNumber: input.prNumber, sessionId: context?.sessionId });

      const { createHiveMindOrchestrator } = await import('../cto-flow-agents/integration/hive-mind-github.js');

      let orchestrator = (context as any)?.hiveMindOrchestrator;
      if (!orchestrator) {
        orchestrator = createHiveMindOrchestrator({
          owner: input.owner,
          enableVectorSearch: true,
          enableLearning: true,
        });
        await orchestrator.initialize();
        await orchestrator.loadEpicFromGitHub(input.repo, input.epicId);
        if (context) {
          (context as any).hiveMindOrchestrator = orchestrator;
        }
      }

      const pr = await orchestrator.syncPullRequestStatus(input.epicId, input.prNumber);

      if (!pr) {
        return {
          success: false,
          error: `PR #${input.prNumber} not found`,
          epicId: input.epicId,
          prNumber: input.prNumber,
          timestamp: new Date().toISOString(),
        };
      }

      return {
        success: true,
        epicId: input.epicId,
        prNumber: pr.prNumber,
        prUrl: pr.prUrl,
        title: pr.title,
        branch: pr.branch,
        baseBranch: pr.baseBranch,
        status: pr.status,
        linkedIssues: pr.linkedIssueNumbers,
        createdAt: pr.createdAt,
        mergedAt: pr.mergedAt,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Handle PR merge
 */
function createHiveMindPRMergeTool(logger: ILogger): MCPTool {
  return {
    name: 'hivemind/pr_merge',
    description: 'Handle a merged PR - sync status, complete linked tasks, and update epic. Call this after a PR has been merged.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub owner (user or organization)',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name',
        },
        epicId: {
          type: 'string',
          description: 'Epic ID',
        },
        prNumber: {
          type: 'number',
          description: 'PR number that was merged',
        },
        completeTasks: {
          type: 'boolean',
          default: true,
          description: 'Automatically complete linked tasks',
        },
        completedBy: {
          type: 'string',
          default: 'Hive-Mind (PR Merged)',
          description: 'Attribution for task completion',
        },
      },
      required: ['owner', 'repo', 'epicId', 'prNumber'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('Handling PR merge', { epicId: input.epicId, prNumber: input.prNumber, sessionId: context?.sessionId });

      const { createHiveMindOrchestrator } = await import('../cto-flow-agents/integration/hive-mind-github.js');

      let orchestrator = (context as any)?.hiveMindOrchestrator;
      if (!orchestrator) {
        orchestrator = createHiveMindOrchestrator({
          owner: input.owner,
          enableVectorSearch: true,
          enableLearning: true,
        });
        await orchestrator.initialize();
        await orchestrator.loadEpicFromGitHub(input.repo, input.epicId);
        if (context) {
          (context as any).hiveMindOrchestrator = orchestrator;
        }
      }

      const result = await orchestrator.handlePullRequestMerge(input.epicId, input.prNumber, {
        completeTasks: input.completeTasks !== false,
        completedBy: input.completedBy || 'Hive-Mind (PR Merged)',
      });

      return {
        success: true,
        epicId: input.epicId,
        prNumber: result.pr.prNumber,
        prStatus: result.pr.status,
        completedTasks: result.completedTasks.map((t: any) => ({
          taskId: t.taskId,
          issueNumber: t.issueNumber,
          success: t.success,
          status: t.status,
        })),
        completedCount: result.completedTasks.length,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Get PR statistics for epic
 */
function createHiveMindPRStatsTool(logger: ILogger): MCPTool {
  return {
    name: 'hivemind/pr_stats',
    description: 'Get PR statistics for an epic - total PRs, merged, open, and task coverage',
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub owner (user or organization)',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name',
        },
        epicId: {
          type: 'string',
          description: 'Epic ID',
        },
      },
      required: ['owner', 'repo', 'epicId'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('Getting PR stats', { epicId: input.epicId, sessionId: context?.sessionId });

      const { createHiveMindOrchestrator } = await import('../cto-flow-agents/integration/hive-mind-github.js');

      let orchestrator = (context as any)?.hiveMindOrchestrator;
      if (!orchestrator) {
        orchestrator = createHiveMindOrchestrator({
          owner: input.owner,
          enableVectorSearch: true,
          enableLearning: true,
        });
        await orchestrator.initialize();
        await orchestrator.loadEpicFromGitHub(input.repo, input.epicId);
        if (context) {
          (context as any).hiveMindOrchestrator = orchestrator;
        }
      }

      const stats = await orchestrator.getEpicPRStats(input.epicId);

      return {
        success: true,
        epicId: input.epicId,
        stats: {
          total: stats.total,
          open: stats.open,
          merged: stats.merged,
          closed: stats.closed,
          draft: stats.draft,
          tasksWithPR: stats.tasksWithPR,
          tasksWithoutPR: stats.tasksWithoutPR,
          prCoverage: stats.tasksWithPR + stats.tasksWithoutPR > 0
            ? Math.round((stats.tasksWithPR / (stats.tasksWithPR + stats.tasksWithoutPR)) * 100)
            : 0,
        },
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Get tasks that are ready for implementation
 */
function createHiveMindReadyTasksTool(logger: ILogger): MCPTool {
  return {
    name: 'hivemind/tasks_ready',
    description: 'Get tasks that are ready for implementation. Returns tasks that are not blocked, not in progress, and not done. Useful for Hive-Mind agents to pick up work.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub owner (user or organization)',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name',
        },
        epicId: {
          type: 'string',
          description: 'Epic ID',
        },
        phase: {
          type: 'string',
          enum: ['Specification', 'Pseudocode', 'Architecture', 'Refinement', 'Completion'],
          description: 'Filter by SPARC phase',
        },
        agentType: {
          type: 'string',
          description: 'Filter by assigned agent type (researcher, coder, tester, etc.)',
        },
        checkDependencies: {
          type: 'boolean',
          default: true,
          description: 'Only return tasks whose dependencies are complete',
        },
        refreshFromGitHub: {
          type: 'boolean',
          default: false,
          description: 'Refresh task statuses from GitHub before returning',
        },
      },
      required: ['owner', 'repo', 'epicId'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('Getting ready tasks', { epicId: input.epicId, phase: input.phase, sessionId: context?.sessionId });

      const { createHiveMindOrchestrator } = await import('../cto-flow-agents/integration/hive-mind-github.js');

      let orchestrator = (context as any)?.hiveMindOrchestrator;
      if (!orchestrator) {
        orchestrator = createHiveMindOrchestrator({
          owner: input.owner,
          enableVectorSearch: true,
          enableLearning: true,
        });
        await orchestrator.initialize();
        await orchestrator.loadEpicFromGitHub(input.repo, input.epicId);
        if (context) {
          (context as any).hiveMindOrchestrator = orchestrator;
        }
      }

      // Optionally refresh from GitHub
      if (input.refreshFromGitHub) {
        await orchestrator.refreshTaskStatuses(input.epicId);
      }

      const readyTasks = orchestrator.getReadyTasks(input.epicId, {
        phase: input.phase,
        agentType: input.agentType,
        includeDependencyCheck: input.checkDependencies !== false,
      });

      return {
        success: true,
        epicId: input.epicId,
        filters: {
          phase: input.phase || 'all',
          agentType: input.agentType || 'all',
          checkDependencies: input.checkDependencies !== false,
        },
        count: readyTasks.length,
        tasks: readyTasks.map(task => ({
          taskId: task.taskId,
          issueNumber: task.issueNumber,
          issueUrl: task.issueUrl,
          title: task.title,
          phase: task.phase,
          status: task.status,
          assignedAgent: task.assignedAgent ? {
            name: task.assignedAgent.name,
            type: task.assignedAgent.type,
          } : null,
          dependencies: task.dependencies || [],
        })),
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Get the next task to work on
 */
function createHiveMindNextTaskTool(logger: ILogger): MCPTool {
  return {
    name: 'hivemind/task_next',
    description: 'Get the next highest priority task to work on. Returns the first ready task based on SPARC phase order and dependencies.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub owner (user or organization)',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name',
        },
        epicId: {
          type: 'string',
          description: 'Epic ID',
        },
        agentType: {
          type: 'string',
          description: 'Filter by agent type (only return tasks assigned to this agent type)',
        },
        refreshFromGitHub: {
          type: 'boolean',
          default: false,
          description: 'Refresh task statuses from GitHub before returning',
        },
      },
      required: ['owner', 'repo', 'epicId'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('Getting next task', { epicId: input.epicId, agentType: input.agentType, sessionId: context?.sessionId });

      const { createHiveMindOrchestrator } = await import('../cto-flow-agents/integration/hive-mind-github.js');

      let orchestrator = (context as any)?.hiveMindOrchestrator;
      if (!orchestrator) {
        orchestrator = createHiveMindOrchestrator({
          owner: input.owner,
          enableVectorSearch: true,
          enableLearning: true,
        });
        await orchestrator.initialize();
        await orchestrator.loadEpicFromGitHub(input.repo, input.epicId);
        if (context) {
          (context as any).hiveMindOrchestrator = orchestrator;
        }
      }

      // Optionally refresh from GitHub
      if (input.refreshFromGitHub) {
        await orchestrator.refreshTaskStatuses(input.epicId);
      }

      const nextTask = orchestrator.getNextTask(input.epicId, input.agentType);

      if (!nextTask) {
        return {
          success: true,
          epicId: input.epicId,
          hasNextTask: false,
          message: 'No ready tasks available',
          timestamp: new Date().toISOString(),
        };
      }

      return {
        success: true,
        epicId: input.epicId,
        hasNextTask: true,
        task: {
          taskId: nextTask.taskId,
          issueNumber: nextTask.issueNumber,
          issueUrl: nextTask.issueUrl,
          title: nextTask.title,
          phase: nextTask.phase,
          status: nextTask.status,
          assignedAgent: nextTask.assignedAgent ? {
            name: nextTask.assignedAgent.name,
            type: nextTask.assignedAgent.type,
            skills: nextTask.assignedAgent.skills,
          } : null,
          dependencies: nextTask.dependencies || [],
        },
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Get task status summary for an epic
 */
function createHiveMindTaskStatusSummaryTool(logger: ILogger): MCPTool {
  return {
    name: 'hivemind/task_status_summary',
    description: 'Get a summary of task statuses for an epic. Shows counts by status (backlog, ready, in_progress, review, done, blocked) and progress by SPARC phase.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub owner (user or organization)',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name',
        },
        epicId: {
          type: 'string',
          description: 'Epic ID',
        },
        refreshFromGitHub: {
          type: 'boolean',
          default: false,
          description: 'Refresh task statuses from GitHub before returning',
        },
      },
      required: ['owner', 'repo', 'epicId'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('Getting task status summary', { epicId: input.epicId, sessionId: context?.sessionId });

      const { createHiveMindOrchestrator } = await import('../cto-flow-agents/integration/hive-mind-github.js');

      let orchestrator = (context as any)?.hiveMindOrchestrator;
      if (!orchestrator) {
        orchestrator = createHiveMindOrchestrator({
          owner: input.owner,
          enableVectorSearch: true,
          enableLearning: true,
        });
        await orchestrator.initialize();
        await orchestrator.loadEpicFromGitHub(input.repo, input.epicId);
        if (context) {
          (context as any).hiveMindOrchestrator = orchestrator;
        }
      }

      // Optionally refresh from GitHub
      if (input.refreshFromGitHub) {
        await orchestrator.refreshTaskStatuses(input.epicId);
      }

      const summary = orchestrator.getTaskStatusSummary(input.epicId);

      // Calculate overall progress
      const overallProgress = summary.total > 0
        ? Math.round((summary.done / summary.total) * 100)
        : 0;

      // Calculate active work (in_progress + review)
      const activeWork = summary.inProgress + summary.review;

      return {
        success: true,
        epicId: input.epicId,
        summary: {
          total: summary.total,
          backlog: summary.backlog,
          ready: summary.ready,
          inProgress: summary.inProgress,
          review: summary.review,
          done: summary.done,
          blocked: summary.blocked,
        },
        progress: {
          overallPercent: overallProgress,
          activeWork,
          availableWork: summary.ready + summary.backlog,
        },
        byPhase: summary.byPhase,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Refresh task statuses from GitHub
 */
function createHiveMindRefreshStatusTool(logger: ILogger): MCPTool {
  return {
    name: 'hivemind/task_status_refresh',
    description: 'Refresh task statuses from GitHub. Syncs local cache with current GitHub project board and issue states.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub owner (user or organization)',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name',
        },
        epicId: {
          type: 'string',
          description: 'Epic ID',
        },
      },
      required: ['owner', 'repo', 'epicId'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('Refreshing task statuses', { epicId: input.epicId, sessionId: context?.sessionId });

      const { createHiveMindOrchestrator } = await import('../cto-flow-agents/integration/hive-mind-github.js');

      let orchestrator = (context as any)?.hiveMindOrchestrator;
      if (!orchestrator) {
        orchestrator = createHiveMindOrchestrator({
          owner: input.owner,
          enableVectorSearch: true,
          enableLearning: true,
        });
        await orchestrator.initialize();
        await orchestrator.loadEpicFromGitHub(input.repo, input.epicId);
        if (context) {
          (context as any).hiveMindOrchestrator = orchestrator;
        }
      }

      await orchestrator.refreshTaskStatuses(input.epicId);

      // Get updated summary
      const summary = orchestrator.getTaskStatusSummary(input.epicId);

      return {
        success: true,
        epicId: input.epicId,
        message: 'Task statuses refreshed from GitHub',
        summary: {
          total: summary.total,
          backlog: summary.backlog,
          ready: summary.ready,
          inProgress: summary.inProgress,
          review: summary.review,
          done: summary.done,
          blocked: summary.blocked,
        },
        timestamp: new Date().toISOString(),
      };
    },
  };
}

// ============================================================================
// CTO Flow Tools - Post-SPARC Epic Creation with Octokit
// ============================================================================

/**
 * CTO Flow: Create Epic from SPARC Output
 *
 * This tool takes SPARC-generated plan data and creates a complete GitHub epic
 * with project, issues, and task tracking. Uses Octokit through HiveMindGitHubOrchestrator.
 */
function createCTOFlowCreateEpicTool(logger: ILogger): MCPTool {
  return {
    name: 'ctoflow/create_epic',
    description: `Create a GitHub Epic from SPARC output using Octokit.
Takes specification/architecture output and creates:
- GitHub Project (v2) with SPARC status columns
- Epic issue with objectives and constraints
- Task issues for each phase with labels and dependencies
- Agent skill matching for recommendations (no auto-assignment)

Agents must wait for explicit GitHub assignment before picking up work.`,
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub owner (user or organization)',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name',
        },
        title: {
          type: 'string',
          description: 'Epic title (from SPARC specification)',
        },
        description: {
          type: 'string',
          description: 'Epic description summarizing the project',
        },
        objectives: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of objectives from specification',
        },
        constraints: {
          type: 'array',
          items: { type: 'string' },
          description: 'Technical and business constraints',
        },
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Task title' },
              description: { type: 'string', description: 'Task description' },
              phase: {
                type: 'string',
                enum: ['Specification', 'Pseudocode', 'Architecture', 'Refinement', 'Completion'],
                description: 'SPARC phase for this task'
              },
              skills: {
                type: 'array',
                items: { type: 'string' },
                description: 'Required skills (typescript, api-design, testing, etc.)'
              },
              priority: {
                type: 'string',
                enum: ['low', 'medium', 'high', 'critical'],
                description: 'Task priority'
              },
              dependencies: {
                type: 'array',
                items: { type: 'string' },
                description: 'Task IDs this depends on',
              },
              estimatedHours: { type: 'number', description: 'Estimated hours' },
            },
            required: ['title', 'description', 'phase', 'skills', 'priority'],
          },
          description: 'Tasks from architecture phase',
        },
        metadata: {
          type: 'object',
          description: 'Additional metadata (dataSource, targetUsers, etc.)',
        },
      },
      required: ['owner', 'repo', 'title', 'description', 'objectives', 'constraints', 'tasks'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('CTO Flow: Creating epic from SPARC output', {
        title: input.title,
        taskCount: input.tasks?.length,
        sessionId: context?.sessionId,
      });

      const { createHiveMindOrchestrator } = await import('../cto-flow-agents/integration/hive-mind-github.js');

      // Create orchestrator with Octokit
      const orchestrator = createHiveMindOrchestrator({
        owner: input.owner,
        repo: input.repo,
        enableVectorSearch: true,
        enableLearning: true,
        autoCreateLabels: true,
      });

      await orchestrator.initialize();

      // Build EpicPlan from input
      const epicPlan = {
        title: input.title,
        description: input.description,
        objectives: input.objectives || [],
        constraints: input.constraints || [],
        tasks: (input.tasks || []).map((t: any) => ({
          title: t.title,
          description: t.description,
          phase: t.phase,
          skills: t.skills || [],
          priority: t.priority || 'medium',
          dependencies: t.dependencies,
          estimatedHours: t.estimatedHours,
        })),
        metadata: input.metadata,
      };

      // Create epic using Octokit
      const createdEpic = await orchestrator.createEpic(epicPlan);

      logger.info('CTO Flow: Epic created successfully', {
        epicId: createdEpic.epicId,
        projectUrl: createdEpic.projectUrl,
        taskCount: createdEpic.tasks.length,
      });

      // Store orchestrator in context for subsequent calls
      if (context) {
        (context as any).hiveMindOrchestrator = orchestrator;
        (context as any).activeEpicId = createdEpic.epicId;
      }

      return {
        success: true,
        epicId: createdEpic.epicId,
        projectUrl: createdEpic.projectUrl,
        projectNumber: createdEpic.projectNumber,
        epicIssueNumber: createdEpic.epicIssueNumber,
        epicIssueUrl: createdEpic.epicIssueUrl,
        tasks: createdEpic.tasks.map(t => ({
          taskId: t.taskId,
          issueNumber: t.issueNumber,
          issueUrl: t.issueUrl,
          title: t.title,
          phase: t.phase,
          status: t.status,
          recommendedAgent: t.assignedAgent?.type,
          assignmentScore: t.assignmentScore,
        })),
        message: `Epic created with ${createdEpic.tasks.length} tasks. Tasks are in 'backlog' status awaiting explicit GitHub assignment.`,
        nextSteps: [
          'Review tasks in GitHub Project',
          'Assign human reviewers or agent users to issues',
          'Use ctoflow/watch_assignments to detect when tasks are assigned',
          'Agents will only pick up tasks after explicit assignment',
        ],
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * CTO Flow: Get Unassigned Tasks
 *
 * Returns tasks that are waiting for explicit GitHub assignment.
 * These tasks have been created but not yet assigned to any user/agent.
 */
function createCTOFlowUnassignedTasksTool(logger: ILogger): MCPTool {
  return {
    name: 'ctoflow/unassigned_tasks',
    description: `Get tasks awaiting explicit GitHub assignment.
Returns all tasks that:
- Are in 'backlog' or 'ready' status
- Have no GitHub assignees set
- Are waiting for human review and assignment

Use this to see what work is pending human decision.`,
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub owner (user or organization)',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name',
        },
        epicId: {
          type: 'string',
          description: 'Epic ID to check (optional, checks all if not provided)',
        },
        phase: {
          type: 'string',
          enum: ['Specification', 'Pseudocode', 'Architecture', 'Refinement', 'Completion'],
          description: 'Filter by SPARC phase',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          description: 'Filter by priority',
        },
      },
      required: ['owner', 'repo'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('CTO Flow: Getting unassigned tasks', {
        epicId: input.epicId,
        sessionId: context?.sessionId,
      });

      const { createHiveMindOrchestrator } = await import('../cto-flow-agents/integration/hive-mind-github.js');

      let orchestrator = (context as any)?.hiveMindOrchestrator;
      if (!orchestrator) {
        orchestrator = createHiveMindOrchestrator({
          owner: input.owner,
          repo: input.repo,
          enableVectorSearch: true,
        });
        await orchestrator.initialize();

        if (input.epicId) {
          await orchestrator.loadEpicFromGitHub(input.repo, input.epicId);
        }

        if (context) {
          (context as any).hiveMindOrchestrator = orchestrator;
        }
      }

      // Refresh statuses from GitHub
      if (input.epicId) {
        await orchestrator.refreshTaskStatuses(input.epicId);
      }

      // Get tasks with no GitHub assignees
      const allTasks = orchestrator.getTasksByStatus(input.epicId, ['backlog', 'ready']);

      const unassignedTasks = allTasks.filter((task: any) => {
        // No GitHub assignees
        if (task.githubAssignees && task.githubAssignees.length > 0) {
          return false;
        }
        // Apply phase filter
        if (input.phase && task.phase !== input.phase) {
          return false;
        }
        // Apply priority filter (need to check metadata)
        return true;
      });

      return {
        success: true,
        epicId: input.epicId,
        unassignedCount: unassignedTasks.length,
        tasks: unassignedTasks.map((t: any) => ({
          taskId: t.taskId,
          issueNumber: t.issueNumber,
          issueUrl: t.issueUrl,
          title: t.title,
          phase: t.phase,
          status: t.status,
          recommendedAgent: t.assignedAgent?.type,
          dependencies: t.dependencies,
        })),
        message: unassignedTasks.length > 0
          ? `${unassignedTasks.length} tasks awaiting assignment. Assign users in GitHub to enable agent work.`
          : 'All tasks have been assigned.',
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * CTO Flow: Watch for Task Assignments
 *
 * Polls or uses webhook to detect when tasks are explicitly assigned in GitHub.
 * Returns newly assigned tasks that agents can now pick up.
 */
function createCTOFlowWatchAssignmentsTool(logger: ILogger): MCPTool {
  return {
    name: 'ctoflow/watch_assignments',
    description: `Watch for explicit GitHub task assignments.
Checks for tasks that have been assigned to users/agents since last check.
Returns newly assigned tasks that are ready for work.

In CTO flow, agents must wait for explicit assignment before starting work.
This tool detects when a human has reviewed and assigned tasks.`,
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub owner (user or organization)',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name',
        },
        epicId: {
          type: 'string',
          description: 'Epic ID to watch',
        },
        agentUsername: {
          type: 'string',
          description: 'GitHub username of the agent to filter for',
        },
        pollInterval: {
          type: 'number',
          description: 'Seconds to wait between checks (for continuous watching)',
          default: 30,
        },
        singleCheck: {
          type: 'boolean',
          description: 'If true, check once and return. If false, poll continuously.',
          default: true,
        },
      },
      required: ['owner', 'repo', 'epicId'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('CTO Flow: Watching for assignments', {
        epicId: input.epicId,
        agentUsername: input.agentUsername,
        sessionId: context?.sessionId,
      });

      const { createHiveMindOrchestrator } = await import('../cto-flow-agents/integration/hive-mind-github.js');

      let orchestrator = (context as any)?.hiveMindOrchestrator;
      if (!orchestrator) {
        orchestrator = createHiveMindOrchestrator({
          owner: input.owner,
          repo: input.repo,
          enableVectorSearch: true,
        });
        await orchestrator.initialize();
        await orchestrator.loadEpicFromGitHub(input.repo, input.epicId);

        if (context) {
          (context as any).hiveMindOrchestrator = orchestrator;
        }
      }

      // Refresh statuses from GitHub to detect assignment changes
      await orchestrator.refreshTaskStatuses(input.epicId);

      // Get tasks that are assigned
      const allTasks = orchestrator.getTasksByStatus(input.epicId, ['backlog', 'ready', 'in_progress']);

      // Filter for tasks with explicit GitHub assignments
      const assignedTasks = allTasks.filter((task: any) => {
        // Must have GitHub assignees
        if (!task.githubAssignees || task.githubAssignees.length === 0) {
          return false;
        }
        // If filtering for specific agent, check username
        if (input.agentUsername) {
          return task.githubAssignees.includes(input.agentUsername);
        }
        return true;
      });

      // Split into ready-to-work (backlog/ready) vs already in progress
      const readyToStart = assignedTasks.filter((t: any) =>
        t.status === 'backlog' || t.status === 'ready'
      );
      const inProgress = assignedTasks.filter((t: any) =>
        t.status === 'in_progress'
      );

      return {
        success: true,
        epicId: input.epicId,
        assignedCount: assignedTasks.length,
        readyToStartCount: readyToStart.length,
        inProgressCount: inProgress.length,
        readyToStart: readyToStart.map((t: any) => ({
          taskId: t.taskId,
          issueNumber: t.issueNumber,
          issueUrl: t.issueUrl,
          title: t.title,
          phase: t.phase,
          status: t.status,
          assignees: t.githubAssignees,
          dependencies: t.dependencies,
        })),
        inProgress: inProgress.map((t: any) => ({
          taskId: t.taskId,
          issueNumber: t.issueNumber,
          title: t.title,
          assignees: t.githubAssignees,
        })),
        message: readyToStart.length > 0
          ? `${readyToStart.length} assigned tasks ready to start. Use hivemind/task_status_update to mark as 'in_progress' when starting.`
          : 'No newly assigned tasks found. Waiting for human assignment.',
        nextSteps: readyToStart.length > 0
          ? [
              'Pick up an assigned task',
              'Update status to in_progress using hivemind/task_status_update',
              'Complete work and create PR',
              'Mark task done with hivemind/task_complete',
            ]
          : ['Wait for human to assign tasks in GitHub'],
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * CTO Flow: Create Teammate-Style Epic from SPARC Deliverables
 *
 * This is the advanced CTO flow that creates issues like a great CTO manages developers:
 * - Clear objectives with full architectural context
 * - Acceptance criteria from SPARC specification
 * - Implementation guidelines from architecture phase
 * - ADRs (Architectural Decision Records) linked to issues
 * - Dependencies and blocking relationships
 *
 * Issues contain everything an agent needs to work autonomously.
 */
function createCTOFlowEpicTool(logger: ILogger): MCPTool {
  return {
    name: 'ctoflow/teammate_epic',
    description: `Create a comprehensive GitHub Epic with teammate-style issues.

Unlike simple task lists, this creates issues that contain:
- Full architectural context and guidelines
- Acceptance criteria with testable conditions
- Implementation approach from SPARC architecture
- Related ADRs (Architectural Decision Records)
- Dependencies and sequencing
- Code structure and patterns to follow

Agents can pick up these issues and work autonomously with full context,
like well-managed developers on a real team.

This is the "CTO mode" - set clear objectives, establish workflows,
remove blockers, and trust agents to deliver.`,
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub owner (user or organization)',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name',
        },
        epicTitle: {
          type: 'string',
          description: 'Epic title',
        },
        epicDescription: {
          type: 'string',
          description: 'High-level epic description',
        },
        specification: {
          type: 'object',
          description: 'SPARC Specification phase output',
          properties: {
            requirements: {
              type: 'array',
              items: { type: 'string' },
              description: 'Functional requirements',
            },
            userStories: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                  description: { type: 'string' },
                  acceptanceCriteria: { type: 'array', items: { type: 'string' } },
                  priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
                },
              },
            },
            constraints: {
              type: 'object',
              properties: {
                technical: { type: 'array', items: { type: 'string' } },
                business: { type: 'array', items: { type: 'string' } },
              },
            },
            risks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  description: { type: 'string' },
                  severity: { type: 'string' },
                  mitigation: { type: 'string' },
                },
              },
            },
          },
        },
        architecture: {
          type: 'object',
          description: 'SPARC Architecture phase output',
          properties: {
            systemDesign: {
              type: 'string',
              description: 'Overall system architecture description',
            },
            components: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  responsibility: { type: 'string' },
                  interfaces: { type: 'array', items: { type: 'string' } },
                  dependencies: { type: 'array', items: { type: 'string' } },
                },
              },
            },
            dataFlow: {
              type: 'string',
              description: 'Data flow description',
            },
            patterns: {
              type: 'array',
              items: { type: 'string' },
              description: 'Design patterns to use',
            },
            adrs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                  context: { type: 'string' },
                  decision: { type: 'string' },
                  consequences: { type: 'array', items: { type: 'string' } },
                },
              },
              description: 'Architectural Decision Records',
            },
          },
        },
        implementation: {
          type: 'object',
          description: 'Implementation tasks derived from architecture',
          properties: {
            tasks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                  description: { type: 'string' },
                  phase: { type: 'string', enum: ['Specification', 'Pseudocode', 'Architecture', 'Refinement', 'Completion'] },
                  component: { type: 'string', description: 'Which architectural component this implements' },
                  acceptanceCriteria: { type: 'array', items: { type: 'string' } },
                  implementationNotes: { type: 'string', description: 'Specific implementation guidance' },
                  testStrategy: { type: 'string', description: 'How to test this task' },
                  files: { type: 'array', items: { type: 'string' }, description: 'Files to create/modify' },
                  dependencies: { type: 'array', items: { type: 'string' }, description: 'Task IDs this depends on' },
                  relatedAdrs: { type: 'array', items: { type: 'string' }, description: 'ADR IDs relevant to this task' },
                  skills: { type: 'array', items: { type: 'string' } },
                  priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
                  estimatedHours: { type: 'number' },
                },
                required: ['id', 'title', 'description', 'phase'],
              },
            },
          },
        },
      },
      required: ['owner', 'repo', 'epicTitle', 'epicDescription', 'specification', 'architecture', 'implementation'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('CTO Flow: Creating teammate-style epic', {
        title: input.epicTitle,
        taskCount: input.implementation?.tasks?.length,
        adrCount: input.architecture?.adrs?.length,
        sessionId: context?.sessionId,
      });

      const { createHiveMindOrchestrator } = await import('../cto-flow-agents/integration/hive-mind-github.js');

      // Create orchestrator with Octokit
      const orchestrator = createHiveMindOrchestrator({
        owner: input.owner,
        repo: input.repo,
        enableVectorSearch: true,
        enableLearning: true,
        autoCreateLabels: true,
      });

      await orchestrator.initialize();

      // Build comprehensive epic body with full context
      const epicBody = generateTeammateEpicBody(input);

      // Build tasks with rich context
      const tasksWithContext = (input.implementation?.tasks || []).map((task: any) => {
        const taskBody = generateTeammateTaskBody(task, input);
        return {
          title: task.title,
          description: taskBody,
          phase: task.phase || 'Refinement',
          skills: task.skills || [],
          priority: task.priority || 'medium',
          dependencies: task.dependencies,
          estimatedHours: task.estimatedHours,
        };
      });

      // Create the epic using the orchestrator
      const epicPlan = {
        title: input.epicTitle,
        description: epicBody,
        objectives: input.specification?.requirements || [],
        constraints: [
          ...(input.specification?.constraints?.technical || []),
          ...(input.specification?.constraints?.business || []),
        ],
        tasks: tasksWithContext,
        metadata: {
          ctoFlow: true,
          hasAdrs: (input.architecture?.adrs?.length || 0) > 0,
          componentCount: input.architecture?.components?.length || 0,
          userStoryCount: input.specification?.userStories?.length || 0,
        },
      };

      const createdEpic = await orchestrator.createEpic(epicPlan);

      logger.info('CTO Flow: Teammate epic created successfully', {
        epicId: createdEpic.epicId,
        projectUrl: createdEpic.projectUrl,
        taskCount: createdEpic.tasks.length,
      });

      // Store in context
      if (context) {
        (context as any).hiveMindOrchestrator = orchestrator;
        (context as any).activeEpicId = createdEpic.epicId;
      }

      return {
        success: true,
        epicId: createdEpic.epicId,
        projectUrl: createdEpic.projectUrl,
        projectNumber: createdEpic.projectNumber,
        epicIssueNumber: createdEpic.epicIssueNumber,
        epicIssueUrl: createdEpic.epicIssueUrl,
        tasks: createdEpic.tasks.map(t => ({
          taskId: t.taskId,
          issueNumber: t.issueNumber,
          issueUrl: t.issueUrl,
          title: t.title,
          phase: t.phase,
          status: t.status,
        })),
        summary: {
          totalTasks: createdEpic.tasks.length,
          adrsIncluded: input.architecture?.adrs?.length || 0,
          componentsDocumented: input.architecture?.components?.length || 0,
          userStoriesMapped: input.specification?.userStories?.length || 0,
        },
        message: `Teammate-style epic created with ${createdEpic.tasks.length} fully-contextualized tasks. Each issue contains architectural context, acceptance criteria, and implementation guidance. Agents can work autonomously with this context.`,
        ctoGuidance: [
          'Review the epic and tasks in GitHub Project',
          'Issues contain full context - agents can work independently',
          'Assign tasks to agents when ready for implementation',
          'Agents will reference ADRs and architecture automatically',
          'Use ctoflow/watch_assignments to monitor when work begins',
          'Trust the agents - they have everything they need',
        ],
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/**
 * Generate comprehensive epic body with all architectural context
 */
function generateTeammateEpicBody(input: any): string {
  const sections: string[] = [];

  // Header
  sections.push(`# ${input.epicTitle}\n`);
  sections.push(input.epicDescription + '\n');

  // Overview section
  sections.push('## 📋 Overview\n');
  sections.push('This epic was generated through the SPARC methodology with full architectural planning.\n');

  // Requirements
  if (input.specification?.requirements?.length > 0) {
    sections.push('## ✅ Requirements\n');
    input.specification.requirements.forEach((req: string, i: number) => {
      sections.push(`${i + 1}. ${req}`);
    });
    sections.push('');
  }

  // User Stories
  if (input.specification?.userStories?.length > 0) {
    sections.push('## 📖 User Stories\n');
    input.specification.userStories.forEach((story: any) => {
      sections.push(`### ${story.title}`);
      sections.push(`*Priority: ${story.priority}*\n`);
      sections.push(story.description + '\n');
      if (story.acceptanceCriteria?.length > 0) {
        sections.push('**Acceptance Criteria:**');
        story.acceptanceCriteria.forEach((ac: string) => {
          sections.push(`- [ ] ${ac}`);
        });
        sections.push('');
      }
    });
  }

  // Architecture Overview
  if (input.architecture?.systemDesign) {
    sections.push('## 🏗️ Architecture\n');
    sections.push(input.architecture.systemDesign + '\n');
  }

  // Components
  if (input.architecture?.components?.length > 0) {
    sections.push('### Components\n');
    sections.push('| Component | Responsibility | Dependencies |');
    sections.push('|-----------|----------------|--------------|');
    input.architecture.components.forEach((comp: any) => {
      const deps = comp.dependencies?.join(', ') || 'None';
      sections.push(`| ${comp.name} | ${comp.responsibility} | ${deps} |`);
    });
    sections.push('');
  }

  // Design Patterns
  if (input.architecture?.patterns?.length > 0) {
    sections.push('### Design Patterns\n');
    input.architecture.patterns.forEach((pattern: string) => {
      sections.push(`- ${pattern}`);
    });
    sections.push('');
  }

  // ADRs
  if (input.architecture?.adrs?.length > 0) {
    sections.push('## 📝 Architectural Decision Records\n');
    input.architecture.adrs.forEach((adr: any) => {
      sections.push(`### ADR-${adr.id}: ${adr.title}\n`);
      sections.push(`**Context:** ${adr.context}\n`);
      sections.push(`**Decision:** ${adr.decision}\n`);
      if (adr.consequences?.length > 0) {
        sections.push('**Consequences:**');
        adr.consequences.forEach((c: string) => sections.push(`- ${c}`));
        sections.push('');
      }
    });
  }

  // Constraints
  if (input.specification?.constraints) {
    sections.push('## ⚠️ Constraints\n');
    if (input.specification.constraints.technical?.length > 0) {
      sections.push('**Technical:**');
      input.specification.constraints.technical.forEach((c: string) => {
        sections.push(`- ${c}`);
      });
      sections.push('');
    }
    if (input.specification.constraints.business?.length > 0) {
      sections.push('**Business:**');
      input.specification.constraints.business.forEach((c: string) => {
        sections.push(`- ${c}`);
      });
      sections.push('');
    }
  }

  // Risks
  if (input.specification?.risks?.length > 0) {
    sections.push('## 🚨 Risks\n');
    input.specification.risks.forEach((risk: any) => {
      sections.push(`- **${risk.severity.toUpperCase()}**: ${risk.description}`);
      sections.push(`  - *Mitigation:* ${risk.mitigation}`);
    });
    sections.push('');
  }

  // Task Overview
  if (input.implementation?.tasks?.length > 0) {
    sections.push('## 📦 Implementation Tasks\n');
    sections.push(`This epic contains ${input.implementation.tasks.length} tasks across SPARC phases.\n`);

    // Group by phase
    const phases = ['Specification', 'Pseudocode', 'Architecture', 'Refinement', 'Completion'];
    phases.forEach(phase => {
      const phaseTasks = input.implementation.tasks.filter((t: any) => t.phase === phase);
      if (phaseTasks.length > 0) {
        sections.push(`**${phase}:** ${phaseTasks.length} tasks`);
      }
    });
    sections.push('');
  }

  // Footer
  sections.push('---');
  sections.push('*Generated by CTO Flow - Teammate-style epic management*');
  sections.push('*Agents can work autonomously with this context*');

  return sections.join('\n');
}

/**
 * Generate comprehensive task body with implementation context
 */
function generateTeammateTaskBody(task: any, epicInput: any): string {
  const sections: string[] = [];

  // Description
  sections.push(task.description + '\n');

  // Component context
  if (task.component) {
    const component = epicInput.architecture?.components?.find((c: any) => c.name === task.component);
    if (component) {
      sections.push('## 🏗️ Component Context\n');
      sections.push(`**Component:** ${component.name}`);
      sections.push(`**Responsibility:** ${component.responsibility}`);
      if (component.interfaces?.length > 0) {
        sections.push(`**Interfaces:** ${component.interfaces.join(', ')}`);
      }
      sections.push('');
    }
  }

  // Implementation Notes
  if (task.implementationNotes) {
    sections.push('## 💡 Implementation Guidance\n');
    sections.push(task.implementationNotes + '\n');
  }

  // Files to modify
  if (task.files?.length > 0) {
    sections.push('## 📁 Files\n');
    task.files.forEach((file: string) => {
      sections.push(`- \`${file}\``);
    });
    sections.push('');
  }

  // Acceptance Criteria
  if (task.acceptanceCriteria?.length > 0) {
    sections.push('## ✅ Acceptance Criteria\n');
    task.acceptanceCriteria.forEach((ac: string) => {
      sections.push(`- [ ] ${ac}`);
    });
    sections.push('');
  }

  // Test Strategy
  if (task.testStrategy) {
    sections.push('## 🧪 Test Strategy\n');
    sections.push(task.testStrategy + '\n');
  }

  // Related ADRs
  if (task.relatedAdrs?.length > 0 && epicInput.architecture?.adrs?.length > 0) {
    sections.push('## 📝 Related Architectural Decisions\n');
    task.relatedAdrs.forEach((adrId: string) => {
      const adr = epicInput.architecture.adrs.find((a: any) => a.id === adrId);
      if (adr) {
        sections.push(`### ADR-${adr.id}: ${adr.title}`);
        sections.push(`**Decision:** ${adr.decision}\n`);
      }
    });
  }

  // Design Patterns to use
  if (epicInput.architecture?.patterns?.length > 0) {
    sections.push('## 🎨 Design Patterns\n');
    sections.push('Follow these patterns established for this project:');
    epicInput.architecture.patterns.slice(0, 5).forEach((pattern: string) => {
      sections.push(`- ${pattern}`);
    });
    sections.push('');
  }

  // Dependencies
  if (task.dependencies?.length > 0) {
    sections.push('## 🔗 Dependencies\n');
    sections.push('This task depends on:');
    task.dependencies.forEach((dep: string) => {
      sections.push(`- ${dep}`);
    });
    sections.push('');
  }

  // Technical constraints relevant to this task
  if (epicInput.specification?.constraints?.technical?.length > 0) {
    sections.push('## ⚠️ Technical Constraints\n');
    epicInput.specification.constraints.technical.slice(0, 5).forEach((c: string) => {
      sections.push(`- ${c}`);
    });
    sections.push('');
  }

  // Footer
  sections.push('---');
  sections.push(`*Phase: ${task.phase} | Priority: ${task.priority || 'medium'} | Est: ${task.estimatedHours || '?'}h*`);

  return sections.join('\n');
}

// CTO Workflow field name - custom field with Backlog/Ready/In Progress/Review/Done
const CTO_WORKFLOW_FIELD_NAME = 'CTO Workflow';

/**
 * Helper: Get Project Workflow Field and Options
 *
 * Retrieves the CTO Workflow field (or falls back to Status) ID and option IDs.
 * Prefers "CTO Workflow" custom field which has Backlog/Ready/In Progress/Review/Done.
 */
async function getProjectStatusField(
  graphql: any,
  owner: string,
  projectNumber: number
): Promise<{
  projectId: string;
  fieldId: string;
  fieldName: string;
  options: { id: string; name: string }[];
} | null> {
  const query = `
    query($owner: String!, $number: Int!) {
      user(login: $owner) {
        projectV2(number: $number) {
          id
          fields(first: 20) {
            nodes {
              ... on ProjectV2SingleSelectField {
                id
                name
                options {
                  id
                  name
                }
              }
            }
          }
        }
      }
    }
  `;

  const findWorkflowField = (fields: any[]) => {
    // Prefer CTO Workflow field
    const ctoWorkflow = fields.find(
      (f: any) => f.name === CTO_WORKFLOW_FIELD_NAME && f.options
    );
    if (ctoWorkflow) return ctoWorkflow;

    // Fall back to Status field
    return fields.find((f: any) => f.name === 'Status' && f.options);
  };

  try {
    const result: any = await graphql(query, { owner, number: projectNumber });
    const project = result.user?.projectV2;
    if (!project) return null;

    const workflowField = findWorkflowField(project.fields.nodes);
    if (!workflowField) return null;

    return {
      projectId: project.id,
      fieldId: workflowField.id,
      fieldName: workflowField.name,
      options: workflowField.options,
    };
  } catch {
    // Try organization
    const orgQuery = query.replace('user(login: $owner)', 'organization(login: $owner)');
    try {
      const result: any = await graphql(orgQuery, { owner, number: projectNumber });
      const project = result.organization?.projectV2;
      if (!project) return null;

      const workflowField = findWorkflowField(project.fields.nodes);
      if (!workflowField) return null;

      return {
        projectId: project.id,
        fieldId: workflowField.id,
        fieldName: workflowField.name,
        options: workflowField.options,
      };
    } catch {
      return null;
    }
  }
}

/**
 * Helper: Get Project Item ID for an Issue
 */
async function getProjectItemId(
  graphql: any,
  projectId: string,
  issueNumber: number,
  owner: string,
  repo: string
): Promise<{ itemId: string; currentStatus: string | null } | null> {
  const query = `
    query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          items(first: 100) {
            nodes {
              id
              fieldValues(first: 10) {
                nodes {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    field { ... on ProjectV2SingleSelectField { name } }
                    name
                  }
                }
              }
              content {
                ... on Issue {
                  number
                  repository {
                    name
                    owner { login }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const result: any = await graphql(query, { projectId });
  const items = result.node?.items?.nodes || [];

  for (const item of items) {
    const issue = item.content;
    if (
      issue?.number === issueNumber &&
      issue?.repository?.name === repo &&
      issue?.repository?.owner?.login === owner
    ) {
      // Get current status from CTO Workflow field (or Status as fallback)
      const statusValue = item.fieldValues?.nodes?.find(
        (fv: any) => fv.field?.name === CTO_WORKFLOW_FIELD_NAME || fv.field?.name === 'Status'
      );
      return {
        itemId: item.id,
        currentStatus: statusValue?.name || null,
      };
    }
  }

  return null;
}

/**
 * Helper: Update Project Item Status
 */
async function updateProjectItemStatus(
  graphql: any,
  projectId: string,
  itemId: string,
  fieldId: string,
  optionId: string
): Promise<void> {
  const mutation = `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId,
        itemId: $itemId,
        fieldId: $fieldId,
        value: { singleSelectOptionId: $optionId }
      }) {
        projectV2Item { id }
      }
    }
  `;

  await graphql(mutation, { projectId, itemId, fieldId, optionId });
}

/**
 * CTO Flow: Release Task for Work
 *
 * Tasks are auto-assigned to the best agent during epic creation,
 * but they start in 'Backlog' or 'Todo' status. The CTO must explicitly
 * move tasks to 'Ready' status before agents can start working.
 *
 * Uses GitHub Projects v2 Status field for workflow control.
 */
function createCTOFlowReleaseTaskTool(logger: ILogger): MCPTool {
  return {
    name: 'ctoflow/release_task',
    description: `Release tasks for agent work by moving them to 'Ready' status in GitHub Project.

Tasks are auto-assigned to the best agent during epic creation but start
in 'Backlog' or 'Todo'. Use this tool to move tasks to 'Ready' when you're
ready for agents to begin work.

Changes the GitHub Project Status field to 'Ready'.
Agents can only pick up tasks that are in 'Ready' status.

This gives you control over when work starts while keeping optimal agent assignment.`,
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub owner (user or organization)',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name',
        },
        projectNumber: {
          type: 'number',
          description: 'GitHub Project number',
        },
        issueNumbers: {
          type: 'array',
          items: { type: 'number' },
          description: 'Issue numbers to release (can release multiple at once)',
        },
        targetStatus: {
          type: 'string',
          description: 'Status to move tasks to (default: Ready)',
          default: 'Ready',
        },
        notes: {
          type: 'string',
          description: 'Optional notes to add as a comment when releasing',
        },
      },
      required: ['owner', 'repo', 'projectNumber', 'issueNumbers'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('CTO Flow: Releasing tasks for work', {
        repo: `${input.owner}/${input.repo}`,
        projectNumber: input.projectNumber,
        issueCount: input.issueNumbers.length,
        sessionId: context?.sessionId,
      });

      const token = process.env.GITHUB_TOKEN;
      if (!token) {
        return {
          success: false,
          error: 'GITHUB_TOKEN not set',
          message: 'Set GITHUB_TOKEN environment variable to use CTO Flow',
        };
      }

      const { Octokit } = await import('@octokit/rest');
      const { graphql } = await import('@octokit/graphql');
      const octokit = new Octokit({ auth: token });
      const graphqlWithAuth = graphql.defaults({ headers: { authorization: `token ${token}` } });

      const results: any[] = [];
      const targetStatus = input.targetStatus || 'Ready';

      try {
        // Get project status field info
        const statusField = await getProjectStatusField(
          graphqlWithAuth,
          input.owner,
          input.projectNumber
        );

        if (!statusField) {
          return {
            success: false,
            error: 'Could not find project or Status field',
            message: `Make sure project #${input.projectNumber} exists and has a Status field`,
          };
        }

        // Find the target status option
        const targetOption = statusField.options.find(
          (opt) => opt.name.toLowerCase() === targetStatus.toLowerCase()
        );

        if (!targetOption) {
          return {
            success: false,
            error: `Status option '${targetStatus}' not found`,
            availableOptions: statusField.options.map((o) => o.name),
            message: `Available status options: ${statusField.options.map((o) => o.name).join(', ')}`,
          };
        }

        // Process each issue
        for (const issueNumber of input.issueNumbers) {
          try {
            // Get issue details
            const issue = await octokit.issues.get({
              owner: input.owner,
              repo: input.repo,
              issue_number: issueNumber,
            });

            const labels = issue.data.labels.map((l: any) =>
              typeof l === 'string' ? l : l.name
            );
            const assignedAgent = labels.find((l: string) => l.startsWith('agent:'))?.replace('agent:', '') || 'unknown';

            // Get project item ID
            const itemInfo = await getProjectItemId(
              graphqlWithAuth,
              statusField.projectId,
              issueNumber,
              input.owner,
              input.repo
            );

            if (!itemInfo) {
              results.push({
                issueNumber,
                status: 'failed',
                error: 'Issue not found in project',
              });
              continue;
            }

            // Update project status
            await updateProjectItemStatus(
              graphqlWithAuth,
              statusField.projectId,
              itemInfo.itemId,
              statusField.fieldId,
              targetOption.id
            );

            // Add release comment if notes provided
            if (input.notes) {
              await octokit.issues.createComment({
                owner: input.owner,
                repo: input.repo,
                issue_number: issueNumber,
                body: `## 🚦 Task Released\n\n**Status**: ${targetStatus} (ready for \`${assignedAgent}\` agent)\n**Released**: ${new Date().toISOString()}\n\n${input.notes}\n\n---\n*Released via CTO Flow*`,
              });
            }

            results.push({
              issueNumber,
              issueUrl: issue.data.html_url,
              title: issue.data.title,
              assignedAgent,
              previousStatus: itemInfo.currentStatus,
              newStatus: targetStatus,
              status: 'released',
            });
          } catch (e: any) {
            results.push({
              issueNumber,
              status: 'failed',
              error: e.message,
            });
          }
        }

        const released = results.filter((r) => r.status === 'released');
        const failed = results.filter((r) => r.status === 'failed');

        return {
          success: failed.length === 0,
          released,
          failed,
          summary: {
            total: input.issueNumbers.length,
            releasedCount: released.length,
            failedCount: failed.length,
          },
          message: `Released ${released.length} task(s) to '${targetStatus}' status.${failed.length > 0 ? ` ${failed.length} failed.` : ''}`,
          nextSteps: [
            'Agents can now pick up released tasks using ctoflow/my_assignments',
            'Tasks will appear in the Ready column of your GitHub Project',
            'Monitor progress by watching the Project board',
          ],
        };
      } catch (error: any) {
        logger.error('CTO Flow: Failed to release tasks', { error: error.message });
        return {
          success: false,
          error: error.message,
          results,
        };
      }
    },
  };
}

/**
 * CTO Flow: Assign Agent to Task (Label-Based)
 *
 * Since agents aren't GitHub users, we use labels for assignment:
 * - `assigned:coder` - Assigned to coder agent
 * - `assigned:architect` - Assigned to architect agent
 * - `assigned:tester` - Assigned to tester agent
 * etc.
 *
 * The CTO reviews tasks and assigns them by adding the appropriate label.
 */
function createCTOFlowAssignAgentTool(logger: ILogger): MCPTool {
  return {
    name: 'ctoflow/assign_agent',
    description: `Manually assign or reassign an agent to a task.

Note: Tasks are auto-assigned to the best agent during epic creation.
Use this only if you want to override the automatic assignment.

Changes:
- Adds \`agent:{agent-type}\` label to the issue
- Removes any existing agent assignment
- Task remains in current status (pending-approval or ready)

Agent types: coder, architect, tester, reviewer, researcher, devops, security`,
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub owner (user or organization)',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name',
        },
        issueNumber: {
          type: 'number',
          description: 'Issue number to assign',
        },
        agentType: {
          type: 'string',
          description: 'Agent type to assign (coder, architect, tester, reviewer, researcher, devops, security)',
          enum: ['coder', 'architect', 'tester', 'reviewer', 'researcher', 'devops', 'security'],
        },
        notes: {
          type: 'string',
          description: 'Optional assignment notes to add as a comment',
        },
      },
      required: ['owner', 'repo', 'issueNumber', 'agentType'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('CTO Flow: Assigning agent to task', {
        repo: `${input.owner}/${input.repo}`,
        issueNumber: input.issueNumber,
        agentType: input.agentType,
        sessionId: context?.sessionId,
      });

      const token = process.env.GITHUB_TOKEN;
      if (!token) {
        return {
          success: false,
          error: 'GITHUB_TOKEN not set',
          message: 'Set GITHUB_TOKEN environment variable to use CTO Flow',
        };
      }

      const { Octokit } = await import('@octokit/rest');
      const octokit = new Octokit({ auth: token });

      try {
        // Ensure assignment labels exist
        const assignmentLabels = [
          { name: `assigned:${input.agentType}`, color: '28a745', description: `Assigned to ${input.agentType} agent` },
          { name: 'status:ready', color: '0366d6', description: 'Task is ready for agent pickup' },
          { name: 'status:unassigned', color: 'e4e669', description: 'Task awaiting assignment' },
        ];

        for (const label of assignmentLabels) {
          try {
            await octokit.issues.createLabel({
              owner: input.owner,
              repo: input.repo,
              name: label.name,
              color: label.color,
              description: label.description,
            });
          } catch (e: any) {
            // Label already exists, that's fine
            if (e.status !== 422) throw e;
          }
        }

        // Get current issue labels
        const issue = await octokit.issues.get({
          owner: input.owner,
          repo: input.repo,
          issue_number: input.issueNumber,
        });

        const currentLabels = issue.data.labels.map((l: any) =>
          typeof l === 'string' ? l : l.name
        );

        // Remove any existing assignment labels and status:unassigned
        const labelsToRemove = currentLabels.filter((l: string) =>
          l.startsWith('assigned:') || l === 'status:unassigned'
        );

        // Build new label set
        const newLabels = currentLabels
          .filter((l: string) => !labelsToRemove.includes(l))
          .concat([`assigned:${input.agentType}`, 'status:ready']);

        // Update labels
        await octokit.issues.setLabels({
          owner: input.owner,
          repo: input.repo,
          issue_number: input.issueNumber,
          labels: newLabels,
        });

        // Add assignment comment if notes provided
        if (input.notes) {
          await octokit.issues.createComment({
            owner: input.owner,
            repo: input.repo,
            issue_number: input.issueNumber,
            body: `## 🎯 Assignment Notes\n\n**Assigned to**: \`${input.agentType}\` agent\n\n${input.notes}\n\n---\n*Assignment made via CTO Flow*`,
          });
        }

        return {
          success: true,
          issueNumber: input.issueNumber,
          issueUrl: issue.data.html_url,
          assignedTo: input.agentType,
          labels: newLabels,
          message: `Task #${input.issueNumber} assigned to ${input.agentType} agent. Agent can now pick up this task using ctoflow/my_assignments.`,
        };
      } catch (error: any) {
        logger.error('CTO Flow: Failed to assign agent', { error: error.message });
        return {
          success: false,
          error: error.message,
          message: 'Failed to assign agent to task',
        };
      }
    },
  };
}

/**
 * CTO Flow: Get My Assignments (Agent's View)
 *
 * Agent calls this to see what tasks have been assigned to them.
 * Tasks are auto-assigned via `agent:{type}` label during epic creation.
 * Uses GitHub Project Status field to determine if tasks are ready for work.
 */
function createCTOFlowMyAssignmentsTool(logger: ILogger): MCPTool {
  return {
    name: 'ctoflow/my_assignments',
    description: `Get tasks assigned to a specific agent type that are ready for work.

Tasks are auto-assigned to the best agent during epic creation (agent:{type} label).
Uses GitHub Project board Status to determine availability:
- 'Ready' status = available for agent to claim
- 'In Progress' status = already being worked on
- Other statuses = not yet released by CTO

Example: coder agent calls this → returns issues with \`agent:coder\` in 'Ready' status`,
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub owner (user or organization)',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name',
        },
        projectNumber: {
          type: 'number',
          description: 'GitHub Project number',
        },
        agentType: {
          type: 'string',
          description: 'Agent type to check assignments for',
          enum: ['coder', 'architect', 'tester', 'reviewer', 'researcher', 'devops', 'security'],
        },
        readyStatus: {
          type: 'string',
          description: 'Project status that indicates task is ready (default: Ready)',
          default: 'Ready',
        },
        includeInProgress: {
          type: 'boolean',
          description: 'Also include tasks already in progress',
          default: false,
        },
      },
      required: ['owner', 'repo', 'projectNumber', 'agentType'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('CTO Flow: Getting assignments for agent', {
        repo: `${input.owner}/${input.repo}`,
        projectNumber: input.projectNumber,
        agentType: input.agentType,
        sessionId: context?.sessionId,
      });

      const token = process.env.GITHUB_TOKEN;
      if (!token) {
        return {
          success: false,
          error: 'GITHUB_TOKEN not set',
        };
      }

      const { Octokit } = await import('@octokit/rest');
      const { graphql } = await import('@octokit/graphql');
      const octokit = new Octokit({ auth: token });
      const graphqlWithAuth = graphql.defaults({ headers: { authorization: `token ${token}` } });

      const readyStatus = input.readyStatus || 'Ready';
      const agentLabel = `agent:${input.agentType}`;

      try {
        // Get project status field info
        const statusField = await getProjectStatusField(
          graphqlWithAuth,
          input.owner,
          input.projectNumber
        );

        if (!statusField) {
          return {
            success: false,
            error: 'Could not find project or Status field',
          };
        }

        // Query all project items with their status
        const query = `
          query($projectId: ID!) {
            node(id: $projectId) {
              ... on ProjectV2 {
                items(first: 100) {
                  nodes {
                    id
                    fieldValues(first: 10) {
                      nodes {
                        ... on ProjectV2ItemFieldSingleSelectValue {
                          field { ... on ProjectV2SingleSelectField { name } }
                          name
                        }
                      }
                    }
                    content {
                      ... on Issue {
                        number
                        title
                        url
                        state
                        createdAt
                        labels(first: 20) {
                          nodes { name }
                        }
                        repository {
                          name
                          owner { login }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `;

        const result: any = await graphqlWithAuth(query, { projectId: statusField.projectId });
        const items = result.node?.items?.nodes || [];

        const readyTasks: any[] = [];
        const inProgressTasks: any[] = [];
        const pendingTasks: any[] = [];

        for (const item of items) {
          const issue = item.content;
          if (!issue || issue.state !== 'OPEN') continue;
          if (issue.repository?.name !== input.repo) continue;
          if (issue.repository?.owner?.login !== input.owner) continue;

          const labels = issue.labels?.nodes?.map((l: any) => l.name) || [];

          // Check if assigned to this agent type
          if (!labels.includes(agentLabel)) continue;

          // Get status from CTO Workflow field (or Status as fallback)
          const statusValue = item.fieldValues?.nodes?.find(
            (fv: any) => fv.field?.name === CTO_WORKFLOW_FIELD_NAME || fv.field?.name === 'Status'
          );
          const projectStatus = statusValue?.name || 'No Status';

          const taskInfo = {
            issueNumber: issue.number,
            issueUrl: issue.url,
            title: issue.title,
            projectStatus,
            labels,
            createdAt: issue.createdAt,
            phase: labels.find((l: string) => l.startsWith('sparc:'))?.replace('sparc:', '') || 'unknown',
            priority: labels.find((l: string) => l.startsWith('priority:'))?.replace('priority:', '') || 'medium',
          };

          // Categorize by project status
          if (projectStatus.toLowerCase() === readyStatus.toLowerCase()) {
            readyTasks.push(taskInfo);
          } else if (projectStatus.toLowerCase() === 'in progress') {
            inProgressTasks.push(taskInfo);
          } else {
            pendingTasks.push(taskInfo);
          }
        }

        return {
          success: true,
          agentType: input.agentType,
          projectNumber: input.projectNumber,
          readyCount: readyTasks.length,
          inProgressCount: inProgressTasks.length,
          pendingCount: pendingTasks.length,
          readyTasks,
          inProgressTasks: input.includeInProgress ? inProgressTasks : [],
          pendingTasks,
          message: readyTasks.length > 0
            ? `You have ${readyTasks.length} task(s) in '${readyStatus}' status. Use ctoflow/claim_task to start.`
            : pendingTasks.length > 0
              ? `${pendingTasks.length} task(s) assigned but not yet in '${readyStatus}' status. Wait for CTO to move them.`
              : 'No tasks currently assigned to you.',
          nextSteps: readyTasks.length > 0
            ? [
                `Claim task #${readyTasks[0].issueNumber} using ctoflow/claim_task`,
                'Read the full issue for context and acceptance criteria',
                'Implement the solution following the architectural guidelines',
                'Create a PR and mark task complete',
              ]
            : [`Wait for CTO to move tasks to '${readyStatus}' status in the Project board`],
        };
      } catch (error: any) {
        logger.error('CTO Flow: Failed to get assignments', { error: error.message });
        return {
          success: false,
          error: error.message,
        };
      }
    },
  };
}

/**
 * CTO Flow: Claim Task (Start Working)
 *
 * Agent claims an assigned task, changing Project board status to 'In Progress'.
 * Uses GitHub Projects v2 Status field for workflow control.
 */
function createCTOFlowClaimTaskTool(logger: ILogger): MCPTool {
  return {
    name: 'ctoflow/claim_task',
    description: `Claim an assigned task and start working on it.

Changes the GitHub Project Status to 'In Progress' and adds a comment.
Task must be in 'Ready' status (released by CTO) before it can be claimed.

Use this when you're ready to start working on an assigned task.`,
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub owner (user or organization)',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name',
        },
        projectNumber: {
          type: 'number',
          description: 'GitHub Project number',
        },
        issueNumber: {
          type: 'number',
          description: 'Issue number to claim',
        },
        agentType: {
          type: 'string',
          description: 'Agent type claiming the task',
          enum: ['coder', 'architect', 'tester', 'reviewer', 'researcher', 'devops', 'security'],
        },
        approach: {
          type: 'string',
          description: 'Brief description of planned implementation approach',
        },
        readyStatus: {
          type: 'string',
          description: 'Status that indicates task is ready (default: Ready)',
          default: 'Ready',
        },
        inProgressStatus: {
          type: 'string',
          description: 'Status to set when claiming (default: In Progress)',
          default: 'In Progress',
        },
      },
      required: ['owner', 'repo', 'projectNumber', 'issueNumber', 'agentType'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('CTO Flow: Claiming task', {
        repo: `${input.owner}/${input.repo}`,
        projectNumber: input.projectNumber,
        issueNumber: input.issueNumber,
        agentType: input.agentType,
        sessionId: context?.sessionId,
      });

      const token = process.env.GITHUB_TOKEN;
      if (!token) {
        return {
          success: false,
          error: 'GITHUB_TOKEN not set',
        };
      }

      const { Octokit } = await import('@octokit/rest');
      const { graphql } = await import('@octokit/graphql');
      const octokit = new Octokit({ auth: token });
      const graphqlWithAuth = graphql.defaults({ headers: { authorization: `token ${token}` } });

      const readyStatus = input.readyStatus || 'Ready';
      const inProgressStatus = input.inProgressStatus || 'In Progress';

      try {
        // Get project status field info
        const statusField = await getProjectStatusField(
          graphqlWithAuth,
          input.owner,
          input.projectNumber
        );

        if (!statusField) {
          return {
            success: false,
            error: 'Could not find project or Status field',
          };
        }

        // Find the In Progress status option
        const inProgressOption = statusField.options.find(
          (opt) => opt.name.toLowerCase() === inProgressStatus.toLowerCase()
        );

        if (!inProgressOption) {
          return {
            success: false,
            error: `Status option '${inProgressStatus}' not found`,
            availableOptions: statusField.options.map((o) => o.name),
          };
        }

        // Get issue details
        const issue = await octokit.issues.get({
          owner: input.owner,
          repo: input.repo,
          issue_number: input.issueNumber,
        });

        const labels = issue.data.labels.map((l: any) =>
          typeof l === 'string' ? l : l.name
        );

        // Verify task is assigned to this agent
        if (!labels.includes(`agent:${input.agentType}`)) {
          return {
            success: false,
            error: `Task is not assigned to ${input.agentType} agent`,
            currentAssignment: labels.find((l: string) => l.startsWith('agent:'))?.replace('agent:', '') || 'unassigned',
          };
        }

        // Get project item and current status
        const itemInfo = await getProjectItemId(
          graphqlWithAuth,
          statusField.projectId,
          input.issueNumber,
          input.owner,
          input.repo
        );

        if (!itemInfo) {
          return {
            success: false,
            error: 'Issue not found in project',
          };
        }

        // Verify task is in Ready status
        if (itemInfo.currentStatus?.toLowerCase() !== readyStatus.toLowerCase()) {
          return {
            success: false,
            error: `Task is not in '${readyStatus}' status. Current status: '${itemInfo.currentStatus}'`,
            message: `Wait for CTO to move task to '${readyStatus}' in the Project board`,
          };
        }

        // Update project status to In Progress
        await updateProjectItemStatus(
          graphqlWithAuth,
          statusField.projectId,
          itemInfo.itemId,
          statusField.fieldId,
          inProgressOption.id
        );

        // Add work started comment
        const approachSection = input.approach
          ? `\n\n**Planned Approach:**\n${input.approach}`
          : '';

        await octokit.issues.createComment({
          owner: input.owner,
          repo: input.repo,
          issue_number: input.issueNumber,
          body: `## 🚀 Work Started\n\n**Agent**: \`${input.agentType}\`\n**Started**: ${new Date().toISOString()}${approachSection}\n\n---\n*Task claimed via CTO Flow*`,
        });

        return {
          success: true,
          issueNumber: input.issueNumber,
          issueUrl: issue.data.html_url,
          claimedBy: input.agentType,
          previousStatus: itemInfo.currentStatus,
          newStatus: inProgressStatus,
          message: `Task #${input.issueNumber} claimed. You are now working on: "${issue.data.title}"`,
          nextSteps: [
            'Read the full issue body for context and acceptance criteria',
            'Follow the architectural guidelines in the issue',
            'Implement the solution',
            'Create a PR when ready',
            'Use ctoflow/complete_task when done',
          ],
        };
      } catch (error: any) {
        logger.error('CTO Flow: Failed to claim task', { error: error.message });
        return {
          success: false,
          error: error.message,
        };
      }
    },
  };
}

/**
 * CTO Flow: Complete Task
 *
 * Agent marks a task as complete after finishing work.
 * Uses GitHub Projects v2 Status field for workflow control.
 */
function createCTOFlowCompleteTaskTool(logger: ILogger): MCPTool {
  return {
    name: 'ctoflow/complete_task',
    description: `Mark a task as complete after finishing work.

Changes the GitHub Project Status to 'Done' and adds a completion comment.
Optionally links a PR and closes the issue.

Use this when you've finished implementing and are ready for review.`,
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'GitHub owner (user or organization)',
        },
        repo: {
          type: 'string',
          description: 'GitHub repository name',
        },
        projectNumber: {
          type: 'number',
          description: 'GitHub Project number',
        },
        issueNumber: {
          type: 'number',
          description: 'Issue number to complete',
        },
        agentType: {
          type: 'string',
          description: 'Agent type completing the task',
          enum: ['coder', 'architect', 'tester', 'reviewer', 'researcher', 'devops', 'security'],
        },
        prNumber: {
          type: 'number',
          description: 'PR number if implementation created a PR',
        },
        summary: {
          type: 'string',
          description: 'Brief summary of what was implemented',
        },
        closeIssue: {
          type: 'boolean',
          description: 'Whether to close the issue',
          default: false,
        },
        doneStatus: {
          type: 'string',
          description: 'Status to set when complete (default: Done)',
          default: 'Done',
        },
      },
      required: ['owner', 'repo', 'projectNumber', 'issueNumber', 'agentType'],
    },
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      logger.info('CTO Flow: Completing task', {
        repo: `${input.owner}/${input.repo}`,
        projectNumber: input.projectNumber,
        issueNumber: input.issueNumber,
        agentType: input.agentType,
        sessionId: context?.sessionId,
      });

      const token = process.env.GITHUB_TOKEN;
      if (!token) {
        return {
          success: false,
          error: 'GITHUB_TOKEN not set',
        };
      }

      const { Octokit } = await import('@octokit/rest');
      const { graphql } = await import('@octokit/graphql');
      const octokit = new Octokit({ auth: token });
      const graphqlWithAuth = graphql.defaults({ headers: { authorization: `token ${token}` } });

      const doneStatus = input.doneStatus || 'Done';

      try {
        // Get project status field info
        const statusField = await getProjectStatusField(
          graphqlWithAuth,
          input.owner,
          input.projectNumber
        );

        if (!statusField) {
          return {
            success: false,
            error: 'Could not find project or Status field',
          };
        }

        // Find the Done status option
        const doneOption = statusField.options.find(
          (opt) => opt.name.toLowerCase() === doneStatus.toLowerCase()
        );

        if (!doneOption) {
          return {
            success: false,
            error: `Status option '${doneStatus}' not found`,
            availableOptions: statusField.options.map((o) => o.name),
          };
        }

        // Get issue details
        const issue = await octokit.issues.get({
          owner: input.owner,
          repo: input.repo,
          issue_number: input.issueNumber,
        });

        // Get project item and current status
        const itemInfo = await getProjectItemId(
          graphqlWithAuth,
          statusField.projectId,
          input.issueNumber,
          input.owner,
          input.repo
        );

        if (!itemInfo) {
          return {
            success: false,
            error: 'Issue not found in project',
          };
        }

        // Update project status to Done
        await updateProjectItemStatus(
          graphqlWithAuth,
          statusField.projectId,
          itemInfo.itemId,
          statusField.fieldId,
          doneOption.id
        );

        // Add completion comment
        const prSection = input.prNumber
          ? `\n**Pull Request**: #${input.prNumber}`
          : '';
        const summarySection = input.summary
          ? `\n\n**Summary:**\n${input.summary}`
          : '';

        await octokit.issues.createComment({
          owner: input.owner,
          repo: input.repo,
          issue_number: input.issueNumber,
          body: `## ✅ Task Complete\n\n**Agent**: \`${input.agentType}\`\n**Completed**: ${new Date().toISOString()}${prSection}${summarySection}\n\n---\n*Task completed via CTO Flow*`,
        });

        // Close issue if requested
        if (input.closeIssue) {
          await octokit.issues.update({
            owner: input.owner,
            repo: input.repo,
            issue_number: input.issueNumber,
            state: 'closed',
            state_reason: 'completed',
          });
        }

        return {
          success: true,
          issueNumber: input.issueNumber,
          issueUrl: issue.data.html_url,
          completedBy: input.agentType,
          previousStatus: itemInfo.currentStatus,
          newStatus: doneStatus,
          issueClosed: input.closeIssue || false,
          prLinked: input.prNumber || null,
          message: `Task #${input.issueNumber} marked '${doneStatus}'${input.closeIssue ? ' and closed' : ''}.`,
        };
      } catch (error: any) {
        logger.error('CTO Flow: Failed to complete task', { error: error.message });
        return {
          success: false,
          error: error.message,
        };
      }
    },
  };
}
