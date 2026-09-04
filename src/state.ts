import { STATE_ENTRY_TYPE, TOOL_NAME, validateTodos, type TodoItem } from "./schema.ts";

export interface BranchMessage {
	role?: string;
	toolName?: string;
	isError?: boolean;
	details?: unknown;
	content?: unknown;
}

export interface BranchEntry {
	type: string;
	customType?: string;
	data?: unknown;
	message?: BranchMessage;
}

export function userMessageText(message: BranchMessage | undefined): string {
	if (!message) return "";
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block) => block && typeof block === "object" && (block as { type?: string }).type === "text")
		.map((block) => (typeof (block as { text?: unknown }).text === "string" ? (block as { text: string }).text : ""))
		.join("\n");
}

export function isSuccessfulTodoWrite(message: BranchMessage | undefined): boolean {
	return (
		message?.role === "toolResult" &&
		message.toolName === TOOL_NAME &&
		message.isError !== true &&
		Array.isArray((message.details as { todos?: unknown } | undefined)?.todos)
	);
}

export function reconstructTodos(entries: BranchEntry[]): TodoItem[] {
	let todos: TodoItem[] = [];
	for (const entry of entries) {
		if (entry.type === "message" && isSuccessfulTodoWrite(entry.message)) {
			const details = entry.message?.details as { todos?: unknown };
			try {
				todos = validateTodos(details.todos);
			} catch {
				// Keep the last good snapshot if a later write is malformed.
			}
			continue;
		}
		if (entry.type === "custom" && entry.customType === STATE_ENTRY_TYPE) {
			const data = entry.data as { todos?: unknown } | undefined;
			if (!Array.isArray(data?.todos)) continue;
			try {
				todos = data.todos.length === 0 ? [] : validateTodos(data.todos);
			} catch {
				// Ignore malformed user-clear snapshots.
			}
		}
	}
	return todos;
}
