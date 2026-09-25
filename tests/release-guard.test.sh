#!/usr/bin/env bash
# ==============================================================================
# tests/release-guard.test.sh
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
  echo "$1" | grep -Eq '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
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
assert_exit_code "Reject leading-zero major: v01.2.3" 1 is_valid_semver "v01.2.3"
assert_exit_code "Reject leading-zero minor: v1.02.3" 1 is_valid_semver "v1.02.3"
assert_exit_code "Reject leading-zero patch: v1.2.03" 1 is_valid_semver "v1.2.03"
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

git -C "$MOCK_REPO" tag -d v1.0.0 >/dev/null
assert_exit_code "release-check.sh fails closed when origin fetch fails" 1 \
  "$MOCK_REPO/scripts/release-check.sh" "v1.0.0" --skip-tests

# 5.3 Release metadata, behind a reachable origin so every earlier check passes
ORIGIN_REPO=$(mktemp -d)
trap 'rm -rf "$TEMP_GIT_DIR" "$MOCK_REPO" "$ORIGIN_REPO"' EXIT
git init --bare --quiet "$ORIGIN_REPO"
git -C "$MOCK_REPO" remote add origin "$ORIGIN_REPO"

commit_and_push() {
  git -C "$MOCK_REPO" add -A
  git -C "$MOCK_REPO" commit -m "$1" --quiet
  git -C "$MOCK_REPO" push --quiet origin main
}

printf '{\n  "version": "1.0.0"\n}\n' > "$MOCK_REPO/package.json"
printf '# Changelog\n\n## [Unreleased]\n\n- Pending change\n' > "$MOCK_REPO/CHANGELOG.md"
commit_and_push "prepare release without changelog section"
assert_exit_code "release-check.sh rejects a version missing from CHANGELOG.md" 1 \
  "$MOCK_REPO/scripts/release-check.sh" "v1.0.0" --skip-tests

printf '# Changelog\n\n## [1.0.0]\n\n- Undated\n' > "$MOCK_REPO/CHANGELOG.md"
commit_and_push "undated changelog section"
assert_exit_code "release-check.sh rejects an undated CHANGELOG.md section" 1 \
  "$MOCK_REPO/scripts/release-check.sh" "v1.0.0" --skip-tests

printf '# Changelog\n\n## [1.0.0] - 2026-01-01\n\n- Released\n' > "$MOCK_REPO/CHANGELOG.md"
printf '{\n  "version": "0.9.0"\n}\n' > "$MOCK_REPO/package.json"
commit_and_push "stale package version"
assert_exit_code "release-check.sh rejects a package.json version mismatch" 1 \
  "$MOCK_REPO/scripts/release-check.sh" "v1.0.0" --skip-tests

printf '{\n  "version": "1.0.0"\n}\n' > "$MOCK_REPO/package.json"
commit_and_push "prepare 1.0.0"
assert_exit_code "release-check.sh accepts a documented release" 0 \
  "$MOCK_REPO/scripts/release-check.sh" "v1.0.0" --skip-tests

# ------------------------------------------------------------------------------
# Test Suite 6: Strict SemVer Version Ordering (sort -V)
# ------------------------------------------------------------------------------
echo "--- Suite 6: SemVer Version Ordering Contract ---"

compare_semver_gt() {
  local v_higher="$1"
  local v_lower="$2"
  local top
  top=$(printf "%s\n%s\n" "$v_higher" "$v_lower" | sort -V -r | head -n 1)
  [ "$top" = "$v_higher" ]
}

assert_exit_code "1.10.0 > 1.9.9" 0 compare_semver_gt "1.10.0" "1.9.9"
assert_exit_code "2.0.0 > 1.99.99" 0 compare_semver_gt "2.0.0" "1.99.99"
assert_exit_code "1.3.0 > 1.2.3" 0 compare_semver_gt "1.3.0" "1.2.3"
assert_exit_code "1.2.4 > 1.2.3" 0 compare_semver_gt "1.2.4" "1.2.3"
assert_exit_code "1.2.10 > 1.2.9" 0 compare_semver_gt "1.2.10" "1.2.9"

# ------------------------------------------------------------------------------
# Test Suite 7: Monotonic Highest Published Version & latest Selection
# ------------------------------------------------------------------------------
echo "--- Suite 7: Monotonic latest Selection & Race Safety ---"

STATE_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_GIT_DIR" "$MOCK_REPO" "$STATE_DIR"' EXIT

