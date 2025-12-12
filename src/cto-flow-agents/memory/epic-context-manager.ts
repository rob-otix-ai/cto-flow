/**
 * EpicContextManager - Adapter for EpicMemoryManager
 *
 * Provides the interface expected by epic-hooks.ts while delegating
 * to the underlying EpicMemoryManager implementation.
 */

import { EpicMemoryManager } from './epic-memory-manager.js';

// Re-export the EpicContext interface for TypeScript users
export type { EpicContext } from './epic-memory-manager.js';

// Runtime type for EpicContext (for JS compatibility)
export interface EpicContextData {
  epicId: string;
  title: string;
  description?: string;
  status: 'planning' | 'active' | 'paused' | 'completed' | 'cancelled';
  objectives?: string[];
  constraints?: string[];
  milestones?: any[];
  createdAt?: Date;
  updatedAt?: Date;
  metadata?: Record<string, unknown>;
  // Allow additional properties from the actual implementation
  [key: string]: unknown;
}

export class EpicContextManager {
  private memoryManager: EpicMemoryManager;

  constructor() {
    this.memoryManager = new EpicMemoryManager();
  }

  /**
   * Create a new epic context
   */
  async createEpicContext(context: EpicContextData & { epicId: string }): Promise<EpicContextData> {
    const fullContext: EpicContextData = {
      epicId: context.epicId,
      title: context.title || 'Untitled Epic',
      description: context.description || '',
      status: 'planning',
      objectives: context.objectives || [],
      constraints: context.constraints || [],
      milestones: context.milestones || [],
      createdAt: context.createdAt || new Date(),
      updatedAt: new Date(),
      metadata: context.metadata || {},
    };

    await this.memoryManager.storeEpicContext(fullContext as any);
    return fullContext;
  }

  /**
   * Load an epic context by ID
   */
  async loadEpicContext(epicId: string): Promise<EpicContextData | null> {
    return this.memoryManager.loadEpicContext(epicId) as Promise<EpicContextData | null>;
  }

  /**
   * Save/update an epic context
   */
  async saveEpicContext(context: EpicContextData): Promise<void> {
    context.updatedAt = new Date();
    await this.memoryManager.storeEpicContext(context as any);
  }

  /**
   * Delete an epic context
   */
  async deleteEpicContext(epicId: string): Promise<boolean> {
    return this.memoryManager.deleteEpicContext(epicId);
  }

  /**
   * Check if epic context exists
   */
  async hasEpicContext(epicId: string): Promise<boolean> {
    const context = await this.memoryManager.loadEpicContext(epicId);
    return context !== null;
  }
}

// Export singleton instance for convenience
let _instance: EpicContextManager | null = null;

export function getEpicContextManager(): EpicContextManager {
  if (!_instance) {
    _instance = new EpicContextManager();
  }
  return _instance;
}
