import { Text } from "@earendil-works/pi-tui";
import { countByStatus, type TodoItem } from "./schema.ts";
import { formatTodoLine, selectVisibleTodos, type WidgetTheme } from "./widget.ts";

export function renderCallText(theme: WidgetTheme, todos: TodoItem[] | undefined): string {
	const list = Array.isArray(todos) ? todos : [];
	const { completed } = countByStatus(list);
	const title = theme.fg("toolTitle", theme.bold("Todo"));
	if (list.length === 0) return `${title} ${theme.fg("muted", "clear")}`;
	return `${title} ${theme.fg("muted", `${completed}/${list.length}`)}`;
}

export function renderResultText(
	theme: WidgetTheme,
	todos: TodoItem[],
	expanded: boolean,
): string {
	if (todos.length === 0) return theme.fg("dim", "No todos");
	const slice = selectVisibleTodos(todos, expanded);
	const lines = slice.visible.map((todo) => formatTodoLine(theme, todo));
	if (!expanded && slice.hidden > 0) {
		lines.push(theme.fg("dim", `… ${slice.hidden} more`));
	}
	return lines.join("\n");
}

export function renderCallComponent(theme: WidgetTheme, todos: TodoItem[] | undefined): Text {
	return new Text(renderCallText(theme, todos), 0, 0);
}

export function renderResultComponent(
	theme: WidgetTheme,
	todos: TodoItem[],
	expanded: boolean,
): Text {
	return new Text(renderResultText(theme, todos, expanded), 0, 0);
}
