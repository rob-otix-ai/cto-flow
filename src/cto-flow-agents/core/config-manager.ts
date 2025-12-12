/**
 * Teammate Configuration Manager
 *
 * Manages configuration for the CTO-Flow Agent Management system.
 * Handles loading configuration from multiple sources with priority order:
 * 1. CLI flags (highest)
 * 2. Environment variables
 * 3. Config file
 * 4. Defaults (lowest)
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Complete configuration schema for CTO-Flow mode
 */
export interface CtoFlowConfig {
  enabled: boolean;
  github: {
    owner: string;
    repo: string;
    syncInterval: number;
    webhookEnabled: boolean;
    epicLabel: string;
  };
  agents: {
    autoAssignment: boolean;
    peerReview: boolean;
    contextSharing: boolean;
    assignmentThreshold: number;
  };
  memory: {
    persistToEpic: boolean;
    restoreFromEpic: boolean;
    ttl: number;
    namespacePrefix: string;
  };
  hooks: {
    preTaskLoad: boolean;
    postSpecGenerate: boolean;
    postTaskSync: boolean;
  };
}

/**
 * Configuration validation result
 */
export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: CtoFlowConfig = {
  enabled: false,
  github: {
    owner: '',
    repo: '',
    syncInterval: 30000, // 30 seconds
    webhookEnabled: false,
    epicLabel: 'epic'
  },
  agents: {
    autoAssignment: true,
    peerReview: false,
    contextSharing: true,
    assignmentThreshold: 50
  },
  memory: {
    persistToEpic: true,
    restoreFromEpic: true,
    ttl: 604800000, // 7 days in milliseconds
    namespacePrefix: 'epic'
  },
  hooks: {
    preTaskLoad: true,
    postSpecGenerate: true,
    postTaskSync: true
  }
};

/**
 * Environment variable mappings
 */
const ENV_VAR_MAPPINGS = {
  'CLAUDE_FLOW_CTOFLOW_MODE': 'enabled',
  'CLAUDE_FLOW_CTOFLOW_GITHUB_OWNER': 'github.owner',
  'CLAUDE_FLOW_CTOFLOW_GITHUB_REPO': 'github.repo',
  'CLAUDE_FLOW_CTOFLOW_SYNC_INTERVAL': 'github.syncInterval',
  'CLAUDE_FLOW_CTOFLOW_WEBHOOK_ENABLED': 'github.webhookEnabled',
  'CLAUDE_FLOW_CTOFLOW_EPIC_LABEL': 'github.epicLabel',
  'CLAUDE_FLOW_CTOFLOW_AUTO_ASSIGNMENT': 'agents.autoAssignment',
  'CLAUDE_FLOW_CTOFLOW_PEER_REVIEW': 'agents.peerReview',
  'CLAUDE_FLOW_CTOFLOW_CONTEXT_SHARING': 'agents.contextSharing',
  'CLAUDE_FLOW_CTOFLOW_ASSIGNMENT_THRESHOLD': 'agents.assignmentThreshold',
  'CLAUDE_FLOW_CTOFLOW_PERSIST_TO_EPIC': 'memory.persistToEpic',
  'CLAUDE_FLOW_CTOFLOW_RESTORE_FROM_EPIC': 'memory.restoreFromEpic',
  'CLAUDE_FLOW_CTOFLOW_MEMORY_TTL': 'memory.ttl',
  'CLAUDE_FLOW_CTOFLOW_NAMESPACE_PREFIX': 'memory.namespacePrefix'
};

/**
 * Teammate Configuration Manager
 *
 * Singleton class that manages configuration loading, validation, and access
 * for the CTO-Flow Agent Management system.
 */
export class CtoFlowConfigManager {
  private static instance: CtoFlowConfigManager | null = null;
  private config: CtoFlowConfig;
  private validationResult: ConfigValidationResult | null = null;
  private configFilePath: string | null = null;

  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor() {
    this.config = this.deepClone(DEFAULT_CONFIG);
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): CtoFlowConfigManager {
    if (!CtoFlowConfigManager.instance) {
      CtoFlowConfigManager.instance = new CtoFlowConfigManager();
    }
    return CtoFlowConfigManager.instance;
  }

  /**
   * Reset the singleton instance (useful for testing)
   */
  public static resetInstance(): void {
    CtoFlowConfigManager.instance = null;
  }

  /**
   * Load configuration from all sources with proper priority
   *
   * @param options - Optional configuration overrides
   * @returns The loaded configuration
   */
  public loadConfig(options: Partial<CtoFlowConfig> = {}): CtoFlowConfig {
    // Start with defaults
    this.config = this.deepClone(DEFAULT_CONFIG);

    // Load from config file if it exists
    this.loadFromConfigFile();

    // Load from environment variables
    this.loadFromEnvironment();

    // Apply CLI/programmatic overrides (highest priority)
    this.applyOverrides(options);

    // Validate the final configuration
    this.validationResult = this.validateConfig();

    return this.getConfig();
  }

