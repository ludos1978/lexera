
---
kanban-plugin: board
---

## Archived Todos

- [ ] when an file is included multiple times in one board and is modified at one place it causes these errors "❌ Save error from backend: Save aborted: ambiguous include content detected for 3 file(s): 01-Game_Toy_Gamer/0190-EN-Homework.md (column:col-d1beecb5-a793-4001-a0a4-70965fc46918, column:col-9f45ed2d-3c04-4689-8a4a-650dd317fc9e); 02-Coreloops_Rules/0200-EN-Schedule.md (column:col-f58dfcbf-81dd-41d2-8691-1c6dc6caab0c, column:col-49114511-8346-4a3f-8bb0-33d7aa51bbe6); 02-Coreloops_Rules/0210-EN-Homework_Review.md (column:col-0ef45793-7c9c-48b7-8411-b9678b4b9308, column:col-b103a0ca-400b-4304-854e-21b2f5b2bf7d). A writable include file must map to exactly one board content source per save.
handleSaveError @ menuOperations.js:2836
(anonymous) @ webview.js:3106
postMessage
(anonymous) @ index.html?id=22018862-ec54-484e-9673-7a3163c7a83b&parentId=5&origin=9c424ccd-b920-4c32-abdd-0dd3aea93a2b&swVersion=4&extensionId=ludos.ludos-kanban&platform=electron&vscode-resource-base-authority=vscode-resource.vscode-cdn.net&parentOrigin=vscode-file%3A%2F%2Fvscode-app:1282
HostMessaging.channel.port1.onmessage @ index.html?id=22018862-ec54-484e-9673-7a3163c7a83b&parentId=5&origin=9c424ccd-b920-4c32-abdd-0dd3aea93a2b&swVersion=4&extensionId=ludos.ludos-kanban&platform=electron&vscode-resource-base-authority=vscode-resource.vscode-cdn.net&parentOrigin=vscode-file%3A%2F%2Fvscode-app:342
workbench.desktop.main.js:4160 Save failed: Save aborted: ambiguous include content detected for 3 file(s): 01-Game_Toy_Gamer/0190-EN-Homework.md (column:col-d1beecb5-a793-4001-a0a4-70965fc46918, column:col-9f45ed2d-3c04-4689-8a4a-650dd317fc9e); 02-Coreloops_Rules/0200-EN-Schedule.md (column:col-f58dfcbf-81dd-41d2-8691-1c6dc6caab0c, column:col-49114511-8346-4a3f-8bb0-33d7aa51bbe6); 02-Coreloops_Rules/0210-EN-Homework_Review.md (column:col-0ef45793-7c9c-48b7-8411-b9678b4b9308, column:col-b103a0ca-400b-4304-854e-21b2f5b2bf7d). A writable include file must map to exactly one board content source per save."

- [x] modify the export paths so that all exports go into a _Export folder on the main kanban files             
  location. below that we create the individual export folders. But the structure must be          
  {mainFilename}-{timeStamp}-{exportSelection} where the values are the same values we are          
  already using. explain the new structure to me before implementig it! 

- [x] when an column include is broken it might display the include and the error in a wrong column. i assume it's because of an index based location detection!

- [x] all fonts make problems in editing. they have vertical or horizontal offsets where they show  
  selections and the cursor! this is a problem we did not have all the time. so it must be      
  fixable! might it be related to displaying the invisible characters (space, newline, tab      
  etc.)?

- [x] if the column has a tag #title the text is put in the column header with a colored background. The colors is defined by the index of the #title tag (first title tag get color 1, second color tag gets color 2). colors are from a hsv model with strong colors!

- [x] alt+clicking on a pdf should open the document (using the default rulews to open embedded files/links)

- [x] add a tag #hidden which is overlaying the complete task's content with a content hiding overlay. in the tasks burger menu add  a button "reveal content" / "hide content". only after clicking the button then the field is displayed, there must be a burger menu at the top. The tag must be added by the user manually and it's hidden again by default on the next file opening. It's used to hide content when displaying the content by default, requiring the user to explicitly display it within the kanban. it should be exploded from export by default as well!

- [x] if a #tag is on the first line of the content (everything until the first newline), it applies to the full task. any later ones are applied to the line they are on only.


- [x] when alt+cmd+v (alt+paste) with a path in the buffer it also should create a [last-path-part](/full/path/) link . also alt+clicking [[/full/path]] should work to open a path. lastly [[~/something]] and [](~/path/to) should resolve to something relative to the user folder. possibly even expand all stored environment variables if that is easy to do. suggest what you find a good idea first before implementation!

