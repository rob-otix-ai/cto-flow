/**
 * Post-Review Hook for Handling Review Completion
 *
 * This hook triggers when a code review is completed and:
 * 1. Updates epic/task status based on review outcome
 * 2. Triggers auto-merge workflow if approved
 * 3. Creates follow-up tasks if changes are requested
 * 4. Updates progress tracking metrics
 * 5. Sends notifications to stakeholders
 *
 * Integrates with:
 * - CTO-Flow Review Swarm results
 * - GitHub PR review system
 * - Epic Progress Tracker
 * - Notification system
 *
 * @module hooks/post-review-hook
 */

import type {
  AgenticHookContext,
  HookHandler,
  HookHandlerResult,
  HookPayload,
  HookRegistration,
  SideEffect,
} from '../../services/agentic-flow-hooks/types.js';
import { agenticHookManager } from '../../services/agentic-flow-hooks/hook-manager.js';
import { Logger } from '../../core/logger.js';
import { canUseCtoFlowMode } from '../core/config-manager.js';
import { createHiveMindOrchestrator, HiveMindGitHubOrchestrator } from '../integration/hive-mind-github.js';
import { OctokitClient } from '../github/octokit-client.js';

const logger = new Logger({
  level: 'info',
  format: 'text',
  destination: 'console'
}, { prefix: 'PostReviewHook' });

// ===== Type Definitions =====

export interface ReviewResult {
  approved: boolean;
  score: number;
  threshold: number;
  reviewers: ReviewerResult[];
  criticalIssues: CriticalIssue[];
  recommendations: string[];
  swarmId: string;
}

export interface ReviewerResult {
  type: 'security' | 'quality' | 'architecture' | 'coverage';
  score: number;
  approved: boolean;
  issues: string[];
  weight: number;
}

export interface CriticalIssue {
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  file?: string;
  line?: number;
  recommendation?: string;
}

export interface PostReviewPayload extends HookPayload {
  prNumber: number;
  repo: string;
  epicId?: string;
  taskId?: string;
  issueNumber?: number;
  reviewResult: ReviewResult;
  branch: string;
  baseBranch: string;
}

export interface FollowUpTask {
  title: string;
  description: string;
  labels: string[];
  priority: 'critical' | 'high' | 'medium' | 'low';
  linkedPR: number;
  linkedIssue?: number;
}

// ===== Orchestrator Cache =====

const orchestratorCache: Map<string, HiveMindGitHubOrchestrator> = new Map();

async function getOrchestrator(repo: string): Promise<HiveMindGitHubOrchestrator | null> {
  if (!repo) return null;

  const parts = repo.split('/');
  if (parts.length !== 2) return null;

  const [owner, repoName] = parts;
  const cacheKey = `${owner}/${repoName}`;

  if (orchestratorCache.has(cacheKey)) {
    return orchestratorCache.get(cacheKey)!;
  }

  try {
    const orchestrator = createHiveMindOrchestrator({
      owner,
      repo: repoName,
      enableVectorSearch: false,
      enableLearning: true,
    });

    await orchestrator.initialize();
    orchestratorCache.set(cacheKey, orchestrator);

    return orchestrator;
  } catch (error) {
    logger.error('Failed to initialize orchestrator', error);
    return null;
  }
}

// ===== Review Processing Logic =====

/**
 * Generate follow-up tasks from critical issues
 */
