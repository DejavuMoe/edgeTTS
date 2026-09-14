#!/usr/bin/env bash
# ==============================================================================
# scripts/test-release-guard.sh
#
# Deterministic test suite for edgeTTS release governance contracts:
#   1. Strict stable SemVer format enforcement
#   2. Reject moved release tags (github.event.before == all-zeros)
#   3. Release source ancestry from origin/main
#   4. Version tag overwrite vs idempotent rerun detection
#   5. release-check.sh preflight validation behavior
#
# Runs strictly in isolated temporary directories without mutating the
# working tree or creating any real git tags in the edgeTTS repository.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TOTAL_TESTS=0
PASSED_TESTS=0

assert_eq() {
  local desc="$1"
  local expected="$2"
  local actual="$3"
  TOTAL_TESTS=$((TOTAL_TESTS + 1))
  if [ "$expected" = "$actual" ]; then
    echo "  [PASS] $desc"
    PASSED_TESTS=$((PASSED_TESTS + 1))
  else
    echo "  [FAIL] $desc (expected '$expected', got '$actual')" >&2
    exit 1
  fi
}

assert_exit_code() {
  local desc="$1"
  local expected_code="$2"
  shift 2
  TOTAL_TESTS=$((TOTAL_TESTS + 1))
  local actual_code=0
  set +e
  "$@" >/dev/null 2>&1
  actual_code=$?
  set -e
  if [ "$actual_code" -eq "$expected_code" ]; then
    echo "  [PASS] $desc (exit code $actual_code)"
    PASSED_TESTS=$((PASSED_TESTS + 1))
  else
    echo "  [FAIL] $desc (expected exit code $expected_code, got $actual_code)" >&2
    exit 1
  fi
}

echo "======================================================================"
echo " Running edgeTTS Release Governance Deterministic Tests"
echo "======================================================================"

# ------------------------------------------------------------------------------
# Test Suite 1: Strict Stable SemVer Format
# ------------------------------------------------------------------------------
echo "--- Suite 1: Strict Stable SemVer Validation ---"

is_valid_semver() {
  echo "$1" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'
}

assert_exit_code "Valid: v0.1.0" 0 is_valid_semver "v0.1.0"
assert_exit_code "Valid: v1.0.0" 0 is_valid_semver "v1.0.0"
assert_exit_code "Valid: v1.2.3" 0 is_valid_semver "v1.2.3"
assert_exit_code "Valid: v12.34.56" 0 is_valid_semver "v12.34.56"

assert_exit_code "Reject missing leading v: 1.2.3" 1 is_valid_semver "1.2.3"
assert_exit_code "Reject major-only: v1" 1 is_valid_semver "v1"
assert_exit_code "Reject minor-only: v1.2" 1 is_valid_semver "v1.2"
assert_exit_code "Reject prerelease alpha: v1.0.0-alpha" 1 is_valid_semver "v1.0.0-alpha"
assert_exit_code "Reject prerelease rc: v1.2.3-rc.1" 1 is_valid_semver "v1.2.3-rc.1"
assert_exit_code "Reject build metadata: v1.2.3+build" 1 is_valid_semver "v1.2.3+build"
assert_exit_code "Reject four segments: v1.2.3.4" 1 is_valid_semver "v1.2.3.4"
assert_exit_code "Reject arbitrary text: vnext" 1 is_valid_semver "vnext"

# ------------------------------------------------------------------------------
# Test Suite 2: Reject Moved Release Tags (github.event.before)
# ------------------------------------------------------------------------------
echo "--- Suite 2: Reject Moved Tags (event.before) ---"

validate_tag_event() {
  local event_before="$1"
  local zero_sha="0000000000000000000000000000000000000000"
  if [ -n "$event_before" ] && [ "$event_before" != "$zero_sha" ]; then
    return 1
  fi
  return 0
}

assert_exit_code "Accept all-zero before (new tag creation)" 0 validate_tag_event "0000000000000000000000000000000000000000"
assert_exit_code "Accept empty before" 0 validate_tag_event ""
assert_exit_code "Reject moved tag (non-zero previous commit)" 1 validate_tag_event "6e6581b6e7a37bd34b047747e42d588416f048ac"
assert_exit_code "Reject arbitrary non-zero SHA" 1 validate_tag_event "1111111111111111111111111111111111111111"

# ------------------------------------------------------------------------------
# Test Suite 3: Release Source Ancestry From origin/main
# ------------------------------------------------------------------------------
echo "--- Suite 3: Release Source Ancestry Verification ---"

TEMP_GIT_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_GIT_DIR"' EXIT

git -C "$TEMP_GIT_DIR" init --initial-branch=main --quiet
git -C "$TEMP_GIT_DIR" config user.email "ci@example.com"
git -C "$TEMP_GIT_DIR" config user.name "CI"
git -C "$TEMP_GIT_DIR" config commit.gpgsign false
git -C "$TEMP_GIT_DIR" config tag.gpgsign false

echo "initial" > "$TEMP_GIT_DIR/file.txt"
git -C "$TEMP_GIT_DIR" add file.txt
git -C "$TEMP_GIT_DIR" commit -m "commit 1 on main" --quiet
COMMIT_1=$(git -C "$TEMP_GIT_DIR" rev-parse HEAD)

echo "second" >> "$TEMP_GIT_DIR/file.txt"
git -C "$TEMP_GIT_DIR" add file.txt
git -C "$TEMP_GIT_DIR" commit -m "commit 2 on main" --quiet
COMMIT_2=$(git -C "$TEMP_GIT_DIR" rev-parse HEAD)

