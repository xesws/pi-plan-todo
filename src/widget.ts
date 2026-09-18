import {
	COLLAPSED_LIMIT,
	NOTEPAD_COLLAPSED_LIMIT,
	NOTEPAD_SHORTCUT,
	SHORTCUT,
	type NotepadItem,
	type TodoItem,
} from "./schema.ts";

export interface WidgetTheme {
	fg(color: string, text: string): string;
	bold(text: string): string;
	strikethrough(text: string): string;
}

export interface VisibleSlice {
	visible: TodoItem[];
	hidden: number;
	hiddenPending: number;
	start: number;
}

export function selectVisibleTodos(
	todos: TodoItem[],
	expanded: boolean,
	limit = COLLAPSED_LIMIT,
): VisibleSlice {
	if (expanded || todos.length <= limit) {
		return { visible: todos, hidden: 0, hiddenPending: 0, start: 0 };
	}

	const focusIndex = todos.findIndex((todo) => todo.status === "in_progress");
	const pendingIndex = todos.findIndex((todo) => todo.status === "pending");
	const anchor = focusIndex >= 0 ? focusIndex : pendingIndex >= 0 ? pendingIndex : 0;

	let start = Math.max(0, anchor - 1);
	if (start + limit > todos.length) start = Math.max(0, todos.length - limit);
	const visible = todos.slice(start, start + limit);
	const visibleIds = new Set(visible.map((todo) => todo.id));
	const hiddenItems = todos.filter((todo) => !visibleIds.has(todo.id));
	return {
		visible,
		hidden: hiddenItems.length,
		hiddenPending: hiddenItems.filter((todo) => todo.status === "pending").length,
		start,
	};
}

export function formatWidgetLines(
	theme: WidgetTheme,
	todos: TodoItem[],
	expanded: boolean,
): string[] {
	if (todos.length === 0) return [];

	const slice = selectVisibleTodos(todos, expanded);
	const lines = [theme.bold(theme.fg("accent", "Todo"))];
	for (const todo of slice.visible) {
		lines.push(formatTodoLine(theme, todo));
	}
	if (!expanded && slice.hidden > 0) {
		lines.push(
			theme.fg(
				"dim",
				`… +${slice.hidden} more (${slice.hiddenPending} pending) · ${SHORTCUT} to expand`,
			),
		);
	} else if (expanded && todos.length > COLLAPSED_LIMIT) {
		lines.push(theme.fg("dim", `${SHORTCUT} to collapse`));
	}
	return lines;
}

export function formatTodoLine(theme: WidgetTheme, todo: TodoItem): string {
	if (todo.status === "completed") {
		return `${theme.fg("success", "✓")} ${theme.fg("muted", theme.strikethrough(todo.content))}`;
	}
	if (todo.status === "in_progress") {
		const label = todo.activeForm?.trim() || todo.content;
		return `${theme.fg("accent", "●")} ${theme.fg("accent", label)}`;
	}
	return `${theme.fg("dim", "○")} ${todo.content}`;
}

export function formatCollapsedMore(todos: TodoItem[], expanded: boolean): string | undefined {
	const slice = selectVisibleTodos(todos, expanded);
	if (expanded || slice.hidden === 0) return undefined;
	return `… +${slice.hidden} more (${slice.hiddenPending} pending)`;
}

/* ---------------- Notepad widget (grouped by topic) ---------------- */

export interface NotepadVisible {
	visible: NotepadItem[];
	hiddenOpen: number;
	archived: number;
}

/** Active view shows `open` only; expanded reveals archived `resolved` too. */
export function selectVisibleNotepads(
	notepads: NotepadItem[],
	expanded: boolean,
	limit = NOTEPAD_COLLAPSED_LIMIT,
): NotepadVisible {
	const open = notepads.filter((n) => n.status === "open");
	const archived = notepads.length - open.length;
	if (expanded) return { visible: notepads, hiddenOpen: 0, archived };
	return {
		visible: open.slice(0, limit),
		hiddenOpen: Math.max(0, open.length - limit),
		archived,
	};
}

export function formatTopicTag(item: Pick<NotepadItem, "topic" | "partitionKey" | "priority">): string {
	const base = item.partitionKey ? `${item.topic}:${item.partitionKey}` : item.topic;
	return item.priority === "medium" ? base : `${base}(${item.priority})`;
}

export function formatNotepadLine(theme: WidgetTheme, note: NotepadItem): string {
	const tag = formatTopicTag(note);
	if (note.status === "resolved") {
		const suffix = note.designDoc ? ` → ${note.designDoc}` : "";
		return `${theme.fg("success", "✓")} ${theme.fg("muted", theme.strikethrough(`[${tag}] ${note.content}${suffix}`))}`;
	}
	return `${theme.fg("dim", "○")} [${tag}] ${note.content}`;
}

export function formatNotepadLines(
	theme: WidgetTheme,
	notepads: NotepadItem[],
	expanded: boolean,
	badge?: string,
): string[] {
	if (notepads.length === 0) return [];
	const sel = selectVisibleNotepads(notepads, expanded);
	const title = badge ? `Notepad ${badge}` : "Notepad";
	const lines = [theme.bold(theme.fg("accent", title))];
	let lastTopic = "";
	for (const note of sel.visible) {
		if (expanded && note.topic !== lastTopic) {
			lines.push(theme.fg("dim", `─ ${note.topic} ─`));
			lastTopic = note.topic;
		}
		lines.push(formatNotepadLine(theme, note));
	}
	if (!expanded && (sel.hiddenOpen > 0 || sel.archived > 0)) {
		const bits: string[] = [];
		if (sel.hiddenOpen > 0) bits.push(`+${sel.hiddenOpen} open`);
		if (sel.archived > 0) bits.push(`${sel.archived} archived`);
		lines.push(theme.fg("dim", `… ${bits.join(" · ")} · ${NOTEPAD_SHORTCUT} to expand`));
	} else if (expanded && notepads.length > NOTEPAD_COLLAPSED_LIMIT) {
		lines.push(theme.fg("dim", `${NOTEPAD_SHORTCUT} to collapse`));
	}
	return lines;
}

