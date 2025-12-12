/**
 * GitHub Integration Module Index
 *
 * Exports all GitHub integration components for cto-flow-agents:
 * - EpicSyncService: Bidirectional sync between memory and GitHub issues
 * - GitHubProjectManager: GitHub Projects v2 management
 * - CtoFlowProjectBridge: Connects epics to projects for full lifecycle
 * - SparcEpicExporter: SPARC specification to GitHub epic export
 *
 * @module github
 */

// Epic Sync Service
export {
  EpicSyncService,
  type SparcSpecification,
  type UserStory,
  type Risk,
  type SparcPhase,
  type EpicIssue,
  type ChildIssue,
  type Milestone,
  type EpicExportResult,
  type SyncState,
  type GitHubConfig,
  type EpicSyncConfig,
  type GitHubWebhookEvent,
  type ConflictResolution,
  type IMemoryManager,
} from './epic-sync-service.js';

// GitHub Project Manager
export {
  GitHubProjectManager,
  createUserProjectManager,
  createOrgProjectManager,
  DEFAULT_STATUS_OPTIONS,
  DEFAULT_STATUS_MAPPING,
  STATUS_COLORS,
  type GitHubProject,
  type ProjectField,
  type ProjectFieldOption,
  type ProjectItem,
  type ProjectConfig,
  type CreateProjectOptions,
  type AddItemOptions,
  type ProjectSyncState,
} from './project-manager.js';

// Teammate-Project Bridge
export {
  CtoFlowProjectBridge,
  createCtoFlowProjectBridge,
  DEFAULT_PROJECT_CONFIG,
  type CtoFlowProjectConfig,
  type EpicProjectMapping,
  type AgentIssueAssignment,
  type IssueForSelection,
} from './cto-flow-project-bridge.js';

// SPARC Epic Exporter (if exists)
export * from './sparc-epic-exporter.js';
