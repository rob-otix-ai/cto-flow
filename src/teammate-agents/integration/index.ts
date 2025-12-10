/**
 * Teammate Agents Integration Module
 *
 * Exports for the unified Hive-Mind + GitHub + AgentDB integration
 */

export {
  HiveMindGitHubOrchestrator,
  createHiveMindOrchestrator,
  SPARC_PHASES,
  DEFAULT_PROJECT_STATUSES,
  type HiveMindConfig,
  type SparcPhase,
  type EpicPlan,
  type TaskPlan,
  type CreatedEpic,
  type CreatedTask,
} from './hive-mind-github.js';
