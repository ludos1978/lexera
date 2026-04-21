#!/bin/bash
#
# Transport-discipline guard for the IPC migration (Phase 7).
#
# Backstop to the ESLint rule in eslint.config.mjs: catches raw fetch(),
# new EventSource(), and new WebSocket() in kanban and backend-window JS
# that aren't on the explicit allowlist. Also flags bypass attempts
# (eslint-disable for the same rule and dynamic construction via
# globalThis["fetch"] / window["fetch"]).
#
# Exit 0 = clean. Exit 1 = violations found.
#
# Allowlist:
# - transport wrappers themselves
# - backend-owned windows whose fetches go through the shim at runtime
# - files that fetch `lexera-asset://` URLs (safe — routed through the
#   custom protocol handler)
# - tests and third-party bundles

set -eu

cd "$(dirname "$0")"

ALLOW_PATHS=(
    "lexera-kanban/src/api.js"
    "lexera-kanban/src/backendDiscovery.js"
    "lexera-backend/src/backend-window-transport.js"
    "lexera-backend/src/backendDiscovery.js"
    "lexera-backend/src/connection-settings.js"
    "lexera-backend/src/quick-capture.js"
    "lexera-kanban/src/menu/embedMenu.js"
    "lexera-kanban/src/app.js"
)

# Directories that are either third-party bundles or test harnesses and
# therefore outside the discipline rule.
SKIP_GLOB_EXCLUSIONS=(
    "--exclude-dir=vendor"
    "--exclude-dir=test"
    "--exclude-dir=tests"
    "--exclude-dir=node_modules"
    "--exclude-dir=dist"
    "--exclude-dir=out"
    "--exclude-dir=_ARCHIVE"
)

# Require no whitespace between the identifier and the `(` / class name to
# avoid matching comments and normal prose ("schedule a fetch ...").
PATTERN='(\bfetch\(|new[[:space:]]EventSource|new[[:space:]]WebSocket)'
BYPASS_PATTERN='(eslint-disable.*no-restricted-syntax|globalThis\[["'\'']fetch["'\'']\]|window\[["'\'']fetch["'\'']\])'

violations=0

for root in lexera-kanban/src lexera-backend/src; do
    if [ ! -d "$root" ]; then continue; fi
    # Find candidate .js files with a match, filter out allowlist.
    while IFS=: read -r file _line _match; do
        skip=0
        for allow in "${ALLOW_PATHS[@]}"; do
            if [ "$file" = "$allow" ]; then skip=1; break; fi
        done
        [ "$skip" = "1" ] && continue
        echo "TRANSPORT-GUARD: $file"
        violations=$((violations + 1))
    done < <(
        grep -R -n -E "$PATTERN" "$root" \
            --include="*.js" \
            "${SKIP_GLOB_EXCLUSIONS[@]}" 2>/dev/null || true
    )
done

# Separate sweep for bypass attempts. These always fail the guard regardless
# of allowlist — if you need to disable the rule in a wrapper, do it
# file-scoped in eslint.config.mjs, not inline.
while IFS=: read -r file _line _match; do
    echo "TRANSPORT-GUARD-BYPASS: $file"
    violations=$((violations + 1))
done < <(
    grep -R -n -E "$BYPASS_PATTERN" \
        lexera-kanban/src lexera-backend/src \
        --include="*.js" \
        "${SKIP_GLOB_EXCLUSIONS[@]}" 2>/dev/null || true
)

if [ "$violations" -gt 0 ]; then
    echo ""
    echo "Transport discipline check failed: $violations violation(s)."
    echo "See eslint.config.mjs → TRANSPORT_GUARD_RULES for rationale."
    echo "If a file is legitimately exempt, add it to the allowlist in both"
    echo "eslint.config.mjs and this script."
    exit 1
fi

echo "Transport discipline check: clean."
exit 0
