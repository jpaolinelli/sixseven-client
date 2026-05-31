---
name: git-workflow
description: Use when you need to create branches, write commit messages, push to remote, or create pull requests for the SixSevenDB client project. Provides branching conventions, commit message format, and PR template.
user-invocable: false
---

# Git Workflow

## Branching

Create feature branches from the current branch using the Jira ticket ID:

```bash
git checkout -b GDB-<number>
```

Branch names use the ticket key exactly (uppercase). Example: `GDB-22`, `GDB-108`.

## Commit Messages

Use this format for commit messages:

```
<TICKET-ID>: <Short imperative summary (under 72 chars)>

<Detailed description organized by subtask or component:>
- <SUBTASK-ID>: What was implemented
- <SUBTASK-ID>: What was implemented
...

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

Always pass the commit message via a HEREDOC:

```bash
git commit -m "$(cat <<'EOF'
GDB-300: Add dark mode toggle to web admin

- GDB-301: Theme context provider and toggle component
- GDB-302: Dark mode styles for all components

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

## Pull Requests

Create PRs using the GitHub CLI:

```bash
gh pr create --title "<TICKET-ID>: <Parent ticket summary>" --body "$(cat <<'EOF'
## Summary
- <bullet points describing what was implemented>

## Jira
- [<TICKET-ID>](https://undiscoveredtech.atlassian.net/browse/<TICKET-ID>)

## Test Plan
- [ ] All tests pass (`cd web && npm test`)
- [ ] TypeScript compiles (`cd web && npx tsc --noEmit`)
- [ ] Production build succeeds (`cd web && npm run build`)
- [ ] Lint clean (`cd web && npm run lint`)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

## Viewing Branch Changes

To understand what changed on the current branch vs main:

```bash
# Diff stat
git diff --stat main...HEAD

# Full source diff
git diff main...HEAD -- web/ clients/

# Commit log
git log --oneline main..HEAD
```

## Safety Rules

- Never force push to main/master.
- Never amend commits unless explicitly asked — always create new commits.
- Stage specific files by name — avoid `git add -A` or `git add .`.
- Never commit `.env`, credentials, or `node_modules/`.
