/**
 * Agent Scorer - 6-Factor Agent Scoring Algorithm
 *
 * Implements the multi-factor scoring system for agent-to-task matching
 * as specified in the SPARC CTO-Flow Agent Management design.
 *
 * Scoring Factors:
 * 1. Capability Match (40%) - Required skills vs agent capabilities
 * 2. Performance History (20%) - Historical success rate on similar tasks
 * 3. Availability (20%) - Current workload capacity (0-100%)
 * 4. Specialization (10%) - Agent type alignment with task type
 * 5. Experience (10%) - Past work on this specific epic/domain
 * 6. Minimum Threshold: 50 points required for assignment
 *
 * @module cto-flow-agents/scoring
 */

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

/**
 * Agent capabilities definition
 */
export interface AgentCapabilities {
  /** Core technical skills (e.g., 'codeGeneration', 'testing', 'debugging') */
  core: string[];
  /** Programming languages (e.g., 'typescript', 'python', 'rust') */
  languages: string[];
  /** Frameworks and libraries (e.g., 'react', 'express', 'pytest') */
  frameworks: string[];
  /** Domain expertise (e.g., 'backend', 'frontend', 'ml', 'devops') */
  domains: string[];
  /** Optional metadata for extended capabilities */
  metadata?: Record<string, any>;
}

/**
 * Agent performance metrics
 */
export interface AgentPerformance {
  /** Number of tasks completed successfully */
  tasksCompleted: number;
  /** Success rate (0-1) */
  successRate: number;
  /** Average response time in milliseconds */
  averageResponseTime: number;
  /** Average task completion time in minutes */
  averageCompletionTime: number;
  /** Last activity timestamp */
  lastActivity: Date;
  /** Health score (0-1) */
  health: number;
}

/**
 * Agent workload information
 */
export interface AgentWorkload {
  /** Current number of active tasks */
  activeTasks: number;
  /** Maximum concurrent tasks allowed */
  maxConcurrentTasks: number;
  /** Workload factor (0-1, where 0 is idle and 1 is full) */
  workloadFactor: number;
}

/**
 * Task requirements extracted from GitHub issue
 */
export interface TaskRequirements {
  /** Task identifier (e.g., issue number) */
  taskId: string;
  /** Task title */
  title: string;
  /** Task description */
  description: string;
  /** Required capabilities for task completion */
  requiredCapabilities: string[];
  /** Preferred but not required capabilities */
  preferredCapabilities?: string[];
  /** Programming languages involved */
  languages: string[];
  /** Frameworks involved */
  frameworks: string[];
  /** Domain areas */
  domains: string[];
  /** Task complexity level */
  complexity: 'low' | 'medium' | 'high' | 'critical';
  /** Task priority */
  priority: 'low' | 'medium' | 'high' | 'critical';
  /** Estimated duration in minutes */
  estimatedDuration?: number;
  /** GitHub labels */
  labels?: string[];
  /** Epic ID if part of an epic */
  epicId?: string;
}

/**
 * Individual agent information
 */
export interface AgentInfo {
  /** Unique agent identifier */
  id: string;
  /** Agent type (e.g., 'coder', 'tester', 'reviewer') */
  type: string;
  /** Agent capabilities */
  capabilities: AgentCapabilities;
  /** Performance metrics */
  performance: AgentPerformance;
  /** Current workload */
  workload: AgentWorkload;
  /** Agent status */
  status: 'active' | 'idle' | 'busy' | 'offline';
  /** Epic experience (epicId -> task count) */
  epicExperience?: Map<string, number>;
  /** Optional metadata */
  metadata?: Record<string, any>;
}

/**
 * Detailed scoring breakdown
 */
export interface ScoreBreakdown {
  /** Capability match score (0-40 points) */
  capabilityMatch: number;
  /** Performance history score (0-20 points) */
  performanceHistory: number;
  /** Availability score (0-20 points) */
  availability: number;
  /** Specialization score (0-10 points) */
  specialization: number;
  /** Experience score (0-10 points) */
  experience: number;
}

/**
 * Complete agent scoring result
 */
export interface AgentScore {
  /** The agent being scored */
  agent: AgentInfo;
  /** Overall score (0-100) */
  overallScore: number;
  /** Detailed breakdown of each factor */
  breakdown: ScoreBreakdown;
  /** Confidence in the match (0-1) */
  confidence: number;
  /** Human-readable match reasoning */
  matchReason: string;
  /** List of missing capabilities */
  missingCapabilities: string[];
  /** Whether agent meets minimum threshold (50 points) */
  meetsThreshold: boolean;
}

