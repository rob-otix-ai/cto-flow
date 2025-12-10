---
name: "GitHub Projects Teammate"
description: "Orchestrate SPARC development workflows with GitHub Projects v2, Hive-Mind agent coordination, and AgentDB vector memory. Use when managing epics, coordinating multi-agent tasks, or implementing full project lifecycles with intelligent agent assignment."
---

# GitHub Projects Teammate Integration

Combine GitHub Projects v2 with Hive-Mind agent coordination and AgentDB semantic memory for intelligent project management.

## What This Skill Does

- Creates repositories and GitHub Projects programmatically
- Maps SPARC phases to project board columns
- Assigns tasks to agents using vector-based skill matching
- Tracks epic progress with persistent memory
- Enables semantic search across tasks and decisions

## Prerequisites

- GitHub token with repo and project scopes (GITHUB_TOKEN)
- claude-flow with teammate-agents module
- Optional: AgentDB for vector search acceleration

---

## Quick Start

### 1. Create a Full Project Lifecycle

```typescript
import { createOctokitClient } from 'claude-flow/teammate-agents/github';
import { createUserProjectManager } from 'claude-flow/teammate-agents/github';
import { createAgentDBEpicMemory } from 'claude-flow/teammate-agents/memory';

// Initialize
const client = createOctokitClient({ owner: 'your-org', repo: 'placeholder' });
const memory = createAgentDBEpicMemory({ enableVectorSearch: true });
await memory.initialize();

// Create repository
const repo = await client.createRepository({
  name: 'my-new-project',
  description: 'SPARC-managed project',
  autoInit: true,
});

// Create project linked to repo
const manager = createUserProjectManager('your-org', repo.name);
const project = await manager.createProject({
  title: '[SPARC Epic] Feature Implementation',
  description: 'Managed by Hive-Mind',
  epicId: `epic-${Date.now()}`,
  createStatusField: true,
  statusOptions: ['Backlog', 'Specification', 'Architecture', 'In Progress', 'Review', 'Done'],
});
```

### 2. Register Hive-Mind Agents

```typescript
// Register agents with skill profiles
await memory.registerAgent({
  agentId: 'researcher-1',
  name: 'Research Agent',
  type: 'researcher',
  skills: ['research', 'analysis', 'documentation', 'requirements'],
  domains: ['backend', 'architecture'],
  capabilities: ['search', 'read', 'summarize'],
  performanceHistory: [],
  metadata: {},
});

await memory.registerAgent({
  agentId: 'coder-1',
  name: 'Coder Agent',
  type: 'coder',
  skills: ['typescript', 'nodejs', 'api', 'database', 'testing'],
  domains: ['backend', 'frontend'],
  capabilities: ['edit', 'bash', 'test'],
  performanceHistory: [],
  metadata: {},
});
```

### 3. Find Best Agent for Task

```typescript
const task = {
  title: 'Implement REST API endpoints',
  description: 'Build authentication endpoints with JWT',
  skills: ['typescript', 'api', 'authentication'],
  priority: 'high',
};

const matches = await memory.findMatchingAgents(task, 3);
// Returns agents sorted by score with breakdown:
// [{ agent: {...}, score: 95.2, breakdown: { vectorSimilarity: 92, skillMatch: 100, performance: 85 }}]

const bestAgent = matches[0].agent;
console.log(`Best match: ${bestAgent.name} (${matches[0].score.toFixed(1)}%)`);
```

---

## SPARC Phase Mapping

The skill maps SPARC methodology phases to GitHub Project columns:

| SPARC Phase | Project Status | Primary Agent | Activities |
|-------------|----------------|---------------|------------|
| Specification | Specification | Researcher | Requirements gathering, constraints |
| Pseudocode | Design | Architect | Algorithm design, flow diagrams |
| Architecture | Architecture | Architect | System design, component boundaries |
| Refinement | In Progress | Coder + Tester | TDD implementation |
| Completion | Review → Done | Reviewer | Security audit, documentation |

---

## Hive-Mind Coordination Pattern

```
                    ┌─────────────────┐
                    │     QUEEN       │
                    │  (Orchestrator) │
                    └────────┬────────┘
                             │
         ┌───────────┬───────┴───────┬───────────┐
         ▼           ▼               ▼           ▼
   ┌──────────┐ ┌──────────┐  ┌──────────┐ ┌──────────┐
   │Researcher│ │ Architect│  │  Coder   │ │ Reviewer │
   │  Agent   │ │  Agent   │  │  Agent   │ │  Agent   │
   └────┬─────┘ └────┬─────┘  └────┬─────┘ └────┬─────┘
        │            │             │            │
        └────────────┴──────┬──────┴────────────┘
                            │
                   ┌────────┴────────┐
                   │ GitHub Projects │
                   │ + AgentDB Memory│
                   └─────────────────┘
```

---

## Vector-Based Agent Matching

The skill uses embeddings to match tasks to agents:

```typescript
// Agent matching considers:
// 1. Vector similarity (40%) - Semantic match of task to agent profile
// 2. Skill overlap (40%) - Direct skill keyword matching
// 3. Performance history (20%) - Past success rate

const matches = await memory.findMatchingAgents({
  title: 'Implement OAuth2 authentication',
  description: 'Add Google and GitHub OAuth providers',
  skills: ['oauth', 'security', 'nodejs'],
  priority: 'critical',
});

// Example output:
// Agent: Security Expert - Score: 94.2%
//   - Vector Similarity: 91%
//   - Skill Match: 100%
//   - Performance: 88%
```

