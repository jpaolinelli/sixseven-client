Run the full implement → review → QA pipeline for ticket: $ARGUMENTS

Each phase runs as an isolated subagent so the main conversation stays clean.

## Workflow

### Phase 1: Implementation
Delegate to the **implementer** subagent: `@agent-implementer $ARGUMENTS`

Runs in an isolated git worktree. Creates the branch, writes code and tests, runs quality gates (tsc, build, lint, test), commits, and opens a PR. Capture its structured summary.

If the implementer reports blocking issues, **stop the pipeline** and surface to the user.

### Phase 2: Code Review
Delegate to the **reviewer** subagent: `@agent-reviewer $ARGUMENTS`

The reviewer runs the full quality suite, cross-checks acceptance criteria, and returns an APPROVED or CHANGES REQUESTED verdict.

**If CHANGES REQUESTED:**
- Re-delegate to the implementer with feedback: `@agent-implementer fix review issues on branch <branch>: <issues>`
- Re-run the reviewer (v2)
- Max 2 fix-and-review cycles. After that, stop and surface to the user.

**If APPROVED:** continue to Phase 3.

### Phase 3: QA
Delegate to the **qa-engineer** subagent: `@agent-qa-engineer $ARGUMENTS`

Writes adversarial Vitest tests, files Bug tickets for Critical/High findings, and returns QA PASS or QA FAIL.

### Phase 4: Final Report

```
## Pipeline Report — $ARGUMENTS

### Implementation
- Branch: <name>
- PR: <url>

### Review
- Verdict: APPROVED (v<N>)

### QA
- Verdict: QA PASS / QA FAIL
- Bugs filed: <list>

### Final Status
<all phases passed / action needed>
```

## Notes

- Sequential by default. User may request `--parallel` for review + QA simultaneously.
- Each subagent has its own context window; only summaries flow back.
- If a subagent asks a clarifying question, surface immediately and pause.