/**
 * Configuration for score weights
 */
export interface ScoringWeights {
  /** Capability match weight (default: 0.40) */
  capabilityMatch?: number;
  /** Performance history weight (default: 0.20) */
  performanceHistory?: number;
  /** Availability weight (default: 0.20) */
  availability?: number;
  /** Specialization weight (default: 0.10) */
  specialization?: number;
  /** Experience weight (default: 0.10) */
  experience?: number;
}

/**
 * Skill synonym mappings for fuzzy matching
 */
export interface SkillSynonyms {
  [key: string]: string[];
}

// ============================================================================
// DEFAULT CONFIGURATIONS
// ============================================================================

/**
 * Default scoring weights (must sum to 1.0)
 */
export const DEFAULT_WEIGHTS: Required<ScoringWeights> = {
  capabilityMatch: 0.40,
  performanceHistory: 0.20,
  availability: 0.20,
  specialization: 0.10,
  experience: 0.10,
};

/**
 * Default skill synonyms for fuzzy matching
 */
export const DEFAULT_SKILL_SYNONYMS: SkillSynonyms = {
  // Languages
  'typescript': ['ts', 'tsx'],
  'javascript': ['js', 'jsx', 'node', 'nodejs'],
  'python': ['py', 'python3'],
  'rust': ['rs'],
  'go': ['golang'],

  // Capabilities
  'codeGeneration': ['coding', 'development', 'programming', 'implementation'],
  'testing': ['qa', 'test', 'unit-testing', 'integration-testing'],
  'debugging': ['bug-fixing', 'troubleshooting', 'error-handling'],
  'codeReview': ['review', 'code-quality', 'peer-review'],
  'documentation': ['docs', 'readme', 'api-docs'],
  'refactoring': ['code-improvement', 'optimization', 'cleanup'],

  // Frameworks
  'react': ['reactjs', 'react-native'],
  'express': ['expressjs'],
  'fastapi': ['fast-api'],
  'django': ['python-django'],
  'pytest': ['py-test'],

  // Domains
  'backend': ['server-side', 'api', 'backend-dev'],
  'frontend': ['client-side', 'ui', 'frontend-dev'],
  'fullstack': ['full-stack', 'fullstack-dev'],
  'devops': ['infrastructure', 'deployment', 'ci-cd'],
  'ml': ['machine-learning', 'ai', 'data-science'],
};

/**
 * Minimum score threshold for agent assignment
 */
export const MINIMUM_SCORE_THRESHOLD = 50;

// ============================================================================
// AGENT SCORER CLASS
// ============================================================================

/**
 * AgentScorer - Implements the 6-factor agent scoring algorithm
 *
 * @example
 * ```typescript
 * const scorer = new AgentScorer();
 *
 * const score = scorer.calculateScore(agent, taskRequirements);
 *
 * if (score.meetsThreshold) {
 *   console.log(`Agent ${agent.id} scored ${score.overallScore}/100`);
 *   console.log(`Reason: ${score.matchReason}`);
 * }
 * ```
 */
export class AgentScorer {
  private weights: Required<ScoringWeights>;
  private skillSynonyms: SkillSynonyms;
  private minThreshold: number;

  /**
   * Create a new AgentScorer instance
   *
   * @param weights - Custom scoring weights (optional)
   * @param skillSynonyms - Custom skill synonyms (optional)
   * @param minThreshold - Minimum score threshold (optional, default: 50)
   */
  constructor(
    weights?: ScoringWeights,
    skillSynonyms?: SkillSynonyms,
    minThreshold?: number
  ) {
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
    this.skillSynonyms = { ...DEFAULT_SKILL_SYNONYMS, ...skillSynonyms };
    this.minThreshold = minThreshold ?? MINIMUM_SCORE_THRESHOLD;

    // Validate weights sum to 1.0 (with small tolerance for floating point)
    this.validateWeights();
  }

