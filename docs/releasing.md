# Release Governance & Rollback Procedure

This document defines the release lifecycle, supply chain promotion contract, repository protection recommendations, and disaster recovery rollback procedures for `edgeTTS`.

---

## 1. Release Philosophy & Promotion Architecture

edgeTTS packages and publishes official multi-architecture container images to GitHub Container Registry (GHCR):

```text
ghcr.io/dejavumoe/edgetts
```

### Strict Stable SemVer

edgeTTS enforces strict Semantic Versioning for all production release tags:

```text
^v[0-9]+\.[0-9]+\.[0-9]+$
```

- **Supported Formats**: `v0.1.0`, `v1.0.0`, `v1.2.3`
- **Prohibited Formats**: Prereleases (`-alpha`, `-beta`, `-rc.1`), partial tags (`v1`, `v1.2`), and build metadata (`+build`) are rejected by both local preflight tools and automated CI validation.

### Two-Stage Release Promotion (Candidate Before Promotion)

To eliminate half-verified releases, edgeTTS separates container compilation from stable release tag promotion:

```text
Git Release Tag (vX.Y.Z)
       ↓
  Full CI Suite (quality, docker, proxy-contract)
       ↓
  Compile & Push Commit Candidate (:sha-<git-sha>)
       ↓
  Exhaustive Verification:
    - OCI Multi-Arch Index Manifest
    - linux/amd64 Runtime & Non-Root Execution
    - linux/arm64 Runtime & Non-Root Execution (under QEMU)
    - BuildKit SLSA Provenance (mode=max)
    - SPDX SBOM Attestations
    - Layer History & Environment Credential Audits
    - Runtime Filesystem Boundary Isolation
       ↓
  Tag Overwrite & Idempotence Audit
       ↓
  Promote Stable Aliases (:X.Y.Z and :latest)
```

1. **Zero-Rebuild Content Identity**: Release aliases (`:X.Y.Z` and `:latest`) are promoted directly from the verified candidate using `docker buildx imagetools create` referencing the exact OCI index digest. Images are **never recompiled** for promotion, eliminating two-build compiler drift.
2. **Attestation Preservation**: Promoted aliases reference the exact same multi-architecture index manifest, preserving both architecture child descriptors (`linux/amd64`, `linux/arm64`) and attached SLSA provenance and SBOM attestation manifests.
3. **Fail-Closed Tag Overwrite Protection**: If `:X.Y.Z` already exists in GHCR with a different digest, the publishing workflow terminates with a hard failure. Existing release versions can never be silently overwritten or retagged. If an existing tag resolves to the identical verified digest (such as during a workflow rerun), the operation is treated as an idempotent success.
4. **Monotonic `:latest` Invariant**: `:latest` always resolves to the highest successfully published strict stable SemVer release known to the system. It is never decided by chronological execution order or "last writer wins". Rerunning an older release workflow (e.g. rerunning `v1.2.3` when `v1.3.0` is already published) or releasing a backported maintenance patch (e.g. releasing `v1.9.5` after `v2.0.0`) publishes the specific SemVer tag but **never rolls `:latest` backward**.
5. **Serialized Registry Publication**: The `publish` job runs under a repository-wide concurrency critical section (`group: edgetts-ghcr-publish`, `cancel-in-progress: false`). Multiple release or branch publications are strictly serialized, eliminating concurrency races against registry aliases.
6. **Ancestry Verification**: Release tags must target a commit already present in `origin/main` commit history (`git merge-base --is-ancestor`). Tags pointing to unmerged topic branches or detached commits are rejected before compilation.
7. **Rejection of Moved Tags**: The publishing workflow checks `github.event.before`. If an existing tag was moved or force-updated to a new commit (`github.event.before != 000...000`), the workflow immediately fails.

---

## 2. Production Rollback Procedure

> [!IMPORTANT]
> **Rollback means redeploying a previously verified OCI digest. It does not mean rebuilding an old Git commit.**

### Why Tag-Based Rollback is Prohibited

- **Never Roll Back by `:latest`**: The `:latest` tag is a moving alias that changes whenever a new release is promoted. Rolling back using `:latest` can inadvertently deploy the broken version again or create race conditions across multi-node clusters.
- **Never Move Release Tags Backward**: Moving a Git tag (e.g. force-pushing `v1.2.0` to an older commit) violates immutability expectations, breaks cache layers, and is rejected by edgeTTS release governance.
- **Never Rebuild Old Git Commits**: Running `docker build` against an older Git commit does not guarantee an identical runtime image. Upstream base images (e.g. `node:24-alpine`), OS security patches, and package repository mirrors change over time.

