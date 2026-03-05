---
name: sixseven-architecture
description: Use when you need to understand the SixSevenDB client project structure, component layout, or system architecture. Provides the module map, data flow, and key abstractions.
user-invocable: false
---

# SixSevenDB Client Architecture

## System Overview

The SixSevenDB client is a Next.js 15 web admin console that connects to SixSevenDB via the PostgreSQL wire protocol.

```
Browser (React 19, Client Components)
        |
Next.js App Router
        |
API Routes (Server-Side)
        |
pg (PostgreSQL Client)
        |
SixSevenDB Server (wire protocol v3)
```

## Data Flow

User interactions flow through this pipeline:

```
User Action (click, query, etc.)
  -> React Component (state update)
  -> fetch('/api/<route>', { ... })
  -> Next.js API Route Handler
  -> pg.Pool.query(sql)
  -> SixSevenDB Server
  -> Response JSON
  -> Component state update
  -> UI re-render
```

## Component Map

| Component | File | Purpose |
|-----------|------|---------|
| Root Layout | `app/layout.tsx` | HTML shell, metadata, global styles |
| Main Page | `app/page.tsx` | Single-page admin UI, panel management |
| ConnectionManager | `components/ConnectionManager.tsx` | Server connection profiles, connect/disconnect |
| SchemaBrowser | `components/SchemaBrowser.tsx` | Tree-based DB/table/column browser |
| SchemaDetails | `components/SchemaDetails.tsx` | Column, index, embedding detail view |
| QueryEditor | `components/QueryEditor.tsx` | Multi-tab SQL editor with history |
| SqlEditor | `components/SqlEditor.tsx` | CodeMirror 6 wrapper with SQL dialect |
| QueryResults | `components/QueryResults.tsx` | Results table with sort/filter/export |
| QueryPlanViewer | `components/QueryPlanViewer.tsx` | EXPLAIN plan tree visualizer |
| GraphExplorer | `components/GraphExplorer.tsx` | Interactive graph visualization |
| Dashboard | `components/Dashboard.tsx` | Real-time server metrics |
| TreeNode | `components/TreeNode.tsx` | Reusable collapsible tree node |

## API Route Map

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/ping` | POST | Test connectivity to SixSevenDB server |
| `/api/schema` | GET | Introspect databases, tables, columns, indexes |
| `/api/query` | POST | Execute arbitrary SQL queries |
| `/api/dashboard` | POST | Fetch real-time server metrics |
| `/api/graph` | POST | Graph traversal, shortest path, node details |

## Library Modules

| Module | File | Purpose |
|--------|------|---------|
| `types.ts` | Core domain types | DatabaseInfo, TableInfo, ColumnInfo, EdgeTypeInfo |
| `db.ts` | Database connectivity | pg.Pool management, query execution |
| `connection-types.ts` | Connection types | ConnectionProfile, ConnectionState |
| `connection-profiles.ts` | Profile persistence | localStorage CRUD for server profiles |
| `ConnectionContext.tsx` | Connection state | React Context for active connection |
| `schema-utils.ts` | Schema fetching | SQL queries for schema introspection |
| `dashboard-types.ts` | Dashboard types | MetricsData, BufferPoolStats |
| `dashboard-utils.ts` | Dashboard parsing | Parse SHOW STATUS output |
| `export.ts` | Data export | CSV, JSON, clipboard copy |
| `graph-types.ts` | Graph types | GraphNode, GraphEdge, TraversalResult |
| `graph-utils.ts` | Graph API calls | Traverse, shortest path, node details |
| `graph-query-utils.ts` | Query transformation | Detect/transform TRAVERSE queries |
| `query-history.ts` | History persistence | localStorage query history management |
| `sixseven-sql-lang.ts` | SQL dialect | CodeMirror language with SixSevenDB keywords |

## Key Abstractions

### Connection Management

- **ConnectionProfile**: Persisted server connection config (host, port, user, database).
- **ConnectionContext**: React Context providing active connection state, connect/disconnect, auto-reconnect.
- **Default profile**: `localhost:6767`, user `sixseven`, database `sixseven`.

### Query Pipeline

1. User types SQL in CodeMirror editor.
2. On execute, `POST /api/query` with SQL string + connection params.
3. API route acquires a `pg.Pool`, runs the query.
4. Results returned as `{ columns, rows, rowCount }`.
5. `QueryResults` component renders with pagination, sort, filter, export.

### Graph Visualization

1. User starts from a node (table + row ID).
2. `POST /api/graph` with traversal params (direction, edge type, depth).
3. API route runs `TRAVERSE` SQL, parses node/edge results.
4. vis-network renders force-directed graph with interactive controls.

### Schema Introspection

1. `GET /api/schema` runs `SHOW DATABASES`, then per-database `SHOW TABLES`, `SHOW COLUMNS`, etc.
2. Results structured as `DatabaseInfo[]` tree.
3. `SchemaBrowser` renders as collapsible tree with lazy loading.

## SixSevenDB-Specific SQL

The client supports these SixSevenDB extensions beyond standard SQL:

- `TRAVERSE <table>(<id>) [IN|OUT|BOTH] [EDGE <type>] [DEPTH <n>]`
- `NEAREST <table>(<column>, <vector>, <k>)`
- `LINK <src_table>(<src_id>) TO <dst_table>(<dst_id>) AS <edge_type>`
- `UNLINK <src_table>(<src_id>) FROM <dst_table>(<dst_id>) AS <edge_type>`
- `CREATE TABLE ... (col EMBEDDING(dim, source, provider))`
- `REEMBED <table>`
- `SHOW STATUS`, `SHOW DATABASES`, `SHOW TABLES`, `SHOW COLUMNS`
