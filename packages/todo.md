# Lexera Repository Architecture Todo

Scope: the active Lexera code currently lives under `packages/lexera-*`, but the target is to promote that code into the main repository structure, archive legacy `src/`, keep the board domain small and stable, use modularity for clear package boundaries, and use plugins only where variability is expected such as export formats, embedded media, visualization renderers, and editor integrations.

## Repository Foundation

- [ ] Reframe the repository around the active Lexera packages as the primary product structure instead of keeping them nested under `packages/`.
- [ ] Design the target top-level layout before moving files, for example `apps/`, `core/`, `shared/`, `tools/`, and `archive/`.
- [ ] Move legacy `src/` into an explicit archive location such as `archive/v1/` while preserving history and build reproducibility.
- [ ] Promote the active Lexera packages into the main repository structure with stable top-level locations and names.
- [ ] Update all build scripts, paths, config files, and docs to the new repository layout in one coordinated migration.
- [ ] Keep the restructure mostly path-level and boundary-level first, without mixing it with feature refactors in the same change set.
- [ ] Convert fragile relative cross-module imports to stable workspace or crate references before large directory moves.
- [ ] Choose one package manager for the whole repository and remove mixed lockfile usage after migration.
- [ ] Replace the legacy root `package.json` as the repository identity with a neutral workspace root for the active Lexera apps and libraries.
- [ ] Lift the existing Rust workspace from `packages/Cargo.toml` to the promoted repository root instead of leaving the active crates under a second structural root.
- [ ] Add a real workspace manifest for the repo so root and package tasks can be run consistently.
- [ ] Create one root `build` command that runs all supported packages in dependency order.
- [ ] Create one root `test` command that runs all supported packages in dependency order.
- [ ] Create one root `lint` command that runs all supported packages in dependency order.
- [ ] Standardize TypeScript base config and let packages extend it instead of drifting independently.
- [ ] Standardize Rust workspace settings and shared lint rules for all Tauri and core crates.
- [ ] Add package boundary checks so app packages do not reach into each other through private files.
- [ ] Split repository concerns into clear groups such as apps, libraries, tooling, docs, and archived code paths.
- [ ] Add a dependency map document that shows which active packages are allowed to depend on which other packages.
- [ ] Isolate archived legacy code from active package code so new work cannot accidentally cross that boundary.
- [ ] Document archived legacy code as reference-only so active development stays inside the promoted Lexera app and core structure.
- [ ] Define the end-state for archived legacy code such as permanent archive, frozen compatibility layer, or deletion after the packages cover the required scope.
- [ ] Exclude archived legacy directories from default CI, lint, coverage, and search scopes unless a dedicated archive check is needed.
- [ ] Separate generated schemas, vendor assets, and test-only support code from authored product code in the promoted layout so architecture reviews do not keep mixing them together.

## Repository Promotion Mapping

- [ ] Define the exact move map from current locations to target locations before renaming directories.
- [ ] Decide whether the promoted top-level structure uses `apps/`, `libs/`, `core/`, `shared/`, or another naming scheme and apply it consistently.
- [ ] Decide the final location of `lexera-kanban` as the primary user-facing app in the promoted structure.
- [ ] Decide the final location of `lexera-backend` as the primary service or companion app in the promoted structure.
- [ ] Decide the final location of `lexera-core` as the canonical shared domain library in the promoted structure.
- [ ] Decide whether `lexera-capture-ios` is a first-class app in the promoted structure or a platform experiment that should move to support or archive space.
- [ ] Decide whether `packages/shared` should become a true shared contracts library, be merged into `lexera-core`, or be removed after consolidation.
- [ ] Decide whether `lexera-shared` is active shared UI code, a temporary bridge, or an archive candidate.
- [ ] Classify non-Lexera directories such as `ludos-*`, `marp-engine`, `agent`, and platform experiments as active support code, tooling, vendor code, or archive.
- [ ] Move non-mainline experimental or historical packages out of the primary app and core tree so the main repository structure stays focused.
- [ ] Update root `package.json`, workspace manifests, Cargo workspace members, TypeScript references, and Tauri config paths after the moves.
- [ ] Update test fixtures, screenshot paths, asset paths, and snapshot references after the moves.
- [ ] Update shell scripts and local helper scripts that currently assume `packages/...` paths.
- [ ] Update CI workflows, release scripts, and packaging scripts that currently assume `packages/...` paths.
- [ ] Move path-sensitive docs, screenshots, and architecture references in the same migration window so contributors are not left with stale instructions.
- [ ] Add temporary compatibility notes or wrapper scripts if old paths are still referenced by local tooling during the migration.
- [ ] Remove transitional path aliases and compatibility wrappers once the new structure is stable.
- [ ] Record the final repository map in a top-level architecture document and keep it updated.