---

## Creating Issues with Agent Assignment

```typescript
// Create epic issue
const epicIssue = await client.createIssue(
  '[SPARC EPIC] Authentication System',
  `## Epic Overview

Implement secure authentication using SPARC methodology.

## SPARC Phases
- [ ] Specification: Define requirements
- [ ] Architecture: Design system
- [ ] Refinement: TDD implementation
- [ ] Completion: Security review

**Epic ID**: \`${epicId}\`
**Managed by**: Hive-Mind Coordination`,
  ['epic', 'sparc', `epic:${epicId}`]
);

// Create task with agent assignment
const taskIssue = await client.createIssue(
  'Implement login endpoint',
  `## Task Description

Build POST /api/auth/login endpoint.

---
## Hive-Mind Assignment
**Agent**: ${bestAgent.name}
**Score**: ${matches[0].score.toFixed(1)}%
**Skills**: ${bestAgent.skills.join(', ')}

**SPARC Phase**: Refinement
**Parent Epic**: #${epicIssue.number}`,
  ['task:child', `epic:${epicId}`, `agent:${bestAgent.type}`, 'sparc:refinement']
);

// Add to project
const taskNodeId = await client.getIssueNodeId(taskIssue.number);
await client.addIssueToProject(project.id, taskNodeId);
```

---

## Finding Similar Tasks

Use semantic search to find similar past tasks:

```typescript
const similar = await memory.findSimilarTasks(
  'Implement rate limiting for API endpoints',
  5
);

for (const result of similar) {
  console.log(`Similar: ${result.value.title} (${(result.similarity * 100).toFixed(1)}%)`);
}
```

---

## Recording Assignment Outcomes (Learning)

The system learns from assignment outcomes:

```typescript
await memory.recordAssignmentOutcome(assignment, {
  success: true,
  quality: 0.92, // 0-1 scale
  completionTime: 4.5, // hours
  feedback: 'Excellent implementation with comprehensive tests',
});

// Future matching will consider this performance data
```

---

## Integration with MCP Tools

Use with claude-flow MCP tools:

```bash
# Initialize swarm
mcp__claude-flow__swarm_init { topology: "hierarchical", maxAgents: 5 }

# Spawn agents
mcp__claude-flow__agent_spawn { type: "researcher", name: "Research Agent" }
mcp__claude-flow__agent_spawn { type: "coder", name: "Coder Agent" }

# Orchestrate task
mcp__claude-flow__task_orchestrate {
  task: "Implement authentication system with SPARC methodology",
  strategy: "adaptive",
  priority: "high"
}
```

---

## Test Scripts

Run integration tests:

```bash
# Full project lifecycle
node --experimental-strip-types scripts/test-full-project-lifecycle.ts

# SPARC + Hive-Mind integration
node --experimental-strip-types scripts/test-sparc-hivemind-integration.ts

# Cleanup test data
node --experimental-strip-types scripts/cleanup-test-data.ts
```

---

## Environment Setup

```bash
# .env file
GITHUB_TOKEN=ghp_your_token_here
GH_TOKEN=ghp_your_token_here  # Alternative

# Or export directly
export GITHUB_TOKEN=ghp_your_token_here
```

---

## API Reference

### OctokitClient

```typescript
// Repository management
createRepository(options): Promise<RepoInfo>
deleteRepository(owner?, repo?): Promise<void>
getRepository(): Promise<RepoInfo | null>

// Project management
createProject(title, ownerId?): Promise<ProjectResult>
linkProjectToRepo(projectId, repoId?): Promise<void>
addIssueToProject(projectId, issueId): Promise<ItemResult>

// Issue management
createIssue(title, body, labels?, assignees?): Promise<IssueResult>
getIssue(number): Promise<IssueData | null>
closeIssue(number): Promise<void>
addLabels(number, labels): Promise<void>
createComment(number, body): Promise<CommentResult>
```

### AgentDBEpicMemory

```typescript
// Agent management
registerAgent(profile): Promise<string>
findMatchingAgents(task, limit?): Promise<AgentMatch[]>
getAgent(id): AgentProfile | undefined

// Task embeddings
storeTaskWithEmbedding(task, context?): Promise<void>
findSimilarTasks(description, limit?): Promise<SearchResult[]>

// Decision embeddings
storeDecisionWithEmbedding(decision): Promise<string>
findSimilarDecisions(context, limit?): Promise<SearchResult[]>

// Learning
recordAssignmentOutcome(assignment, outcome): Promise<void>
```

---

## Troubleshooting

### "Repository not found" error
- Ensure GITHUB_TOKEN has `repo` scope
- Check owner/repo spelling

### "Could not resolve user" error
- Token user doesn't match owner
- Try organization endpoint

### Vector search not working
- AgentDB may not be initialized
- Falls back to keyword matching automatically

### Labels return 404
- Normal behavior - creates label if missing
- Not an error, just API check

---

## Related Skills

- `sparc-methodology` - Full SPARC development framework
- `hive-mind-advanced` - Queen-led collective intelligence
- `agentdb-vector-search` - Semantic search optimization
- `teammate-agents` - Persistent context via GitHub Epics
