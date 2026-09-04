export const TOOL_NAME = "todo_write";
export const WIDGET_ID = "pi-plan-todo";
export const HOOK_ENTRY_TYPE = "pi-plan-todo:hook";
export const STATE_ENTRY_TYPE = "pi-plan-todo:state";
export const HOOK_MESSAGE_TYPE = "pi-plan-todo-context";
export const COLLAPSED_LIMIT = 5;
/** Stolen from app.thinking.toggle via onTerminalInput consume. */
export const SHORTCUT = "ctrl+t";
/** Extra registerShortcut bindings that are not reserved. */
export const SHORTCUTS = ["ctrl+alt+t"] as const;

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
	id: string;
	content: string;
	status: TodoStatus;
	activeForm?: string;
}

export interface TodoDetails {
	todos: TodoItem[];
	updatedAt: number;
}

const STATUSES = new Set<TodoStatus>(["pending", "in_progress", "completed"]);

export function isTodoStatus(value: unknown): value is TodoStatus {
	return typeof value === "string" && STATUSES.has(value as TodoStatus);
}

export function validateTodos(todos: unknown): TodoItem[] {
	if (!Array.isArray(todos)) {
		throw new Error("todo_write: todos must be an array");
	}

	const ids = new Set<string>();
	let inProgress = 0;
	const normalized: TodoItem[] = [];

	for (const raw of todos) {
		if (!raw || typeof raw !== "object") {
			throw new Error("todo_write: each todo must be an object");
		}
		const item = raw as Partial<TodoItem>;
		const id = typeof item.id === "string" ? item.id.trim() : "";
		const content = typeof item.content === "string" ? item.content.trim() : "";
		if (!id) {
			throw new Error("todo_write: each todo id must be a non-empty string");
		}
		if (!content) {
			throw new Error(`todo_write: todo '${id}' content must be non-empty`);
		}
		if (ids.has(id)) {
			throw new Error(`todo_write: duplicate id '${id}'`);
		}
		if (!isTodoStatus(item.status)) {
			throw new Error(`todo_write: todo '${id}' has invalid status`);
		}
		ids.add(id);
		if (item.status === "in_progress") inProgress += 1;

		const activeForm =
			typeof item.activeForm === "string" && item.activeForm.trim()
				? item.activeForm.trim()
				: undefined;
		normalized.push({
			id,
			content,
			status: item.status,
			...(activeForm ? { activeForm } : {}),
		});
	}

	if (inProgress > 1) {
		throw new Error("todo_write: at most one todo may be in_progress");
	}

	return normalized;
}

export function summarizeTodos(todos: TodoItem[]): string {
	if (todos.length === 0) return "cleared todos";
	const inProgress = todos.filter((todo) => todo.status === "in_progress").length;
	const completed = todos.filter((todo) => todo.status === "completed").length;
	return `${todos.length} todos · ${inProgress} in_progress · ${completed} completed`;
}

export function countByStatus(todos: TodoItem[]): {
	pending: number;
	inProgress: number;
	completed: number;
} {
	return {
		pending: todos.filter((todo) => todo.status === "pending").length,
		inProgress: todos.filter((todo) => todo.status === "in_progress").length,
		completed: todos.filter((todo) => todo.status === "completed").length,
	};
}
