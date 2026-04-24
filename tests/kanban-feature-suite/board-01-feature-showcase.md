---
kanban-plugin: board
columnWidth: 420px
fontSize: 1_0x
boardColorDark: "#1b1f2a"
boardColorLight: "#fdfdfb"
stickyStackMode: top
---

# Structural Features

## Rows / Stacks / Columns

### Row / Stack / Column primer
- [ ] This is a card in row "Structural Features", stack "Rows / Stacks / Columns", column "Row / Stack / Column primer"
- [ ] Row = `# H1`, Stack = `## H2`, Column = `### H3`, Card = `- [ ]` / `- [x]`

### Checkbox states
- [ ] Unchecked task
- [x] Checked task (lowercase x)
- [X] Checked task (capital X)

### Card with multi-line body
- [ ] Card with description
  First description line.
  Second description line.
  
  Paragraph break above.

## Legacy `#stack` tagging #stack

### Legacy stack-tagged column #stack
- [ ] Uses old `#stack` tag on a column to force stack grouping

### Another stack column #stack
- [ ] Adjacent via `#stack` instead of H2 stack header

# Media Formats

## Images

### Bitmap formats
- [ ] PNG fixture
  ![png](Media/fixture-1.png)
- [ ] JPEG photograph
  ![jpeg](Media/sample-photo.jpeg)
- [ ] JPG map
  ![jpg](Media/sample-map.jpg)
- [ ] AVIF photo
  ![avif](Media/sample-photo.avif)
- [ ] WebP pixel
  ![webp](Media/pixel.webp)
- [ ] Animated GIF
  ![gif](Media/pixel.gif)

### Vector + dimensions
- [ ] Inline SVG
  ![svg](Media/fixture.svg)
- [ ] PNG with explicit size
  ![sized](Media/fixture-3.png){width=120 height=120}
- [ ] URL-encoded path (literal space folder)
  ![spaced](folder%20with%20space/spaced-image.png)
- [ ] Literal-space path
  ![spaced](./folder with space/spaced-image.png)

## Video & Audio

### Playable media
- [ ] MP4 video
  ![video](Media/sample-video.mp4)
- [ ] WAV audio
  ![wav](Media/silent.wav)
- [ ] MP3 audio
  ![mp3](Media/silent.mp3)

## Documents & Spreadsheets

### Office / document previews
- [ ] PDF document
  ![pdf](Media/sample-doc.pdf)
- [ ] XLSX spreadsheet
  ![xlsx](Media/sample-spreadsheet.xlsx)

## Diagrams — source files

### Drawio / Excalidraw
- [ ] drawio source
  ![drawio](Media/sample.drawio)
- [ ] excalidraw source
  ![excalidraw](Media/sample.excalidraw)

# Text Formatting

## Inline marks

