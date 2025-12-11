/**
 * GitHub Webhook Server for Issue Assignment Events
 *
 * Listens for GitHub webhook events to detect:
 * - Issue assignment (issues.assigned)
 * - Issue unassignment (issues.unassigned)
 * - Issue labeled (issues.labeled) - for epic tracking
 * - Issue closed (issues.closed)
 *
 * When an agent is assigned to an issue, it triggers the hive-mind
 * to pick up and start working on that task.
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { createHmac } from 'crypto';
import { EventEmitter } from 'events';

// ============================================================================
// Type Definitions
// ============================================================================

export interface WebhookConfig {
  /** Port to listen on (default: 3456) */
  port?: number;
  /** Path for webhook endpoint (default: /webhook/github) */
  path?: string;
  /** GitHub webhook secret for signature verification */
  secret?: string;
  /** Repository filter (only process events from these repos) */
  repos?: string[];
  /** Epic label prefix to identify epic-related issues */
  epicLabelPrefix?: string;
}

export interface GitHubWebhookPayload {
  action: string;
  issue?: {
    number: number;
    title: string;
    state: 'open' | 'closed';
    html_url: string;
    labels: Array<{ name: string }>;
    assignees: Array<{ login: string }>;
    user: { login: string };
  };
  assignee?: {
    login: string;
  };
  label?: {
    name: string;
  };
  repository: {
    full_name: string;
    name: string;
    owner: { login: string };
  };
  sender: {
    login: string;
  };
}

export interface AssignmentEvent {
  type: 'assigned' | 'unassigned';
  issueNumber: number;
  issueTitle: string;
  issueUrl: string;
  assignee: string;
  repo: string;
  epicId?: string;
  labels: string[];
  timestamp: Date;
}

export interface IssueClosedEvent {
  type: 'closed';
  issueNumber: number;
  issueTitle: string;
  repo: string;
  epicId?: string;
  closedBy: string;
  timestamp: Date;
}

export interface WebhookEvent {
  event: string;
  payload: GitHubWebhookPayload;
  signature?: string;
  deliveryId?: string;
  timestamp: Date;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: Required<WebhookConfig> = {
  port: 3456,
  path: '/webhook/github',
  secret: '',
  repos: [],
  epicLabelPrefix: 'epic:',
};

// ============================================================================
// Webhook Server Class
// ============================================================================

export class GitHubWebhookServer extends EventEmitter {
  private config: Required<WebhookConfig>;
  private server: ReturnType<typeof createServer> | null = null;
  private isRunning = false;
  private processedDeliveries: Set<string> = new Set();
  private maxDeliveryHistory = 1000;