simulate_promotion() {
  local tag="$1"
  local version="${tag#v}"
  local candidate_digest="$2"

  local reg_dir="$STATE_DIR/registry"
  mkdir -p "$reg_dir"

  # 1. Version tag overwrite check
  local ver_file="$reg_dir/$version"
  if [ -f "$ver_file" ]; then
    local existing_digest
    existing_digest=$(cat "$ver_file")
    if [ "$existing_digest" != "$candidate_digest" ]; then
      echo "REJECT_OVERWRITE: $version already points to different digest" >&2
      return 1
    fi
  else
    echo "$candidate_digest" > "$ver_file"
  fi

  # Record git tag in simulated repository
  mkdir -p "$STATE_DIR/git_tags"
  touch "$STATE_DIR/git_tags/$tag"

  # 2. Determine highest published version among all known git tags
  local candidate_versions
  candidate_versions=$(ls "$STATE_DIR/git_tags" 2>/dev/null | grep -E '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' | sed 's/^v//' | sort -V -r || true)
  local all_versions
  all_versions=$(printf "%s\n%s\n" "$version" "$candidate_versions" | sed '/^$/d' | sort -u | sort -V -r)

  local highest_published_version=""
  local highest_published_digest=""
  for v in $all_versions; do
    if [ -f "$reg_dir/$v" ]; then
      highest_published_version="$v"
      highest_published_digest=$(cat "$reg_dir/$v")
      break
    fi
  done

  if [ -z "$highest_published_version" ]; then
    echo "ERROR: Could not find highest published version" >&2
    return 1
  fi

  # 3. latest update decision
  local latest_updated="false"
  if [ "$version" = "$highest_published_version" ]; then
    echo "$candidate_digest" > "$reg_dir/latest"
    echo "$version" > "$reg_dir/latest_version"
    latest_updated="true"
  else
    if [ -f "$reg_dir/latest" ]; then
      local cur_latest_digest
      cur_latest_digest=$(cat "$reg_dir/latest")
      if [ "$cur_latest_digest" = "$candidate_digest" ]; then
        echo "DRIFT_ERROR: latest points to lower version digest" >&2
        return 1
      fi
    fi
  fi

  echo "version=$version" > "$STATE_DIR/last_run.out"
  echo "highest=$highest_published_version" >> "$STATE_DIR/last_run.out"
  echo "latest_updated=$latest_updated" >> "$STATE_DIR/last_run.out"
  return 0
}

reset_sim_state() {
  rm -rf "$STATE_DIR"/*
}

# 7.1 First release owns latest
reset_sim_state
assert_exit_code "First release 0.1.0 succeeds" 0 simulate_promotion "v0.1.0" "sha256:010"
assert_eq "First release sets latest_version to 0.1.0" "0.1.0" "$(cat "$STATE_DIR/registry/latest_version")"
assert_eq "First release sets latest digest to 010" "sha256:010" "$(cat "$STATE_DIR/registry/latest")"

# 7.2 New higher release advances latest
assert_exit_code "New higher release 1.0.0 succeeds" 0 simulate_promotion "v1.0.0" "sha256:100"
assert_eq "Higher release advances latest_version to 1.0.0" "1.0.0" "$(cat "$STATE_DIR/registry/latest_version")"
assert_eq "Higher release advances latest digest to 100" "sha256:100" "$(cat "$STATE_DIR/registry/latest")"

# 7.3 Lower maintenance release does not move latest backward (2.0.0 then 1.9.5)
reset_sim_state
simulate_promotion "v2.0.0" "sha256:200"
assert_exit_code "Lower maintenance release 1.9.5 succeeds" 0 simulate_promotion "v1.9.5" "sha256:195"
assert_eq "Maintenance release leaves latest_version at 2.0.0" "2.0.0" "$(cat "$STATE_DIR/registry/latest_version")"
assert_eq "Maintenance release leaves latest digest at 200" "sha256:200" "$(cat "$STATE_DIR/registry/latest")"
assert_eq "Maintenance release outputs latest_updated=false" "latest_updated=false" "$(grep latest_updated "$STATE_DIR/last_run.out")"

# 7.4 Old lower workflow rerun does not move latest backward
reset_sim_state
simulate_promotion "v1.2.3" "sha256:123"
simulate_promotion "v1.3.0" "sha256:130"
assert_exit_code "Rerun old v1.2.3 succeeds" 0 simulate_promotion "v1.2.3" "sha256:123"
assert_eq "Old rerun keeps latest_version at 1.3.0" "1.3.0" "$(cat "$STATE_DIR/registry/latest_version")"
assert_eq "Old rerun keeps latest digest at 130" "sha256:130" "$(cat "$STATE_DIR/registry/latest")"
assert_eq "Old rerun outputs latest_updated=false" "latest_updated=false" "$(grep latest_updated "$STATE_DIR/last_run.out")"

# 7.5 Highest release rerun is idempotent
assert_exit_code "Rerun highest v1.3.0 succeeds" 0 simulate_promotion "v1.3.0" "sha256:130"
assert_eq "Highest rerun leaves latest at 1.3.0" "1.3.0" "$(cat "$STATE_DIR/registry/latest_version")"
assert_eq "Highest rerun outputs latest_updated=true" "latest_updated=true" "$(grep latest_updated "$STATE_DIR/last_run.out")"

# 7.6 Overwrite attempt with different digest is rejected
assert_exit_code "Rerun with different digest fails" 1 simulate_promotion "v1.3.0" "sha256:corrupted_digest"

# 7.7 Cross-release race safety: ordering convergence
reset_sim_state
simulate_promotion "v1.2.3" "sha256:123"
simulate_promotion "v1.3.0" "sha256:130"
LATEST_AB=$(cat "$STATE_DIR/registry/latest_version")

reset_sim_state
simulate_promotion "v1.3.0" "sha256:130"
simulate_promotion "v1.2.3" "sha256:123"
LATEST_BA=$(cat "$STATE_DIR/registry/latest_version")

assert_eq "Ordering A then B yields latest=1.3.0" "1.3.0" "$LATEST_AB"
assert_eq "Ordering B then A yields latest=1.3.0" "1.3.0" "$LATEST_BA"
assert_eq "Cross-release race converges to identical latest" "$LATEST_AB" "$LATEST_BA"

echo "======================================================================"
echo " All $PASSED_TESTS / $TOTAL_TESTS Release Governance Tests PASSED"
echo "======================================================================"
