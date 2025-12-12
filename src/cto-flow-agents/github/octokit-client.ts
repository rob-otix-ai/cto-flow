/**
 * Octokit Client for GitHub API
 *
 * Provides a unified interface for GitHub REST and GraphQL APIs.
 * Replaces gh CLI dependency for better portability and reliability.
 *
 * @module github/octokit-client
 */

import { Octokit } from '@octokit/rest';
import { graphql } from '@octokit/graphql';

// ============================================================================
// Type Definitions
// ============================================================================

export interface GitHubClientConfig {
  token?: string;
  owner: string;
  repo: string;
}

export interface ProjectV2 {
  id: string;
  number: number;
  title: string;
  url: string;
  closed: boolean;
  fields: {
    nodes: ProjectField[];
  };
}

export interface ProjectField {
  id: string;
  name: string;
  dataType: string;
  options?: Array<{ id: string; name: string }>;
}

export interface ProjectItem {
  id: string;
  type: string;
  fieldValues: {
    nodes: Array<{
      field: { name: string };
      name?: string;
      text?: string;
    }>;
  };
  content?: {
    __typename: string;
    number: number;
    title: string;
    state: string;
    assignees?: { nodes: Array<{ login: string }> };
  };
}

export interface IssueData {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: string[];
  assignees: string[];
  url: string;
}

export interface CreateProjectResult {
  id: string;
  number: number;
  url: string;
}

export interface CreateIssueResult {
  number: number;
  url: string;
  id: number;
}

export interface PullRequestData {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  merged: boolean;
  draft: boolean;
  head: { ref: string; sha: string };
  base: { ref: string };
  url: string;
  labels: string[];
  assignees: string[];
  reviewers: string[];
  linkedIssues: number[];
  createdAt: string;
  updatedAt: string;
  mergedAt?: string;
}

export interface CreatePullRequestResult {
  number: number;
  url: string;
  id: number;
  nodeId: string;
}

export interface PullRequestReview {
  id: number;
  user: string;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'PENDING' | 'DISMISSED';
  body: string;
  submittedAt: string;
}

export interface PullRequestCheck {
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | 'action_required' | 'skipped' | null;
}

// ============================================================================
// Octokit Client Class
// ============================================================================

export class OctokitClient {
  private octokit: Octokit;
  private graphqlWithAuth: typeof graphql;
  private owner: string;
  private repo: string;

  constructor(config: GitHubClientConfig) {
    const token = config.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

    if (!token) {
      throw new Error(
        'GitHub token required. Set GITHUB_TOKEN or GH_TOKEN environment variable, ' +
        'or pass token in config.'
      );
    }

    this.owner = config.owner;
    this.repo = config.repo;

    this.octokit = new Octokit({ auth: token });
    this.graphqlWithAuth = graphql.defaults({
      headers: { authorization: `token ${token}` },
    });
  }

  // ==========================================================================
  // Project Management (GraphQL - Projects v2)
  // ==========================================================================

  /**
   * Creates a new GitHub Project v2
   */
  async createProject(title: string, ownerId?: string): Promise<CreateProjectResult> {
    // First get the owner ID if not provided
    const ownerNodeId = ownerId || await this.getOwnerNodeId();

    const mutation = `
      mutation($ownerId: ID!, $title: String!) {
        createProjectV2(input: { ownerId: $ownerId, title: $title }) {
          projectV2 {
            id
            number
            url
          }
        }
      }
    `;

    const result: any = await this.graphqlWithAuth(mutation, {
      ownerId: ownerNodeId,
      title,
    });

    return {
      id: result.createProjectV2.projectV2.id,
      number: result.createProjectV2.projectV2.number,
      url: result.createProjectV2.projectV2.url,
    };
  }

  /**
   * Links a project to a repository
   * This makes the project show up in the repo's Projects tab
   */
  async linkProjectToRepo(projectId: string, repoId?: string): Promise<void> {
    const repositoryId = repoId || await this.getRepoNodeId();

    const mutation = `
      mutation($projectId: ID!, $repositoryId: ID!) {
        linkProjectV2ToRepository(input: { projectId: $projectId, repositoryId: $repositoryId }) {
          repository {
            id
          }
        }
      }
    `;

    await this.graphqlWithAuth(mutation, {
      projectId,
      repositoryId,
    });
  }