  constructor(config?: WebhookConfig) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the webhook server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Webhook server is already running');
    }

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', (error) => {
        this.emit('error', error);
        reject(error);
      });

      this.server.listen(this.config.port, () => {
        this.isRunning = true;
        this.emit('listening', {
          port: this.config.port,
          path: this.config.path,
        });
        resolve();
      });
    });
  }

  /**
   * Stop the webhook server
   */
  async stop(): Promise<void> {
    if (!this.isRunning || !this.server) {
      return;
    }

    return new Promise((resolve) => {
      this.server!.close(() => {
        this.isRunning = false;
        this.server = null;
        this.emit('stopped');
        resolve();
      });
    });
  }

  /**
   * Check if server is running
   */
  isListening(): boolean {
    return this.isRunning;
  }

  /**
   * Get server URL for configuring GitHub webhook
   */
  getWebhookUrl(host: string): string {
    const protocol = host.includes('localhost') ? 'http' : 'https';
    return `${protocol}://${host}:${this.config.port}${this.config.path}`;
  }

  /**
   * Handle incoming HTTP request
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Only handle POST to webhook path
    if (req.method !== 'POST' || req.url !== this.config.path) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    try {
      // Collect body
      const body = await this.collectBody(req);

      // Verify signature if secret is configured
      if (this.config.secret) {
        const signature = req.headers['x-hub-signature-256'] as string;
        if (!signature || !this.verifySignature(body, signature)) {
          res.writeHead(401);
          res.end('Invalid signature');
          this.emit('error', new Error('Invalid webhook signature'));
          return;
        }
      }

      // Parse payload
      const payload: GitHubWebhookPayload = JSON.parse(body);
      const event = req.headers['x-github-event'] as string;
      const deliveryId = req.headers['x-github-delivery'] as string;

      // Check for duplicate delivery
      if (deliveryId && this.processedDeliveries.has(deliveryId)) {
        res.writeHead(200);
        res.end('Already processed');
        return;
      }

      // Record delivery
      if (deliveryId) {
        this.processedDeliveries.add(deliveryId);
        // Trim history if needed
        if (this.processedDeliveries.size > this.maxDeliveryHistory) {
          const iterator = this.processedDeliveries.values();
          this.processedDeliveries.delete(iterator.next().value!);
        }
      }

      // Filter by repo if configured
      if (this.config.repos.length > 0) {
        if (!this.config.repos.includes(payload.repository.full_name)) {
          res.writeHead(200);
          res.end('Repo not in filter list');
          return;
        }
      }

      // Process the event
      await this.processEvent(event, payload, deliveryId);

      res.writeHead(200);
      res.end('OK');

    } catch (error) {
      this.emit('error', error);
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  }

  /**
   * Collect request body
   */
  private collectBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }

  /**
   * Verify GitHub webhook signature
   */
  private verifySignature(body: string, signature: string): boolean {
    const hmac = createHmac('sha256', this.config.secret);
    const digest = 'sha256=' + hmac.update(body).digest('hex');
    return signature === digest;
  }

  /**
   * Process GitHub event
   */
  private async processEvent(
    event: string,
    payload: GitHubWebhookPayload,
    deliveryId?: string
  ): Promise<void> {
    const webhookEvent: WebhookEvent = {
      event,
      payload,
      deliveryId,
      timestamp: new Date(),
    };

    // Emit raw event
    this.emit('webhook', webhookEvent);

    // Handle issue events
    if (event === 'issues' && payload.issue) {
      await this.handleIssueEvent(payload);
    }
  }

  /**
   * Handle issue-related events
   */
  private async handleIssueEvent(payload: GitHubWebhookPayload): Promise<void> {
    const issue = payload.issue!;
    const repo = payload.repository.full_name;

    // Extract epic ID from labels
    const epicLabel = issue.labels.find(l =>
      l.name.startsWith(this.config.epicLabelPrefix)
    );
    const epicId = epicLabel?.name.replace(this.config.epicLabelPrefix, '');

    switch (payload.action) {
      case 'assigned':
        if (payload.assignee) {
          const assignmentEvent: AssignmentEvent = {
            type: 'assigned',
            issueNumber: issue.number,
            issueTitle: issue.title,
            issueUrl: issue.html_url,
            assignee: payload.assignee.login,
            repo,
            epicId,
            labels: issue.labels.map(l => l.name),
            timestamp: new Date(),
          };
          this.emit('issue:assigned', assignmentEvent);
          this.emit('assignment', assignmentEvent);
        }
        break;

      case 'unassigned':
        if (payload.assignee) {
          const unassignmentEvent: AssignmentEvent = {
            type: 'unassigned',
            issueNumber: issue.number,
            issueTitle: issue.title,
            issueUrl: issue.html_url,
            assignee: payload.assignee.login,
            repo,
            epicId,
            labels: issue.labels.map(l => l.name),
            timestamp: new Date(),
          };
          this.emit('issue:unassigned', unassignmentEvent);
          this.emit('assignment', unassignmentEvent);
        }
        break;

      case 'closed':
        const closedEvent: IssueClosedEvent = {
          type: 'closed',
          issueNumber: issue.number,
          issueTitle: issue.title,
          repo,
          epicId,
          closedBy: payload.sender.login,
          timestamp: new Date(),
        };
        this.emit('issue:closed', closedEvent);
        break;

      case 'labeled':
        // Check if an epic label was added
        if (payload.label?.name.startsWith(this.config.epicLabelPrefix)) {
          this.emit('issue:epic-labeled', {
            issueNumber: issue.number,
            issueTitle: issue.title,
            repo,
            epicId: payload.label.name.replace(this.config.epicLabelPrefix, ''),
            timestamp: new Date(),
          });
        }
        break;

      case 'reopened':
        this.emit('issue:reopened', {
          issueNumber: issue.number,
          issueTitle: issue.title,
          repo,
          epicId,
          timestamp: new Date(),
        });
        break;
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a webhook server with default configuration
 */
export function createWebhookServer(config?: WebhookConfig): GitHubWebhookServer {
  return new GitHubWebhookServer(config);
}

/**
 * Create and start a webhook server
 */
export async function startWebhookServer(config?: WebhookConfig): Promise<GitHubWebhookServer> {
  const server = createWebhookServer(config);
  await server.start();
  return server;
}

// ============================================================================
// CLI Helper - Setup Instructions
// ============================================================================

export function getWebhookSetupInstructions(webhookUrl: string, secret?: string): string {
  return `
GitHub Webhook Setup Instructions
==================================

1. Go to your repository settings: Settings → Webhooks → Add webhook

2. Configure the webhook:
   Payload URL: ${webhookUrl}
   Content type: application/json
   ${secret ? `Secret: ${secret}` : 'Secret: (generate one and add to config)'}

3. Select events to trigger:
   - Issues (assigned, unassigned, closed, labeled, reopened)
   - Pull requests (optional, for PR linking)

4. Enable "Active" and save

Alternatively, use gh CLI:
  gh api repos/{owner}/{repo}/hooks -f url="${webhookUrl}" \\
    -f content_type=json \\
    -f events[]="issues" \\
    ${secret ? `-f secret="${secret}"` : ''}

Note: For local development, use a tunnel service like ngrok:
  ngrok http ${webhookUrl.match(/:(\d+)/)?.[1] || 3456}
`;
}

export default GitHubWebhookServer;
