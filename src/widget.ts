import { COLLAPSED_LIMIT, SHORTCUT, type TodoItem } from "./schema.ts";

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