  /**
   * Calculate the complete score for an agent against task requirements
   *
   * @param agent - The agent to score
   * @param requirements - The task requirements
   * @returns Complete scoring result with breakdown
   */
  public calculateScore(agent: AgentInfo, requirements: TaskRequirements): AgentScore {
    // Calculate each factor
    const breakdown: ScoreBreakdown = {
      capabilityMatch: this.calculateCapabilityMatch(agent, requirements),
      performanceHistory: this.calculatePerformanceHistory(agent, requirements),
      availability: this.calculateAvailability(agent),
      specialization: this.calculateSpecialization(agent, requirements),
      experience: this.calculateExperience(agent, requirements),
    };

    // Calculate overall score
    const overallScore = this.calculateOverallScore(breakdown);

    // Calculate confidence
    const confidence = this.calculateConfidence(agent, requirements, breakdown);

    // Generate match reason
    const matchReason = this.generateMatchReason(breakdown, overallScore);

    // Find missing capabilities
    const missingCapabilities = this.findMissingCapabilities(agent, requirements);

    // Check threshold
    const meetsThreshold = overallScore >= this.minThreshold;

    return {
      agent,
      overallScore,
      breakdown,
      confidence,
      matchReason,
      missingCapabilities,
      meetsThreshold,
    };
  }

  /**
   * Score multiple agents and return sorted results
   *
   * @param agents - Array of agents to score
   * @param requirements - The task requirements
   * @returns Sorted array of scores (highest first)
   */
  public scoreMultipleAgents(
    agents: AgentInfo[],
    requirements: TaskRequirements
  ): AgentScore[] {
    const scores = agents.map(agent => this.calculateScore(agent, requirements));

    // Sort by overall score (highest first), then by confidence
    return scores.sort((a, b) => {
      if (b.overallScore !== a.overallScore) {
        return b.overallScore - a.overallScore;
      }
      return b.confidence - a.confidence;
    });
  }

  /**
   * Get agents that meet the minimum threshold
   *
   * @param agents - Array of agents to score
   * @param requirements - The task requirements
   * @returns Sorted array of qualifying scores
   */
  public getQualifyingAgents(
    agents: AgentInfo[],
    requirements: TaskRequirements
  ): AgentScore[] {
    return this.scoreMultipleAgents(agents, requirements)
      .filter(score => score.meetsThreshold);
  }

  // ==========================================================================
  // FACTOR CALCULATION METHODS
  // ==========================================================================

  /**
   * Factor 1: Capability Match (0-40 points)
   *
   * Calculates how well the agent's capabilities match the task requirements.
   * Uses fuzzy matching with skill synonyms for partial matches.
   *
   * Scoring:
   * - Required capabilities: Full weight
   * - Preferred capabilities: Half weight
   * - Language match: Bonus points
   * - Framework match: Bonus points
   */
  private calculateCapabilityMatch(
    agent: AgentInfo,
    requirements: TaskRequirements
  ): number {
    const maxPoints = 40;
    let score = 0;

    // Calculate required capabilities match
    const requiredScore = this.scoreCapabilitySet(
      agent.capabilities,
      requirements.requiredCapabilities,
      1.0 // Full weight
    );

    // Calculate preferred capabilities match (if any)
    const preferredScore = requirements.preferredCapabilities
      ? this.scoreCapabilitySet(
          agent.capabilities,
          requirements.preferredCapabilities,
          0.5 // Half weight
        )
      : 0;

    // Calculate language match bonus
    const languageScore = this.scoreArrayMatch(
      agent.capabilities.languages,
      requirements.languages,
      0.15 // 15% bonus
    );

    // Calculate framework match bonus
    const frameworkScore = this.scoreArrayMatch(
      agent.capabilities.frameworks,
      requirements.frameworks,
      0.15 // 15% bonus
    );

    // Combine scores (weighted)
    const totalFactor = requiredScore * 0.6 + preferredScore * 0.2 +
                       languageScore * 0.1 + frameworkScore * 0.1;

    score = totalFactor * maxPoints;

    return Math.min(maxPoints, Math.max(0, score));
  }

  /**
   * Factor 2: Performance History (0-20 points)
   *
   * Scores based on the agent's historical performance metrics.
   * Considers success rate, completion time, and health.
   */
  private calculatePerformanceHistory(
    agent: AgentInfo,
    requirements: TaskRequirements
  ): number {
    const maxPoints = 20;
    const perf = agent.performance;

    // Base score from success rate (0-1)
    let score = perf.successRate;

    // Adjust for task completion count (experience factor)
    const experienceBonus = Math.min(0.2, perf.tasksCompleted / 100);
    score += experienceBonus;

    // Adjust for health (penalize unhealthy agents)
    score *= perf.health;

    // Adjust for complexity - higher complexity requires better performance
    const complexityMultipliers = {
      low: 1.0,
      medium: 0.95,
      high: 0.9,
      critical: 0.85,
    };
    score *= complexityMultipliers[requirements.complexity];

    return Math.min(maxPoints, Math.max(0, score * maxPoints));
  }

