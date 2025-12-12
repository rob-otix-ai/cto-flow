/**
 * AgentDB-Enhanced Epic Memory Manager
 *
 * Extends EpicMemoryManager with AgentDB vector search capabilities:
 * - Semantic task matching using embeddings
 * - Vector-based agent skill matching
 * - Similar task/epic discovery
 * - Knowledge graph for architectural decisions
 * - Learning from past assignments
 *
 * Integration with claude-flow memory system and AgentDB v1.3.9
 */

import { EventEmitter } from 'events';
import {
  EpicMemoryManager,
  EpicContext,
  ArchitecturalDecision,
  TaskProgress,
  AgentAssignment,
  EPIC_NAMESPACES,
  TTL_PRESETS,
} from './epic-memory-manager.js';

// ============================================================================
// Type Definitions
// ============================================================================

export interface VectorSearchResult<T = unknown> {
  key: string;
  value: T;
  similarity: number;
  metadata?: Record<string, unknown>;
}

export interface AgentProfile {
  agentId: string;
  name: string;
  type: string;
  skills: string[];
  domains: string[];
  capabilities: string[];
  embedding?: number[];
  performanceHistory: PerformanceMetric[];
  metadata: Record<string, unknown>;
}

export interface PerformanceMetric {
  taskId: string;
  epicId: string;
  completionTime: number;
  quality: number;
  timestamp: Date;
}

export interface TaskEmbedding {
  taskId: string;
  epicId: string;
  title: string;
  embedding: number[];
  skills: string[];
  phase: string;
  priority: string;
  metadata: Record<string, unknown>;
}

export interface SimilarityMatch {
  id: string;
  score: number;
  type: 'task' | 'agent' | 'decision' | 'epic';
  data: unknown;
}

export interface AgentDBEpicConfig {
  memoryManager?: any;
  agentDBAdapter?: any;
  embeddingDimension?: number;
  enableVectorSearch?: boolean;
  enableLearning?: boolean;
  similarityThreshold?: number;
}

// ============================================================================
// Vector Namespaces
// ============================================================================

export const VECTOR_NAMESPACES = {
  TASK_EMBEDDINGS: 'vector:tasks',
  AGENT_PROFILES: 'vector:agents',
  DECISION_EMBEDDINGS: 'vector:decisions',
  SKILL_MAPPINGS: 'vector:skills',
  LEARNING_PATTERNS: 'vector:learning',
} as const;

// ============================================================================
// Simple Embedding Generator (fallback when no external service)
// ============================================================================

/**
 * Generate a simple hash-based embedding for text
 * This is a fallback - in production, use a proper embedding service
 */
function generateSimpleEmbedding(text: string, dimension: number = 128): number[] {
  const embedding = new Array(dimension).fill(0);
  const normalizedText = text.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  const words = normalizedText.split(/\s+/);

  // Simple bag-of-words style embedding with position weighting
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    for (let j = 0; j < word.length; j++) {
      const charCode = word.charCodeAt(j);
      const index = (charCode * (i + 1) * (j + 1)) % dimension;
      embedding[index] += 1 / (i + 1); // Position-weighted
    }
  }

  // Normalize to unit vector
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  if (magnitude > 0) {
    for (let i = 0; i < embedding.length; i++) {
      embedding[i] /= magnitude;
    }
  }

  return embedding;
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    magnitudeA += a[i] * a[i];
    magnitudeB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
  return magnitude > 0 ? dotProduct / magnitude : 0;
}

// ============================================================================
// AgentDB Epic Memory Manager
// ============================================================================

export class AgentDBEpicMemory extends EventEmitter {
  private baseMemory: EpicMemoryManager;
  private agentDB: any;
  private config: Required<AgentDBEpicConfig>;
  private agentProfiles: Map<string, AgentProfile> = new Map();
  private taskEmbeddings: Map<string, TaskEmbedding> = new Map();
  private isInitialized = false;

