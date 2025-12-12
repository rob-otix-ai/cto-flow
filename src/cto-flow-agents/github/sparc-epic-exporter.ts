/**
 * SPARC Epic Exporter for Claude-Flow
 *
 * Converts SPARC specifications to GitHub Epics with:
 * - Automatic milestone creation for each SPARC phase
 * - Child issue generation from user stories
 * - Bidirectional synchronization
 * - Complete traceability
 *
 * Part of the CTO-Flow Agent Management system
 */

import { Octokit } from '@octokit/rest';
import type { components } from '@octokit/openapi-types';

// GitHub API types
type GitHubIssue = components['schemas']['issue'];
type GitHubMilestone = components['schemas']['milestone'];
type GitHubLabel = components['schemas']['label'];

/**
 * SPARC Specification structure from Specification phase output
 */
export interface SparcSpecification {
  taskId: string;
  taskDescription: string;
  requirements: Requirement[];
  userStories: UserStory[];
  acceptanceCriteria: AcceptanceCriterion[];
  constraints?: string[];
  risks?: Risk[];
  phases?: SparcPhase[];
  estimatedEffort?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Individual requirement from SPARC specification
 */
export interface Requirement {
  id: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  type: 'functional' | 'non-functional' | 'technical' | 'business';
  source?: string;
}

/**
 * User story for epic child issues
 */
export interface UserStory {
  id: string;
  title: string;
  description: string;
  asA: string;
  iWant: string;
  soThat: string;
  acceptanceCriteria: string[];
  priority: 'critical' | 'high' | 'medium' | 'low';
  estimatedEffort?: number;
  requiredCapabilities?: string[];
  technicalNotes?: string;
  phase?: 'specification' | 'pseudocode' | 'architecture' | 'refinement' | 'completion';
  labels?: string[];
}

/**
 * Acceptance criterion for epic and issues
 */
export interface AcceptanceCriterion {
  id: string;
  criterion: string;
  testable: boolean;
  userStoryId?: string;
}

/**
 * Risk identified in specification
 */
export interface Risk {
  id: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  mitigation: string;
}

/**
 * SPARC phase definition for milestone mapping
 */
export interface SparcPhase {
  name: 'specification' | 'pseudocode' | 'architecture' | 'refinement' | 'completion';
  title: string;
  description?: string;
  dueDate?: Date;
}

/**
 * GitHub Milestone with phase mapping
 */
export interface Milestone {
  number: number;
  title: string;
  url: string;
  phase: string;
  dueDate?: string;
}

/**
 * Child issue created from user story
 */
export interface ChildIssue {
  number: number;
  title: string;
  url: string;
  milestone?: string;
  userStoryId: string;
  labels: string[];
}

/**
 * Result of epic export operation
 */
export interface EpicExportResult {
  epicId: string;
  epicNumber: number;
  epicUrl: string;
  childIssues: ChildIssue[];
  milestones: Milestone[];
  repository: string;
  createdAt: Date;
}

/**
 * Configuration for SparcEpicExporter
 */
export interface EpicExporterConfig {
  labelPrefix?: string;
  defaultLabels?: string[];
  template?: string;
  syncEnabled?: boolean;
  createMilestones?: boolean;
  linkMethod?: 'label' | 'project' | 'mention';
}

/**
 * Default SPARC phase to milestone mapping
 */
const DEFAULT_PHASE_MILESTONES: Record<string, string> = {
  specification: 'SPARC: Requirements Complete',
  pseudocode: 'SPARC: Design Complete',
  architecture: 'SPARC: Architecture Approved',
  refinement: 'SPARC: Implementation Complete',
  completion: 'SPARC: Ready for Release'
};

/**
 * SparcEpicExporter: Converts SPARC specifications to GitHub Epics
 *
 * Implements automatic epic generation with:
 * - Phase-to-milestone mapping
 * - User story to child issue conversion
 * - Acceptance criteria integration
 * - Risk and constraint documentation
 * - Bidirectional sync preparation
 */
export class SparcEpicExporter {
  private octokit: Octokit;
  private owner: string;
  private repo: string;
  private config: EpicExporterConfig;

