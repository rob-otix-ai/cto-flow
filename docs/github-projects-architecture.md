# GitHub Projects Integration Architecture
## Teammate-Agents Module Extension

**Version:** 1.0.0
**Date:** 2025-12-10
**Status:** Design Specification
**Author:** System Architecture Designer

---

## Executive Summary

This document specifies the architecture for integrating GitHub Projects with the teammate-agents module in claude-flow. The integration enables bidirectional synchronization between Epic-driven agent management and GitHub's native project tracking capabilities, providing seamless coordination between internal state machines and external project workflows.

### Key Objectives

1. **Bidirectional Sync**: Automatic synchronization between EpicState and GitHub Projects columns
2. **Epic-to-Project Mapping**: Seamless transformation of Epics to GitHub Projects
3. **Task-to-Issue Mapping**: Automatic conversion of Tasks to GitHub Issues with project linkage
4. **State Consistency**: Maintain consistency between EpicState transitions and project board movements
5. **Graceful Degradation**: Continue operations when GitHub API is unavailable
6. **Configuration Flexibility**: Support multiple sync strategies and project layouts

---

## 1. System Architecture Overview

### 1.1 Component Hierarchy

```
src/teammate-agents/
├── github/
│   ├── epic-sync-service.ts           (existing - enhanced)
│   ├── sparc-epic-exporter.ts         (existing - enhanced)
│   ├── github-project-manager.ts      (NEW)
│   ├── github-issue-manager.ts        (NEW)
│   ├── state-column-mapper.ts         (NEW)
│   ├── sync-coordinator.ts            (NEW)
│   └── types/
│       ├── github-projects.types.ts   (NEW)
│       └── sync-config.types.ts       (NEW)
├── core/
│   ├── epic-state-machine.ts          (existing - hooks added)
│   └── types.ts                       (existing - extended)
├── memory/
│   └── epic-memory-manager.ts         (existing - sync state extended)
└── hooks/
    └── epic-hooks.ts                  (existing - GitHub hooks added)
```

### 1.2 Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Teammate Agents System                       │
│                                                                   │
│  ┌─────────────┐      ┌──────────────┐      ┌───────────────┐  │
│  │ Epic State  │─────▶│ Sync         │─────▶│ Memory        │  │
│  │ Machine     │      │ Coordinator  │      │ Manager       │  │
│  └─────────────┘      └──────────────┘      └───────────────┘  │
│         │                     │                      │           │
│         │                     │                      │           │
│         ▼                     ▼                      ▼           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │           GitHub Integration Layer                       │   │
│  │  ┌──────────────┐         ┌─────────────────┐          │   │
│  │  │  Project     │◀───────▶│  Issue          │          │   │
│  │  │  Manager     │         │  Manager        │          │   │
│  │  └──────────────┘         └─────────────────┘          │   │
│  │         │                           │                    │   │
│  │         │                           │                    │   │
│  │         ▼                           ▼                    │   │
│  │  ┌────────────────────────────────────────────────┐    │   │
│  │  │     State-Column Mapper                         │    │   │
│  │  └────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                        GitHub API Layer                          │
│                                                                   │
│  ┌──────────────┐    ┌──────────────┐    ┌─────────────────┐  │
│  │  Projects v2 │    │  Issues API  │    │  GraphQL API    │  │
│  │  API         │    │              │    │                 │  │
│  └──────────────┘    └──────────────┘    └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 1.3 Integration Points

| Component | Integration Point | Purpose |
|-----------|------------------|---------|
| EpicStateMachine | `registerAfterHook()` | Trigger GitHub sync on state transitions |
| EpicMemoryManager | `storeSyncState()` | Persist sync state and conflict resolution |
| EpicSyncService | Enhanced | Coordinate epic-to-project creation |
| GitHub Hooks | `post-task`, `post-edit` | Capture changes for bidirectional sync |

---

## 2. New File Specifications

### 2.1 GitHubProjectManager Class

**File:** `src/teammate-agents/github/github-project-manager.ts`

**Purpose:** Manages GitHub Projects v2 (ProjectsNext) operations including project creation, column management, and item manipulation.

**Class Interface:**

```typescript
export class GitHubProjectManager {
  // Constructor
  constructor(config: GitHubProjectConfig);

  // Project Lifecycle
  async createProject(epic: EpicContext): Promise<GitHubProject>;
  async updateProject(projectId: string, updates: ProjectUpdates): Promise<GitHubProject>;
  async deleteProject(projectId: string): Promise<void>;
  async getProject(projectId: string): Promise<GitHubProject | null>;
  async listProjects(filter?: ProjectFilter): Promise<GitHubProject[]>;

  // Column Management
  async createColumns(projectId: string, columns: ColumnDefinition[]): Promise<ProjectColumn[]>;
  async updateColumn(projectId: string, columnId: string, updates: ColumnUpdates): Promise<ProjectColumn>;
  async deleteColumn(projectId: string, columnId: string): Promise<void>;
  async listColumns(projectId: string): Promise<ProjectColumn[]>;
  async getColumnByState(projectId: string, state: EpicState): Promise<ProjectColumn | null>;

  // Item Operations
  async addItemToProject(projectId: string, issueId: string, columnId?: string): Promise<ProjectItem>;
  async moveItem(projectId: string, itemId: string, targetColumnId: string): Promise<ProjectItem>;
  async removeItemFromProject(projectId: string, itemId: string): Promise<void>;
  async getProjectItems(projectId: string, filter?: ItemFilter): Promise<ProjectItem[]>;
  async getItemColumn(projectId: string, itemId: string): Promise<ProjectColumn | null>;

  // Synchronization
  async syncProjectState(epicId: string, targetState: EpicState): Promise<SyncResult>;
  async getProjectSyncStatus(projectId: string): Promise<ProjectSyncStatus>;

  // Field Management (GitHub Projects v2 custom fields)
  async createCustomField(projectId: string, field: CustomFieldDefinition): Promise<CustomField>;
  async updateItemField(projectId: string, itemId: string, fieldId: string, value: any): Promise<void>;
  async getItemFields(projectId: string, itemId: string): Promise<Map<string, any>>;

  // Utilities
  async validateProjectAccess(projectId: string): Promise<boolean>;
  async getProjectUrl(projectId: string): Promise<string>;
  exportProjectConfiguration(projectId: string): Promise<ProjectConfiguration>;
}
```

**Key Responsibilities:**
- GitHub Projects v2 GraphQL API integration
- Project and column CRUD operations
- Item-to-column associations
- Custom field management for metadata
- Rate limiting and retry logic
- Error handling and fallback mechanisms

**Technical Considerations:**
- Uses GraphQL API for Projects v2 (not REST)
- Implements exponential backoff for rate limits
- Caches column mappings for performance
- Validates permissions before operations
- Supports both organization and user projects

---

### 2.2 GitHubIssueManager Class

**File:** `src/teammate-agents/github/github-issue-manager.ts`

**Purpose:** Manages GitHub Issues operations with enhanced project integration, including issue creation, updates, labels, and project associations.

**Class Interface:**

