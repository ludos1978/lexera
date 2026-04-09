#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
FAILURES=()
PASSED=()

# ---------- helpers ----------
section() {
  echo ""
  echo "========================================"
  echo "  $1"
  echo "========================================"
  echo ""
}

record_result() {
  local name="$1" exit_code="$2"
  if [ "$exit_code" -eq 0 ]; then
    PASSED+=("$name")
  else
    FAILURES+=("$name")
  fi
}

# ---------- pre-flight checks ----------
if ! command -v cargo &>/dev/null; then
  echo "ERROR: cargo is not installed or not on PATH"
  exit 1
fi

if ! command -v npx &>/dev/null; then
  echo "ERROR: npx is not installed or not on PATH"
  exit 1
fi

# ---------- 1. Rust tests (workspace) ----------
section "Rust tests (cargo test)"

set +e
(cd "$REPO_ROOT" && cargo test)
record_result "Rust (cargo test)" $?
set -e

# ---------- 2. Frontend Vitest tests ----------
section "Frontend tests (lexera-kanban vitest)"

set +e
(cd "$REPO_ROOT/lexera-kanban" && npx vitest run)
record_result "Frontend (lexera-kanban vitest)" $?
set -e

# ---------- Summary ----------
section "Test Summary"

if [ ${#PASSED[@]} -gt 0 ]; then
  for name in "${PASSED[@]}"; do
    echo "  PASS  $name"
  done
fi

if [ ${#FAILURES[@]} -gt 0 ]; then
  for name in "${FAILURES[@]}"; do
    echo "  FAIL  $name"
  done
  echo ""
  echo "${#FAILURES[@]} suite(s) failed."
  exit 1
fi

echo ""
echo "All ${#PASSED[@]} suite(s) passed."
exit 0
