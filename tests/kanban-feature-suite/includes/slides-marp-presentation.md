---
marp: true
theme: default
paginate: true
---

# Marp Presentation Include

A **marp-flavoured** markdown file that is still plain `.md`, so the slide parser should treat each `---`-block as a card.

---

# Slide 2 — Bullet build

- idea one
- idea two
- idea three

<!-- A marp speaker note comment -->

---

# Slide 3 — Two-column layout

<div class="columns">

left column text

right column text

</div>

---

# Slide 4 — Image

![bg right:40%](../Media/fixture-2.png)

Marp has background-image directives that should round-trip through the include as plain text.

---

# Slide 5 — End

Thanks.