```typescript
export class GitHubIssueManager {
  // Constructor
  constructor(config: GitHubIssueConfig);

  // Issue Lifecycle
  async createIssue(task: Task, epicContext: EpicContext): Promise<GitHubIssue>;
  async updateIssue(issueNumber: number, updates: IssueUpdates): Promise<GitHubIssue>;
  async closeIssue(issueNumber: number, reason?: string): Promise<GitHubIssue>;
  async reopenIssue(issueNumber: number): Promise<GitHubIssue>;
  async deleteIssue(issueNumber: number): Promise<void>;
  async getIssue(issueNumber: number): Promise<GitHubIssue | null>;

  // Bulk Operations
  async createIssuesFromTasks(tasks: Task[], epicContext: EpicContext): Promise<IssueCreationResult[]>;
  async updateIssuesBulk(updates: Map<number, IssueUpdates>): Promise<BulkUpdateResult>;
  async syncTaskStatuses(tasks: Task[]): Promise<StatusSyncResult>;

  // Project Integration
  async addIssueToProject(issueId: string, projectId: string, columnId?: string): Promise<void>;
  async moveIssueInProject(issueId: string, projectId: string, targetColumnId: string): Promise<void>;
  async removeIssueFromProject(issueId: string, projectId: string): Promise<void>;
  async getIssueProjects(issueId: string): Promise<GitHubProject[]>;

  // Label Management
  async addLabels(issueNumber: number, labels: string[]): Promise<void>;
  async removeLabels(issueNumber: number, labels: string[]): Promise<void>;
  async syncLabelsFromTask(issueNumber: number, task: Task): Promise<void>;
  async ensureLabelsExist(labels: string[]): Promise<void>;

  // State Synchronization
  async syncIssueFromTask(issueNumber: number, task: Task): Promise<SyncResult>;
  async syncTaskFromIssue(task: Task, issueNumber: number): Promise<SyncResult>;
  async detectIssueChanges(issueNumber: number, task: Task): Promise<ChangeDetection>;

  // Assignment Management
  async assignIssue(issueNumber: number, assignees: string[]): Promise<void>;
  async unassignIssue(issueNumber: number, assignees: string[]): Promise<void>;
  async syncAssignmentsFromTask(issueNumber: number, task: Task): Promise<void>;

  // Comments and Communication
  async addComment(issueNumber: number, comment: string): Promise<Comment>;
  async updateComment(commentId: number, comment: string): Promise<Comment>;
  async addProgressComment(issueNumber: number, progress: number, notes?: string): Promise<Comment>;
  async addStateTransitionComment(issueNumber: number, fromState: TaskStatus, toState: TaskStatus): Promise<Comment>;

  // Metadata and Linking
  async linkIssueToEpic(issueNumber: number, epicNumber: number): Promise<void>;
  async getLinkedIssues(epicNumber: number): Promise<GitHubIssue[]>;
  async updateIssueMetadata(issueNumber: number, metadata: IssueMetadata): Promise<void>;
  async getIssueMetadata(issueNumber: number): Promise<IssueMetadata | null>;

  // Webhooks and Events
  async handleIssueEvent(event: GitHubWebhookEvent): Promise<void>;
  async processIssueStateChange(issueNumber: number, newState: string): Promise<void>;

  // Utilities
  async validateIssueAccess(issueNumber: number): Promise<boolean>;
  async getIssueUrl(issueNumber: number): Promise<string>;
  async searchIssues(query: IssueQuery): Promise<GitHubIssue[]>;
}
```

**Key Responsibilities:**
- GitHub Issues REST API integration
- Issue CRUD with task mapping
- Label and assignment management
- Project association management
- Comment automation for progress tracking
- Bidirectional state synchronization
- Webhook event processing

**Technical Considerations:**
- Uses REST API for issues (simpler than GraphQL)
- Batches operations for performance
- Implements comment-based metadata storage
- Handles label creation automatically
- Supports rate limit aware operations

---

### 2.3 StateColumnMapper

**File:** `src/teammate-agents/github/state-column-mapper.ts`

**Purpose:** Provides bidirectional mapping between EpicState/TaskStatus and GitHub Projects columns with customizable strategies.

**Class Interface:**

```typescript
export class StateColumnMapper {
  // Constructor
  constructor(config: StateColumnMapperConfig);

  // Mapping Configuration
  async loadMappingStrategy(strategy: MappingStrategy): Promise<void>;
  async saveMappingStrategy(strategy: MappingStrategy): Promise<void>;
  async getDefaultStrategy(): MappingStrategy;
  async validateStrategy(strategy: MappingStrategy): ValidationResult;

  // State to Column Mapping
  getColumnForState(state: EpicState): ColumnDefinition;
  getColumnForTaskStatus(status: TaskStatus): ColumnDefinition;
  getStateForColumn(columnId: string): EpicState | null;
  getTaskStatusForColumn(columnId: string): TaskStatus | null;

  // Mapping Operations
  async createColumnsForEpic(projectId: string): Promise<Map<EpicState, ProjectColumn>>;
  async ensureColumnExists(projectId: string, state: EpicState): Promise<ProjectColumn>;
  async updateColumnMappings(projectId: string, mappings: ColumnMapping[]): Promise<void>;

  // Transition Rules
  getValidColumnTransitions(currentColumnId: string): string[];
  validateColumnTransition(fromColumnId: string, toColumnId: string): boolean;
  suggestColumnForTransition(currentColumn: string, targetState: EpicState): string | null;

  // Multi-Strategy Support
  switchStrategy(strategyName: string): void;
  listAvailableStrategies(): StrategyInfo[];
  compareStrategies(strategy1: string, strategy2: string): StrategyComparison;
}
```

**Mapping Strategies:**

1. **Default Strategy (SPARC-aligned)**
```typescript
{
  name: "sparc-default",
  columns: [
    { state: "UNINITIALIZED", name: "Backlog", position: 0 },
    { state: "ACTIVE", name: "In Progress", position: 1 },
    { state: "PAUSED", name: "On Hold", position: 2 },
    { state: "BLOCKED", name: "Blocked", position: 3 },
    { state: "REVIEW", name: "In Review", position: 4 },
    { state: "COMPLETED", name: "Done", position: 5 },
    { state: "ARCHIVED", name: "Archived", position: 6 }
  ]
}
```

2. **Agile Strategy**
```typescript
{
  name: "agile",
  columns: [
    { state: "UNINITIALIZED", name: "Product Backlog", position: 0 },
    { state: "ACTIVE", name: "Sprint Backlog", position: 1 },
    { state: "ACTIVE", name: "In Progress", position: 2 },
    { state: "REVIEW", name: "Code Review", position: 3 },
    { state: "REVIEW", name: "QA Testing", position: 4 },
    { state: "COMPLETED", name: "Done", position: 5 }
  ]
}
```

3. **Kanban Strategy**
```typescript
{
  name: "kanban",
  columns: [
    { state: "UNINITIALIZED", name: "To Do", position: 0 },
    { state: "ACTIVE", name: "Doing", position: 1 },
    { state: "COMPLETED", name: "Done", position: 2 }
  ]
}
```

---

### 2.4 SyncCoordinator

**File:** `src/teammate-agents/github/sync-coordinator.ts`

**Purpose:** Orchestrates bidirectional synchronization between internal state and GitHub, handling conflicts, retries, and batch operations.

**Class Interface:**

