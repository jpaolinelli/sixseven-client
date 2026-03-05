---
name: sixseven-conventions
description: Use when writing or reviewing TypeScript/React code in the SixSevenDB client project. Provides coding conventions, error handling patterns, and naming rules.
user-invocable: false
---

# SixSevenDB Client Coding Conventions

Follow these conventions exactly when writing or reviewing code in this project.

## Naming

- **Functions / variables**: `camelCase`
- **React components**: `PascalCase` (both name and file)
- **Types / interfaces**: `PascalCase`
- **Constants (module-level)**: `UPPER_CASE` or `camelCase` depending on context
- **Component files**: `PascalCase.tsx` (e.g., `QueryEditor.tsx`)
- **Utility/type files**: `kebab-case.ts` (e.g., `graph-utils.ts`)
- **Test files**: `kebab-case.test.ts` in `__tests__/` directory

## File Organization

- **Components**: `web/components/` — one component per file
- **Utilities/types**: `web/lib/` — group by domain (graph, dashboard, connection, etc.)
- **API routes**: `web/app/api/<name>/route.ts` — Next.js App Router convention
- **Tests**: `web/__tests__/` — flat directory, one test file per module

## Imports

Use the `@/` path alias for project imports:

```typescript
import { DatabaseInfo } from '@/lib/types';
import { QueryEditor } from '@/components/QueryEditor';
```

Order imports: React/Next.js first, then third-party, then project imports. Separate each group with a blank line.

```typescript
import { useState, useEffect } from 'react';

import { Pool } from 'pg';

import { DatabaseInfo } from '@/lib/types';
import { executeQuery } from '@/lib/db';
```

## React Patterns

- Use function components with hooks — no class components.
- Use `'use client'` directive for components that use browser APIs, hooks, or event handlers.
- Keep server components as the default where possible.
- Use React Context for shared state (see `ConnectionContext`).
- Use `localStorage` for user preferences (profiles, query history).

## TypeScript

- Use strict mode (`strict: true` in tsconfig).
- Prefer `interface` for object shapes, `type` for unions/intersections.
- Avoid `any` — use `unknown` and narrow with type guards when the type is truly unknown.
- Use explicit return types on exported functions.
- Use `readonly` for props and immutable data.

## Error Handling

- API routes: Always return proper HTTP status codes with error messages in JSON body.
- Client-side: Catch errors and display them to the user via state (error banners, toast, etc.).
- Never swallow errors silently — at minimum log them with `console.error`.

```typescript
// API route pattern
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await doSomething(body);
    return Response.json(result);
  } catch (error) {
    console.error('Operation failed:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
```

## Styling

- Use Tailwind CSS utility classes — no custom CSS unless absolutely necessary.
- Use `globals.css` only for base styles and CSS custom properties.
- Prefer responsive design with Tailwind breakpoint prefixes (`sm:`, `md:`, `lg:`).

## General Rules

- Prefer `const` over `let`. Never use `var`.
- Use template literals for string interpolation.
- Use optional chaining (`?.`) and nullish coalescing (`??`) over manual checks.
- Use `Array.map/filter/reduce` over imperative loops where it improves readability.
- Keep components focused — extract sub-components when a file exceeds ~300 lines.
