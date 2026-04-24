---
kanban-plugin: board
columnWidth: 400px
fontSize: 0_9x
boardColorDark: "#14171f"
boardColorLight: "#f6f4ef"
stickyStackMode: off
---

# Empties & Minimal

## Truly empty shapes

### Empty column (no cards below)

### Another empty column

### One-char card
- [ ] .

### Whitespace-only card
- [ ]   

## Cards that only contain metadata

### Tag-only / param-only cards
- [ ] #orange
- [ ] #hidden-internal-archived
- [ ] {assigned:bob, status:waiting}
- [ ] @2026-05-01
- [ ] !10:00-11:30
- [ ] !W21
- [ ] <!-- kid:11aa22bb -->

# Long Content

## Huge cards

### Enormous lorem
- [ ] Long card with prose body
  Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.
  
  Duis autem vel eum iriure dolor in hendrerit in vulputate velit esse molestie consequat, vel illum dolore eu feugiat nulla facilisis at vero eros et accumsan et iusto odio dignissim qui blandit praesent luptatum zzril delenit augue duis dolore te feugait nulla facilisi.
  
  Nam liber tempor cum soluta nobis eleifend option congue nihil imperdiet doming id quod mazim placerat facer possim assum. Typi non habent claritatem insitam; est usus legentis in iis qui facit eorum claritatem.
- [ ] Very long single line card — A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A
- [ ] Card with gigantic code block
  ```python
  def wave(n):
      for i in range(n):
          for j in range(i + 1):
              print("#", end="")
          print()
      for i in range(n, 0, -1):
          for j in range(i):
              print("#", end="")
          print()
  
  if __name__ == "__main__":
      wave(20)
      # further padding follows
      data = [x * 2 for x in range(200)]
      print(sum(data))
  ```

# Unicode / RTL / Emoji

## Language mixing

### Multi-lingual titles
- [ ] English — straightforward
- [ ] 中文标题 — 卡片内容，含长段文字以测试 CJK 换行行为。
- [ ] 日本語のタイトル — 本文にひらがな・カタカナ・漢字を含みます。
- [ ] Русский заголовок — содержит Кириллицу.
- [ ] Ελληνικός τίτλος — κάρτα με ελληνικούς χαρακτήρες.
- [ ] עברית (RTL) — כרטיס בעברית עם טקסט מימין לשמאל.
- [ ] العربية (RTL) — كرت باللغة العربية لاختبار الاتجاه.
- [ ] Emoji city 🏙️ 🇯🇵 🇨🇭 🇩🇪 🇷🇺 🇪🇸 🌍 🪐 🦄 🧩 🧨 🧬 🛰️
- [ ] Mathematical: ∑ ∫ ∂ π ∞ √ ≈ ≠ ≤ ≥ ± × ÷ 𝔹 ℝ ℕ
- [ ] Zero-width & combining: a‍b (ZWJ) é (combining acute)

# HTML & Raw Content

## Raw HTML

### HTML inside cards
- [ ] Raw HTML block
  <div style="padding:4px; border:1px dashed currentColor;">
    <strong>Custom HTML box</strong> with nested <em>markup</em>.
  </div>
- [ ] HTML entities
  5 &lt; 6 &amp;&amp; 6 &gt; 5 — &copy; 2026 — &hellip; — &#x1F600;
- [ ] Interleaved comments
  visible start
  <!-- comment 1 -->
  middle
  <!-- comment 2 -->
  visible end
- [ ] Fenced-inside-html
  <details><summary>click</summary>
  
  ```yaml
  key: value
  nested:
    - a
    - b
  ```
  
  </details>

# Broken Everything

## Broken media #stack

### Nonexistent images
- [ ] png
  ![missing](Media/nope-1.png)
- [ ] jpg
  ![missing](Media/nope-2.jpg)
- [ ] svg
  ![missing](Media/nope-3.svg)
- [ ] webp
  ![missing](Media/nope-4.webp)