```typescript
export class SyncCoordinator {
  // Constructor
  constructor(
    projectManager: GitHubProjectManager,
    issueManager: GitHubIssueManager,
    stateMapper: StateColumnMapper,
    memoryManager: EpicMemoryManager
  );

  // Synchronization Modes
  async enableSync(epicId: string, mode: SyncMode): Promise<void>;
  async disableSync(epicId: string): Promise<void>;
  async pauseSync(epicId: string): Promise<void>;
  async resumeSync(epicId: string): Promise<void>;
  getSyncStatus(epicId: string): SyncStatus;

  // Push Operations (Internal → GitHub)
  async pushEpicState(epicId: string): Promise<PushResult>;
  async pushTaskUpdates(epicId: string, taskIds: string[]): Promise<PushResult>;
  async pushStateTransition(epicId: string, fromState: EpicState, toState: EpicState): Promise<PushResult>;

  // Pull Operations (GitHub → Internal)
  async pullProjectState(projectId: string): Promise<PullResult>;
  async pullIssueUpdates(issueNumbers: number[]): Promise<PullResult>;
  async detectGitHubChanges(epicId: string): Promise<ChangeSet>;

  // Bidirectional Sync
  async syncEpic(epicId: string, direction?: SyncDirection): Promise<SyncResult>;
  async syncAll(filter?: EpicFilter): Promise<BatchSyncResult>;
  async scheduleSyncJob(epicId: string, schedule: SyncSchedule): Promise<string>;

  // Conflict Resolution
  async detectConflicts(epicId: string): Promise<Conflict[]>;
  async resolveConflict(conflictId: string, resolution: ConflictResolution): Promise<void>;
  async autoResolveConflicts(epicId: string, strategy: ResolutionStrategy): Promise<ConflictResolution[]>;

  // Batch Operations
  async batchPush(epicIds: string[]): Promise<BatchResult>;
  async batchPull(projectIds: string[]): Promise<BatchResult>;
  async syncQueue(operations: QueuedOperation[]): Promise<QueueResult>;

  // Event Handling
  async handleEpicEvent(event: EpicEvent): Promise<void>;
  async handleGitHubWebhook(webhook: GitHubWebhookEvent): Promise<void>;
  registerEventHandler(eventType: string, handler: EventHandler): void;

  // Monitoring and Diagnostics
  async getSyncMetrics(epicId: string): Promise<SyncMetrics>;
  async getSyncHistory(epicId: string, limit?: number): Promise<SyncHistoryEntry[]>;
  async validateSyncIntegrity(epicId: string): Promise<IntegrityReport>;
  async repairSyncState(epicId: string): Promise<RepairResult>;
}
```

**Key Responsibilities:**
- Orchestrate all sync operations
- Manage sync state and scheduling
- Conflict detection and resolution
- Event-driven synchronization
- Batch operation optimization
- Integrity validation and repair

---

### 2.5 Type Definitions

**File:** `src/teammate-agents/github/types/github-projects.types.ts`

```typescript
/**
 * GitHub Projects v2 type definitions
 */

export interface GitHubProject {
  id: string;
  number: number;
  title: string;
  url: string;
  shortDescription?: string;
  readme?: string;
  public: boolean;
  closed: boolean;
  closedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  creator: {
    login: string;
    id: string;
  };
  owner: {
    login: string;
    id: string;
    type: 'Organization' | 'User';
  };
}

export interface ProjectColumn {
  id: string;
  name: string;
  position: number;
  purpose?: string;
  createdAt: Date;
}

export interface ProjectItem {
  id: string;
  content: {
    type: 'Issue' | 'PullRequest' | 'DraftIssue';
    id: string;
    number?: number;
    title: string;
    url?: string;
  };
  columnId: string;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomField {
  id: string;
  name: string;
  dataType: 'text' | 'number' | 'date' | 'single_select' | 'iteration';
  options?: string[];
}

export interface ProjectConfiguration {
  projectId: string;
  epicId: string;
  columns: ColumnMapping[];
  customFields: CustomField[];
  syncSettings: SyncSettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface ColumnMapping {
  columnId: string;
  columnName: string;
  epicState?: EpicState;
  taskStatus?: TaskStatus;
  position: number;
}

export interface GitHubIssue {
  id: string;
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  stateReason?: 'completed' | 'not_planned' | 'reopened';
  url: string;
  labels: Label[];
  assignees: User[];
  milestone?: Milestone;
  createdAt: Date;
  updatedAt: Date;
  closedAt?: Date;
  author: User;
  projectItems?: ProjectItem[];
}

export interface Label {
  id: string;
  name: string;
  color: string;
  description?: string;
}

export interface User {
  id: string;
  login: string;
  avatarUrl?: string;
}

export interface Milestone {
  id: string;
  number: number;
  title: string;
  description?: string;
  state: 'open' | 'closed';
  dueOn?: Date;
  closedAt?: Date;
}

export interface Comment {
  id: string;
  body: string;
  author: User;
  createdAt: Date;
  updatedAt: Date;
}
```

**File:** `src/teammate-agents/github/types/sync-config.types.ts`

```typescript
/**
 * Synchronization configuration types
 */

export interface SyncSettings {
  enabled: boolean;
  mode: SyncMode;
  direction: SyncDirection;
  conflictResolution: ConflictResolutionStrategy;
  retryPolicy: RetryPolicy;
  batchSize: number;
  throttleMs: number;
}

export enum SyncMode {
  MANUAL = 'manual',
  AUTOMATIC = 'automatic',
  SCHEDULED = 'scheduled',
  EVENT_DRIVEN = 'event_driven'
}

export enum SyncDirection {
  PUSH = 'push',           // Internal → GitHub
  PULL = 'pull',           // GitHub → Internal
  BIDIRECTIONAL = 'bidirectional'
}

export enum ConflictResolutionStrategy {
  GITHUB_WINS = 'github_wins',
  INTERNAL_WINS = 'internal_wins',
  NEWEST_WINS = 'newest_wins',
  MANUAL = 'manual',
  MERGE = 'merge'
}

export interface RetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors: string[];
}

export interface SyncResult {
  success: boolean;
  epicId: string;
  projectId?: string;
  operations: SyncOperation[];
  conflicts: Conflict[];
  errors: SyncError[];
  metrics: {
    itemsPushed: number;
    itemsPulled: number;
    conflictsDetected: number;
    conflictsResolved: number;
    durationMs: number;
  };
}

export interface SyncOperation {
  id: string;
  type: 'create' | 'update' | 'delete' | 'move';
  target: 'project' | 'issue' | 'column' | 'item';
  targetId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  timestamp: Date;
  error?: string;
}

export interface Conflict {
  id: string;
  type: ConflictType;
  field: string;
  internalValue: any;
  githubValue: any;
  timestamp: Date;
  resolved: boolean;
  resolution?: ConflictResolution;
}

export enum ConflictType {
  STATE_MISMATCH = 'state_mismatch',
  DATA_DIVERGENCE = 'data_divergence',
  CONCURRENT_MODIFICATION = 'concurrent_modification',
  MISSING_ENTITY = 'missing_entity'
}

export interface ConflictResolution {
  conflictId: string;
  strategy: ConflictResolutionStrategy;
  resolvedValue: any;
  resolvedAt: Date;
  resolvedBy: string;
  notes?: string;
}

export interface SyncError {
  code: string;
  message: string;
  operation: SyncOperation;
  timestamp: Date;
  retryable: boolean;
  retryCount: number;
}

export interface SyncSchedule {
  type: 'interval' | 'cron';
  value: string | number;
  startAt?: Date;
  endAt?: Date;
  timezone?: string;
}

export interface SyncStatus {
  epicId: string;
  enabled: boolean;
  mode: SyncMode;
  lastSyncAt?: Date;
  nextSyncAt?: Date;
  status: 'idle' | 'syncing' | 'paused' | 'error';
  pendingOperations: number;
  unresolvedConflicts: number;
  health: 'healthy' | 'degraded' | 'unhealthy';
}
```

