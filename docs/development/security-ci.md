# Security checks and CI experiments

## Required checks

The [main CI](../../.github/workflows/ci.yml) runs build, type checking (including
tests), ESLint, all offline tests, formatting, and Git tree checks. Docker and
proxy contract jobs validate deployment behavior. Publication requires those
jobs and both languages in the reusable [CodeQL workflow](../../.github/workflows/codeql.yml).

CodeQL scans JavaScript/TypeScript and GitHub Actions with `security-extended`,
without installing or building untrusted pull-request code. Findings are uploaded
to GitHub code scanning. A local SARIF gate also blocks publication for security
scores of 7 or higher and non-security errors; an upload succeeding alone is not
a passing security gate. Scheduled weekly scans detect newly added queries.

Reviewed false positives are recorded in
[codeql-reviewed-findings.json](../../.github/codeql-reviewed-findings.json).
An exception must match the rule, primary file and line, and the SHA-256 of the
entire source file (normalized to LF). Source changes fail closed and require
another review; other locations using the same rule still block publication.
The sole initial exception is API-key comparison in `auth.ts`: its random-key
HMAC tags are used only for `timingSafeEqual`, never persisted, logged or returned.
The password-storage query's offline hash-database threat model does not apply.
This exception does not permit storing user passwords with HMAC or a fast hash.

Actions are pinned by full commit SHA, checkouts do not persist credentials, and
permissions are scoped to individual jobs. Pull requests cannot publish images
or submit dependency snapshots. No `pull_request_target` execution is used.

## Dependency coverage

Dependabot alerts, malware alerts, security updates and grouped security updates
are enabled in repository settings. Version update PRs cover Actions and Docker;
they require review and normal CI and are never automatically merged.

At setup time, [GitHub's supported pnpm versions](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)
stop at 10; this repository uses pnpm 12. Do not assume the lockfile is fully
understood by native dependency review or that npm security PRs will be created.
The [dependency security workflow](../../.github/workflows/dependency-security.yml)
submits pnpm's installed, resolved runtime and development package inventory on
every `master` push and daily. It uses the
[dependency submission API](https://docs.github.com/en/rest/dependency-graph/dependency-submission),
with `contents: write` limited to that trusted job. The inventory covers packages
installed on Linux, including transitive dependencies; it is not an inventory of
every optional package for other platforms or the container OS.

Every main CI run and the daily job audit runtime and development dependencies.
High and critical advisories fail. Lower severities remain visible.
PR dependency review supplements these checks for manifests GitHub understands.
Keep manually updating pnpm dependencies until native pnpm 12 support is verified.

Private vulnerability reporting, secret scanning, and push protection are
repository settings, not workflow flags. Generic secret patterns and validity
checks depend on GitHub account eligibility. Agentic Autofix is not enabled because
it consumes AI credits; existing Copilot Autofix suggestions do not auto-merge code.

## CI check ablation

The [2026-10-25 results and decisions](research/ci-ablation.zh-CN.md) preserve
the detection matrix, timing comparisons, workflow profiles and evidence links.

Run `pnpm experiment:ci` on Linux after installing the frozen dependencies, or
dispatch [CI Ablation](../../.github/workflows/ci-ablation.yml). This is separate
from the existing application-mechanism experiment in `scripts/ablation/`.

The experiment makes fresh disposable copies with installed dependencies, injects
one defect per copy, runs each of the five quality commands even after a failure,
and brackets the mutations with two clean baselines. The source files and existing
test assertions remain unchanged in the canonical repository. Each subprocess has
a five-minute limit, receives a minimal environment without repository tokens,
and writes only to its temporary workspace. Run only reviewed revisions.
pnpm's automatic pre-run installation is disabled in the copies so relocating
the installed workspace does not add dependency installation to build timings.

Six seeded defects cover a missing web entry, a test-only type error, unused code,
an incorrect HTTP status, formatting drift, and a broken documentation link.
The experiment records the detection matrix and command durations, then computes
each leave-one-check-out verdict from that matrix. It does not rerun six separate
GitHub workflows or alter production gates. Baseline failures, missing mutation
anchors, interrupted processes and missed seeded defects fail the experiment.

Results and command logs are in `coverage/ci-ablation/`; the manual workflow
retains them for 14 days and includes the table in its summary. Timings use the
mean of the two clean runs and sum sequential command time. Runner queues,
installation, network audits, CodeQL, Docker, proxy contracts and publication are
excluded. These checks need separate representative fixtures before their
necessity can be evaluated. A six-fixture detection rate is not an estimate of
real-world security coverage, and overlapping detections do not justify deleting
a check. Build outputs are prerequisites for later checks: omitting the build
verdict does not permit deleting all build execution, so reported omitted-command
time is only an upper bound on potential savings.

The extended manual workflow also runs real CodeQL 2.27.3 scans, isolated pnpm
audits and deployment canaries. Reproduce them with
`pnpm experiment:ci:extended codeql|dependencies|deployment` (choose one mode).
CodeQL needs an absolute `CODEQL` executable path; deployment needs a freshly
built `EDGETTS_TEST_IMAGE` and `pnpm build`. Results, scanner SARIF and logs are
saved under `coverage/ci-extended/`. Canary source is generated in disposable
directories, never executed, never published as an image and never uploaded to
the repository's code-scanning baseline. Clean controls bracket the defects;
timeouts, infrastructure failures and unexpected findings fail the experiment.

JavaScript command/log injection and Actions expression injection distinguish
scanner detection from the existing high/critical blocking policy. Runtime and
development dependency canaries use a known vulnerable `shell-quote` release,
with a patched control; narrowing the audit to production must miss the seeded
development dependency. Docker canaries exercise root execution and writable
application code. Nginx canaries exercise buffering and incorrect upstream URI
routing, including a real HTTPS streaming assertion. These are representative
checks, not an exhaustive vulnerability corpus or proof of native pnpm 12
Dependency Review coverage. A disabled `NO_PROXY` bypass is checked separately
on Node and the production Bun runtime, with clean controls on both.

`pnpm experiment:ci --parallel` repeats the six quality fixtures using the actual
`ci:parallel` command: build first, then typecheck, lint, tests and formatting
together. `concurrently` waits for every process and returns failure if any fails.
The manual workflow compares this with sequential execution on the same runner.
Two independent GHA cache trials compare fresh builds, cold cache export, warm
cache import into a different builder, and source-change invalidation. All images
run the existing isolated runtime contract; unchanged cold/warm image IDs must
match and the changed source must appear in the rebuilt image. No experiment
removes a production check or automatically enables an optimization.