## Package Boundaries

- [ ] Define `lexera-core` as the canonical domain and file-format engine instead of letting multiple runtimes own parsing rules.
- [ ] Define one shared contract layer for DTOs, board schema, IDs, tag semantics, and message payloads used by the active Lexera packages.
- [ ] Move browser-only code out of shared logic packages so they can stay runtime-agnostic.
- [ ] Keep host-specific integration logic behind adapter modules so it does not leak into reusable services.
- [ ] Move Tauri-only integration logic behind adapter modules so it does not leak into reusable services.
- [ ] Decide whether `BoardStorage` remains a real app-facing abstraction or is replaced by narrower explicit services, because app code currently depends on `LocalStorage`-only capabilities.
- [ ] Define package boundaries for secondary apps such as `lexera-capture-ios` so they consume shared domain modules instead of re-implementing feature slices ad hoc.
- [ ] Keep export orchestration behind a dedicated subsystem boundary instead of letting it spread across frontend scripts, backend routes, and Tauri command modules.
- [ ] Replace ad hoc cross-package conventions with explicit public APIs per package.
- [ ] Add app and library README files that state responsibility, public API, and non-goals for each promoted module.
- [ ] Mark experimental apps, libraries, and features explicitly so production paths stay clear.

## Shared Contracts And Shared UI

- [ ] Decide whether `packages/shared` becomes the Lexera contract library, is merged into `lexera-core`, or is archived with Ludos-specific support code.
- [ ] Rename shared package identifiers from Ludos naming to Lexera naming if the code remains part of the mainline product.
- [ ] Decide whether temporal parsing belongs in the shared contract layer, `lexera-core`, or a dedicated parsing library.
- [ ] Remove the current line-by-line parser port arrangement by choosing one source of parser truth and verifying the other runtime with fixtures or generated contracts.
- [ ] Replace the `lexera-shared/management.js` and `management.css` file-copy workflow with a real shared frontend module or shared build artifact.
- [ ] Turn `lexera-shared` into a real package with its own manifest, build, and tests if it remains active shared UI code.
- [ ] Stop copying shared management assets into app source folders during Tauri build hooks.
- [ ] Define ownership boundaries for shared frontend code so management UI, theme helpers, and transport helpers do not become an unstructured misc package.
- [ ] Consolidate backend discovery, REST helpers, SSE helpers, and connection bootstrap logic that is currently split across frontend entrypoints.
- [ ] Extract shared frontend bridge helpers for Tauri invoke, event listen, theme bootstrap, and backend discovery so app entrypoints stop hand-rolling them.
- [ ] Add tests for shared frontend modules directly instead of only testing them indirectly through app bootstraps.
- [ ] Add a shared preferences layer for theme and UI settings instead of reading and writing `localStorage` directly from many feature scripts.
- [ ] Introduce shared DOM rendering helpers or view primitives so shared UI modules do not rely on uncontrolled `innerHTML` updates everywhere.
- [ ] Define which shared UI surfaces may use trusted string HTML rendering and which must move to safer DOM-builder or template primitives.

## Duplicate Logic And Single Sources

