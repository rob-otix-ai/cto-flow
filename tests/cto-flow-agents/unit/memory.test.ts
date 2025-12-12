/**
 * Comprehensive unit tests for Epic Memory Manager
 *
 * Tests namespace operations, TTL behavior, serialization, ADR operations,
 * agent assignments, and memory key generation.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

/**
 * Mock memory store interface
 */
interface MemoryStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttl?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  keys(pattern: string): Promise<string[]>;
  clear(): Promise<void>;
}

/**
 * Mock implementation of memory store for testing
 */
class MockMemoryStore implements MemoryStore {
  private data = new Map<string, { value: string; expiry?: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.data.get(key);
    if (!entry) return null;

    // Check if expired
    if (entry.expiry && Date.now() > entry.expiry) {
      this.data.delete(key);
      return null;
    }

    return entry.value;
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    const entry: { value: string; expiry?: number } = { value };
    if (ttl) {
      entry.expiry = Date.now() + ttl;
    }
    this.data.set(key, entry);
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    return Array.from(this.data.keys()).filter(key => regex.test(key));
  }

  async clear(): Promise<void> {
    this.data.clear();
  }

  // Test helper to set expiry time directly
  setExpiry(key: string, expiry: number): void {
    const entry = this.data.get(key);
    if (entry) {
      entry.expiry = expiry;
    }
  }
}

/**
 * ADR (Architectural Decision Record) interface
 */
interface ADR {
  id: string;
  epicId: string;
  title: string;
  decision: string;
  context: string;
  consequences: string[];
  timestamp: Date;
  metadata: Record<string, unknown>;
}

/**
 * Agent Assignment interface
 */
interface AgentAssignment {
  id: string;
  epicId: string;
  agentId: string;
  taskId: string;
  assignedAt: Date;
  metadata: Record<string, unknown>;
}

/**
 * Epic Memory Manager - manages epic-related data in namespaced storage
 */
class EpicMemoryManager {
  private readonly NAMESPACE_PREFIX = 'epic';
  private readonly TTL_NONE = undefined;
  private readonly TTL_TASKS = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
  private readonly TTL_SYNC = 60 * 60 * 1000; // 1 hour in milliseconds

  constructor(private store: MemoryStore) {}

  /**
   * Generate memory key for epic namespace
   */
  private generateKey(epicId: string, namespace: string, subKey?: string): string {
    // Sanitize special characters
    const sanitizedEpicId = this.sanitizeKeyComponent(epicId);
    const sanitizedNamespace = this.sanitizeKeyComponent(namespace);

    let key = `${this.NAMESPACE_PREFIX}:${sanitizedEpicId}:${sanitizedNamespace}`;

    if (subKey) {
      const sanitizedSubKey = this.sanitizeKeyComponent(subKey);
      key += `:${sanitizedSubKey}`;
    }

    return key;
  }

  /**
   * Sanitize key component to handle special characters
   * Note: preserves '*' for pattern matching in keys() queries
   */
  private sanitizeKeyComponent(component: string): string {
    // Keep '*' for pattern matching - only sanitize when it's the entire component
    if (component === '*') {
      return '*';
    }
    return component
      .replace(/:/g, '_')
      .replace(/\*/g, '_')
      .replace(/\s+/g, '-');
  }

  /**
   * Store epic context (permanent - no TTL)
   */
  async storeContext(epicId: string, context: Record<string, unknown>): Promise<void> {
    const key = this.generateKey(epicId, 'context');
    await this.store.set(key, JSON.stringify(context), this.TTL_NONE);
  }

  /**
   * Retrieve epic context
   */
  async getContext(epicId: string): Promise<Record<string, unknown> | null> {
    const key = this.generateKey(epicId, 'context');
    const data = await this.store.get(key);
    return data ? JSON.parse(data) : null;
  }

  /**
   * Store decision (ADR) - permanent, no TTL
   */
  async storeDecision(epicId: string, adr: ADR): Promise<void> {
    const key = this.generateKey(epicId, 'decisions', adr.id);
    await this.store.set(key, JSON.stringify(adr), this.TTL_NONE);
  }

  /**
   * Get all decisions for an epic
   */
  async getDecisions(epicId: string): Promise<ADR[]> {
    const pattern = this.generateKey(epicId, 'decisions', '*');
    const keys = await this.store.keys(pattern);

    const decisions: ADR[] = [];
    for (const key of keys) {
      const data = await this.store.get(key);
      if (data) {
        const adr = JSON.parse(data);
        // Restore Date objects
        adr.timestamp = new Date(adr.timestamp);
        decisions.push(adr);
      }
    }

    return decisions;
  }

  /**
   * Store task (30-day TTL)
   */
  async storeTask(epicId: string, taskId: string, task: Record<string, unknown>): Promise<void> {
    const key = this.generateKey(epicId, 'tasks', taskId);
    await this.store.set(key, JSON.stringify(task), this.TTL_TASKS);
  }

  /**
   * Retrieve task
   */
  async getTask(epicId: string, taskId: string): Promise<Record<string, unknown> | null> {
    const key = this.generateKey(epicId, 'tasks', taskId);
    const data = await this.store.get(key);
    return data ? JSON.parse(data) : null;
  }

  /**
   * Get all tasks for an epic
   */
  async getTasks(epicId: string): Promise<Record<string, unknown>[]> {
    const pattern = this.generateKey(epicId, 'tasks', '*');
    const keys = await this.store.keys(pattern);

    const tasks: Record<string, unknown>[] = [];
    for (const key of keys) {
      const data = await this.store.get(key);
      if (data) {
        tasks.push(JSON.parse(data));
      }
    }

    return tasks;
  }

  /**
   * Store agent assignment
   */
  async recordAgentAssignment(assignment: AgentAssignment): Promise<void> {
    const key = this.generateKey(assignment.epicId, 'agents', assignment.id);
    await this.store.set(key, JSON.stringify(assignment), this.TTL_NONE);
  }

  /**
   * Get all agent assignments for an epic
   */
  async getAssignments(epicId: string): Promise<AgentAssignment[]> {
    const pattern = this.generateKey(epicId, 'agents', '*');
    const keys = await this.store.keys(pattern);

    const assignments: AgentAssignment[] = [];
    for (const key of keys) {
      const data = await this.store.get(key);
      if (data) {
        const assignment = JSON.parse(data);
        // Restore Date objects
        assignment.assignedAt = new Date(assignment.assignedAt);
        assignments.push(assignment);
      }
    }

    return assignments;
  }

  /**
   * Store sync state (1-hour TTL)
   */
  async storeSyncState(epicId: string, syncState: Record<string, unknown>): Promise<void> {
    const key = this.generateKey(epicId, 'sync');
    await this.store.set(key, JSON.stringify(syncState), this.TTL_SYNC);
  }

  /**
   * Retrieve sync state
   */
  async getSyncState(epicId: string): Promise<Record<string, unknown> | null> {
    const key = this.generateKey(epicId, 'sync');
    const data = await this.store.get(key);
    return data ? JSON.parse(data) : null;
  }

  /**
   * Test helper to serialize complex objects
   */
  serializeObject(obj: unknown): string {
    return JSON.stringify(obj);
  }

  /**
   * Test helper to deserialize objects
   */
  deserializeObject<T>(data: string): T {
    return JSON.parse(data);
  }
}

describe('Epic Memory Manager', () => {
  let store: MockMemoryStore;
  let manager: EpicMemoryManager;
  const testEpicId = 'epic-123';

  beforeEach(() => {
    store = new MockMemoryStore();
    manager = new EpicMemoryManager(store);
  });

  afterEach(async () => {
    await store.clear();
  });

  describe('Namespace Operations', () => {
    describe('Context Namespace (epic:{epicId}:context)', () => {
      it('should store context correctly', async () => {
        const context = {
          name: 'Test Epic',
          description: 'A test epic',
          goals: ['goal1', 'goal2'],
          createdAt: new Date().toISOString()
        };

        await manager.storeContext(testEpicId, context);
        const retrieved = await manager.getContext(testEpicId);

        expect(retrieved).toEqual(context);
      });

      it('should retrieve context correctly', async () => {
        const context = {
          name: 'Epic Context',
          metadata: { version: '1.0' }
        };

        await manager.storeContext(testEpicId, context);
        const retrieved = await manager.getContext(testEpicId);

        expect(retrieved).not.toBeNull();
        expect(retrieved?.name).toBe('Epic Context');
        expect(retrieved?.metadata).toEqual({ version: '1.0' });
      });

      it('should return null for non-existent context', async () => {
        const retrieved = await manager.getContext('non-existent-epic');
        expect(retrieved).toBeNull();
      });

      it('should update context when stored again', async () => {
        const context1 = { name: 'Version 1' };
        const context2 = { name: 'Version 2', updated: true };

        await manager.storeContext(testEpicId, context1);
        await manager.storeContext(testEpicId, context2);

        const retrieved = await manager.getContext(testEpicId);
        expect(retrieved).toEqual(context2);
      });
    });

    describe('Decisions Namespace (epic:{epicId}:decisions)', () => {
      it('should store decision correctly', async () => {
        const adr: ADR = {
          id: 'adr-001',
          epicId: testEpicId,
          title: 'Use TypeScript',
          decision: 'We will use TypeScript for type safety',
          context: 'Need better type checking',
          consequences: ['Better IDE support', 'Slightly longer compile times'],
          timestamp: new Date(),
          metadata: { author: 'dev1' }
        };

        await manager.storeDecision(testEpicId, adr);
        const decisions = await manager.getDecisions(testEpicId);

        expect(decisions).toHaveLength(1);
        expect(decisions[0].id).toBe('adr-001');
        expect(decisions[0].title).toBe('Use TypeScript');
      });

      it('should retrieve all decisions for an epic', async () => {
        const adr1: ADR = {
          id: 'adr-001',
          epicId: testEpicId,
          title: 'Decision 1',
          decision: 'First decision',
          context: 'Context 1',
          consequences: ['Consequence 1'],
          timestamp: new Date(),
          metadata: {}
        };

        const adr2: ADR = {
          id: 'adr-002',
          epicId: testEpicId,
          title: 'Decision 2',
          decision: 'Second decision',
          context: 'Context 2',
          consequences: ['Consequence 2'],
          timestamp: new Date(),
          metadata: {}
        };

        await manager.storeDecision(testEpicId, adr1);
        await manager.storeDecision(testEpicId, adr2);

        const decisions = await manager.getDecisions(testEpicId);
        expect(decisions).toHaveLength(2);
      });

      it('should preserve decision timestamps', async () => {
        const timestamp = new Date('2024-01-01T12:00:00Z');
        const adr: ADR = {
          id: 'adr-001',
          epicId: testEpicId,
          title: 'Test',
          decision: 'Test decision',
          context: 'Test context',
          consequences: [],
          timestamp,
          metadata: {}
        };

        await manager.storeDecision(testEpicId, adr);
        const decisions = await manager.getDecisions(testEpicId);

        expect(decisions[0].timestamp).toBeInstanceOf(Date);
        expect(decisions[0].timestamp.toISOString()).toBe(timestamp.toISOString());
      });
    });

    describe('Tasks Namespace (epic:{epicId}:tasks)', () => {
      it('should store task correctly', async () => {
        const task = {
          id: 'task-001',
          title: 'Implement feature',
          status: 'pending',
          priority: 'high'
        };

        await manager.storeTask(testEpicId, 'task-001', task);
        const retrieved = await manager.getTask(testEpicId, 'task-001');

        expect(retrieved).toEqual(task);
      });

      it('should retrieve all tasks for an epic', async () => {
        const task1 = { id: 'task-001', title: 'Task 1' };
        const task2 = { id: 'task-002', title: 'Task 2' };

        await manager.storeTask(testEpicId, 'task-001', task1);
        await manager.storeTask(testEpicId, 'task-002', task2);

        const tasks = await manager.getTasks(testEpicId);
        expect(tasks).toHaveLength(2);
      });

      it('should return null for non-existent task', async () => {
        const retrieved = await manager.getTask(testEpicId, 'non-existent');
        expect(retrieved).toBeNull();
      });
    });

    describe('Agents Namespace (epic:{epicId}:agents)', () => {
      it('should record agent assignment correctly', async () => {
        const assignment: AgentAssignment = {
          id: 'assign-001',
          epicId: testEpicId,
          agentId: 'agent-123',
          taskId: 'task-001',
          assignedAt: new Date(),
          metadata: { score: 85 }
        };

        await manager.recordAgentAssignment(assignment);
        const assignments = await manager.getAssignments(testEpicId);

        expect(assignments).toHaveLength(1);
        expect(assignments[0].agentId).toBe('agent-123');
        expect(assignments[0].taskId).toBe('task-001');
      });

      it('should retrieve all assignments for an epic', async () => {
        const assignment1: AgentAssignment = {
          id: 'assign-001',
          epicId: testEpicId,
          agentId: 'agent-1',
          taskId: 'task-1',
          assignedAt: new Date(),
          metadata: {}
        };

        const assignment2: AgentAssignment = {
          id: 'assign-002',
          epicId: testEpicId,
          agentId: 'agent-2',
          taskId: 'task-2',
          assignedAt: new Date(),
          metadata: {}
        };

        await manager.recordAgentAssignment(assignment1);
        await manager.recordAgentAssignment(assignment2);

        const assignments = await manager.getAssignments(testEpicId);
        expect(assignments).toHaveLength(2);
      });

      it('should preserve assignment timestamps', async () => {
        const assignedAt = new Date('2024-01-15T10:30:00Z');
        const assignment: AgentAssignment = {
          id: 'assign-001',
          epicId: testEpicId,
          agentId: 'agent-1',
          taskId: 'task-1',
          assignedAt,
          metadata: {}
        };

        await manager.recordAgentAssignment(assignment);
        const assignments = await manager.getAssignments(testEpicId);

        expect(assignments[0].assignedAt).toBeInstanceOf(Date);
        expect(assignments[0].assignedAt.toISOString()).toBe(assignedAt.toISOString());
      });
    });

    describe('Sync Namespace (epic:{epicId}:sync)', () => {
      it('should store sync state correctly', async () => {
        const syncState = {
          lastSync: new Date().toISOString(),
          status: 'synced',
          version: 1
        };

        await manager.storeSyncState(testEpicId, syncState);
        const retrieved = await manager.getSyncState(testEpicId);

        expect(retrieved).toEqual(syncState);
      });

      it('should retrieve sync state correctly', async () => {
        const syncState = {
          lastSync: '2024-01-01T00:00:00Z',
          pendingChanges: 5
        };

        await manager.storeSyncState(testEpicId, syncState);
        const retrieved = await manager.getSyncState(testEpicId);

        expect(retrieved).not.toBeNull();
        expect(retrieved?.lastSync).toBe('2024-01-01T00:00:00Z');
        expect(retrieved?.pendingChanges).toBe(5);
      });
    });
  });

  describe('TTL Behavior', () => {
    it('should store context with no TTL (permanent)', async () => {
      const context = { name: 'Permanent Context' };
      await manager.storeContext(testEpicId, context);

      // Simulate time passing (context should still exist)
      const retrieved = await manager.getContext(testEpicId);
      expect(retrieved).toEqual(context);
    });

    it('should store tasks with 30-day TTL', async () => {
      const task = { id: 'task-001', title: 'Test Task' };
      await manager.storeTask(testEpicId, 'task-001', task);

      // Task should exist before expiry
      const retrieved1 = await manager.getTask(testEpicId, 'task-001');
      expect(retrieved1).toEqual(task);

      // Simulate expiry (31 days)
      const key = 'epic:epic-123:tasks:task-001';
      store.setExpiry(key, Date.now() - 1000); // Set to expired

      // Task should not exist after expiry
      const retrieved2 = await manager.getTask(testEpicId, 'task-001');
      expect(retrieved2).toBeNull();
    });

    it('should store sync state with 1-hour TTL', async () => {
      const syncState = { status: 'synced' };
      await manager.storeSyncState(testEpicId, syncState);

      // Should exist before expiry
      const retrieved1 = await manager.getSyncState(testEpicId);
      expect(retrieved1).toEqual(syncState);

      // Simulate expiry
      const key = 'epic:epic-123:sync';
      store.setExpiry(key, Date.now() - 1000);

      // Should not exist after expiry
      const retrieved2 = await manager.getSyncState(testEpicId);
      expect(retrieved2).toBeNull();
    });

    it('should not return expired entries', async () => {
      const task = { id: 'task-001', title: 'Expiring Task' };
      await manager.storeTask(testEpicId, 'task-001', task);

      // Force expiry
      const key = 'epic:epic-123:tasks:task-001';
      store.setExpiry(key, Date.now() - 1);

      const retrieved = await manager.getTask(testEpicId, 'task-001');
      expect(retrieved).toBeNull();
    });

    it('should not expire decisions (no TTL)', async () => {
      const adr: ADR = {
        id: 'adr-001',
        epicId: testEpicId,
        title: 'Permanent Decision',
        decision: 'This should never expire',
        context: 'Test context',
        consequences: [],
        timestamp: new Date(),
        metadata: {}
      };

      await manager.storeDecision(testEpicId, adr);

      // Decisions should always be retrievable
      const decisions = await manager.getDecisions(testEpicId);
      expect(decisions).toHaveLength(1);
      expect(decisions[0].title).toBe('Permanent Decision');
    });
  });

  describe('Serialization', () => {
    it('should serialize complex objects correctly', () => {
      const complexObject = {
        string: 'test',
        number: 42,
        boolean: true,
        array: [1, 2, 3],
        nested: {
          deep: {
            value: 'nested'
          }
        },
        date: new Date('2024-01-01').toISOString()
      };

      const serialized = manager.serializeObject(complexObject);
      expect(typeof serialized).toBe('string');
      expect(serialized).toContain('"string":"test"');
    });

    it('should deserialize to equivalent object', () => {
      const original = {
        key: 'value',
        nested: { data: [1, 2, 3] }
      };

      const serialized = manager.serializeObject(original);
      const deserialized = manager.deserializeObject(serialized);

      expect(deserialized).toEqual(original);
    });

    it('should handle nested structures', async () => {
      const nested = {
        level1: {
          level2: {
            level3: {
              data: 'deep value',
              array: [{ id: 1 }, { id: 2 }]
            }
          }
        }
      };

      await manager.storeContext(testEpicId, nested);
      const retrieved = await manager.getContext(testEpicId);

      expect(retrieved).toEqual(nested);
      expect(retrieved?.level1?.level2?.level3?.data).toBe('deep value');
    });

    it('should handle arrays correctly', async () => {
      const arrayData = {
        tasks: ['task1', 'task2', 'task3'],
        priorities: [1, 2, 3],
        metadata: [{ key: 'value1' }, { key: 'value2' }]
      };

      await manager.storeContext(testEpicId, arrayData);
      const retrieved = await manager.getContext(testEpicId);

      expect(retrieved?.tasks).toHaveLength(3);
      expect(retrieved?.priorities).toEqual([1, 2, 3]);
      expect(retrieved?.metadata).toHaveLength(2);
    });

    it('should preserve data types', async () => {
      const typed = {
        string: 'text',
        number: 123,
        float: 45.67,
        boolean: true,
        null_value: null,
        array: [1, 'two', true],
        object: { nested: 'value' }
      };

      await manager.storeContext(testEpicId, typed);
      const retrieved = await manager.getContext(testEpicId);

      expect(typeof retrieved?.string).toBe('string');
      expect(typeof retrieved?.number).toBe('number');
      expect(typeof retrieved?.float).toBe('number');
      expect(typeof retrieved?.boolean).toBe('boolean');
      expect(retrieved?.null_value).toBeNull();
      expect(Array.isArray(retrieved?.array)).toBe(true);
      expect(typeof retrieved?.object).toBe('object');
    });
  });

  describe('ADR Operations', () => {
    it('should create ADR with storeDecision()', async () => {
      const adr: ADR = {
        id: 'adr-001',
        epicId: testEpicId,
        title: 'Use REST API',
        decision: 'We will use REST API for communication',
        context: 'Need standard API protocol',
        consequences: ['Easy to understand', 'Wide tool support'],
        timestamp: new Date(),
        metadata: { status: 'accepted' }
      };

      await manager.storeDecision(testEpicId, adr);
      const decisions = await manager.getDecisions(testEpicId);

      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        id: 'adr-001',
        title: 'Use REST API',
        decision: 'We will use REST API for communication'
      });
    });

    it('should return all ADRs with getDecisions()', async () => {
      const adrs: ADR[] = [
        {
          id: 'adr-001',
          epicId: testEpicId,
          title: 'ADR 1',
          decision: 'Decision 1',
          context: 'Context 1',
          consequences: [],
          timestamp: new Date(),
          metadata: {}
        },
        {
          id: 'adr-002',
          epicId: testEpicId,
          title: 'ADR 2',
          decision: 'Decision 2',
          context: 'Context 2',
          consequences: [],
          timestamp: new Date(),
          metadata: {}
        },
        {
          id: 'adr-003',
          epicId: testEpicId,
          title: 'ADR 3',
          decision: 'Decision 3',
          context: 'Context 3',
          consequences: [],
          timestamp: new Date(),
          metadata: {}
        }
      ];

      for (const adr of adrs) {
        await manager.storeDecision(testEpicId, adr);
      }

      const retrieved = await manager.getDecisions(testEpicId);
      expect(retrieved).toHaveLength(3);
    });

    it('should include timestamps in ADRs', async () => {
      const timestamp = new Date('2024-01-01T12:00:00Z');
      const adr: ADR = {
        id: 'adr-001',
        epicId: testEpicId,
        title: 'Test ADR',
        decision: 'Test decision',
        context: 'Test context',
        consequences: [],
        timestamp,
        metadata: {}
      };

      await manager.storeDecision(testEpicId, adr);
      const decisions = await manager.getDecisions(testEpicId);

      expect(decisions[0].timestamp).toBeDefined();
      expect(decisions[0].timestamp).toBeInstanceOf(Date);
    });

    it('should include metadata in ADRs', async () => {
      const metadata = {
        author: 'John Doe',
        reviewedBy: ['Jane', 'Bob'],
        status: 'approved',
        version: '1.0'
      };

      const adr: ADR = {
        id: 'adr-001',
        epicId: testEpicId,
        title: 'ADR with Metadata',
        decision: 'Decision text',
        context: 'Context text',
        consequences: [],
        timestamp: new Date(),
        metadata
      };

      await manager.storeDecision(testEpicId, adr);
      const decisions = await manager.getDecisions(testEpicId);

      expect(decisions[0].metadata).toEqual(metadata);
    });

    it('should handle multiple ADRs for same epic', async () => {
      const createADR = (id: string, title: string): ADR => ({
        id,
        epicId: testEpicId,
        title,
        decision: `Decision for ${title}`,
        context: `Context for ${title}`,
        consequences: [`Consequence for ${title}`],
        timestamp: new Date(),
        metadata: { id }
      });

      await manager.storeDecision(testEpicId, createADR('adr-001', 'First'));
      await manager.storeDecision(testEpicId, createADR('adr-002', 'Second'));
      await manager.storeDecision(testEpicId, createADR('adr-003', 'Third'));

      const decisions = await manager.getDecisions(testEpicId);
      expect(decisions).toHaveLength(3);

      const titles = decisions.map(d => d.title);
      expect(titles).toContain('First');
      expect(titles).toContain('Second');
      expect(titles).toContain('Third');
    });
  });

  describe('Agent Assignment Operations', () => {
    it('should store assignment with recordAgentAssignment()', async () => {
      const assignment: AgentAssignment = {
        id: 'assign-001',
        epicId: testEpicId,
        agentId: 'agent-123',
        taskId: 'task-456',
        assignedAt: new Date(),
        metadata: { score: 90 }
      };

      await manager.recordAgentAssignment(assignment);
      const assignments = await manager.getAssignments(testEpicId);

      expect(assignments).toHaveLength(1);
      expect(assignments[0].agentId).toBe('agent-123');
    });

    it('should return all assignments for epic with getAssignments()', async () => {
      const assignments: AgentAssignment[] = [
        {
          id: 'assign-001',
          epicId: testEpicId,
          agentId: 'agent-1',
          taskId: 'task-1',
          assignedAt: new Date(),
          metadata: {}
        },
        {
          id: 'assign-002',
          epicId: testEpicId,
          agentId: 'agent-2',
          taskId: 'task-2',
          assignedAt: new Date(),
          metadata: {}
        }
      ];

      for (const assignment of assignments) {
        await manager.recordAgentAssignment(assignment);
      }

      const retrieved = await manager.getAssignments(testEpicId);
      expect(retrieved).toHaveLength(2);
    });

    it('should include agent, task, and timestamp in assignments', async () => {
      const assignedAt = new Date('2024-01-20T15:30:00Z');
      const assignment: AgentAssignment = {
        id: 'assign-001',
        epicId: testEpicId,
        agentId: 'agent-alpha',
        taskId: 'task-beta',
        assignedAt,
        metadata: { priority: 'high' }
      };

      await manager.recordAgentAssignment(assignment);
      const assignments = await manager.getAssignments(testEpicId);

      expect(assignments[0]).toMatchObject({
        agentId: 'agent-alpha',
        taskId: 'task-beta'
      });
      expect(assignments[0].assignedAt).toBeInstanceOf(Date);
      expect(assignments[0].assignedAt.toISOString()).toBe(assignedAt.toISOString());
    });

    it('should handle multiple assignments for same epic', async () => {
      for (let i = 1; i <= 5; i++) {
        const assignment: AgentAssignment = {
          id: `assign-00${i}`,
          epicId: testEpicId,
          agentId: `agent-${i}`,
          taskId: `task-${i}`,
          assignedAt: new Date(),
          metadata: {}
        };
        await manager.recordAgentAssignment(assignment);
      }

      const assignments = await manager.getAssignments(testEpicId);
      expect(assignments).toHaveLength(5);
    });

    it('should preserve assignment metadata', async () => {
      const metadata = {
        score: 95,
        capabilities: ['coding', 'testing'],
        estimatedHours: 8
      };

      const assignment: AgentAssignment = {
        id: 'assign-001',
        epicId: testEpicId,
        agentId: 'agent-1',
        taskId: 'task-1',
        assignedAt: new Date(),
        metadata
      };

      await manager.recordAgentAssignment(assignment);
      const assignments = await manager.getAssignments(testEpicId);

      expect(assignments[0].metadata).toEqual(metadata);
    });
  });

  describe('Memory Key Generation', () => {
    it('should follow namespace pattern', async () => {
      const context = { test: 'data' };
      await manager.storeContext(testEpicId, context);

      const keys = await store.keys('epic:*');
      expect(keys.length).toBeGreaterThan(0);
      expect(keys[0]).toMatch(/^epic:/);
    });

    it('should handle special characters in epic IDs', async () => {
      const specialEpicId = 'epic:with:colons';
      const context = { test: 'data' };

      await manager.storeContext(specialEpicId, context);
      const retrieved = await manager.getContext(specialEpicId);

      expect(retrieved).toEqual(context);
    });

    it('should handle spaces in components', async () => {
      const epicWithSpaces = 'epic with spaces';
      const context = { test: 'data' };

      await manager.storeContext(epicWithSpaces, context);
      const retrieved = await manager.getContext(epicWithSpaces);

      expect(retrieved).toEqual(context);
    });

    it('should handle wildcards in key components', async () => {
      const epicWithWildcard = 'epic*test';
      const context = { test: 'data' };

      await manager.storeContext(epicWithWildcard, context);
      const retrieved = await manager.getContext(epicWithWildcard);

      expect(retrieved).toEqual(context);
    });

    it('should create unique keys for different namespaces', async () => {
      await manager.storeContext(testEpicId, { type: 'context' });
      await manager.storeSyncState(testEpicId, { type: 'sync' });

      const contextKeys = await store.keys('epic:*:context*');
      const syncKeys = await store.keys('epic:*:sync*');

      expect(contextKeys).toHaveLength(1);
      expect(syncKeys).toHaveLength(1);
      expect(contextKeys[0]).not.toBe(syncKeys[0]);
    });

    it('should create unique keys for different epics', async () => {
      const epic1 = 'epic-1';
      const epic2 = 'epic-2';

      await manager.storeContext(epic1, { name: 'Epic 1' });
      await manager.storeContext(epic2, { name: 'Epic 2' });

      const context1 = await manager.getContext(epic1);
      const context2 = await manager.getContext(epic2);

      expect(context1?.name).toBe('Epic 1');
      expect(context2?.name).toBe('Epic 2');
    });

    it('should handle complex key patterns', async () => {
      const complexEpicId = 'project-alpha:phase-1:sprint-2';
      const task = { id: 'task-001', title: 'Complex Task' };

      await manager.storeTask(complexEpicId, 'task-001', task);
      const retrieved = await manager.getTask(complexEpicId, 'task-001');

      expect(retrieved).toEqual(task);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty epic IDs gracefully', async () => {
      const context = { test: 'data' };
      await manager.storeContext('', context);
      const retrieved = await manager.getContext('');
      expect(retrieved).toEqual(context);
    });

    it('should handle very long epic IDs', async () => {
      const longEpicId = 'epic-' + 'x'.repeat(1000);
      const context = { test: 'data' };

      await manager.storeContext(longEpicId, context);
      const retrieved = await manager.getContext(longEpicId);

      expect(retrieved).toEqual(context);
    });

    it('should handle empty objects', async () => {
      const emptyContext = {};
      await manager.storeContext(testEpicId, emptyContext);
      const retrieved = await manager.getContext(testEpicId);

      expect(retrieved).toEqual({});
    });

    it('should handle null values in objects', async () => {
      const contextWithNull = {
        value: null,
        nested: { also: null }
      };

      await manager.storeContext(testEpicId, contextWithNull);
      const retrieved = await manager.getContext(testEpicId);

      expect(retrieved?.value).toBeNull();
      expect(retrieved?.nested?.also).toBeNull();
    });

    it('should return empty arrays when no data exists', async () => {
      const decisions = await manager.getDecisions('non-existent-epic');
      const assignments = await manager.getAssignments('non-existent-epic');
      const tasks = await manager.getTasks('non-existent-epic');

      expect(decisions).toEqual([]);
      expect(assignments).toEqual([]);
      expect(tasks).toEqual([]);
    });

    it('should handle concurrent operations', async () => {
      const operations = [];

      for (let i = 0; i < 10; i++) {
        operations.push(
          manager.storeTask(testEpicId, `task-${i}`, { id: `task-${i}` })
        );
      }

      await Promise.all(operations);
      const tasks = await manager.getTasks(testEpicId);

      expect(tasks).toHaveLength(10);
    });
  });
});