### Immutable Digest Rollback Procedure

To roll back a service to a previous stable state:

#### Step 1: Identify the Known-Good OCI Index Digest

Obtain the exact OCI digest (`sha256:...`) of the previously verified release from:

1. Your organization's release ledger.
2. The GitHub Actions step summary of the previous successful release workflow.
3. Your production deployment manifests or container orchestrator history.

Example known-good digest:

```text
sha256:2c7f05023c3c4ca07ffbb41212093d8609d324abb9804852ecc1d125aab6f5cc
```

#### Step 2: Rollback via Docker Standalone

Pull the exact immutable digest and launch the replacement container:

```bash
# 1. Pull the known-good image digest directly
docker pull ghcr.io/dejavumoe/edgetts@sha256:<known-good-digest>

# 2. Stop and remove the degraded container
docker stop edgetts && docker rm edgetts

# 3. Start the container referencing the exact digest
docker run -d \
  --name edgetts \
  --read-only \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --tmpfs /tmp \
  -e REQUIRE_API_KEY=true \
  -e "API_KEY=$API_KEY" \
  -p 127.0.0.1:8080:8080 \
  ghcr.io/dejavumoe/edgetts@sha256:<known-good-digest>
```

#### Step 3: Rollback via Docker Compose

In your production `compose.yaml` (or `docker-compose.override.yaml`), update the `image` field:

```yaml
services:
  edgetts:
    image: ghcr.io/dejavumoe/edgetts@sha256:<known-good-digest>
```

Apply the change:

```bash
docker compose pull edgetts
docker compose up -d edgetts
```

#### Step 4: Verify Post-Rollback Health

Confirm that the service is running and healthy:

```bash
# 1. Check container health status
docker inspect --format '{{.State.Health.Status}}' edgetts

# 2. Verify health probe endpoint
curl -s http://127.0.0.1:8080/health

# 3. Verify API response with authentication
curl -s -H "Authorization: Bearer $API_KEY" http://127.0.0.1:8080/api/voices | head -c 100
```

---

## 3. Release Record Ledger

For every production release, record the following metadata in your release notes or tracking system:

| Field                      | Example Value                              | Description                                           |
| :------------------------- | :----------------------------------------- | :---------------------------------------------------- |
| **Version**                | `v1.0.0` (tag) / `1.0.0` (version)         | Strict SemVer release number                          |
| **Git Commit SHA**         | `6e6581b6e7a37bd34b047747e42d588416f048ac` | Full 40-character Git commit hash on `main`           |
| **OCI Index Digest**       | `sha256:2c7f05023c3c...`                   | Content-addressed multi-arch index digest in GHCR     |
| **linux/amd64 Digest**     | `sha256:db10fe466a11...`                   | Architecture-specific child manifest digest           |
| **linux/arm64 Digest**     | `sha256:1819731aef52...`                   | Architecture-specific child manifest digest           |
| **Provenance Attestation** | Present (`mode=max`)                       | BuildKit SLSA provenance manifest                     |
| **SBOM Attestation**       | Present (`SPDX`)                           | Software Bill of Materials manifest                   |
| **Release Date**           | `2026-09-14`                               | Date of publication                                   |
| **Publisher**              | `@username` / CI Workflow                  | Operator or automated workflow initiating the release |

---

## 4. Step-by-Step Production Release Procedure

Follow this manual procedure when releasing a new stable version of `edgeTTS`.

### 1. Preflight Verification

Ensure the local working tree is clean and `main` is synchronized with GitHub:

```bash
cd /data/Forgejo/edgeTTS
git fetch origin
git status --short --branch
```

Verify that:

- You are on branch `main`.
- `HEAD == origin/main`.
- Working tree is clean (`nothing to commit, working tree clean`).
- GitHub Actions CI for the latest commit on `main` is completely green across all jobs.

### 2. Run Local Release Preflight Tool

Execute the preflight validation script:

```bash
./scripts/release-check.sh vX.Y.Z
```

This script verifies:

- Strict SemVer format compliance.
- Repository cleanliness and branch alignment.
- Local and remote tag absence.
- Full local build, typecheck, lint, test, format, and diff verification.

