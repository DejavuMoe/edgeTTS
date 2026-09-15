#!/usr/bin/env bash
# ==============================================================================
# scripts/release-check.sh
#
# edgeTTS Local Release Preflight Verification Script
#
# Validates repository cleanliness, branch synchronization, SemVer format,
# tag availability, and local codebase verification before creating a release tag.
#
# Usage:
#   ./scripts/release-check.sh vX.Y.Z [--skip-tests]
#   ./scripts/release-check.sh X.Y.Z  [--skip-tests]
#
# Contract:
#   - Strictly validates preconditions.
#   - NEVER creates git tags or pushes to remote automatically.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/release-check.sh <version> [--skip-tests]

Arguments:
  <version>       Release version matching strict SemVer, e.g. 'v1.2.3' or '1.2.3'.
                  Prereleases (e.g. -rc.1, -beta) and build metadata are not supported.

Options:
  --skip-tests    Skip running pnpm build, typecheck, lint, test, and format checks.
                  Useful for fast preflight validation of git and tag states.
  -h, --help      Show this help message.

Example:
  ./scripts/release-check.sh v1.0.0
EOF
  exit 1
}

TARGET_VERSION=""
SKIP_TESTS=false

for arg in "$@"; do
  case "$arg" in
    --skip-tests)
      SKIP_TESTS=true
      ;;
    -h|--help)
      usage
      ;;
    -*)
      echo "ERROR: Unknown option '$arg'" >&2
      usage
      ;;
    *)
      if [ -n "$TARGET_VERSION" ]; then
        echo "ERROR: Multiple version arguments provided: '$TARGET_VERSION' and '$arg'" >&2
        usage
      fi
      TARGET_VERSION="$arg"
      ;;
  esac
done

if [ -z "$TARGET_VERSION" ]; then
  echo "ERROR: Missing required <version> argument." >&2
  usage
fi

# Normalize tag name: ensure leading 'v'
if [[ "$TARGET_VERSION" =~ ^v ]]; then
  TAG_NAME="$TARGET_VERSION"
  SEMVER_NUM="${TARGET_VERSION#v}"
else
  TAG_NAME="v$TARGET_VERSION"
  SEMVER_NUM="$TARGET_VERSION"
fi

echo "======================================================================"
echo " edgeTTS Release Preflight: $TAG_NAME (version: $SEMVER_NUM)"
echo "======================================================================"

# 1. Validate strict stable SemVer format
if ! echo "$TAG_NAME" | grep -Eq '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'; then
  echo "ERROR: Version '$TAG_NAME' does not match strict stable SemVer." >&2
  echo "Prereleases (-alpha, -rc1) and build metadata (+build) are not supported." >&2
  exit 1
fi
echo "[PASS] SemVer format verified: $TAG_NAME"

# 2. Check working tree cleanliness
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: Working tree is not clean. Commit or stash all changes before release." >&2
  git status --short
  exit 1
fi
echo "[PASS] Working tree is clean."

# 3. Check current branch is 'main'
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "ERROR: Releases must be initiated from the 'main' branch (current: '$CURRENT_BRANCH')." >&2
  exit 1
fi
echo "[PASS] Current branch is 'main'."

# 4. Check local 'main' is synchronized with 'origin/main'
echo "Fetching origin/main to verify synchronization..."
if ! git fetch origin main:refs/remotes/origin/main --quiet; then
  echo "ERROR: Failed to fetch origin/main; refusing to verify stale remote state." >&2
  exit 1
fi

LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git rev-parse origin/main)"

if [ "$LOCAL_HEAD" != "$REMOTE_HEAD" ]; then
  echo "ERROR: Local HEAD ($LOCAL_HEAD) does not match origin/main ($REMOTE_HEAD)." >&2
  echo "Ensure all local commits are pushed and you are up to date with remote." >&2
  exit 1
fi
echo "[PASS] Local HEAD is in sync with origin/main ($LOCAL_HEAD)."

# 5. Check local tag does not already exist
if git rev-parse --verify "refs/tags/$TAG_NAME" >/dev/null 2>&1; then
  echo "ERROR: Local git tag '$TAG_NAME' already exists." >&2
  exit 1
fi
echo "[PASS] Local tag '$TAG_NAME' is absent."

# 6. Check remote tag does not already exist
if ! REMOTE_TAG_CHECK="$(git ls-remote --tags origin "refs/tags/$TAG_NAME")"; then
  echo "ERROR: Failed to query remote tag '$TAG_NAME'; refusing to assume it is absent." >&2
  exit 1
fi
if [ -n "$REMOTE_TAG_CHECK" ]; then
  echo "ERROR: Remote git tag '$TAG_NAME' already exists on origin:" >&2
  echo "$REMOTE_TAG_CHECK" >&2
  exit 1
fi
echo "[PASS] Remote tag '$TAG_NAME' is absent on origin."

# 7. Run full test & verification suite (unless skipped)
if [ "$SKIP_TESTS" = "true" ]; then
  echo "[SKIP] Code validation suite skipped via --skip-tests."
else
  echo "Running workspace validation suite..."
  echo "  1/6 pnpm build"
  pnpm build >/dev/null
  echo "  2/6 pnpm typecheck"
  pnpm typecheck >/dev/null
  echo "  3/6 pnpm lint"
  pnpm lint >/dev/null
  echo "  4/6 pnpm test"
  pnpm test >/dev/null
  echo "  5/6 pnpm format:check"
  pnpm format:check >/dev/null
  echo "  6/6 git diff --check"
  git diff --check
  echo "[PASS] Full validation suite passed with zero errors."
fi

echo "======================================================================"
echo " Release preflight checks SUCCEEDED for $TAG_NAME"
echo "======================================================================"
echo ""
echo "To publish this release, execute the following manual steps:"
echo ""
echo "  1. Create the annotated git tag:"
echo "       git tag -a $TAG_NAME -m \"edgeTTS $SEMVER_NUM\""
echo ""
echo "  2. Push the release tag to origin:"
echo "       git push origin $TAG_NAME"
echo ""
echo "  3. Monitor GitHub Actions CI:"
echo "       https://github.com/DejavuMoe/edgeTTS/actions"
echo ""
echo "  4. Verify published multi-arch image index:"
echo "       docker buildx imagetools inspect ghcr.io/dejavumoe/edgetts:$SEMVER_NUM"
echo "       docker buildx imagetools inspect ghcr.io/dejavumoe/edgetts:latest"
echo ""