  /**
   * Factor 3: Availability (0-20 points)
   *
   * Scores based on the agent's current workload and capacity.
   * Considers both active task count and health status.
   */
  private calculateAvailability(agent: AgentInfo): number {
    const maxPoints = 20;
    const workload = agent.workload;

    // Calculate workload capacity (inverse of workload factor)
    const capacityScore = 1 - workload.workloadFactor;

    // Health factor (unhealthy agents should have lower availability)
    const healthScore = agent.performance.health;

    // Status penalty
    const statusMultiplier = agent.status === 'idle' ? 1.0 :
                           agent.status === 'active' ? 0.8 :
                           agent.status === 'busy' ? 0.4 : 0.0;

    // Combine factors: 60% capacity, 30% health, 10% status
    const totalScore = (capacityScore * 0.6 + healthScore * 0.3) * statusMultiplier;

    return Math.min(maxPoints, Math.max(0, totalScore * maxPoints));
  }

  /**
   * Factor 4: Specialization (0-10 points)
   *
   * Scores based on how well the agent's type and domain expertise
   * align with the task type and domain.
   */
  private calculateSpecialization(
    agent: AgentInfo,
    requirements: TaskRequirements
  ): number {
    const maxPoints = 10;
    let score = 0;

    // Agent type to task type mapping
    const typeMatches = this.getAgentTypeMatches(agent.type);

    // Check label matches
    const labels = requirements.labels || [];
    const labelMatch = labels.some(label =>
      typeMatches.some(type =>
        label.toLowerCase().includes(type.toLowerCase())
      )
    );

    if (labelMatch) {
      score += 0.5; // 50% of specialization score
    }

    // Check domain matches
    const domainMatch = requirements.domains.some(domain =>
      agent.capabilities.domains.some(agentDomain =>
        this.fuzzyMatch(domain, agentDomain)
      )
    );

    if (domainMatch) {
      score += 0.5; // 50% of specialization score
    }

    return Math.min(maxPoints, Math.max(0, score * maxPoints));
  }

  /**
   * Factor 5: Experience (0-10 points)
   *
   * Scores based on the agent's past work on the specific epic or domain.
   */
  private calculateExperience(
    agent: AgentInfo,
    requirements: TaskRequirements
  ): number {
    const maxPoints = 10;
    let score = 0;

    // Check epic-specific experience
    if (requirements.epicId && agent.epicExperience) {
      const epicTaskCount = agent.epicExperience.get(requirements.epicId) || 0;

      // Score increases with epic experience, capped at 5 tasks
      score += Math.min(0.6, epicTaskCount / 5 * 0.6);
    }

    // Check domain experience (from completed tasks)
    const domainExperienceScore = this.calculateDomainExperience(
      agent,
      requirements.domains
    );
    score += domainExperienceScore * 0.4;

    return Math.min(maxPoints, Math.max(0, score * maxPoints));
  }

  // ==========================================================================
  // HELPER METHODS
  // ==========================================================================

  /**
   * Calculate overall score by applying weights to breakdown
   */
  private calculateOverallScore(breakdown: ScoreBreakdown): number {
    // Scores are already in their point ranges (0-40, 0-20, etc.)
    // Just sum them up
    const total =
      breakdown.capabilityMatch +
      breakdown.performanceHistory +
      breakdown.availability +
      breakdown.specialization +
      breakdown.experience;

    return Math.min(100, Math.max(0, total));
  }

  /**
   * Calculate confidence in the match (0-1)
   *
   * Higher confidence means we have more data and certainty about the match.
   */
  private calculateConfidence(
    agent: AgentInfo,
    requirements: TaskRequirements,
    breakdown: ScoreBreakdown
  ): number {
    let confidence = 0;
    let factors = 0;

    // Factor 1: Number of completed tasks (experience confidence)
    const taskConfidence = Math.min(1, agent.performance.tasksCompleted / 20);
    confidence += taskConfidence;
    factors++;

    // Factor 2: Health score (system confidence)
    confidence += agent.performance.health;
    factors++;

    // Factor 3: Capability completeness
    const hasRequired = this.hasAllRequiredCapabilities(agent, requirements);
    confidence += hasRequired ? 1 : 0.5;
    factors++;

    // Factor 4: Specialization match
    const specializationFactor = breakdown.specialization / 10;
    confidence += specializationFactor;
    factors++;

    // Factor 5: Recent activity (recency confidence)
    const daysSinceActivity =
      (Date.now() - agent.performance.lastActivity.getTime()) / (1000 * 60 * 60 * 24);
    const recencyConfidence = daysSinceActivity < 1 ? 1 :
                             daysSinceActivity < 7 ? 0.7 : 0.4;
    confidence += recencyConfidence;
    factors++;

    return confidence / factors;
  }

