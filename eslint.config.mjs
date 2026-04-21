import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

// Transport-discipline guard (Phase 7 of the IPC migration).
//
// Raw `fetch`, `new EventSource`, and `new WebSocket` are banned in desktop
// runtime code so that every backend call flows through the central
// transport wrapper (`LexeraApi` in kanban; `backend-window-transport.js`
// for backend-owned windows). Files that are intentionally raw — the
// transport modules themselves, third-party bundles, or tests — are listed
// in TRANSPORT_GUARD_IGNORES below.
const TRANSPORT_GUARD_IGNORES = [
    // Central wrappers: they are *supposed* to call raw fetch/EventSource/WebSocket.
    "lexera-kanban/src/api.js",
    "lexera-kanban/src/backendDiscovery.js",
    "lexera-backend/src/backend-window-transport.js",
    "lexera-backend/src/backendDiscovery.js",
    // Backend-owned windows: their fetches go through the backend window
    // transport shim, which rewrites them to Tauri commands at runtime.
    "lexera-backend/src/connection-settings.js",
    "lexera-backend/src/quick-capture.js",
    // `LexeraApi.fileUrl(boardId, path)` returns a `lexera-asset://` URL on
    // desktop, so fetches against it go through the custom protocol handler
    // rather than loopback HTTP. Allowed in feature code.
    "lexera-kanban/src/menu/embedMenu.js",
    "lexera-kanban/src/app.js",
    // Test harness: posts results to a dedicated `/test-results` endpoint
    // and never runs in production.
    "lexera-kanban/src/test/**",
    "lexera-kanban/tests/**",
    // Third-party bundles.
    "**/vendor/**",
    // Shared runtime that is copied into app src/ directories at build time.
    "lexera-shared/**",
];

const TRANSPORT_GUARD_RULES = {
    "no-restricted-syntax": ["error",
        {
            selector: "CallExpression[callee.name='fetch']",
            message: "Raw fetch() is forbidden in desktop runtime code. Use LexeraApi.request() (kanban) or rely on the backend-window-transport.js shim (backend windows). See Phase 7 of IPC-Migration-Plan.md.",
        },
        {
            selector: "NewExpression[callee.name='EventSource']",
            message: "Raw EventSource is forbidden. Use LexeraApi.connectSSE / connectLogStream (kanban) or the backend-window-transport.js shim (backend windows).",
        },
        {
            selector: "NewExpression[callee.name='WebSocket']",
            message: "Raw WebSocket is forbidden. Use LexeraApi.connectSync (kanban).",
        },
    ],
};

export default [{
    files: ["**/*.ts"],
}, {
    ignores: ["dist/**", "out/**", "node_modules/**", "node_modules_backup/**"],
}, {
    plugins: {
        "@typescript-eslint": typescriptEslint,
    },

    languageOptions: {
        parser: tsParser,
        ecmaVersion: 2022,
        sourceType: "module",
    },

    rules: {
        "@typescript-eslint/naming-convention": ["warn", {
            selector: "import",
            format: ["camelCase", "PascalCase"],
        }],

        curly: "warn",
        eqeqeq: "warn",
        "no-throw-literal": "warn",
        semi: "warn",
    },
}, {
    // Transport discipline applies to kanban and backend-owned window JS.
    files: [
        "lexera-kanban/src/**/*.js",
        "lexera-backend/src/**/*.js",
    ],
    ignores: TRANSPORT_GUARD_IGNORES,
    languageOptions: {
        ecmaVersion: 2022,
        sourceType: "script",
    },
    rules: TRANSPORT_GUARD_RULES,
}];