# Simulate origin/main pointing to COMMIT_2
git -C "$TEMP_GIT_DIR" update-ref refs/remotes/origin/main "$COMMIT_2"

# Create a divergent branch not reachable from main
git -C "$TEMP_GIT_DIR" checkout --orphan divergent-branch --quiet
echo "divergent" > "$TEMP_GIT_DIR/divergent.txt"
git -C "$TEMP_GIT_DIR" add divergent.txt
git -C "$TEMP_GIT_DIR" commit -m "commit on divergent branch" --quiet
COMMIT_DIVERGENT=$(git -C "$TEMP_GIT_DIR" rev-parse HEAD)
git -C "$TEMP_GIT_DIR" checkout main --quiet

# Ancestry check: COMMIT_1 is an ancestor of origin/main -> ACCEPT
assert_exit_code "Older main commit is ancestor of origin/main" 0 \
  git -C "$TEMP_GIT_DIR" merge-base --is-ancestor "$COMMIT_1" refs/remotes/origin/main

# Ancestry check: COMMIT_2 (HEAD) is ancestor of origin/main -> ACCEPT
assert_exit_code "Current HEAD is ancestor of origin/main" 0 \
  git -C "$TEMP_GIT_DIR" merge-base --is-ancestor "$COMMIT_2" refs/remotes/origin/main

# Ancestry check: COMMIT_DIVERGENT is NOT an ancestor of origin/main -> REJECT
assert_exit_code "Divergent commit is NOT ancestor of origin/main" 1 \
  git -C "$TEMP_GIT_DIR" merge-base --is-ancestor "$COMMIT_DIVERGENT" refs/remotes/origin/main

# ------------------------------------------------------------------------------
# Test Suite 4: Version Tag Overwrite & Idempotent Rerun Contract
# ------------------------------------------------------------------------------
echo "--- Suite 4: Version Tag Overwrite vs Rerun Logic ---"

check_release_version_overwrite() {
  local existing_digest="$1"
  local candidate_digest="$2"

  if [ -z "$existing_digest" ]; then
    # Tag is absent: proceed
    return 0
  fi

  if [ "$existing_digest" = "$candidate_digest" ]; then
    # Idempotent rerun: proceed
    return 0
  fi

  # Different digest: reject
  return 1
}

DIGEST_A="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
DIGEST_B="sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

assert_exit_code "Absent tag proceeds" 0 check_release_version_overwrite "" "$DIGEST_A"
assert_exit_code "Idempotent rerun with identical digest proceeds" 0 check_release_version_overwrite "$DIGEST_A" "$DIGEST_A"
assert_exit_code "Overwrite attempt with different digest fails" 1 check_release_version_overwrite "$DIGEST_A" "$DIGEST_B"

# ------------------------------------------------------------------------------
# Test Suite 5: release-check.sh Preflight Script Behavior
# ------------------------------------------------------------------------------
echo "--- Suite 5: release-check.sh Preflight Behavior ---"

# 5.1 Rejects invalid version string
assert_exit_code "release-check.sh rejects invalid SemVer 'v1.2'" 1 \
  "$REPO_ROOT/scripts/release-check.sh" "v1.2" --skip-tests

assert_exit_code "release-check.sh rejects prerelease 'v1.0.0-rc1'" 1 \
  "$REPO_ROOT/scripts/release-check.sh" "v1.0.0-rc1" --skip-tests

# 5.2 Test behavior in mock git repo
MOCK_REPO=$(mktemp -d)
trap 'rm -rf "$TEMP_GIT_DIR" "$MOCK_REPO"' EXIT

git -C "$MOCK_REPO" init --initial-branch=feature --quiet
git -C "$MOCK_REPO" config user.email "ci@example.com"
git -C "$MOCK_REPO" config user.name "CI"
git -C "$MOCK_REPO" config commit.gpgsign false
git -C "$MOCK_REPO" config tag.gpgsign false
echo "hello" > "$MOCK_REPO/file.txt"
git -C "$MOCK_REPO" add file.txt
git -C "$MOCK_REPO" commit -m "init" --quiet

# Copy release-check.sh into mock repo
mkdir -p "$MOCK_REPO/scripts"
cp "$REPO_ROOT/scripts/release-check.sh" "$MOCK_REPO/scripts/release-check.sh"
chmod +x "$MOCK_REPO/scripts/release-check.sh"

# In mock repo on branch 'feature', release-check.sh must reject because branch != main
assert_exit_code "release-check.sh rejects non-main branch" 1 \
  "$MOCK_REPO/scripts/release-check.sh" "v1.0.0" --skip-tests

# Switch to main
git -C "$MOCK_REPO" checkout -b main --quiet

# Create a dirty working tree
echo "dirty" > "$MOCK_REPO/dirty.txt"
assert_exit_code "release-check.sh rejects dirty working tree" 1 \
  "$MOCK_REPO/scripts/release-check.sh" "v1.0.0" --skip-tests

rm "$MOCK_REPO/dirty.txt"

# Commit scripts to mock repo
git -C "$MOCK_REPO" add scripts/
git -C "$MOCK_REPO" commit -m "add release-check" --quiet

# Setup fake origin remote
git -C "$MOCK_REPO" update-ref refs/remotes/origin/main "$(git -C "$MOCK_REPO" rev-parse HEAD)"

# Now tag check: add a local tag v1.0.0
git -C "$MOCK_REPO" tag v1.0.0
assert_exit_code "release-check.sh rejects already existing local tag" 1 \
  "$MOCK_REPO/scripts/release-check.sh" "v1.0.0" --skip-tests

echo "======================================================================"
echo " All $PASSED_TESTS / $TOTAL_TESTS Release Governance Tests PASSED"
echo "======================================================================"