  /**
   * Gets the node ID for the repository
   */
  async getRepoNodeId(): Promise<string> {
    const query = `
      query($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          id
        }
      }
    `;

    const result: any = await this.graphqlWithAuth(query, {
      owner: this.owner,
      name: this.repo,
    });

    if (!result.repository?.id) {
      throw new Error(`Repository ${this.owner}/${this.repo} not found`);
    }

    return result.repository.id;
  }

  /**
   * Gets a project by number
   */
  async getProject(projectNumber: number): Promise<ProjectV2 | null> {
    const query = `
      query($owner: String!, $number: Int!) {
        user(login: $owner) {
          projectV2(number: $number) {
            id
            number
            title
            url
            closed
            fields(first: 20) {
              nodes {
                ... on ProjectV2Field {
                  id
                  name
                  dataType
                }
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  dataType
                  options {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      const result: any = await this.graphqlWithAuth(query, {
        owner: this.owner,
        number: projectNumber,
      });

      return result.user?.projectV2 || null;
    } catch (error: any) {
      // Try organization if user fails
      if (error.message?.includes('Could not resolve')) {
        return this.getOrgProject(projectNumber);
      }
      throw error;
    }
  }

  /**
   * Gets an organization project by number
   */
  private async getOrgProject(projectNumber: number): Promise<ProjectV2 | null> {
    const query = `
      query($owner: String!, $number: Int!) {
        organization(login: $owner) {
          projectV2(number: $number) {
            id
            number
            title
            url
            closed
            fields(first: 20) {
              nodes {
                ... on ProjectV2Field {
                  id
                  name
                  dataType
                }
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  dataType
                  options {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      }
    `;

    const result: any = await this.graphqlWithAuth(query, {
      owner: this.owner,
      number: projectNumber,
    });

    return result.organization?.projectV2 || null;
  }

  /**
   * Lists all projects for the owner
   */
  async listProjects(first: number = 20): Promise<ProjectV2[]> {
    const query = `
      query($owner: String!, $first: Int!) {
        user(login: $owner) {
          projectsV2(first: $first) {
            nodes {
              id
              number
              title
              url
              closed
            }
          }
        }
      }
    `;

    try {
      const result: any = await this.graphqlWithAuth(query, {
        owner: this.owner,
        first,
      });

      return result.user?.projectsV2?.nodes || [];
    } catch {
      // Try organization
      return this.listOrgProjects(first);
    }
  }

  private async listOrgProjects(first: number): Promise<ProjectV2[]> {
    const query = `
      query($owner: String!, $first: Int!) {
        organization(login: $owner) {
          projectsV2(first: $first) {
            nodes {
              id
              number
              title
              url
              closed
            }
          }
        }
      }
    `;

    const result: any = await this.graphqlWithAuth(query, {
      owner: this.owner,
      first,
    });

    return result.organization?.projectsV2?.nodes || [];
  }

  /**
   * Adds a single-select field to a project (like Status)
   */
  async addSingleSelectField(
    projectId: string,
    fieldName: string,
    options: string[]
  ): Promise<{ fieldId: string }> {
    const mutation = `
      mutation($projectId: ID!, $name: String!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
        createProjectV2Field(input: {
          projectId: $projectId,
          dataType: SINGLE_SELECT,
          name: $name,
          singleSelectOptions: $options
        }) {
          projectV2Field {
            ... on ProjectV2SingleSelectField {
              id
            }
          }
        }
      }
    `;

    const result: any = await this.graphqlWithAuth(mutation, {
      projectId,
      name: fieldName,
      options: options.map(name => ({ name, color: 'GRAY', description: name })),
    });

    return { fieldId: result.createProjectV2Field.projectV2Field.id };
  }

  /**
   * Adds an issue to a project with retry logic for temporary conflicts
   */
  async addIssueToProject(projectId: string, issueId: string, maxRetries = 3): Promise<{ itemId: string }> {
    const mutation = `
      mutation($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
          item {
            id
          }
        }
      }
    `;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result: any = await this.graphqlWithAuth(mutation, {
          projectId,
          contentId: issueId,
        });

        return { itemId: result.addProjectV2ItemById.item.id };
      } catch (error: any) {
        lastError = error;

        // Check if it's a temporary conflict error
        const isTemporaryConflict =
          error.message?.includes('temporary conflict') ||
          error.message?.includes('Please try again');

        if (isTemporaryConflict && attempt < maxRetries - 1) {
          // Exponential backoff: 500ms, 1000ms, 2000ms
          const delay = 500 * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        throw error;
      }
    }

    throw lastError;
  }

  /**
   * Updates a project item's field value
   */
  async updateProjectItemField(
    projectId: string,
    itemId: string,
    fieldId: string,
    optionId: string
  ): Promise<void> {
    const mutation = `
      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId,
          itemId: $itemId,
          fieldId: $fieldId,
          value: { singleSelectOptionId: $optionId }
        }) {
          projectV2Item {
            id
          }
        }
      }
    `;

    await this.graphqlWithAuth(mutation, {
      projectId,
      itemId,
      fieldId,
      optionId,
    });
  }

  /**
   * Gets a single-select field from a project by name
   */
  async getSingleSelectField(
    projectId: string,
    fieldName: string = 'Status'
  ): Promise<{ fieldId: string; options: Array<{ id: string; name: string }> } | null> {
    const query = `
      query($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            fields(first: 30) {
              nodes {
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  options {
                    id
                    name
                    color
                  }
                }
              }
            }
          }
        }
      }
    `;

    const result: any = await this.graphqlWithAuth(query, { projectId });
    const fields = result.node?.fields?.nodes || [];

    const field = fields.find((f: any) =>
      f.name?.toLowerCase() === fieldName.toLowerCase() && f.options
    );

    if (!field) return null;

    return {
      fieldId: field.id,
      options: field.options || [],
    };
  }

  /**
   * Gets or creates the CTO Workflow field with all required options.
   *
   * NOTE: GitHub's GraphQL API does NOT support adding options to existing
   * single-select fields. The only way to have custom options is to create
   * a new field with all options upfront.
   *
   * If "CTO Workflow" field doesn't exist, creates it with all options.
   * If it exists, returns the existing field (options cannot be modified via API).
   *
   * @see https://github.com/orgs/community/discussions/76762
   */
  async getOrCreateCTOWorkflowField(
    projectId: string,
    options: string[] = ['Backlog', 'Ready', 'In Progress', 'Review', 'Done', 'Blocked', 'Archived']
  ): Promise<{ fieldId: string; optionMap: Record<string, string>; created: boolean }> {
    // Check if CTO Workflow field already exists
    const existingField = await this.getSingleSelectField(projectId, 'CTO Workflow');

    if (existingField) {
      // Build option map from existing options
      const optionMap: Record<string, string> = {};
      for (const opt of existingField.options) {
        optionMap[opt.name] = opt.id;
      }
      return { fieldId: existingField.fieldId, optionMap, created: false };
    }

    // Create new CTO Workflow field with all options
    // Color mapping for status options
    const colorMap: Record<string, string> = {
      'Backlog': 'GRAY',
      'Ready': 'YELLOW',
      'In Progress': 'BLUE',
      'Review': 'PURPLE',
      'Done': 'GREEN',
      'Blocked': 'RED',
      'Archived': 'GRAY',
    };

    const { fieldId } = await this.addSingleSelectField(
      projectId,
      'CTO Workflow',
      options
    );

    // Build option map - need to fetch the field to get option IDs
    const newField = await this.getSingleSelectField(projectId, 'CTO Workflow');
    const optionMap: Record<string, string> = {};
    if (newField) {
      for (const opt of newField.options) {
        optionMap[opt.name] = opt.id;
      }
    }

    return { fieldId, optionMap, created: true };
  }

  /**
   * Ensures the project has a CTO Workflow field with required options.
   * Returns the field ID and a map of option names to IDs.
   *
   * NOTE: Due to GitHub API limitations, options cannot be added to existing fields.
   * This creates a new "CTO Workflow" field if it doesn't exist.
   */
  async ensureStatusFieldOptions(
    projectId: string,
    requiredOptions: string[] = ['Backlog', 'Ready', 'In Progress', 'Review', 'Done', 'Blocked', 'Archived']
  ): Promise<{ fieldId: string; optionMap: Record<string, string> }> {
    const { fieldId, optionMap } = await this.getOrCreateCTOWorkflowField(projectId, requiredOptions);
    return { fieldId, optionMap };
  }

  /**
   * Lists items in a project
   */
  async listProjectItems(projectId: string, first: number = 100): Promise<ProjectItem[]> {
    const query = `
      query($projectId: ID!, $first: Int!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: $first) {
              nodes {
                id
                type
                fieldValues(first: 10) {
                  nodes {
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      field { ... on ProjectV2SingleSelectField { name } }
                      name
                    }
                    ... on ProjectV2ItemFieldTextValue {
                      field { ... on ProjectV2Field { name } }
                      text
                    }
                  }
                }
                content {
                  __typename
                  ... on Issue {
                    number
                    title
                    state
                    assignees(first: 10) {
                      nodes { login }
                    }
                  }
                  ... on PullRequest {
                    number
                    title
                    state
                    assignees(first: 10) {
                      nodes { login }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const result: any = await this.graphqlWithAuth(query, {
      projectId,
      first,
    });

    return result.node?.items?.nodes || [];
  }

  // ==========================================================================
  // Issue Management (REST API)
  // ==========================================================================

  /**
   * Creates a new issue
   */
  async createIssue(
    title: string,
    body: string,
    labels?: string[],
    assignees?: string[]
  ): Promise<CreateIssueResult> {
    const response = await this.octokit.issues.create({
      owner: this.owner,
      repo: this.repo,
      title,
      body,
      labels,
      assignees,
    });

    return {
      number: response.data.number,
      url: response.data.html_url,
      id: response.data.id,
    };
  }

  /**
   * Gets an issue by number
   */
  async getIssue(issueNumber: number): Promise<IssueData | null> {
    try {
      const response = await this.octokit.issues.get({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
      });

      return {
        number: response.data.number,
        title: response.data.title,
        body: response.data.body || '',
        state: response.data.state,
        labels: response.data.labels.map((l: any) =>
          typeof l === 'string' ? l : l.name || ''
        ),
        assignees: response.data.assignees?.map((a: any) => a.login) || [],
        url: response.data.html_url,
      };
    } catch (error: any) {
      if (error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Updates an issue
   */
  async updateIssue(
    issueNumber: number,
    updates: {
      title?: string;
      body?: string;
      state?: 'open' | 'closed';
      labels?: string[];
      assignees?: string[];
    }
  ): Promise<void> {
    await this.octokit.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      ...updates,
    });
  }

  /**
   * Adds labels to an issue
   */
  async addLabels(issueNumber: number, labels: string[]): Promise<void> {
    await this.octokit.issues.addLabels({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      labels,
    });
  }

  /**
   * Removes a label from an issue
   */
  async removeLabel(issueNumber: number, label: string): Promise<void> {
    try {
      await this.octokit.issues.removeLabel({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        name: label,
      });
    } catch (error: any) {
      // Ignore if label doesn't exist
      if (error.status !== 404) {
        throw error;
      }
    }
  }

  /**
   * Adds assignees to an issue
   */
  async addAssignees(issueNumber: number, assignees: string[]): Promise<void> {
    await this.octokit.issues.addAssignees({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      assignees,
    });
  }

  /**
   * Removes assignees from an issue
   */
  async removeAssignees(issueNumber: number, assignees: string[]): Promise<void> {
    await this.octokit.issues.removeAssignees({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      assignees,
    });
  }

  /**
   * Creates a comment on an issue
   */
  async createComment(issueNumber: number, body: string): Promise<{ id: number }> {
    const response = await this.octokit.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      body,
    });

    return { id: response.data.id };
  }

  /**
   * Lists issues with optional filters
   */
  async listIssues(options?: {
    state?: 'open' | 'closed' | 'all';
    labels?: string;
    assignee?: string;
    per_page?: number;
  }): Promise<IssueData[]> {
    const response = await this.octokit.issues.listForRepo({
      owner: this.owner,
      repo: this.repo,
      state: options?.state || 'open',
      labels: options?.labels,
      assignee: options?.assignee,
      per_page: options?.per_page || 30,
    });

    return response.data
      .filter((item: any) => !item.pull_request) // Filter out PRs
      .map((issue: any) => ({
        number: issue.number,
        title: issue.title,
        body: issue.body || '',
        state: issue.state,
        labels: issue.labels.map((l: any) =>
          typeof l === 'string' ? l : l.name || ''
        ),
        assignees: issue.assignees?.map((a: any) => a.login) || [],
        url: issue.html_url,
      }));
  }

  /**
   * Closes an issue
   */
  async closeIssue(issueNumber: number): Promise<void> {
    await this.octokit.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      state: 'closed',
    });
  }

  // ==========================================================================
  // Pull Request Management (REST API)
  // ==========================================================================

  /**
   * Creates a new pull request
   */
  async createPullRequest(options: {
    title: string;
    body: string;
    head: string;
    base: string;
    draft?: boolean;
    labels?: string[];
    assignees?: string[];
    linkedIssues?: number[];
  }): Promise<CreatePullRequestResult> {
    // Append linked issues to body if provided
    let body = options.body;
    if (options.linkedIssues && options.linkedIssues.length > 0) {
      const issueLinks = options.linkedIssues
        .map(num => `Closes #${num}`)
        .join('\n');
      body += `\n\n---\n### Linked Issues\n${issueLinks}`;
    }

    const response = await this.octokit.pulls.create({
      owner: this.owner,
      repo: this.repo,
      title: options.title,
      body,
      head: options.head,
      base: options.base,
      draft: options.draft ?? false,
    });

    const prNumber = response.data.number;

    // Add labels if provided
    if (options.labels && options.labels.length > 0) {
      await this.octokit.issues.addLabels({
        owner: this.owner,
        repo: this.repo,
        issue_number: prNumber,
        labels: options.labels,
      });
    }

    // Add assignees if provided
    if (options.assignees && options.assignees.length > 0) {
      await this.octokit.issues.addAssignees({
        owner: this.owner,
        repo: this.repo,
        issue_number: prNumber,
        assignees: options.assignees,
      });
    }

    return {
      number: response.data.number,
      url: response.data.html_url,
      id: response.data.id,
      nodeId: response.data.node_id,
    };
  }

  /**
   * Gets a pull request by number with full details
   */
  async getPullRequest(prNumber: number): Promise<PullRequestData | null> {
    try {
      const response = await this.octokit.pulls.get({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
      });

      // Extract linked issues from body
      const linkedIssues: number[] = [];
      const bodyText = response.data.body || '';
      const issueMatches = bodyText.match(/(closes|fixes|resolves)\s+#(\d+)/gi) || [];
      for (const match of issueMatches) {
        const numMatch = match.match(/#(\d+)/);
        if (numMatch) {
          linkedIssues.push(parseInt(numMatch[1], 10));
        }
      }

      // Get reviewers
      const reviewersResponse = await this.octokit.pulls.listRequestedReviewers({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
      });

      return {
        number: response.data.number,
        title: response.data.title,
        body: response.data.body || '',
        state: response.data.state as 'open' | 'closed',
        merged: response.data.merged,
        draft: response.data.draft || false,
        head: { ref: response.data.head.ref, sha: response.data.head.sha },
        base: { ref: response.data.base.ref },
        url: response.data.html_url,
        labels: response.data.labels.map((l: any) => typeof l === 'string' ? l : l.name || ''),
        assignees: response.data.assignees?.map((a: any) => a.login) || [],
        reviewers: reviewersResponse.data.users?.map((u: any) => u.login) || [],
        linkedIssues,
        createdAt: response.data.created_at,
        updatedAt: response.data.updated_at,
        mergedAt: response.data.merged_at || undefined,
      };
    } catch (error: any) {
      if (error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Lists pull requests with optional filters
   */
  async listPullRequests(options?: {
    state?: 'open' | 'closed' | 'all';
    head?: string;
    base?: string;
    sort?: 'created' | 'updated' | 'popularity' | 'long-running';
    direction?: 'asc' | 'desc';
    per_page?: number;
  }): Promise<PullRequestData[]> {
    const response = await this.octokit.pulls.list({
      owner: this.owner,
      repo: this.repo,
      state: options?.state || 'open',
      head: options?.head,
      base: options?.base,
      sort: options?.sort || 'created',
      direction: options?.direction || 'desc',
      per_page: options?.per_page || 30,
    });

    return response.data.map((pr: any) => {
      // Extract linked issues
      const linkedIssues: number[] = [];
      const bodyText = pr.body || '';
      const issueMatches = bodyText.match(/(closes|fixes|resolves)\s+#(\d+)/gi) || [];
      for (const match of issueMatches) {
        const numMatch = match.match(/#(\d+)/);
        if (numMatch) {
          linkedIssues.push(parseInt(numMatch[1], 10));
        }
      }

      return {
        number: pr.number,
        title: pr.title,
        body: pr.body || '',
        state: pr.state as 'open' | 'closed',
        merged: pr.merged_at !== null,
        draft: pr.draft || false,
        head: { ref: pr.head.ref, sha: pr.head.sha },
        base: { ref: pr.base.ref },
        url: pr.html_url,
        labels: pr.labels.map((l: any) => typeof l === 'string' ? l : l.name || ''),
        assignees: pr.assignees?.map((a: any) => a.login) || [],
        reviewers: [],
        linkedIssues,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        mergedAt: pr.merged_at || undefined,
      };
    });
  }

  /**
   * Updates a pull request
   */
  async updatePullRequest(
    prNumber: number,
    updates: {
      title?: string;
      body?: string;
      state?: 'open' | 'closed';
      base?: string;
    }
  ): Promise<void> {
    await this.octokit.pulls.update({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      ...updates,
    });
  }

  /**
   * Merges a pull request
   */
  async mergePullRequest(
    prNumber: number,
    options?: {
      commit_title?: string;
      commit_message?: string;
      merge_method?: 'merge' | 'squash' | 'rebase';
    }
  ): Promise<{ merged: boolean; sha: string; message: string }> {
    const response = await this.octokit.pulls.merge({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      commit_title: options?.commit_title,
      commit_message: options?.commit_message,
      merge_method: options?.merge_method || 'squash',
    });

    return {
      merged: response.data.merged,
      sha: response.data.sha,
      message: response.data.message,
    };
  }

  /**
   * Requests reviewers for a pull request
   */
  async requestReviewers(
    prNumber: number,
    reviewers: string[],
    teamReviewers?: string[]
  ): Promise<void> {
    await this.octokit.pulls.requestReviewers({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      reviewers,
      team_reviewers: teamReviewers,
    });
  }

  /**
   * Gets reviews for a pull request
   */
  async listPullRequestReviews(prNumber: number): Promise<PullRequestReview[]> {
    const response = await this.octokit.pulls.listReviews({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
    });

    return response.data.map((r: any) => ({
      id: r.id,
      user: r.user?.login || 'unknown',
      state: r.state as PullRequestReview['state'],
      body: r.body || '',
      submittedAt: r.submitted_at || '',
    }));
  }

  /**
   * Creates a review on a pull request
   */
  async createPullRequestReview(
    prNumber: number,
    options: {
      body: string;
      event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
      comments?: Array<{
        path: string;
        position?: number;
        line?: number;
        body: string;
      }>;
    }
  ): Promise<{ id: number }> {
    const response = await this.octokit.pulls.createReview({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      body: options.body,
      event: options.event,
      comments: options.comments,
    });

    return { id: response.data.id };
  }

  /**
   * Gets check runs for a PR's head commit
   */
  async getPullRequestChecks(prNumber: number): Promise<PullRequestCheck[]> {
    // First get the PR to get the head SHA
    const pr = await this.getPullRequest(prNumber);
    if (!pr) {
      throw new Error(`PR #${prNumber} not found`);
    }

    const response = await this.octokit.checks.listForRef({
      owner: this.owner,
      repo: this.repo,
      ref: pr.head.sha,
    });

    return response.data.check_runs.map((check: any) => ({
      name: check.name,
      status: check.status as PullRequestCheck['status'],
      conclusion: check.conclusion as PullRequestCheck['conclusion'],
    }));
  }

  /**
   * Lists files changed in a pull request
   */
  async listPullRequestFiles(prNumber: number): Promise<Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
    patch?: string;
  }>> {
    const response = await this.octokit.pulls.listFiles({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
    });

    return response.data.map((f: any) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      changes: f.changes,
      patch: f.patch,
    }));
  }

  /**
   * Lists commits in a pull request
   */
  async listPRCommits(prNumber: number): Promise<Array<{ sha: string; message: string; author: string }>> {
    const response = await this.octokit.pulls.listCommits({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
    });

    return response.data.map((c: any) => ({
      sha: c.sha,
      message: c.commit.message,
      author: c.author?.login || c.commit.author?.name || 'unknown',
    }));
  }

  /**
   * Adds a PR to a GitHub Project
   */
  async addPullRequestToProject(projectId: string, prNumber: number): Promise<{ itemId: string }> {
    const prNodeId = await this.getPullRequestNodeId(prNumber);
    return this.addIssueToProject(projectId, prNodeId);
  }

  /**
   * Gets the node ID for a pull request
   */
  async getPullRequestNodeId(prNumber: number): Promise<string> {
    const query = `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            id
          }
        }
      }
    `;

    const result: any = await this.graphqlWithAuth(query, {
      owner: this.owner,
      repo: this.repo,
      number: prNumber,
    });

    if (!result.repository?.pullRequest?.id) {
      throw new Error(`PR #${prNumber} not found`);
    }

    return result.repository.pullRequest.id;
  }

  /**
   * Links a PR to an issue (by adding "Closes #N" to body)
   */
  async linkPullRequestToIssue(prNumber: number, issueNumber: number): Promise<void> {
    const pr = await this.getPullRequest(prNumber);
    if (!pr) {
      throw new Error(`PR #${prNumber} not found`);
    }

    // Check if already linked
    if (pr.linkedIssues.includes(issueNumber)) {
      return; // Already linked
    }

    // Append to body
    const newBody = pr.body + `\n\nCloses #${issueNumber}`;
    await this.updatePullRequest(prNumber, { body: newBody });
  }

  /**
   * Creates a branch for a task
   */
  async createBranch(branchName: string, fromRef?: string): Promise<{ ref: string; sha: string }> {
    // Get the SHA of the ref to branch from
    const baseRef = fromRef || 'main';
    const refResponse = await this.octokit.git.getRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${baseRef}`,
    }).catch(async () => {
      // Try 'master' if 'main' doesn't exist
      return this.octokit.git.getRef({
        owner: this.owner,
        repo: this.repo,
        ref: 'heads/master',
      });
    });

    const baseSha = refResponse.data.object.sha;

    // Create the new branch
    const createResponse = await this.octokit.git.createRef({
      owner: this.owner,
      repo: this.repo,
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    });

    return {
      ref: createResponse.data.ref,
      sha: createResponse.data.object.sha,
    };
  }

  /**
   * Deletes a branch
   */
  async deleteBranch(branchName: string): Promise<void> {
    await this.octokit.git.deleteRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${branchName}`,
    });
  }

  // ==========================================================================
  // Label Management (REST API)
  // ==========================================================================

  /**
   * Creates a label if it doesn't exist
   */
  async ensureLabel(name: string, color: string = 'ededed', description?: string): Promise<void> {
    try {
      await this.octokit.issues.getLabel({
        owner: this.owner,
        repo: this.repo,
        name,
      });
    } catch (error: any) {
      if (error.status === 404) {
        await this.octokit.issues.createLabel({
          owner: this.owner,
          repo: this.repo,
          name,
          color,
          description,
        });
      } else {
        throw error;
      }
    }
  }

  // ==========================================================================
  // Repository Management (REST API)
  // ==========================================================================

  /**
   * Creates a new repository
   */
  async createRepository(options: {
    name: string;
    description?: string;
    private?: boolean;
    autoInit?: boolean;
  }): Promise<{ name: string; fullName: string; url: string; cloneUrl: string }> {
    const response = await this.octokit.repos.createForAuthenticatedUser({
      name: options.name,
      description: options.description,
      private: options.private ?? false,
      auto_init: options.autoInit ?? true,
    });

    // Update internal repo reference
    this.repo = response.data.name;

    return {
      name: response.data.name,
      fullName: response.data.full_name,
      url: response.data.html_url,
      cloneUrl: response.data.clone_url,
    };
  }

  /**
   * Deletes a repository (use with caution!)
   */
  async deleteRepository(owner?: string, repo?: string): Promise<void> {
    await this.octokit.repos.delete({
      owner: owner || this.owner,
      repo: repo || this.repo,
    });
  }

  /**
   * Gets repository info
   */
  async getRepository(): Promise<{
    name: string;
    fullName: string;
    description: string;
    url: string;
    defaultBranch: string;
    private: boolean;
  } | null> {
    try {
      const response = await this.octokit.repos.get({
        owner: this.owner,
        repo: this.repo,
      });

      return {
        name: response.data.name,
        fullName: response.data.full_name,
        description: response.data.description || '',
        url: response.data.html_url,
        defaultBranch: response.data.default_branch,
        private: response.data.private,
      };
    } catch (error: any) {
      if (error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Checks if a repository exists
   */
  async repoExists(owner?: string, repo?: string): Promise<boolean> {
    try {
      await this.octokit.repos.get({
        owner: owner || this.owner,
        repo: repo || this.repo,
      });
      return true;
    } catch (error: any) {
      if (error.status === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Updates the internal repo reference
   */
  setRepo(repo: string): void {
    this.repo = repo;
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Gets the node ID for the owner (user or org)
   */
  private async getOwnerNodeId(): Promise<string> {
    // Try as user first
    try {
      const query = `query($login: String!) { user(login: $login) { id } }`;
      const result: any = await this.graphqlWithAuth(query, { login: this.owner });
      if (result.user?.id) {
        return result.user.id;
      }
    } catch {
      // Not a user, try org
    }

    // Try as organization
    const query = `query($login: String!) { organization(login: $login) { id } }`;
    const result: any = await this.graphqlWithAuth(query, { login: this.owner });
    if (result.organization?.id) {
      return result.organization.id;
    }

    throw new Error(`Could not find user or organization: ${this.owner}`);
  }

  /**
   * Gets the node ID for an issue
   */
  async getIssueNodeId(issueNumber: number): Promise<string> {
    const query = `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          issue(number: $number) {
            id
          }
        }
      }
    `;

    const result: any = await this.graphqlWithAuth(query, {
      owner: this.owner,
      repo: this.repo,
      number: issueNumber,
    });

    if (!result.repository?.issue?.id) {
      throw new Error(`Issue #${issueNumber} not found`);
    }

    return result.repository.issue.id;
  }

  /**
   * Gets owner and repo
   */
  getRepoInfo(): { owner: string; repo: string } {
    return { owner: this.owner, repo: this.repo };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createOctokitClient(config: GitHubClientConfig): OctokitClient {
  return new OctokitClient(config);
}

export default OctokitClient;
