---
name: quality-checks
description: Use when you need to run code quality tools — TypeScript type checking, building, running tests, or linting. Provides the exact commands and interpretation of results for the SixSevenDB client project.
user-invocable: false
---

# Quality Checks

All commands run from the `web/` directory.

## Build

```bash
cd web && npm run build
```

Must complete with zero errors. Next.js build catches TypeScript errors, missing imports, and SSR issues.

## Type Check

```bash
cd web && npx tsc --noEmit
```

Must complete with zero errors. Catches type mismatches without producing output files.

## Lint

```bash
cd web && npm run lint
```

Must complete with zero warnings or errors.

## Tests

Run all unit tests:

```bash
cd web && npm test
```

All tests must pass. If any fail, read the failure output and fix before proceeding.

### Running specific tests

```bash
cd web && npx vitest run __tests__/<filename>.test.ts
```

### Running QA-specific tests

```bash
cd web && npx vitest run __tests__/qa-*.test.ts
```

### Running tests for a specific ticket

```bash
cd web && npx vitest run __tests__/qa-gdb-<N>-*.test.ts
```

## Pre-Commit Checklist

Before every commit, run these in order:

1. Type check passes (`npx tsc --noEmit`)
2. Build succeeds (`npm run build`)
3. All tests pass (`npm test`)

Never commit if any of these steps fail.