---

## 3. Bidirectional Sync Mechanism Design

### 3.1 Sync Architecture

The bidirectional sync mechanism operates on a push-pull model with conflict detection and resolution:

```
┌────────────────────────────────────────────────────────────────┐
│                    Sync Coordinator                             │
│                                                                  │
│  ┌──────────────┐         ┌──────────────┐                     │
│  │ Push Engine  │         │ Pull Engine  │                     │
│  │              │         │              │                     │
│  │ • Detect     │         │ • Poll       │                     │
│  │   changes    │         │   GitHub     │                     │
│  │ • Transform  │         │ • Detect     │                     │
│  │ • Apply to   │         │   changes    │                     │
│  │   GitHub     │         │ • Transform  │                     │
│  │              │         │ • Apply      │                     │
│  └──────────────┘         │   internally │                     │
│         │                 └──────────────┘                     │
│         │                         │                             │
│         └────────┬────────────────┘                             │
│                  │                                              │
│                  ▼                                              │
│         ┌──────────────────┐                                   │
│         │ Conflict         │                                   │
│         │ Detector         │                                   │
│         └──────────────────┘                                   │
│                  │                                              │
│                  ▼                                              │
│         ┌──────────────────┐                                   │
│         │ Conflict         │                                   │
│         │ Resolver         │                                   │
│         └──────────────────┘                                   │
└────────────────────────────────────────────────────────────────┘
```

### 3.2 Push Flow (Internal → GitHub)

**Trigger:** EpicStateMachine state transition

```typescript
// 1. State Machine Hook
stateMachine.registerAfterHook(async (transition, context) => {
  if (context.githubSyncEnabled) {
    await syncCoordinator.pushStateTransition(
      context.epicId,
      transition.from,
      transition.to
    );
  }
});

// 2. Push Process
async pushStateTransition(
  epicId: string,
  fromState: EpicState,
  toState: EpicState
): Promise<PushResult> {
  // Load epic configuration
  const config = await this.memoryManager.loadEpicContext(epicId);
  const projectId = config.metadata.githubProjectId;

  // Get column mapping
  const targetColumn = this.stateMapper.getColumnForState(toState);

  // Get all project items for this epic
  const items = await this.projectManager.getProjectItems(projectId);

  // Move items to new column
  const moves = items.map(item =>
    this.projectManager.moveItem(projectId, item.id, targetColumn.id)
  );

  await Promise.all(moves);

  // Update sync state in memory
  await this.memoryManager.storeSyncState({
    epicId,
    lastSyncAt: new Date(),
    syncDirection: 'push',
    status: 'synced',
    conflicts: [],
    pendingChanges: 0
  });

  return { success: true, operations: moves.length };
}
```

### 3.3 Pull Flow (GitHub → Internal)

**Trigger:** Polling interval or webhook

```typescript
// 1. Webhook Handler
async handleGitHubWebhook(webhook: GitHubWebhookEvent): Promise<void> {
  if (webhook.action === 'projects_v2_item.moved') {
    await this.pullProjectState(webhook.project.id);
  }
}

// 2. Pull Process
async pullProjectState(projectId: string): Promise<PullResult> {
  // Find associated epic
  const epicId = await this.findEpicForProject(projectId);
  if (!epicId) return { success: false, error: 'Epic not found' };

  // Get current internal state
  const epicContext = await this.memoryManager.loadEpicContext(epicId);
  const currentState = epicContext.state;

  // Determine GitHub state
  const items = await this.projectManager.getProjectItems(projectId);
  const columnCounts = new Map<string, number>();

  for (const item of items) {
    const count = columnCounts.get(item.columnId) || 0;
    columnCounts.set(item.columnId, count + 1);
  }

  // Find majority column
  let maxCount = 0;
  let majorityColumnId = '';

  for (const [columnId, count] of columnCounts) {
    if (count > maxCount) {
      maxCount = count;
      majorityColumnId = columnId;
    }
  }

  // Map column to state
  const githubState = this.stateMapper.getStateForColumn(majorityColumnId);

  // Detect conflict
  if (githubState !== currentState) {
    await this.detectAndResolveConflict(epicId, currentState, githubState);
  }

  return { success: true, newState: githubState };
}
```

### 3.4 Conflict Detection and Resolution

```typescript
async detectAndResolveConflict(
  epicId: string,
  internalState: EpicState,
  githubState: EpicState
): Promise<ConflictResolution> {
  // Create conflict record
  const conflict: Conflict = {
    id: generateId(),
    type: ConflictType.STATE_MISMATCH,
    field: 'epicState',
    internalValue: internalState,
    githubValue: githubState,
    timestamp: new Date(),
    resolved: false
  };

  // Get resolution strategy
  const config = await this.getEpicSyncConfig(epicId);
  const strategy = config.conflictResolution;

  let resolvedValue: EpicState;

  switch (strategy) {
    case ConflictResolutionStrategy.GITHUB_WINS:
      resolvedValue = githubState;
      // Update internal state
      await this.stateMachine.transition(
        githubState,
        { reason: 'GitHub sync', triggeredBy: 'sync-coordinator' }
      );
      break;

    case ConflictResolutionStrategy.INTERNAL_WINS:
      resolvedValue = internalState;
      // Update GitHub
      await this.pushStateTransition(epicId, githubState, internalState);
      break;

    case ConflictResolutionStrategy.NEWEST_WINS:
      const syncState = await this.memoryManager.getSyncState(epicId);
      const lastSync = syncState?.lastSyncAt || new Date(0);

      const githubUpdated = await this.getProjectLastUpdated(projectId);
      const internalUpdated = epicContext.updatedAt;

      resolvedValue = githubUpdated > internalUpdated ? githubState : internalState;
      break;

    case ConflictResolutionStrategy.MANUAL:
      // Store conflict for manual resolution
      await this.memoryManager.storeSyncState({
        epicId,
        lastSyncAt: new Date(),
        syncDirection: 'bidirectional',
        status: 'conflict',
        conflicts: [conflict],
        pendingChanges: 1
      });

      // Emit event for human intervention
      this.emit('conflict:requires_manual_resolution', { epicId, conflict });
      return;
  }

  // Record resolution
  const resolution: ConflictResolution = {
    conflictId: conflict.id,
    strategy,
    resolvedValue,
    resolvedAt: new Date(),
    resolvedBy: 'sync-coordinator'
  };

  conflict.resolved = true;
  conflict.resolution = resolution;

  await this.memoryManager.resolveSyncConflict(epicId, conflict.id, strategy);

  return resolution;
}
```

---

## 4. Epic-to-Project Mapping

### 4.1 Creation Flow

When an Epic is created, the system automatically creates a corresponding GitHub Project:

```typescript
async createEpicWithProject(createParams: CreateEpicParams): Promise<EpicCreationResult> {
  // 1. Create Epic internally
  const epicContext = await this.epicStateMachine.createEpic(createParams);

  // 2. Create GitHub Project
  const project = await this.projectManager.createProject(epicContext);

  // 3. Create columns based on state mapper
  const columns = await this.stateMapper.createColumnsForEpic(project.id);

  // 4. Store project ID in epic metadata
  epicContext.metadata.githubProjectId = project.id;
  epicContext.metadata.githubProjectUrl = project.url;
  await this.memoryManager.storeEpicContext(epicContext);

  // 5. Enable sync
  await this.syncCoordinator.enableSync(epicContext.epicId, SyncMode.EVENT_DRIVEN);

  return {
    epic: epicContext,
    project: project,
    columns: columns,
    syncEnabled: true
  };
}
```

### 4.2 Metadata Mapping

| Epic Field | GitHub Project Field | Notes |
|-----------|---------------------|--------|
| `epicId` | Custom field: "Epic ID" | Stored as text field |
| `name` | `title` | Direct mapping |
| `description` | `readme` | Markdown formatted |
| `state` | Derived from item columns | Calculated from item distribution |
| `createdAt` | `createdAt` | Auto-managed by GitHub |
| `updatedAt` | `updatedAt` | Auto-managed by GitHub |
| `projectContext.goals` | Custom field: "Goals" | JSON serialized |
| `projectContext.milestones` | Linked milestones | Use GitHub milestones |
| `tags` | Not supported | Store in readme or custom field |

### 4.3 Project Configuration

```typescript
interface EpicProjectConfiguration {
  // Identity
  epicId: string;
  projectId: string;
  projectNumber: number;

  // Sync settings
  syncSettings: SyncSettings;

  // Column mappings
  columnMappings: Map<EpicState, string>; // columnId

  // Custom fields
  customFields: {
    epicIdField: string;
    priorityField: string;
    effortField: string;
    phaseField: string;
  };

  // Metadata
  createdAt: Date;
  lastSyncAt: Date;
  syncVersion: number;
}
```

---

## 5. Task-to-Issue Mapping

### 5.1 Creation Flow

When a Task is created, it's converted to a GitHub Issue and added to the project:

```typescript
async createTaskWithIssue(
  epicId: string,
  taskParams: CreateTaskParams
): Promise<TaskCreationResult> {
  // 1. Create Task internally
  const task = await this.workAssignmentManager.createTask(epicId, taskParams);

  // 2. Get epic context and project
  const epicContext = await this.memoryManager.loadEpicContext(epicId);
  const projectId = epicContext.metadata.githubProjectId;

  // 3. Create GitHub Issue
  const issue = await this.issueManager.createIssue(task, epicContext);

  // 4. Add issue to project
  const taskStatusColumn = this.stateMapper.getColumnForTaskStatus(task.status);
  await this.projectManager.addItemToProject(projectId, issue.id, taskStatusColumn.id);

  // 5. Store issue ID in task metadata
  task.metadata.githubIssueNumber = issue.number;
  task.metadata.githubIssueUrl = issue.url;
  await this.memoryManager.trackTaskProgress({
    taskId: task.id,
    epicId: epicId,
    title: task.title,
    status: task.status,
    progress: 0,
    dependencies: task.dependencies,
    checkpoints: [],
    metadata: task.metadata
  });

  return {
    task: task,
    issue: issue,
    projectItem: projectItem
  };
}
```

### 5.2 Field Mapping

| Task Field | GitHub Issue Field | Sync Direction | Notes |
|-----------|-------------------|----------------|--------|
| `id` | Comment metadata | Push only | Embedded in issue body |
| `title` | `title` | Bidirectional | Direct mapping |
| `description` | `body` | Bidirectional | Markdown formatted |
| `status` | Derived from project column | Bidirectional | Via StateColumnMapper |
| `priority` | `labels` | Bidirectional | `priority-{level}` labels |
| `assignedAgentId` | `assignees` | Bidirectional | GitHub username mapping |
| `dependencies` | `body` metadata + comments | Bidirectional | Task blocking links |
| `estimatedEffort` | Custom field or labels | Bidirectional | `effort-{size}` labels |
| `actualEffort` | Calculated from activity | Pull only | From issue timeline |
| `blockedReason` | `labels` + comments | Bidirectional | `blocked` label |
| `requiredCapabilities` | `labels` | Bidirectional | `skill:{capability}` labels |
| `metadata` | HTML comment in body | Bidirectional | JSON in comment block |

### 5.3 Issue Body Template

```markdown
<!-- TASK-METADATA
{
  "taskId": "task-123",
  "epicId": "epic-456",
  "priority": "HIGH",
  "estimatedEffort": 8,
  "requiredCapabilities": ["typescript", "testing"],
  "dependencies": ["task-100", "task-101"]
}
-->

# {Task Title}

## Description

{Task description}

## Acceptance Criteria

- [ ] {Criterion 1}
- [ ] {Criterion 2}
- [ ] {Criterion 3}

## Dependencies

This task depends on:
- #{issue-number-1} - {task title 1}
- #{issue-number-2} - {task title 2}

## Agent Assignment

**Required Capabilities:** `typescript`, `testing`
**Estimated Effort:** 8 hours
**Assigned Agent:** @agent-username

## Progress

<!-- Auto-updated by sync coordinator -->
**Status:** IN_PROGRESS
**Progress:** 45%
**Last Updated:** 2025-12-10T15:30:00Z

---

**Parent Epic:** #{epic-issue-number}
**Epic ID:** `epic-456`
```

---

## 6. State Synchronization

### 6.1 EpicState to Project Columns

The state synchronization maintains consistency between the internal Epic state machine and GitHub Project columns:

```typescript
// State mapping configuration
const STATE_COLUMN_MAPPING = {
  [EpicState.UNINITIALIZED]: {
    columnName: 'Backlog',
    description: 'Newly created epics awaiting activation',
    color: '#gray'
  },
  [EpicState.ACTIVE]: {
    columnName: 'In Progress',
    description: 'Currently active development',
    color: '#blue'
  },
  [EpicState.PAUSED]: {
    columnName: 'On Hold',
    description: 'Temporarily paused epics',
    color: '#yellow'
  },
  [EpicState.BLOCKED]: {
    columnName: 'Blocked',
    description: 'Blocked by dependencies or issues',
    color: '#red'
  },
  [EpicState.REVIEW]: {
    columnName: 'In Review',
    description: 'Ready for review and approval',
    color: '#purple'
  },
  [EpicState.COMPLETED]: {
    columnName: 'Done',
    description: 'Completed and approved',
    color: '#green'
  },
  [EpicState.ARCHIVED]: {
    columnName: 'Archived',
    description: 'Archived for historical reference',
    color: '#gray'
  }
};
```

### 6.2 State Transition Hooks

