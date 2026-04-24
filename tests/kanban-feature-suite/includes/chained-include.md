# Chained include host

This slide-include itself references another include — tests whether `!!!include()!!!` inside included content is resolved or left as plain text.

!!!include(./slides-basic.md)!!!

---

# Next slide

Some tail content after the nested include directive.
