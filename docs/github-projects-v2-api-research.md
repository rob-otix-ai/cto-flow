# GitHub Projects v2 API & CLI Research

## Research Summary

This document provides comprehensive information about GitHub Projects v2 API and CLI commands for project management, including creating projects, managing items, configuring fields, linking PRs to issues, and GraphQL API patterns.

---

## 1. Creating GitHub Projects via gh CLI

### Basic Commands

```bash
# Create a project (requires authentication with project scope)
gh project create --owner monalisa --title "Roadmap"

# Create a project for current user
gh project create --owner "@me" --title "My Project"

# View a project in web browser
gh project view 1 --owner cli --web

# List all projects
gh project list --owner monalisa

# Copy an existing project
gh project copy 4247 --source-owner github --target-owner mntlty --title 'my roadmap'
```

### Authentication Requirements

```bash
# Check authentication status
gh auth status

# Add project scope to token
gh auth refresh -s project

# Initial authentication with project scope
gh auth login --scopes "project"

# For read-only access
gh auth login --scopes "read:project"
```

**Important Notes:**
- The minimum required scope is `project` for read/write operations
- Use `read:project` for read-only operations
- Classic PATs (Personal Access Tokens) are required - fine-grained tokens don't yet work with GraphQL API
- Interactive prompts will appear if you don't pass `--owner` or project number flags in TTY

---

## 2. Adding Items (Issues/PRs) to Projects

### CLI Commands

```bash
# Add an issue or PR to a project
gh project item-add PROJECT_NUMBER --owner OWNER --url ISSUE_OR_PR_URL

# Add current repository's issue
gh project item-add 1 --owner monalisa --url https://github.com/monalisa/repo/issues/123

# List items in a project
gh project item-list 1 --owner cli

# Archive an item
gh project item-archive PROJECT_NUMBER --owner OWNER --id ITEM_ID

# Create a draft issue in project
gh project item-create PROJECT_NUMBER --owner OWNER --title "Draft Issue" --body "Content"
```

### GraphQL API - Adding Items

```graphql
# Add an existing issue or PR to a project
mutation {
  addProjectV2ItemById(input: {
    projectId: "PVT_kwDOABcD1M4Aa1b2"
    contentId: "I_kwDOABcD1M5XYz12"  # Issue or PR node ID
  }) {
    item {
      id
    }
  }
}
```

```bash
# Using gh api graphql
gh api graphql -f query='
  mutation {
    addProjectV2ItemById(input: {
      contentId: "ISSUE_OR_PR_ID"
      projectId: "PROJECT_ID"
    }) {
      item {
        id
        content {
          ... on Issue {
            title
            number
          }
        }
      }
    }
  }'
```

### GraphQL API - Creating Draft Issues

```graphql
mutation {
  addProjectV2DraftIssue(input: {
    projectId: "PVT_kwDOABcD1M4Aa1b2"
    title: "Draft Issue Title"
    body: "Draft issue content"
  }) {
    projectItem {
      id
    }
  }
}
```

---

## 3. Managing Project Columns/Status Fields

### Creating Fields

```bash
# Create a text field
gh project field-create 1 --owner "@me" --name "Priority" --data-type "text"

# Create a single-select field (status/column equivalent)
gh project field-create 1 --owner monalisa \
  --name "Status" \
  --data-type "SINGLE_SELECT" \
  --single-select-options "Todo,In Progress,Done"

# Create a number field
gh project field-create 1 --owner "@me" --name "Story Points" --data-type "number"

# Create a date field
gh project field-create 1 --owner "@me" --name "Due Date" --data-type "date"

# List all fields in a project
gh project field-list 1 --owner cli

# Get field details as JSON
gh project field-list 1 --owner cli --format=json

# Delete a field
gh project field-delete 1 --owner cli --id FIELD_ID
```

### GraphQL API - Creating Fields

```graphql
mutation {
  createProjectV2Field(input: {
    projectId: "PVT_kwDOABcD1M4Aa1b2"
    dataType: SINGLE_SELECT
    name: "Status"
    singleSelectOptions: [
      {name: "Todo", color: GRAY, description: "Not started"}
      {name: "In Progress", color: YELLOW, description: "Currently working"}
      {name: "Done", color: GREEN, description: "Completed"}
    ]
  }) {
    projectField {
      ... on ProjectV2SingleSelectField {
        id
        name
        options {
          id
          name
        }
      }
    }
  }
}
```

### Getting Field Information (Including Status Options)

```bash
# Get Status field details with all options
gh api graphql -f query='
  query {
    organization(login: "ORG_NAME") {
      projectV2(number: 123) {
        field(name: "Status") {
          __typename
          ... on ProjectV2SingleSelectField {
            id
            options {
              id
              name
            }
          }
        }
      }
    }
  }'
```