- [ ] Make `lexera-backend` config the authoritative home for shared frontend defaults such as scroll speed, zoom speed, tag visibility, and HTML render modes, and remove the current `lexera-default-*` `localStorage` fallback path from the Kanban app.
- [ ] Restrict browser `localStorage` to explicitly machine-local or ephemeral UI state only, and document which settings are allowed to stay local instead of synced through backend config or board YAML.
- [ ] Route every remaining local-only frontend preference through one settings service instead of raw `localStorage` calls spread across feature files.
- [ ] Add a guardrail such as a lint rule, grep-based check, or architecture test that blocks new raw `localStorage` access outside the approved settings layer.
- [ ] Finish the board-setting descriptor work so one manifest owns menu metadata, action IDs, persistence target, default values, normalization, and CSS application instead of splitting that behavior across Rust and JS files.
- [ ] Remove duplicated board-setting action wiring between native menu code and frontend registration by generating both from the same descriptor manifest or shared contract.
- [ ] Define one canonical persisted board schema in `lexera-core` for rows, stacks, columns, cards, board settings, generation metadata, include metadata, and format hints.
- [ ] Remove the current flat-versus-hierarchical board model drift between `packages/shared` TypeScript types and `lexera-core` Rust types by generating contracts, sharing a schema, or retiring one representation.
- [ ] Stop maintaining line-by-line parser ports as peer implementations; choose one parser owner and make any secondary runtime a verified consumer with fixtures rather than an independent semantic source.
- [ ] Add parser parity coverage for any retained non-authoritative runtime so shared fixtures catch drift in rows, stacks, includes, metadata, and round-trip behavior.
- [ ] Centralize temporal tag parsing and resolution in one semantic owner so search, shared utilities, and Kanban UI do not keep separate feature sets for the same domain concept.
- [ ] Replace duplicated backend auth, discovery, retry, and JSON request helpers across Kanban, backend webviews, quick capture, and web clipper with one shared client layer per runtime family.
- [ ] Align the backend API implementation and API spec on one contract, including whether routes stay unversioned or move under `/api/v1`, so frontend clients stop inventing their own ad hoc shapes.
- [ ] Replace checked-in file-copy workflows for shared frontend JS and CSS assets with real shared modules, imports, or generated build artifacts so there is only one authored source file for each shared asset.
- [ ] Reduce intentional source duplication such as `themes.js`, `backendDiscovery.js`, management assets, and workspace shell assets to one authored location plus reproducible build outputs.

## Build And Asset Pipeline

- [ ] Replace script-tag source loading in app frontends with a defined build pipeline and one composition root per app.
- [ ] Make Tauri `frontendDist` point at built frontend outputs instead of mutable source directories once the frontend module split is in place.
- [ ] Stop treating `src/` folders as both authored source and Tauri-ready output in the active apps.
- [ ] Separate vendored third-party assets from first-party source code with clear ownership and update policy.
- [ ] Decide whether Excalidraw assets remain vendored inside the app or move into a vendor or tools area with a documented sync process.
- [ ] Replace one-off shell copy steps in Tauri config with reproducible build tasks that work the same in dev, CI, and release.
- [ ] Create a build target for shared frontend artifacts so apps consume generated outputs instead of raw copied files.
- [ ] Replace inline HTML and CSS app composition in secondary apps such as `lexera-capture-ios` with a buildable frontend module if those apps remain active.
- [ ] Add asset-manifest checks so referenced frontend files, copied shared assets, and vendored bundles cannot silently drift.

## Board Model And File Format

- [ ] Choose one canonical board schema for rows, stacks, columns, cards, settings, and metadata.
- [ ] Remove duplicate board model definitions by generating or contract-testing TypeScript and Rust representations from the same schema.
- [ ] Separate persisted board data from transient UI state such as selection, folding, hover, loading, and drag state.
- [ ] Define a file format version field and migration rules for legacy and hierarchical board formats.
- [ ] Centralize reserved tags, hidden tags, layout tags, and YAML keys in one schema source.
- [ ] Centralize ID generation and persistent identity rules so merge and sync behavior stays stable across runtimes.
- [ ] Decide whether board format detection stays heuristic or moves to an explicit persisted format version so parser branching is visible and testable.
- [ ] Add round-trip fixtures that guarantee parse and generate stability for both legacy and new board formats.
- [ ] Add fixtures for malformed files and partial recovery so parser behavior is predictable under error conditions.
- [ ] Move board mutation rules into explicit domain commands instead of scattering structural edits across UI handlers.
- [ ] Define invariants for valid boards such as allowed nesting, empty container behavior, and include ownership.