- [x] could we integrate a basic web viewer inline (shows the page if it's link with ![](weburl) ) . currently it shows "url.com (Alt+click to open)" but it doesnt work.

- [x] why is there a apply and close button at the bottom if the file manager? this should be done with the execute buttons!!!

- [x] add Excourse to the Teaching-Content  tags

- [x] when focussing a search result: activate a scroll locking on the target, if the target position doesnt move for 0.2 seconds, then release the locking on the target. if the user moves the scrollbar or the mouse wheel or uses the arrow keys, release the locking early.
  - ALREADY IMPLEMENTED: See webview.js scrollToAndHighlight() lines 4820-4900

- [x] why does it need the includeContext in 10 places in the message types? is there possibly a opportunity for a refactor to unify this?
  - ANALYSIS: Yes, 12+ inline definitions can use shared BaseIncludeContext type (4 props), LinkIncludeContext extends it (7 props)

- [x] if we replace links by using "search for file" and do multiple replacements at once, i want all of them undone in one step. not individual ones.
  - IMPLEMENTED: LinkReplacementService._createUndoEntry() now collects all affected targets in batch mode and uses UndoCapture.forMultiple() for a single batch undo entry

- [x] PATH HANDLING CONSISTENCY REVIEW (from /refactor task):
  - **Status**: Path handling is reasonably consistent across the codebase
  - **Centralized utilities in place**:
    - `PathResolver.resolve()` - handles decode + absolute check + resolve
    - `PathConversionService` - converts between absolute/relative formats
    - `normalizePathForLookup()` / `isSamePath()` / `normalizeDirForComparison()` - for comparisons
    - `MarkdownFileRegistry` uses normalized lookups (case-insensitive)
  - **Opportunity for improvement**: Many places manually do `safeDecodeURIComponent() + path.isAbsolute() + path.resolve()` pattern that could use `PathResolver.resolve()` instead, but this is a style improvement rather than a bug
  - **jscpd**: No duplicate code blocks detected
  - **knip**: Reports false positives (needs configuration)


- [x] canx we have vertical lines of these sizes in front of the Headings?
  - H1 = 5px (1*7px)
  - H2 = 2 * 3px (2*4px + 1*1px = 7px)
  - H3 = 3 * 2px (3*3px + 2*1px = 8px)
  - H4 = 4 * 1.5px (4*2.5px + 3*1px = 13px)
  - h5 = 5 * 1px (5*2px + 4 * 1px = 14px)
  - h6 = 6 * 1px (6*1.5px + 5 * 1px = 14px)

  REDO IT: make them have the same full width use something more similar to roman numbers. I , II, III, IV, V, VI but clearly graphics not using a font! so only using lines!

- [x] lets redo the #hidden-internal-clipboard functionality.

  First rename #hidden-internal-clipboard to
  We have the tags #hidden-internal-parked and #hidden-internal-deleted tag.

  We have a top element for "Park" and one for "Trash"

  Any content that is moved to the "Park" or "Cut" from the burger menu:
  - is tagged with #hidden-internal-parked .
  - When it's placed from the "Park" into the board again, the tag is removed (is also removed from the "Park") and is moved to the new location.
  The same happens with deletion of colums and tasks.

  To cleanup #hidden-internal-deleted we add a new column "remove deleted" in the file manager for each file.
  If something is moved to the Trash, we check if something has the tag #hidden-internal-parked and warn the user that it's removed from the "Park" when continuing (let the user abort the action).

  When parsing and displaying or exporting anything in the board it hides all #hidden-internal-parked (columns and tasks) and #hidden-internal-deleted from visiblity.
  When doing comparisons (diff in the File Manager) the tagged elements are not hidden!

  Do you see any conflict that could arise from this funcitonality? One problem might be the #stack tag feature if the columns with #hidden-internal-parked or #hidden-internal-deleted might interfere with it. We might move these columns to the end of the files or add a feature to the stack handling that skips there columns / tasks?

- [x] add a drop target in the top view (next to card and column sources), where i can drop tasks and columns. The tasks/columns are removed from the board. The data is placed at the end of the kanban file data with a #hidden-internal-clipboard tags in case the system crashes while editing. The user can drag them down into the kanban again at any time. When loading all items the have the #hidden-internal-clipboard are placed into the header and can be placed anywhere in the board!

- [x] if a column header has a time/date such as !kw13 and the title of the task has no time and within the task there is a time !10:00-10:30 then it should only highlight during this week!

- [x] i would like to be able to drop external files (desktop, vscode explorer into the inline text editor without leaving it (formost the inline text editor, but also the overlay text editor and the wysiwyg editor), at a specific cursor position it drop it at. if multiple files are dropped they are placed on individual lines for each one. it should place the link directly inline with the same rules and features as if it's creating a new task.

- [x] lets change the file save/load/reload/conflict handling like this:
  - when the main file or any imported files in the kanban have unsaved modifications:
    - and when the external file is changed
  - if the main file or imported file doesnt have any unsaved changes. when any external change is detected (the main or an imported file is modified, NOT A BUFFER CHANGE) the user is asked if he wants to import the changes or ignore them. the user might import them again by going into the file states overview and press reload from file.
  -
  - when saving the board, for any external file that is modified (the file has changed since the loading of the data). this can only happen when the user decided to ignore the change (see previous point), or its a race condition. then ask the user if he wants to:
    - overwrite the file and backup the external changes (moves the outside file to a {filename}-conflict-|{datetime}.md and show a popup to allow opening the conflict file )
    - load the external changes and backup the internal changes (writes internal data to a {filename}-conflict-|{datetime}.md and show a popup to allow opening the conflict file)
    - skip the saving action (and also skip loading the content from the filedata.)
  - create a dialog with all files that have differences and the actions to be taken if multiple files are affected (use the same dialogue if there is only one file).

- [x] fix the icons according to these changes:
  - in top row columns use the same triangle as in all other folding icons.
  - for background processes use a gear wheel
  - for style presets use a typical font size icon.
  - for files use a floppy disc icon
  - the column icon must be aligned at the top with different length lines downwards.


- [x] I want to integrate the kanban boards view with the dashboard view and the search.
  the kanban boards should integrate the boards fuctionality from the dashboard. the configuration which boards are checked for events and tags etc. should be configurable within the kanban boards. Also it should be lockable, so that no board can be added or removed without unlocking. it's locked by default. of course we remove the boards from the dashboard. also add broken embeds and links to the list of elements to that can be automatically checked for. the results should be listed in the dashboard as well.

  the dashboard only lists the results of the boards tags and date results. all results that are shown in the dashboard should be sortable by
  - "board first", the results are listed below (such as tags etc.)
  - "tags, dates", all results are merged from all boards and ordered by alphabet / date.

  the search should be more compact. integrate the search field above the kanban boards at the top. the added boards are listed below. Show the search results in the dashboard as one line in the dashboard under a category "search" (or within the boards result if ordered so). It will keep up to 3 searches and it can be pinned, so the search stays in the dashboard. the pinned searches must also be stored with the workspace and restored when re-opened.
  - the search can search the open board (default) or all boards in (kanban boards) or all currently opened boards.
  - the search can be words, regex etc.

  in the boards add an all boards setting at the top, it should open with a folding button right of the lock button. it allows defining the timeframe and tags for all boards at once. the timeframe on each board has also an option "use default" or the user might change it individually. more tags can be added for each board, but the defaults are used on each board check anyway!
  make sure the folding state inthe kanban dashboard is not reset every time.

- [x] How could we combine a deadline and a task (- [ ]) with a date so the user must check the task (- [ ]) or remove it. othervise it shows in the dashboard. We show all deadlines, the ones in the past as red! Suggest a simple and well integrated solution, which likely uses the dashboard, but somehow we must activate it so it's filtered from the boards. Maybe something like:
  - [ ] !{timedate} : which will be shown while its not checked. If there is a year in the date use this exact date. If there is no year in the timedate, assume it's a date within the last {duration_of_year-6Months} .

- [x] with an included file the conflict resolution doesnt work the
  same as the main file!!! when i tell it to overwrite and backup
  the external changes it backups the old state and doesnt write
  the internal to the file! /refactor try to use the same conflict
  resolution logic code for all files.
  also it doesnt show a conflict handler that incoroprates all the
  files!!! we must create a different file conflict dialogue that
  can handle all the files. we might reuse the file states
  overview structure or even for it to be the same dialogue! It
  should show the states of each file, allow loading, saving,
  backup the old state etc! also verification of the integrated
  and tracked media / embeddings! make a plan for the view to be
  reused for this conflict handling case!!!

- [x] i like the dialogue, but it should be centered and not moving
  into the screen, just show it. also the action for all elements
  should be the first and in the same column as the other actions
  (top row). also it doesnt really use the same dialogue as the
  File States Overview. when i save it should open the same
  dialogue as when i click the button in the top row. integrate
  the information of the File States Overview into the new view!
  by pressing save it should set the overwrite action as default
  (if needed). if i press ctrl+r or meta+r it should set load from
  external as default. also give all options such as overwrite
  file, overwrite file with backup of existing file, load from
  file and discard kanban data, load from file and backup kanban
  data, skip actions this this file, this should be selectable for
  each of the files individually, but of course only relevant
  features should be available!

- [x] the filterTagsForExport in the frontend might be obsolete. is it used?
  - ANALYSIS: Still used - called from tagUtils.js:1435 as default fallback for export tag visibility

- [x] where is the css class hidden used, is this applied in a consistent way?
- [x] if i press save in the save dialogue it reopens when i close the view.

- [x] add these type of tags!

## Scope A — Project Lifecycle (Phase-Based)

*"Where are we in the semester arc?"*

| Tag | Scope |
| --- | --- |
| `#ideation` | Brainstorming course concepts, identifying themes |
| `#acquisition` | Finding & onboarding new partner companies |
| `#scoping` | Defining project briefs, deliverables, constraints |
| `#preparation` | Creating lectures, slides, exercises, materials |
| `#kickoff` | Initial meetings, student briefings, team formation |
| `#teaching` | Live sessions — lectures, workshops, inputs |
| `#execution` | Accompanying ongoing project work |
| `#milestone` | Intermediate check-ins, sprint reviews |
| `#review` | Feedback rounds with students and/or partners |
| `#assessment` | Grading, rubrics, written evaluations |
| `#presentation` | Final demos, showcases, pitch events |
| `#handoff` | Delivering results to partner, knowledge transfer |
| `#closing` | Retrospectives, wrap-up, course conclusion |
| `#improvement` | Post-semester reflection, course redesign |
| `#admin` | Ongoing bureaucracy, room bookings, forms |


## Scope B — Stakeholder-Oriented

*"Who am I doing this for / with?"*

| Tag | Scope |
| --- | --- |
| `#partner` | Communication & coordination with external companies |
| `#students` | Student-facing tasks, briefings, Q&A |
| `#faculty` | Coordination with colleagues, co-lecturers |
| `#department` | Institutional obligations, curriculum alignment |
| `#mentoring` | Coaching individual student teams |
| `#acquisition` | Prospecting, pitching to potential new partners |
| `#relationship` | Maintaining long-term partner & alumni connections |
| `#teaching` | Delivering content to the class |
| `#grading` | Evaluating student work |
| `#reporting` | Summaries for partners, faculty, or administration |
| `#logistics` | Scheduling, rooms, tools, platforms |
| `#conflict` | Mediating issues (team problems, partner friction) |
| `#public` | External visibility — showcases, publications, PR |
| `#self` | Own professional development, conference prep |
| `#compliance` | Data protection, contracts, university regulations |

## Scope C — Activity-Type (GTD / Energy-Based)

*"What kind of work is this?"*

| Tag | Scope |
| --- | --- |
| `#prepare` | Creating slides, handouts, exercises |
| `#communicate` | Emails, calls, messages — any party |
| `#teach` | Live delivery — lectures, workshops, critiques |
| `#supervise` | Guiding student teams, checking progress |
| `#evaluate` | Grading, rubrics, written feedback |
| `#coordinate` | Aligning schedules, bridging students ↔ partners |
| `#document` | Meeting notes, project briefs, templates |
| `#develop` | Designing new modules, iterating on course |
| `#research` | Exploring methods, tools, case studies, references |
| `#present` | Giving talks, demos — internal or external |
| `#design` | Structuring assignments, crafting project briefs |
| `#troubleshoot` | Solving unexpected problems, tech issues |
| `#network` | Industry events, relationship building |
| `#reflect` | Retrospectives, journaling, lessons learned |
| `#admin` | Forms, approvals, bureaucratic overhead |

## Scope D — Deliverable / Output-Based

*"What artifact am I producing?"*

| Tag | Scope |
| --- | --- |
| `#slides` | Lecture presentations, workshop decks |
| `#brief` | Project briefs for students and/or partners |
| `#rubric` | Grading criteria, evaluation frameworks |
| `#handout` | Exercise sheets, worksheets, templates |
| `#correspondence` | Emails, formal letters, announcements |
| `#protocol` | Meeting notes, decision logs |
| `#report` | Semester reports, partner summaries, evaluations |
| `#feedback` | Written feedback to students or teams |
| `#schedule` | Timetables, milestone plans, Gantt charts |
| `#contract` | Agreements, MOUs, NDAs with partners |
| `#showcase` | Final presentation materials, exhibition assets |
| `#survey` | Course evaluations, partner feedback forms |
| `#template` | Reusable course materials for future semesters |
| `#portfolio` | Curated student work, case study documentation |
| `#archive` | End-of-semester documentation, file organization |

**Best for:** Tracking tangible outputs. Excellent for quality control ("are all my `#brief` items done before kickoff?") and building a reusable `#template` / `#archive` library over semesters.

---

## Scope E — PM Knowledge Areas (PMBOK-Adapted)

*"What management concern does this address?"*

| Tag | Scope |
| --- | --- |
| `#scope` | Defining what's in/out, requirements, boundaries |
| `#time` | Scheduling, deadlines, milestone tracking |
| `#quality` | Standards, review criteria, expectations |
| `#communication` | All stakeholder information flow |
| `#risk` | Identifying & mitigating issues before they escalate |
| `#resources` | Tools, rooms, budgets, platforms |
| `#integration` | Aligning course goals, partner needs, student learning |
| `#procurement` | Acquiring partners, tools, licenses, materials |
| `#stakeholder` | Relationship management, expectation alignment |
| `#knowledge` | Teaching, mentoring, knowledge transfer |
| `#assessment` | Measuring outcomes — grades, partner satisfaction |
| `#documentation` | Records, protocols, formal paperwork |
| `#compliance` | University regs, data protection (DSGVO), contracts |
| `#change` | Handling scope creep, pivots, unexpected shifts |
| `#lessons` | Retrospectives, continuous improvement, iteration |

- [x] /refactor make sure path handling is consistent in the whole project. especially when it comes to how files are managed, stored and compared!

- [x] analyze the execution flow for all possible situations where the file manager might be opened including the user opening
it. it should suggest actions the minimize data loss, prefering internal changes over external ones. also we might include a toggle
to show a diff as a preview panel. this should switch between all the files, only ever one diff view can be active. it diffs between file and kanban board content!

- [x] add #communication to the tags, similar to the #preparation tag

- [x] add the moscow style tags #must #should #could #wont

- [x] in the marp presentation export the video playback plugin must be modified. It should automatically stop videos when the slide is changed (it can allways stop all videos in the presentation). Also it would be nice if we could have a start time and optional end time ./filename.mp4&start=40&end=60s

- [x] do another round of cleanup analysis and refactoring. what could be improved to make the code simpler and more structured, better readable and mainainable. focus on simplicity over complexity. ultrathink . check the ts, js, html and css! start with the most complex refactorings first and then do the simpler ones. think about renaming functions to match the functionality.


- [x] i want an addiitonal side panel that. for each kanban panel that is within it.
  - analyze the dates, times etc. for a defined timeframe into the future (3days, 7days, 30days)
  - list all tags (for example #todo )
  - the timeframe and tags should be configurable for each kanban board. these settings should be stored in the workspace settings!

- [x] if a link !(alt text)[] only has an alt text, then the search feature could open a web-search (search url should be defineable (google, kagi, etc.)) in playwright that does a direct image search for the alt text. the user can select an image which is then directly downloaded, set as the image path and the source is set as the image text !(alt)[image.png "image text"] . What options do we have to right click an image and add a option there within the playwright?

- [x] we have so many addons and features. would it make sense to refactor the features so they function as plugins that can be added.

i am thinking about the features:
- "marp export"
- "pandoc export"
- "excalidraw rendering & export"
- "drawio rendering & export"
- "mermaid rendering & export"
- "plantuml rendering and export"
- "website embedding & export"
- "alternative image search (using web)"
- puppeteer
- export to specific formats
- integration of other markdown-it plugins

where would the base sytem require modular systems that this could be integrated? my first guesses would be:
- kanban
  - rendering and display of the kanban board/columns/tasks/elements
  - board/column/task burger options menu
  - element burger options (images, videos, other elements)
  - different tags
  - card and column source (template) system
  - sorting features
  - yaml header editing
  - modification of elements, tasks, columns
  - processing after content changed (definition of order)
  - in the active processes menu
  - data loading & saving
- kanban dashboard integration
- kanban search intergation
- export
  - options
  - filters
  - postprocessors


- [x] /refactor the burger menu is for the embeds, links, etc:
- types that show the menu
  - embeds ![]()
  - links []()
    - embeds and links also can have the {} after
  - includes !!!include()!!!
  - links <>
  - wiki-links [[]]
  - ```plantuml or mermaid
```
- all media and links allways have the burger menu, when it's a broken link we show it in errors style and show the burger menu allways visible, if it's valid it only shows on hover. All links are relative to the file the link is in. If it's an included file, its relative to it's path. the menu options typically are:
  - open (open the media in the builtin or external editor associated with the mediatype)
  - reveal in file explorer
  - search for file (search for alternative file with the same filename)
  - browse for file (file-dialogue to select the fiels)
  - convert to relative / absolute (filepath)
  - delete

- [x] this is an xlsx embed feature we could add!
  using libreoffice:
  /Applications/LibreOffice.app/Contents/MacOS/soffice --headless --convert-to pdf:calc_pdf_Export --outdir . "$@"%
  maybe directly convert to png
  or use the pdf to image conversion after that
  i want to use something like ![](/path/to/file.xlsx){page=1 width=300px} and it directly converts to png and embeds it into the file.


- [x] i would like a way to embed iframes in the pages. currently it possible to use html, but when exporting it as pdf it's a bad look.
for example i have this html:
"""
<div style='position: relative; padding: 0px; height: 650px; overflow: hidden;'>
    <iframe width="100%" height="100%" src="https://miro.com/app/live-embed/uXjVLewdNZE=/?moveToViewport=-956,-2765,1912,1595&embedId=344522680947" frameborder="0" scrolling="no" allow="fullscreen; clipboard-read; clipboard-write" allowfullscreen></iframe>
</div>
"""
but i'd rather have something like this:
![](https://miro.com/app/live-embed/uXjVLewdNZE=/?moveToViewport=-956,-2765,1912,1595&embedId=344522680947 )

and when rendering as pdf it should:
- display a screenshot of the page
- just display the url
- show a manually given image in the alt text

what would you suggest how to implement it?


- [x] Dashboard fixes:
  - [x] the "right-click a .md file in explorer ..." can be hidden after one has been added.
  - [x] i want to select or enter a tag, then all tags of this type get searched and listed
  - [x] i dont want a list of tags to click. i want a dropdown that allows adding the existing tags or enter tags manually that should be searched within the kanban and list all occurances.
  - [x] it doesnt list the upcoming week tags and time tags
  - [x] the upcoming items from the date search should be sorted by first occurance (by time). separated each day by a horizontal line. make suggestions how to label the days!

- [x] """index.html?id=d7665c81-a4e0-4c7e-9614-7466f476c528&parentId=20&origin=bec83e72-0fbb-4300-a82d-52ad56865f64&swVersion=4&extensionId=ludos.ludos-kanban&platform=electron&vscode-resource-base-authority=vscode-resource.vscode-cdn.net&parentOrigin=vscode-file%3A%2F%2Fvscode-app:69 Uncaught TypeError: Cannot read properties of null (reading 'classList')
    at index.html?id=d7665c81-a4e0-4c7e-9614-7466f476c528&parentId=20&origin=bec83e72-0fbb-4300-a82d-52ad56865f64&swVersion=4&extensionId=ludos.ludos-kanban&platform=electron&vscode-resource-base-authority=vscode-resource.vscode-cdn.net&parentOrigin=vscode-file%3A%2F%2Fvscode-app:69:122
20index.html?id=d7665c81-a4e0-4c7e-9614-7466f476c528&parentId=20&origin=bec83e72-0fbb-4300-a82d-52ad56865f64&swVersion=4&extensionId=ludos.ludos-kanban&platform=electron&vscode-resource-base-authority=vscode-resource.vscode-cdn.net&parentOrigin=vscode-file%3A%2F%2Fvscode-app:69 Uncaught TypeError: Cannot read properties of null (reading 'classList')
    at index.html?id=d7665c81-a4e0-4c7e-9614-7466f476c528&parentId=20&origin=bec83e72-0fbb-4300-a82d-52ad56865f64&swVersion=4&extensionId=ludos.ludos-kanban&platform=electron&vscode-resource-base-authority=vscode-resource.vscode-cdn.net&parentOrigin=vscode-file%3A%2F%2Fvscode-app:69:122"""

- [x] Teaching-Content (formerly content-type-teaching) extended with "post-processing" "preparation" "presentation" "improve" "integrate" "grading" "exam" "homework" "project" "administrative"

- [x] where is FileCommands.handleOpenFileLink used? can it be removed if it's unused?

- [x] it sometimes happens that the "drop-indicator active" is not removed properly! check the codepaths that it's allways cleaned up!

- [x] ok, we have most features we require implemented. now can we make tests for all use cases that are really using the code (frontend to backend) maybe also a test that runs be run from within the application. that uses some standardized boards that call the functions and verify the changes done to the data? or what would you suggest to verify that all the features are working properly?

- [x] on windows drag & dropping files into the columns doesnt create paths as it does with osx. does it handle c: and other paths equally as / paths?


- [x] the pinned headers are not on top anymore! why is translateZ not working anymore to fixate column-title them above the column-content?


- [x] we need a better style for the task item "- [ ]" and "- [x]" in markdown. it should allow being toggled outside the edit mode (and modify the data)!

- [x] editor view:
  can we add a dedicated task edit view. it is added to the burger menu of a task (edit task) at the top. it opens a overlay with which fills 80% of width and height with an increased font size (configurable in a burger menu in the overlay editor). the overlay editor can only be closed by alt+enter or pressing save or escape or clicks outside the view. drop events (of external files should behave as direct link creation within the editor). the editor has 3 view modes. - markdown only mode - dual mode, where markdown is written left and the preview is on the right side. - wysiwyg mode where we re-use the wysiwyg editor, but with an additional tools pane at the top (adding image links, etc. as in a typical wysiwyg editor.)


- [x] wysiwyg errors:
  - pressing outside the edit field with the mouse should close the editor. it doesnt currently.



- [x] can we change the image-path-overlay-container from div to span?

- [x] when debug is disabled, all normal logs must be disabled, only error and immporant warnings might be logged out!

- [x] check the code for any timeout calls, i want to minimize usage of timeout!

- [x] when i "search for file" with "replace all paths with the same directory" it says there is 0 files found. but it must at least find the one i am searching for. i am sure all files are there, but someting goes wrong while searching.
@logs/vscode-app-1768683549969.log is the log
the path found is "/Users/rspoerri/_SYNC/Hochschulen/_PRESENTATIONS/_World_n_Level_Design/_TOPICs_RESEARCH/How_Level_Design_Can_Tell_a_Stor.RwlnCn2EB9o.1080p/"
this is the task description """---:

![alt text](/Users/rspoerri/_SYNC/Hochschulen/_PRESENTATIONS/_World_n_Level_Design/_TOPICs_RESEARCH/How_Level_Design_Can_Tell_a_Stor.RwlnCn2EB9o.1080p/How_Level_Design_Can_Tell_a_Stor.RwlnCn2EB9o.1080p-still-00-00-20.png "high society")

![alt text](/Users/rspoerri/_SYNC/Hochschulen/_PRESENTATIONS/_World_n_Level_Design/_LWD-Presentations/_TOPICs_RESEARCH/How_Level_Design_Can_Tell_a_Stor.RwlnCn2EB9o.1080p/How_Level_Design_Can_Tell_a_Stor.RwlnCn2EB9o.1080p-still-00-00-25.png "philosophical")

![alt text](/Users/rspoerri/_SYNC/Hochschulen/_PRESENTATIONS/_World_n_Level_Design/_LWD-Presentations/_TOPICs_RESEARCH/How_Level_Design_Can_Tell_a_Stor.RwlnCn2EB9o.1080p/How_Level_Design_Can_Tell_a_Stor.RwlnCn2EB9o.1080p-still-00-00-30.png "underwater city")

:--:

![alt text](/Users/rspoerri/_SYNC/Hochschulen/_PRESENTATIONS/_World_n_Level_Design/_LWD-Presentations/_TOPICs_RESEARCH/How_Level_Design_Can_Tell_a_Stor.RwlnCn2EB9o.1080p/How_Level_Design_Can_Tell_a_Stor.RwlnCn2EB9o.1080p-still-00-00-36.png "theares & bars")

![alt text](/Users/rspoerri/_SYNC/Hochschulen/_PRESENTATIONS/_World_n_Level_Design/_LWD-Presentations/_TOPICs_RESEARCH/How_Level_Design_Can_Tell_a_Stor.RwlnCn2EB9o.1080p/How_Level_Design_Can_Tell_a_Stor.RwlnCn2EB9o.1080p-still-00-00-40.png "lofty (erhaben)")

![alt text](/Users/rspoerri/_SYNC/Hochschulen/_PRESENTATIONS/_World_n_Level_Design/_LWD-Presentations/_TOPICs_RESEARCH/How_Level_Design_Can_Tell_a_Stor.RwlnCn2EB9o.1080p/How_Level_Design_Can_Tell_a_Stor.RwlnCn2EB9o.1080p-still-00-00-44.png "philosophical")

:--:

![ruin](/Users/rspoerri/_SYNC/Hochschulen/_PRESENTATIONS/_World_n_Level_Design/_LWD-Presentations/_TOPICs_RESEARCH/How_Level_Design_Can_Tell_a_Stor.RwlnCn2EB9o.1080p/How_Level_Design_Can_Tell_a_Stor.RwlnCn2EB9o.1080p-still-00-00-48.png "ruin")

![despair](/Users/rspoerri/_SYNC/Hochschulen/_PRESENTATIONS/_World_n_Level_Design/_LWD-Presentations/_TOPICs_RESEARCH/How_Level_Design_Can_Tell_a_Stor.RwlnCn2EB9o.1080p/How_Level_Design_Can_Tell_a_Stor.RwlnCn2EB9o.1080p-still-00-00-52.png "despair")

![factions](/Users/rspoerri/_SYNC/Hochschulen/_PRESENTATIONS/_World_n_Level_Design/_LWD-Presentations/_TOPICs_RESEARCH/How_Level_Design_Can_Tell_a_Stor.RwlnCn2EB9o.1080p/How_Level_Design_Can_Tell_a_Stor.RwlnCn2EB9o.1080p-still-00-00-55.png "factions")

:--:

![new year](/Users/rspoerri/_SYNC/Hochschulen/_PRESENTATIONS/_World_n_Level_Design/_LWD-Presentations/_TOPICs_RESEARCH/How_Level_Design_Can_Tell_a_Stor.RwlnCn2EB9o.1080p/How_Level_Design_Can_Tell_a_Stor.RwlnCn2EB9o.1080p-still-00-01-00.png "new year")

![1959](/Users/rspoerri/_SYNC/Hochschulen/_PRESENTATIONS/_World_n_Level_Design/_LWD-Presentations/_TOPICs_RESEARCH/How_Level_Design_Can_Tell_a_Stor.RwlnCn2EB9o.1080p/How_Level_Design_Can_Tell_a_Stor.RwlnCn2EB9o.1080p-still-00-01-06.png "1959")

![alt text](../../_TOPICs_RESEARCH/How_Level_Design_Can_Tell_a_Stor.RwlnCn2EB9o.1080p/How_Level_Design_Can_Tell_a_Stor.RwlnCn2EB9o.1080p-still-00-01-11.png)

:---

<br>"""

- [x] the debug option must be stored across instances.

- [x] add an option to enable/disable the marp specific settings in the view (the marp layout settings in the file info header and he marp classes, marp headers & footers, marp colors). when disabled they should be hidden. (Implemented toggle and preference sync.)

- [x] tab should not switch between field, instead it should indent all selected lines or at the cursors position, but alt+enter should end editing a field. shift+tab should unindent a line. we only use spaces to indent and unindent.

- [x] remove the "open file" button, but keep the function if it's still used by the board to open the markdown. othervise remove the function as well.

- [x] analyze the html structure and make a detailed hierarchy structure in a agent/HTML-STRUCTURE.md with structural documentation. i can provide a html of a typical presentation if you need. we will use it to simplify the css afterwards. so include any relevant data needed for a css analysation.

- [x] could we include pandoc and it's conversion methods into the kanban exporter? are there any other worthwile exporters or converters that use markdown as basic format?


- [x] when using the search for file, could we add a checkbox to the dialogue searching for the alternative files, which would allow replacing all paths that have the same error. so it searches for the filename, the user selects the file. the path element is taken from the broken file (broken-path) and the newly found file (new-path). and all occurances of the broken-path are replaced by the new- path (if the filename exists under the new path). if we check the checkbox, then search trough the kanban board for the same (broken-path) and show the number of files that have this path. also search for the filenames in the new-path, which contain the same filename as the files in the kanban board with the broken-path.

- [x] the excalidraw converter doesnt show embedded images and manually drawn strokes. i need them to work!

- [x] when clicking the version number in the burger menu, the code should switch to debug mode. where all debug logs are activated. also the version number should add (debug) after the number while it's active.

- [x] why is the vscode search feature so much faster then our search feature. can we use the vsocde search api?

- [x] dont strike trough the columninclude, rather replace it by the new one. actually do that for all replacements, we drop the strike trough functionality and remove it completely. we only put in the new link from now on. we must make sure the undo works properly, even for multiple replacements!

- [x] add a feature to convert individual or multiple images-paths or referenced document-paths in any of the documents (main or included kanban baords) that allows converting from absolute to relative paths and from relative to absolute paths. each document should get a button on the top-right (an individual breadcrumbs menu), with the option to convert the path type. detect the path type and give the option to convert it to the other tyep. also add the feature to the "File States Overview" system where each (kanban or markdown) file can be individually modified from relative to absolute paths, have both options (convert all to relative paths and convert all to absolute paths). and add one button to convert the main file and all included files.

- [x] move the delete button from the "image not found hover" to the burger menu on the image.

- [x] gray out the option which is not applicable. a relatvie path should not be chageable to relative again.
- add an option to open the file or the path in the file explorer (finder) where the file is in!

- [x] when i delete the top column in a stack, the stack below it should have it's #stack tag removed. in all other cases there is no need to change anything

- [x] when initializing a file it still does not reload the file immediately after adding the required header.

- [x] found problems:
- when i modify a column that has tasks and i add a columninclude. it should be able to add the existing tasks into the included board (as these othervise get lost when the include is added). this was working before, but isnt anymore.
- when i modify the board, it sometimes allways immediately exits editing when i click a editable field, i cant modify the board anymore.
- when i have a save conflict and i save my changes as backup and load from external, a popup should show up with the backup file link to open.
- when dropping a task from the sources on the info header it doesnt do the positional highlight reliably. it maybe does it once, but not the second time i use that feature.

- [x] after copying a column as markdown. i'd like to be able to drop it as a new column with content out of the copyed content.
  - if the first task only is a title without a content. it will be used as column title.\
  - othervise the title of the column is empty\

  all other content is used to create tasks ( split by --- by the same mechanic as the column import funcitonality already uses)

  can we reuse the task creation functionality of the column include?

- [x] it seems as if the board is loaded twice, or at least the height calculation is reset again while loading the board initially. can you verify and analyze?

- [x] when i copy a task as markdown it doesnt copy the task, but the full board. The same problem is with the column. it should only copy the content as markdown (presentation) which the function is called from!

- [x] when pressing the save button in the fiel states overview it doesnt allways write the file. this is a force save, which writes the file no matter what any automatic system says!

- [x] when switching from one columninclude to another, it doesnt load the content if it's not already in the cache. alwayss immediately remove the old content after asking to save changed content. then emtpy the columns tasks, then fill up as soon as the data is available. verify the current order, make 3 suggestions how to fix the problem with quality rating. do not add new functions, fix the existing flow


- [x] did this about 30 times: do another round of cleanup analysis. what could be improved to make the code simpler and more structured, better readable and mainainable. focus on simplicity over complexity. ultrathink . repeat this until you find no major problems . ultrathink . check the ts, js, html and css!

- [x] The default layout presets are defined in _getLayoutPresetsConfiguration in KanbanWebviewPanel. i want all default configs in the configuration so the user can change them. nothing in the code. check for other default configuration values as well. there is the config and no values that replace the config if it's missing or overrides etc. never use "value = configvalue || someotherdefault;" print a warning or error, make sure the config is defined!


- [x] analyze what code design tempaltes would make sense to use in this project. analyze the high level requirements of the code and do a deep analysis of the current state and a optimal state would it have been done by an team of experts in software architecture that both make sure it's strucutred well, but also not overcomplicated!

- [x] can we highlight the lines where tags are within the task description as well? also
work with the inheritance system we use. for that we should also support minutes. \
\
for example the task header might have:\
!15:00-16:00\
\
and the task contents might be\
\
!:15-:30 : highlighted between 15:15 to 15:30\
\
!:30-:45 : highlighted between 15:30 to 15:45 \
\
which would highlight the complete line with a right border as we do with the task. \
\
can you integrate that into the existing system?

- [x] would it be possible to limit the display of active hours, days etc if the above
  timeslots (if they are added) are also active.\
  \
  so if the column has a !W49 tag, then the hourly tag !09:00-12:00 is only showing if
  it's Week 49. But if the column has no Weekly tag, the hourly tag shows allways.\
  \
  the order date/time would be: Year -> Month -> Week-Numer -> Day or Day-Number ->
  Hour/Timeframe\
  \
  The structure is: Column-Title -> Task-Title -> Task-Content\
  \
  if a higher order (for example Year) is in the higher structure (Column-Title), then a
  lower data/time (for example Time) on a lower structure below it is only highlighted
  when the higher order one is also active.\
  \
  make 3 suggestions how to implement this feature with a quality rating!

- [x] when dropping tasks on folded columns it should highlight it's border and be appended to the end of the column. the same applies if the task is dropped on a column but not in a valid position or on the header. this is currently working, but it doesnt highlight the border, it highlights some position in the top of the column.

- [x] if we drag a file into the kanban we check the media folder first. if a file that matches the criteries is found in the media folder (first check same filename and compare the has when also check all files for the first 1mb of the file combined with the filesize) :

to calculate the hash for files < 1mb use the hash, for larger files use the 1mb of t file and the filesize combined to create the hash.

keep the hashes and the last changed time in a .hash_cache file in the media folder. if t last changed date is modified, recalculate the hash for the file
- we give the user the option to open the media folder (copy it manually)
- or link the already existing file (if the file is found, as first option)
- or cancel

- [x] the drag & drop system can copy media into the media folder if the path to the file is not found. but when the media is very large this might crash the webview. in this case the user should be prompted for the action to take instead. check if the file is larger then 10mb and then ask the user to manually copy the file into the media folder or get a path to the file to paste!
  - COMPLETED 2025-12-05: Dialogue with hash-based matching. Uses partial hash (first 1MB + size) to detect existing files in media folder. Options: Link existing file (if found), Open media folder, Cancel. Hash cache stored in .hash_cache file with mtime tracking for efficient updates.

- [x] the drag & drop system is used by many components. dragging internally, draggin externally, for columns, for tasks. They can be dropped in different rows, stacks of columns and tasks into the columns themself. This system described its functionality.

The system does not use any caching!

first we need to figure out on what row we are (vertical), then which stack (horizontal), then in which column (vertical), if we are moving a task we also need to check within the column for the correct position (vertical). use the positions of the elements directly, do not chache anything!

the row is split up into areas by the:
  kanban-container > kanban-board multi-row > kanban-row
when we determined the row, only check within this row for any further checks!

the vertical dividers between stacks are the:
  kanban-container > kanban-board multi-row > kanban-row > kanban-column-stack column-drop-zone-stack
when on top of one of those
- drop the column into the new stack. do not add a #stack tag to it. depending on the row add a row tag.
- if a task is dropped here, we dont have a valid solution.

if over a:
  kanban-container > kanban-board multi-row > kanban-row > kanban-column-stack (without column-drop-zone-stack)
we should only check this stack for the right position

only check within the found kanban-column-stack!
- columns are stacked when there is more then one kanban-full-height-column in a kanban-column-stack
- if there is only one column in a kanban-column-stack it's a single column stack

if we are dragging a column: we need to use the middle of a column, which is defined by:
  kanban-container > kanban-board multi-row > kanban-row > kanban-column-stack > kanban-full-height-column (collapsed-horizontal) > column-header > the top of it
  +
  kanban-container > kanban-board multi-row > kanban-row > kanban-column-stack > kanban-full-height-column (collapsed-horizontal) > column-footer > the bottom of it
  / 2
when above : the column should be placed above
when below : we need to check the next one until we find one that it's above
if there are none left, it's the last one.
to display the position place the marker in:
  kanban-container > kanban-board multi-row > kanban-row > kanban-column-stack > kanban-full-height-column (collapsed-horizontal) > column-margin
if it's the last position display it at the top of:
  kanban-container > kanban-board multi-row > kanban-row > kanban-column-stack > stack-bottom-drop-zone
if it's a column we have determined for the column position here.

if a vertically folded column is dropped into a stack it must converted to be horizontally folded. also if a column is dropped into a stack with a vertically folded column, it must be converted to horizontally folded.

if the column is dropped as the first column in the stack dont add a stack tag, but add a stack tag to the column below. if the column is placed anywhere else in the stack then add a stack tag.

if we are dragging a tasks, then position must be further calculated using these two rules:
- determine the current column by checking if we are hovering over the column-title. if this is the case we can directly put the task into at the end of the column.
- then check if we are hovering over the "top of the column-header" and the "bottom of the column-footer" .
only check it within the previously selected stack!
all further calculations are only done on this column!
when hovering over the footer or the header on a folded column, it must highlight the header and put the task as last position in the column.

iteratively go over each task-item in the column and break once you found one that the task is hovered over:
  kanban-container > kanban-board multi-row > kanban-row > kanban-column-stack > kanban-full-height-column (collapsed-horizontal) > column-inner > column-content > tasks-container > task-item
if it's hovered above a gap, this is the position we want it to drop onto!

the task must be placed above, if above the mid. it should be placed below, if below the mid.
if no solution is found, drop it at the end of the column.

((( the position of the task is calculated by:
- if the task is dropped onto the column-title, column-header or column-footer, place it as the last task of the column! )))



- [x] ARCHITECTURE REFACTORING: Event-Driven Component System
  **Plan:** See `agent/ARCHITECTURE-REFACTORING-PLAN.md` for full details
  **Phase 1 Guide:** See `agent/PHASE1-EVENTBUS-IMPLEMENTATION.md`

  **Target Architecture:**
  ```
  KanbanPanelShell (~200 lines) - VS Code lifecycle only
       │
       ▼
  PanelEventBus (~400 lines) - typed events, middleware, correlation
       │
       ├── BoardStore (~350 lines) - state, selectors, undo/redo
       ├── FileCoordinator (~500 lines) - files, includes, conflicts
       ├── WebviewBridge (~400 lines) - messages, batching, req/res
       └── EditSession (~250 lines) - edit mode, checkpoints
  ```

  **Phases (14 sessions, ~40 hours total):**
  - [ ] Phase 1: PanelEventBus (foundation) - 2 sessions
  - [ ] Phase 2: BoardStore (state management) - 2 sessions
  - [ ] Phase 3: WebviewBridge (message routing) - 2 sessions
  - [ ] Phase 4: FileCoordinator (file operations) - 2 sessions
  - [ ] Phase 5: EditSession (undo/redo) - 2 sessions
  - [ ] Phase 6: KanbanPanelShell (final assembly) - 2 sessions
  - [ ] Phase 7: Testing & Documentation - 2 sessions

  **Quality Targets:** All components 95%+ quality rating
  **Risk:** Medium-High (core refactoring), mitigated by incremental migration

- [ ] I want to be able to add templates for columns. these should be markdown presentation style that create the content of a column with none or some tasks with default content when dragged into the scene. It should also allow a -Media folder with the same name that would be instantiated into the markdown-kanban when instantiated.

On instantiation the user is asked for a filename which is defined by default from the first line of the file where {kanbanfilename} is the filename of the main-board-markdown-file.

a template might look like:
"""
{kanbanfilename}-Homework

## Homework

==Requirements==

- ...

==Deliveries==

- ...
"""

or

"""
{kanbanfilename}-SemesterSchedule

## Semester Schedule

![]({thisfilename}-Schedule)
"""

- [x] if a column already has tasks and a !!!include()!!! is added to the column header the content gets removed when saving it. To prevent loosing data the user should be asked wether he wants to add the existing tasks to the included file or if it should be discarded.

- [x] currently when i modify a task which contains a drawio it regenerates the image every time, could we cache it somehow? maybe in a subfolder (drawio-cache) of the Media folder of the markdown "{filename}-Media" ? it should be individual for each file, so included files have the media cached in a {include-filename}-Media folder next to the include file.

- [x] do another round of code de-duplication! verify the complete code  structure. use the files in the agent folder to search for duplicates. analyze the data and code structure deeply, then suggest improvements you could work on. generate 3 solutions to solve the problem you found and rate  the quality. improve the quality of each solution until all are very high,  then pick the best solution or combine the solution to a final suggestion.  the quality must be above 95% to be allowed to continue working on it! then continue implementing the solution. ultrathink plan

- [x] "move to column" from a task burger menu doesnt work.

- [x] an #tag, @tags and .tags are only separated by spaces, tabs, newlines etc, not by any other character such as dots, commas, etc.
  - #tags that start with a number are allways displayed as numbers in a badge (the system is already in place, but it doesnt accept 3.1.3 indexes)
  - @tags
    - can be @w13 : week 13
    - can be @mon or @monday : any weekdays
    - can be @10:30 : time in 24h mode, without am, pm it's allways 24h mode
    - can be @10pm : time in 12h mode
    - can be @10:30-12:00 : timeslot in 24h mode

    - the date and timeslots will be highlighted when they are active (already in place for dates)

- [x] include in the column header is still not reliably loading the file. also the enable include isnt working properly. i tested in this logfile: @logs/vscode-app-1763916142426.log

- [x] Create a group of tags

  - #schedule
  - #planning
  - #preparation
  - #verify

  - #overview
  - #information
  - #presentation

  - #example
  - #tasks
  - #homework

  - #deliveries
  - #handouts
  - #references

- [x] in the column handling after a text change of a column header, it must check for #stack tags as well. because if a stack tag is removed a column might in that current stack might be required to be moved into a separate column, or a separate column might get merged with a previous stack.

- [x] when focus is regained by the kanban (possible configuration change), check if the tag menus of column and tag burger menus have changed and if so, regenerate these submenus.


- [x] before starting the migration, create todos, make sure that before you replace a function you know
  all features of the old code and reimplement them in the replacement. also make sure you remove the
  old code ompletely!
  - PLANNED: See tmp/plugin-migration-features.md for feature checklist
  - Solution 1 (Interface-Based Plugin Registry, 96% quality) selected

- [x] COMPLETED: PLUGIN ARCHITECTURE MIGRATION (Solution 1: Interface-Based Plugin Registry)
  - [x] PHASE 0: Document existing code features (see tmp/plugin-migration-features.md)
  - [x] PHASE 1: Create plugin interfaces (ImportPlugin.ts, ExportPlugin.ts)
  - [x] PHASE 2: Create plugin implementations
    - ColumnIncludePlugin, TaskIncludePlugin, RegularIncludePlugin
    - MarpExportPlugin
  - [x] PHASE 3: Migrate FileFactory to use plugins (createIncludeViaPlugin, createIncludeDirect methods)
  - [x] PHASE 4: Migrate markdownParser to use PluginRegistry.detectIncludes (NO fallback)
  - [x] PHASE 5: Unified IncludeFile class with fileType property
    - DELETED: ColumnIncludeFile.ts, TaskIncludeFile.ts, RegularIncludeFile.ts
    - All functionality consolidated into IncludeFile.ts
  - [x] PHASE 6: Update all imports and usages
    - Updated: kanbanWebviewPanel.ts, includeFileManager.ts, FileOperationVisitor.ts
    - Updated: MarkdownFileRegistry.ts, files/index.ts
  - ARCHITECTURE:
    - IncludeFile.ts: Unified class with fileType='include-column'|'include-task'|'include-regular'
    - Plugins create IncludeFile instances with appropriate fileType
    - NO fallback code - plugins MUST be loaded at extension activation
    - FileFactory.createIncludeDirect() for direct file creation
    - FileFactory.createInclude() uses plugins for context-based creation
  - FILES:
    - src/plugins/{interfaces,registry,import,export}/, PluginLoader.ts
    - src/files/IncludeFile.ts (unified, non-abstract)
    - REMOVED: src/files/{ColumnIncludeFile,TaskIncludeFile,RegularIncludeFile}.ts


- [x] COMPLETED: Draw.io & Excalidraw diagram integration
  - [x] Export-time SVG conversion for `.drawio`, `.dio`, `.excalidraw`, `.excalidraw.json`, `.excalidraw.svg` files
  - [x] DrawIOService.ts - CLI-based conversion using draw.io desktop app
  - [x] ExcalidrawService.ts - Library-based conversion with @excalidraw/excalidraw
  - [x] Extended DiagramPreprocessor to handle file-based diagram references
  - [x] Asset type detection updated in ExportService
  - [x] Webview preview rendering (markdownRenderer.js + messageHandler.ts)
  - [x] Added @excalidraw/excalidraw npm dependency to package.json
  - NOTE: Excalidraw library integration needs testing - may require puppeteer for server-side rendering
  - NOTE: Users must install draw.io CLI: `brew install --cask drawio` (macOS) or download from GitHub releases

- [ ] pressing delete when not in edit mode of a column-header, task-header or task-content but having some element selected, should delete the currently highlighted task.
Pressing enter should start editing the task.

- [x] can you add a speaker note function that makes lines after ;; to be speakernotes. the way speakernotes are displayed can be defined separately in the css. they should get a border with light oclors. also they might get exported with into different styles. For marp the speaker notes are exported as html comments "<!-- note -->. Also add how html comments are handled when exporting to marp (of course handle this separately from the speaker notes. ex: do NOT convert speakernotes to comments and then handle them according to the speaker note rules). By default they should be hidden by the post processor. make both of these multiple choise selection:
- Marp Notes:
  - Comment (<!-- -->)
  - Keep Style (;;)
  - Remove
- Html Comments:
  - Remove
  - Keep Style (<!-- -->)
- Html Content:
  - Keep Style (<>)
  - Remove
Integrate these into the exporter, with the default value being the first one. Save the last defined values for the next export.

- [x] Export Column in the column burger menu doesnt close the burger menu.
- [x] Copy as Markdown copies the full board, not the selected column or tasks content!

- [x] can you add a sidebar that lists all kanbans in the opened workspaces. it should only have one button to check all workspaces for markdown files with the yaml header element "kanban-plugin: board". the user might also drag&drop kanban board files into it. this files should be saved into the workspaces somehow, so when loading again i have a list of all kanbans in the workspaces.

- [x] when an image is dropped into vscode it can read and display it. but when i drop it into the kanban it can only create a link without the file path. would it somehow be possible to copy the file, suggest to the user to create a duplicate or similar so we have better external image handling?

- [x] might it be that the way a file is !!!included()!!! (different types of paths) has an influence on the tracking of changes?
the path might be of an included file:
- absolute to the filesystem
- relative to the include file (the included markdown file, if it's included)
- relative to the main file (main markdown file)
- relative to any of the opened workspaces  workspace1/folder/to/file.md

relative paths might start width:
- ./
- ../
- folder/
- or ..\ (for windows)
absolute paths start with:
- /
- C:


- the image include function should be updated so it can also include files relative to an included files path as priority, if the image is not found it should search for the images relative to the main markdown file. can this be included into the include handling process, so it rewrites the paths if an image is found relative to the include file, rather then the main file? it should allways write relative paths!

- [x] i still see %INCLUDE_BADGE:path/to/filename.md% in the column titles, THIS SHOULD NOT HAPPEN. We solved this problem before!!! make sure there is only one codepath that handles include columninclude and taskinclude (in column and task headers) . the include in the task content is implemented only in the frontend. But make sure it never passes any !!!include()!!! in a task or column header into the markdown renderer!!! . i think the %INCLUDE appears when the path starts with "../path/to/something", so a relative path in a folder above.

- [x] view focus should do some things which are currently only done when the kanban is opened.
  - reload all configuration and update menus. for example the active tag groups. or when default changes have been modified.
  - the keyboard shortcuts.
  all these configurations should not be loaded at any other time. verify this by checking the complete code for configuration or setting loading or api access.

- [x] we have additional shortcuts defined. which seem to open a buffer (a new view). which it closes automatically. we need to remove this feature and try to implement it using the default process, as it sometimes closes the wrong view. eighter it works with the default pasting or not.

- [x] the keyboard shortcuts that edit insert content using the vscode default shortcuts dont work anymore. can you verify the process that is currently running and suggest 3 solutions on solving it with a quality measurement. improve until you have 100% quality or near.

- [x] the column header is still broken when it contains an !!!include(filename.md)!!! there seem to be interfering system in the code. for example it does different displays on initial load and on updating the colums. maybe because the backend does something with the !!!include()!!! title as well?

- [x] when creating or editing tasks or after moving them sometimes the tasks cannot be edited again or the drag button doesnt work. we need to verify and unify how tasks are created, i assume we have multiple codepaths that create tasks in different was. for example the are quite reliable after unfolding. ultrathink . create 3 suggested solutions and rate theyr quality

- [x] if search finds the result in a column title, it should focus the column title, not the full column.

- [x] dragging is still sometimes extremely slow, how about we just   display the position it's dropped and dont preview the change with the actualy column or task moved? we can remove all height recalculation during drag events.

- [x] lets modify some of the directives. these settings should go into a burger menu, next to the filename in the file-info-header.
"""
theme 	Set a theme name for the slide deck ▶️
style 	Specify CSS for tweaking theme
headingDivider 	Specify heading divider option ▶️
size 	Choose the slide size preset provided by theme
math 	Choose a library to render math typesetting ▶️
title 	Set a title of the slide deck
author 	Set an author of the slide deck
description 	Set a description of the slide deck
keywords 	Set comma-separated keywords for the slide deck
url 	Set canonical URL for the slide deck (for HTML export)
image 	Set Open Graph image URL (for HTML export)
marp 	Set whether or not enable Marp feature in VS Code

paginate 	Show page number on the slide if set to true ▶️
header 	Specify the content of the slide header ▶️
footer 	Specify the content of the slide footer ▶️
class 	Set HTML class attribute for the slide element <section>
backgroundColor 	Set background-color style of the slide
backgroundImage  Set background-image style of the slide
backgroundPosition 	Set background-position style of the slide
backgroundRepeat 	Set background-repeat style of the slide
backgroundSize 	Set background-size style of the slide
color 	Set color style of the slide
"""
they can be written to the yaml header and must also be read from there when loading the kanban!

remove the marp theme and style from the column headers and task headers.



- [ ] Remove the "immediate" parameter from the boardUpdate function.
  We should never use the feature to mark something as unsaved, but use the hash to determine wether a file needs saving to file, because the file content is different to the saved content! Remove this feature and replace it by comparing the hashes from cache and files.
  saveBoardState should not need to update cache, but only save to the files. Because the cache must be kept actual all the time!
   So onWillSaveTextDocument is completely redundant and wrong!

- [ ] The shortcuts dont work properly anymore. Also the complex feature for translation does not work properly. The complexity it adds is not feasable. We could try again with the paste version which just pastes the replaced content, but using new files is too much.

- [ ] add a feature to add templates for marp styles. the user would be able to defined those, but a current list would be. Each can be toggled on or off.
  - _class stylings which are set as <!-- class: style --> . style can be
    - fontXX : where XX is a number. the list of fonts tags are in the section.fontXX in /Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/markdown-kanban-obsidian/marp-engine/themes/style-roboto-light.css
    - invert
    - center
    - no_wordbreak
    - highlight
    - column_spacing
    - column_border
    - fontbg
    more elements should be addable by the user in the configuration. as a string list.
  - check more styles from <https://github.com/marp-team/marp/blob/ffe6cd99/website/docs/guide/directives.md>
  - and the website: <https://deepwiki.com/marp-team/marp/3.4-theming-and-styling>


- [x] Can we make the sticky setting for headers (which is currently modified by the "sticky stack mode") individual for each column header, with a global sticky flag in the "file info bar". so each column gets a sticky flag (a pin icon). when the sticky flag is active, the header will stay on the screeen using the current layout settings.analyze the influence of the "sticky stack mode" on the kanban board. check if we can make each column have it's individual sticky setting . we still want the "sticky stack mode settings, but only "Full stack" and "Title only", the none feature is after this modification modified trough the "sticky flag"
  -> the sticky state can be saved into the kanban as #sticky, it should be
considered a layout tag that is filtered when displaying depending on the
setting, also when exporting it might get filtered! the default state should be
not sticky. the global setting is overriding the setting if it's pressed
normally (and not saved as individual setting), if alt+pressed it toggles all
states of each column and is saved to the files. place the icon right of the
column folding. make sure it's applied after the rendering in the process where
all the tags are processed, as the user might add it by text.

- [x] when adding multiple files using drag & drop it randomly places them over the board. why does that
  happen?

- [x] plan high-level cleanups. for this update the files in the agent folder first. then analyze the structure of the code. then analyze wether we could reasonably apply design patterns to optimize it and reduce changes of errors.
- [x] COMPLETED: PlantUML integration (LOCAL WASM)
  - [x] Renders ```plantuml code blocks as SVG diagrams using LOCAL WASM (no server!)
  - [x] Uses @sakirtemel/plantuml.js with CheerpJ for browser-based Java execution
  - [x] Convert to SVG button saves diagram and comments out code
  - [x] Files saved to Media-{markdown-filename}/ folder
  - [x] Complete offline rendering - NO network calls to plantuml.com
  - [x] SVG rendering via com.plantuml.wasm.v1.Svg Java class
  - [x] Package size: 4.2MB jar + 17MB jar.js (one-time load, then cached)

- [x] Add mermaid rendering into the kanban and the export!
- [ ] Could we add a feature that we could add full pdf files or individual pages from pdf files, where each page is a task?
  - the format would be something like ![](path/to/document.pdf p13)  for page 13 of the pdf.
  - best if you create a markdown-it plugin for it. as it should also work in the export.
- [x] COMPLETED: Simplified conflict detection using 3-variant structure
  - [x] Implemented hasAnyUnsavedChanges() method (checks 4 conditions)
  - [x] Simplified handleExternalChange() to just 2 decision paths
  - [x] Added JSON.stringify logging for better debugging
  - [x] VARIANT 1: ANY unsaved changes → show conflict dialog
  - [x] VARIANT 2: NO unsaved changes → auto-reload
  - [x] Prevents ALL data loss without user consent
  - [x] Works for main kanban and all include file types
  - [x] See: tmp/IMPLEMENTATION-SUMMARY.md, tmp/TEST-PLAN.md
- Add tags that parse numbers such as #1 #2 #13 and #04 #032 . They should be displayed as batches next to the column or task in a good contrast.

- Re-Analyze the full process of file change detection and caching, conflict checking and user response as well as saving the data in the different ways. then i save the main file externally with an unsaved internal change its overwriting the external file. BUT THERE ARE OTHER PROBLEMS AS WELL. I WANT A COMPLETE AND FULL ANALYSIS, USING AN UML STRUCTURE. THEN VERIFY EACH STEP WETHER ITS NEEDED AND IN ORDER. THEN MAKE 3 SUGGESTIONS HOW TO SOLVE EACH OF THE PROBLEMS, IF CONFIDENCE IN SOLVING THE PROBLEM IS NOT 100% ANALYZE AGAIN AND REPEAT UNTIL YOU ARE SURE THE PROBLEM IS PROPERLY SOLVED. WORK AUTOMATICALLY UNTIL I INTERRUPT YOU!!!

- [x] it seems as if the board is rendered twice when loading the board.


- it still behaves problematically if the user switches to edit the task-description by using tab after editing the task-header which has a taskinclude. when a include change is detected (after the backend has processed it), then stop the edit that is currently active. store the changes from the edit to cache, if there are changes detected between cache and file ask the user what to do with the data (conflict handling if conflict, save handling if unsaved). 

- [x] Include files and cache handling:

  If any change is saved to the kanban file, and included file in the kanban or the kanban-markdown file (the source) or any of the included files. Also when an column-title, task-title or task description is modified that contains an include (eigher trough text or using the menu).
  - make sure there is only one entry point, but allow entering the execution path at any main points as listed below.
  - if it's an external change, and the user is currently editing the kanban. end the edit, keeping the change. use this state as baseline.
  - verify if any of the include files that are switched or unloaded have any unsaved content, if so ask the user if he wants to save the changes before unloading/switching. Dont yet apply the new files to the includefiles.
  - unset the includefiles for the switched files and clear the cache in front and backend.
  - set the includefiles, load and update the cache in backend (and frontend?).
  - if any of the included files has changes: change the content in the frontend & backend for the included files.
  - if the main file has changes: switch the content of the main displayed file with the included files contents. (could be combined with the above step)
  - only update the contents that have been modified in the frontend.

  DO NOT SAVE TO THE FILE AT ANY POINT, EXCEPT WHEN THE USER SELECTS TO SAVE CHANGES INTO THE INCLUDED FILES. BUT STORE TO THE BASELINE AUTOMATICALLY IF THE MAIN FILE OR ANY INCLUDED FILES ARE MODIFYED.

  The Taskinclude, columninclude and regular include (include in task/column header or in task content):
  - shows the shortened !!!include(path/to/file.md)!!! as include(path/to/file.md) with all the tags and other content as a alt+clickable link.

- [x] ok i had to undo the changes. the state of the code was really worse then before. can you try to fix the include system only, without affecting the column and taskincludes? make it use similar approaches as the task/column in the regular include. also make sure the column and taskincludes show an empty content as soon as the included file is changed, so the user might not make any mistake edit while it's being changed. but it must still ask for unsaved changes before doing so!

- [x] Conflict tracking behaviour:
  - if the external file is modified and saved (a file modification is detected) and the kanban has saved or unsaved changes or is in edit mode. then the conflict manager must ask the user:
      - wether he wants to ignore the external changes (nothing happens, remember we still have unsaved changes in the kanban)
      - overwrite the external file with the kanban c$ontents (the kanban is then in an unedited state)
      - save the kanban as a backup file and reload the kanban from the external changes (original kanban is stored in a backup file, the external changes of the markdown are loaded into the kanban)
      - discard the changes in the kanban and reload from the external edit.
  - if the external file is modified and saved and the kanban has no saved or unsaved changes and is not in edit mode. the kanban can reload the modified data immediately.
  - if the kanban is modified and saved and the external file has unsaved changes and is later saved. we rely on the default change detection of vscode.
  
  do this for the main kanban file and each column include, task include and regular include files individually.

  include files:
  the include itself should be handled as if it would be a layout tag, when displaying it show a short title include(relative/path/to/markdown.md), when alt+clicking the filename, it should open the source file. the rest of the content with the !!!include()!!!is displayed as content for the line, for example tags can be added this way.
  - column includes use !!!include()!!! in a column header and parses a marp-presentation format as individual kanban-tasks for each slide (already implemented)
  - task includes use !!!include()!!! in a task header and includes the first line of the included file as the title.
  - regular includes use !!!include()!!! within a task description. they should be shown within a border area where a title line shows the include(filename.md) while in the markdown text it is defined as !!!include(included.md)!!!.
  - POSITION DETERMINES BEHAVIOR: ALL use !!!include()!!! - column header = column include, task title = task include, task description = regular include!

  ONLY THIS BEHAVIOUR. ALL OTHER BEHAVIOURS OR COMMENTS HOW IT WORKS ARE WRONG AND MUST BE MODIFIED OR REMOVED FROM THE CODE!!!

  ULTRATHINK THINK PLAN

- [x] test the different situatuons when files are included into the kanban using task includes (!!!include in task title) or column includes (!!!include in column header). they should ask to save when: - closing the kanban, - chaging to another include file. they should ask to load the external changes if it's changed externally, but first it should verify if there are unsaved changes. test it carefully make test situations that we can run again. it must be completely stable and exteremely reliablly tested, verified and made sure that no data is overwritten or lost during working with the kanban. ULTRATHINK THINK PLAN. take all the time you need to test it. VERIFY CAREFULLY. continue automatically if possible as long as you can!!!

- [x] currently if the markdown contains any html comment is displays them as is. can you make that an setting that can be changed in the main burger menu. new should also be that it can handle html contents that are embedded in the markdown. 

html comments should be:
- hidden (as it's handled by normal markdown renderer)
- rendered as normal text (as it currently is)

html content: anything that starts with <div or similar, but make sure not to accidentially handle <https://links.to/websites> should be:
- rendered as normal text (similar to html comments)
- rendered as html (whats usually happening in markdown rendering)

- [x] - the font color calculation (it detects wether it should be white or black) doesnt work properly in the dark mode. it seems not to take the right background color to calculate the font color. 
- also the styles for dark and light should allways be dynamically generated. it should only require to add a css value to change between light and dark mode. 

- [x] do we have an rewrite links, so when a file is referenced using a relative link, that we can rewrite the path relative to the new folder the file is exported into? this should be an alternative selection when exporting, to eighter pack the file or to rewrite file links.

- [x] why is there rewriteLinksForExport if processAssets changes it anyway?!?

- [x] it doesnt add the column stacks (the ones used to create new stacks when dropping columns on) in the second row or later. it only creates them on the first row. this gives us no gap inbetween the rows, and dropping into new rows is also impossible.

- [x] when copying as markdown it should only copy the object, that the function called. if can be the column or the task, but not the full kanban as it currently does!

- [x] it still convert this:
  """
  ## # Day 3 - World Scale 2
  - [ ] ## World Scale in Games
    Video game scale is weird
    
    ## h2
    
    The human scale is helpful, but video game spaces are not human. Video games often rely on an exaggerated sense of scale that does not correspond to any consistent real world measure. 
    
    <https://book.leveldesignbook.com/process/blockout/metrics#scale>
  """

  to this:
  """
  # Day 3 - World Scale 2

  ---

  ## World Scale in Games

  Video game scale is weird

  ---

  h2
  """

  the text is missing the link is gone and addiitonal --- are added where they should not be placed

  this would be correct:
  """
  # Day 3 - World Scale 2

  ---

  ## World Scale in Games

  Video game scale is weird

  ## h2

  The human scale is helpful, but video game spaces are not human. Video games often rely on an exaggerated sense of scale that does not correspond to any consistent real world measure. 

  <https://book.leveldesignbook.com/process/blockout/metrics#scale>
  """

  ultrathink plan think


- [x] when the user selects "auto export on save" or ("use marp" and "live preview") then the stop running button should be shown. when the stop button is pressed both activities should be stopped. The marp process must only be started once and be kept running in the background, DO NOT RESTART THE MARP PROCESS ON SAVE! . The auto export on save should be repeated using the same export settings until the stop button is pressed. 

  when the board is exported again it should first stop the running processes as if the stop button is pressed. 

  Maybe show a animated image that shows an active export or marp in the kanban header.

  Integrate the changes into the existing functions. DO NOT CREATE ALTERNATIVE CODE PATHS FOR THESE CHANGES!

  Ultrathink think ultrathink think plan

- [x] There are currently multiple export system functions. It must be unified to one new export system. The current structure is extremely broken as it's not unifying the processes properly.

  - What i need:
    - Presentation/Export Mode.
      - Export parts of the kanban as kanbanMarkdown.
      - All kanban can be combined into one main file (merge includes)
      - filter the tags according to the export settings
      - Export as Marp (html, pdf, pptx)
      - (optional) Export with everything included (pack files).
      - (optional) Rewrite the paths to the included files.
    
    - Export the kanban
      - Export with everything included (pack files)
      - Export keeping the structure.
      - Does not need partial export.

  - process flow:
    - unified export system
    - select the parts of the kanbanMarkdown we need to export
    - combine the contents into one datastream when merge includes is active.
    - filter the tags according to the export settings
    - create a list of media that has is included (if pack or rewrite is active) from the files in the kanbanMarkdown data.
      - if new files are detected in the data, copy and add them to the list
      - or add the rewritten path to the files.
    - rewrite the media paths according to the list of media files.
    - run marp until realtime is stopped.

  - functions we need:
    - column_to_presentationMarkdown
      - copy a column as markdown ( title, task-title & task-content, next task-title & task-content, repeated, combined using "---" )
      - can be used when copying column as markdown-presentation-format.
      - can also be used when exporting
      - can be used when exporting and converting using marp
      - updates the exported file when "auto_update on save" is active
    - run_marp
      - run marp to convert from presentationMarkdown to html, pdf, pptx
      - run marp in background and abort when realtime aborted.

  - reuse the existing functionalities such as the interface from the export.

  - completely remove the functions
    - handleGenerateCopyContent
    - handleUnifiedExport
    - handleExportWithMarp
    - handlePresentWithMarp
    - handleStartAutoExport

- [x] What are all the different ExportService.exportUnified usage for?
  - analyze where they are called from and determine what is unused, obsolete or still in use.

- [ ] analyze the functions in blocks, try to split it up into blocks consisting of lines of code from 3 to 15 lines of code (rather small then big). where each block has a limited number of input and output data. determine the input values, the way the data is processed, read or put on the interface as well as the output values. determine the order of blocks as well. write your observations into different files in the agent folder. in a later step we will try to find duplicate or obsolete code. start now with the analysis. analyze in depth and generalize using similar descriptions as in parts you already discovered.

- [ ] find functionality, functions, data, data structure and well as html structure duplicates in the code. first create lists of all these aspects in all the code files. structure it well to search for duplicates later on. be careful  to process all ts and js and html files in the src folder. Store the results into the agent folder.

- [x] is the ExportOptions in exportService.ts still in use? it seems obsolete. can you verify and remove it.

- [x] Create Preset for export:
  - Marp Presentation:
    - Export format: Convert to Presentation format
    - Merge Includes into Main File: Off
    - Tag Visibility: No Tags
    - Auto-export on save: On
    - Use Marp: On
      - Output Fomat: HTML
      - Style: (last selected style)
      - Browser: Chrome
      - Live Preview: On
    - Content to Export: default value is all, but user must costomize (remember last setting)
    - Export folder: _Export/{originalfilename}-{selectedelements}.md
    - Pack Assets into Export Folder: Off
  
  - Marp PDF:
    - Export format: Convert to Presentation format
    - Merge Includes into Main File: Off
    - Tag Visibility: No Tags
    - Auto-export on save: On
    - Use Marp: On
      - Output Fomat: PDF
      - Style: (last selected style)
      - Browser: Chrome
      - Live Preview: Off
    - Content to Export: default value is all, but user must costomize (remember last setting)
    - Export folder: _Export/{originalfilename}-{selectedelements}.md
    - Pack Assets into Export Folder: Off
  
  - Share Content:
    - Export format: Keep original format
    - Merge Includes into Main File: Off
    - Tag Visibility: All Tags
    - Use Marp: Off
    - Content to Export: default value is all, but user must costomize (remember last setting)
    - Export folder: _Full_Export_Date/{originalfilename}-{selectedelements}.md
    - Pack Assets into Export folder: On
      - Rewrite Links: On
      - Included Files: On
      - Images: On
      - Videos: On
      - Other Media: On
      - Documents: On
      - File size limit: 100mb

  put the presets at the top. when selecting a preset, set all values accordingly. the user might change the values afterwards. so the configuration must be defined by the individual values. if something is unclear, ask me.





- [x] Drag & Dropping in any row below the first one doesnt work.

- [x] Move the "Merge Includes into Main File" to be next to "Auto-export on save". Also set "Pack Assets into Export Folder" off by default.

- [x] Add Rewrite Links Rules into the "Pack Assets into Export Folder". It defines how links are changed to be correct for the exported file:
  - for absolute paths it doesnt change them.
  - for relative paths, depending on how the export folder is, fix it accordingly.


- [x] if i set 2 rows (or any number) and i "+ add column" in the second row, it places the new column in the first row. it also automatically reduces to the number of existing rows. this should not be modified without user intervention.

- [x] exclude tests and tmp from being included in the build, also the .folders and files dont need to go in there. verify what is required and minimize build size

- [x] consolidate the functions exportUnified, exportUnifiedV2 and exportWithMarp . 

- [x] currently the export format also includes different marp export solutions. however the export format is only the first stage of data presentation. the second would be the conversion with marp. so i want you to remove the marp export variants from the export format. 

add a checkbox "use marp" below that is available if the export format is "presentation format". within the use marp section:
- the 3 options from marp (html, pdf, powerpoint) should be in a new dropdown that is activated when marp is active, the "marp markdown" can be removed. 
- put the theme, the browser also in this submenu.
- the open in browser could be removed, but we should add a checkbox that adds "--preview" for "live preview"

move the "auto-export on save" to the main features (export format), as it should make sure that the export is repeated when the markdown or any included files are changed.

- [x] when opening as presentation with "open browser after export" it doesnt open a browser.


- [x] when the mouse cursor leaves the view during a drag&drop and reenters it doesnt keep drag&dropping anymore. can we solve this issue somehow and cleanly handle it? can we still receive mouse button releases outside the view?

- [x] when clicking "add column" it should allways create a new column in a new stack, dont do the same as when "insert list after" is clicked. also it seems that it sometimes puts the columns in other rows then where i create them. ultrathink

- [x] i get the error: "console.ts:137 [Extension Host] Cannot save: no document or invalid board (at console.<anonymous> (file:///Applications/Visual%20Studio%20Code.app/Contents/Resources/app/out/vs/workbench/api/node/extensionHostProcess.js:175:30205))" i think it happens after the board is reloaded
kanban-full-height-column:col-51d89dd3-bcfc-4156-bf6c-31acc496f45c
- [x] can you analyze the ability to export as pdf. maybe we could even integrate marp or require the marp plugin to be installed and use it to create different export formats from the kanban directly? the export feature does most of the preparation. do a tourough analysis before we start working on it.also we could integrate marp (maybe using the marp plugin in vscode). to directly start presentations from the kanban viewer? also the different export options of marp would be interesting. we would need to integrate the markdown-it plugins into the marp workflow. we could require the user to install marp and just deliver the engine.js and the node modules required. ultrathink think plan

- [x] add the auto export, it should keep an active export icon in the top, maybe a play/stop button which uses the last settings from export. when it's a one time export, it's just exporting again, but if it's a browser opening is play/stop.

- [x] when placing the cursor in an title of an card or and column, place the text cursor in front of the first tag + one space character. when adding #row{number} or #stack tags we should add a space in front of them if there isnt one (specifically applies to when it's the first characters in the title).

- [x] when i create a new card it seems to completely redraw the kanban. can you only update the changed parts without a complete redraw? also focus the added column or task when it's added.

- [x] tags still show with white text and i dont know where this happens. all text in the light mode should be black.

- [x] the time format is 2 hours off, i think you are using gmt which is not our local time format.

- [x] when exporting to presentation mode with "Merge Includes into Main File" the title of a task should not be separated into as a single slide in the export. Also dont remove ## from the lines.



- [x] can you analyze the ability to export as pdf. maybe we could even integrate marp or require the marp plugin to be installed and use it to create different export formats from the kanban directly? the export feature does most of the preparation. do a tourough analysis before we start working on it.

- [x] combine the title and the content while editing. when the columns is folded it only shows the title, while unfolded it shows the full content as markdown rendered style.
 
- [x] make the hidden html tag <!-- --> show up when it's used in the tasks content, title or column title. show it similar to the markers that show the style of elements. add an option to the main-burger menu that allows showing and hiding of the html-comments. make sure it's accessable from the layout presets.

- [x] can you make a concept for the tags and colors. One of the core aspects i want, is for designing teaching materials. 
- where each task is a slide on a topic. so the task may need to be improved, might be obsolete, might be more or less important, also think of other situations i might forget about right now.
- another usage case is for designing products such as games, user experience or software. add all relevant project states that might be used for columns. also add the possible states of each row, as well as for tasks that might be importancy. 

make the styles be equal. for example the tags that are meant for columns can have footers or headers, but in one category, each should eighter have eigher one, or not. also think about the colors, make more important aspects a bright and strong colors, less important things less colorful or bright. think about good colors and dark and light states as well.

all tags must be with # there is only dates and persons with the @-tag. also for the colors, make a dark, medium and light and a accessible color palette with at least 12 colors that are well dispersed on the visible color range. the accessible colors should be (#332288, #117733, #44AA99, #88CCEE, #DDCC77, #CC6677, #AA4499, #882255)

ultrathink think plan

add grays to the colors. ultrathink think and plan again to verify the usability on each process and suggest other aspects that might be useful.

create me the tag list with the colors, think about which ones are better suited for tasks/slides/todos vs categories/topics and assign the headers/footers/stickers and border colors accordingly! make good use of the categories

- [x] there should be 4 groups of colors. dark colors, normal colors, light colors that have 12 colors and a gray and accessible colors (#332288, #117733, #44AA99, #88CCEE, #DDCC77, #CC6677, #AA4499, #882255) make sure they still have dark and light styles as required in the 

- [x] sometimes i cant drop an column after the last column in a row into a stack, why? dont modify only research.
- [x] when adding a new column after a column in a stack, add #stack as default tag (add it to the stack below)

- [x] when exporting as "convert to presentation format" with "pack assets", without "merge includes into main file" and all selected, then it doesnt include regular include/column include/task include files that are in any other directories or subdirectories. fix it for all parameter combinations of exporting. make sure files with the same filename dont overwrite each other when coming from different folders. use indexes after the filename to make sure they are distinctive in the filename. reuse files that have the same content, verify it by using an md5 hash, for large files limit the md5 hash to the first megabyte. this code has been in the codebase before, maybe you can reuse it.

- [x] OPEN BUGS:
- files included with !!!include(root/include-2.md)!!! are not updated automatically when they are changed externally. it seems to work with a path that has ./ in front of it.
- files included with !!!include(./folder%20with%20space/include-1.md)!!! or !!!include(folder%20with%20space/include-2.md)!!! are not found/loaded.
- when drag & dropping a file from the explorer into the view the path to it is not url encoded. use the existing functions to url encode the path that are also used by the drag&drop source.
- when i edit the column title with a !!!include(markdown-presentation-b.md)!!! in the column header, the title should show the filename (markdown-presentation-b.md). this is correct after loading the file. but not after editing the title.
- when i edit a !!!taskinclude(filename.md)!!! it asks me if i want to overwrite, even if the file has not been externally modified. this should only be asked if the user did change the filename.md since we included the file. The same when switching the file for another !!!taskinclude(filename-b.md)!!! , it asks if i want to save my changes to the previously included file, even if the included parts has not been edited in the kanban.

- [x] currently an included markdown file (using !!!include in column header) detects a title of a task using the h7 format (#######). we must change this to use the first non-empty line within the first 3 lines after a slide break (---). remove the adding of H7 and replace it with the same logic, place the header of the task on the second line and have an empty one after that.

- [x] when exporting to kanban and using the "Merge Includes into Main File" then externally included files that are not in the markdown-kanban format (column includes or task includes) must be converted into the markdown-kanban format.

- [x] we need to unify the save, backup and export with all the features in all these versions.
- we need a third export format type:
  - keep file formats: does not change the output format
  - individual file format: choose an individual file format for all files which then allows
    - export all as kanban: converts all files to the markdown-kanban format (## columns, - [ ] tasks)
    - export all as presentation: all column headers are stored as separate slides, as well as the complete content (including the title) of a card.
- we want the kanban/row/stack/column selection to be integrated, but when saving and doing backups we just select the full board. only when exporting we only export parts. it should also work for situations where we only save individual files (for example included files or theyr backups).
- the pack feature is an additional feature that is not activated on normal saves, but allows rewriting the paths and copying the included and or linked files. this might also lead to another feature that allows copying or moving included content into a specific folder and rewriting the links in the file. 
- the tag visibility needs to be defineable when exporting, but usuallly is all tags when saving.
- the export/output folder definition for each file, which is usually the folder where they are loaded from.
- in this step we can also unify the title and description of the cards into one data structure. The display of the title is only for visualizing when folded, but is othervise not handled separately from the rest of the content.

we should be able to remove tons of individual usages of conversions etc. with this. think about what we can remove. analyze what we can remove and analyze everything that happens within that functions. create a file with the plan for this feature that we can continue to work on until we have a solid and sound idea. there should only be one place we use functions such as tasksToPresentations and all similar functions. Analyze for duplicate or similar code we can remove.

ultrathink, plan.

- [x] there should be an option that combines all the include files into one file and another one that allows exporting with the includes preserved. now for that to work i think the conversion to presentation format needs to happen after selecting the content to export and deciding which files they should go into. after that the conversion might be done, depending wether the original file format was the kanban-markdown format. if it already was an included presentation it does not need to be converted.

- [x] i encountered this error "webview.js?v=1759945056175:4383 Uncaught TypeError: Cannot read properties of null (reading 'value')
    at setColumnExportDefaultFolder (webview.js?v=1759945056175:4383:16)
    at webview.js?v=1759945056175:2633:13"


- [x] the export functionality should be unified. add a function to the export view that allows selecting which columns to export, structure it the same way as the columns are structured with rows, stacks and columns (but of course only show the titles.) where a user might select the full kanban, a row, a stack or a single column. add the option to select which format it should export "kanban" format exports it in the same format as the kanban has, "presentation" format converts it the same way as "copy as markdown does". the pack feature should be optional, so it might leave the links as they are, or the user might select to pack all or some (same selections as it currently has) of the assets into the export folder. the copy as markdown should also use the same function, just use the preset values such as the task, the column etc and presentation mode. ultrathink plan think ultraplan ultrathink
- [x] if i deselect a column from a active stack, the stack must be disabled as well, if i select all columns in a stack, also select the stack. likewise for the row, if a stack is deseleted (can also be because a deselected column), deselect the row, if all stacks are selected in a row, also activate the row. for the kanban do the same.

- [x] make the folder path line multiline if it's longer then the width of the field. use less spacing around the dialogue. make the dialogue use 80% of width and 80% of height. use less space around the options. put the tag visibility on the same line as the export format. make the export format use a dropdop as well.

- [x] move the presentation format and the tag style include settings above the column-selection view.


- [x] move the "export tags" from the file info burger menu to the export function so it's chosen individually when exporting something

- [x] remove the image fill mode and all code that is using it if it's not used for something else. preserve functionality that is outside the usage of the image scaling. """        "markdown-kanban.imageFill": {
          "type": "string",
          "default": "fit",
          "description": "Control how images are sized within cards",
          "enum": [
            "fit",
            "fill"
          ],
          "enumDescriptions": [
            "Images size to their natural dimensions",
            "Images fill available space while keeping aspect ratio"
          ]
        },""" 

- [x] Cleanup the configuration and the functions that use it. we currently have """        "markdown-kanban.stickyHeaders": {
          "type": "string",
          "default": "enabled",
          "description": "Control sticky positioning of column headers",
          "enum": [
            "enabled",
            "disabled"
          ],
          "enumDescriptions": [
            "Column headers stick to top when scrolling",
            "Column headers scroll normally with content"
          ]
        },
        "markdown-kanban.stickyStackMode": {
          "type": "string",
          "default": "titleonly",
          "description": "Control sticky positioning behavior in column stacks",
          "enum": [
            "full",
            "titleonly",
            "none"
          ],
          "enumDescriptions": [
            "Header, title, footer & margin all sticky (original behavior)",
            "Only title sticky (default)",
            "Nothing sticky in stacks"
          ]
        },""" 
	with the stickyStackMode the stickyHeaders are obsolete and can be removed. migrate all functions that are not a duplicate to the stickyStackMode.
	
- [x] cleanup the configuration and the functions that use it.  i think the """
        "markdown-kanban.showRowTags": {
          "type": "boolean",
          "default": false,
          "description": "Show row tags (#row2, #row3, #row4) in column headers"
        },
        "markdown-kanban.tagVisibility": {
          "type": "string",
          "default": "all",
          "description": "Control which types of tags are displayed on cards",
          "enum": [
            "all",
            "standard",
            "custom",
            "mentions",
            "none"
          ],
          "enumDescriptions": [
            "Show all tags including #span, #row, and @ tags",
            "Show all except #span and #row (includes @ tags)",
            "Show only custom tags (not configured ones) and @ tags",
            "Show only @ tags",
            "Hide all tags"
          ]
        },""" are doing the same thing, or rather showRowTags are obsolete.


- [x] in some situations it doesnt open a link i opened before. 
- [x] Failed to update stickyStackMode preference: CodeExpectedError: In Arbeitsbereichseinstellungen kann nicht geschrieben werden, weil markdown-kanban.stickyStackMode keine registrierte Konfiguration ist.
- [x] pressing alt on an image should open the file externally if it's found, othervise the replacement file search should be activated. but it currently doesnt. the code should be in the codebase already, but it currently doesnt seem to be active.
- [x] modifying a column title with a !!!include()!!! (column include - position-based) does not set the title correctly according to the rule: link to filename that is clickable included with the rest of the title and tags
- [x] when restoring kanban views all views restore one kanban file. not individual files they contained before.
- [x] move the corner-badges-container into the column-header div verify that all css is corrected for the new location. ultrathink
- [x] a horizontally folded column with a tag header doesnt add the tag above outside above, but overlaying above the normal header. this is one of the broken examples : TO ADD AN EXMAPLE
- [x] after i moved away a card from a column i cant fold it anymore.
- [x] lets make columns vertical folding working again. a column that is alone in a stack should by default fold as vertical. if there are multiple columns in a stack the folding should be horizontal. by pressing alt+fold-button the column switches between horizontal and vertical folding. all the functions and styles should be available already.
- [x] if i delete a task recalculate the full stacks heights reuse the existing function for that
- [x] make sure that in columns the "column-header.header-bars-container" contains the "header-bar" and "column-footer.footer-bars-container" contains the "footer-bar" in all circumstances.
- [x] disable the vertical column folding mode
- [x] the title when inserting a column include (!!!include in column header) should only show the filename included and the remainder of the contents. 
- [x] On start drag fix the tags of the source stack (where we took the column from). On end drag fix the tags of the destination stack (where we put the column)
- [x] Corrected Summary of Implementation:
CSS Changes:
- Grid overlay structure: All stacked columns overlay in single grid cell
- Full viewport height: Each column min-height: 100vh so sticky works across entire scroll
- Sticky headers: Position sticky at top with cumulative offsets (0px, 29px, 58px...)
- Sticky footers: Position sticky at bottom with cumulative offsets (58px, 29px, 0px...)
- Drag&drop compatible: All handlers preserved on original elements
JavaScript #stack Tag Logic:
- Drop between stacked columns or at the end → Adds #stack to dropped column
- Drop as first in stack → Removes #stack from dropped column, adds #stack to next column
- Drop outside stack → Removes #stack from dropped column
What the Implementation Does:
Stacked columns overlay in same grid position with full viewport height
Headers stick to top, footers stick to bottom
Content scrolls naturally as before
#stack tags automatically managed when dragging columns
- [x] When moving a task into a folded column while pressing alt, the column should not unfold as it usually does.
- [x] Columns that are in a "vertical stack" have a #stack tag or the next column has a #stack tag. Add a feature to make the columns fold horizontally, but keep the vertical folding function available. An column in a "vertical stack" stack should by default folds to horizontal folding state, a column in outside a stack should fold to vertical fold state. If <alt> is pressed while pressing the fold button again, the horizontal/vertical folding should switch. when pressing <alt> while it's unfolded, fold to the not-default-state. When <alt> is not pressed a folded column unfolds.

- [x] Export and pack of the kanban does not generate the default folder name it should export into (based on the filename of the main kanban file combined with the date-time like "YYYYMMDD-HHmm").

- [x] if multiple columns are in a vertical stack. can you make all the sticky headers to stick, eighter at the top or the bottom? so if 3 columns are above each other, allways show the headers of all columns. it's to be able to drop items into all rows at all the time.

- [x] vertically folded columns should allways be next to each other, even if they have the #stack tag.

- [x] it still converts this

"""
~~![image](https://file%2B.vscode-resource.vscode-cdn.net/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/markdown-kanban-obsidian/tests/foldeapace/image-512x512.png)~~
middle
~~![image](https://file%2B.vscode-resource.vscode-cdn.net/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/markdown-kanban-obsidian/tests/foldeapace/image-512x512.png)~~
third
~~![image](https://file%2B.vscode-resource.vscode-cdn.net/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/markdown-kanban-obsidian/tests/foldeapace/image-512x512.png)~~
  ![image](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/markdown-kanban-obsidian/tests/folder%20with%20space/image-512x512.png)
"""

to this

"""
~~~~![image](https://file%2B.vscode-resource.vscode-cdn.net/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/markdown-kanban-obsidian/tests/foldeapace/image-512x512.png)~~ ![image](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/markdown-kanban-obsidian/tests/folder%20with%20space/image-512x512.png)~~
middle
~~~~![image](https://file%2B.vscode-resource.vscode-cdn.net/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/markdown-kanban-obsidian/tests/foldeapace/image-512x512.png)~~ ![image](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/markdown-kanban-obsidian/tests/folder%20with%20space/image-512x512.png)~~
third
~~~~![image](https://file%2B.vscode-resource.vscode-cdn.net/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/markdown-kanban-obsidian/tests/foldeapace/image-512x512.png)~~ ![image](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/markdown-kanban-obsidian/tests/folder%20with%20space/image-512x512.png)~~
  ![image](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/markdown-kanban-obsidian/tests/folder%20with%20space/image-512x512.png)
"""

when i try to fix the first broken link. it should only modify the first link when i search for the corrected file and replace the original (already striked trough) link to

"""
~~~~![image](https://file%2B.vscode-resource.vscode-cdn.net/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/markdown-kanban-obsidian/tests/foldeapace/image-512x512.png)~~~~
"""

but!

this breaks the rendering. so even better would be to have an already striked trough link remain striked trough. add the corrected link after without strike-trough. and add a style to the strike-trough so a broken image or media is also striked trough in the rendered content. Is this possible? ULTRATHINK ULTRATHINK

- [ ] when searching and replacing replacement text, the striketrough is not
  properly placed. there are multiple types of links that must be properly
  striked-trough and the alternative path must be added in the same
  style. the types of links may be: ![]() -> ~~![]()~~ , []() -> ~~[]()~~
  , <> -> ~~<>~~ or [[]] -> ~~[[]]~~ maybe there is others i dont know of.
  currently i think the stiketrough does not take the minimum sized item
  according to the above rules, but sometimes takes a larger area that is
  striked trough.ß

- [ ] add an option to the export as in which style to export. it can be eigher kanbanstyle (does not modify the style, copies the markdown as in the original markdown) or it can be presentation style (which uses the same method as when copying the columns and cards as markdown.)
- the copy as markdown will allways use presentation mode
- the export functionality of tasks and columns gets a dropdown selection with "presentation" and "kanbanstyle"

- [x] Failed to create backup: TypeError: Cannot read properties of undefined (reading 'getText')
	at BackupManager.createBackup (/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/markdown-kanban-obsidian/dist/extension.js:8513:32)
	at MessageHandler.handlePageHiddenWithUnsavedChanges (/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/markdown-kanban-obsidian/dist/extension.js:7344:42)
	at MessageHandler.handleMessage (/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/markdown-kanban-obsidian/dist/extension.js:6782:20)
	at Ah.value (/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/markdown-kanban-obsidian/dist/extension.js:9935:38)
	at D.B (file:///Applications/Visual%20Studio%20Code.app/Contents/Resources/app/out/vs/workbench/api/node/extensionHostProcess.js:27:2375)
	at D.fire (file:///Applications/Visual%20Studio%20Code.app/Contents/Resources/app/out/vs/workbench/api/node/extensionHostProcess.js:27:2593)
	at wB.$onMessage (file:///Applications/Visual%20Studio%20Code.app/Contents/Resources/app/out/vs/workbench/api/node/extensionHostProcess.js:135:95573)
	at i4.S (file:///Applications/Visual%20Studio%20Code.app/Contents/Resources/app/out/vs/workbench/api/node/extensionHostProcess.js:29:115936)
	at i4.Q (file:///Applications/Visual%20Studio%20Code.app/Contents/Resources/app/out/vs/workbench/api/node/extensionHostProcess.js:29:115716)
	at i4.M (file:///Applications/Visual%20Studio%20Code.app/Contents/Resources/app/out/vs/workbench/api/node/extensionHostProcess.js:29:114805)
	at i4.L (file:///Applications/Visual%20Studio%20Code.app/Contents/Resources/app/out/vs/workbench/api/node/extensionHostProcess.js:29:114043)
	at Ah.value (file:///Applications/Visual%20Studio%20Code.app/Contents/Resources/app/out/vs/workbench/api/node/extensionHostProcess.js:29:112707)
	at D.B (file:///Applications/Visual%20Studio%20Code.app/Contents/Resources/app/out/vs/workbench/api/node/extensionHostProcess.js:27:2375)
	at D.fire (file:///Applications/Visual%20Studio%20Code.app/Contents/Resources/app/out/vs/workbench/api/node/extensionHostProcess.js:27:2593)
	at Jn.fire (file:///Applications/Visual%20Studio%20Code.app/Contents/Resources/app/out/vs/workbench/api/node/extensionHostProcess.js:29:9459)
	at Ah.value (file:///Applications/Visual%20Studio%20Code.app/Contents/Resources/app/out/vs/workbench/api/node/extensionHostProcess.js:197:3917)
	at D.B (file:///Applications/Visual%20Studio%20Code.app/Contents/Resources/app/out/vs/workbench/api/node/extensionHostProcess.js:27:2375)
	at D.fire (file:///Applications/Visual%20Studio%20Code.app/Contents/Resources/app/out/vs/workbench/api/node/extensionHostProcess.js:27:2593)
	at Jn.fire (file:///Applications/Visual%20Studio%20Code.app/Contents/Resources/app/out/vs/workbench/api/node/extensionHostProcess.js:29:9459)
	at MessagePortMain.<anonymous> (file:///Applications/Visual%20Studio%20Code.app/Contents/Resources/app/out/vs/workbench/api/node/extensionHostProcess.js:197:2209)
	at MessagePortMain.emit (node:events:518:28)
	at MessagePortMain._internalPort.emit (node:electron/js2c/utility_init:2:2949)
	at Object.callbackTrampoline (node:internal/async_hooks:130:17) (at console.<anonymous> (file:///Applications/Visual%20Studio%20Code.app/Contents/Resources/app/out/vs/workbench/api/node/extensionHostProcess.js:175:30205))

- [x] the addon that delets a text which is strike-trough (between two ~~) converts the remaining contents to html, instead of leaving it as markdown. this is very wrong 
ultrathink
- [x] the plugin that generates class multicolumn by adding "---:", ":--:", ":---" sometimes generates the same content twice. can you find a reason why? ultrathink ultrathink ultrathink ultrathink 

- [x] i dont see any reason, but after some time the kanban just closes. maybe this has something to do with it? """console.ts:137 [Extension Host] deleteChain called from files/closed (at console.<anonymous> (file:///Applications/Visual%20Studio%20Code.app/Contents/Resources/app/out/vs/workbench/api/node/extensionHostProcess.js:175:30205))"""

- [x] bug that closes the kanban: "runtime-tracker.js:360 Failed to save runtime report to localStorage: QuotaExceededError: Failed to execute 'setItem' on 'Storage': Setting the value of 'runtimeReport_session_1758956943015_6drhykryu' exceeded the quota.
    at RuntimeTracker.saveReport (runtime-tracker.js:358:26)
    at runtime-tracker.js:84:22"

- [x] conflict tracking behaviour:
- if the external file is modified and saved (a file modification is detected) and the kanban has saved or unsaved changes or is in edit mode:
	- the conflict manager must ask the user wether he wants to (default) ignore the external changes (nothing happens, remember we still have unsaved changes in the kanban)
	- overwrite the external file with the kanban contents (the kanban is then in an unedited state)
	- save the kanban as a backup file and reload the kanban from the external changes (original kanban is stored in a backup file, the external changes of the markdown are loaded into the kanban)
	- discard the changes in the kanban and reload from the external edit.
- if the external file is modified and saved and the kanban has no saved or unsaved changes and is not in edit mode. the kanban can reload the modified data immediately.
- if the kanban is modified and saved and the external file has unsaved changes and is later saved. we rely on the default change detection of vscode.
do this for the kanban and each column and task included files individually..


- [x] add an option to the export as in which style to export. it can be eigher kanbanstyle (does not modify the style) or it can be presentation style (which uses the same method as when copying the columns and cards as markdown.
- [x] OBSOLETE, WRONG ASSUMPTION. 1. Clicking on the task description to edit it: 2. Changing the text from !!!include(./markdown-include-2.md)!!! to something like   !!!include(. markdown-include-1.md)!!! 3. stop editing the field. - should result in an modfied included content. but does not. Instead it shows Loading: newfilename.md forever. i think the backend is missing an editTaskDescription that handles the contents similar to the editTaskTitle which checks for includes and handles it there. or where does that happen?
- ok, i did an error. the !!!include()!!! must be run in the frontend only, as it's genearted with the markdown-ti. i undid all changes. try to get it running again with in this style.
- [x] EditTask message is send when the view looses focus afaik. but it should be sent when the edit of a task ends. can you verify and fix that?
- [x] if a broken file link search has a url encoding (it contains a %) try decoding using url encoding before searching for it. only if it's a valid decoding search for it.


## General work order

Create a file FUNCTIONS.md that keeps track of all functions in files in front and backend. Each functions is described as: 
- path_to_filename-classname_functionname or -functionname when it's not in a class.
- a description of the functionality in 1 or 2 lines of keywords or sentences.

Implmement the requested features according to the request. Keep changes small. Suggest DRY cleanups if you find functions get similar functionality. Before creating a new functionality or creating larger code parts allways consult the FUNCTIONS.md. Never modify the save data without the users permission. After modifying the code update the FUNCTIONS.md according to the rules:
Each functions is described as: 
- path_to_filename-classname_functionname or -functionname when it's not in a class.
- a description of the functionality in 1 or 2 lines of keywords or sentences.