### Updating Item Field Values

```bash
# Edit an item's field value (CLI)
gh project item-edit --project-id PROJECT_ID --id ITEM_ID \
  --field-id FIELD_ID --text "New value"

# Using GraphQL to update status/single-select field
gh api graphql -f query='
  mutation {
    updateProjectV2ItemFieldValue(input: {
      projectId: "PVT_kwDOABcD1M4Aa1b2"
      itemId: "PVTI_lADOABcD1M4Aa1b2zgXYz12"
      fieldId: "PVTSSF_lADOABcD1M4Aa1b2zgAbc12"
      value: {
        singleSelectOptionId: "47fc9ee4"  # ID of "In Progress" option
      }
    }) {
      projectV2Item {
        id
      }
    }
  }'
```

**Key Notes on Status Management:**
- Projects v2 uses flexible "Status" fields instead of rigid columns
- You must use the field ID and option ID, not human-readable names
- Use `field-list --format=json` to get field and option IDs
- You can only update existing options, not create/delete options via API (as of 2025)
- Each field type (text, number, date, single-select, iteration) has different value formats

### Field Value Update Patterns

```graphql
# Text field
value: { text: "New text value" }

# Number field
value: { number: 42 }

# Date field
value: { date: "2025-12-31" }

# Single select field
value: { singleSelectOptionId: "option_id" }

# Iteration field
value: { iterationId: "iteration_id" }
```

---

## 4. Linking PRs to Issues

### Current Methods (2025)

#### Method 1: Using Keywords in PR Body

```bash
# Create PR with issue reference in body
gh pr create \
  --title "Fix authentication bug" \
  --body "Fixes #123"  # or "Closes #123", "Resolves #123"

# Edit existing PR to add reference
gh pr edit 456 --body "Updated fix for authentication. Closes #123"
```

**Supported Keywords:**
- `Fixes #issue`
- `Closes #issue`
- `Resolves #issue`
- Also works with full URLs: `Fixes https://github.com/owner/repo/issues/123`

#### Method 2: Using `gh issue develop` Workflow

```bash
# Create branch linked to issue (creates automatic link)
gh issue develop 123 --checkout

# Work on the branch
git add .
git commit -m "Fix issue"

# Create PR (automatically links to issue)
gh pr create --title "Fix authentication" --body "Implementation details"
```

#### Method 3: Feature Request - Direct Linking (NOT YET AVAILABLE)

There's an open feature request (Issue #11405, opened July 2025) for direct PR-to-issue linking:

```bash
# PROPOSED SYNTAX (not yet implemented)
gh pr edit 123 --add-issue 1

# This would link issue #1 to PR #123 without requiring keywords
# or merging to default branch
```

**Status:** Blocked, labeled as "needs-design" - allows linking for non-default branch PRs

### GraphQL API - Development References

While there's no direct "link PR to issue" GraphQL mutation, you can:

1. **Create sub-issues** (if enabled):
```graphql
mutation {
  addSubIssue(input: {
    issueId: "PARENT_ISSUE_ID"
    subIssueId: "CHILD_ISSUE_ID"
  }) {
    issue {
      id
    }
  }
}
```
Requires header: `GraphQL-Features: sub_issues`

2. **Query linked PRs from an issue:**
```graphql
query {
  repository(owner: "OWNER", name: "REPO") {
    issue(number: 123) {
      closedByPullRequestsReferences(first: 10) {
        nodes {
          number
          title
        }
      }
    }
  }
}
```

---

## 5. GraphQL API Patterns for Projects v2

### Core Patterns

#### A. Getting Node IDs

```graphql
# Get organization node ID
query {
  organization(login: "org-name") {
    id
    login
  }
}

# Get user node ID
query {
  user(login: "username") {
    id
    login
  }
}

# Get issue/PR node ID
query {
  repository(owner: "OWNER", name: "REPO") {
    issue(number: 123) {
      id
      title
    }
    pullRequest(number: 456) {
      id
      title
    }
  }
}

# Get project details
query {
  organization(login: "org-name") {
    projectV2(number: 1) {
      id
      title
      number
    }
  }
}
```

#### B. Complete Project Query