### Nonexistent video / audio / doc
- [ ] mp4
  ![missing](Media/nope.mp4)
- [ ] webm
  ![missing](Media/nope.webm)
- [ ] mp3
  ![missing](Media/nope.mp3)
- [ ] pdf
  ![missing](Media/nope.pdf)
- [ ] Typoed absolute path
  ![typo](/Usears/rspoerri/not-a-real-path.jpg)

## Broken includes #stack

### !!!include(does-not-exist.md)!!! #red

### !!!include(./includes/also-missing.md)!!! #red

### !!!include(includes/nope.pdf)!!! #red

### !!!include(includes/nope.epub)!!! #red

### !!!include(includes/nope.xlsx)!!! #red

### !!!include(includes/nope.marp.md)!!! #red

### !!!include(%2E%2E%2Fnowhere%2Fhidden.md)!!! #red

### !!!include(./includes/with%20spaces%20in%20name.md)!!! #green

### !!!include(./includes/with spaces in name.md)!!! #green

### Broken-include tasks + descriptions
- [ ] !!!include(includes/nope.md)!!!
- [ ] With broken desc-include
  !!!include(includes/nope-2.md)!!!
- [ ] Include mixed with real text
  Here is some intro text.
  
  !!!include(includes/nope-3.pdf)!!!
  
  Trailing narrative.

# Column-title Abuse

## Titles containing markdown #stack

### # H1 inside an H3 title #orange

### ## H2 inside an H3 title #yellow

### `code` in title — with backticks #green

### Title with **bold**, _italic_, ~~strike~~, ==mark== #blue

### Title with [link](https://example.com) and #hash-style-tag #pink

### !!!include(includes/slides-basic.md)!!! *combined with include* #cyan

### Emoji title 🦀🐍🦊 #red

## Special characters in titles #stack

### Title with (parens) and [brackets] and {curlies}

### Title with "double" and 'single' quotes

### Title with trailing spaces   

### Title with <html> inside

# Path & Traversal

## Parent / encoded paths

### Traversal & encoded variants
- [ ] Up two, down into self — works but absurd
  ![](../kanban-feature-suite/Media/fixture-2.png)
- [ ] URL-encoded folder with space
  ![](folder%20with%20space/spaced-image.png)
- [ ] Literal space folder
  ![](./folder with space/spaced-image.png)
- [ ] Absolute path fixture
  ![](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/tests/kanban-feature-suite/Media/fixture-4.png)

### !!!include(../kanban-feature-suite/includes/slides-basic.md)!!! #light-blue

### !!!include(%2E%2Fincludes%2Fsingle-slide.md)!!! #orange

### !!!include(./../kanban-feature-suite/includes/single-slide.md)!!! #yellow

# Layout Extras

## Speaker notes + three-column

### Three-col blocks
- [ ] Three-column layout with media
  ---:
  ![](Media/fixture-1.png)
  :--:
  ![](Media/fixture-2.png)
  :---
- [ ] Speaker-note-only card
  ;; This card has only a note for presentation mode.
  ;; And a second note line.
- [ ] Footnotes in card body[^ft1]
  Paragraph with reference.
  [^ft1]: Defined here.

## Tags special cases

### Hyphenated tags are one tag
- [ ] one tag, one hyphen #hidden-internal-deleted
- [ ] one tag, many hyphens #very-long-hyphenated-tag-name-here
- [ ] adjacent: #one-tag #two-tag #three-tag
- [ ] card-level vs line-level:
  header body #card-level-tag
  
  after blank line #line-level-tag

# States Mix

## Deep mix

### All-in-one
- [x] Completed #green @2026-04-10
  Description after completed task.
- [ ] In-progress  #yellow !15:00-17:00 {assigned:carol}
  ![inline](Media/fixture-3.png){height=80}
- [ ] Archived #hidden-internal-archived
  ![inline](Media/fixture.svg)
  
  Still rendering even though archived.
- [ ] Deleted #hidden-internal-deleted
- [ ] Parked #hidden-internal-parked
