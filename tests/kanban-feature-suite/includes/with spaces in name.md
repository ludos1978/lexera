# Include from a filename with spaces

This file is referenced two ways from the board:
- URL-encoded:  `!!!include(includes/with%20spaces%20in%20name.md)!!!`
- Literal space: `!!!include(./includes/with spaces in name.md)!!!`

---

# Second slide

Both path forms should resolve to this same file.