### 3. Create Annotated Git Tag

Create an annotated tag containing the version and summary message:

```bash
git tag -a vX.Y.Z -m "edgeTTS X.Y.Z"
```

### 4. Push Tag to GitHub

Push **only** the newly created release tag:

```bash
git push origin vX.Y.Z
```

### 5. Monitor CI Workflow & Promotion

1. Open the GitHub Actions run for the tag:
   ```text
   https://github.com/DejavuMoe/edgeTTS/actions
   ```
2. Verify that all 4 pipeline jobs complete with `success`:
   - `Code Quality & Tests`
   - `Docker Production Image Contract`
   - `Deterministic Nginx Reverse Proxy Contract`
   - `Publish Multi-Arch Image to GHCR`
3. In the `Publish Multi-Arch Image to GHCR` job summary:
   - Note the published **OCI Index Digest**.
   - Verify that `:X.Y.Z` and `:latest` aliases were promoted to the verified digest.

### 6. Verify Remote Registry Artifacts

Inspect the published image tags from any machine with Docker:

```bash
docker buildx imagetools inspect ghcr.io/dejavumoe/edgetts:X.Y.Z
docker buildx imagetools inspect ghcr.io/dejavumoe/edgetts:latest
```

Confirm that:

- Both tags resolve to the exact OCI index digest.
- Both `linux/amd64` and `linux/arm64` platform manifests are present.
- SLSA provenance and SPDX SBOM attestations are attached.

### 7. Create GitHub Release (Manual)

1. Go to `https://github.com/DejavuMoe/edgeTTS/releases/new`.
2. Select the pushed tag `vX.Y.Z`.
3. Set the release title to `edgeTTS X.Y.Z`.
4. Include changelog highlights and document the exact OCI index digest for production deployment:
   ```markdown
   ### Container Distribution

   - **Immutable Image Reference**: `ghcr.io/dejavumoe/edgetts@sha256:<published-digest>`
   - **Release Tag**: `ghcr.io/dejavumoe/edgetts:X.Y.Z`
   - **Latest Tag**: `ghcr.io/dejavumoe/edgetts:latest`
   - **Architectures**: `linux/amd64`, `linux/arm64`
   ```

---

## 5. Recommended GitHub Repository Rulesets

To enforce release stability and prevent accidental branch or tag corruption, repository administrators should configure GitHub Repository Rulesets as detailed below.

> [!NOTE]
> Automated CI workflows and local scripts do not mutate repository administrative settings or require elevated administrator privileges. Rulesets must be configured by an authorized administrator through the GitHub Web UI (`Settings` → `Rules` → `Rulesets`).

### A. Main Branch Ruleset

Configure a ruleset for the `main` branch to ensure all changes pass through pull requests and automated validation:

- **Ruleset Name**: `Protect main branch`
- **Enforcement Status**: `Active`
- **Target Branches**: Include `default branch` (or `main`)
- **Rules**:
  1. **Require a pull request before merging**:
     - Required approvals: `1` (or according to team policy).
     - Dismiss stale pull request approvals when new commits are pushed: `Enabled`.
     - Require conversation resolution: `Enabled`.
  2. **Require status checks to pass before merging**:
     - Require branches to be up to date before merging: `Enabled`.
     - Required status checks:
       - `Code Quality & Tests`
       - `Docker Production Image Contract`
       - `Deterministic Nginx Reverse Proxy Contract`
     > [!IMPORTANT]
     > Do **NOT** require `Publish Multi-Arch Image to GHCR` as a pull request check. The publish job executes exclusively after merges to `main` or upon release tag creation, not during pull requests.
  3. **Block force pushes**: `Enabled` (prevents history rewriting on `main`).
  4. **Block branch deletions**: `Enabled`.

### B. Tag Protection Ruleset

Configure a ruleset for release tags to prevent accidental deletion or re-tagging:

- **Ruleset Name**: `Protect release tags`
- **Enforcement Status**: `Active`
- **Target Refs**: Include `refs/tags/v*.*.*`
- **Rules**:
  1. **Block updates**: `Enabled` (prevents moving existing release tags to new commits).
  2. **Block deletions**: `Enabled` (prevents deleting published release tags).
  3. **Restrict creations**: Limit tag creation to designated release managers or repository maintainers.
