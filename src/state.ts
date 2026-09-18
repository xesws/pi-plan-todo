import {
	NOTEPAD_ADD_TOOL,
	NOTEPAD_PROMOTE_TOOL,
	NOTEPAD_REMOVE_TOOL,
	NOTEPAD_STATE_ENTRY_TYPE,
	NOTEPAD_UPDATE_TOOL,
	STATE_ENTRY_TYPE,
	TOOL_NAME,
	validateNotepads,
	validateTodos,
	type NotepadItem,
	type TodoItem,
} from "./schema.ts";

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
		if (entry.type === "message" && isSuccessfulPromote(entry.message)) {
			// Promote writes todos as a side effect; treat its snapshot like todo_write.
			const details = entry.message?.details as { todos?: unknown };
			if (Array.isArray(details?.todos)) {
				try {
				todos = validateTodos(details.todos);
				} catch {
					// Keep last good snapshot.
				}
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

export const NOTEPAD_TOOL_NAMES = new Set<string>([
	NOTEPAD_ADD_TOOL,
	NOTEPAD_UPDATE_TOOL,
	NOTEPAD_REMOVE_TOOL,
	NOTEPAD_PROMOTE_TOOL,
]);

export function isSuccessfulNotepadWrite(message: BranchMessage | undefined): boolean {
	return (
		message?.role === "toolResult" &&
		typeof message.toolName === "string" &&
		NOTEPAD_TOOL_NAMES.has(message.toolName) &&
		message.isError !== true &&
		Array.isArray((message.details as { notepads?: unknown } | undefined)?.notepads)
	);
}

export function isSuccessfulPromote(message: BranchMessage | undefined): boolean {
	return (
		message?.role === "toolResult" &&
		message.toolName === NOTEPAD_PROMOTE_TOOL &&
		message.isError !== true
	);
}

export function reconstructNotepads(entries: BranchEntry[]): NotepadItem[] {
	let notepads: NotepadItem[] = [];
	for (const entry of entries) {
		if (entry.type === "message" && isSuccessfulNotepadWrite(entry.message)) {
			const details = entry.message?.details as { notepads?: unknown };
			try {
				notepads = validateNotepads(details.notepads);
			} catch {
				// Keep last good snapshot.
			}
			continue;
		}
		if (entry.type === "custom" && entry.customType === NOTEPAD_STATE_ENTRY_TYPE) {
			const data = entry.data as { notepads?: unknown } | undefined;
			if (!Array.isArray(data?.notepads)) continue;
			try {
				notepads = data.notepads.length === 0 ? [] : validateNotepads(data.notepads);
			} catch {
				// Ignore malformed snapshots.
			}
		}
	}
	return notepads;
}
