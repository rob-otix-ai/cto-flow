/**
 * Hive-Mind + AgentDB + GitHub Projects Integration Test
 *
 * Tests the full unified orchestration:
 * 1. Initialize HiveMindGitHubOrchestrator
 * 2. Create repository
 * 3. Register agents with vector embeddings
 * 4. Create epic with intelligent agent assignment
 * 5. Test semantic similarity search
 * 6. Record learning outcomes
 *
 * Usage: node --experimental-strip-types scripts/test-hive-mind-agentdb-integration.ts
 */

import { config } from 'dotenv';
config();

import {
  createHiveMindOrchestrator,
  SPARC_PHASES,
  type EpicPlan,
} from '../dist/src/teammate-agents/integration/hive-mind-github.js';

// Configuration
const OWNER = 'fall-development-rob';

async function runIntegrationTest() {
  const timestamp = Date.now();
  const repoName = `hive-mind-test-${timestamp}`;

  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║     HIVE-MIND + AGENTDB + GITHUB PROJECTS INTEGRATION TEST         ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  console.log(`\nTimestamp: ${new Date().toISOString()}`);
  console.log(`Owner: ${OWNER}`);
  console.log(`Repository: ${repoName}\n`);

  // Check for token
  if (!process.env.GITHUB_TOKEN && !process.env.GH_TOKEN) {
    console.error('Error: GITHUB_TOKEN required in .env');
    process.exit(1);
  }

  // ========================================================================
  // STEP 1: Initialize Orchestrator
  // ========================================================================
  console.log('┌──────────────────────────────────────────────────────────────────┐');
  console.log('│ STEP 1: Initialize Hive-Mind Orchestrator                         │');
  console.log('└──────────────────────────────────────────────────────────────────┘');

  const orchestrator = createHiveMindOrchestrator({
    owner: OWNER,
    enableVectorSearch: true,
    enableLearning: true,
    autoCreateLabels: true,
  });

  await orchestrator.initialize();

  const stats = await orchestrator.getStats();
  console.log(`✓ Orchestrator initialized`);
  console.log(`  - Default agents: ${stats.agents}`);
  console.log(`  - Vector search: ${stats.memoryStats.vectorSearchAvailable ? 'enabled' : 'disabled'}`);
  console.log(`  - Learning: ${stats.memoryStats.learningEnabled ? 'enabled' : 'disabled'}`);

  // ========================================================================
  // STEP 2: Register Custom Agent
  // ========================================================================
  console.log('\n┌──────────────────────────────────────────────────────────────────┐');
  console.log('│ STEP 2: Register Custom Agent                                     │');
  console.log('└──────────────────────────────────────────────────────────────────┘');

  await orchestrator.registerAgent({
    agentId: 'custom-security-expert',
    name: 'Security Expert',
    type: 'security',
    skills: ['security', 'penetration-testing', 'oauth', 'jwt', 'encryption', 'compliance'],
    domains: ['security', 'backend', 'infrastructure'],
    capabilities: ['audit', 'review', 'test', 'document'],
    performanceHistory: [
      { taskId: 'past-1', epicId: 'e1', completionTime: 3, quality: 0.95, timestamp: new Date() },
      { taskId: 'past-2', epicId: 'e2', completionTime: 4, quality: 0.92, timestamp: new Date() },
    ],
    metadata: { specialization: 'Application Security' },
  });

  console.log(`✓ Custom agent registered: Security Expert`);
  console.log(`  - Total agents now: ${orchestrator.getAgents().length}`);

  // ========================================================================
  // STEP 3: Test Agent Matching
  // ========================================================================
  console.log('\n┌──────────────────────────────────────────────────────────────────┐');
  console.log('│ STEP 3: Test Vector-Based Agent Matching                          │');
  console.log('└──────────────────────────────────────────────────────────────────┘');

  const testTask = {
    title: 'Implement OAuth2 authentication with JWT tokens',
    description: 'Build secure authentication using OAuth2 providers (Google, GitHub) with JWT token management',
    skills: ['oauth', 'jwt', 'security', 'nodejs'],
    priority: 'critical',
  };

  console.log(`\nTest task: "${testTask.title}"`);
  console.log(`Required skills: ${testTask.skills.join(', ')}\n`);

  const matches = await orchestrator.findAgentsForTask(testTask, 5);

  console.log('Agent matches (sorted by score):');
  console.log('┌──────────────────────────┬───────┬──────────┬────────┬──────────┐');
  console.log('│ Agent                    │ Score │ Vector   │ Skills │ Perform. │');
  console.log('├──────────────────────────┼───────┼──────────┼────────┼──────────┤');

  for (const match of matches) {
    const name = match.agent.name.padEnd(22);
    const score = match.score.toFixed(1).padStart(5);
    const vector = match.breakdown.vectorSimilarity.toFixed(0).padStart(6);
    const skills = match.breakdown.skillMatch.toFixed(0).padStart(6);
    const perf = match.breakdown.performance.toFixed(0).padStart(6);
    console.log(`│ ${name} │ ${score}%│ ${vector}% │ ${skills}% │ ${perf}%   │`);
  }
  console.log('└──────────────────────────┴───────┴──────────┴────────┴──────────┘');

  // ========================================================================
  // STEP 4: Create Repository
  // ========================================================================
  console.log('\n┌──────────────────────────────────────────────────────────────────┐');
  console.log('│ STEP 4: Create Repository                                         │');
  console.log('└──────────────────────────────────────────────────────────────────┘');

  const repo = await orchestrator.createRepository({
    name: repoName,
    description: 'Hive-Mind + AgentDB Integration Test',
    private: false,
  });

  console.log(`✓ Repository created: ${repo.fullName}`);
  console.log(`  URL: ${repo.url}`);

  // Wait for GitHub to initialize
  await new Promise(resolve => setTimeout(resolve, 2000));

  // ========================================================================
  // STEP 5: Create Epic with Agent Assignments
  // ========================================================================
  console.log('\n┌──────────────────────────────────────────────────────────────────┐');
  console.log('│ STEP 5: Create Epic with Intelligent Agent Assignment             │');
  console.log('└──────────────────────────────────────────────────────────────────┘');

  const epicPlan: EpicPlan = {
    title: 'Secure API Gateway Implementation',
    description: 'Build a production-ready API gateway with authentication, rate limiting, and monitoring.',
    objectives: [
      'Implement JWT-based authentication',
      'Add OAuth2 provider support',
      'Implement rate limiting and quotas',
      'Add request/response logging',
      'Create comprehensive test suite',
    ],
    constraints: [
      'Must use TypeScript',
      'Tokens must expire in 24h',
      'Rate limit: 100 req/min per user',
      'All endpoints must be documented',
    ],
    tasks: [
      {
        title: 'Analyze API gateway requirements',
        description: 'Research and document requirements for authentication, authorization, and rate limiting.',
        phase: 'Specification',
        skills: ['research', 'analysis', 'documentation'],
        priority: 'high',
      },
      {
        title: 'Design authentication architecture',
        description: 'Create system architecture for JWT/OAuth2 authentication flow with diagrams.',
        phase: 'Architecture',
        skills: ['architecture', 'design', 'security', 'api-design'],
        priority: 'high',
      },
      {
        title: 'Implement JWT authentication middleware',
        description: 'Build Express middleware for JWT validation, token refresh, and user context.',
        phase: 'Refinement',
        skills: ['typescript', 'nodejs', 'jwt', 'security'],
        priority: 'critical',
      },
      {
        title: 'Implement OAuth2 providers',
        description: 'Add Google and GitHub OAuth2 authentication providers.',
        phase: 'Refinement',
        skills: ['oauth', 'security', 'nodejs', 'api'],
        priority: 'high',
      },
      {
        title: 'Write authentication tests',
        description: 'Create unit and integration tests for all auth flows.',
        phase: 'Refinement',
        skills: ['testing', 'jest', 'integration', 'security-testing'],
        priority: 'high',
      },
      {
        title: 'Security audit and hardening',
        description: 'Perform security review, address vulnerabilities, and document security measures.',
        phase: 'Completion',
        skills: ['security', 'penetration-testing', 'compliance', 'documentation'],
        priority: 'critical',
      },
    ],
    metadata: {
      team: 'Platform',
      sprint: 'Q1-2025',
    },
  };

  console.log(`\nCreating epic: "${epicPlan.title}"`);
  console.log(`Tasks: ${epicPlan.tasks.length}`);

  // Listen for events
  orchestrator.on('task:created', (data) => {
    console.log(`  ✓ #${data.issueNumber}: ${data.agent || 'unassigned'} (${data.score?.toFixed(1) || 'N/A'}%)`);
  });

  const epic = await orchestrator.createEpic(epicPlan);

  console.log(`\n✓ Epic created successfully!`);
  console.log(`  Epic ID: ${epic.epicId}`);
  console.log(`  Project: ${epic.projectUrl}`);
  console.log(`  Epic Issue: #${epic.epicIssueNumber}`);

  // ========================================================================
  // STEP 6: Test Similar Task Search
  // ========================================================================
  console.log('\n┌──────────────────────────────────────────────────────────────────┐');
  console.log('│ STEP 6: Test Similar Task Search                                  │');
  console.log('└──────────────────────────────────────────────────────────────────┘');

  const searchQuery = 'Implement user authentication with tokens';
  console.log(`\nSearching for tasks similar to: "${searchQuery}"\n`);

  const similarTasks = await orchestrator.findSimilarTasks(searchQuery, 3);

  if (similarTasks.length > 0) {
    console.log('Similar tasks found:');
    for (const result of similarTasks) {
      const similarity = (result.similarity * 100).toFixed(1);
      console.log(`  - ${result.value.title} (${similarity}% similar)`);
    }
  } else {
    console.log('No similar tasks found (expected for new epic)');
  }

  // ========================================================================
  // STEP 7: Record Learning Outcome
  // ========================================================================
  console.log('\n┌──────────────────────────────────────────────────────────────────┐');
  console.log('│ STEP 7: Record Learning Outcome                                   │');
  console.log('└──────────────────────────────────────────────────────────────────┘');

  // Simulate task completion
  const completedTask = epic.tasks[0];
  console.log(`\nRecording outcome for: "${completedTask.title}"`);

  await orchestrator.recordOutcome(epic.epicId, completedTask.taskId, {
    success: true,
    quality: 0.92,
    completionTime: 2.5,
    feedback: 'Requirements well documented with clear acceptance criteria.',
  });

  console.log('✓ Learning outcome recorded');
  console.log('  - Future agent matching will consider this performance data');

  // ========================================================================
  // SUMMARY
  // ========================================================================
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                    INTEGRATION TEST COMPLETE                        ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');

  console.log(`
┌─────────────────────────────────────────────────────────────────────┐
│ Created Resources                                                    │
├─────────────────────────────────────────────────────────────────────┤
│ Repository: ${repo.url.padEnd(53)} │
│ Project:    ${epic.projectUrl.padEnd(53)} │
│ Epic:       Issue #${epic.epicIssueNumber}                                                   │
│ Tasks:      ${epic.tasks.length} issues with intelligent agent assignment                │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ Task Assignments (Vector-Based Matching)                             │
├───────┬─────────────────┬────────────────────────────┬──────────────┤
│ Issue │ SPARC Phase     │ Assigned Agent             │ Score        │
├───────┼─────────────────┼────────────────────────────┼──────────────┤`);

  for (const task of epic.tasks) {
    const issue = `#${task.issueNumber}`.padEnd(5);
    const phase = task.phase.padEnd(15);
    const agent = (task.assignedAgent?.name || 'Unassigned').padEnd(26);
    const score = task.assignmentScore ? `${task.assignmentScore.toFixed(1)}%` : 'N/A';
    console.log(`│ ${issue} │ ${phase} │ ${agent} │ ${score.padStart(10)}  │`);
  }

  console.log(`└───────┴─────────────────┴────────────────────────────┴──────────────┘

Features Demonstrated:
  ✓ Vector-based agent skill matching
  ✓ Automatic SPARC phase detection
  ✓ GitHub Projects v2 integration
  ✓ Intelligent task assignment
  ✓ Similar task search
  ✓ Learning from outcomes

View your project: ${epic.projectUrl}
`);

  // Cleanup
  await orchestrator.shutdown();

  return { repo, epic };
}

// Run
runIntegrationTest()
  .then(() => {
    console.log('✓ Integration test completed successfully!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  });