  /**
   * Create a new SparcEpicExporter
   *
   * @param repository - GitHub repository in 'owner/repo' format
   * @param token - GitHub personal access token (optional, uses GITHUB_TOKEN env var)
   * @param config - Optional configuration for epic export behavior
   */
  constructor(
    repository: string,
    token?: string,
    config: Partial<EpicExporterConfig> = {}
  ) {
    const [owner, repo] = repository.split('/');
    if (!owner || !repo) {
      throw new Error('Invalid repository format. Expected "owner/repo"');
    }

    this.owner = owner;
    this.repo = repo;
    this.config = {
      labelPrefix: config.labelPrefix || 'sparc:',
      defaultLabels: config.defaultLabels || ['epic', 'sparc-generated', 'cto-flow'],
      syncEnabled: config.syncEnabled !== false,
      createMilestones: config.createMilestones !== false,
      linkMethod: config.linkMethod || 'label',
      ...config
    };

    const authToken = token || process.env.GITHUB_TOKEN;
    if (!authToken) {
      throw new Error('GitHub token is required. Provide token parameter or set GITHUB_TOKEN environment variable');
    }

    this.octokit = new Octokit({ auth: authToken });
  }

  /**
   * Export SPARC specification to GitHub Epic
   *
   * Main entry point that orchestrates:
   * 1. Milestone creation for SPARC phases
   * 2. Epic issue creation with formatted body
   * 3. Child issue creation from user stories
   * 4. Issue linking and labeling
   * 5. Memory storage preparation
   *
   * @param specification - Complete SPARC specification from Specification phase
   * @returns EpicExportResult with all created GitHub resources
   */
  async exportToEpic(specification: SparcSpecification): Promise<EpicExportResult> {
    // Generate unique epic ID for traceability
    const epicId = this.generateEpicId(specification.taskId);

    // Step 1: Create milestones for SPARC phases
    const milestones = this.config.createMilestones
      ? await this.createMilestones(specification.phases || [])
      : [];

    // Step 2: Create parent epic issue
    const epicBody = this.generateEpicBody(specification, epicId);
    const epicLabels = this.buildEpicLabels(specification);

    const epicIssue = await this.octokit.issues.create({
      owner: this.owner,
      repo: this.repo,
      title: `[EPIC] ${specification.taskDescription}`,
      body: epicBody,
      labels: epicLabels,
      milestone: milestones.length > 0 ? milestones[0].number : undefined
    });

    // Step 3: Create child issues from user stories
    const childIssues = await this.createChildIssues(
      specification.userStories,
      epicIssue.data.number,
      milestones
    );

    // Step 4: Link issues to milestones based on phase
    await this.linkIssuesToMilestones(childIssues, milestones);

    // Step 5: Add epic reference comment
    await this.addEpicReferenceComment(epicIssue.data.number, epicId, childIssues);

    return {
      epicId,
      epicNumber: epicIssue.data.number,
      epicUrl: epicIssue.data.html_url,
      childIssues,
      milestones,
      repository: `${this.owner}/${this.repo}`,
      createdAt: new Date()
    };
  }

