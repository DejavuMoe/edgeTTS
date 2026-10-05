#!/usr/bin/env bash
# ==============================================================================
# scripts/release-notes.sh
#
# Renders the GitHub release notes for a published version: the version's
# CHANGELOG.md section followed by upgrade steps, verification facts and the
# immutable image references. CI runs it after the image has been published
# and verified; it can also be run by hand to (re)create a release.
#
# Usage:
#   ./scripts/release-notes.sh X.Y.Z
#
# Environment (all required):
#   COMMIT_SHA      Full commit SHA the release tag points to.
#   RUN_URL         URL of the CI run that published the image.
#   INDEX_DIGEST    OCI index digest of the published image (sha256:...).
#   AMD64_DIGEST    linux/amd64 manifest digest.
#   ARM64_DIGEST    linux/arm64 manifest digest.
#   LATEST_UPDATED  "true" when this release moved the latest alias.
#
# Contract:
#   - Writes Markdown to stdout and never contacts GitHub or the registry.
#   - Fails when the CHANGELOG section is missing or empty, or an input is absent.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE_REPO="ghcr.io/dejavumoe/edgetts"
REPO_URL="https://github.com/DejavuMoe/edgeTTS"

VERSION="${1:-}"
VERSION="${VERSION#v}"
if ! [[ "$VERSION" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  echo "ERROR: Expected a stable SemVer version such as 1.2.3, got '${1:-}'." >&2
  exit 1
fi

for name in COMMIT_SHA RUN_URL INDEX_DIGEST AMD64_DIGEST ARM64_DIGEST LATEST_UPDATED; do
  if [ -z "${!name:-}" ]; then
    echo "ERROR: $name is required." >&2
    exit 1
  fi
done
for name in INDEX_DIGEST AMD64_DIGEST ARM64_DIGEST; do
  if ! [[ "${!name}" =~ ^sha256:[a-f0-9]{64}$ ]]; then
    echo "ERROR: $name '${!name}' is not a sha256 digest." >&2
    exit 1
  fi
done
if [ "$LATEST_UPDATED" != "true" ] && [ "$LATEST_UPDATED" != "false" ]; then
  echo "ERROR: LATEST_UPDATED must be 'true' or 'false', got '$LATEST_UPDATED'." >&2
  exit 1
fi

# The section runs from its "## [X.Y.Z]" heading to the next version heading or the
# link references at the end of the file. CHANGELOG.md is hard-wrapped, but GitHub renders
# every newline in a release body as a line break, so wrapped lines are joined back into their
# paragraph or list item; code fences pass through untouched. Leading blank lines are dropped
# by sed, trailing ones by the command substitution.
CHANGES=$(awk -v heading="## [${VERSION}]" '
  function flush() { if (buf != "") print buf; buf = "" }
  index($0, heading) == 1 { found = 1; next }
  !found { next }
  /^## \[/ || /^\[[^]]+\]: / { exit }
  /^[[:space:]]*```/ { flush(); fence = !fence; print; next }
  fence { print; next }
  /^[[:space:]]*$/ { flush(); print ""; next }
  /^#/ { flush(); print; next }
  /^[[:space:]]*([-*+]|[0-9]+\.)[[:space:]]/ { flush(); buf = $0; next }
  {
    line = $0
    sub(/^[[:space:]]+/, "", line)
    buf = buf == "" ? $0 : buf " " line
  }
  END { flush() }
' "$REPO_ROOT/CHANGELOG.md" | sed -e '/./,$!d')

if [ -z "$CHANGES" ]; then
  echo "ERROR: CHANGELOG.md has no entries under '## [${VERSION}]'." >&2
  exit 1
fi

TAG="v${VERSION}"
SHA_REFS="\`sha-${COMMIT_SHA}\` and \`${VERSION}\`"
if [ "$LATEST_UPDATED" = "true" ]; then
  SHA_REFS="\`sha-${COMMIT_SHA}\`, \`${VERSION}\` and \`latest\`"
fi

cat <<EOF
## Changes

${CHANGES}

See the [changelog](${REPO_URL}/blob/${TAG}/CHANGELOG.md) for details.

## Upgrade

Check the changes above for compatibility notes. Update your Compose image to \`${IMAGE_REPO}:${VERSION}\`, retain your \`.env\`, then run:

\`\`\`bash
docker compose pull edgetts
docker compose up -d edgetts
\`\`\`

A single-instance replacement can interrupt active streams. Use the immutable digest below for reproducible deployment and rollback.

## Verification

- Tag \`${TAG}\` points to commit \`${COMMIT_SHA}\`.
- [Tag CI](${RUN_URL}) passed quality, Docker runtime, Nginx proxy and multi-architecture publication checks.
- Registry checks confirmed \`linux/amd64\`, \`linux/arm64\`, SLSA provenance and SPDX SBOM attestations. The ${SHA_REFS} references resolve to the same OCI index.

## Container distribution

- Version: \`${IMAGE_REPO}:${VERSION}\`
EOF
if [ "$LATEST_UPDATED" = "true" ]; then
  echo "- Latest: \`${IMAGE_REPO}:latest\`"
fi
cat <<EOF
- Immutable OCI index: \`${IMAGE_REPO}@${INDEX_DIGEST}\`
- \`linux/amd64\`: \`${AMD64_DIGEST}\`
- \`linux/arm64\`: \`${ARM64_DIGEST}\`
EOF
