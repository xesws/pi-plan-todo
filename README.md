# pi-plan-todo

Kimi/Claude-style sticky Todo widget for [Pi](https://pi.dev). After you approve a `/plan` and hit **Implement**, the model writes a structured list with `todo_write`, and Pi pins ✓ / ● / ○ above the editor instead of dumping the list into chat.

Works with [`@narumitw/pi-plan-mode`](https://www.npmjs.com/package/@narumitw/pi-plan-mode). It does **not** replace `/plan`.

## Install

Requires [Pi](https://pi.dev) and, for the Plan → Implement hook, `pi-plan-mode`:

```bash
pi install npm:@narumitw/pi-plan-mode
pi install git:github.com/xesws/pi-plan-todo
```

Try without installing:

```bash
pi -e git:github.com/xesws/pi-plan-todo
```

Then `/reload` (or restart Pi) so shortcuts load.

## Usage

### Discussion mode (`/discuss`)

Sits between do-mode and Plan Mode: diverge and curate the Notepad with the agent before converging.

- `/discuss` toggles, `/discuss start` enters, `/discuss stop` exits. Entering auto-expands Notepad (restored on exit) and shows a `Notepad [discussing]` badge.
- While active, every turn injects discussion rules: reference the Notepad, add-first-discuss-later, split vague notes by `partitionKey`, resolve only with `designDoc`, and suggest `/discuss stop` → `/plan` once topics are resolved.
- Hard blocks: `edit` / `write` / `bash` / `powershell` / `todo_write` / `notepad_promote`. Reads, search and `notepad_add/update/remove` stay open.
- Flow: `/discuss` → discuss → `/discuss stop` → `/plan` → approve → auto Implement (do-mode).
- Forgetting `/discuss stop` before `/plan` auto-closes discussion (no content handoff — read the Notepad yourself).

### Divergent discussion (Notepad)

Before there is a converged todo list, stash ideas as you talk:

- `notepad_add { content, topic, partitionKey?, priority? }` — e.g. topic `RAG`, `load-test`
- `notepad_update { id, status: "resolved", designDoc }` — mark discussed once it lands in a design doc
- `notepad_remove { ids }` — drop abandoned ideas

A Notepad widget appears alongside Todo. `ctrl+n` or `/notepad` expands/collapses. `/notepad clear` empties it. Active view shows `open` only; `resolved` stays as archived history (visible when expanded).

Tip: allow `notepad_add/update/remove` in Plan-mode policy via `/plan tools` so divergent discussion can stash notes while planning. Keep `todo_write` / `notepad_promote` blocked until Implement.

### Converged execution (Todo)

1. `/plan` until `plan_mode_complete`.
2. **Implement here** or `/plan implement`.
3. First implementation turn calls `todo_write` — or `notepad_promote` when continuing from Notepad (by `ids` in order, or `topics`/`partitionKeys` batch, `mode: append|replace`). A Todo widget appears above the editor.
4. `ctrl+t` or `/todos` expands/collapses. `/todos clear` empties the list.

`ctrl+t` is captured for the widget (Pi’s thinking-fold binding is consumed). Thinking stays visible by default.

## Commands

| Command | Action |
| --- | --- |
| `/todos` | Expand / collapse the Todo widget |
| `/todos clear` | Clear the todo list |
| `/notepad` | Expand / collapse the Notepad widget |
| `/notepad clear` | Clear the notepad |
| `/discuss` | Toggle discussion mode (auto-expands Notepad) |
| `/discuss stop` | Exit discussion mode |

Shortcuts: `ctrl+t` Todo, `ctrl+n` Notepad (`ctrl+alt+t` / `ctrl+alt+n` via `registerShortcut`).

## How it works

- **`todo_write`** — full-list replace. Items are `{ id, content, status, activeForm? }` with `pending | in_progress | completed`. At most one `in_progress`. Session truth is the last successful tool result `details.todos`.
- **`notepad_add / notepad_update / notepad_remove`** — granular queue ops. Items are `{ id, content, topic, partitionKey?, priority: low|medium|high, status: open|resolved, designDoc?, createdAt, updatedAt }`. `resolved` requires `designDoc`. Session truth is the last successful `details.notepads`.
- **`notepad_promote { ids? | topics?/partitionKeys?, onlyResolved=true, mode=append|replace, todos? }`** — agent-driven pop: validates resolved+designDoc, writes todos (auto-convert or replanned `todos` override), keeps notepad copies as archive. Result `details` carries both `todos` and `notepads` so branch reconstruction stays correct.
- **Widgets** — two independent `aboveEditor` widgets (`pi-plan-todo`, `pi-plan-notepad`), each with own collapse state. Todo collapsed to ~5 rows, Notepad to ~6 open notes.
- **Plan hook** — detects pi-plan-mode Implement handoff (`Implement the plan.`, the long “Plan mode is now disabled…” prompt, or `plan-mode-state.activeImplementation`). Steers the model (system prompt + handoff transform) until the first successful `todo_write`. Does not parse plan markdown. Plan mode still blocks this extension tool while planning.

## Notes

- Does not patch Pi core, `pi-plan-mode`, or `pi-tasks`.
- If `pi-tasks` is also installed, two above-editor widgets can stack. Prompt guidelines tell the model not to open `task_plan` for the same work unless you ask for that contract.

## License

MIT