```graphql
query {
  organization(login: "ORG_NAME") {
    projectV2(number: 1) {
      id
      title
      shortDescription
      public
      closed
      fields(first: 20) {
        nodes {
          ... on ProjectV2Field {
            id
            name
          }
          ... on ProjectV2SingleSelectField {
            id
            name
            options {
              id
              name
              color
            }
          }
          ... on ProjectV2IterationField {
            id
            name
            configuration {
              iterations {
                id
                title
                startDate
                duration
              }
            }
          }
        }
      }
      items(first: 20) {
        nodes {
          id
          type
          content {
            ... on Issue {
              id
              number
              title
              state
            }
            ... on PullRequest {
              id
              number
              title
              state
            }
          }
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldTextValue {
                text
                field {
                  ... on ProjectV2Field {
                    name
                  }
                }
              }
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field {
                  ... on ProjectV2SingleSelectField {
                    name
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

#### C. Key Mutations

```graphql
# 1. Create Project
mutation {
  createProjectV2(input: {
    ownerId: "MDEyOk9yZ2FuaXphdGlvbjEyMzQ1Njc4"
    title: "Q1 Roadmap"
  }) {
    projectV2 {
      id
      title
    }
  }
}

# 2. Create Field
mutation {
  createProjectV2Field(input: {
    projectId: "PVT_kwDOABcD1M4Aa1b2"
    dataType: SINGLE_SELECT
    name: "Priority"
    singleSelectOptions: [
      {name: "High", color: RED}
      {name: "Medium", color: YELLOW}
      {name: "Low", color: GRAY}
    ]
  }) {
    projectField {
      ... on ProjectV2SingleSelectField {
        id
        options {
          id
          name
        }
      }
    }
  }
}

# 3. Add Item to Project
mutation {
  addProjectV2ItemById(input: {
    projectId: "PVT_kwDOABcD1M4Aa1b2"
    contentId: "I_kwDOABcD1M5XYz12"
  }) {
    item {
      id
    }
  }
}

# 4. Update Item Field Value
mutation {
  updateProjectV2ItemFieldValue(input: {
    projectId: "PVT_kwDOABcD1M4Aa1b2"
    itemId: "PVTI_lADOABcD1M4Aa1b2zgXYz12"
    fieldId: "PVTSSF_lADOABcD1M4Aa1b2zgAbc12"
    value: {
      singleSelectOptionId: "47fc9ee4"
    }
  }) {
    projectV2Item {
      id
    }
  }
}

# 5. Create Draft Issue
mutation {
  addProjectV2DraftIssue(input: {
    projectId: "PVT_kwDOABcD1M4Aa1b2"
    title: "New Feature Request"
    body: "Detailed description"
  }) {
    projectItem {
      id
    }
  }
}

# 6. Archive Item
mutation {
  archiveProjectV2Item(input: {
    projectId: "PVT_kwDOABcD1M4Aa1b2"
    itemId: "PVTI_lADOABcD1M4Aa1b2zgXYz12"
  }) {
    item {
      id
    }
  }
}

# 7. Delete Project
mutation {
  deleteProjectV2(input: {
    projectId: "PVT_kwDOABcD1M4Aa1b2"
  }) {
    projectV2 {
      id
    }
  }
}

# 8. Update Project
mutation {
  updateProjectV2(input: {
    projectId: "PVT_kwDOABcD1M4Aa1b2"
    title: "Updated Title"
    shortDescription: "New description"
    public: true
  }) {
    projectV2 {
      id
      title
    }
  }
}
```

### Using gh api graphql

```bash
# Basic query
gh api graphql -f query='
  query {
    viewer {
      login
      id
    }
  }'

# With variables
gh api graphql \
  -f query='query($org: String!, $number: Int!) {
    organization(login: $org) {
      projectV2(number: $number) {
        id
        title
      }
    }
  }' \
  -f org='my-org' \
  -F number=1

# Mutation with header
gh api graphql \
  -H "X-Github-Next-Global-ID: 1" \
  -f query='mutation($projectId: ID!, $title: String!) {
    createProjectV2Field(input: {
      projectId: $projectId
      dataType: TEXT
      name: $title
    }) {
      projectField {
        id
      }
    }
  }' \
  -f projectId='PVT_xxx' \
  -f title='Notes'
```

### Important Headers

```bash
# Use new global ID format (required for ProjectsV2)
-H "X-Github-Next-Global-ID: 1"

# For sub-issues feature
-H "GraphQL-Features: sub_issues"
```

---

## Complete Workflow Example

```bash
# 1. Authenticate
gh auth login --scopes "project"

