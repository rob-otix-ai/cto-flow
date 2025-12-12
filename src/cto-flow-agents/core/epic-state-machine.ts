/**
 * Epic State Machine
 *
 * Manages the lifecycle state transitions for epics in the CTO-Flow Agent Management system.
 * Enforces valid state transitions, executes transition hooks, and maintains history.
 *
 * State Flow:
 *   UNINITIALIZED → ACTIVE → PAUSED/BLOCKED/REVIEW
 *   PAUSED → ACTIVE/ARCHIVED
 *   BLOCKED → ACTIVE/PAUSED
 *   REVIEW → ACTIVE/COMPLETED
 *   COMPLETED → ARCHIVED
 *   ARCHIVED (terminal state)
 *
 * @module epic-state-machine
 */

/**
 * Epic lifecycle states
 */
export enum EpicState {
  UNINITIALIZED = 'uninitialized',
  ACTIVE = 'active',
  PAUSED = 'paused',
  BLOCKED = 'blocked',
  REVIEW = 'review',
  COMPLETED = 'completed',
  ARCHIVED = 'archived',
}

/**
 * Transition event metadata
 */
export interface TransitionMetadata {
  reason: string;
  triggeredBy?: string;
  additionalData?: Record<string, unknown>;
}

/**
 * State transition record for history
 */
export interface StateTransition {
  timestamp: Date;
  from: EpicState;
  to: EpicState;
  reason: string;
  triggeredBy?: string;
  metadata?: Record<string, unknown>;
  success: boolean;
  error?: string;
}

/**
 * Guard condition function type
 */
export type GuardFunction = (
  currentState: EpicState,
  targetState: EpicState,
  context: Record<string, unknown>
) => boolean | Promise<boolean>;

/**
 * Transition hook function type
 */
export type TransitionHook = (
  transition: StateTransition,
  context: Record<string, unknown>
) => void | Promise<void>;

/**
 * State machine configuration
 */
export interface StateMachineConfig {
  initialState?: EpicState;
  guards?: Map<string, GuardFunction>;
  hooks?: {
    before?: TransitionHook[];
    after?: TransitionHook[];
  };
  maxHistorySize?: number;
}

/**
 * Epic State Machine
 *
 * Manages epic lifecycle state transitions with validation, hooks, and history tracking.
 */
export class EpicStateMachine {
  /**
   * Valid state transitions map
   */
  private static readonly TRANSITIONS: Map<EpicState, EpicState[]> = new Map([
    [EpicState.UNINITIALIZED, [EpicState.ACTIVE]],
    [EpicState.ACTIVE, [EpicState.PAUSED, EpicState.BLOCKED, EpicState.REVIEW]],
    [EpicState.PAUSED, [EpicState.ACTIVE, EpicState.ARCHIVED]],
    [EpicState.BLOCKED, [EpicState.ACTIVE, EpicState.PAUSED]],
    [EpicState.REVIEW, [EpicState.ACTIVE, EpicState.COMPLETED]],
    [EpicState.COMPLETED, [EpicState.ARCHIVED]],
    [EpicState.ARCHIVED, []],
  ]);

  private currentState: EpicState;
  private history: StateTransition[] = [];
  private guards: Map<string, GuardFunction> = new Map();
  private beforeHooks: TransitionHook[] = [];
  private afterHooks: TransitionHook[] = [];
  private maxHistorySize: number;

  /**
   * Creates a new Epic State Machine
   *
   * @param config - State machine configuration
   */
  constructor(config: StateMachineConfig = {}) {
    this.currentState = config.initialState ?? EpicState.UNINITIALIZED;
    this.maxHistorySize = config.maxHistorySize ?? 100;

    if (config.guards) {
      this.guards = new Map(config.guards);
    }

    if (config.hooks?.before) {
      this.beforeHooks = [...config.hooks.before];
    }

    if (config.hooks?.after) {
      this.afterHooks = [...config.hooks.after];
    }
  }

  /**
   * Gets the current state
   */
  getState(): EpicState {
    return this.currentState;
  }

  /**
   * Gets the transition history
   */
  getHistory(): ReadonlyArray<StateTransition> {
    return [...this.history];
  }

  /**
   * Gets the last N transitions
   *
   * @param count - Number of transitions to retrieve
   */
  getRecentHistory(count: number): ReadonlyArray<StateTransition> {
    return this.history.slice(-count);
  }

