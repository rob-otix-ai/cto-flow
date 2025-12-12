/**
 * Epic Memory Manager - Integrates with claude-flow's memory system
 *
 * Manages epic-scoped memory namespaces for:
 * - Epic context and metadata (permanent)
 * - Architectural Decision Records (ADRs)
 * - Task state tracking (30 days TTL)
 * - Agent assignments
 * - Bidirectional sync state (1 hour TTL)
 *
 * Integration with claude-flow memory patterns for distributed coordination.
 */

import { EventEmitter } from 'events';

// ===== TYPE DEFINITIONS =====

export interface EpicContext {
  epicId: string;
  title: string;
  description: string;
  status: 'planning' | 'active' | 'paused' | 'completed' | 'cancelled';
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  owner: string;
  tags: string[];
  metadata: Record<string, unknown>;
  dependencies: string[];
  milestones: Milestone[];
  objectives: string[];
  constraints: string[];
}

export interface Milestone {
  id: string;
  title: string;
  description: string;
  dueDate?: Date;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  completedAt?: Date;
  blockers?: string[];
}

export interface ArchitecturalDecision {
  id: string;
  epicId: string;
  title: string;
  context: string;
  decision: string;
  consequences: string[];
  alternatives: Alternative[];
  status: 'proposed' | 'accepted' | 'deprecated' | 'superseded';
  createdAt: Date;
  createdBy: string;
  reviewedBy?: string[];
  supersededBy?: string;
  tags: string[];
  metadata: Record<string, unknown>;
}

export interface Alternative {
  title: string;
  description: string;
  pros: string[];
  cons: string[];
}

export interface TaskProgress {
  taskId: string;
  epicId: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked';
  progress: number;
  assignedTo?: string;
  startedAt?: Date;
  completedAt?: Date;
  estimatedHours?: number;
  actualHours?: number;
  blockers?: string[];
  dependencies: string[];
  checkpoints: Checkpoint[];
  metadata: Record<string, unknown>;
}

export interface Checkpoint {
  id: string;
  timestamp: Date;
  progress: number;
  notes: string;
  recordedBy: string;
}

export interface AgentAssignment {
  agentId: string;
  epicId: string;
  role: string;
  assignedAt: Date;
  assignedBy: string;
  responsibilities: string[];
  permissions: string[];
  taskIds: string[];
  status: 'active' | 'paused' | 'completed' | 'removed';
  metadata: Record<string, unknown>;
}

export interface SyncState {
  epicId: string;
  lastSyncAt: Date;
  syncDirection: 'push' | 'pull' | 'bidirectional';
  remoteEndpoint?: string;
  conflicts: SyncConflict[];
  pendingChanges: number;
  status: 'synced' | 'syncing' | 'conflict' | 'error';
  errorMessage?: string;
}

export interface SyncConflict {
  id: string;
  key: string;
  localValue: unknown;
  remoteValue: unknown;
  timestamp: Date;
  resolved: boolean;
  resolution?: 'local' | 'remote' | 'merge';
}

export interface MemoryOptions {
  namespace?: string;
  ttl?: number;
  partition?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface EpicMemoryConfig {
  memoryManager?: any;
  defaultTtl?: number;
  enableCompression?: boolean;
  enableEncryption?: boolean;
  autoSync?: boolean;
  syncInterval?: number;
}

// ===== MEMORY NAMESPACE CONSTANTS =====

export const EPIC_NAMESPACES = {
  CONTEXT: 'epic:context',
  DECISIONS: 'epic:decisions',
  TASKS: 'epic:tasks',
  AGENTS: 'epic:agents',
  SYNC: 'epic:sync',
} as const;

export const TTL_PRESETS = {
  PERMANENT: undefined,
  TASKS: 30 * 24 * 60 * 60 * 1000, // 30 days
  SYNC: 60 * 60 * 1000, // 1 hour
  CACHE: 5 * 60 * 1000, // 5 minutes
} as const;

// ===== FILE-PERSISTED STORAGE (DEFAULT) =====
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

class SimpleInMemoryStorage {
  private _data: Map<string, { value: any; expiresAt?: number }> = new Map();
  private _persistPath: string;
  private _dirty = false;