function generateFollowUpTasks(
  prNumber: number,
  issueNumber: number | undefined,
  criticalIssues: CriticalIssue[]
): FollowUpTask[] {
  const tasks: FollowUpTask[] = [];

  // Group issues by type
  const issuesByType = new Map<string, CriticalIssue[]>();
  for (const issue of criticalIssues) {
    const existing = issuesByType.get(issue.type) || [];
    existing.push(issue);
    issuesByType.set(issue.type, existing);
  }

  // Create follow-up task for each issue type
  for (const [type, issues] of issuesByType) {
    const severities = issues.map(i => i.severity);
    const highestSeverity = severities.includes('critical') ? 'critical' :
                           severities.includes('high') ? 'high' :
                           severities.includes('medium') ? 'medium' : 'low';

    const description = issues.map((issue, idx) => {
      let desc = `${idx + 1}. **${issue.severity.toUpperCase()}**: ${issue.description}`;
      if (issue.file) desc += `\n   - File: \`${issue.file}\`${issue.line ? `:${issue.line}` : ''}`;
      if (issue.recommendation) desc += `\n   - Recommendation: ${issue.recommendation}`;
      return desc;
    }).join('\n\n');

    tasks.push({
      title: `[Follow-up] Address ${type} issues from PR #${prNumber}`,
      description: `## Issues to Address\n\n${description}\n\n---\n\n_Generated from code review of PR #${prNumber}_`,
      labels: [`type:${type}`, `priority:${highestSeverity}`, 'follow-up', 'review-feedback'],
      priority: highestSeverity,
      linkedPR: prNumber,
      linkedIssue: issueNumber,
    });
  }

  return tasks;
}

/**
 * Create follow-up issues for rejected review
 */
async function createFollowUpIssues(
  client: OctokitClient,
  tasks: FollowUpTask[]
): Promise<number[]> {
  const createdIssues: number[] = [];

  for (const task of tasks) {
    try {
      const issue = await client.createIssue({
        title: task.title,
        body: task.description,
        labels: task.labels,
      });

      createdIssues.push(issue.number);
      logger.info(`Created follow-up issue #${issue.number}: ${task.title}`);
    } catch (error) {
      logger.error(`Failed to create follow-up issue: ${task.title}`, error);
    }
  }

  return createdIssues;
}

/**
 * Add comment to PR with review summary
 */
async function addReviewSummaryComment(
  client: OctokitClient,
  prNumber: number,
  reviewResult: ReviewResult,
  followUpIssues: number[]
): Promise<void> {
  const { approved, score, threshold, reviewers, criticalIssues, recommendations } = reviewResult;

  const statusIcon = approved ? '✅' : '⚠️';
  const statusText = approved ? 'APPROVED' : 'CHANGES REQUESTED';

  let body = `## ${statusIcon} Review Completed - ${statusText}

**Overall Score:** ${(score * 100).toFixed(1)}% (threshold: ${(threshold * 100).toFixed(0)}%)

### Reviewer Breakdown

| Reviewer | Score | Weight | Status |
|----------|-------|--------|--------|
`;

  for (const reviewer of reviewers) {
    const icon = reviewer.approved ? '✅' : '❌';
    body += `| ${reviewer.type} | ${(reviewer.score * 100).toFixed(0)}% | ${(reviewer.weight * 100).toFixed(0)}% | ${icon} |\n`;
  }

  if (criticalIssues.length > 0) {
    body += `\n### ⚠️ Critical Issues (${criticalIssues.length})\n\n`;
    for (const issue of criticalIssues.slice(0, 5)) {
      body += `- **${issue.severity.toUpperCase()}** [${issue.type}]: ${issue.description}\n`;
      if (issue.file) body += `  - File: \`${issue.file}\`\n`;
    }
    if (criticalIssues.length > 5) {
      body += `\n_...and ${criticalIssues.length - 5} more issues_\n`;
    }
  }

  if (recommendations.length > 0) {
    body += `\n### 💡 Recommendations\n\n`;
    for (const rec of recommendations.slice(0, 5)) {
      body += `- ${rec}\n`;
    }
  }

  if (followUpIssues.length > 0) {
    body += `\n### 📋 Follow-up Tasks Created\n\n`;
    for (const issueNum of followUpIssues) {
      body += `- #${issueNum}\n`;
    }
  }

  if (approved) {
    body += `\n### ✅ Next Steps\n\nThis PR has been approved and will be automatically merged once all CI checks pass.\n`;
  } else {
    body += `\n### ⚠️ Next Steps\n\nPlease address the issues above before this PR can be merged. Follow-up tasks have been created to track required changes.\n`;
  }

  body += `\n---\n*Swarm ID: \`${reviewResult.swarmId}\`*\n*Powered by CTO-Flow Review System*`;

  await client.createComment(prNumber, body);
}

