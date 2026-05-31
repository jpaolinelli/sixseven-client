---
name: sixseven-testing
description: Use when writing or reviewing unit tests for the SixSevenDB client project. Provides test patterns, mocking conventions, and quality requirements.
user-invocable: false
---

# SixSevenDB Client Testing Guide

## Framework

Vitest. All tests live in `web/__tests__/` with `<name>.test.ts` naming.

## Test Targets

| Type | Directory | File Pattern | Command |
|------|-----------|-------------|---------|
| Dev tests | `web/__tests__/` | `<name>.test.ts` | `npm test` |
| QA regression | `web/__tests__/` | `qa-gdb-<N>-<name>.test.ts` | `npx vitest run __tests__/qa-*` |

> **Note**: Unlike the server repo, client tests are in a single directory. QA tests are distinguished by the `qa-` filename prefix.

## Test Naming

Use `describe` and `it` blocks:

```typescript
describe('QueryEditor', () => {
  it('should execute query on submit', () => { ... });
  it('should display error for invalid SQL', () => { ... });
});
```

- **describe**: The module or component under test.
- **it**: A specific behavior being verified. Start with "should".

## Mocking

Use `vi.mock()` for external dependencies:

```typescript
// Mock the database module
vi.mock('@/lib/db', () => ({
  getPool: vi.fn(),
  executeQuery: vi.fn(),
}));

// Mock Next.js request/response
const mockRequest = {
  json: vi.fn().mockResolvedValue({ query: 'SELECT 1' }),
} as unknown as Request;
```

### Common Mocks

- **Database (`@/lib/db`)**: Mock `getPool` and query execution.
- **localStorage**: Use `vi.stubGlobal` or mock the storage functions.
- **fetch**: Use `vi.fn()` to mock API calls in component tests.

## Assertion Patterns

```typescript
// Basic assertions
expect(result).toBe(expected);
expect(result).toEqual(expectedObject);
expect(result).toBeDefined();
expect(result).toBeNull();

// Array assertions
expect(items).toHaveLength(3);
expect(items).toContainEqual(expectedItem);

// Error assertions
expect(() => riskyFunction()).toThrow();
expect(() => riskyFunction()).toThrow('specific message');

// Async assertions
await expect(asyncFunction()).resolves.toBe(value);
await expect(asyncFunction()).rejects.toThrow();

// Mock assertions
expect(mockFn).toHaveBeenCalledWith(expectedArgs);
expect(mockFn).toHaveBeenCalledTimes(1);

// API response assertions
const response = await POST(mockRequest);
const body = await response.json();
expect(response.status).toBe(200);
expect(body.rows).toHaveLength(5);
```

## Test Quality Requirements

Every test MUST:

1. **Assert something substantive** — never create a test that only calls a function without checking results.
2. **Test one specific behavior** — not a grab-bag of unrelated checks.
3. **Have a clear name** describing what is verified.

Tests SHOULD cover:

- **Happy path**: Normal inputs produce expected outputs.
- **Edge cases**: Empty inputs, null/undefined, empty arrays, boundary values.
- **Error conditions**: Invalid inputs, network failures, malformed responses.
- **Integration**: At least one test exercising the full API route handler.

## QA Test Naming Convention

QA regression tests are prefixed with `qa-` and include the ticket number:

```
__tests__/qa-gdb-299-graph-query-utils.test.ts
__tests__/qa-gdb-350-dashboard-metrics.test.ts
```

## Build and Run

```bash
# Run all tests
cd web && npm test

# Run specific test file
cd web && npx vitest run __tests__/export.test.ts

# Run tests matching a pattern
cd web && npx vitest run --reporter=verbose __tests__/graph-*.test.ts

# Run in watch mode
cd web && npm run test:watch
```