  /**
   * Checks if a transition is valid
   *
   * @param targetState - Target state to transition to
   * @returns True if transition is allowed
   */
  canTransition(targetState: EpicState): boolean {
    const allowedTransitions = EpicStateMachine.TRANSITIONS.get(this.currentState);
    return allowedTransitions ? allowedTransitions.includes(targetState) : false;
  }

  /**
   * Gets all valid transitions from current state
   */
  getAllowedTransitions(): EpicState[] {
    return EpicStateMachine.TRANSITIONS.get(this.currentState) ?? [];
  }

  /**
   * Checks if the state machine is in a terminal state
   */
  isTerminal(): boolean {
    return this.currentState === EpicState.ARCHIVED;
  }

  /**
   * Registers a guard condition for transitions
   *
   * @param name - Guard identifier
   * @param guardFn - Guard function
   */
  registerGuard(name: string, guardFn: GuardFunction): void {
    this.guards.set(name, guardFn);
  }

  /**
   * Registers a before-transition hook
   *
   * @param hook - Hook function to execute before transitions
   */
  registerBeforeHook(hook: TransitionHook): void {
    this.beforeHooks.push(hook);
  }

  /**
   * Registers an after-transition hook
   *
   * @param hook - Hook function to execute after transitions
   */
  registerAfterHook(hook: TransitionHook): void {
    this.afterHooks.push(hook);
  }

  /**
   * Executes a state transition
   *
   * @param targetState - State to transition to
   * @param metadata - Transition metadata
   * @param context - Additional context for guards and hooks
   * @returns State transition record
   * @throws Error if transition is invalid or fails
   */
  async transition(
    targetState: EpicState,
    metadata: TransitionMetadata,
    context: Record<string, unknown> = {}
  ): Promise<StateTransition> {
    const previousState = this.currentState;

    // Validate transition
    if (!this.canTransition(targetState)) {
      const error = `Invalid transition from ${previousState} to ${targetState}`;
      const failedTransition: StateTransition = {
        timestamp: new Date(),
        from: previousState,
        to: targetState,
        reason: metadata.reason,
        triggeredBy: metadata.triggeredBy,
        metadata: metadata.additionalData,
        success: false,
        error,
      };
      this.addToHistory(failedTransition);
      throw new Error(error);
    }

    // Check terminal state
    if (this.isTerminal()) {
      const error = `Cannot transition from terminal state ${previousState}`;
      const failedTransition: StateTransition = {
        timestamp: new Date(),
        from: previousState,
        to: targetState,
        reason: metadata.reason,
        triggeredBy: metadata.triggeredBy,
        metadata: metadata.additionalData,
        success: false,
        error,
      };
      this.addToHistory(failedTransition);
      throw new Error(error);
    }

    // Create transition record
    const transition: StateTransition = {
      timestamp: new Date(),
      from: previousState,
      to: targetState,
      reason: metadata.reason,
      triggeredBy: metadata.triggeredBy,
      metadata: metadata.additionalData,
      success: false,
    };

    try {
      // Execute guards
      await this.executeGuards(previousState, targetState, context);

      // Execute before hooks
      await this.executeHooks(this.beforeHooks, transition, context);

      // Perform state-specific actions
      await this.executeTransitionActions(targetState, metadata, context);

      // Update state
      this.currentState = targetState;
      transition.success = true;

      // Execute after hooks
      await this.executeHooks(this.afterHooks, transition, context);

      // Record in history
      this.addToHistory(transition);

      return transition;
    } catch (error) {
      transition.success = false;
      transition.error = error instanceof Error ? error.message : String(error);
      this.addToHistory(transition);
      throw error;
    }
  }

  /**
   * Executes guard conditions
   *
   * @param currentState - Current state
   * @param targetState - Target state
   * @param context - Guard context
   * @throws Error if any guard fails
   */
  private async executeGuards(
    currentState: EpicState,
    targetState: EpicState,
    context: Record<string, unknown>
  ): Promise<void> {
    for (const [name, guardFn] of this.guards) {
      const result = await guardFn(currentState, targetState, context);
      if (!result) {
        throw new Error(`Guard '${name}' failed for transition ${currentState} → ${targetState}`);
      }
    }
  }

  /**
   * Executes transition hooks
   *
   * @param hooks - Hooks to execute
   * @param transition - Transition record
   * @param context - Hook context
   */
  private async executeHooks(
    hooks: TransitionHook[],
    transition: StateTransition,
    context: Record<string, unknown>
  ): Promise<void> {
    for (const hook of hooks) {
      await hook(transition, context);
    }
  }