## Parser And Content Pipeline

- [ ] Pick one canonical markdown parser behavior and make all runtimes conform to it through shared fixtures.
- [ ] Extract include resolution, tag parsing, frontmatter parsing, and markdown normalization into separate pipeline stages.
- [ ] Define a parse pipeline interface with clear input, output, diagnostics, and recovery semantics.
- [ ] Add golden tests for includes, embedded media, diagrams, exports, and tag parsing against real board fixtures.
- [ ] Add explicit parser diagnostics instead of silent fallback behavior for unsupported or ambiguous syntax.
- [ ] Separate pure parsing from filesystem access so parser tests stay deterministic.
- [ ] Add a content transformation pipeline for export-only rewrites so board parsing does not absorb exporter concerns.
- [ ] Separate parser format detection from parse execution so legacy or hierarchical routing rules can be tested and versioned independently.

## Plugin Strategy

- [ ] Define a minimal plugin model with only the extension points that are likely to grow: import, export, embed, renderer, editor integration, and menu contribution.
- [ ] Write a plugin capability schema that covers preview, export transform, edit support, dependencies, and failure modes.
- [ ] Unify plugin registration across `lexera-kanban`, `lexera-backend`, and shared Lexera libraries so built-ins are declared once.
- [ ] Replace hardcoded plugin loading lists with manifest-driven builtin registration where possible.
- [ ] Move file-type detection into a shared plugin capability layer instead of duplicating detection logic by runtime.
- [ ] Define a stable fallback path when a plugin is unavailable, misconfigured, or only partially supported.
- [ ] Add plugin-level tests that validate detection, preview config, export config, and graceful degradation.
- [ ] Add a plugin development guide with lifecycle, naming, contracts, and sample implementations.
- [ ] Keep plugin APIs narrow and versioned so future features do not require breaking every existing plugin.
- [ ] Add a capability matrix for each embed and export plugin showing preview, edit, pack, and export support.

## Embedded Media And Visualization

- [ ] Separate embedded media handling into distinct concerns: detection, metadata, preview rendering, editing, export rendering, and packing.
- [ ] Create a renderer adapter interface for diagram and document outputs so new media types do not require UI-specific branching.
- [ ] Add a metadata extraction layer for embedded files so the UI can render labels, page counts, and preview availability consistently.
- [ ] Add a cache strategy for rendered previews with invalidation rules based on file content and renderer version.
- [ ] Add security rules for external embeds and file access boundaries so plugin growth does not widen the attack surface accidentally.
- [ ] Define how unsupported media types should render in board view, export, and pack flows.
- [ ] Add extension points for future embedded editors without making every media plugin also own editing behavior.
- [ ] Add extension points for future visualization outputs such as timeline, graph, dashboard, and slide views without coupling them to the board parser.
- [ ] Split renderer capability probing from render execution so CLI discovery, availability checks, and actual export rendering do not stay coupled in one command module.

## Frontend Structure