  constructor(config: AgentDBEpicConfig = {}) {
    super();

    this.config = {
      memoryManager: config.memoryManager,
      agentDBAdapter: config.agentDBAdapter,
      embeddingDimension: config.embeddingDimension ?? 128,
      enableVectorSearch: config.enableVectorSearch ?? true,
      enableLearning: config.enableLearning ?? true,
      similarityThreshold: config.similarityThreshold ?? 0.7,
    };

    this.baseMemory = new EpicMemoryManager({
      memoryManager: this.config.memoryManager,
    });

    this.agentDB = this.config.agentDBAdapter;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    await this.baseMemory.initialize();

    if (this.agentDB && typeof this.agentDB.initialize === 'function') {
      await this.agentDB.initialize();
    }

    this.isInitialized = true;
    this.emit('initialized');
  }

  async shutdown(): Promise<void> {
    if (!this.isInitialized) return;

    await this.baseMemory.shutdown();

    if (this.agentDB && typeof this.agentDB.close === 'function') {
      await this.agentDB.close();
    }

    this.isInitialized = false;
    this.emit('shutdown');
  }

  // ==========================================================================
  // Agent Profile Management with Vectors
  // ==========================================================================

  /**
   * Register an agent with skill embedding
   */
  async registerAgent(profile: Omit<AgentProfile, 'embedding'>): Promise<string> {
    // Generate embedding from skills and capabilities
    const textForEmbedding = [
      profile.name,
      profile.type,
      ...profile.skills,
      ...profile.domains,
      ...profile.capabilities,
    ].join(' ');

    const embedding = generateSimpleEmbedding(textForEmbedding, this.config.embeddingDimension);

    const fullProfile: AgentProfile = {
      ...profile,
      embedding,
      performanceHistory: profile.performanceHistory || [],
    };

    this.agentProfiles.set(profile.agentId, fullProfile);

    // Store in AgentDB if available
    if (this.isAgentDBAvailable()) {
      try {
        await this.agentDB.storeWithEmbedding(
          `${VECTOR_NAMESPACES.AGENT_PROFILES}:${profile.agentId}`,
          fullProfile,
          {
            embedding,
            namespace: VECTOR_NAMESPACES.AGENT_PROFILES,
            metadata: {
              agentId: profile.agentId,
              type: profile.type,
              skills: profile.skills,
            },
          }
        );
      } catch (error) {
        console.error(`[AgentDBEpicMemory] Failed to store agent embedding:`, error);
      }
    }

    this.emit('agent:registered', { agentId: profile.agentId });
    return profile.agentId;
  }

  /**
   * Find best matching agents for a task using vector similarity
   */
  async findMatchingAgents(
    task: { title: string; description: string; skills: string[]; priority: string },
    limit: number = 5
  ): Promise<Array<{ agent: AgentProfile; score: number; breakdown: Record<string, number> }>> {
    // Generate task embedding
    const taskText = [task.title, task.description, ...task.skills].join(' ');
    const taskEmbedding = generateSimpleEmbedding(taskText, this.config.embeddingDimension);

    const results: Array<{ agent: AgentProfile; score: number; breakdown: Record<string, number> }> = [];

    // Score each agent
    for (const [_, agent] of this.agentProfiles) {
      if (!agent.embedding) continue;

      // Vector similarity score
      const vectorScore = cosineSimilarity(taskEmbedding, agent.embedding);

      // Skill match score
      const skillMatches = task.skills.filter(s =>
        agent.skills.some(as =>
          as.toLowerCase().includes(s.toLowerCase()) ||
          s.toLowerCase().includes(as.toLowerCase())
        )
      );
      const skillScore = skillMatches.length / Math.max(task.skills.length, 1);

      // Performance score (if history exists)
      let performanceScore = 0.5; // Default neutral
      if (agent.performanceHistory.length > 0) {
        const recentPerformance = agent.performanceHistory.slice(-10);
        performanceScore = recentPerformance.reduce((sum, p) => sum + p.quality, 0) / recentPerformance.length;
      }

      // Weighted final score
      const finalScore = vectorScore * 0.4 + skillScore * 0.4 + performanceScore * 0.2;

      results.push({
        agent,
        score: finalScore * 100,
        breakdown: {
          vectorSimilarity: vectorScore * 100,
          skillMatch: skillScore * 100,
          performance: performanceScore * 100,
        },
      });
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit);
  }

  // ==========================================================================
  // Task Embedding and Similarity
  // ==========================================================================