  /**
   * Executes state-specific transition actions
   *
   * @param targetState - State being transitioned to
   * @param metadata - Transition metadata
   * @param context - Action context
   */
  private async executeTransitionActions(
    targetState: EpicState,
    metadata: TransitionMetadata,
    context: Record<string, unknown>
  ): Promise<void> {
    switch (targetState) {
      case EpicState.ACTIVE:
        await this.onActivate(metadata, context);
        break;

      case EpicState.PAUSED:
        await this.onPause(metadata, context);
        break;

      case EpicState.BLOCKED:
        await this.onBlock(metadata, context);
        break;

      case EpicState.REVIEW:
        await this.onReview(metadata, context);
        break;

      case EpicState.COMPLETED:
        await this.onComplete(metadata, context);
        break;

      case EpicState.ARCHIVED:
        await this.onArchive(metadata, context);
        break;
    }
  }

  /**
   * Action executed when transitioning to ACTIVE state
   */
  private async onActivate(
    metadata: TransitionMetadata,
    context: Record<string, unknown>
  ): Promise<void> {
    // Resuming from PAUSED or BLOCKED state
    if (this.currentState === EpicState.PAUSED || this.currentState === EpicState.BLOCKED) {
      // Notify agents to resume work
      if (context.notifyAgents) {
        await (context.notifyAgents as (message: string) => Promise<void>)(
          `Epic reactivated: ${metadata.reason}`
        );
      }
    }

    // Initialize for first activation
    if (this.currentState === EpicState.UNINITIALIZED) {
      if (context.initializeEpic) {
        await (context.initializeEpic as () => Promise<void>)();
      }
    }

    // Update progress tracking
    if (context.updateProgress) {
      await (context.updateProgress as (event: string) => Promise<void>)('epic_activated');
    }
  }

  /**
   * Action executed when transitioning to PAUSED state
   */
  private async onPause(
    metadata: TransitionMetadata,
    context: Record<string, unknown>
  ): Promise<void> {
    // Preserve context
    if (context.preserveContext) {
      await (context.preserveContext as () => Promise<void>)();
    }

    // Notify agents of pause
    if (context.notifyAgents) {
      await (context.notifyAgents as (message: string) => Promise<void>)(
        `Epic paused: ${metadata.reason}`
      );
    }

    // Pause all agent work
    if (context.pauseAgents) {
      await (context.pauseAgents as () => Promise<void>)();
    }

    // Update GitHub labels
    if (context.updateGitHubLabels) {
      await (context.updateGitHubLabels as (labels: string[]) => Promise<void>)(['paused']);
    }
  }

  /**
   * Action executed when transitioning to BLOCKED state
   */
  private async onBlock(
    metadata: TransitionMetadata,
    context: Record<string, unknown>
  ): Promise<void> {
    // Escalate to coordinator
    if (context.escalateToCoordinator) {
      await (context.escalateToCoordinator as (reason: string) => Promise<void>)(metadata.reason);
    }

    // Add blocker label
    if (context.updateGitHubLabels) {
      await (context.updateGitHubLabels as (labels: string[]) => Promise<void>)([
        'blocked',
        'needs-attention',
      ]);
    }

    // Create blocker issue if needed
    if (context.createBlockerIssue && metadata.additionalData?.blockerDetails) {
      await (context.createBlockerIssue as (details: unknown) => Promise<void>)(
        metadata.additionalData.blockerDetails
      );
    }

    // Notify stakeholders
    if (context.notifyStakeholders) {
      await (context.notifyStakeholders as (message: string) => Promise<void>)(
        `Epic blocked: ${metadata.reason}`
      );
    }
  }

  /**
   * Action executed when transitioning to REVIEW state
   */
  private async onReview(
    metadata: TransitionMetadata,
    context: Record<string, unknown>
  ): Promise<void> {
    // Trigger final validation
    if (context.triggerFinalValidation) {
      await (context.triggerFinalValidation as () => Promise<void>)();
    }

    // Request human approval
    if (context.requestHumanApproval) {
      await (context.requestHumanApproval as () => Promise<void>)();
    }

    // Generate completion checklist
    if (context.generateCompletionChecklist) {
      await (context.generateCompletionChecklist as () => Promise<void>)();
    }

    // Update GitHub labels
    if (context.updateGitHubLabels) {
      await (context.updateGitHubLabels as (labels: string[]) => Promise<void>)([
        'in-review',
        'pending-approval',
      ]);
    }
  }