/**
 * Update PR labels based on review result
 */
async function updatePRLabels(
  client: OctokitClient,
  prNumber: number,
  approved: boolean
): Promise<void> {
  // Remove temporary labels
  const labelsToRemove = ['review-in-progress', 'pending-review'];
  for (const label of labelsToRemove) {
    try {
      await client.removeLabel(prNumber, label);
    } catch {
      // Label may not exist
    }
  }

  // Add result labels
  const labelsToAdd = ['reviewed'];
  if (approved) {
    labelsToAdd.push('ai-approved', 'ready-to-merge');
  } else {
    labelsToAdd.push('changes-requested', 'needs-work');
  }

  await client.addLabels(prNumber, labelsToAdd);
}

/**
 * Trigger auto-merge workflow if approved
 */
async function triggerAutoMerge(
  client: OctokitClient,
  prNumber: number,
  repo: string
): Promise<void> {
  try {
    // Enable auto-merge on the PR
    const [owner, repoName] = repo.split('/');

    // Note: This requires GitHub GraphQL API for enablePullRequestAutoMerge
    // For now, we rely on the cto-flow-merge.yml workflow to handle this
    logger.info(`Auto-merge will be handled by cto-flow-merge.yml for PR #${prNumber}`);
  } catch (error) {
    logger.error('Failed to enable auto-merge', error);
  }
}

// ===== Post-Review Hook Implementation =====

/**
 * Post-Review Hook
 *
 * Executes when a code review completes:
 * 1. Updates labels and status
 * 2. Creates follow-up tasks if needed
 * 3. Triggers auto-merge if approved
 * 4. Updates progress tracking
 */
