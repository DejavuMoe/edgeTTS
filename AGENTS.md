# Agent Guidelines & Repository Protocol

## Project Scope

`edgeTTS` is a self-hosted Microsoft Edge TTS Web service providing real-time streaming speech synthesis and voice discovery.

### Monorepo Architecture

- `apps/server`: Fastify HTTP server and composition root.
- `apps/web`: React + Vite frontend application.
- `packages/tts-core`: Provider-neutral domain contracts and types.
- `packages/edge-provider`: Microsoft Edge Read Aloud TTS provider adapter (`msedge-tts`).
- `packages/tts-service`: Provider-independent application service (voice caching, concurrency limiter, synthesis orchestration).
- `packages/shared`: Shared types and validation schemas.

Repository remote: `git@github.com:DejavuMoe/edgeTTS.git`

## Architecture Rules

The core invocation hierarchy must always be strictly maintained:

```text
HTTP Route (apps/server)
       ↓
  TtsService (packages/tts-service)
       ↓
  TtsProvider (packages/tts-core)
       ↓
EdgeTtsProvider (packages/edge-provider)
       ↓
   msedge-tts
```

Strict boundaries:

- **No provider leakage into HTTP**: HTTP routes must interact solely through `TtsService` ports. HTTP routes must never directly import `msedge-tts` or instantiate `EdgeTtsProvider`.
- **No infrastructure in domain**: `packages/tts-core` must remain strictly provider-neutral and domain-focused. It must never import OpenAI DTOs, HTTP constructs, Fastify types, or Microsoft-specific concerns.
- **Provider-independent service**: `packages/tts-service` must depend only on `@edgetts/tts-core` interfaces, never on `@edgetts/edge-provider`. Concrete provider implementations are injected at the server composition root (`apps/server/src/composition.ts`).
- **No provider-specific types in domain**: Upstream provider types must never leak across domain boundaries.

These import boundaries are enforced by `no-restricted-imports` in `eslint.config.js` and verified by `pnpm test:architecture`. Update both when a boundary changes.

## Agent Execution Rules

- **Direct Execution Only (No Subagents)**: Agents must work directly and must not create or invoke subagents unless the user explicitly overrides this repository rule.
- **Strict Scope Containment**: Do not expand beyond the assigned Phase or task. Do not perform unrelated refactorings or speculative feature development.
- **Preserve Environment Integrity**: Do not modify system configurations, SSH configurations, global tools, or directories outside `/data/Forgejo/edgeTTS`.
- **No Destructive Git Commands**: Never execute `git reset --hard`, `git clean -fd`, `git clean -fdx`, `git push --force`, or `git push --force-with-lease` unless explicitly authorized.
- **Maintain Test Integrity**: Never weaken assertions or delete existing regression tests to force a failing test to pass.
- **Security & Privacy**: Never log, commit, or expose secrets, tokens, private keys, or credentials. Never log raw user synthesis text payloads.

## Validation Protocol

Before declaring any code Phase complete, the following verification suite must pass with zero errors:

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
git diff --check
```

### Live Smoke Tests

Smoke test scripts exist for packages interacting with external services:

- `pnpm --filter @edgetts/edge-provider smoke`
- `pnpm --filter @edgetts/tts-service smoke`
- `pnpm --filter @edgetts/server smoke`

Live smoke tests should only be executed when the active task modifies upstream integration or when live upstream verification is explicitly required. Do not run live network smoke tests for documentation-only or non-runtime changes.

## Git Workflow

For every successfully completed development phase, the agent must autonomously execute the standard workflow:

```text
Implement
   ↓
Validate (build, typecheck, lint, test, format, diff check)
   ↓
Review diff
   ↓
Detailed commit
   ↓
Push to remote
   ↓
Verify remote state
```

### Commit Quality Standards

Low-effort commit messages (e.g. `update`, `fix stuff`, `changes`, `phase done`) are strictly prohibited.

Every commit must include:

1. **Concise Subject**: `<= 72` characters, typically formatted as `Phase N: <concise capability>`.
2. **Detailed Body**: Explaining:
   - What was implemented.
   - Key architectural and design decisions.
   - Important resource lifecycle, concurrency, or safety semantics.
   - Newly added verification and test coverage.
   - Compatibility impact on existing contracts.

_Note: Do not bloat commit messages with full execution logs, generated file lists, token metrics, or conversational reasoning._

### Push Policy

- Push immediately after a successful, validated commit:
  - If upstream is not yet tracked: `git push -u origin <branch>`
  - Subsequent pushes: `git push`
- If push fails (e.g. network/auth), the phase must **not** be marked complete. Accurately report: local commit succeeded, push failed, and the specific failure reason.

### Failed Phase Policy

- If build, typecheck, lint, or tests fail, or the phase implementation is incomplete, **do not** commit or push broken code.
- Mark the status as `PHASE NOT COMPLETE`, detail the blocking issues, and leave the workspace in a recoverable state for resolution. Automatic commit and push apply only to verified, passing phases unless the user explicitly requests a WIP commit.

### Git Safety

- Keep historical commits immutable: never amend, rebase, or squash completed phases.
- Each phase receives a fresh, distinct commit.

## Final Report Requirements

Every phase completion report must include:

- Starting commit hash
- Final commit hash and subject
- Push result and remote reference (`origin/<branch>`)
- Local and remote synchronization state (`local == remote`)
- Final working tree state (`clean`)
- Validation results summary
