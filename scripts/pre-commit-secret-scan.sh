#!/usr/bin/env bash
# PSY4 Pre-Commit Secret Detection Hook
# Blocks commits that contain exposed credentials.
# Install: cp scripts/pre-commit-secret-scan.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit

set -e

# Patterns that indicate exposed credentials
PATTERNS=(
  'cfut_[A-Za-z0-9]{20,}'           # Cloudflare user token
  'sbp_[a-f0-9]{40}'                # Supabase service key
  'ghp_[A-Za-z0-9]{36}'             # GitHub personal access token (classic)
  'github_pat_[A-Za-z0-9_]{82}'     # GitHub fine-grained PAT
  'eyJhbGciOiJF[Z]QS[A-Za-z0-9._-]{50,}'  # Turso JWT auth token
  'libsql://[a-z0-9.-]+:[A-Za-z0-9]+@'    # libsql URL with embedded password
  'postgres://[a-z0-9]+:[^@]+@'           # postgres URL with embedded password
  'xox[baprs]-[A-Za-z0-9-]{10,}'          # Slack token
  'sk-[A-Za-z0-9]{20,}'                   # OpenAI-style API key
  'ANTHROPIC_API_KEY=[A-Za-z0-9_-]{20,}'  # Anthropic key assignment
)

# Files to skip (binary, lock, etc.)
skip_file() {
  case "$1" in
    *.lock|*.snap|*.png|*.jpg|*.jpeg|*.gif|*.svg|*.ico|*.woff|*.woff2|*.ttf|*.eot|*.pdf)
      return 0 ;;
    *) return 1 ;;
  esac
}

# Get staged files
STAGED=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null)
if [ -z "$STAGED" ]; then
  exit 0
fi

FOUND_SECRETS=0

for file in $STAGED; do
  if skip_file "$file"; then continue; fi
  if [ ! -f "$file" ]; then continue; fi

  for pattern in "${PATTERNS[@]}"; do
    if grep -qE "$pattern" "$file" 2>/dev/null; then
      echo "❌ SECURITY: Potential secret detected in $file"
      echo "   Pattern: $pattern"
      echo "   COMMIT BLOCKED. Remove the secret and try again."
      FOUND_SECRETS=1
    fi
  done
done

if [ "$FOUND_SECRETS" -ne 0 ]; then
  echo ""
  echo "If this is a false positive, bypass with: git commit --no-verify"
  echo "But ONLY do this if you are CERTAIN no real credential is exposed."
  exit 1
fi

exit 0