export class PostReviewHook {
  createHandler(): HookHandler {
    return async (payload: HookPayload, context: AgenticHookContext): Promise<HookHandlerResult> => {
      if (!canUseCtoFlowMode()) {
        logger.debug('CTO-Flow mode disabled, skipping post-review hook');
        return { continue: true, modified: false };
      }

      const reviewPayload = payload as PostReviewPayload;

      // Validate required fields
      if (!reviewPayload.prNumber || !reviewPayload.repo || !reviewPayload.reviewResult) {
        logger.debug('Missing required fields for post-review hook');
        return { continue: true, modified: false };
      }

      logger.info(`Post-review: Processing PR #${reviewPayload.prNumber} - ${reviewPayload.reviewResult.approved ? 'APPROVED' : 'CHANGES_REQUESTED'}`);

      try {
        const sideEffects: SideEffect[] = [];
        const { reviewResult, prNumber, repo, epicId, taskId, issueNumber } = reviewPayload;

        // Get clients
        const [owner, repoName] = repo.split('/');
        const client = new OctokitClient({ owner, repo: repoName });
        const orchestrator = await getOrchestrator(repo);

        // Update PR labels
        await updatePRLabels(client, prNumber, reviewResult.approved);

        // Handle rejected review - create follow-up tasks
        let followUpIssues: number[] = [];
        if (!reviewResult.approved && reviewResult.criticalIssues.length > 0) {
          const followUpTasks = generateFollowUpTasks(
            prNumber,
            issueNumber,
            reviewResult.criticalIssues
          );
          followUpIssues = await createFollowUpIssues(client, followUpTasks);
        }

        // Add summary comment
        await addReviewSummaryComment(client, prNumber, reviewResult, followUpIssues);

        // Update epic status if available
        if (orchestrator && epicId && taskId) {
          const newStatus = reviewResult.approved ? 'Approved' : 'Review Failed';
          await orchestrator.updateTaskStatus(epicId, taskId, newStatus);
        }

        // Trigger auto-merge if approved
        if (reviewResult.approved) {
          await triggerAutoMerge(client, prNumber, repo);
        }

        // Store review completion event
        sideEffects.push({
          type: 'memory',
          action: 'store',
          data: {
            namespace: 'epic:review-completed',
            key: `${epicId || 'standalone'}:${prNumber}`,
            value: {
              prNumber,
              repo,
              epicId,
              taskId,
              issueNumber,
              approved: reviewResult.approved,
              score: reviewResult.score,
              criticalIssues: reviewResult.criticalIssues.length,
              followUpIssues,
              swarmId: reviewResult.swarmId,
              completedAt: new Date().toISOString(),
            },
          },
        });

        // Track metrics
        sideEffects.push({
          type: 'metric',
          action: 'increment',
          data: {
            name: reviewResult.approved ? 'review.approved' : 'review.rejected',
            value: 1,
          },
        });

        sideEffects.push({
          type: 'metric',
          action: 'gauge',
          data: {
            name: 'review.score',
            value: reviewResult.score,
          },
        });

        // Notification
        sideEffects.push({
          type: 'notification',
          action: 'send',
          data: {
            title: reviewResult.approved ? 'PR Approved' : 'Changes Requested',
            message: `PR #${prNumber} review completed with score ${(reviewResult.score * 100).toFixed(0)}%`,
            severity: reviewResult.approved ? 'info' : 'warning',
          },
        });

        logger.info(`Successfully processed review for PR #${prNumber}`);

        return {
          continue: true,
          modified: true,
          payload: {
            ...reviewPayload,
            reviewProcessed: true,
            followUpIssues,
          },
          sideEffects,
          metadata: {
            prNumber,
            approved: reviewResult.approved,
            score: reviewResult.score,
            followUpIssues,
          },
        };

      } catch (error) {
        logger.error('Post-review hook failed', error);
        return {
          continue: true,
          modified: false,
          metadata: {
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        };
      }
    };
  }

  register(): void {
    const registration: HookRegistration = {
      id: 'post-review-handler',
      type: 'workflow-complete',
      handler: this.createHandler(),
      priority: 90, // High priority to run after review
      filter: {
        patterns: [/^review:complete/, /^swarm:review/, /^pr:reviewed/],
      },
      options: {
        async: true,
        timeout: 60000, // 1 minute
        retries: 2,
      },
    };

    agenticHookManager.register(registration);
    logger.info('Registered post-review handler hook');
  }
}

// ===== Hook Registration Functions =====

/**
 * Register the post-review handler hook
 */
export function registerPostReviewHook(): void {
  logger.info('Registering post-review handler hook...');

  try {
    const hook = new PostReviewHook();
    hook.register();

    logger.info('Successfully registered post-review handler hook');
  } catch (error) {
    logger.error('Failed to register post-review handler hook', error);
    throw error;
  }
}

/**
 * Unregister the post-review handler hook
 */
export function unregisterPostReviewHook(): void {
  logger.info('Unregistering post-review handler hook...');

  try {
    agenticHookManager.unregister('post-review-handler');

    // Clear orchestrator cache
    for (const [key, orchestrator] of orchestratorCache) {
      orchestrator.shutdown().catch(() => {});
    }
    orchestratorCache.clear();

    logger.info('Successfully unregistered post-review handler hook');
  } catch (error) {
    logger.error('Failed to unregister post-review handler hook', error);
  }
}

/**
 * Manual trigger for handling review completion
 * Use when review completes outside of the normal hook flow
 */
export async function handleReviewComplete(
  prNumber: number,
  repo: string,
  reviewResult: ReviewResult,
  epicId?: string,
  taskId?: string,
  issueNumber?: number
): Promise<{
  processed: boolean;
  followUpIssues: number[];
}> {
  if (!canUseCtoFlowMode()) {
    logger.debug('CTO-Flow mode disabled');
    return { processed: false, followUpIssues: [] };
  }

  const payload: PostReviewPayload = {
    prNumber,
    repo,
    epicId,
    taskId,
    issueNumber,
    reviewResult,
    branch: '',
    baseBranch: 'main',
  };

  const context: AgenticHookContext = {
    executionId: `review-complete-${Date.now()}`,
    timestamp: Date.now(),
    metadata: {},
  };

  const hook = new PostReviewHook();
  const result = await hook.createHandler()(payload, context);

  return {
    processed: result.modified,
    followUpIssues: result.payload?.followUpIssues || [],
  };
}

// Export hook class
export default PostReviewHook;
