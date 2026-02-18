- [ ] @KW7 @KW37 Ilias / ELearning vorbereiten  is not listed in "kanban dashboards". we currently have KW8.
  
  This is only for events that has not specified the year such as @KW13 or @JAN possibly in combination with @MON. These must be handled like this:

  - Any yearly date value that is past within the last 2 Month must be displayed in the "Overdue" events as long as they are not checked.
  - Any yearly date value that is not checked that is Overdue 2 to 2.5 Months must be shown in a group "Outdated, soon discarded".
  - Any yearly date value that is checked and within the past 2.5 to 3 months must be shown as "Reset to repeat"
  - yearly date values older then 3 months is considered in the future (in the coming nine months)
  
  for weeky date values such as - [ ] @mon  
  - weekly date value unchecked and past in 2 days in overdue
  - weekly date value unchecked and past 2 to 2.5 days is "outdated, soon discarded"
  - weekly date value checked and past 2.5 to 3 days is shown as "Reset to repeat"
  - othervise weekly date values are considered as in future

  The yearly is our main task, if the weekly can be added without hassle, do so, othervises we do that later!

- [ ]  when pasting with shift+meta+v what is happening there, make sure it's not breaking any normal behaviour, but only pastes the modified  links (a path should be pasted as ![]() if embeddable or [](), urls (web, email, other protocols) as <>, markdown files as [[]] )

- [ ] the top should switch with the color type selection. the palette picker is nice as it is, but we dont need the color-gradient-selector below.
  - it is eighter palette mode
  - hsl with the selectors  (image 1)
  - rgb that has 0..100 right of the colors (image 2) and hex entry below
  - a color selector with the full color range (image 3) which shows rgb and hex below