```typescript
// Register hooks in EpicStateMachine
class EpicStateMachine {
  constructor() {
    // Register GitHub sync hooks
    this.registerAfterHook(async (transition, context) => {
      if (context.githubProjectId) {
        await syncCoordinator.pushStateTransition(
          context.epicId,
          transition.from,
          transition.to
        );
      }
    });
  }

  // Enhanced transition with GitHub sync
  async transition(
    targetState: EpicState,
    metadata: TransitionMetadata,
    context: Record<string, unknown>
  ): Promise<StateTransition> {
    // Existing validation...

    // Before transition: check GitHub state if sync enabled
    if (context.githubSyncEnabled) {
      const githubState = await this.getGitHubProjectState(context.epicId);
      if (githubState && githubState !== this.currentState) {
        // Conflict detected, resolve before transition
        await this.resolveStateConflict(context.epicId, this.currentState, githubState);
      }
    }

    // Execute transition (existing code)
    const result = await super.transition(targetState, metadata, context);

    // After transition: update GitHub (via registered hooks)

    return result;
  }
}
```

### 6.3 Column-Based State Detection

When pulling state from GitHub, determine Epic state based on item distribution:

```typescript
async deriveEpicStateFromProject(projectId: string): Promise<EpicState> {
  // Get all items in project
  const items = await this.projectManager.getProjectItems(projectId);

  // Count items per column
  const columnDistribution = new Map<string, number>();
  for (const item of items) {
    const count = columnDistribution.get(item.columnId) || 0;
    columnDistribution.set(item.columnId, count + 1);
  }

  // Get column with most items
  let maxCount = 0;
  let primaryColumnId = '';

  for (const [columnId, count] of columnDistribution.entries()) {
    if (count > maxCount) {
      maxCount = count;
      primaryColumnId = columnId;
    }
  }

  // Map column to state
  const state = this.stateMapper.getStateForColumn(primaryColumnId);

  // Handle special cases
  if (!state) {
    // Unknown column, default to ACTIVE if any items exist
    return items.length > 0 ? EpicState.ACTIVE : EpicState.UNINITIALIZED;
  }

  // Check for blocking conditions
  const blockedColumn = await this.stateMapper.getColumnForState(EpicState.BLOCKED);
  if (columnDistribution.get(blockedColumn.id) > 0) {
    return EpicState.BLOCKED;
  }

  return state;
}
```

---

## 7. Error Handling and Graceful Degradation

### 7.1 Error Categories

```typescript
enum SyncErrorCategory {
  NETWORK = 'network',
  AUTHENTICATION = 'authentication',
  RATE_LIMIT = 'rate_limit',
  PERMISSION = 'permission',
  NOT_FOUND = 'not_found',
  VALIDATION = 'validation',
  CONFLICT = 'conflict',
  UNKNOWN = 'unknown'
}

interface ErrorHandlingStrategy {
  category: SyncErrorCategory;
  retryable: boolean;
  maxRetries: number;
  backoffStrategy: 'exponential' | 'linear' | 'fixed';
  fallbackAction: 'queue' | 'skip' | 'disable' | 'notify';
  gracefulDegradation: boolean;
}
```

### 7.2 Graceful Degradation Strategy

```typescript
class GracefulDegradationManager {
  async handleSyncFailure(error: Error, context: SyncContext): Promise<void> {
    const category = this.categorizeError(error);

    switch (category) {
      case SyncErrorCategory.NETWORK:
      case SyncErrorCategory.RATE_LIMIT:
        // Queue operation for retry
        await this.queueForRetry(context.operation);
        // Continue internal operations
        this.emit('degraded:queued', { operation: context.operation });
        break;

      case SyncErrorCategory.AUTHENTICATION:
        // Disable sync temporarily
        await this.syncCoordinator.pauseSync(context.epicId);
        // Notify administrators
        this.emit('degraded:auth_required', { epicId: context.epicId });
        break;

      case SyncErrorCategory.PERMISSION:
        // Skip this operation
        this.emit('degraded:skipped', { operation: context.operation, reason: 'permission' });
        break;

      case SyncErrorCategory.NOT_FOUND:
        // Recreate if necessary
        if (context.operation.type === 'update') {
          await this.recreateGitHubEntity(context);
        }
        break;

      case SyncErrorCategory.CONFLICT:
        // Store for manual resolution
        await this.storeConflictForResolution(context);
        break;

      default:
        // Log and continue
        this.logger.error('Sync error', { error, context });
    }
  }

  async queueForRetry(operation: SyncOperation): Promise<void> {
    const retryQueue = await this.memoryManager.retrieve('sync:retry:queue');
    retryQueue.push({
      ...operation,
      retryCount: (operation.retryCount || 0) + 1,
      nextRetryAt: this.calculateNextRetry(operation.retryCount || 0)
    });
    await this.memoryManager.store('sync:retry:queue', retryQueue);
  }

  async processRetryQueue(): Promise<void> {
    const retryQueue = await this.memoryManager.retrieve('sync:retry:queue') || [];
    const now = Date.now();

    for (const operation of retryQueue) {
      if (operation.nextRetryAt <= now) {
        try {
          await this.syncCoordinator.replayOperation(operation);
          // Remove from queue on success
          retryQueue.splice(retryQueue.indexOf(operation), 1);
        } catch (error) {
          // Update retry count and schedule
          operation.retryCount++;
          if (operation.retryCount >= MAX_RETRIES) {
            // Move to dead letter queue
            await this.moveToDeadLetterQueue(operation);
            retryQueue.splice(retryQueue.indexOf(operation), 1);
          } else {
            operation.nextRetryAt = this.calculateNextRetry(operation.retryCount);
          }
        }
      }
    }

    await this.memoryManager.store('sync:retry:queue', retryQueue);
  }
}
```

### 7.3 Circuit Breaker Pattern

```typescript
class SyncCircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly threshold = 5;
  private readonly timeout = 60000; // 1 minute

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open - GitHub sync temporarily disabled');
      }
    }

    try {
      const result = await operation();

      if (this.state === 'half-open') {
        this.state = 'closed';
        this.failureCount = 0;
      }

      return result;
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();

      if (this.failureCount >= this.threshold) {
        this.state = 'open';
        this.emit('circuit:opened', { reason: error });
      }

      throw error;
    }
  }

  getStatus(): CircuitBreakerStatus {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      resetAt: this.lastFailureTime + this.timeout
    };
  }
}
```

### 7.4 Fallback Operations

When GitHub is unavailable:

1. **Continue Internal Operations**: All Epic and Task operations continue normally
2. **Queue Sync Operations**: Store operations in memory for later sync
3. **Emit Events**: Notify that system is in degraded mode
4. **Periodic Health Checks**: Attempt to reconnect periodically
5. **Manual Sync**: Provide CLI command to manually trigger sync when available

```typescript
// Example: Task creation with GitHub unavailable
async createTask(epicId: string, params: CreateTaskParams): Promise<Task> {
  // Always create task internally
  const task = await this.createTaskInternal(epicId, params);

  try {
    // Attempt GitHub sync
    await this.issueManager.createIssue(task, epicContext);
  } catch (error) {
    // GitHub unavailable - queue for later
    await this.queueOperation({
      type: 'create_issue',
      taskId: task.id,
      epicId: epicId,
      params: params,
      retryCount: 0
    });

    // Emit event
    this.emit('degraded:queued_issue_creation', { taskId: task.id });
  }

  return task; // Task still created successfully
}
```

---

## 8. Configuration Options

### 8.1 Configuration Structure