- [ ] Break the Kanban frontend entrypoint, currently `lexera-kanban/src/app.js`, into a small bootstrap plus feature modules with explicit ownership.
- [ ] Convert global registry patterns in the frontend into module-scoped APIs with explicit imports and exports.
- [ ] Introduce one board store layer that owns board state, derived state, and mutations.
- [ ] Separate pure state mutations from DOM rendering so behavior can be tested without the browser.
- [ ] Separate API calls from UI modules behind a typed client layer.
- [ ] Extract a shared frontend platform layer for Tauri invoke, event, dialog, clipboard, and backend discovery so feature modules stay host-agnostic.
- [ ] Group frontend code by feature area such as board, export, clipboard, dashboard, management, and settings.
- [ ] Move shared UI primitives such as dialogs, menus, notifications, and status bars into reusable modules.
- [ ] Split rendering pipelines for board content, overlays, and management UI so each can evolve independently.
- [ ] Reduce direct DOM querying at runtime by defining feature-local mount points and UI controllers.
- [ ] Introduce a frontend event and action convention so interactions do not become stringly-typed and implicit.
- [ ] Split built-in plugin, menu, action, and board-setting registration out of `app.js` into dedicated registration modules or manifests.
- [ ] Add contract tests for frontend registries and feature modules so extraction from `app.js` stays safe.
- [ ] Migrate browser scripts that are effectively application code from plain JS to TypeScript where it improves safety.
- [ ] Standardize CSS tokens, layout variables, and theme definitions across frontend packages.
- [ ] Split the Kanban shell into explicit feature modules for sidebar tree, dashboard, board view, log panel, management panel, export flow, and sync state.
- [ ] Extract the backend API client from UI orchestration so transport, retries, caching, SSE, and WebSocket sync are not mixed into view code.
- [ ] Extract theme bootstrap and persistence from individual entrypoints so Kanban, management, and quick capture do not each apply theme state differently.
- [ ] Replace `window.Lexera*` global registries with a single app bootstrap that wires modules together explicitly.
- [ ] Replace `index.html` script-chain loading with module imports or a bundle manifest so load order is no longer part of the architecture.
- [ ] Convert IIFE-oriented frontend tests to direct module imports as modules are extracted from the current globals-based structure.
- [ ] Remove the need for source-string test loaders like `tests/load-iife.js` by exposing real module entrypoints for frontend logic.
- [ ] Separate pure board rendering, DOM event wiring, and persisted preference handling into different layers.
- [ ] Split oversized CSS into tokens, layout, components, and feature styles so styling changes stop depending on one global stylesheet.
- [ ] Bring `lexera-capture-ios` styling under the same token and component structure if that app remains an active product surface.
- [ ] Centralize browser preference persistence so board theme, visual theme, log panel state, and UI toggles are not stored ad hoc across modules.
- [ ] Reduce direct `innerHTML` rendering in the Kanban app by defining clearer render boundaries for trusted HTML, plugin output, and normal UI content.
- [ ] Decide whether the management panel belongs inside the Kanban app shell or should be mounted as a shared app-independent module.
- [ ] Extract export UI state and export tree state into dedicated modules so export behavior is not coupled to the main board runtime.
- [ ] Give export its own frontend composition root so dialog state, storage keys, API calls, and Tauri output adapters are not mixed into the main board shell.
- [ ] Define a stable plugin and registry API boundary for the frontend so future media and visualization features do not require editing the main app bootstrap.

## Backend Structure

- [ ] Break backend startup wiring into bootstrap, configuration, storage, sync, API, and UI-bridge modules with small entrypoints.
- [ ] Introduce backend service layers for boards, media, templates, export, workspaces, and collaboration instead of route-heavy modules.
- [ ] Make API route modules thin adapters that validate requests and call services.
- [ ] Define shared request and response DTOs for the backend API instead of allowing shape drift across clients.
- [ ] Add structured error types with clear mapping to HTTP status and user-facing messages.
- [ ] Isolate filesystem operations behind repository interfaces so tests do not depend on live disk behavior.
- [ ] Isolate file watching behind a service boundary so sync, parser, and storage logic can stay deterministic in tests.
- [ ] Break `AppState` into narrower state bundles or service containers so handlers do not depend on one broad mutable service locator.
- [ ] Introduce a config service that owns mutate-normalize-save flows instead of calling `save_config` and `normalize_workspace_setup` directly from many handlers.
- [ ] Separate collaboration and networking concerns from core board mutation logic.
- [ ] Add lifecycle management for background tasks so watchers, sync loops, and streams shut down cleanly.
- [ ] Add structured logging targets and correlation IDs for operations that span frontend, backend, and sync layers.
- [ ] Split `api/board.rs` into read endpoints, write endpoints, live-sync endpoints, and response mappers instead of keeping board concerns in one large module.
- [ ] Split `collab_api.rs` into invites, public rooms, identity, discovery, remote connections, and server-configuration modules instead of one wide collaboration route file.
- [ ] Move workspace, board assignment, and sync configuration rules out of API handlers and into explicit services.
- [ ] Separate backend app bootstrap from server bootstrap so tray, capture UI, HTTP API, and collaboration runtime can evolve independently.
- [ ] Consolidate backend frontend pages such as connection settings and quick capture around shared transport helpers instead of duplicating discovery logic.
- [ ] Replace direct `Arc<LocalStorage>` dependencies with narrower traits or services where consumers need only board reads, writes, search, or sync capabilities.
- [ ] Decide whether backend UI assets belong in the backend app package or in a shared frontend module consumed by multiple apps.
- [ ] Extract event-stream and WebSocket broadcasting concerns into dedicated runtime modules with explicit lifecycle ownership.
- [ ] Define a single backend state composition root so config, storage, watchers, and collaborators are wired in one place.
- [ ] Audit background task ownership in `lib.rs` so startup, restore, periodic save, and shutdown behavior live in named runtime supervisors instead of one growing setup flow.
- [ ] Add API contract tests that cover the full board payload shape returned to the Kanban frontend and management UI.
- [ ] Remove frontend-side port-scanning duplication once the backend location and discovery contract are centralized.
- [ ] Wrap Tauri invoke, event, and window integration behind small frontend adapters so backend UI scripts do not depend on raw globals everywhere.
- [ ] Decide whether route registration should be nested by domain or API version so the router stays navigable as more endpoints are added.
- [ ] Make route composition authoritative so every declared router is mounted in one visible place and orphaned modules cannot silently exist outside the running server.

## Sync And Collaboration

- [ ] Decide whether collaboration is based on authoritative saves, operation logs, CRDT state, or a hybrid model and document the choice.
- [ ] Keep one conflict-resolution strategy in the core domain instead of separate save, sync, and live-edit variants drifting apart.
- [ ] Define version and revision tokens that every runtime uses the same way for optimistic concurrency.
- [ ] Unify server-side and client-side sync session behavior around shared protocol helpers so `sync_ws.rs` and `sync_client.rs` do not drift semantically.
- [ ] Define how remote board mirrors are identified, named, stored, and surfaced in the UI instead of relying on ad hoc local ID prefixes.
- [ ] Add end-to-end fixtures for merge, rebase, crash recovery, and external file change scenarios.
- [ ] Add explicit feature flags for experimental collaboration features so stable board editing remains predictable.
- [ ] Define workspace, board, and peer ownership rules so sync logic is not mixed with UI assumptions.

## Core Library Structure

- [ ] Split `lexera-core` into clearer internal layers for parsing, storage, search, export, merge, sync, and watcher concerns.
- [ ] Break `storage/local.rs` into smaller modules such as board repository, write pipeline, include synchronization, revision tracking, and search indexing.
- [ ] Break `crdt/bridge.rs` into smaller modules such as metadata mapping, board serialization, list reordering, move operations, and persistence helpers.
- [ ] Either expand `BoardStorage` to the capabilities apps actually use or remove it so the codebase does not keep a misleading partial abstraction.
- [ ] Split `LocalStorage` into capability-focused services and make its public surface match the app-facing abstractions that backend code should depend on.
- [ ] Define which `lexera-core` APIs are stable for app use and which remain internal implementation details.
- [ ] Keep CRDT-specific concerns behind a narrower interface so non-collaborative board flows do not depend on bridge internals.
- [ ] Separate CRDT persistence, diff application, undo or redo, and board serialization into smaller bridge components.
- [ ] Split parser and ID-generation utilities that should stay runtime-neutral from filesystem and include-resolution layers that are runtime-specific.
- [ ] Decide whether `storage/registry.rs` is future active functionality or dead code and remove or archive it if it will not be used.
- [ ] Add smaller traits for search, board repository, revisioning, and collaboration persistence instead of routing everything through one concrete storage type.
- [ ] Decide whether export, archive, and search remain in one crate or should later be split into focused libraries after the repository move stabilizes.
- [ ] Move large inline Rust test blocks toward dedicated fixture-driven tests where that improves readability and cross-runtime comparison.
- [ ] Add fixture-based parity tests between the canonical Lexera parser and any remaining secondary parser implementation.
- [ ] Review feature gating inside `lexera-core` so watcher and collaboration-heavy dependencies stay optional where possible.
- [ ] Decide whether mobile storage should converge on shared core storage services or remain a separate simplified adapter with clearly documented divergence.

## Testing And Quality Gates

- [ ] Add a pull-request CI workflow that runs lint, unit tests, parser fixtures, and package builds on every change.
- [ ] Keep the release publish workflow separate from the verification workflow.
- [ ] Add repo-level smoke tests that verify the main runtimes can boot with minimal fixture data.
- [ ] Add shared fixture packs used by TypeScript, browser, and Rust tests so behavior is compared against the same samples.
- [ ] Add contract tests for API payloads, plugin manifests, and schema migrations.
- [ ] Add contract tests for config mutation flows so workspace normalization and persistence are verified once instead of indirectly through many handlers.
- [ ] Add router-composition tests that fail if declared backend sub-routers such as export endpoints are not mounted in the running server.
- [ ] Add performance regression tests for large boards, heavy embeds, and export transformations.
- [ ] Add snapshot or golden tests for export outputs where formatting stability matters.
- [ ] Add coverage reporting per package and enforce realistic thresholds only after flaky areas are stabilized.
- [ ] Add a minimal end-to-end board editing flow test for create, move, save, reload, and export.
- [ ] Add migration-safety tests that verify repo path moves do not break Tauri frontend loading, shared assets, or package-local fixtures.
- [ ] Add frontend smoke tests that verify the Kanban app bootstraps correctly without depending on script tag load order.
- [ ] Add shared module tests for management UI and backend transport helpers once they are extracted from app-local bootstraps.
- [ ] Add tests for shared backend discovery and transport adapters so port scanning, Tauri invoke fallback, SSE, and log streams are validated once.
- [ ] Add smoke tests for secondary apps such as `lexera-capture-ios` if they remain active.
- [ ] Add checks for dead or orphaned modules so unused shared layers and abandoned abstractions are surfaced early.

## Developer Experience

- [ ] Add a `dev` bootstrap command that starts the relevant services for the active app combination.
- [ ] Add root commands that proxy to the current `packages/Cargo.toml` workspace until the promotion is complete, then remove the indirection.
- [ ] Add app and library local `README` files with how to run, test, and debug each active Lexera module in isolation.
- [ ] Standardize logging and debug toggles so developers can enable targeted diagnostics in the active Lexera modules without code edits.
- [ ] Add scripts for fixture generation, parser diffing, and contract verification across the promoted Lexera modules.
- [ ] Add a lightweight architecture decision record process for changes to file format, plugin APIs, sync model, and package boundaries.
- [ ] Add a generated dependency report so new cross-package coupling is visible in reviews.
- [ ] Add a structural report command that highlights oversized source files, globals-heavy entrypoints, and duplicated bootstrap helpers.
- [ ] Add a route and command inventory report so frontend-used endpoints, mounted routers, and Tauri invoke commands can be compared automatically.
- [ ] Document which package directories are product code, support code, generated code, vendor code, or transitional code.
- [ ] Add a migration playbook for path moves so contributors can rebase, relink local tools, and update IDE settings without guesswork.

## Documentation And Cleanup

- [ ] Write one high-level architecture document that explains the roles of `lexera-kanban`, `lexera-backend`, `lexera-core`, and the supporting shared layers.
- [ ] Document the active development boundary so contributors know new work belongs in the promoted Lexera structure, not `src/*` or archived directories.
- [ ] Document the current transitional reality that the active Rust workspace lives under `packages/` until the repository promotion is completed.
- [ ] Separate architecture backlog items from product backlog items so structural work stays visible.
- [ ] Archive or merge outdated todo files once the new architecture backlog is adopted.
- [ ] Document naming conventions for packages, services, registries, plugins, and frontmatter keys.
- [ ] Record which packages are first-class products, which are support code, and which are candidates for archive after the promotion.
- [ ] Document the lifecycle expectations for optional integrations such as remote sync sidecars, discovery services, and mobile capture clients.
- [ ] Document the supported extension points for future exporters, embedded media types, and visualization modes.
- [ ] Document what should stay intentionally simple so the architecture does not accumulate generic abstractions too early.
- [ ] Add a short migration note at the old package and archive locations that points contributors to the new primary directories.