  /**
   * Get the current configuration
   */
  public getConfig(): CtoFlowConfig {
    return this.deepClone(this.config);
  }

  /**
   * Get the validation result for the current configuration
   */
  public getValidationResult(): ConfigValidationResult | null {
    return this.validationResult;
  }

  /**
   * Update configuration at runtime
   *
   * @param updates - Partial configuration updates
   * @returns Updated configuration
   */
  public updateConfig(updates: Partial<CtoFlowConfig>): CtoFlowConfig {
    this.applyOverrides(updates);
    this.validationResult = this.validateConfig();
    return this.getConfig();
  }

  /**
   * Check if CTO-Flow mode is enabled
   */
  public isCtoFlowModeEnabled(): boolean {
    return this.config.enabled === true;
  }

  /**
   * Check if GitHub is properly configured
   */
  public isGitHubConfigured(): boolean {
    const { owner, repo } = this.config.github;
    return Boolean(owner && repo && owner.trim() !== '' && repo.trim() !== '');
  }

  /**
   * Check if CTO-Flow mode can be used (enabled and GitHub configured)
   */
  public canUseCtoFlowMode(): boolean {
    return this.isCtoFlowModeEnabled() && this.isGitHubConfigured();
  }

  /**
   * Validate the current configuration
   *
   * @returns Validation result with errors and warnings
   */
  public validateConfig(): ConfigValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate enabled state
    if (typeof this.config.enabled !== 'boolean') {
      errors.push('config.enabled must be a boolean');
    }

    // Validate GitHub configuration
    if (this.config.enabled) {
      if (!this.config.github.owner || this.config.github.owner.trim() === '') {
        errors.push('github.owner is required when CTO-Flow mode is enabled');
      }

      if (!this.config.github.repo || this.config.github.repo.trim() === '') {
        errors.push('github.repo is required when CTO-Flow mode is enabled');
      }

      if (this.config.github.owner && !/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(this.config.github.owner)) {
        errors.push('github.owner contains invalid characters');
      }

      if (this.config.github.repo && !/^[a-zA-Z0-9._-]+$/.test(this.config.github.repo)) {
        errors.push('github.repo contains invalid characters');
      }
    }

    if (typeof this.config.github.syncInterval !== 'number' || this.config.github.syncInterval < 1000) {
      errors.push('github.syncInterval must be a number >= 1000ms');
    }

    if (this.config.github.syncInterval < 10000) {
      warnings.push('github.syncInterval < 10000ms may cause excessive API calls');
    }

    if (typeof this.config.github.webhookEnabled !== 'boolean') {
      errors.push('github.webhookEnabled must be a boolean');
    }

    if (!this.config.github.epicLabel || this.config.github.epicLabel.trim() === '') {
      errors.push('github.epicLabel cannot be empty');
    }

    // Validate agents configuration
    if (typeof this.config.agents.autoAssignment !== 'boolean') {
      errors.push('agents.autoAssignment must be a boolean');
    }

    if (typeof this.config.agents.peerReview !== 'boolean') {
      errors.push('agents.peerReview must be a boolean');
    }

    if (typeof this.config.agents.contextSharing !== 'boolean') {
      errors.push('agents.contextSharing must be a boolean');
    }

    if (typeof this.config.agents.assignmentThreshold !== 'number' ||
        this.config.agents.assignmentThreshold < 0 ||
        this.config.agents.assignmentThreshold > 100) {
      errors.push('agents.assignmentThreshold must be a number between 0 and 100');
    }

    if (this.config.agents.assignmentThreshold < 30) {
      warnings.push('agents.assignmentThreshold < 30 may result in poor agent assignments');
    }

    // Validate memory configuration
    if (typeof this.config.memory.persistToEpic !== 'boolean') {
      errors.push('memory.persistToEpic must be a boolean');
    }

    if (typeof this.config.memory.restoreFromEpic !== 'boolean') {
      errors.push('memory.restoreFromEpic must be a boolean');
    }

    if (typeof this.config.memory.ttl !== 'number' || this.config.memory.ttl < 0) {
      errors.push('memory.ttl must be a non-negative number');
    }

    if (this.config.memory.ttl > 2592000000) { // 30 days
      warnings.push('memory.ttl > 30 days may cause memory bloat');
    }

    if (!this.config.memory.namespacePrefix || this.config.memory.namespacePrefix.trim() === '') {
      errors.push('memory.namespacePrefix cannot be empty');
    }

    // Validate hooks configuration
    if (typeof this.config.hooks.preTaskLoad !== 'boolean') {
      errors.push('hooks.preTaskLoad must be a boolean');
    }

