# Kanban Feature Suite — Manual Test Workspace

Three hand-crafted boards covering every kanban feature we ship, including valid `.md` slide includes, broken-path includes, and unsupported-format includes (`.pdf`, `.epub`, `.xlsx`, `.marp.md`).

## Layout

| Path                                     | Role                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| `board-01-feature-showcase.md`           | Working copy — feature catalogue organised by category.                                    |
| `board-02-edge-cases.md`                 | Working copy — unicode / RTL / huge content / broken refs / column-title abuse.            |
| `board-03-scale-stress.md`               | Working copy — 1 row, 20 stacks, 1–10 cols/stack, 1–40 cards/col, every 2nd card has media.|
| `IMMUTABLE-backup/`                      | chmod 444/555 pristine copy of every board + `Media/` + `includes/` + `folder with space/`.|
| `Media/`                                 | Real PNG/JPG/JPEG/AVIF/SVG/GIF/WebP/MP4/WAV/MP3/PDF/XLSX/drawio/excalidraw fixtures.       |
| `includes/`                              | Valid slide-format `.md` files + deliberately unsupported `.pdf`/`.xlsx`/`.epub`.          |
| `folder with space/`                     | Target for URL-encoded / literal-space path tests.                                         |

## Restoring a corrupted working copy

```bash
SUITE=tests/kanban-feature-suite
cp "$SUITE/IMMUTABLE-backup/board-01-feature-showcase.md" "$SUITE/board-01-feature-showcase.md"
```

The backup is read-only; to replace it intentionally, drop read-only first:

```bash
chmod -R u+w tests/kanban-feature-suite/IMMUTABLE-backup
# … overwrite …
find tests/kanban-feature-suite/IMMUTABLE-backup -type f -exec chmod 444 {} \;
find tests/kanban-feature-suite/IMMUTABLE-backup -type d -exec chmod 555 {} \;
```

## Opening as a workspace in Lexera

Registered in `~/.config/lexera/sync.json` as workspace **`feature-suite`** with all three boards attached. Start the backend + kanban and select the workspace from the sidebar.