  constructor() {
    // Store in user's home directory for cross-process persistence
    const homeDir = os.homedir();
    const dataDir = path.join(homeDir, '.claude-flow', 'cto-flow');

    // Ensure directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this._persistPath = path.join(dataDir, 'epic-memory.json');
    this._loadFromDisk();
  }

  private _loadFromDisk(): void {
    try {
      if (fs.existsSync(this._persistPath)) {
        const data = JSON.parse(fs.readFileSync(this._persistPath, 'utf-8'));
        for (const [key, entry] of Object.entries(data)) {
          this._data.set(key, entry as { value: any; expiresAt?: number });
        }
      }
    } catch {
      // Ignore errors, start fresh
    }
  }

  private _saveToDisk(): void {
    if (!this._dirty) return;
    try {
      const obj: Record<string, any> = {};
      for (const [key, entry] of this._data.entries()) {
        obj[key] = entry;
      }
      fs.writeFileSync(this._persistPath, JSON.stringify(obj, null, 2));
      this._dirty = false;
    } catch {
      // Ignore errors
    }
  }

  async store(key: string, value: any, options?: { partition?: string; ttl?: number }): Promise<void> {
    const fullKey = options?.partition ? `${options.partition}:${key}` : key;
    const expiresAt = options?.ttl ? Date.now() + options.ttl : undefined;
    this._data.set(fullKey, { value, expiresAt });
    this._dirty = true;
    this._saveToDisk();
  }

  async retrieve(key: string, options?: { partition?: string }): Promise<any | null> {
    const fullKey = options?.partition ? `${options.partition}:${key}` : key;
    const entry = this._data.get(fullKey);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this._data.delete(fullKey);
      this._dirty = true;
      this._saveToDisk();
      return null;
    }
    return entry.value;
  }

  async delete(key: string, options?: { partition?: string }): Promise<boolean> {
    const fullKey = options?.partition ? `${options.partition}:${key}` : key;
    const result = this._data.delete(fullKey);
    if (result) {
      this._dirty = true;
      this._saveToDisk();
    }
    return result;
  }

  async exists(key: string, options?: { partition?: string }): Promise<boolean> {
    const fullKey = options?.partition ? `${options.partition}:${key}` : key;
    const entry = this._data.get(fullKey);
    if (!entry) return false;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this._data.delete(fullKey);
      this._dirty = true;
      this._saveToDisk();
      return false;
    }
    return true;
  }

  async list(options?: { partition?: string; pattern?: string }): Promise<string[]> {
    const prefix = options?.partition ? `${options.partition}:` : '';
    const pattern = options?.pattern;
    const keys: string[] = [];

    for (const key of this._data.keys()) {
      if (prefix && !key.startsWith(prefix)) continue;

      // Check TTL
      const entry = this._data.get(key);
      if (entry?.expiresAt && Date.now() > entry.expiresAt) {
        this._data.delete(key);
        this._dirty = true;
        continue;
      }

      // Pattern matching (simple glob-like)
      if (pattern) {
        const searchKey = prefix ? key.slice(prefix.length) : key;
        const regexPattern = pattern.replace(/\*/g, '.*').replace(/\?/g, '.');
        if (!new RegExp(`^${regexPattern}$`).test(searchKey)) continue;
      }

      keys.push(prefix ? key.slice(prefix.length) : key);
    }

    if (this._dirty) {
      this._saveToDisk();
    }

    return keys;
  }
}

// ===== EPIC MEMORY MANAGER CLASS =====

export class EpicMemoryManager extends EventEmitter {
  private memoryManager: any;
  private config: Required<EpicMemoryConfig>;
  private syncTimer?: NodeJS.Timeout;
  private isInitialized = false;

