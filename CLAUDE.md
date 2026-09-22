# CLAUDE.md

## Workflow

- For each task: implement, present the diff for review, commit only after explicit approval.
- One reviewable unit per commit; do not batch unrelated work.
- npm only (never pnpm, yarn, bun). Node 26. Commit `package-lock.json`.

## Commits

- Subject-only, no body. Format: `area: imperative subject`.
- No `Co-Authored-By` or other self-attribution trailers.

## Code

- Comments default to none. Add only when the WHY is non-obvious (hidden constraint, subtle invariant, workaround).
- ASCII only in source, comments and string literals alike: `us` not `µs`, `->` not `→`.
- Dashes are plain `-` everywhere: never `--`, never an em-dash. Applies to all writing (comments, docs, commit/PR text).
- No tracker/task numbers, plan references, or dates: state the substantive fact instead.
- No unrequested UX affordances: hints, guardrails and convenience controls only when asked for.
- Prettier owns formatting; ESLint owns correctness. Do not add stylistic lint rules.

## Dependencies

- `@openservocore/client` is the wasm build of the monorepo's `client/web`, consumed as a local path dependency (`file:../open-servo-core/client/web`). `npm run wasm` builds it; the monorepo must be checked out as a sibling directory.
