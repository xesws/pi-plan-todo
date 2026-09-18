import { Text } from "@earendil-works/pi-tui";
import { countByStatus, summarizeNotepads, type NotepadItem, type TodoItem } from "./schema.ts";
import {
	formatNotepadLine,
	formatTodoLine,
	selectVisibleNotepads,
	selectVisibleTodos,
	type WidgetTheme,
} from "./widget.ts";

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

export function renderNotepadCallText(theme: WidgetTheme, action: string, count: number): string {
	const title = theme.fg("toolTitle", theme.bold("Notepad"));
	return `${title} ${theme.fg("muted", `${action}${count > 0 ? ` (${count})` : ""}`)}`;
}

export function renderNotepadResultText(theme: WidgetTheme, notepads: NotepadItem[]): string {
	if (notepads.length === 0) return theme.fg("dim", "No notes");
	return summarizeNotepads(notepads);
}

export function renderNotepadCallComponent(theme: WidgetTheme, action: string, count: number): Text {
	return new Text(renderNotepadCallText(theme, action, count), 0, 0);
}

export function renderNotepadResultComponent(theme: WidgetTheme, notepads: NotepadItem[]): Text {
	return new Text(renderNotepadResultText(theme, notepads), 0, 0);
}

export function renderPromoteCallText(
	theme: WidgetTheme,
	selected: NotepadItem[],
	mode: string,
): string {
	const title = theme.fg("toolTitle", theme.bold("Promote"));
	return `${title} ${theme.fg("muted", `${selected.length} notes → todos (${mode})`)}`;
}

export function renderPromoteResultText(
	theme: WidgetTheme,
	notepads: NotepadItem[],
	todos: TodoItem[],
): string {
	const sel = selectVisibleNotepads(notepads, false);
	const lines = [
		`${summarizeNotepads(notepads)} · ${todos.length} todos`,
		...sel.visible.slice(0, 5).map((n) => formatNotepadLine(theme, n)),
	];
	return lines.join("\n");
}
