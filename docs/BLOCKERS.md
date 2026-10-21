# BlockForge — Blockers

> Owner: ARCHITECT (coordination), with the agent that hit the blocker.
>
> A blocker is written here when a milestone gate has failed **5 consecutive
> fix cycles** (the brief's limit). It is never silently skipped. Each entry
> must be reproducible by someone else.

## Format

```markdown
## <gate> — <one-line summary>

- **Milestone / gate:** M<n> / G<n>
- **Owner:** <agent>
- **Detected:** <ISO timestamp>
- **Symptom:** what is observed
- **Repro:** exact steps or command
- **Evidence:** test name, error output, benchmark number, screenshot
- **Hypothesis:** the most likely cause (may be wrong — say so)
- **Attempted fixes:** numbered list, each with its result
- **Impact:** what is blocked downstream
- **Next:** who acts, on what
```

---

## Open blockers

_None yet._

## Resolved blockers

_None yet. Move entries here once the gate passes; keep the original text
and append a "Resolution" line with the closing commit SHA._
