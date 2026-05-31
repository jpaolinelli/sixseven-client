# SixSevenDB Client — Project Guide

SixSevenDB Client contains the web admin console and client SDK stubs for the SixSevenDB database.

## Architecture

```
web/                     — Next.js 15 Web Admin Console
├── app/                 — App Router (pages + API routes)
│   ├── layout.tsx       — Root layout
│   ├── page.tsx         — Main dashboard UI
│   └── api/             — Backend API routes
│       ├── ping/        — Connectivity check
│       ├── schema/      — Schema introspection
│       ├── query/       — SQL query execution
│       ├── dashboard/   — Server metrics
│       └── graph/       — Graph traversal
├── components/          — React UI components
├── lib/                 — Shared utilities & types
└── __tests__/           — Vitest unit tests

clients/                 — Client SDK stubs (placeholder)
├── python/
├── nodejs/
├── go/
├── rust/
├── java/
└── dotnet/
```

## Tech Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| Next.js | 15.1.0 | React framework (App Router) |
| React | 19.0.0 | UI library |
| TypeScript | 5.7 | Type safety |
| Tailwind CSS | 4.0 | Styling |
| CodeMirror 6 | latest | SQL editor |
| recharts | 3.7.0 | Dashboard charts |
| vis-network | 10.0.2 | Graph visualization |
| pg | 8.13.0 | PostgreSQL client (SixSevenDB wire protocol) |
| Vitest | 4.0.18 | Unit testing |

## Build Commands

```bash
# Install dependencies
cd web && npm install

# Development server
cd web && npm run dev

# Production build
cd web && npm run build

# Run tests
cd web && npm test

# Run tests in watch mode
cd web && npm run test:watch

# Lint
cd web && npm run lint

# Type check
cd web && npx tsc --noEmit
```

## Directory Layout

```
web/
├── app/                 — Next.js App Router pages and API routes
│   ├── layout.tsx       — Root layout with metadata
│   ├── page.tsx         — Main single-page admin UI
│   ├── globals.css      — Tailwind CSS styles
│   └── api/             — Server-side API routes
├── components/          — React components
│   ├── ConnectionManager.tsx  — Server connection UI
│   ├── Dashboard.tsx          — Real-time metrics
│   ├── GraphExplorer.tsx      — Interactive graph viz
│   ├── QueryEditor.tsx        — Multi-tab SQL editor
│   ├── QueryResults.tsx       — Results table
│   ├── QueryPlanViewer.tsx    — EXPLAIN visualizer
│   ├── SchemaBrowser.tsx      — DB/table tree browser
│   ├── SchemaDetails.tsx      — Column/index details
│   ├── SqlEditor.tsx          — CodeMirror 6 wrapper
│   └── TreeNode.tsx           — Reusable tree node
├── lib/                 — Shared utilities and types
│   ├── types.ts               — Core domain types
│   ├── connection-types.ts    — Connection types
│   ├── connection-profiles.ts — localStorage profiles
│   ├── ConnectionContext.tsx   — React Context for connection
│   ├── db.ts                  — PostgreSQL pool management
│   ├── schema-utils.ts        — Schema fetching utilities
│   ├── dashboard-types.ts     — Dashboard data structures
│   ├── dashboard-utils.ts     — Dashboard data parsing
│   ├── export.ts              — CSV/JSON export
│   ├── graph-types.ts         — Graph visualization types
│   ├── graph-utils.ts         — Graph API calls
│   ├── graph-query-utils.ts   — TRAVERSE query handling
│   ├── query-history.ts       — Query history persistence
│   └── sixseven-sql-lang.ts   — CodeMirror SQL dialect
└── __tests__/           — Vitest unit tests
```

## Coding Conventions

- **Components**: `PascalCase.tsx` (e.g., `QueryEditor.tsx`)
- **Utilities/types**: `kebab-case.ts` (e.g., `graph-utils.ts`)
- **Test files**: `kebab-case.test.ts` in `__tests__/` directory
- **Functions/variables**: `camelCase`
- **Types/interfaces**: `PascalCase`
- **Constants**: `UPPER_CASE` or `camelCase` depending on scope
- **React components**: Function components with hooks (no class components)
- **Imports**: Use `@/` path alias for project imports

## Database Connectivity

The web admin connects to SixSevenDB via the PostgreSQL wire protocol using the `pg` package.

Environment variables:
- `SIXSEVEN_HOST` (default: `localhost`)
- `SIXSEVEN_PORT` (default: `6767`)
- `SIXSEVEN_USER` (default: `sixseven`)
- `SIXSEVEN_DEFAULT_DATABASE` (default: `sixseven`)

## Testing

- Tests live in `web/__tests__/` using Vitest
- Test files follow `<name>.test.ts` naming
- QA regression tests use `qa-<ticket>.test.ts` naming (e.g., `qa-gdb-299-graph-query-utils.test.ts`)
- Mock external dependencies (db, network) with `vi.mock()`
- Run with `cd web && npm test`

## Key Patterns

- **API routes**: Next.js App Router route handlers in `app/api/` — each exports async `POST` or `GET` functions
- **Connection pooling**: `lib/db.ts` manages `pg.Pool` instances per database
- **State management**: React Context (`ConnectionContext`) for connection state, localStorage for profiles and query history
- **SQL dialect**: Custom CodeMirror language extension in `sixseven-sql-lang.ts` with SixSevenDB-specific keywords (TRAVERSE, NEAREST, EMBEDDING, etc.)
- **Graph visualization**: vis-network force-directed layout with deterministic node colors per table
