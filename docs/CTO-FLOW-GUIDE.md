# CTO-Flow: Teammate-Driven SPARC Workflow

A workflow system for Claude-Flow that combines **Teammate Agents** (autonomous, self-selecting collaborators), **SPARC methodology** (structured task approach), and **GitHub Projects** (CTO workflow management).

## Table of Contents

1. [The Three Integrated Concepts](#the-three-integrated-concepts)
2. [How They Work Together](#how-they-work-together)
3. [Setup](#setup)
4. [The Epic-Centric Workflow](#the-epic-centric-workflow)
5. [Teammate Agent Operations](#teammate-agent-operations)
6. [SPARC-Informed Task Prompts](#sparc-informed-task-prompts)
7. [CLI Commands Reference](#cli-commands-reference)
8. [GraphQL Reference](#graphql-reference)

---

## The Three Integrated Concepts

### 1. Teammate Agents (The Collaborators)

Agents aren't task-runners - they're **autonomous teammates** who:

- **Self-select work** from epic backlogs based on their capabilities
- **Persist across sessions** using GitHub Epics as memory
- **Peer-validate** each other's work (agent-to-agent review)
- **Restore context** from epics when starting new sessions
- **Share knowledge** through the epic memory system

### 2. SPARC Methodology (The Structure)

SPARC doesn't run separately - it **informs how every task is approached**:

- **S**pecification → What the task requires (from epic/issue)
- **P**seudocode → How to approach it (design before code)
- **A**rchitecture → Where code goes (types/interfaces first)
- **R**efinement → Build process (TDD implementation)
- **C**ompletion → Done criteria (tests pass, peer-validated)

### 3. CTO-Flow Workflow (The Process)

GitHub Projects V2 with a "CTO Workflow" field manages the flow:

| Status | What Happens |
|--------|--------------|
| **Backlog** | Tasks waiting for CTO prioritization |
| **Ready** | CTO-approved, available for teammate self-selection |
| **In Progress** | Teammate agent is working (context stored in epic) |
| **Review** | Ready for peer validation by reviewer agents |
| **Done** | Peer-validated, merged, complete |

---

## How They Work Together

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CTO-FLOW INTEGRATED SYSTEM                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐                                                            │
│  │   EPIC      │◀── GitHub Epic = Persistent Memory Container               │
│  │ (Context)   │    - Architectural decisions (ADRs)                        │
│  │             │    - Progress state                                        │
│  │             │    - Agent assignments                                     │
│  │             │    - Shared knowledge                                      │
│  └──────┬──────┘                                                            │
│         │                                                                   │
│         │ Issues belong to Epic                                             │
│         ▼                                                                   │
│  ┌─────────────────────────────────────────────────────────────────┐        │
│  │                     CTO WORKFLOW STATES                         │        │
│  ├─────────────────────────────────────────────────────────────────┤        │
│  │                                                                 │        │
│  │  BACKLOG ──▶ READY ──▶ IN PROGRESS ──▶ REVIEW ──▶ DONE         │        │
│  │     │          │            │             │                     │        │
│  │     │          │            │             │                     │        │
│  │     │    Teammate      Teammate      Teammate                   │        │
│  │    CTO    agents        agent        reviewer                   │        │
│  │  reviews  SELF-SELECT   works        agents                     │        │
│  │           based on      (SPARC-      PEER-VALIDATE              │        │
│  │           capabilities  informed)                               │        │
│  │                                                                 │        │
│  └─────────────────────────────────────────────────────────────────┘        │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────┐        │
│  │                    SPARC INFORMS EVERY TASK                     │        │
│  ├─────────────────────────────────────────────────────────────────┤        │
│  │                                                                 │        │
│  │  S: Read requirements from epic/issue                           │        │
│  │  P: Design algorithm before coding                              │        │
│  │  A: Define types/interfaces first                               │        │
│  │  R: TDD - write tests first, then implementation                │        │
│  │  C: Create PR, request peer validation                          │        │
│  │                                                                 │        │
│  └─────────────────────────────────────────────────────────────────┘        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Differences from Traditional Orchestration

| Traditional Approach | Teammate-Driven Approach |
|---------------------|-------------------------|
| Coordinator assigns tasks to agents | Agents self-select from backlog |
| Agents are ephemeral (do task, done) | Agents persist via epic memory |
| Human reviews PRs | Peer agents validate work |
| Context lost between sessions | Context restored from epic |
| Manual coordination | Autonomous collaboration |

---

## Setup

### 1. Enable Teammate Mode

```bash
# Via config
npx claude-flow config set teammate.enabled true

# Or via environment
export TEAMMATE_MODE=true

# Or per-command
npx claude-flow epic list --teammate-mode
```

### 2. Create GitHub Project with CTO Workflow

Create a GitHub Project V2 with a single-select field called `CTO Workflow`:

| Option | Description |
|--------|-------------|
| **Backlog** | Tasks waiting to be prioritized |
| **Ready** | CTO-approved, available for agent self-selection |
| **In Progress** | Being worked on by a teammate agent |
| **Review** | PR created, ready for peer validation |
| **Done** | Peer-validated and merged |

### 3. Get Project IDs

```bash
curl -s -H "Authorization: bearer $GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST https://api.github.com/graphql \
  -d '{"query":"query { viewer { projectV2(number: PROJECT_NUMBER) { id title fields(first: 20) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } } } } } }"}'
```

Save:
```
Project ID:        PVT_kwHO...
Field ID:          PVTSSF_lAHO...
Option IDs:        (one for each status)
```

### 4. Add MCP Server

```bash
claude mcp add claude-flow npx claude-flow@alpha mcp start
```

---

## The Epic-Centric Workflow

### Epics as Memory Containers

In the teammate model, **GitHub Epics serve as persistent memory** that survives across agent sessions:

```typescript
interface EpicContext {
  // The epic itself
  epicId: string;
  title: string;
  description: string;

  // Persistent memory
  architecturalDecisions: ADR[];      // Decisions made
  technicalConstraints: Constraint[];  // Boundaries set
  agentAssignments: Assignment[];      // Who's working on what
  progressMetrics: Metrics;            // How we're doing
  sharedKnowledge: Knowledge[];        // Learnings shared between agents

  // State that survives sessions
  currentPhase: SPARCPhase;
  lastCheckpoint: Date;
}
```

### Creating an Epic Project

```bash
# Create epic with linked GitHub Project
npx claude-flow cto-project create my-feature "Implement User Authentication" \
  --repo owner/repo \
  --teammate-mode
```

This creates:
1. A GitHub Project linked to the epic
2. An epic tracking issue
3. Memory namespace for the epic

### Adding Tasks to Epic

```bash
# Add tasks that agents can self-select
npx claude-flow cto-project add-task my-feature "Implement OAuth2 flow" \
  --priority high \
  --teammate-mode

npx claude-flow cto-project add-task my-feature "Add password reset" \
  --priority medium \
  --teammate-mode
```

---

## Teammate Agent Operations

### Agent Self-Selection

Teammate agents **watch for available issues** and self-select based on capabilities:

```bash
# Find issues available for an agent with specific capabilities
npx claude-flow cto-project available \
  --capabilities "typescript,api,authentication" \
  --repo owner/repo \
  --teammate-mode
```

Output:
```
Available Issues (3):

#42 Implement OAuth2 flow
  Epic: my-feature | Priority: high
  Required: typescript, oauth, api

#43 Add password reset
  Epic: my-feature | Priority: medium
  Required: typescript, email

#44 Setup JWT tokens
  Epic: my-feature | Priority: high
  Required: typescript, security
```

### Context Restoration

When an agent starts (or restarts), it **restores context from the epic**:

```bash
# Restore context for an agent working on an epic
npx claude-flow teammate context-restore \
  --epic my-feature \
  --agent coder-001 \
  --strategy summary \
  --teammate-mode
```

This loads:
- Epic description and requirements
- Architectural decisions made so far
- Agent's previous work on this epic
- Recent communications from other agents
- Current task status

### Agent Assignment

Agents assign themselves (or can be assigned):

```bash
# Agent self-assigns to an issue
npx claude-flow cto-project assign my-feature 42 \
  --agent coder \
  --teammate-mode

# Auto-assign based on capabilities
npx claude-flow epic assign my-feature \
  --auto-assign \
  --strategy capability \
  --teammate-mode
```

### Peer Validation

Instead of human review, **teammate agents peer-validate** each other:

```bash
# Spawn a peer reviewer agent
Task({
  description: "Peer review PR #YY",
  subagent_type: "reviewer",
  prompt: `You are a teammate reviewer agent.

## CONTEXT RESTORATION
First, restore your context from the epic:
\`\`\`bash
npx claude-flow teammate context-restore --epic my-feature --agent reviewer-001
\`\`\`

## PEER VALIDATION (Not Human Review)
You are validating a peer agent's work, not a human's.
Check that your teammate:

1. Followed SPARC methodology
2. Wrote tests before implementation
3. Made decisions consistent with epic ADRs
4. Didn't introduce architectural drift

## SPARC VALIDATION CHECKLIST
[Same as before but framed as peer validation]

## AFTER VALIDATION
If approved:
- Merge the PR
- Update epic memory with completion
- Share any learnings with the team

If changes needed:
- Comment specific feedback
- The implementing agent will address
- Re-validate after changes
`
})
```

---

## SPARC-Informed Task Prompts

Every agent prompt embeds SPARC methodology. Here's the integrated pattern:

### Implementation Agent (Self-Selected Task)

```javascript
Task({
  description: "Implement self-selected issue",
  subagent_type: "coder",
  run_in_background: true,
  prompt: `You are a teammate agent implementing a self-selected task.

## CONTEXT RESTORATION
First, restore your context from the epic:
\`\`\`bash
npx claude-flow teammate context-restore --epic EPIC_ID --agent coder-001
\`\`\`

This loads:
- Epic requirements and constraints
- Architectural decisions (ADRs)
- Your previous work on this epic
- Current team progress

## SELF-SELECTION
You selected Issue #XX because:
- It matches your capabilities: [typescript, api, ...]
- Priority: high
- No blocking dependencies

## SPARC-INFORMED IMPLEMENTATION

### S - SPECIFICATION (From Epic + Issue)
Read and understand:
1. Epic context (overall feature goals)
2. Issue requirements (specific task)
3. Acceptance criteria
4. How this fits with other tasks in the epic

### P - PSEUDOCODE (Design First)
Before ANY code:
1. Document algorithm in comments
2. Consider how this integrates with existing epic work
3. Check if other agents have made relevant decisions
4. Identify edge cases

### A - ARCHITECTURE (Types First)
Before implementing:
1. Define TypeScript interfaces
2. Check epic ADRs for architectural guidance
3. Ensure consistency with team decisions
4. Plan integration points

### R - REFINEMENT (TDD)
Implementation order:
1. Write failing tests first
2. Implement minimal code to pass
3. Refactor following epic patterns
4. Run full test suite

### C - COMPLETION (Request Peer Validation)
When ready:
1. Create PR with context
2. Update epic memory:
   \`\`\`bash
   npx claude-flow teammate context-save --epic EPIC_ID --data '{"completed": ["issue-XX"], "learnings": "..."}'
   \`\`\`
3. Request peer validation (not human review)
4. Update project status to "Review"

## KNOWLEDGE SHARING
If you discover something useful for teammates:
\`\`\`bash
npx claude-flow teammate context-save --epic EPIC_ID --data '{"sharedKnowledge": "..."}'
\`\`\`
`
})
```

### Peer Validator Agent

```javascript
Task({
  description: "Peer validate PR",
  subagent_type: "reviewer",
  run_in_background: true,
  prompt: `You are a teammate agent performing peer validation.

## CONTEXT RESTORATION
\`\`\`bash
npx claude-flow teammate context-restore --epic EPIC_ID --agent reviewer-001
\`\`\`

## PEER VALIDATION PRINCIPLES
You're validating a teammate's work, ensuring:
- Consistency with epic architectural decisions
- SPARC methodology was followed
- No drift from team patterns
- Tests are comprehensive

## SPARC VALIDATION CHECKLIST

### S - Specification Validation
- [ ] PR addresses issue requirements
- [ ] Aligns with epic goals
- [ ] Acceptance criteria met

### P - Pseudocode Validation
- [ ] Logic is clear and documented
- [ ] Algorithm makes sense
- [ ] Comments explain "why"

### A - Architecture Validation
- [ ] Types/interfaces defined
- [ ] Consistent with epic ADRs
- [ ] No architectural drift
- [ ] Integration is clean

### R - Refinement Validation
- [ ] Tests exist and are meaningful
- [ ] Tests written before implementation (TDD)
- [ ] All tests pass
- [ ] Build succeeds

### C - Completion Validation
- [ ] PR is complete and ready
- [ ] Documentation updated if needed
- [ ] Ready to merge

## VALIDATION OUTCOME
If approved:
1. Merge PR
2. Update epic:
   \`\`\`bash
   npx claude-flow teammate context-save --epic EPIC_ID --data '{"validated": ["PR-YY"], "validator": "reviewer-001"}'
   \`\`\`
3. Update project status to "Done"

If changes needed:
1. Comment specific feedback
2. Implementing agent will address
3. Re-validate when ready
`
})
```

---

## CLI Commands Reference

### Epic Management

```bash
# Create epic
npx claude-flow epic create "Epic Title" --repo owner/repo --teammate-mode

# List epics
npx claude-flow epic list --teammate-mode

# Show epic details
npx claude-flow epic show <epic-id> --teammate-mode

# Update epic
npx claude-flow epic update <epic-id> --state active --teammate-mode

# Sync with GitHub
npx claude-flow epic sync <epic-id> --teammate-mode
```

### Project Management

```bash
# Create project for epic
npx claude-flow cto-project create <epic-id> "Title" --repo owner/repo --teammate-mode

# Add task to epic
npx claude-flow cto-project add-task <epic-id> "Task title" --priority high --teammate-mode

# View progress
npx claude-flow cto-project progress <epic-id> --teammate-mode

# Assign agent
npx claude-flow cto-project assign <epic-id> <issue> --agent <type> --teammate-mode

# List available issues
npx claude-flow cto-project available --capabilities "..." --teammate-mode
```

### Teammate Context

```bash
# Restore context
npx claude-flow teammate context-restore --epic <epic-id> --agent <agent-id> --teammate-mode

# Save context
npx claude-flow teammate context-save --epic <epic-id> --data '{}' --teammate-mode

# Clear context
npx claude-flow teammate context-clear --epic <epic-id> --confirm --teammate-mode

# Check status
npx claude-flow teammate status --teammate-mode
```

---

## GraphQL Reference

### Query Project Items by Status

```bash
curl -s -H "Authorization: bearer $GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST https://api.github.com/graphql \
  -d '{"query":"query { node(id: \"PROJECT_ID\") { ... on ProjectV2 { items(first: 50) { nodes { id content { ... on Issue { number title body } } fieldValues(first: 10) { nodes { ... on ProjectV2ItemFieldSingleSelectValue { name optionId } } } } } } } }"}'
```

### Update Status

```bash
curl -s -H "Authorization: bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -X POST https://api.github.com/graphql \
  -d '{"query":"mutation { updateProjectV2ItemFieldValue(input: {projectId: \"PROJECT_ID\", itemId: \"ITEM_ID\", fieldId: \"FIELD_ID\", value: {singleSelectOptionId: \"OPTION_ID\"}}) { projectV2Item { id } } }"}'
```

---

## Integration Summary

| Layer | What It Does | Key Feature |
|-------|-------------|-------------|
| **Teammate Agents** | Autonomous collaboration | Self-selection, peer validation, persistent memory |
| **SPARC Methodology** | Structures task approach | Embedded in every agent prompt |
| **CTO-Flow Workflow** | Manages task lifecycle | GitHub Projects V2 status tracking |
| **Epic Memory** | Persists context | Survives agent restarts, enables knowledge sharing |

### The Integrated Flow

1. **CTO** moves issue from Backlog → Ready
2. **Teammate agent** sees available issue, evaluates fit, self-selects
3. **Agent restores context** from epic memory
4. **Agent implements** using SPARC-informed approach
5. **Agent creates PR**, saves context, requests peer validation
6. **Peer reviewer agent** validates (not human review)
7. **Validated work** merged, status → Done, epic memory updated
8. **Knowledge shared** with other teammates via epic memory

**Teammates collaborate autonomously. SPARC structures their work. CTO-Flow tracks progress.**
