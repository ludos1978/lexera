# To Test

- [ ] Run `npm run check:storage-modes` after pulling these changes and confirm the CRDT and no-CRDT storage modes all compile.
- [ ] In a normal CRDT build, open a board, make a card edit, and confirm the edit saves, the board remains searchable for the new card text, and no `.lexera-sync.tmp` or `.lexera-crdt.tmp` files remain beside the board.
- [ ] In a no-CRDT build, open a board and confirm collaboration/live-sync controls do not start sessions; opening the connection window should show the CRDT-disabled message instead of opening collaboration setup.
