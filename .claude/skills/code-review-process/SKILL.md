---
name: code-review-process
description: Use when performing a code review. Provides the structured review methodology — how to cross-check acceptance criteria, evaluate code quality, assess test coverage, and produce the final review verdict.
user-invocable: false
---

# Code Review Process

## Step 1: Read All Source Files

Find and read every file added or modified for the ticket:

- **Components**: `web/components/*.tsx`
- **Library/utilities**: `web/lib/*.ts`, `web/lib/*.tsx`
- **API routes**: `web/app/api/**/*.ts`
- **Pages**: `web/app/**/*.tsx`
- **Tests**: `web/__tests__/*.test.ts`
- **Config**: `package.json`, `tsconfig.json`, `next.config.ts`

Read every file completely. Do not skim or skip.

## Step 2: Acceptance Criteria Cross-Check

For the parent ticket and every subtask, create a table:

| Criterion | Status | Evidence |
|-----------|--------|----------|
| description | ✅ / ⚠️ Low / ⚠️ Medium / ❌ High | file, function, or test name |

**Severity levels:**
- **✅** — Fully met.
- **⚠️ Low** — Minor gap, cosmetic, or reasonable phase deferral.
- **⚠️ Medium** — Should be fixed but not blocking (duplication, missing edge case).
- **❌ High** — Criterion not met, correctness bug, or missing required functionality.

Every single criterion must appear in the table. Never omit one.

## Step 3: Code Quality Evaluation

Check for:

- **Correctness**: Logic errors, wrong API calls, missing error handling.
- **TypeScript**: Proper typing, no `any` abuse, correct use of generics and unions.
- **React patterns**: Proper hook usage, no unnecessary re-renders, correct dependency arrays.
- **Error handling**: API routes handle errors gracefully, client-side errors shown to user.
- **Naming**: `camelCase` functions/variables, `PascalCase` components/types.
- **Duplication**: Identical logic that should be extracted to a shared utility.
- **Security**: No XSS vectors, no SQL injection, proper input sanitization.
- **Accessibility**: Semantic HTML, ARIA attributes where needed.
- **Consistency**: New code matches existing codebase patterns.

## Step 4: Test Quality Evaluation

- **Coverage**: Every new function/component has at least one test. Key branches tested.
- **Meaningful assertions**: Every test asserts something substantive. Flag empty or trivial tests.
- **Edge cases**: Empty inputs, null/undefined, error conditions, boundary values tested.
- **Mocking**: External dependencies (db, network) properly mocked.
- **Tests** DO NOT RUN TESTS, just verify they exist and are of high quality.

## Step 5: Review Output Format

```
# <TICKET-ID> — <Summary> — v<N> Review

## Build & Test Status
✅, type check, lint status

## Files Reviewed
| Category | Files | Lines |
|----------|-------|-------|
| Components | N | N |
| Library | N | N |
| API Routes | N | N |
| Tests | N | N |
| Total | N | N |

## Acceptance Criteria Cross-Check

### <TICKET-ID> (Parent)
| Criterion | Status | Evidence |

### <SUBTASK-ID> — <Summary>
| Criterion | Status | Evidence |

## Architecture Assessment
Component design, separation of concerns, consistency with existing patterns.

## Issues Found
### 1. <Title> — **Severity**
Description, file/line location, suggested fix.

## Verdict: ✅ APPROVED / ❌ CHANGES REQUESTED
Summary justification.
```

## Verdict Rules

- **APPROVED**: All criteria ✅ or ⚠️ Low. No High or Medium issues.
- **CHANGES REQUESTED**: Any ❌ High, or multiple ⚠️ Medium that collectively warrant fixes.
- Low severity and reasonable phase deferrals do not block approval.

## Re-Review

- First review = **v1**, subsequent = **v2**, **v3**, etc.
- On re-review: verify previously reported issues are fixed, check for regressions.
- If APPROVED, transition ticket to QA with the PR summary as a comment.