# 2. Get organization node ID
ORG_ID=$(gh api graphql -f query='
  query {
    organization(login: "my-org") {
      id
    }
  }' --jq '.data.organization.id')

# 3. Create project
PROJECT_ID=$(gh api graphql -f query="
  mutation {
    createProjectV2(input: {
      ownerId: \"$ORG_ID\"
      title: \"Sprint Board\"
    }) {
      projectV2 { id }
    }
  }" --jq '.data.createProjectV2.projectV2.id')

# 4. Create status field
STATUS_FIELD=$(gh api graphql -f query="
  mutation {
    createProjectV2Field(input: {
      projectId: \"$PROJECT_ID\"
      dataType: SINGLE_SELECT
      name: \"Status\"
      singleSelectOptions: [
        {name: \"Backlog\", color: GRAY}
        {name: \"In Progress\", color: YELLOW}
        {name: \"Done\", color: GREEN}
      ]
    }) {
      projectField {
        ... on ProjectV2SingleSelectField {
          id
          options { id name }
        }
      }
    }
  }" --jq '.data.createProjectV2Field.projectField')

# 5. Get issue node ID
ISSUE_ID=$(gh api graphql -f query='
  query {
    repository(owner: "my-org", name: "my-repo") {
      issue(number: 123) {
        id
      }
    }
  }' --jq '.data.repository.issue.id')

# 6. Add issue to project
ITEM_ID=$(gh api graphql -f query="
  mutation {
    addProjectV2ItemById(input: {
      projectId: \"$PROJECT_ID\"
      contentId: \"$ISSUE_ID\"
    }) {
      item { id }
    }
  }" --jq '.data.addProjectV2ItemById.item.id')

# 7. Get "In Progress" option ID from status field
IN_PROGRESS_ID=$(echo $STATUS_FIELD | jq -r '.options[] | select(.name=="In Progress") | .id')
FIELD_ID=$(echo $STATUS_FIELD | jq -r '.id')

# 8. Update item status to "In Progress"
gh api graphql -f query="
  mutation {
    updateProjectV2ItemFieldValue(input: {
      projectId: \"$PROJECT_ID\"
      itemId: \"$ITEM_ID\"
      fieldId: \"$FIELD_ID\"
      value: { singleSelectOptionId: \"$IN_PROGRESS_ID\" }
    }) {
      projectV2Item { id }
    }
  }"
```

---

## Key Limitations & Notes (2025)

1. **Projects Classic Deprecation**: Projects (classic) removal scheduled for 2025-04-01
2. **Token Requirements**: Must use classic PATs; fine-grained tokens don't work with GraphQL API yet
3. **Field Limitations**: Cannot add/delete single-select options via API (only update to existing options)
4. **PR-Issue Linking**: No direct API; must use keywords in PR body or `gh issue develop` workflow
5. **View Management**: Limited API support for creating/managing project views (tables, boards, roadmaps)
6. **Status Updates**: No CLI command yet for creating project status updates (Issue #9743)
7. **Batch Operations**: Cannot add and update an item in the same GraphQL call
8. **ID Format**: Must use header `X-Github-Next-Global-ID: 1` for ProjectsV2 operations

---

## Useful Resources

### Official Documentation
- [GitHub CLI Manual - gh project](https://cli.github.com/manual/gh_project)
- [Using the API to manage Projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects)
- [GitHub GraphQL Mutations Reference](https://docs.github.com/en/graphql/reference/mutations)
- [GitHub GraphQL API Documentation](https://docs.github.com/en/graphql)

### Community Resources
- [Examples for GitHub GraphQL API (ProjectsV2)](https://devopsjournal.io/blog/2022/11/28/github-graphql-queries)
- [Intro to GraphQL using GitHub Projects](https://some-natalie.dev/blog/graphql-intro/)
- [Migrating Project v2 Boards](https://www.form3.tech/blog/engineering/migrating-gh-boards)

### Open Issues & Feature Requests
- [Issue #11405: PR-Issue Direct Linking](https://github.com/cli/cli/issues/11405)
- [Issue #9743: Status Updates Support](https://github.com/cli/cli/issues/9743)
- [Discussion #44265: Managing Status Columns](https://github.com/orgs/community/discussions/44265)

---

## Command Quick Reference

```bash
# Authentication
gh auth login --scopes "project"
gh auth refresh -s project

# Projects
gh project create --owner OWNER --title "TITLE"
gh project list --owner OWNER
gh project view NUMBER --owner OWNER

# Fields
gh project field-create NUMBER --owner OWNER --name "NAME" --data-type TYPE
gh project field-list NUMBER --owner OWNER --format=json

# Items
gh project item-add NUMBER --owner OWNER --url URL
gh project item-list NUMBER --owner OWNER
gh project item-edit --project-id ID --id ITEM_ID --field-id FIELD_ID

# GraphQL
gh api graphql -f query='QUERY'
gh api graphql -H "X-Github-Next-Global-ID: 1" -f query='QUERY'
```

---

**Research completed:** 2025-12-10
**API Version:** GitHub Projects v2 (GraphQL API v4)
**CLI Version:** gh 2.22.0+