  /**
   * Action executed when transitioning to COMPLETED state
   */
  private async onComplete(
    metadata: TransitionMetadata,
    context: Record<string, unknown>
  ): Promise<void> {
    // Generate completion report
    if (context.generateCompletionReport) {
      await (context.generateCompletionReport as () => Promise<void>)();
    }

    // Calculate final metrics
    if (context.calculateMetrics) {
      await (context.calculateMetrics as () => Promise<void>)();
    }

    // Archive epic context
    if (context.archiveEpicContext) {
      await (context.archiveEpicContext as () => Promise<void>)();
    }

    // Close GitHub issue
    if (context.closeGitHubIssue) {
      await (context.closeGitHubIssue as () => Promise<void>)();
    }

    // Notify stakeholders
    if (context.notifyStakeholders) {
      await (context.notifyStakeholders as (message: string) => Promise<void>)(
        `Epic completed: ${metadata.reason}`
      );
    }

    // Update agent performance metrics
    if (context.updateAgentMetrics) {
      await (context.updateAgentMetrics as () => Promise<void>)();
    }
  }

  /**
   * Action executed when transitioning to ARCHIVED state
   */
  private async onArchive(
    metadata: TransitionMetadata,
    context: Record<string, unknown>
  ): Promise<void> {
    // Move to long-term storage
    if (context.moveToLongTermStorage) {
      await (context.moveToLongTermStorage as () => Promise<void>)();
    }

    // Remove from active epic list
    if (context.removeFromActiveList) {
      await (context.removeFromActiveList as () => Promise<void>)();
    }

    // Archive GitHub issue
    if (context.archiveGitHubIssue) {
      await (context.archiveGitHubIssue as () => Promise<void>)();
    }

    // Generate final analytics
    if (context.generateFinalAnalytics) {
      await (context.generateFinalAnalytics as () => Promise<void>)();
    }
  }

  /**
   * Adds transition to history with size management
   *
   * @param transition - Transition to add
   */
  private addToHistory(transition: StateTransition): void {
    this.history.push(transition);

    // Maintain maximum history size
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }
  }

  /**
   * Serializes the state machine for persistence
   */
  toJSON(): {
    currentState: EpicState;
    history: StateTransition[];
  } {
    return {
      currentState: this.currentState,
      history: this.history,
    };
  }

  /**
   * Restores state machine from serialized data
   *
   * @param data - Serialized state machine data
   * @param config - State machine configuration
   */
  static fromJSON(
    data: { currentState: EpicState; history: StateTransition[] },
    config: StateMachineConfig = {}
  ): EpicStateMachine {
    const machine = new EpicStateMachine({
      ...config,
      initialState: data.currentState,
    });

    // Restore history
    machine.history = data.history.map((t) => ({
      ...t,
      timestamp: new Date(t.timestamp),
    }));

    return machine;
  }

  /**
   * Gets statistics about state transitions
   */
  getStatistics(): {
    totalTransitions: number;
    successfulTransitions: number;
    failedTransitions: number;
    transitionsByState: Map<EpicState, number>;
    averageTimeInState: Map<EpicState, number>;
  } {
    const stats = {
      totalTransitions: this.history.length,
      successfulTransitions: 0,
      failedTransitions: 0,
      transitionsByState: new Map<EpicState, number>(),
      averageTimeInState: new Map<EpicState, number>(),
    };

    const timeInState = new Map<EpicState, number[]>();

    for (let i = 0; i < this.history.length; i++) {
      const transition = this.history[i];

      if (transition.success) {
        stats.successfulTransitions++;
      } else {
        stats.failedTransitions++;
      }

      // Count transitions to each state
      const count = stats.transitionsByState.get(transition.to) ?? 0;
      stats.transitionsByState.set(transition.to, count + 1);

      // Calculate time in state
      if (i > 0 && this.history[i - 1].success) {
        const previousTransition = this.history[i - 1];
        const duration =
          transition.timestamp.getTime() - previousTransition.timestamp.getTime();

        const durations = timeInState.get(previousTransition.to) ?? [];
        durations.push(duration);
        timeInState.set(previousTransition.to, durations);
      }
    }

    // Calculate averages
    for (const [state, durations] of timeInState) {
      const average = durations.reduce((sum, d) => sum + d, 0) / durations.length;
      stats.averageTimeInState.set(state, average);
    }

    return stats;
  }
}