```typescript
interface GitHubProjectsConfig {
  // Connection
  github: {
    token: string;
    apiUrl?: string;
    graphqlUrl?: string;
    owner: string;
    repo: string;
  };

  // Sync behavior
  sync: {
    enabled: boolean;
    mode: SyncMode;
    direction: SyncDirection;
    conflictResolution: ConflictResolutionStrategy;
    pollIntervalMs?: number;
    batchSize: number;
    throttleMs: number;
  };

  // Project settings
  projects: {
    autoCreate: boolean;
    defaultVisibility: 'public' | 'private';
    template?: string;
    columnStrategy: 'sparc-default' | 'agile' | 'kanban' | 'custom';
    customColumns?: ColumnDefinition[];
  };

  // Issue settings
  issues: {
    autoCreate: boolean;
    labelPrefix: string;
    defaultLabels: string[];
    includeMetadata: boolean;
    linkingStrategy: 'label' | 'project' | 'milestone';
  };

  // Error handling
  errorHandling: {
    retryPolicy: RetryPolicy;
    enableCircuitBreaker: boolean;
    circuitBreakerThreshold: number;
    circuitBreakerTimeout: number;
    gracefulDegradation: boolean;
    queueFailedOperations: boolean;
  };

  // Performance
  performance: {
    enableCaching: boolean;
    cacheTtlMs: number;
    enableCompression: boolean;
    maxConcurrentRequests: number;
  };

  // Webhooks
  webhooks: {
    enabled: boolean;
    secret?: string;
    events: string[];
    endpoint?: string;
  };
}
```

### 8.2 Configuration Profiles

**Profile: Development**
```typescript
{
  sync: {
    enabled: true,
    mode: SyncMode.MANUAL,
    direction: SyncDirection.PUSH,
    conflictResolution: ConflictResolutionStrategy.INTERNAL_WINS
  },
  errorHandling: {
    gracefulDegradation: true,
    queueFailedOperations: true
  }
}
```

**Profile: Production**
```typescript
{
  sync: {
    enabled: true,
    mode: SyncMode.EVENT_DRIVEN,
    direction: SyncDirection.BIDIRECTIONAL,
    conflictResolution: ConflictResolutionStrategy.NEWEST_WINS
  },
  webhooks: {
    enabled: true,
    events: ['projects_v2_item.*', 'issues.*']
  },
  errorHandling: {
    enableCircuitBreaker: true,
    gracefulDegradation: true
  }
}
```

**Profile: GitHub-Primary**
```typescript
{
  sync: {
    enabled: true,
    mode: SyncMode.AUTOMATIC,
    direction: SyncDirection.PULL,
    conflictResolution: ConflictResolutionStrategy.GITHUB_WINS,
    pollIntervalMs: 30000
  }
}
```

### 8.3 Configuration Loading

```typescript
class ConfigManager {
  async loadConfig(profile?: string): Promise<GitHubProjectsConfig> {
    // 1. Load defaults
    const config = { ...DEFAULT_CONFIG };

    // 2. Load from environment
    this.applyEnvironmentOverrides(config);

    // 3. Load from file
    const fileConfig = await this.loadConfigFile();
    if (fileConfig) {
      Object.assign(config, fileConfig);
    }

    // 4. Apply profile
    if (profile) {
      const profileConfig = await this.loadProfile(profile);
      Object.assign(config, profileConfig);
    }

    // 5. Validate
    this.validateConfig(config);

    return config;
  }

  private applyEnvironmentOverrides(config: GitHubProjectsConfig): void {
    if (process.env.GITHUB_TOKEN) {
      config.github.token = process.env.GITHUB_TOKEN;
    }
    if (process.env.GITHUB_SYNC_MODE) {
      config.sync.mode = process.env.GITHUB_SYNC_MODE as SyncMode;
    }
    // ... more overrides
  }
}
```

### 8.4 Runtime Configuration Updates

```typescript
// Update sync mode at runtime
await syncCoordinator.updateSyncMode(epicId, SyncMode.MANUAL);

// Change conflict resolution strategy
await syncCoordinator.updateConflictStrategy(
  epicId,
  ConflictResolutionStrategy.GITHUB_WINS
);

// Toggle sync on/off
await syncCoordinator.enableSync(epicId, SyncMode.EVENT_DRIVEN);
await syncCoordinator.disableSync(epicId);
```

---

## 9. Implementation Roadmap

### Phase 1: Foundation (Week 1-2)
- [ ] Create type definitions
- [ ] Implement GitHubProjectManager basic operations
- [ ] Implement GitHubIssueManager basic operations
- [ ] Implement StateColumnMapper with default strategy
- [ ] Add configuration management

### Phase 2: Synchronization (Week 3-4)
- [ ] Implement SyncCoordinator push operations
- [ ] Implement SyncCoordinator pull operations
- [ ] Add conflict detection
- [ ] Add basic conflict resolution
- [ ] Integrate with EpicStateMachine hooks

### Phase 3: Error Handling (Week 5)
- [ ] Implement retry logic
- [ ] Add circuit breaker pattern
- [ ] Implement graceful degradation
- [ ] Add operation queueing
- [ ] Implement health checks

### Phase 4: Advanced Features (Week 6)
- [ ] Add webhook support
- [ ] Implement custom field management
- [ ] Add batch operations
- [ ] Implement caching layer
- [ ] Add performance optimizations

### Phase 5: Testing & Documentation (Week 7-8)
- [ ] Unit tests for all components
- [ ] Integration tests
- [ ] End-to-end tests
- [ ] API documentation
- [ ] User guide
- [ ] Migration guide

### Phase 6: Polish & Release (Week 9)
- [ ] Performance tuning
- [ ] Security audit
- [ ] CLI enhancements
- [ ] Monitoring dashboards
- [ ] Release preparation

---

## 10. Testing Strategy

### 10.1 Unit Tests

```typescript
describe('GitHubProjectManager', () => {
  describe('createProject', () => {
    it('should create project with correct settings');
    it('should handle API errors gracefully');
    it('should respect rate limits');
  });

  describe('moveItem', () => {
    it('should move item to target column');
    it('should validate column exists');
    it('should handle concurrent moves');
  });
});

describe('StateColumnMapper', () => {
  describe('getColumnForState', () => {
    it('should map ACTIVE to In Progress column');
    it('should handle custom strategies');
    it('should validate state transitions');
  });
});

describe('SyncCoordinator', () => {
  describe('pushStateTransition', () => {
    it('should sync state change to GitHub');
    it('should handle conflicts');
    it('should queue on failure');
  });

  describe('pullProjectState', () => {
    it('should derive state from column distribution');
    it('should detect conflicts');
    it('should update internal state');
  });
});
```

### 10.2 Integration Tests

```typescript
describe('GitHub Projects Integration', () => {
  it('should create epic with project and columns');
  it('should create tasks as issues in project');
  it('should sync state transitions bidirectionally');
  it('should handle webhook events');
  it('should resolve conflicts automatically');
  it('should gracefully degrade when GitHub unavailable');
});
```

### 10.3 E2E Tests