- [ ] i added a link to a document ![stephango.com](https://stephango.com/flexoki)  but it's not showing as url embed!  this should try to read the site header to determine if embed is allowed. if not it should show it (open url button (show full url in text), embed not allowed), othervise it should show the frame for the embed and overlay a button to open it (if not auto-open config), othervise auto open it !

- [x] rename the kanban boards: boards view to kanban boards (without anything after that!). and the kanban boards: dashboard to kanban dashboard (nothing after that!).

- [x] it still often blurs if i want to select something or open a dropdown or similar! it closes everything very quickly. check what could be the source of this! analyze all possible reasons, do a detailed analysis! /debug we have tried solving this problem 5 times already. FIND A SOLUTION!

- [ ] change the "update sync" to it be a option in "all boards" and each individual board. the individual board takes the "all boards" the default option. the options for the new "calendar/task sharing" are "as workspace name", "as board name", "disabled"

- [x] can you add an optional username / password for the webdav access? also an option username password that is really required in the config.

- [x] automatic path fix changes the filename!!!! it should only ever change paths, never filenames. it might only be happening when i use "replace all paths with the same directory" . but this MUST NEVER HAPPEN, only paths might get modified!

- [ ] add a feature to the burger menu to rename and or move embedded files. the user can enter (using a explorer view) a new folder and a different filename. after that the file is moved there.

- [x] verify and make absolutely sure that the defaults when nothing is defined are like this (make it easily defineable)!
  - column width 450px
  - card height auto
  - section height auto
  - whitespace 16px
  - font size 1x
  - font family poppins
  - layout rows 1
  - row height auto

  - sticky stack mode title only
  - tag visibility all excluding layout
  - html comment rendering as text
  - html content rendering as text

  - show marp settings on

  - show special characters on
  - enable wysiwyg editor off
  - enable overlay editor off

  - debug off

- [ ] IDEA FOR LATER: i would like to be able to fold a stack to be minimized in width. it should add a fold button on top of each stack. it lists only the titles as blocks with a defineable width height that are put into one vertical block. it should look similar to the vertical folded column.

- [ ] maybe we could integrate this: https://www.reddit.com/r/LocalLLaMA/comments/1r2f56h/microsoftmarkitdown/

- [ ] could we integrate something like this? https://github.com/17twenty/inamate

- [ ] could we integrate this https://docx.js.org/#/ , so docx documents could be included and editable as well!

- [ ] Does markdown put lists that are separated by a newline put into separate blocks? I see some curious behaviour in the rendering. A UI has a p within every li, if the list items are newline separeted (but the p i s within the li, not around it). I want the p to be around each newline separated ul.

- [x] if i open a folder link by alt+clicking it and it's available in the workspace explorer. if possible highlight the folder there instead of opening it externally. The default action open is to show in workspace explorer, if that fails it should be opened in the system explorer/finder.

- [ ] i want to be able to drag .eml files (emails or links to emails) into the kanban. can it be added?

- [ ] verify the saving system with the file manager at it's core. what could be improved to make sure all data is consistent and can allways be saved. never ever might anything get lost by not being able to save, overwriting content without user intent or trough data inconsistencies. how can we be 100% sure nothing like this occurs? analyze deeply and all involved systems!!! the file manager ist the hub for the user to verify this and must be very clear in it's explanation of the file(s) states! make sure it is only as complex as absolutely required and remove complexity where you encounter it. Make sure the structure is simple to make debugging easy!

- [x] DO NOT DO ANY AUTOMATIC TEXT CONVERSION! I saw -> get an  arrow!!!

- [ ] add "#comment" (orange postit color) and "#note" (yellow postit color) as tags which highlight in these colors!

- [x] when tags are added at the beginning of a task or on the first line of visible content, it's considered for the whole task and not for the line!

- [ ] when deleting the top column of a  stack, sometimes the other columns get merged with the previous stack. there seem to be inconsistencies how #stack's tags are analyzed and applied.

- [ ] i cant open the files from the file manager. clicking on a filename should open the file in question.

- [ ] when enabling include mode on a task (using the burger menu) the overlay menu doesnt close.

- [ ] can we add some checking mechanism that compares the frontend data with the caches and alerts the user immediately if there are differences which should have been synchronized already? maybe have it active in debug mode only!

- [ ] suggest a way how to combine all kinds of tasks. i think of something such as
#tag & !2025.10.13
!2025.09.12 | !2025.09.15
!2025.09.12-2025.10.1 (from .. to)
!2025.13.05 !10:30 is also considered "&" combined

the order of structure is column-title > task-title > task-content
if any date or time or tag is within a higher order element, then lower order elements are considered combined with & with the upper ones. the interpretation and highlighing is done on each level individually!

analyze what is currently implemented  regarding all tag parsing searching and sorting systems first. then make a suggestion on how to improve the current situation!

DO A VERY DETAILED ANALYSIS

- [ ] if i paste a [[#1]] (or crate the clipboard content from a card / column from the clipboard) it inteprets it as a file link and adds a path to it. which breaks it by adding a relative path.

- [ ] what puppeteer features could we now implement that we have added that addon?

- [ ] could we add more formats/features similar to notion?

- [ ] i want to be able to do ![](file.csv) to import an csv.

- [ ] apparently exporting is using the source data format while processing things such as tags etc. i want to use an internal format, while storing the source format (so we can export into that again)

- [ ] Add some internal navigation functionality. it could use user defined tags such as #2.1 and somethink like <#2.1> or what would you suggest?

  **DESIGN PROPOSAL - Internal Navigation System:**

  ### Option A: Anchor Tags with Go-To Links (Recommended)

  **Anchor definition** - Uses existing `#tag` syntax with a namespace:
  - `#nav:2.1` or `#anchor:intro` - Defines a named anchor point
  - These render as regular tags but also register as navigation targets

  **Link to anchor** - Uses angle bracket syntax:
  - `<#nav:2.1>` or `<#anchor:intro>` - Creates a clickable link
  - Renders as: `→2.1` with a link icon, clicking scrolls to the anchor

  **Why this approach:**
  - Backwards compatible (anchors still render as tags)
  - `<#...>` syntax doesn't conflict with existing markdown
  - Clear visual distinction between anchor (tag style) and link (arrow style)
  - Can reuse existing tag styling system

  ### Option B: Wiki-Style Links

  - `[[#2.1]]` - Both defines anchor AND creates link
  - Simpler syntax but conflicts with Obsidian wiki links

  ### Option C: Pandoc-Style Anchors

  - `{#2.1}` - Defines anchor (like Pandoc header anchors)
  - `[go to section](#2.1)` - Standard markdown anchor link
  - Most markdown-compatible but requires two different syntaxes

  **Implementation notes:**
  - Navigation targets stored in `window.navAnchors = { 'nav:2.1': elementRef }`
  - Click handler scrolls using existing `scrollToAndHighlight()` function
  - Can integrate with search to show anchor names

- [ ] add a table editor that allows sorting of content by each category.

- [ ] can this be integrated ? https://github.com/Skarlso/adventure-voter

- [ ] would it be possible to take a screenshot of a webpage if a link is added to the board?

  1. Open Graph images (simplest) - Fetch og:image meta tags from URLs. Most websites provide preview images. No screenshot needed, just an HTTP fetch + HTML parsing.
  2. Puppeteer/Playwright (full screenshots) - Run headless browser in extension backend to capture actual screenshots. Heavier dependency (~100-400MB), slower, but gives real screenshots.

- [ ] Combined Queries

  A column can have multiple query tags:

  ```markdown
  - Reto This Week ?@reto ?.w15
  ```

  Operators

  | Operator | Description | Example |
  |----------|-------------|---------|
  | `&` | AND | `#gather_Reto&day<3` |
  | `\|` | OR | `#gather_Reto\|Anita` |
  | `=` | EQUAL | `#gather_day=0` |
  | `!=` | NOT EQUAL | `#gather_weekday!=sat` |
  | `<` | LESS THAN | `#gather_day<7` |
  | `>` | GREATER THAN | `#gather_day>0` |

  Date Properties

  | Property | Description | Values |
  |----------|-------------|--------|
  | `day` | Days from today | -2, -1, 0, 1, 2, ... |
  | `weekday` | Day name | mon, tue, wed, ... |
  | `weekdaynum` | Day number | 1 (Mon) to 7 (Sun) |
  | `month` | Month name | jan, feb, mar, ... |
  | `monthnum` | Month number | 1 to 12 |

  ?ungathered

  Collects all cards that didn't match any gather rule:

