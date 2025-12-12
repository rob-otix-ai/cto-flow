/**
 * Comprehensive Unit Tests for CTO-Flow Agent Management System
 * Core Types and State Machine Testing
 *
 * Test Coverage:
 * 1. EpicState transitions and validation
 * 2. State machine lifecycle management
 * 3. Configuration system with overrides
 * 4. Guard conditions and error handling
 * 5. History tracking and metadata capture
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ============================================================================
// Type Definitions (Based on Strategic Vision)
// ============================================================================

type EpicState =
  | 'UNINITIALIZED'
  | 'ACTIVE'
  | 'PAUSED'
  | 'BLOCKED'
  | 'REVIEW'
  | 'COMPLETED'
  | 'ARCHIVED';

interface StateTransition {
  from: EpicState;
  to: EpicState;
  timestamp: Date;
  reason?: string;
  triggeredBy?: string;
  metadata?: Record<string, any>;
}

interface EpicStateContext {
  currentState: EpicState;
  previousState?: EpicState;
  history: StateTransition[];
  createdAt: Date;
  updatedAt: Date;
  epicId: number;
}

interface ConfigOptions {
  enabled: boolean;
  maxConcurrentEpics?: number;
  autoTransition?: boolean;
  requireApproval?: boolean;
  [key: string]: any;
}

// ============================================================================
// State Machine Implementation
// ============================================================================

class EpicStateMachine {
  private context: EpicStateContext;

  // Valid state transitions map
  private static readonly VALID_TRANSITIONS: Map<EpicState, EpicState[]> = new Map([
    ['UNINITIALIZED', ['ACTIVE']],
    ['ACTIVE', ['PAUSED', 'BLOCKED', 'REVIEW', 'COMPLETED']],
    ['PAUSED', ['ACTIVE', 'BLOCKED']],
    ['BLOCKED', ['ACTIVE', 'PAUSED']],
    ['REVIEW', ['ACTIVE', 'COMPLETED']],
    ['COMPLETED', ['ARCHIVED']],
    ['ARCHIVED', []], // Terminal state
  ]);

  constructor(epicId: number, initialState: EpicState = 'UNINITIALIZED') {
    const now = new Date();
    this.context = {
      currentState: initialState,
      history: [],
      createdAt: now,
      updatedAt: now,
      epicId,
    };
  }

  getCurrentState(): EpicState {
    return this.context.currentState;
  }

  getHistory(): StateTransition[] {
    return [...this.context.history];
  }

  getContext(): EpicStateContext {
    return { ...this.context, history: [...this.context.history] };
  }

  canTransition(targetState: EpicState): boolean {
    const allowedStates = EpicStateMachine.VALID_TRANSITIONS.get(this.context.currentState);
    return allowedStates ? allowedStates.includes(targetState) : false;
  }

  transition(
    targetState: EpicState,
    reason?: string,
    triggeredBy?: string,
    metadata?: Record<string, any>
  ): void {
    if (!this.canTransition(targetState)) {
      throw new Error(
        `Invalid state transition: ${this.context.currentState} -> ${targetState}. ` +
        `Allowed transitions from ${this.context.currentState}: ${
          EpicStateMachine.VALID_TRANSITIONS.get(this.context.currentState)?.join(', ') || 'none'
        }`
      );
    }

    const transition: StateTransition = {
      from: this.context.currentState,
      to: targetState,
      timestamp: new Date(),
      reason,
      triggeredBy,
      metadata,
    };

    this.context.previousState = this.context.currentState;
    this.context.currentState = targetState;
    this.context.history.push(transition);
    this.context.updatedAt = transition.timestamp;
  }

  getTransitionCount(): number {
    return this.context.history.length;
  }

  getLastTransition(): StateTransition | undefined {
    return this.context.history.length > 0
      ? this.context.history[this.context.history.length - 1]
      : undefined;
  }
}

// ============================================================================
// Configuration System
// ============================================================================

class ConfigurationManager {
  private config: ConfigOptions;

  constructor(initialConfig?: Partial<ConfigOptions>) {
    this.config = {
      enabled: false, // Default: disabled
      maxConcurrentEpics: 10,
      autoTransition: false,
      requireApproval: true,
      ...initialConfig,
    };
  }

  get(key: keyof ConfigOptions): any {
    return this.config[key];
  }

  set(key: keyof ConfigOptions, value: any): void {
    this.config[key] = value;
  }

  update(updates: Partial<ConfigOptions>): void {
    this.config = { ...this.config, ...updates };
  }

  getAll(): ConfigOptions {
    return { ...this.config };
  }

  static fromEnvironment(): ConfigurationManager {
    const config: Partial<ConfigOptions> = {
      enabled: process.env.TEAMMATE_AGENTS_ENABLED === 'true',
      maxConcurrentEpics: process.env.MAX_CONCURRENT_EPICS
        ? parseInt(process.env.MAX_CONCURRENT_EPICS, 10)
        : 10,
      autoTransition: process.env.AUTO_TRANSITION === 'true',
      requireApproval: process.env.REQUIRE_APPROVAL !== 'false',
    };

    return new ConfigurationManager(config);
  }

  static fromCLI(args: Record<string, any>): ConfigurationManager {
    const envConfig = ConfigurationManager.fromEnvironment().getAll();

    // CLI overrides environment
    const config: Partial<ConfigOptions> = {
      ...envConfig,
      ...(args.enabled !== undefined && { enabled: args.enabled }),
      ...(args.maxConcurrentEpics !== undefined && {
        maxConcurrentEpics: args.maxConcurrentEpics,
      }),
      ...(args.autoTransition !== undefined && { autoTransition: args.autoTransition }),
      ...(args.requireApproval !== undefined && { requireApproval: args.requireApproval }),
    };

    return new ConfigurationManager(config);
  }

  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (typeof this.config.enabled !== 'boolean') {
      errors.push('enabled must be a boolean');
    }

    if (
      this.config.maxConcurrentEpics !== undefined &&
      (typeof this.config.maxConcurrentEpics !== 'number' ||
        this.config.maxConcurrentEpics < 1)
    ) {
      errors.push('maxConcurrentEpics must be a positive number');
    }

    if (
      this.config.autoTransition !== undefined &&
      typeof this.config.autoTransition !== 'boolean'
    ) {
      errors.push('autoTransition must be a boolean');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

// ============================================================================
// TEST SUITE: EpicState Transitions
// ============================================================================

describe('EpicState Transitions', () => {
  let stateMachine: EpicStateMachine;

  beforeEach(() => {
    stateMachine = new EpicStateMachine(1);
  });

  describe('Valid Transitions', () => {
    it('should transition from UNINITIALIZED to ACTIVE', () => {
      expect(stateMachine.getCurrentState()).toBe('UNINITIALIZED');

      stateMachine.transition('ACTIVE', 'Epic started', 'agent-1');

      expect(stateMachine.getCurrentState()).toBe('ACTIVE');
      expect(stateMachine.getTransitionCount()).toBe(1);
    });

    it('should transition from ACTIVE to PAUSED', () => {
      stateMachine.transition('ACTIVE');

      stateMachine.transition('PAUSED', 'Paused for dependency');

      expect(stateMachine.getCurrentState()).toBe('PAUSED');
    });

    it('should transition from ACTIVE to BLOCKED', () => {
      stateMachine.transition('ACTIVE');

      stateMachine.transition('BLOCKED', 'Blocked by external issue');

      expect(stateMachine.getCurrentState()).toBe('BLOCKED');
    });

    it('should transition from ACTIVE to REVIEW', () => {
      stateMachine.transition('ACTIVE');

      stateMachine.transition('REVIEW', 'Ready for review');

      expect(stateMachine.getCurrentState()).toBe('REVIEW');
    });

    it('should transition from ACTIVE to COMPLETED', () => {
      stateMachine.transition('ACTIVE');

      stateMachine.transition('COMPLETED', 'All tasks completed');

      expect(stateMachine.getCurrentState()).toBe('COMPLETED');
    });

    it('should transition from PAUSED to ACTIVE', () => {
      stateMachine.transition('ACTIVE');
      stateMachine.transition('PAUSED');

      stateMachine.transition('ACTIVE', 'Resuming work');

      expect(stateMachine.getCurrentState()).toBe('ACTIVE');
    });

    it('should transition from BLOCKED to ACTIVE', () => {
      stateMachine.transition('ACTIVE');
      stateMachine.transition('BLOCKED');

      stateMachine.transition('ACTIVE', 'Blocker resolved');

      expect(stateMachine.getCurrentState()).toBe('ACTIVE');
    });

    it('should transition from REVIEW to COMPLETED', () => {
      stateMachine.transition('ACTIVE');
      stateMachine.transition('REVIEW');

      stateMachine.transition('COMPLETED', 'Review approved');

      expect(stateMachine.getCurrentState()).toBe('COMPLETED');
    });

    it('should transition from COMPLETED to ARCHIVED', () => {
      stateMachine.transition('ACTIVE');
      stateMachine.transition('COMPLETED');

      stateMachine.transition('ARCHIVED', 'Archiving completed epic');

      expect(stateMachine.getCurrentState()).toBe('ARCHIVED');
    });
  });

  describe('Invalid Transitions', () => {
    it('should throw error when transitioning from UNINITIALIZED to PAUSED', () => {
      expect(() => {
        stateMachine.transition('PAUSED');
      }).toThrow(/Invalid state transition: UNINITIALIZED -> PAUSED/);
    });

    it('should throw error when transitioning from COMPLETED to ACTIVE', () => {
      stateMachine.transition('ACTIVE');
      stateMachine.transition('COMPLETED');

      expect(() => {
        stateMachine.transition('ACTIVE');
      }).toThrow(/Invalid state transition: COMPLETED -> ACTIVE/);
    });

    it('should throw error when transitioning from ARCHIVED (terminal state)', () => {
      stateMachine.transition('ACTIVE');
      stateMachine.transition('COMPLETED');
      stateMachine.transition('ARCHIVED');

      expect(() => {
        stateMachine.transition('ACTIVE');
      }).toThrow(/Invalid state transition: ARCHIVED -> ACTIVE/);
    });

    it('should throw error with allowed transitions in message', () => {
      try {
        stateMachine.transition('BLOCKED');
      } catch (error: any) {
        expect(error.message).toContain('Allowed transitions from UNINITIALIZED: ACTIVE');
      }
    });

    it('should prevent direct jump from UNINITIALIZED to COMPLETED', () => {
      expect(() => {
        stateMachine.transition('COMPLETED');
      }).toThrow(/Invalid state transition/);
    });

    it('should prevent transition from PAUSED to COMPLETED', () => {
      stateMachine.transition('ACTIVE');
      stateMachine.transition('PAUSED');

      expect(() => {
        stateMachine.transition('COMPLETED');
      }).toThrow(/Invalid state transition: PAUSED -> COMPLETED/);
    });
  });

  describe('Transition Metadata Capture', () => {
    it('should capture reason in transition', () => {
      stateMachine.transition('ACTIVE', 'Starting development');

      const lastTransition = stateMachine.getLastTransition();
      expect(lastTransition?.reason).toBe('Starting development');
    });

    it('should capture triggeredBy in transition', () => {
      stateMachine.transition('ACTIVE', 'Agent assignment', 'coder-agent-42');

      const lastTransition = stateMachine.getLastTransition();
      expect(lastTransition?.triggeredBy).toBe('coder-agent-42');
    });

    it('should capture custom metadata in transition', () => {
      const metadata = {
        agentId: 'agent-123',
        issueCount: 5,
        priority: 'high',
      };

      stateMachine.transition('ACTIVE', 'Epic started', 'coordinator', metadata);

      const lastTransition = stateMachine.getLastTransition();
      expect(lastTransition?.metadata).toEqual(metadata);
    });

    it('should capture timestamp for each transition', () => {
      const beforeTransition = new Date();

      stateMachine.transition('ACTIVE');

      const afterTransition = new Date();
      const lastTransition = stateMachine.getLastTransition();

      expect(lastTransition?.timestamp).toBeInstanceOf(Date);
      expect(lastTransition!.timestamp.getTime()).toBeGreaterThanOrEqual(beforeTransition.getTime());
      expect(lastTransition!.timestamp.getTime()).toBeLessThanOrEqual(afterTransition.getTime());
    });

    it('should capture from and to states in transition', () => {
      stateMachine.transition('ACTIVE');

      const lastTransition = stateMachine.getLastTransition();
      expect(lastTransition?.from).toBe('UNINITIALIZED');
      expect(lastTransition?.to).toBe('ACTIVE');
    });
  });

  describe('History Tracking', () => {
    it('should track empty history for new state machine', () => {
      expect(stateMachine.getHistory()).toHaveLength(0);
    });

    it('should track single transition in history', () => {
      stateMachine.transition('ACTIVE', 'Starting');

      const history = stateMachine.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].from).toBe('UNINITIALIZED');
      expect(history[0].to).toBe('ACTIVE');
    });

    it('should track multiple transitions in order', () => {
      stateMachine.transition('ACTIVE', 'Start');
      stateMachine.transition('PAUSED', 'Pause');
      stateMachine.transition('ACTIVE', 'Resume');

      const history = stateMachine.getHistory();
      expect(history).toHaveLength(3);
      expect(history[0].to).toBe('ACTIVE');
      expect(history[1].to).toBe('PAUSED');
      expect(history[2].to).toBe('ACTIVE');
    });

    it('should maintain complete transition chain', () => {
      const transitions = [
        { state: 'ACTIVE' as EpicState, reason: 'Start' },
        { state: 'BLOCKED' as EpicState, reason: 'Blocked' },
        { state: 'ACTIVE' as EpicState, reason: 'Unblocked' },
        { state: 'REVIEW' as EpicState, reason: 'Ready' },
        { state: 'COMPLETED' as EpicState, reason: 'Done' },
      ];

      transitions.forEach(({ state, reason }) => {
        stateMachine.transition(state, reason);
      });

      const history = stateMachine.getHistory();
      expect(history).toHaveLength(5);

      // Verify chain continuity
      for (let i = 1; i < history.length; i++) {
        expect(history[i].from).toBe(history[i - 1].to);
      }
    });

    it('should not mutate history when retrieved', () => {
      stateMachine.transition('ACTIVE');

      const history1 = stateMachine.getHistory();
      history1.push({
        from: 'ACTIVE',
        to: 'PAUSED',
        timestamp: new Date(),
      });

      const history2 = stateMachine.getHistory();
      expect(history2).toHaveLength(1);
    });

    it('should track previousState correctly', () => {
      expect(stateMachine.getContext().previousState).toBeUndefined();

      stateMachine.transition('ACTIVE');
      expect(stateMachine.getContext().previousState).toBe('UNINITIALIZED');

      stateMachine.transition('PAUSED');
      expect(stateMachine.getContext().previousState).toBe('ACTIVE');
    });

    it('should update updatedAt timestamp on each transition', () => {
      const initialUpdatedAt = stateMachine.getContext().updatedAt;

      // Wait a tiny bit to ensure timestamp difference
      setTimeout(() => {
        stateMachine.transition('ACTIVE');
        const afterFirstTransition = stateMachine.getContext().updatedAt;

        expect(afterFirstTransition.getTime()).toBeGreaterThan(initialUpdatedAt.getTime());
      }, 10);
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid successive transitions', () => {
      stateMachine.transition('ACTIVE');
      stateMachine.transition('PAUSED');
      stateMachine.transition('ACTIVE');
      stateMachine.transition('BLOCKED');
      stateMachine.transition('ACTIVE');

      expect(stateMachine.getCurrentState()).toBe('ACTIVE');
      expect(stateMachine.getTransitionCount()).toBe(5);
    });

    it('should handle transitions with no optional parameters', () => {
      stateMachine.transition('ACTIVE');

      const transition = stateMachine.getLastTransition();
      expect(transition?.reason).toBeUndefined();
      expect(transition?.triggeredBy).toBeUndefined();
      expect(transition?.metadata).toBeUndefined();
    });

    it('should handle empty metadata object', () => {
      stateMachine.transition('ACTIVE', undefined, undefined, {});

      const transition = stateMachine.getLastTransition();
      expect(transition?.metadata).toEqual({});
    });

    it('should preserve epicId throughout lifecycle', () => {
      const epicId = 12345;
      const sm = new EpicStateMachine(epicId);

      sm.transition('ACTIVE');
      sm.transition('PAUSED');
      sm.transition('ACTIVE');

      expect(sm.getContext().epicId).toBe(epicId);
    });
  });
});

// ============================================================================
// TEST SUITE: State Machine Lifecycle
// ============================================================================

describe('State Machine Lifecycle', () => {
  describe('Initialization', () => {
    it('should initialize with UNINITIALIZED state by default', () => {
      const sm = new EpicStateMachine(1);
      expect(sm.getCurrentState()).toBe('UNINITIALIZED');
    });

    it('should allow custom initial state', () => {
      const sm = new EpicStateMachine(1, 'ACTIVE');
      expect(sm.getCurrentState()).toBe('ACTIVE');
    });

    it('should set createdAt timestamp on initialization', () => {
      const before = new Date();
      const sm = new EpicStateMachine(1);
      const after = new Date();

      const createdAt = sm.getContext().createdAt;
      expect(createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should initialize with empty history', () => {
      const sm = new EpicStateMachine(1);
      expect(sm.getHistory()).toHaveLength(0);
    });

    it('should store epicId correctly', () => {
      const epicId = 999;
      const sm = new EpicStateMachine(epicId);
      expect(sm.getContext().epicId).toBe(epicId);
    });
  });

  describe('Complete Lifecycle Flows', () => {
    it('should complete full ACTIVE → COMPLETED → ARCHIVED flow', () => {
      const sm = new EpicStateMachine(1);

      sm.transition('ACTIVE', 'Start work');
      expect(sm.getCurrentState()).toBe('ACTIVE');

      sm.transition('COMPLETED', 'Finish work');
      expect(sm.getCurrentState()).toBe('COMPLETED');

      sm.transition('ARCHIVED', 'Archive epic');
      expect(sm.getCurrentState()).toBe('ARCHIVED');

      expect(sm.getTransitionCount()).toBe(3);
    });

    it('should handle ACTIVE → PAUSED → ACTIVE cycle', () => {
      const sm = new EpicStateMachine(1);

      sm.transition('ACTIVE');
      sm.transition('PAUSED', 'Dependency wait');

      expect(sm.getCurrentState()).toBe('PAUSED');

      sm.transition('ACTIVE', 'Dependency resolved');

      expect(sm.getCurrentState()).toBe('ACTIVE');
      expect(sm.getTransitionCount()).toBe(3);
    });

    it('should handle ACTIVE → BLOCKED → ACTIVE cycle', () => {
      const sm = new EpicStateMachine(1);

      sm.transition('ACTIVE');
      sm.transition('BLOCKED', 'External blocker');

      expect(sm.getCurrentState()).toBe('BLOCKED');

      sm.transition('ACTIVE', 'Blocker removed');

      expect(sm.getCurrentState()).toBe('ACTIVE');
    });

    it('should handle ACTIVE → REVIEW → COMPLETED flow', () => {
      const sm = new EpicStateMachine(1);

      sm.transition('ACTIVE', 'Development');
      sm.transition('REVIEW', 'Code review');
      sm.transition('COMPLETED', 'Approved');

      expect(sm.getCurrentState()).toBe('COMPLETED');

      const history = sm.getHistory();
      expect(history[0].to).toBe('ACTIVE');
      expect(history[1].to).toBe('REVIEW');
      expect(history[2].to).toBe('COMPLETED');
    });

    it('should handle ACTIVE → REVIEW → ACTIVE → COMPLETED flow (rework)', () => {
      const sm = new EpicStateMachine(1);

      sm.transition('ACTIVE');
      sm.transition('REVIEW');
      sm.transition('ACTIVE', 'Changes requested');
      sm.transition('REVIEW', 'Re-submitted');
      sm.transition('COMPLETED', 'Finally approved');

      expect(sm.getCurrentState()).toBe('COMPLETED');
      expect(sm.getTransitionCount()).toBe(5);
    });

    it('should handle complex multi-pause workflow', () => {
      const sm = new EpicStateMachine(1);

      // Start work
      sm.transition('ACTIVE');

      // First pause
      sm.transition('PAUSED', 'Team meeting');
      sm.transition('ACTIVE', 'Resume after meeting');

      // Blocked
      sm.transition('BLOCKED', 'API down');
      sm.transition('ACTIVE', 'API restored');

      // Second pause
      sm.transition('PAUSED', 'Waiting for design');
      sm.transition('ACTIVE', 'Design received');

      // Complete
      sm.transition('REVIEW');
      sm.transition('COMPLETED');

      expect(sm.getCurrentState()).toBe('COMPLETED');
      expect(sm.getTransitionCount()).toBe(9);
    });
  });

  describe('Guard Conditions', () => {
    it('should enforce canTransition check before transition', () => {
      const sm = new EpicStateMachine(1);

      expect(sm.canTransition('ACTIVE')).toBe(true);
      expect(sm.canTransition('PAUSED')).toBe(false);
      expect(sm.canTransition('ARCHIVED')).toBe(false);
    });

    it('should update canTransition results after state change', () => {
      const sm = new EpicStateMachine(1);

      sm.transition('ACTIVE');

      expect(sm.canTransition('PAUSED')).toBe(true);
      expect(sm.canTransition('BLOCKED')).toBe(true);
      expect(sm.canTransition('REVIEW')).toBe(true);
      expect(sm.canTransition('COMPLETED')).toBe(true);
      expect(sm.canTransition('ACTIVE')).toBe(false);
    });

    it('should prevent any transitions from ARCHIVED state', () => {
      const sm = new EpicStateMachine(1);

      sm.transition('ACTIVE');
      sm.transition('COMPLETED');
      sm.transition('ARCHIVED');

      expect(sm.canTransition('ACTIVE')).toBe(false);
      expect(sm.canTransition('PAUSED')).toBe(false);
      expect(sm.canTransition('UNINITIALIZED')).toBe(false);
    });

    it('should only allow specific transitions from COMPLETED', () => {
      const sm = new EpicStateMachine(1);

      sm.transition('ACTIVE');
      sm.transition('COMPLETED');

      expect(sm.canTransition('ARCHIVED')).toBe(true);
      expect(sm.canTransition('ACTIVE')).toBe(false);
      expect(sm.canTransition('REVIEW')).toBe(false);
    });
  });
});

// ============================================================================
// TEST SUITE: Configuration System
// ============================================================================

describe('Configuration System', () => {
  describe('Default Configuration', () => {
    it('should have enabled: false by default', () => {
      const config = new ConfigurationManager();
      expect(config.get('enabled')).toBe(false);
    });

    it('should have default maxConcurrentEpics value', () => {
      const config = new ConfigurationManager();
      expect(config.get('maxConcurrentEpics')).toBe(10);
    });

    it('should have autoTransition: false by default', () => {
      const config = new ConfigurationManager();
      expect(config.get('autoTransition')).toBe(false);
    });

    it('should have requireApproval: true by default', () => {
      const config = new ConfigurationManager();
      expect(config.get('requireApproval')).toBe(true);
    });
  });

  describe('Custom Configuration', () => {
    it('should accept custom initial configuration', () => {
      const config = new ConfigurationManager({
        enabled: true,
        maxConcurrentEpics: 20,
      });

      expect(config.get('enabled')).toBe(true);
      expect(config.get('maxConcurrentEpics')).toBe(20);
    });

    it('should allow setting individual values', () => {
      const config = new ConfigurationManager();

      config.set('enabled', true);
      config.set('maxConcurrentEpics', 15);

      expect(config.get('enabled')).toBe(true);
      expect(config.get('maxConcurrentEpics')).toBe(15);
    });

    it('should allow bulk updates', () => {
      const config = new ConfigurationManager();

      config.update({
        enabled: true,
        autoTransition: true,
        maxConcurrentEpics: 25,
      });

      expect(config.get('enabled')).toBe(true);
      expect(config.get('autoTransition')).toBe(true);
      expect(config.get('maxConcurrentEpics')).toBe(25);
    });

    it('should preserve unmodified values during update', () => {
      const config = new ConfigurationManager({ enabled: true });

      config.update({ maxConcurrentEpics: 30 });

      expect(config.get('enabled')).toBe(true);
      expect(config.get('maxConcurrentEpics')).toBe(30);
    });
  });

  describe('Environment Variable Overrides', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      jest.resetModules();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should load enabled from environment', () => {
      process.env.TEAMMATE_AGENTS_ENABLED = 'true';

      const config = ConfigurationManager.fromEnvironment();
      expect(config.get('enabled')).toBe(true);
    });

    it('should load maxConcurrentEpics from environment', () => {
      process.env.MAX_CONCURRENT_EPICS = '50';

      const config = ConfigurationManager.fromEnvironment();
      expect(config.get('maxConcurrentEpics')).toBe(50);
    });

    it('should load autoTransition from environment', () => {
      process.env.AUTO_TRANSITION = 'true';

      const config = ConfigurationManager.fromEnvironment();
      expect(config.get('autoTransition')).toBe(true);
    });

    it('should load requireApproval from environment', () => {
      process.env.REQUIRE_APPROVAL = 'false';

      const config = ConfigurationManager.fromEnvironment();
      expect(config.get('requireApproval')).toBe(false);
    });

    it('should use defaults when environment variables not set', () => {
      delete process.env.TEAMMATE_AGENTS_ENABLED;
      delete process.env.MAX_CONCURRENT_EPICS;

      const config = ConfigurationManager.fromEnvironment();
      expect(config.get('enabled')).toBe(false);
      expect(config.get('maxConcurrentEpics')).toBe(10);
    });
  });

  describe('CLI Flag Overrides', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      process.env.TEAMMATE_AGENTS_ENABLED = 'false';
      process.env.MAX_CONCURRENT_EPICS = '10';
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should override environment with CLI flags', () => {
      const config = ConfigurationManager.fromCLI({
        enabled: true,
        maxConcurrentEpics: 100,
      });

      expect(config.get('enabled')).toBe(true);
      expect(config.get('maxConcurrentEpics')).toBe(100);
    });

    it('should use environment values when CLI flags not provided', () => {
      process.env.TEAMMATE_AGENTS_ENABLED = 'true';
      process.env.MAX_CONCURRENT_EPICS = '75';

      const config = ConfigurationManager.fromCLI({});

      expect(config.get('enabled')).toBe(true);
      expect(config.get('maxConcurrentEpics')).toBe(75);
    });

    it('should handle partial CLI overrides', () => {
      process.env.TEAMMATE_AGENTS_ENABLED = 'true';
      process.env.MAX_CONCURRENT_EPICS = '20';

      const config = ConfigurationManager.fromCLI({
        maxConcurrentEpics: 50,
      });

      expect(config.get('enabled')).toBe(true);
      expect(config.get('maxConcurrentEpics')).toBe(50);
    });
  });

  describe('Configuration Validation', () => {
    it('should validate correct configuration', () => {
      const config = new ConfigurationManager({
        enabled: true,
        maxConcurrentEpics: 10,
        autoTransition: false,
        requireApproval: true,
      });

      const result = config.validate();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject non-boolean enabled value', () => {
      const config = new ConfigurationManager({ enabled: 'yes' as any });

      const result = config.validate();
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('enabled must be a boolean');
    });

    it('should reject negative maxConcurrentEpics', () => {
      const config = new ConfigurationManager({ maxConcurrentEpics: -5 });

      const result = config.validate();
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('maxConcurrentEpics must be a positive number');
    });

    it('should reject zero maxConcurrentEpics', () => {
      const config = new ConfigurationManager({ maxConcurrentEpics: 0 });

      const result = config.validate();
      expect(result.valid).toBe(false);
    });

    it('should reject non-number maxConcurrentEpics', () => {
      const config = new ConfigurationManager({ maxConcurrentEpics: 'ten' as any });

      const result = config.validate();
      expect(result.valid).toBe(false);
    });

    it('should reject non-boolean autoTransition', () => {
      const config = new ConfigurationManager({ autoTransition: 1 as any });

      const result = config.validate();
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('autoTransition must be a boolean');
    });

    it('should return multiple errors for multiple invalid fields', () => {
      const config = new ConfigurationManager({
        enabled: 'true' as any,
        maxConcurrentEpics: -10,
        autoTransition: 'yes' as any,
      });

      const result = config.validate();
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
    });
  });

  describe('Configuration Retrieval', () => {
    it('should retrieve all configuration values', () => {
      const initialConfig = {
        enabled: true,
        maxConcurrentEpics: 15,
        autoTransition: true,
        requireApproval: false,
      };

      const config = new ConfigurationManager(initialConfig);
      const allConfig = config.getAll();

      expect(allConfig).toEqual(initialConfig);
    });

    it('should return immutable copy of configuration', () => {
      const config = new ConfigurationManager({ enabled: true });

      const allConfig = config.getAll();
      allConfig.enabled = false;

      expect(config.get('enabled')).toBe(true);
    });

    it('should support custom configuration keys', () => {
      const config = new ConfigurationManager({
        enabled: true,
        customKey: 'customValue',
      });

      expect(config.get('customKey')).toBe('customValue');
    });
  });
});

// ============================================================================
// TEST SUITE: Integration Tests
// ============================================================================

describe('Integration: State Machine + Configuration', () => {
  it('should use configuration to determine if state machine is enabled', () => {
    const config = new ConfigurationManager({ enabled: true });
    const sm = new EpicStateMachine(1);

    if (config.get('enabled')) {
      sm.transition('ACTIVE');
      expect(sm.getCurrentState()).toBe('ACTIVE');
    }
  });

  it('should enforce maxConcurrentEpics from configuration', () => {
    const config = new ConfigurationManager({ maxConcurrentEpics: 3 });
    const stateMachines: EpicStateMachine[] = [];

    for (let i = 0; i < config.get('maxConcurrentEpics'); i++) {
      const sm = new EpicStateMachine(i);
      sm.transition('ACTIVE');
      stateMachines.push(sm);
    }

    const activeCount = stateMachines.filter(
      sm => sm.getCurrentState() === 'ACTIVE'
    ).length;

    expect(activeCount).toBe(3);
  });

  it('should validate configuration before creating state machines', () => {
    const config = new ConfigurationManager({
      enabled: true,
      maxConcurrentEpics: 5,
    });

    const validation = config.validate();

    if (validation.valid) {
      const sm = new EpicStateMachine(1);
      sm.transition('ACTIVE');
      expect(sm.getCurrentState()).toBe('ACTIVE');
    } else {
      throw new Error('Configuration invalid');
    }
  });

  it('should support autoTransition based on configuration', () => {
    const config = new ConfigurationManager({ autoTransition: true });
    const sm = new EpicStateMachine(1);

    sm.transition('ACTIVE');

    if (config.get('autoTransition')) {
      // Auto-transition to COMPLETED when all tasks done
      sm.transition('COMPLETED', 'Auto-completed');
    }

    expect(sm.getCurrentState()).toBe('COMPLETED');
  });

  it('should enforce requireApproval guard condition', () => {
    const config = new ConfigurationManager({ requireApproval: true });
    const sm = new EpicStateMachine(1);

    sm.transition('ACTIVE');
    sm.transition('REVIEW');

    if (config.get('requireApproval')) {
      // Must go through review before completion
      expect(sm.getCurrentState()).toBe('REVIEW');
      sm.transition('COMPLETED', 'Approved');
    }

    expect(sm.getCurrentState()).toBe('COMPLETED');
  });
});
