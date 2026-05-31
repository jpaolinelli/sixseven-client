---
name: implementation-process
description: Use when implementing a Jira ticket. Provides the step-by-step process for implementing subtasks — how to plan, code, test, and deliver each piece of work.
user-invocable: false
---

# Implementation Process

## Per-Subtask Flow

For each subtask, follow these steps in order:

### 1. Understand

- Read the subtask's acceptance criteria and definition of done.
- Identify which files need to be created or modified.
- If anything is unclear, stop and ask the user.

### 2. Implement

- Create components in `web/components/`.
- Create utilities and types in `web/lib/`.
- Create API routes in `web/app/api/<name>/route.ts`.
- Follow the coding conventions (see `sixseven-conventions` skill).
- Follow existing codebase patterns — look at neighboring files for guidance.

### 3. Test

- Create `web/__tests__/<name>.test.ts` for each new module.
- Follow the testing patterns (see `sixseven-testing` skill).
- Cover every acceptance criterion with at least one test.
- Cover edge cases: empty inputs, null/undefined, error conditions, boundaries.
- Every test must assert something substantive — no empty or trivial tests.
- **Do NOT add QA-prefixed tests** — QA tests (`qa-*.test.ts`) are owned by the QA process.

### 4. Quality Gate

Before marking a subtask done, run the full pre-commit checklist (see `quality-checks` skill):

1. Type check passes (`cd web && npx tsc --noEmit`).
2. Build succeeds (`cd web && npm run build`).
3. All tests pass (`cd web && npm test`).

Fix any issues before proceeding.

> **Note**: Implementers do NOT write QA regression tests (`qa-*.test.ts`). QA tests are owned by the QA process.

### 5. Transition

Move the subtask to "In Review" in Jira (see `jira-workflow` skill).

## Finalization (after all subtasks)

1. Run a final build + test pass.
2. Verify every acceptance criterion for parent and all subtasks.
3. Create a commit (see `git-workflow` skill for format).
4. Transition the parent ticket to "In Review".
5. Push and create a PR (see `git-workflow` skill for PR template).
6. Stop and wait for user feedback on the PR.

## Handling PR Feedback

If the review has requested changes:

1. Fix the issues.
2. Re-run the full quality gate.
3. Create a new commit (do not amend unless asked).
4. Push and notify the user.
5. Wait for another review.

## When to Ask the User

Stop and ask for clarification when:

- An acceptance criterion is ambiguous.
- There are multiple valid approaches and you're unsure which to pick.
- A requirement seems to conflict with existing code.
- You need to modify code outside the ticket's stated scope.