  /**
   * Create GitHub Milestones for SPARC phases
   *
   * Maps each SPARC phase to a GitHub milestone:
   * - specification → "SPARC: Requirements Complete"
   * - pseudocode → "SPARC: Design Complete"
   * - architecture → "SPARC: Architecture Approved"
   * - refinement → "SPARC: Implementation Complete"
   * - completion → "SPARC: Ready for Release"
   *
   * @param phases - SPARC phases to create milestones for
   * @returns Array of created milestones with phase mapping
   */
  async createMilestones(phases: SparcPhase[]): Promise<Milestone[]> {
    const phasesToCreate = phases.length > 0 ? phases : this.getDefaultPhases();
    const milestones: Milestone[] = [];

    for (const phase of phasesToCreate) {
      try {
        // Check if milestone already exists
        const existingMilestone = await this.findExistingMilestone(phase.title);

        if (existingMilestone) {
          milestones.push({
            number: existingMilestone.number,
            title: existingMilestone.title,
            url: existingMilestone.html_url,
            phase: phase.name,
            dueDate: existingMilestone.due_on || undefined
          });
          continue;
        }

        // Create new milestone
        const milestone = await this.octokit.issues.createMilestone({
          owner: this.owner,
          repo: this.repo,
          title: phase.title,
          description: phase.description || `SPARC ${phase.name} phase milestone`,
          due_on: phase.dueDate?.toISOString(),
          state: 'open'
        });

        milestones.push({
          number: milestone.data.number,
          title: milestone.data.title,
          url: milestone.data.html_url,
          phase: phase.name,
          dueDate: milestone.data.due_on || undefined
        });
      } catch (error) {
        console.error(`Failed to create milestone for phase ${phase.name}:`, error);
        throw new Error(`Milestone creation failed for phase ${phase.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return milestones;
  }

  /**
   * Create child issues from user stories
   *
   * Each user story becomes a separate GitHub issue linked to the epic.
   * Issues include:
   * - Full user story format (As a... I want... So that...)
   * - Acceptance criteria checklist
   * - Technical notes section
   * - Required capabilities as labels
   * - Link back to parent epic
   *
   * @param stories - User stories from SPARC specification
   * @param epicNumber - GitHub issue number of parent epic
   * @param milestones - Created milestones for phase assignment
   * @returns Array of created child issues
   */
  async createChildIssues(
    stories: UserStory[],
    epicNumber: number,
    milestones: Milestone[]
  ): Promise<ChildIssue[]> {
    const childIssues: ChildIssue[] = [];

    for (const story of stories) {
      try {
        // Determine milestone based on story phase
        const milestone = this.selectMilestoneForStory(story, milestones);

        // Build issue labels
        const issueLabels = this.buildIssueLabels(story, epicNumber);

        // Format issue body with user story format
        const issueBody = this.formatIssueBody(story, epicNumber);

        // Create child issue
        const issue = await this.octokit.issues.create({
          owner: this.owner,
          repo: this.repo,
          title: story.title,
          body: issueBody,
          labels: issueLabels,
          milestone: milestone?.number
        });

        childIssues.push({
          number: issue.data.number,
          title: issue.data.title,
          url: issue.data.html_url,
          milestone: milestone?.title,
          userStoryId: story.id,
          labels: issueLabels
        });
      } catch (error) {
        console.error(`Failed to create issue for story ${story.id}:`, error);
        throw new Error(`Child issue creation failed for story ${story.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return childIssues;
  }

  /**
   * Generate formatted epic body from specification
   *
   * Creates comprehensive epic description with:
   * - Executive summary
   * - Requirements checklist
   * - User stories overview
   * - Acceptance criteria
   * - Risks and constraints
   * - Agent coordination section
   * - SPARC metadata (hidden, machine-readable)
   *
   * @param spec - SPARC specification
   * @param epicId - Generated epic ID for traceability
   * @returns Formatted markdown body for GitHub issue
   */
  generateEpicBody(spec: SparcSpecification, epicId: string): string {
    const sections: string[] = [];

    // Epic header
    sections.push(`## Epic Context

**Epic ID**: \`${epicId}\`
**Task ID**: \`${spec.taskId}\`
**Generated**: ${new Date().toISOString()}
**Generator**: SPARC CTO-Flow Agent Management
**Repository**: ${this.owner}/${this.repo}

---`);

    // Executive summary
    sections.push(`## Executive Summary

${spec.taskDescription}
`);

    // Requirements section
    if (spec.requirements && spec.requirements.length > 0) {
      sections.push(`## Requirements

### Functional Requirements
${this.formatRequirementsByType(spec.requirements, 'functional')}

### Non-Functional Requirements
${this.formatRequirementsByType(spec.requirements, 'non-functional')}

### Technical Requirements
${this.formatRequirementsByType(spec.requirements, 'technical')}

### Business Requirements
${this.formatRequirementsByType(spec.requirements, 'business')}
`);
    }

    // User stories overview
    if (spec.userStories && spec.userStories.length > 0) {
      sections.push(`## User Stories

${spec.userStories.map(story => {
  const priority = story.priority === 'critical' ? '🔴' : story.priority === 'high' ? '🟡' : '🟢';
  return `- [ ] ${priority} **${story.title}** (${story.id})
  - As a ${story.asA}
  - I want ${story.iWant}
  - So that ${story.soThat}`;
}).join('\n\n')}
`);
    }

    // Acceptance criteria
    if (spec.acceptanceCriteria && spec.acceptanceCriteria.length > 0) {
      sections.push(`## Acceptance Criteria

${spec.acceptanceCriteria.map((criterion, index) =>
  `${index + 1}. [ ] ${criterion.criterion}${criterion.testable ? ' ✓' : ''}`
).join('\n')}
`);
    }

    // Constraints
    if (spec.constraints && spec.constraints.length > 0) {
      sections.push(`## Constraints

${spec.constraints.map((constraint, index) => `${index + 1}. ${constraint}`).join('\n')}
`);
    }

    // Risks
    if (spec.risks && spec.risks.length > 0) {
      sections.push(`## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
${spec.risks.map(risk =>
  `| ${risk.description} | ${this.formatSeverity(risk.severity)} | ${risk.mitigation} |`
).join('\n')}
`);
    }

    // Phase milestones table
    if (spec.phases && spec.phases.length > 0) {
      sections.push(`## SPARC Phases

| Phase | Milestone | Status |
|-------|-----------|--------|
${spec.phases.map(phase =>
  `| ${phase.name} | ${phase.title} | ⏳ Pending |`
).join('\n')}
`);
    }

    // Agent coordination section
    sections.push(`## Agent Coordination

<!-- This section is automatically updated by teammate agents -->

### Assigned Agents
_No agents assigned yet. Agents will self-select based on capability matching._

### Architectural Decisions (ADRs)
_No decisions recorded yet. ADRs will be added during architecture phase._

### Progress Updates
_Progress will appear here as agents work on issues._

---`);

    // Links to child issues
    sections.push(`## Child Issues

Child issues will be created for each user story. Use the \`${this.config.labelPrefix}epic\` label to track them.

---`);

    // Hidden metadata for machine parsing
    sections.push(`<!-- SPARC-EPIC-METADATA
epicId: ${epicId}
taskId: ${spec.taskId}
state: active
currentPhase: specification
version: 1
estimatedEffort: ${spec.estimatedEffort || 'not estimated'}
requirementsCount: ${spec.requirements?.length || 0}
userStoriesCount: ${spec.userStories?.length || 0}
acceptanceCriteriaCount: ${spec.acceptanceCriteria?.length || 0}
risksCount: ${spec.risks?.length || 0}
generatedAt: ${new Date().toISOString()}
syncEnabled: ${this.config.syncEnabled}
-->`);

    return sections.join('\n\n');
  }

  /**
   * Link child issues to appropriate milestones based on phase
   *
   * Updates issues with milestone assignments based on their phase property.
   * This ensures proper phase tracking and progress visualization.
   *
   * @param issues - Child issues to link
   * @param milestones - Available milestones
   */
  async linkIssuesToMilestones(issues: ChildIssue[], milestones: Milestone[]): Promise<void> {
    for (const issue of issues) {
      if (issue.milestone) {
        const milestone = milestones.find(m => m.title === issue.milestone);
        if (milestone) {
          try {
            await this.octokit.issues.update({
              owner: this.owner,
              repo: this.repo,
              issue_number: issue.number,
              milestone: milestone.number
            });
          } catch (error) {
            console.error(`Failed to link issue ${issue.number} to milestone:`, error);
          }
        }
      }
    }
  }

  /**
   * Add epic reference comment with child issue links
   *
   * Adds a summary comment to the epic listing all child issues
   * for easy navigation and tracking.
   *
   * @param epicNumber - Epic issue number
   * @param epicId - Epic ID for traceability
   * @param childIssues - Created child issues
   */
  private async addEpicReferenceComment(
    epicNumber: number,
    epicId: string,
    childIssues: ChildIssue[]
  ): Promise<void> {
    const comment = `## Child Issues Created

This epic has ${childIssues.length} child issue${childIssues.length !== 1 ? 's' : ''}:

${childIssues.map((issue, index) =>
  `${index + 1}. #${issue.number} - ${issue.title}${issue.milestone ? ` [${issue.milestone}]` : ''}`
).join('\n')}

---

**Epic ID**: \`${epicId}\`
**Agent Coordination**: Agents should claim issues by commenting with \`/claim\` or using the claude-flow CLI.
**Status Updates**: Post progress updates as comments on this epic.
`;

    try {
      await this.octokit.issues.createComment({
        owner: this.owner,
        repo: this.repo,
        issue_number: epicNumber,
        body: comment
      });
    } catch (error) {
      console.error('Failed to add epic reference comment:', error);
    }
  }

  /**
   * Format issue body for user story
   *
   * @param story - User story to format
   * @param epicNumber - Parent epic number
   * @returns Formatted markdown body
   */
  private formatIssueBody(story: UserStory, epicNumber: number): string {
    return `## User Story

**Parent Epic**: #${epicNumber}
**Story ID**: \`${story.id}\`
**Priority**: ${this.formatPriority(story.priority)}
${story.estimatedEffort ? `**Estimated Effort**: ${story.estimatedEffort} points` : ''}

### Description

As a **${story.asA}**,
I want **${story.iWant}**,
So that **${story.soThat}**.

${story.description}

### Acceptance Criteria

${story.acceptanceCriteria.map((criterion, index) =>
  `${index + 1}. [ ] ${criterion}`
).join('\n')}

### Technical Notes

${story.technicalNotes || '_To be determined during implementation phase._'}

${story.requiredCapabilities && story.requiredCapabilities.length > 0 ? `
### Required Capabilities

${story.requiredCapabilities.map(cap => `- ${cap}`).join('\n')}
` : ''}

---

## Agent Assignment

<!-- Updated automatically when agent claims issue -->
**Assigned Agent**: _Unassigned (waiting for agent self-selection)_
**Capability Match Score**: _N/A_
**Claimed At**: _Not claimed yet_

To claim this issue:
\`\`\`bash
npx claude-flow agent claim-issue ${story.id} #${epicNumber}
\`\`\`

---

<!-- ISSUE-METADATA
epicNumber: ${epicNumber}
storyId: ${story.id}
priority: ${story.priority}
estimatedEffort: ${story.estimatedEffort || 0}
phase: ${story.phase || 'refinement'}
requiredCapabilities: ${JSON.stringify(story.requiredCapabilities || [])}
-->`;
  }

  /**
   * Build labels for epic issue
   *
   * @param spec - SPARC specification
   * @returns Array of label names
   */
  private buildEpicLabels(spec: SparcSpecification): string[] {
    const labels = [...(this.config.defaultLabels || [])];

    // Add complexity label based on user story count
    const complexity = spec.userStories.length > 10 ? 'complexity-high' :
                       spec.userStories.length > 5 ? 'complexity-medium' : 'complexity-low';
    labels.push(complexity);

    // Add effort label if provided
    if (spec.estimatedEffort) {
      const effort = spec.estimatedEffort > 20 ? 'effort-high' :
                     spec.estimatedEffort > 10 ? 'effort-medium' : 'effort-low';
      labels.push(effort);
    }

    // Add risk labels
    if (spec.risks && spec.risks.length > 0) {
      const criticalRisks = spec.risks.filter(r => r.severity === 'critical').length;
      if (criticalRisks > 0) {
        labels.push('risk-critical');
      }
    }

    return labels;
  }

  /**
   * Build labels for child issue
   *
   * @param story - User story
   * @param epicNumber - Parent epic number
   * @returns Array of label names
   */
  private buildIssueLabels(story: UserStory, epicNumber: number): string[] {
    const labels: string[] = ['user-story', 'epic-child', `${this.config.labelPrefix}epic`];

    // Add priority label
    labels.push(`priority-${story.priority}`);

    // Add phase label
    if (story.phase) {
      labels.push(`${this.config.labelPrefix}${story.phase}`);
    }

    // Add capability labels
    if (story.requiredCapabilities) {
      story.requiredCapabilities.forEach(cap => {
        labels.push(`skill:${cap.toLowerCase().replace(/\s+/g, '-')}`);
      });
    }

    // Add custom labels from story
    if (story.labels) {
      labels.push(...story.labels);
    }

    return labels;
  }

  /**
   * Select appropriate milestone for user story
   *
   * @param story - User story
   * @param milestones - Available milestones
   * @returns Matching milestone or undefined
   */
  private selectMilestoneForStory(story: UserStory, milestones: Milestone[]): Milestone | undefined {
    if (!story.phase) {
      return milestones.find(m => m.phase === 'refinement');
    }
    return milestones.find(m => m.phase === story.phase);
  }

  /**
   * Format requirements by type
   *
   * @param requirements - All requirements
   * @param type - Requirement type to filter
   * @returns Formatted markdown list
   */
  private formatRequirementsByType(requirements: Requirement[], type: string): string {
    const filtered = requirements.filter(r => r.type === type);
    if (filtered.length === 0) {
      return '_None specified._';
    }
    return filtered.map((req, index) => {
      const priority = req.priority === 'critical' ? '🔴' : req.priority === 'high' ? '🟡' : '🟢';
      return `${index + 1}. [ ] ${priority} ${req.description} (\`${req.id}\`)`;
    }).join('\n');
  }

  /**
   * Format priority with emoji
   *
   * @param priority - Priority level
   * @returns Formatted priority string
   */
  private formatPriority(priority: string): string {
    const emoji = priority === 'critical' ? '🔴' : priority === 'high' ? '🟡' : priority === 'medium' ? '🔵' : '🟢';
    return `${emoji} ${priority.toUpperCase()}`;
  }

  /**
   * Format severity with emoji
   *
   * @param severity - Risk severity
   * @returns Formatted severity string
   */
  private formatSeverity(severity: string): string {
    const emoji = severity === 'critical' ? '🔴' : severity === 'high' ? '🟡' : severity === 'medium' ? '🔵' : '🟢';
    return `${emoji} ${severity}`;
  }

  /**
   * Generate unique epic ID
   *
   * @param taskId - SPARC task ID
   * @returns Unique epic ID
   */
  private generateEpicId(taskId: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `epic-${taskId}-${timestamp}`;
  }

  /**
   * Get default SPARC phases
   *
   * @returns Array of default phases
   */
  private getDefaultPhases(): SparcPhase[] {
    return [
      { name: 'specification', title: DEFAULT_PHASE_MILESTONES.specification },
      { name: 'pseudocode', title: DEFAULT_PHASE_MILESTONES.pseudocode },
      { name: 'architecture', title: DEFAULT_PHASE_MILESTONES.architecture },
      { name: 'refinement', title: DEFAULT_PHASE_MILESTONES.refinement },
      { name: 'completion', title: DEFAULT_PHASE_MILESTONES.completion }
    ];
  }

  /**
   * Find existing milestone by title
   *
   * @param title - Milestone title to search for
   * @returns Existing milestone or null
   */
  private async findExistingMilestone(title: string): Promise<GitHubMilestone | null> {
    try {
      const { data: milestones } = await this.octokit.issues.listMilestones({
        owner: this.owner,
        repo: this.repo,
        state: 'open'
      });

      return milestones.find(m => m.title === title) || null;
    } catch (error) {
      console.error('Error finding existing milestone:', error);
      return null;
    }
  }

  /**
   * Get repository information
   *
   * @returns Repository owner and name
   */
  getRepository(): { owner: string; repo: string } {
    return { owner: this.owner, repo: this.repo };
  }

  /**
   * Get exporter configuration
   *
   * @returns Current configuration
   */
  getConfig(): EpicExporterConfig {
    return { ...this.config };
  }
}

/**
 * Utility function to create SparcEpicExporter from environment
 *
 * @param repository - GitHub repository in 'owner/repo' format
 * @param config - Optional configuration
 * @returns Configured SparcEpicExporter instance
 */
export function createEpicExporter(
  repository: string,
  config?: Partial<EpicExporterConfig>
): SparcEpicExporter {
  return new SparcEpicExporter(repository, undefined, config);
}

/**
 * Export default for convenience
 */
export default SparcEpicExporter;