  /**
   * Generate human-readable match reason
   */
  private generateMatchReason(breakdown: ScoreBreakdown, overallScore: number): string {
    const reasons: string[] = [];

    // Identify strongest factors
    const factors = [
      { name: 'capability match', score: breakdown.capabilityMatch, max: 40 },
      { name: 'performance history', score: breakdown.performanceHistory, max: 20 },
      { name: 'availability', score: breakdown.availability, max: 20 },
      { name: 'specialization', score: breakdown.specialization, max: 10 },
      { name: 'experience', score: breakdown.experience, max: 10 },
    ];

    // Sort by percentage of max score
    factors.sort((a, b) => (b.score / b.max) - (a.score / a.max));

    // Add top 2 factors
    for (let i = 0; i < Math.min(2, factors.length); i++) {
      const factor = factors[i];
      const percentage = Math.round((factor.score / factor.max) * 100);
      if (percentage > 50) {
        reasons.push(`${percentage}% ${factor.name}`);
      }
    }

    // Overall assessment
    if (overallScore >= 80) {
      reasons.unshift('Excellent match');
    } else if (overallScore >= 60) {
      reasons.unshift('Good match');
    } else if (overallScore >= 50) {
      reasons.unshift('Adequate match');
    } else {
      reasons.unshift('Below threshold');
    }

    return reasons.join('; ');
  }

  /**
   * Find capabilities that are required but missing
   */
  private findMissingCapabilities(
    agent: AgentInfo,
    requirements: TaskRequirements
  ): string[] {
    const missing: string[] = [];

    for (const required of requirements.requiredCapabilities) {
      if (!this.agentHasCapability(agent.capabilities, required)) {
        missing.push(required);
      }
    }

    return missing;
  }

  /**
   * Score a set of capabilities against requirements
   */
  private scoreCapabilitySet(
    capabilities: AgentCapabilities,
    required: string[],
    weight: number
  ): number {
    if (required.length === 0) return 0;

    let matched = 0;

    for (const req of required) {
      if (this.agentHasCapability(capabilities, req)) {
        matched++;
      }
    }

    return (matched / required.length) * weight;
  }

  /**
   * Score array overlap (languages, frameworks, etc.)
   */
  private scoreArrayMatch(agentArray: string[], requiredArray: string[], weight: number): number {
    if (requiredArray.length === 0) return 0;

    let matched = 0;

    for (const required of requiredArray) {
      if (agentArray.some(item => this.fuzzyMatch(item, required))) {
        matched++;
      }
    }

    return (matched / requiredArray.length) * weight;
  }

  /**
   * Check if agent has a specific capability (with fuzzy matching)
   */
  private agentHasCapability(capabilities: AgentCapabilities, required: string): boolean {
    // Check all capability categories
    const allCapabilities = [
      ...capabilities.core,
      ...capabilities.languages,
      ...capabilities.frameworks,
      ...capabilities.domains,
    ];

    return allCapabilities.some(cap => this.fuzzyMatch(cap, required));
  }

  /**
   * Check if agent has all required capabilities
   */
  private hasAllRequiredCapabilities(
    agent: AgentInfo,
    requirements: TaskRequirements
  ): boolean {
    return requirements.requiredCapabilities.every(req =>
      this.agentHasCapability(agent.capabilities, req)
    );
  }

  /**
   * Fuzzy match two skill strings using synonyms
   */
  private fuzzyMatch(skill1: string, skill2: string): boolean {
    const s1 = skill1.toLowerCase().trim();
    const s2 = skill2.toLowerCase().trim();

    // Exact match
    if (s1 === s2) return true;

    // Check if one contains the other
    if (s1.includes(s2) || s2.includes(s1)) return true;

    // Check synonyms
    const synonyms1 = this.skillSynonyms[s1] || [];
    const synonyms2 = this.skillSynonyms[s2] || [];

    // Check if s2 is in s1's synonyms
    if (synonyms1.some(syn => syn === s2 || s2.includes(syn))) return true;

    // Check if s1 is in s2's synonyms
    if (synonyms2.some(syn => syn === s1 || s1.includes(syn))) return true;

    // Check if any synonyms match
    if (synonyms1.some(syn1 => synonyms2.some(syn2 => syn1 === syn2))) return true;

    return false;
  }

