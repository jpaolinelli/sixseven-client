---
name: qa-process
description: Use when performing QA on a ticket. Provides the methodology for verifying implementations work correctly, adversarial testing to find bugs, and the process for filing bug tickets.
user-invocable: false
---

# QA Process

## Philosophy

QA is not code review. Code review reads the code and checks quality. QA **runs** the code and tries to **break** it. Your goal is to find every bug, edge case failure, and correctness issue before the code reaches production.

Think like an adversary. Every function is guilty until proven innocent.

## What QA Does NOT Do

- **QA does NOT modify developer tests.** Dev tests (`<name>.test.ts`) are owned by implementers.
- **QA does NOT fix implementation bugs.** QA finds bugs, writes reproducing tests, and files tickets. Fixing is the implementer's job.

## Step 1: Understand the Ticket

Read the parent ticket and all subtasks. Extract every acceptance criterion as a discrete, testable claim. For each criterion, think about:

- What inputs would make this fail?
- What boundary conditions exist?
- What happens when things go wrong (network error, null data, empty response)?

## Step 2: Build & Type Check

```bash
cd web && npx tsc --noEmit && npm run build
```

Record the results.

## Step 3: Read the Implementation

Read every file added or modified for the ticket:

- **Components**: `web/components/*.tsx`
- **Library**: `web/lib/*.ts`
- **API routes**: `web/app/api/**/*.ts`
- **Dev tests**: `web/__tests__/*.test.ts`

Read with a tester's eye — look for:

- **Unvalidated inputs**: Functions that trust their arguments without checking.
- **Missing error handling**: API calls without try/catch, unhandled promise rejections.
- **Null/undefined handling**: What happens with null, undefined, empty strings, empty arrays?
- **Type coercion issues**: Loose comparisons, implicit type conversions.
- **State management bugs**: Race conditions in async operations, stale closures.
- **UI edge cases**: What happens with very long text, zero items, thousands of items?

## Step 4: Write Adversarial Tests

This is the core of QA. Write new test cases designed to **break** the implementation. Create a test file `web/__tests__/qa-gdb-<N>-<name>.test.ts`.

### Categories of Adversarial Tests

**Boundary values:**
- Zero, one, max values for numeric inputs.
- Empty strings, very long strings.
- Empty arrays, single-element arrays, very large arrays.

**Null and missing data:**
- null/undefined in every field position.
- Missing required fields in API responses.
- Empty database query results.

**Error path verification:**
- Network errors during API calls.
- Database connection failures.
- Malformed JSON responses.
- Invalid SQL queries.

**Type edge cases:**
- Unexpected types (number where string expected).
- Mixed types in arrays.
- Special characters in strings (quotes, backslashes, unicode).

**Sequence and state:**
- Operations in unexpected order.
- Rapid repeated operations (double-click, spam submit).
- Operations during loading state.

**SQL edge cases (if applicable):**
- Queries returning zero rows.
- Queries returning thousands of rows.
- Queries with very long column values.
- TRAVERSE with cycles, disconnected nodes, non-existent IDs.

### Test Quality Rules

- Every test must have a clear name describing the adversarial scenario.
- Every test must assert a specific expected outcome — not just "doesn't throw."
- Group related adversarial tests under a descriptive `describe` block.

### Test File Location

QA test files go in `web/__tests__/` with the `qa-` prefix: `qa-gdb-<N>-<name>.test.ts` (e.g., `qa-gdb-299-graph-query-utils.test.ts`).

> **Important**: QA tests use the `qa-` filename prefix. Dev tests do NOT use this prefix. Never add QA tests without the prefix.

## Step 5: Run QA Tests

Run only the QA tests for the ticket under review:

```bash
cd web && npx vitest run __tests__/qa-gdb-<N>-*.test.ts
```

Record all results. Fix any test infrastructure issues (import errors, mock setup) but do **not** fix bugs in the implementation — that is the implementer's job.

## Step 6: Verify Acceptance Criteria

For each acceptance criterion, trace through the code path that satisfies it:

1. Identify the test(s) that exercise this criterion.
2. Confirm the test actually validates the criterion (not just a superficial check).
3. If no test covers a criterion, write one.
4. Run the specific test and verify it passes.

Build the criteria table:

| Criterion | Test(s) | Verified | Notes |
|-----------|---------|----------|-------|
| description | test names | PASS / FAIL / UNTESTED | details |

## Step 7: Compile Findings

Classify every finding by severity:

- **Critical**: Crash, data loss, security vulnerability, incorrect query results.
- **High**: Missing error handling that could cause silent failures, acceptance criterion not met.
- **Medium**: Edge case failures, missing validation, inconsistent behavior.
- **Low**: Minor behavioral quirks, missing edge case tests, cosmetic issues.

## Step 8: File Bug Tickets

For every Critical or High finding, create a Jira `Bug` ticket:

```
Project: GDB
Type: Bug
Summary: [BUG][<Severity>] <Component>: <Short description of the bug>
Description:
  ## Found During
  QA of <TICKET-UNDER-REVIEW>

  ## Description
  <Clear description of the bug>

  ## Steps to Reproduce
  1. <step>
  2. <step>

  ## Expected Behavior
  <what should happen>

  ## Actual Behavior
  <what actually happens>

  ## Severity
  Critical / High / Medium

  ## Test Case
  <test name in qa-gdb-<N>-<name>.test.ts that demonstrates the bug>
```

## Step 9: Run All Tests and Commit

1. Run all tests (`cd web && npm test`)
2. Check for regressions
3. Commit & push QA test changes

## Step 10: QA Report Format

```
# <TICKET-ID> — <Summary> — QA Report

## Build & Test Status
- Build: PASS / FAIL
- Type check: PASS / FAIL
- Existing tests: X/Y pass

## Adversarial Tests Written
| Describe Block | Test Name | Result | Category |
|----------------|-----------|--------|----------|
| QA_Component | should handle empty input | PASS | boundary |
| QA_Component | should handle null fields | FAIL | null handling |

## Acceptance Criteria Verification
| Criterion | Test(s) | Status | Notes |
|-----------|---------|--------|-------|
| ... | ... | PASS/FAIL/UNTESTED | ... |

## Findings
### 1. <Title> — **Critical/High/Medium/Low**
- **File**: `path/to/file.ts:line`
- **Description**: What is wrong.
- **Reproduction**: Test name or steps.
- **Bug ticket**: GDB-XXX (if filed)

## Verdict: QA PASS / QA FAIL
- **QA PASS**: All acceptance criteria verified, no Critical/High findings.
- **QA FAIL**: Any Critical or High finding, or unverified acceptance criteria.

## Bug Tickets Filed
- GDB-XXX: <summary>
- GDB-YYY: <summary>
```

## Verdict Rules

- **QA PASS**: All acceptance criteria verified with passing tests. No Critical or High findings. Medium findings are noted but do not block.
- **QA FAIL**: Any Critical or High finding. Any acceptance criterion that cannot be verified.

## Ticket Transitions

Transition the ticket to "Done" regardless of verdict. Bug tickets filed in step 8 are standalone tickets and track any remaining work.
