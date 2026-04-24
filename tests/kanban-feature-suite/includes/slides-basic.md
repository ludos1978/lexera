# Valid Slide Include — Intro

This is the first slide of a regular `.md` slide-include. The parser should turn each `---`-delimited block into one card in the including column.

- bullet one
- bullet two

---

# Slide 2 — Image

![Fixture](../Media/fixture-1.png)

Caption for the image slide.

---

# Slide 3 — Code

```rust
fn main() {
    println!("hello from included slide 3");
}
```

---

# Slide 4 — Checklist

- [ ] item a
- [x] item b
- [ ] item c

;; speaker note: mention the three states