  /**
   * Store task with embedding for future similarity search
   */
  async storeTaskWithEmbedding(
    task: TaskProgress,
    additionalContext?: { skills?: string[]; phase?: string }
  ): Promise<void> {
    // Store in base memory
    await this.baseMemory.trackTaskProgress(task);

    // Generate and store embedding
    const textForEmbedding = [
      task.title,
      ...Object.values(task.metadata || {}),
      ...(additionalContext?.skills || []),
      additionalContext?.phase || '',
    ]
      .filter(Boolean)
      .join(' ');

    const embedding = generateSimpleEmbedding(textForEmbedding, this.config.embeddingDimension);

    const taskEmbed: TaskEmbedding = {
      taskId: task.taskId,
      epicId: task.epicId,
      title: task.title,
      embedding,
      skills: additionalContext?.skills || [],
      phase: additionalContext?.phase || '',
      priority: (task.metadata?.priority as string) || 'medium',
      metadata: task.metadata || {},
    };

    this.taskEmbeddings.set(task.taskId, taskEmbed);

    // Store in AgentDB if available
    if (this.isAgentDBAvailable()) {
      try {
        await this.agentDB.storeWithEmbedding(
          `${VECTOR_NAMESPACES.TASK_EMBEDDINGS}:${task.taskId}`,
          taskEmbed,
          {
            embedding,
            namespace: VECTOR_NAMESPACES.TASK_EMBEDDINGS,
            metadata: {
              taskId: task.taskId,
              epicId: task.epicId,
              phase: additionalContext?.phase,
            },
          }
        );
      } catch (error) {
        console.error(`[AgentDBEpicMemory] Failed to store task embedding:`, error);
      }
    }

    this.emit('task:embedded', { taskId: task.taskId, epicId: task.epicId });
  }

  /**
   * Find similar tasks based on description
   */
  async findSimilarTasks(
    description: string,
    limit: number = 5
  ): Promise<VectorSearchResult<TaskEmbedding>[]> {
    const queryEmbedding = generateSimpleEmbedding(description, this.config.embeddingDimension);

    // Try AgentDB vector search first
    if (this.isAgentDBAvailable()) {
      try {
        const results = await this.agentDB.vectorSearch(queryEmbedding, {
          k: limit,
          namespace: VECTOR_NAMESPACES.TASK_EMBEDDINGS,
        });

        return results.map((r: any) => ({
          key: r.key,
          value: r.value || r.metadata,
          similarity: r.similarity || r.score || 0,
          metadata: r.metadata,
        }));
      } catch (error) {
        console.error(`[AgentDBEpicMemory] Vector search failed, using fallback:`, error);
      }
    }

    // Fallback to local similarity search
    const results: VectorSearchResult<TaskEmbedding>[] = [];

    for (const [_, taskEmbed] of this.taskEmbeddings) {
      const similarity = cosineSimilarity(queryEmbedding, taskEmbed.embedding);
      if (similarity >= this.config.similarityThreshold) {
        results.push({
          key: taskEmbed.taskId,
          value: taskEmbed,
          similarity,
        });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, limit);
  }

  // ==========================================================================
  // Architectural Decision Embedding
  // ==========================================================================

  /**
   * Store architectural decision with semantic embedding
   */
  async storeDecisionWithEmbedding(decision: ArchitecturalDecision): Promise<string> {
    // Store in base memory
    const key = await this.baseMemory.storeDecision(decision);

    // Generate embedding for semantic search
    const textForEmbedding = [
      decision.title,
      decision.context,
      decision.decision,
      ...decision.consequences,
      ...decision.alternatives.map(a => `${a.title} ${a.description}`),
      ...decision.tags,
    ].join(' ');

    const embedding = generateSimpleEmbedding(textForEmbedding, this.config.embeddingDimension);

    // Store in AgentDB if available
    if (this.isAgentDBAvailable()) {
      try {
        await this.agentDB.storeWithEmbedding(
          `${VECTOR_NAMESPACES.DECISION_EMBEDDINGS}:${decision.id}`,
          decision,
          {
            embedding,
            namespace: VECTOR_NAMESPACES.DECISION_EMBEDDINGS,
            metadata: {
              decisionId: decision.id,
              epicId: decision.epicId,
              status: decision.status,
              tags: decision.tags,
            },
          }
        );
      } catch (error) {
        console.error(`[AgentDBEpicMemory] Failed to store decision embedding:`, error);
      }
    }

    this.emit('decision:embedded', { decisionId: decision.id, epicId: decision.epicId });
    return key;
  }

  /**
   * Find similar architectural decisions
   */
  async findSimilarDecisions(
    context: string,
    limit: number = 5
  ): Promise<VectorSearchResult<ArchitecturalDecision>[]> {
    const queryEmbedding = generateSimpleEmbedding(context, this.config.embeddingDimension);

    if (this.isAgentDBAvailable()) {
      try {
        const results = await this.agentDB.vectorSearch(queryEmbedding, {
          k: limit,
          namespace: VECTOR_NAMESPACES.DECISION_EMBEDDINGS,
        });

        return results.map((r: any) => ({
          key: r.key,
          value: r.value || r.metadata,
          similarity: r.similarity || r.score || 0,
          metadata: r.metadata,
        }));
      } catch (error) {
        console.error(`[AgentDBEpicMemory] Decision search failed:`, error);
      }
    }

    return [];
  }

  // ==========================================================================
  // Learning from Assignments
  // ==========================================================================

  /**
   * Record assignment outcome for learning
   */
  async recordAssignmentOutcome(
    assignment: AgentAssignment,
    outcome: {
      success: boolean;
      quality: number; // 0-1
      completionTime: number; // hours
      feedback?: string;
    }
  ): Promise<void> {
    if (!this.config.enableLearning) return;

    const agent = this.agentProfiles.get(assignment.agentId);
    if (!agent) return;

    // Add to performance history
    agent.performanceHistory.push({
      taskId: assignment.taskIds[0] || 'unknown',
      epicId: assignment.epicId,
      completionTime: outcome.completionTime,
      quality: outcome.quality,
      timestamp: new Date(),
    });

    // Keep only last 100 records
    if (agent.performanceHistory.length > 100) {
      agent.performanceHistory = agent.performanceHistory.slice(-100);
    }

    // Re-register agent with updated profile
    await this.registerAgent(agent);

    // Store learning pattern
    if (this.isAgentDBAvailable()) {
      try {
        const patternKey = `${VECTOR_NAMESPACES.LEARNING_PATTERNS}:${assignment.epicId}:${assignment.agentId}`;
        await this.agentDB.storeWithEmbedding(patternKey, {
          agentId: assignment.agentId,
          epicId: assignment.epicId,
          role: assignment.role,
          outcome,
          timestamp: new Date().toISOString(),
        }, {
          namespace: VECTOR_NAMESPACES.LEARNING_PATTERNS,
          metadata: {
            agentType: agent.type,
            success: outcome.success,
            quality: outcome.quality,
          },
        });
      } catch (error) {
        console.error(`[AgentDBEpicMemory] Failed to store learning pattern:`, error);
      }
    }

    this.emit('learning:recorded', {
      agentId: assignment.agentId,
      epicId: assignment.epicId,
      outcome,
    });
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Check if AgentDB is available
   */
  private isAgentDBAvailable(): boolean {
    return (
      this.config.enableVectorSearch &&
      this.agentDB != null &&
      typeof this.agentDB.storeWithEmbedding === 'function'
    );
  }

  /**
   * Get base memory manager (for non-vector operations)
   */
  getBaseMemory(): EpicMemoryManager {
    return this.baseMemory;
  }

  /**
   * Get all registered agents
   */
  getAgents(): AgentProfile[] {
    return Array.from(this.agentProfiles.values());
  }

  /**
   * Get agent by ID
   */
  getAgent(agentId: string): AgentProfile | undefined {
    return this.agentProfiles.get(agentId);
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<{
    agents: number;
    taskEmbeddings: number;
    vectorSearchAvailable: boolean;
    learningEnabled: boolean;
  }> {
    return {
      agents: this.agentProfiles.size,
      taskEmbeddings: this.taskEmbeddings.size,
      vectorSearchAvailable: this.isAgentDBAvailable(),
      learningEnabled: this.config.enableLearning,
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createAgentDBEpicMemory(config: AgentDBEpicConfig = {}): AgentDBEpicMemory {
  return new AgentDBEpicMemory(config);
}

export default AgentDBEpicMemory;