### Every inline mark
- [ ] **bold** and __bold-underscore__
- [ ] *italic* and _italic-underscore_
- [ ] ~~strikethrough~~
- [ ] ==highlighted==
- [ ] `inline code`
- [ ] H~2~O subscript / X^2^ superscript
- [ ] [external link](https://example.com) and [[wiki-link]]
- [ ] Footnote reference[^note1]
  [^note1]: Footnote body text.

## Block content

### Code & quotes
- [ ] JavaScript fenced block
  ```javascript
  const x = 42;
  console.log({ x });
  ```
- [ ] Rust fenced block
  ```rust
  fn add(a: i32, b: i32) -> i32 { a + b }
  ```
- [ ] Bash fenced block
  ```bash
  cargo test --package lexera-core
  ```
- [ ] Blockquote
  > A quoted line.
  > Another quoted line.

### Tables & lists
- [ ] Markdown table
  | Col A | Col B | Col C |
  | ----- | ----- | ----- |
  | a1    | b1    | c1    |
  | a2    | b2    | c2    |
- [ ] Nested list
  - one
    - one-one
    - one-two
      - one-two-a
  - two
- [ ] Ordered list
  1. first
  2. second
  3. third

### Containers / notes / dividers
- [ ] Container callouts
  ::: note
  This is a note callout.
  :::
  
  ::: warning
  This is a warning callout.
  :::
- [ ] Speaker notes and HTML comments
  Visible body content.
  <!-- hidden HTML comment, not rendered -->
  ;; speaker-note: shown only in presentation mode
- [ ] Three-column layout
  ---:
  column one content
  :--:
  column two content
  :---

# Tags & States

## Color tags

### All color tags #red
- [ ] red #red
- [ ] orange #orange
- [ ] yellow #yellow
- [ ] green #green
- [ ] blue #blue
- [ ] light-blue #light-blue
- [ ] cyan #cyan
- [ ] pink #pink

## Hidden / archival tags

### Hidden states
- [ ] deleted card #hidden-internal-deleted
- [ ] archived card #hidden-internal-archived
- [ ] parked card #hidden-internal-parked
- [ ] generic hidden card #hidden

## Card parameters & custom tags

### Parameters + custom
- [ ] Card with custom tags #todo #backend #priority-high
- [ ] Card with parameters {assigned:alice, points:5, sprint:2026-w17}
- [ ] Card with legacy `kid:` marker <!-- kid:feaa11cc -->

# Temporal Markers

## Dates / times / weeks

### Temporal variants
- [ ] Date assignment @2026-04-24
- [ ] Time slot !09:00-12:00
- [ ] Another time slot !14:00-17:30
- [ ] Week slot !W17
- [ ] Combined @2026-05-01 !08:30-10:00 #green

# Diagrams & Code

## Mermaid

### Mermaid variants
- [ ] Flowchart
  ```mermaid
  flowchart LR
    A[Start] --> B{Decision}
    B -- yes --> C[Proceed]
    B -- no --> D[Abort]
  ```
- [ ] Pie chart
  ```mermaid
  pie title "Browser share"
    "Chrome" : 58
    "Firefox" : 22
    "Safari" : 12
    "Edge" : 8
  ```
- [ ] Sequence
  ```mermaid
  sequenceDiagram
    participant U as User
    participant A as App
    U->>A: click
    A-->>U: response
  ```
- [ ] Gantt
  ```mermaid
  gantt
    title Short plan
    section Work
    Design :a1, 2026-04-20, 3d
    Build  :after a1, 5d
  ```

## PlantUML

### PlantUML source
- [ ] Class diagram
  ```plantuml
  @startuml
  class Board { +rows: Row[] }
  class Row { +stacks: Stack[] }
  Board --> "1..*" Row
  @enduml
  ```

# Includes — Column Title Multi-page Docs

## Valid `.md` slide includes #stack

### !!!include(includes/slides-basic.md)!!!

### !!!include(./includes/single-slide.md)!!!

### !!!include(includes/with%20spaces%20in%20name.md)!!! #orange

### !!!include(./includes/with spaces in name.md)!!! #yellow

### !!!include(includes/slides-marp-presentation.md)!!! #blue

### !!!include(./includes/slides.marp.md)!!! #green

### !!!include(includes/chained-include.md)!!! #pink

### !!!include(includes/empty.md)!!! #cyan

## Broken / unsupported includes #stack

### !!!include(includes/does-not-exist.md)!!! #red

### !!!include(includes/unsupported-doc.pdf)!!! #red

### !!!include(includes/unsupported-sheet.xlsx)!!! #red

### !!!include(includes/unsupported-book.epub)!!! #red

### !!!include(includes/totally-made-up.marp.md)!!! #red

### !!!include(../kanban-feature-suite/includes/slides-basic.md)!!! #light-blue

### !!!include()!!! #red

## Card-level include attempts

### Card-level (tasks / descriptions)
- [ ] Task-line include attempt: !!!include(includes/slides-basic.md)!!!
- [ ] Task description include
  !!!include(includes/single-slide.md)!!!
- [ ] Task description broken include
  !!!include(includes/nope.md)!!!
- [ ] Mixed normal + include in description
  before
  !!!include(includes/single-slide.md)!!!
  after

# Broken Media (negative path tests)

## Broken refs #stack

### Nonexistent paths
- [ ] Bad image
  ![bad](Media/does-not-exist.png)
- [ ] Bad video
  ![bad](Media/does-not-exist.mp4)
- [ ] Bad pdf
  ![bad](Media/does-not-exist.pdf)
- [ ] Typoed absolute path
  ![typo](/Usears/rspoerri/this-path-is-wrong.png)
- [ ] Bad URL
  ![bad](https://definitely.invalid.example/image.png)
