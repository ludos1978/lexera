---

kanban-plugin: board

fontSize: 1_0x
whitespace: 24px
fontFamily: Poppins
boardColor: #ffadad
boardColorDark: #000033
boardColorLight: #f5f5ff
---

# Board

## Stack 1

### # Heading 1 in Columntitle #footer #header
- [ ] ## Heading 2 in Tasktitle #exclude
  some long text
  
  Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.
- [ ] Test 2: Class Diagram #note #hidden
  
  
  ```plantuml
  class User {
    +name: string
    +email: string
    +login()
    +logout()
  }
  
  class Admin {
    +permissions: string[]
    +grantAccess()
  }
  
  User <|-- Admin
  ```
- [ ] drawio
  ![](./kanban-presentation-1-MEDIA/drawio.drawio)
- [ ] Test 7: Pie Chart #idea
  
  ```mermaid
  pie title Browser Usage
      "Chrome" : 58
      "Firefox" : 22
      "Safari" : 12
      "Edge" : 8
  ```

## Stack 3

### # A #1 #red
- [ ] Killing existing instances...
  Starting lexera-backend...
  Waiting for backend...
  [backend]      Running DevCommand (`cargo  run --no-default-features --color always --`)
  [backend]         Info Watching /Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-backend/src-tauri for changes...
  [backend]         Info Watching /Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-core for changes...
  [backend]    Compiling lexera-backend v0.1.0 (/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-backend/src-tauri)
  Starting lexera-kanban...
  
  Both services running. Press Ctrl+C to stop.
  
  [kanban]       Running DevCommand (`cargo  run --no-default-features --color always --`)
  [kanban]          Info Watching /Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-kanban/src-tauri for changes...
  [kanban]          Info Watching /Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/lexera-core for changes...
      Finished `dev` profile [unoptimized + debuginfo] target(s) in 5.03s
  [backend]      Running `/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/target/debug/lexera-backend`
  [kanban]  warning: unused import: `std::time::Duration`
  [kanban]   --> lexera-kanban/src-tauri/src/commands.rs:5:5
  [kanban]    |
  [kanban]  5 | use std::time::Duration;
  [kanban]    |     ^^^^^^^^^^^^^^^^^^^
  [kanban]    |
  [kanban]    = note: `#[warn(unused_imports)]` (part of `#[warn(unused)]`) on by default
  [kanban]  
  [kanban]  warning: unused import: `Manager`
  [kanban]   --> lexera-kanban/src-tauri/src/commands.rs:7:41
  [kanban]    |
  [kanban]  7 | use tauri::{AppHandle, LogicalPosition, Manager, Position, Window};
  [kanban]    |                                         ^^^^^^^
  [kanban]  
  [kanban]  warning: `lexera-kanban` (bin "lexera-kanban") generated 2 warnings (run `cargo fix --bin "lexera-kanban" -p lexera-kanban` to apply 2 suggestions)
  [kanban]      Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.44s
  [kanban]       Running `/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone/packages/target/debug/lexera-kanban`

## Stack 2

### Row 1 - Stack 2 - Col 1
- [ ] Search
  ![test media]()
- [ ] a #hidden-internal-deleted
- [ ] ## Include # #orange
  !!!include(/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/markdown-kanban-obsidian/tests/kanban-presentation-tests/root-include-1.md)!!!
- [ ] ![screenshot.png](https://miro.com/app/live-embed/uXjVLewdNZE=/?moveToViewport=-956,-2765,1912,1595&embedId=344522680947){height="650px"}
- [ ] #pink
  ![photo-1756244866467-f4682840070c](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/markdown-kanban-obsidian/tests/kanban-presentation-tests/Media/photo-1756244866467-f4682840070c.avif)

## !!!include(/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/markdown-kanban-obsidian/tests/kanban-presentation-tests/root-include-2.md)!!! #0

### New Column
- [ ] Task 1 #hidden-internal-deleted
  1
- [ ] a
- [ ] Task 3
  3
- [ ] Task 2 #hidden-internal-deleted
  2
- [ ] 
- [ ] Task 2
  2
- [ ] cargo fix --bin "lexera-kanban" -p lexera-kanban
- [ ] #hidden-internal-deleted
- [ ] Task 1
  1

### New Column

### New Column


