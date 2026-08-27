# SixSevenDB Client

> **Status: major work in progress.** The client SDKs in [`clients/`](clients/) are not implemented properly yet — treat them as scaffolding, not usable libraries. The [web admin console](web/) is further along and is currently the best way to connect to and test against a SixSevenDB server.

SixSevenDB Client contains the web admin console and client SDK stubs for the SixSevenDB database.

## Repository Layout

```
web/                     — Next.js 15 web admin console
├── app/                 — App Router (pages + API routes)
├── components/          — React UI components
├── lib/                 — Shared utilities & types
└── __tests__/           — Vitest unit tests

clients/                 — Client SDK stubs (WIP, not production-ready)
├── python/
├── nodejs/
├── go/
├── rust/
├── java/
└── dotnet/
```

## Web Admin Console

A single-page Next.js app for connecting to and exploring a SixSevenDB server: SQL query editor, schema browser, graph explorer, and dashboard metrics.

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

### Getting Started

```bash
cd web
npm install
npm run dev
```

The admin console connects to a SixSevenDB server over the PostgreSQL wire protocol. Configure the connection with environment variables:

- `SIXSEVEN_HOST` (default: `localhost`)
- `SIXSEVEN_PORT` (default: `6767`)
- `SIXSEVEN_USER` (default: `sixseven`)
- `SIXSEVEN_DEFAULT_DATABASE` (default: `sixseven`)

### Other Commands

```bash
npm run build        # Production build
npm test             # Run tests
npm run test:watch   # Run tests in watch mode
npm run lint         # Lint
npx tsc --noEmit      # Type check
```

See [CLAUDE.md](CLAUDE.md) for the full directory layout, coding conventions, and key architectural patterns.

## Client SDKs

`clients/` holds early-stage SDK scaffolding for Python, Node.js, Go, Rust, Java, and .NET. These are **not** ready for use against a real SixSevenDB deployment — use the web admin console instead if you need to exercise a running server today.
