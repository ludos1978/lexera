Card 00010 — S03C01K01 ABCD
![image-5](Media/fixture-5.png) #blocked

---

Card 00011 — S03C01K02 @2026-12-12

---

Card 00012 — S03C01K03
![image-6](Media/fixture-0.png)

---

Card 00013 — S03C01K04

---

Card 00014 — S03C01K05 #todo
![image-7](Media/fixture.svg)

---

Card 00015 — S03C01K06

---

Card 00016 — S03C01K07
![image-8](Media/pixel.gif){width=160}

---

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
