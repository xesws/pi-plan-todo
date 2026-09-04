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

1. `/plan` until `plan_mode_complete`.
2. **Implement here** or `/plan implement`.
3. First implementation turn should call `todo_write`. A Todo widget appears above the editor.
4. `ctrl+t` or `/todos` expands/collapses. `/todos clear` empties the list.

`ctrl+t` is captured for the widget (Pi’s thinking-fold binding is consumed). Thinking stays visible by default.

## Commands

| Command | Action |
| --- | --- |
| `/todos` | Expand / collapse the widget |
| `/todos clear` | Clear the list |

## How it works

- **`todo_write`** — full-list replace. Items are `{ id, content, status, activeForm? }` with `pending | in_progress | completed`. At most one `in_progress`. Session truth is the last successful tool result `details.todos`.
- **Widget** — `ctx.ui.setWidget(..., { placement: "aboveEditor" })`. Collapsed to ~5 rows.
- **Plan hook** — detects pi-plan-mode Implement handoff (`Implement the plan.`, the long “Plan mode is now disabled…” prompt, or `plan-mode-state.activeImplementation`). Steers the model (system prompt + handoff transform) until the first successful `todo_write`. Does not parse plan markdown. Plan mode still blocks this extension tool while planning.

## Notes

- Does not patch Pi core, `pi-plan-mode`, or `pi-tasks`.
- If `pi-tasks` is also installed, two above-editor widgets can stack. Prompt guidelines tell the model not to open `task_plan` for the same work unless you ask for that contract.

## License

MIT