  /**
   * Get task types that match an agent type
   */
  private getAgentTypeMatches(agentType: string): string[] {
    const typeMap: Record<string, string[]> = {
      'coder': ['feature', 'implementation', 'development', 'coding', 'build'],
      'tester': ['bug', 'testing', 'qa', 'test', 'quality'],
      'reviewer': ['code-review', 'review', 'security', 'quality', 'audit'],
      'researcher': ['research', 'investigation', 'analysis', 'study', 'explore'],
      'architect': ['architecture', 'design', 'system', 'planning', 'structure'],
      'devops': ['deployment', 'infrastructure', 'ci-cd', 'pipeline', 'ops'],
    };

    return typeMap[agentType.toLowerCase()] || [];
  }

  /**
   * Calculate domain experience score based on task history
   */
  private calculateDomainExperience(agent: AgentInfo, domains: string[]): number {
    if (domains.length === 0) return 0;

    // Count how many required domains the agent has experience in
    let matchedDomains = 0;

    for (const domain of domains) {
      if (agent.capabilities.domains.some(agentDomain =>
        this.fuzzyMatch(agentDomain, domain)
      )) {
        matchedDomains++;
      }
    }

    return matchedDomains / domains.length;
  }

  /**
   * Validate that weights sum to approximately 1.0
   */
  private validateWeights(): void {
    const sum =
      this.weights.capabilityMatch +
      this.weights.performanceHistory +
      this.weights.availability +
      this.weights.specialization +
      this.weights.experience;

    const tolerance = 0.01;
    if (Math.abs(sum - 1.0) > tolerance) {
      throw new Error(
        `Scoring weights must sum to 1.0 (got ${sum}). ` +
        `Adjust weights: ${JSON.stringify(this.weights)}`
      );
    }
  }

  // ==========================================================================
  // UTILITY METHODS
  // ==========================================================================

  /**
   * Get current scoring weights
   */
  public getWeights(): Required<ScoringWeights> {
    return { ...this.weights };
  }

  /**
   * Get current skill synonyms
   */
  public getSkillSynonyms(): SkillSynonyms {
    return { ...this.skillSynonyms };
  }

  /**
   * Get minimum threshold
   */
  public getMinThreshold(): number {
    return this.minThreshold;
  }

  /**
   * Add custom skill synonyms
   */
  public addSkillSynonyms(skill: string, synonyms: string[]): void {
    const normalizedSkill = skill.toLowerCase().trim();
    const existing = this.skillSynonyms[normalizedSkill] || [];
    this.skillSynonyms[normalizedSkill] = [
      ...existing,
      ...synonyms.map(s => s.toLowerCase().trim()),
    ];
  }

  /**
   * Update scoring weights (must still sum to 1.0)
   */
  public updateWeights(newWeights: Partial<ScoringWeights>): void {
    this.weights = { ...this.weights, ...newWeights };
    this.validateWeights();
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a scorer with default configuration
 */
export function createDefaultScorer(): AgentScorer {
  return new AgentScorer();
}

/**
 * Create a scorer with custom weights
 */
export function createCustomScorer(weights: ScoringWeights): AgentScorer {
  return new AgentScorer(weights);
}

/**
 * Create a scorer optimized for capability matching
 */
export function createCapabilityFocusedScorer(): AgentScorer {
  return new AgentScorer({
    capabilityMatch: 0.50,      // Increased from 40%
    performanceHistory: 0.15,
    availability: 0.15,
    specialization: 0.10,
    experience: 0.10,
  });
}

/**
 * Create a scorer optimized for availability
 */
export function createAvailabilityFocusedScorer(): AgentScorer {
  return new AgentScorer({
    capabilityMatch: 0.30,
    performanceHistory: 0.15,
    availability: 0.35,         // Increased from 20%
    specialization: 0.10,
    experience: 0.10,
  });
}

/**
 * Create a scorer optimized for performance history
 */
export function createPerformanceFocusedScorer(): AgentScorer {
  return new AgentScorer({
    capabilityMatch: 0.30,
    performanceHistory: 0.35,   // Increased from 20%
    availability: 0.15,
    specialization: 0.10,
    experience: 0.10,
  });
}