    if (typeof this.config.hooks.postSpecGenerate !== 'boolean') {
      errors.push('hooks.postSpecGenerate must be a boolean');
    }

    if (typeof this.config.hooks.postTaskSync !== 'boolean') {
      errors.push('hooks.postTaskSync must be a boolean');
    }

    // Additional cross-field validations
    if (this.config.memory.restoreFromEpic && !this.config.enabled) {
      warnings.push('memory.restoreFromEpic is enabled but CTO-Flow mode is disabled');
    }

    if (this.config.agents.peerReview && !this.config.agents.autoAssignment) {
      warnings.push('agents.peerReview requires agents.autoAssignment to be effective');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Load configuration from a config file
   * Searches for .claudeflowrc, .claudeflowrc.json, or claude-flow.config.json
   */
  private loadFromConfigFile(): void {
    const possiblePaths = [
      path.join(process.cwd(), '.claudeflowrc'),
      path.join(process.cwd(), '.claudeflowrc.json'),
      path.join(process.cwd(), 'claude-flow.config.json'),
      path.join(process.cwd(), '.claude-flow', 'config.json')
    ];

    for (const configPath of possiblePaths) {
      if (fs.existsSync(configPath)) {
        try {
          const fileContent = fs.readFileSync(configPath, 'utf-8');
          const fileConfig = JSON.parse(fileContent);

          if (fileConfig.teammate) {
            this.mergeConfig(fileConfig.teammate);
            this.configFilePath = configPath;
            break;
          }
        } catch (error) {
          // Silently continue if file cannot be read or parsed
          // Validation will catch issues later
        }
      }
    }
  }

  /**
   * Load configuration from environment variables
   */
  private loadFromEnvironment(): void {
    for (const [envVar, configPath] of Object.entries(ENV_VAR_MAPPINGS)) {
      const value = process.env[envVar];
      if (value !== undefined) {
        this.setNestedValue(this.config, configPath, this.parseEnvValue(value));
      }
    }
  }

  /**
   * Parse environment variable value to appropriate type
   */
  private parseEnvValue(value: string): any {
    // Boolean values
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;

    // Number values
    const numValue = Number(value);
    if (!isNaN(numValue)) return numValue;

    // String values
    return value;
  }

  /**
   * Apply configuration overrides
   */
  private applyOverrides(overrides: Partial<CtoFlowConfig>): void {
    this.mergeConfig(overrides);
  }

  /**
   * Deep merge configuration objects
   */
  private mergeConfig(source: any, target: any = this.config): void {
    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          if (!target[key]) {
            target[key] = {};
          }
          this.mergeConfig(source[key], target[key]);
        } else {
          target[key] = source[key];
        }
      }
    }
  }

  /**
   * Set a nested value using dot notation path
   */
  private setNestedValue(obj: any, path: string, value: any): void {
    const keys = path.split('.');
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!current[key] || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }

    current[keys[keys.length - 1]] = value;
  }

  /**
   * Deep clone an object
   */
  private deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Get the path to the loaded config file (if any)
   */
  public getConfigFilePath(): string | null {
    return this.configFilePath;
  }

  /**
   * Export current configuration to a file
   *
   * @param filePath - Path to write the configuration file
   */
  public exportConfig(filePath: string): void {
    const configDir = path.dirname(filePath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    const exportData = {
      'cto-flow': this.config
    };

    fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2), 'utf-8');
    this.configFilePath = filePath;
  }
}

/**
 * Utility function: Check if CTO-Flow mode is enabled
 */
export function isCtoFlowModeEnabled(): boolean {
  return CtoFlowConfigManager.getInstance().isCtoFlowModeEnabled();
}

/**
 * Utility function: Check if GitHub is configured
 */
export function isGitHubConfigured(): boolean {
  return CtoFlowConfigManager.getInstance().isGitHubConfigured();
}

/**
 * Utility function: Check if CTO-Flow mode can be used
 */
export function canUseCtoFlowMode(): boolean {
  return CtoFlowConfigManager.getInstance().canUseCtoFlowMode();
}

/**
 * Utility function: Validate configuration
 */
export function validateConfig(): ConfigValidationResult {
  return CtoFlowConfigManager.getInstance().validateConfig();
}

/**
 * Utility function: Get current configuration
 */
export function getConfig(): CtoFlowConfig {
  return CtoFlowConfigManager.getInstance().getConfig();
}

/**
 * Utility function: Load configuration with options
 */
export function loadConfig(options: Partial<CtoFlowConfig> = {}): CtoFlowConfig {
  return CtoFlowConfigManager.getInstance().loadConfig(options);
}

/**
 * Export the singleton instance getter for advanced usage
 */
export function getConfigManager(): CtoFlowConfigManager {
  return CtoFlowConfigManager.getInstance();
}