```typescript
describe('Full Workflow', () => {
  it('should complete epic lifecycle with GitHub sync', async () => {
    // Create epic
    const epic = await createEpic({ name: 'Test Epic' });

    // Verify project created
    const project = await getGitHubProject(epic.metadata.githubProjectId);
    expect(project).toBeDefined();

    // Create tasks
    const tasks = await createTasks(epic.epicId, [task1, task2, task3]);

    // Verify issues created
    for (const task of tasks) {
      const issue = await getGitHubIssue(task.metadata.githubIssueNumber);
      expect(issue).toBeDefined();
    }

    // Transition epic state
    await epic.transition(EpicState.ACTIVE);

    // Verify GitHub updated
    const updatedProject = await getGitHubProject(project.id);
    expect(updatedProject.items[0].columnName).toBe('In Progress');

    // Manually move issue in GitHub
    await moveIssueOnGitHub(tasks[0].metadata.githubIssueNumber, 'Done');

    // Trigger sync
    await syncCoordinator.pullProjectState(project.id);

    // Verify task updated
    const updatedTask = await getTask(tasks[0].id);
    expect(updatedTask.status).toBe(TaskStatus.COMPLETED);
  });
});
```

---

## 11. Security Considerations

### 11.1 Authentication

- Store GitHub tokens securely (environment variables or secret manager)
- Validate token permissions before operations
- Implement token rotation support
- Use fine-grained personal access tokens with minimal permissions

**Required Permissions:**
- `repo` - Full repository access
- `project` - Projects v2 access
- `write:discussion` - Issue comments

### 11.2 Data Protection

- Sanitize user input before GitHub API calls
- Validate webhook signatures
- Encrypt sensitive metadata in memory
- Implement audit logging for all GitHub operations

### 11.3 Rate Limiting

- Respect GitHub API rate limits (5000/hour for authenticated)
- Implement exponential backoff
- Queue operations during rate limit periods
- Monitor rate limit usage

```typescript
class RateLimitManager {
  private remaining: number = 5000;
  private resetAt: number = Date.now() + 3600000;

  async checkRateLimit(): Promise<void> {
    if (this.remaining < 100) {
      const waitMs = this.resetAt - Date.now();
      if (waitMs > 0) {
        await this.sleep(waitMs);
      }
    }
  }

  updateFromResponse(headers: Headers): void {
    this.remaining = parseInt(headers.get('x-ratelimit-remaining') || '5000');
    this.resetAt = parseInt(headers.get('x-ratelimit-reset') || '0') * 1000;
  }
}
```

---

## 12. Monitoring and Observability

### 12.1 Metrics

```typescript
interface SyncMetrics {
  // Operation counts
  totalSyncs: number;
  successfulSyncs: number;
  failedSyncs: number;
  conflictsDetected: number;
  conflictsResolved: number;

  // Performance
  averageSyncDurationMs: number;
  p95SyncDurationMs: number;
  p99SyncDurationMs: number;

  // GitHub API
  apiCallsTotal: number;
  apiCallsSuccess: number;
  apiCallsFailure: number;
  rateLimitHits: number;

  // Queue
  queuedOperations: number;
  deadLetterQueue: number;

  // Circuit breaker
  circuitBreakerState: 'closed' | 'open' | 'half-open';
  circuitBreakerTrips: number;
}
```

### 12.2 Logging

```typescript
// Structured logging for all sync operations
logger.info('Sync initiated', {
  epicId,
  projectId,
  mode: 'push',
  itemCount: items.length
});

logger.error('Sync failed', {
  epicId,
  projectId,
  error: error.message,
  stack: error.stack,
  retryable: true
});

logger.warn('Conflict detected', {
  epicId,
  field: 'state',
  internalValue: 'ACTIVE',
  githubValue: 'PAUSED',
  strategy: 'newest_wins'
});
```

### 12.3 Health Checks

```typescript
async performHealthCheck(): Promise<HealthStatus> {
  const checks = await Promise.all([
    this.checkGitHubConnection(),
    this.checkProjectAccess(),
    this.checkSyncQueueHealth(),
    this.checkMemoryHealth()
  ]);

  return {
    healthy: checks.every(c => c.healthy),
    checks: checks,
    timestamp: new Date()
  };
}
```

---

## 13. Migration Path

### 13.1 Existing Installations

For claude-flow installations without GitHub Projects integration:

1. **Enable Feature Flag**: Add `GITHUB_PROJECTS_ENABLED=true` to environment
2. **Configure GitHub Access**: Set `GITHUB_TOKEN` and repository details
3. **Run Migration**: `npx claude-flow migrate github-projects`
4. **Verify Setup**: `npx claude-flow github-projects validate`

### 13.2 Migrating Existing Epics

```bash
# Migrate single epic
npx claude-flow github-projects migrate-epic <epic-id>

# Migrate all epics
npx claude-flow github-projects migrate-all

# Dry run to preview changes
npx claude-flow github-projects migrate-all --dry-run
```

### 13.3 Rollback Plan

If issues occur:

1. **Disable Sync**: `npx claude-flow github-projects disable`
2. **Preserve Data**: All internal data remains unchanged
3. **GitHub Cleanup**: Optional cleanup of created projects/issues
4. **Re-enable**: Fix issues and re-enable when ready

---

## 14. Conclusion

This architecture provides a robust, scalable solution for integrating GitHub Projects with the teammate-agents module. Key benefits include:

- **Seamless Integration**: Natural mapping between internal concepts and GitHub features
- **Bidirectional Sync**: Keeps both systems in sync automatically
- **Graceful Degradation**: Continues operating when GitHub is unavailable
- **Flexible Configuration**: Adapts to different workflows and strategies
- **Production-Ready**: Comprehensive error handling and monitoring

The design prioritizes reliability, developer experience, and operational excellence while maintaining the simplicity and power of the existing teammate-agents system.

---

## Appendix A: API Reference Summary

### GitHubProjectManager
- Project CRUD: `createProject`, `updateProject`, `deleteProject`
- Column management: `createColumns`, `updateColumn`, `listColumns`
- Item operations: `addItemToProject`, `moveItem`, `removeItemFromProject`
- Synchronization: `syncProjectState`, `getProjectSyncStatus`

### GitHubIssueManager
- Issue CRUD: `createIssue`, `updateIssue`, `closeIssue`, `reopenIssue`
- Bulk operations: `createIssuesFromTasks`, `updateIssuesBulk`
- Project integration: `addIssueToProject`, `moveIssueInProject`
- State sync: `syncIssueFromTask`, `syncTaskFromIssue`

### StateColumnMapper
- Mapping: `getColumnForState`, `getStateForColumn`
- Configuration: `loadMappingStrategy`, `validateStrategy`
- Operations: `createColumnsForEpic`, `ensureColumnExists`

### SyncCoordinator
- Sync modes: `enableSync`, `disableSync`, `pauseSync`, `resumeSync`
- Push/Pull: `pushEpicState`, `pullProjectState`
- Conflicts: `detectConflicts`, `resolveConflict`, `autoResolveConflicts`
- Batch: `batchPush`, `batchPull`, `syncQueue`

---

## Appendix B: Configuration Examples

See Section 8 for detailed configuration options and profiles.

---

## Appendix C: Troubleshooting Guide

### Common Issues

**Sync not working**
- Check GitHub token permissions
- Verify webhook configuration
- Check circuit breaker status
- Review sync coordinator logs

**Conflicts not resolving**
- Verify conflict resolution strategy
- Check for manual resolution queue
- Review conflict resolution logs

**Performance issues**
- Check rate limit status
- Adjust batch sizes
- Enable caching
- Review concurrent request limits

---

**Document Version:** 1.0.0
**Last Updated:** 2025-12-10
**Next Review:** 2026-01-10
