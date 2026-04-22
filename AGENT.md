When getting instructions adhere to this top priority rulesets:
- User inputs have the highest priority
- The second highes priority are written down in the AGENT.md files. If they strongly contradict the user request ask the user again if he really meant what he said.
- the Specifications given for the project have the next priority. If they contradict the user request you shoud discuss with the user if you should first adjust the specifications.
- lastly source code comments have also a role in the specifications, they should not contradict the specifications. if they do, fix them.

When solving problems or crashes, allways try to solve them at the source, strongly avoid adding alternative code paths, ignoring them ect!

Read enough informations so you can do you job well! If you dont know enougth to do a job properly, then inform the user or suggest alternatives. Do not break things by not being able to do a job properly!

after implementing a feature, verify that a frontend test (run from the frontend tests) is verifying it properly. run the test and verify the functionality. when implementing a test try to test it as close to the user interaction as possible. what does the user see, what does he use to modify it, what it the visible outcome of the modification.

Do not use the "rm" command. Move things you want to delete to the trash!

Do not change branches or anything else without my explicit request. We typically have mutliple agents running.

---

Version 2 is in the folders:
- packages/agent
- lexera-core
- lexera-backend
- lexera-kanban
- lexera-capture-ios
- lexera-shared
- lexera-web-clipper
- packages/shared

Both version share (version 1 and 2)
- packages/marp-engine

We are working on Version 2.

---

Read the index of `packages/agent/specs` for the application specifications. When working on anything in V2, read the files that are connected to the task and prefer the promoted top-level Lexera directories over historical `packages/lexera-*` paths.

Version 1 is in the folders:
- _ARCHIVE/agent
- _ARCHIVE/src
- _ARCHIVE/packages/ludos-sync
- _ARCHIVE/packages/ludos-sync-menubar
- _ARCHIVE/packages/ludos-dashboard

only read the agent document assigned to you:
- if you are claude code read @AGENT-claude.md
- if you are openai / codex read @AGENT-openai.md
- if you are any other agent read @AGENT-claude.md
