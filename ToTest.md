# To Test

- [ ] Run `npm run check:storage-modes` after pulling these changes and confirm markdown-only default backend mode, explicit `--features crdt` backend mode, no-CRDT core mode, and the Kanban Tauri shell all compile.
- [ ] In the default backend build, open a board, make a card edit, and confirm only the `.md` file changes: no `.md.crdt`, `.lexera-sync.tmp`, or `.lexera-crdt.tmp` files remain beside the board.
- [ ] In the default backend build, confirm collaboration/live-sync controls do not start sessions; opening the connection window should show the CRDT-disabled message instead of opening collaboration setup.
- [ ] In an explicit CRDT backend build (`cargo tauri dev --features crdt` from `lexera-backend/src-tauri`), open a board, make a card edit, and confirm the edit saves and the board remains searchable for the new card text.
- [ ] Export a Marp PDF/PPTX from a board whose `!!!include(...)!!!` file contains `![video](media/clip.mp4)` or `<video src="media/clip.mp4"></video>` and confirm the exported markdown points at a rendered PNG, not the original `.mp4`; verify `ffmpeg` missing shows a renderer warning instead of silently keeping a broken media link.