  constructor(config: EpicMemoryConfig = {}) {
    super();

    this.config = {
      memoryManager: config.memoryManager,
      defaultTtl: config.defaultTtl ?? TTL_PRESETS.TASKS,
      enableCompression: config.enableCompression ?? false,
      enableEncryption: config.enableEncryption ?? false,
      autoSync: config.autoSync ?? false,
      syncInterval: config.syncInterval ?? 60000, // 1 minute
    };

    // Use provided memory manager or create a simple in-memory fallback
    this.memoryManager = this.config.memoryManager ?? new SimpleInMemoryStorage();
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    if (this.memoryManager && typeof this.memoryManager.initialize === 'function') {
      await this.memoryManager.initialize();
    }

    if (this.config.autoSync) {
      this.startAutoSync();
    }

    this.isInitialized = true;
    this.emit('initialized');
  }

  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    this.stopAutoSync();

    if (this.memoryManager && typeof this.memoryManager.shutdown === 'function') {
      await this.memoryManager.shutdown();
    }

    this.isInitialized = false;
    this.emit('shutdown');
  }

  // ===== EPIC CONTEXT OPERATIONS =====

  /**
   * Store epic context to permanent memory
   */
  async storeEpicContext(context: EpicContext): Promise<string> {
    const key = this.generateKey(EPIC_NAMESPACES.CONTEXT, context.epicId);

    const serializedContext = {
      ...context,
      createdAt: context.createdAt.toISOString(),
      updatedAt: context.updatedAt.toISOString(),
      milestones: context.milestones.map(m => ({
        ...m,
        dueDate: m.dueDate?.toISOString(),
        completedAt: m.completedAt?.toISOString(),
      })),
    };

    await this.store(key, serializedContext, {
      namespace: EPIC_NAMESPACES.CONTEXT,
      ttl: TTL_PRESETS.PERMANENT,
      tags: ['epic', 'context', context.epicId, ...context.tags],
      metadata: {
        epicId: context.epicId,
        status: context.status,
        owner: context.owner,
      },
    });

    this.emit('context:stored', { epicId: context.epicId, key });
    return key;
  }

  /**
   * Load epic context from memory
   */
  async loadEpicContext(epicId: string): Promise<EpicContext | null> {
    const key = this.generateKey(EPIC_NAMESPACES.CONTEXT, epicId);
    const data = await this.retrieve<any>(key, EPIC_NAMESPACES.CONTEXT);

    if (!data) {
      return null;
    }

    const context: EpicContext = {
      ...data,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
      milestones: data.milestones.map((m: any) => ({
        ...m,
        dueDate: m.dueDate ? new Date(m.dueDate) : undefined,
        completedAt: m.completedAt ? new Date(m.completedAt) : undefined,
      })),
    };

    this.emit('context:loaded', { epicId, key });
    return context;
  }

  /**
   * List all epic contexts from memory
   */
  async listAllEpicContexts(): Promise<EpicContext[]> {
    if (!this.memoryManager) {
      return [];
    }

    try {
      // Get all keys matching epic:context:epic-* pattern (user epics only)
      let keys: string[] = [];

      if (typeof this.memoryManager.list === 'function') {
        keys = await this.memoryManager.list({
          pattern: `${EPIC_NAMESPACES.CONTEXT}:epic-*`,
        });
      } else if (typeof this.memoryManager.query === 'function') {
        const results = await this.memoryManager.query({
          key: `${EPIC_NAMESPACES.CONTEXT}:epic-*`,
        });
        keys = results.map((r: any) => r.key);
      }

      const contexts: EpicContext[] = [];
      for (const key of keys) {
        // Extract epicId from key (format: epic:context:epic-id)
        const epicId = key.replace(`${EPIC_NAMESPACES.CONTEXT}:`, '');
        // Skip internal project entries
        if (epicId.startsWith('cto-flow-projects:')) continue;
        const context = await this.loadEpicContext(epicId);
        if (context) {
          contexts.push(context);
        }
      }

      this.emit('contexts:listed', { count: contexts.length });
      return contexts;
    } catch (error) {
      this.emit('error', { operation: 'listAllEpicContexts', error });
      return [];
    }
  }

  /**
   * Update epic context
   */
  async updateEpicContext(
    epicId: string,
    updates: Partial<EpicContext>
  ): Promise<boolean> {
    const existing = await this.loadEpicContext(epicId);
    if (!existing) {
      return false;
    }

    const updated: EpicContext = {
      ...existing,
      ...updates,
      epicId, // Prevent epicId change
      updatedAt: new Date(),
    };

    await this.storeEpicContext(updated);
    this.emit('context:updated', { epicId, updates });
    return true;
  }

  // ===== ARCHITECTURAL DECISION RECORDS (ADR) =====

  /**
   * Store an architectural decision
   */
  async storeDecision(decision: ArchitecturalDecision): Promise<string> {
    const key = this.generateKey(
      EPIC_NAMESPACES.DECISIONS,
      decision.epicId,
      decision.id
    );

    const serializedDecision = {
      ...decision,
      createdAt: decision.createdAt.toISOString(),
    };

    await this.store(key, serializedDecision, {
      namespace: EPIC_NAMESPACES.DECISIONS,
      ttl: TTL_PRESETS.PERMANENT,
      tags: ['adr', 'decision', decision.epicId, decision.status, ...decision.tags],
      metadata: {
        epicId: decision.epicId,
        decisionId: decision.id,
        status: decision.status,
        createdBy: decision.createdBy,
      },
    });

    this.emit('decision:stored', { epicId: decision.epicId, decisionId: decision.id });
    return key;
  }

  /**
   * Get all decisions for an epic
   */
  async getDecisions(epicId: string): Promise<ArchitecturalDecision[]> {
    const pattern = this.generateKey(EPIC_NAMESPACES.DECISIONS, epicId, '*');
    const keys = await this.findKeys(pattern, EPIC_NAMESPACES.DECISIONS);

    const decisions: ArchitecturalDecision[] = [];

    for (const key of keys) {
      const data = await this.retrieve<any>(key, EPIC_NAMESPACES.DECISIONS);
      if (data) {
        decisions.push({
          ...data,
          createdAt: new Date(data.createdAt),
        });
      }
    }

    this.emit('decisions:retrieved', { epicId, count: decisions.length });
    return decisions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Get a specific decision by ID
   */
  async getDecision(epicId: string, decisionId: string): Promise<ArchitecturalDecision | null> {
    const key = this.generateKey(EPIC_NAMESPACES.DECISIONS, epicId, decisionId);
    const data = await this.retrieve<any>(key, EPIC_NAMESPACES.DECISIONS);

    if (!data) {
      return null;
    }

    return {
      ...data,
      createdAt: new Date(data.createdAt),
    };
  }

  /**
   * Update a decision's status
   */
  async updateDecisionStatus(
    epicId: string,
    decisionId: string,
    status: ArchitecturalDecision['status'],
    supersededBy?: string
  ): Promise<boolean> {
    const decision = await this.getDecision(epicId, decisionId);
    if (!decision) {
      return false;
    }

    decision.status = status;
    if (supersededBy) {
      decision.supersededBy = supersededBy;
    }

    await this.storeDecision(decision);
    this.emit('decision:updated', { epicId, decisionId, status });
    return true;
  }

  // ===== TASK PROGRESS TRACKING =====

  /**
   * Track task progress with 30-day TTL
   */
  async trackTaskProgress(progress: TaskProgress): Promise<string> {
    const key = this.generateKey(EPIC_NAMESPACES.TASKS, progress.epicId, progress.taskId);

    const serializedProgress = {
      ...progress,
      startedAt: progress.startedAt?.toISOString(),
      completedAt: progress.completedAt?.toISOString(),
      checkpoints: progress.checkpoints.map(c => ({
        ...c,
        timestamp: c.timestamp.toISOString(),
      })),
    };

    await this.store(key, serializedProgress, {
      namespace: EPIC_NAMESPACES.TASKS,
      ttl: TTL_PRESETS.TASKS,
      tags: ['task', 'progress', progress.epicId, progress.status],
      metadata: {
        epicId: progress.epicId,
        taskId: progress.taskId,
        status: progress.status,
        progress: progress.progress,
        assignedTo: progress.assignedTo,
      },
    });

    this.emit('task:tracked', { epicId: progress.epicId, taskId: progress.taskId });
    return key;
  }

  /**
   * Get task progress
   */
  async getTaskProgress(epicId: string, taskId: string): Promise<TaskProgress | null> {
    const key = this.generateKey(EPIC_NAMESPACES.TASKS, epicId, taskId);
    const data = await this.retrieve<any>(key, EPIC_NAMESPACES.TASKS);

    if (!data) {
      return null;
    }

    return {
      ...data,
      startedAt: data.startedAt ? new Date(data.startedAt) : undefined,
      completedAt: data.completedAt ? new Date(data.completedAt) : undefined,
      checkpoints: data.checkpoints.map((c: any) => ({
        ...c,
        timestamp: new Date(c.timestamp),
      })),
    };
  }

  /**
   * Get all tasks for an epic
   */
  async getEpicTasks(epicId: string): Promise<TaskProgress[]> {
    const pattern = this.generateKey(EPIC_NAMESPACES.TASKS, epicId, '*');
    const keys = await this.findKeys(pattern, EPIC_NAMESPACES.TASKS);

    const tasks: TaskProgress[] = [];

    for (const key of keys) {
      const data = await this.retrieve<any>(key, EPIC_NAMESPACES.TASKS);
      if (data) {
        tasks.push({
          ...data,
          startedAt: data.startedAt ? new Date(data.startedAt) : undefined,
          completedAt: data.completedAt ? new Date(data.completedAt) : undefined,
          checkpoints: data.checkpoints.map((c: any) => ({
            ...c,
            timestamp: new Date(c.timestamp),
          })),
        });
      }
    }

    this.emit('tasks:retrieved', { epicId, count: tasks.length });
    return tasks;
  }

  /**
   * Update task status and progress
   */
  async updateTaskStatus(
    epicId: string,
    taskId: string,
    status: TaskProgress['status'],
    progress?: number
  ): Promise<boolean> {
    const task = await this.getTaskProgress(epicId, taskId);
    if (!task) {
      return false;
    }

    task.status = status;
    if (progress !== undefined) {
      task.progress = progress;
    }

    if (status === 'completed') {
      task.completedAt = new Date();
    }

    await this.trackTaskProgress(task);
    this.emit('task:updated', { epicId, taskId, status, progress });
    return true;
  }

  // ===== AGENT ASSIGNMENT TRACKING =====

  /**
   * Record agent assignment
   */
  async recordAgentAssignment(assignment: AgentAssignment): Promise<string> {
    const key = this.generateKey(
      EPIC_NAMESPACES.AGENTS,
      assignment.epicId,
      assignment.agentId
    );

    const serializedAssignment = {
      ...assignment,
      assignedAt: assignment.assignedAt.toISOString(),
    };

    await this.store(key, serializedAssignment, {
      namespace: EPIC_NAMESPACES.AGENTS,
      ttl: TTL_PRESETS.PERMANENT,
      tags: ['agent', 'assignment', assignment.epicId, assignment.status],
      metadata: {
        epicId: assignment.epicId,
        agentId: assignment.agentId,
        role: assignment.role,
        status: assignment.status,
      },
    });

    this.emit('agent:assigned', { epicId: assignment.epicId, agentId: assignment.agentId });
    return key;
  }

  /**
   * Get agent assignment
   */
  async getAgentAssignment(epicId: string, agentId: string): Promise<AgentAssignment | null> {
    const key = this.generateKey(EPIC_NAMESPACES.AGENTS, epicId, agentId);
    const data = await this.retrieve<any>(key, EPIC_NAMESPACES.AGENTS);

    if (!data) {
      return null;
    }

    return {
      ...data,
      assignedAt: new Date(data.assignedAt),
    };
  }

  /**
   * Get all agents assigned to an epic
   */
  async getEpicAgents(epicId: string): Promise<AgentAssignment[]> {
    const pattern = this.generateKey(EPIC_NAMESPACES.AGENTS, epicId, '*');
    const keys = await this.findKeys(pattern, EPIC_NAMESPACES.AGENTS);

    const agents: AgentAssignment[] = [];

    for (const key of keys) {
      const data = await this.retrieve<any>(key, EPIC_NAMESPACES.AGENTS);
      if (data) {
        agents.push({
          ...data,
          assignedAt: new Date(data.assignedAt),
        });
      }
    }

    this.emit('agents:retrieved', { epicId, count: agents.length });
    return agents.filter(a => a.status === 'active');
  }

  /**
   * Update agent assignment status
   */
  async updateAgentStatus(
    epicId: string,
    agentId: string,
    status: AgentAssignment['status']
  ): Promise<boolean> {
    const assignment = await this.getAgentAssignment(epicId, agentId);
    if (!assignment) {
      return false;
    }

    assignment.status = status;
    await this.recordAgentAssignment(assignment);
    this.emit('agent:updated', { epicId, agentId, status });
    return true;
  }

  // ===== BIDIRECTIONAL SYNC STATE =====

  /**
   * Store sync state with 1-hour TTL
   */
  async storeSyncState(syncState: SyncState): Promise<string> {
    const key = this.generateKey(EPIC_NAMESPACES.SYNC, syncState.epicId);

    const serializedState = {
      ...syncState,
      lastSyncAt: syncState.lastSyncAt.toISOString(),
      conflicts: syncState.conflicts.map(c => ({
        ...c,
        timestamp: c.timestamp.toISOString(),
      })),
    };

    await this.store(key, serializedState, {
      namespace: EPIC_NAMESPACES.SYNC,
      ttl: TTL_PRESETS.SYNC,
      tags: ['sync', syncState.epicId, syncState.status],
      metadata: {
        epicId: syncState.epicId,
        status: syncState.status,
        pendingChanges: syncState.pendingChanges,
      },
    });

    this.emit('sync:stored', { epicId: syncState.epicId, status: syncState.status });
    return key;
  }

  /**
   * Get sync state
   */
  async getSyncState(epicId: string): Promise<SyncState | null> {
    const key = this.generateKey(EPIC_NAMESPACES.SYNC, epicId);
    const data = await this.retrieve<any>(key, EPIC_NAMESPACES.SYNC);

    if (!data) {
      return null;
    }

    return {
      ...data,
      lastSyncAt: new Date(data.lastSyncAt),
      conflicts: data.conflicts.map((c: any) => ({
        ...c,
        timestamp: new Date(c.timestamp),
      })),
    };
  }

  /**
   * Mark sync conflict as resolved
   */
  async resolveSyncConflict(
    epicId: string,
    conflictId: string,
    resolution: 'local' | 'remote' | 'merge'
  ): Promise<boolean> {
    const syncState = await this.getSyncState(epicId);
    if (!syncState) {
      return false;
    }

    const conflict = syncState.conflicts.find(c => c.id === conflictId);
    if (!conflict) {
      return false;
    }

    conflict.resolved = true;
    conflict.resolution = resolution;

    if (syncState.conflicts.every(c => c.resolved)) {
      syncState.status = 'synced';
    }

    await this.storeSyncState(syncState);
    this.emit('conflict:resolved', { epicId, conflictId, resolution });
    return true;
  }

  // ===== UTILITY METHODS =====

  /**
   * Generate namespaced memory key
   */
  private generateKey(namespace: string, ...parts: string[]): string {
    return `${namespace}:${parts.join(':')}`;
  }

  /**
   * Store data in memory
   */
  private async store(
    key: string,
    value: unknown,
    options: MemoryOptions
  ): Promise<void> {
    if (!this.memoryManager) {
      throw new Error('Memory manager not configured');
    }

    // Don't use partition - the key already includes the namespace
    const storeOptions: any = {
      ttl: options.ttl,
      tags: options.tags,
      metadata: options.metadata,
    };

    if (typeof this.memoryManager.store === 'function') {
      await this.memoryManager.store(key, value, storeOptions);
    } else {
      throw new Error('Memory manager does not support store operation');
    }
  }

  /**
   * Retrieve data from memory
   */
  private async retrieve<T = unknown>(
    key: string,
    _namespace?: string
  ): Promise<T | null> {
    if (!this.memoryManager) {
      return null;
    }

    try {
      if (typeof this.memoryManager.retrieve === 'function') {
        // Don't use partition - the key already includes the namespace
        const value = await this.memoryManager.retrieve(key);
        return value as T;
      }
      return null;
    } catch (error) {
      this.emit('error', { operation: 'retrieve', key, error });
      return null;
    }
  }

  /**
   * Find keys matching a pattern
   */
  private async findKeys(pattern: string, _namespace?: string): Promise<string[]> {
    if (!this.memoryManager) {
      return [];
    }

    try {
      // Don't use partition - the pattern already includes the namespace
      if (typeof this.memoryManager.list === 'function') {
        return await this.memoryManager.list({ pattern });
      } else if (typeof this.memoryManager.query === 'function') {
        const results = await this.memoryManager.query({ key: pattern });
        return results.map((r: any) => r.key);
      }
      return [];
    } catch (error) {
      this.emit('error', { operation: 'findKeys', pattern, error });
      return [];
    }
  }

  /**
   * Delete data from memory
   */
  async delete(key: string, _namespace?: string): Promise<boolean> {
    if (!this.memoryManager) {
      return false;
    }

    try {
      if (typeof this.memoryManager.delete === 'function') {
        // Don't use partition - the key already includes the namespace
        await this.memoryManager.delete(key);
        this.emit('deleted', { key });
        return true;
      }
      return false;
    } catch (error) {
      this.emit('error', { operation: 'delete', key, error });
      return false;
    }
  }

  /**
   * Delete all data for an epic
   */
  async deleteEpic(epicId: string): Promise<void> {
    const namespaces = Object.values(EPIC_NAMESPACES);

    for (const namespace of namespaces) {
      const pattern = this.generateKey(namespace, epicId, '*');
      const keys = await this.findKeys(pattern, namespace);

      for (const key of keys) {
        await this.delete(key, namespace);
      }
    }

    this.emit('epic:deleted', { epicId });
  }

  /**
   * Get epic statistics
   */
  async getEpicStats(epicId: string): Promise<{
    context: boolean;
    decisions: number;
    tasks: number;
    agents: number;
    syncState: boolean;
  }> {
    const [context, decisions, tasks, agents, syncState] = await Promise.all([
      this.loadEpicContext(epicId),
      this.getDecisions(epicId),
      this.getEpicTasks(epicId),
      this.getEpicAgents(epicId),
      this.getSyncState(epicId),
    ]);

    return {
      context: context !== null,
      decisions: decisions.length,
      tasks: tasks.length,
      agents: agents.length,
      syncState: syncState !== null,
    };
  }

  /**
   * Export epic data
   */
  async exportEpic(epicId: string): Promise<{
    context: EpicContext | null;
    decisions: ArchitecturalDecision[];
    tasks: TaskProgress[];
    agents: AgentAssignment[];
    syncState: SyncState | null;
  }> {
    const [context, decisions, tasks, agents, syncState] = await Promise.all([
      this.loadEpicContext(epicId),
      this.getDecisions(epicId),
      this.getEpicTasks(epicId),
      this.getEpicAgents(epicId),
      this.getSyncState(epicId),
    ]);

    return { context, decisions, tasks, agents, syncState };
  }

  // ===== AUTO-SYNC MANAGEMENT =====

  private startAutoSync(): void {
    if (this.syncTimer) {
      return;
    }

    this.syncTimer = setInterval(() => {
      this.performAutoSync().catch(error => {
        this.emit('error', { operation: 'autoSync', error });
      });
    }, this.config.syncInterval);

    this.emit('autoSync:started');
  }

  private stopAutoSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = undefined;
      this.emit('autoSync:stopped');
    }
  }

  private async performAutoSync(): Promise<void> {
    this.emit('autoSync:running');
  }
}

// ===== FACTORY FUNCTION =====

/**
 * Create an Epic Memory Manager instance
 */
export function createEpicMemoryManager(
  config: EpicMemoryConfig = {}
): EpicMemoryManager {
  return new EpicMemoryManager(config);
}

// ===== DEFAULT EXPORT =====

export default EpicMemoryManager;
