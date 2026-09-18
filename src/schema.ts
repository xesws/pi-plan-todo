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

/* Notepad (dual-track) constants. Active widget shows `open` items;
 * `resolved` items are archived history (hidden unless expanded). */
export const NOTEPAD_ADD_TOOL = "notepad_add";
export const NOTEPAD_UPDATE_TOOL = "notepad_update";
export const NOTEPAD_REMOVE_TOOL = "notepad_remove";
export const NOTEPAD_PROMOTE_TOOL = "notepad_promote";
export const NOTEPAD_TOOLS = [
	NOTEPAD_ADD_TOOL,
	NOTEPAD_UPDATE_TOOL,
	NOTEPAD_REMOVE_TOOL,
	NOTEPAD_PROMOTE_TOOL,
] as const;
export const NOTEPAD_WIDGET_ID = "pi-plan-notepad";
export const NOTEPAD_STATE_ENTRY_TYPE = "pi-plan-notepad:state";
export const NOTEPAD_SHORTCUT = "ctrl+n";
export const NOTEPAD_SHORTCUTS = ["ctrl+alt+n"] as const;
export const NOTEPAD_COLLAPSED_LIMIT = 6;

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

/* ------------------------------------------------------------------ */
/* Notepad model: future todos. Full queue modeling (topic /
 * partitionKey / priority / timestamps) with a minimal two-state
 * lifecycle: open (active queue) -> resolved (archived, needs designDoc).
 * Dropping an item = deleting it via notepad_remove. Promote copies
 * resolved items into todos and keeps the notepad copy as archive. */

export type NotepadStatus = "open" | "resolved";
export type NotepadPriority = "low" | "medium" | "high";

export interface NotepadItem {
	id: string;
	content: string;
	topic: string;
	partitionKey?: string;
	priority: NotepadPriority;
	status: NotepadStatus;
	designDoc?: string;
	createdAt: number;
	updatedAt: number;
}

export interface NotepadDetails {
	notepads: NotepadItem[];
	updatedAt: number;
}

export interface NotepadAddInput {
	id?: string;
	content: string;
	topic: string;
	partitionKey?: string;
	priority?: NotepadPriority;
	designDoc?: string;
}

export interface NotepadUpdatePatch {
	content?: string;
	topic?: string;
	partitionKey?: string | null;
	priority?: NotepadPriority;
	status?: NotepadStatus;
	designDoc?: string | null;
}

const NOTEPAD_STATUSES = new Set<NotepadStatus>(["open", "resolved"]);
const NOTEPAD_PRIORITIES = new Set<NotepadPriority>(["low", "medium", "high"]);

export function isNotepadStatus(value: unknown): value is NotepadStatus {
	return typeof value === "string" && NOTEPAD_STATUSES.has(value as NotepadStatus);
}

export function isNotepadPriority(value: unknown): value is NotepadPriority {
	return typeof value === "string" && NOTEPAD_PRIORITIES.has(value as NotepadPriority);
}

function cleanStr(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function cleanOptStr(value: unknown): string | undefined {
	const s = cleanStr(value);
	return s ? s : undefined;
}

export function validateNotepads(notepads: unknown): NotepadItem[] {
	if (!Array.isArray(notepads)) {
		throw new Error("notepad: notepads must be an array");
	}
	const ids = new Set<string>();
	const normalized: NotepadItem[] = [];
	for (const raw of notepads) {
		if (!raw || typeof raw !== "object") {
			throw new Error("notepad: each item must be an object");
		}
		const item = raw as Partial<NotepadItem>;
		const id = cleanStr(item.id);
		const content = cleanStr(item.content);
		const topic = cleanStr(item.topic);
		if (!id) throw new Error("notepad: each item id must be a non-empty string");
		if (!content) throw new Error(`notepad: item '${id}' content must be non-empty`);
		if (!topic) throw new Error(`notepad: item '${id}' topic must be non-empty`);
		if (topic.length > 80) throw new Error(`notepad: item '${id}' topic too long (max 80)`);
		if (ids.has(id)) throw new Error(`notepad: duplicate id '${id}'`);
		ids.add(id);
		const priority: NotepadPriority = item.priority === undefined ? "medium" : item.priority;
		if (!isNotepadPriority(priority)) {
			throw new Error(`notepad: item '${id}' has invalid priority`);
		}
		const status = item.status ?? "open";
		if (!isNotepadStatus(status)) {
			throw new Error(`notepad: item '${id}' has invalid status`);
		}
		const partitionKey = cleanOptStr(item.partitionKey);
		const designDoc = cleanOptStr(item.designDoc);
		if (status === "resolved" && !designDoc) {
			throw new Error(
				`notepad: item '${id}' is resolved but missing designDoc (discussion must land in a design doc first)`,
			);
		}
		const createdAt =
			typeof item.createdAt === "number" && Number.isFinite(item.createdAt)
				? item.createdAt
				: Date.now();
		const updatedAt =
			typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt)
				? item.updatedAt
				: createdAt;
		normalized.push({
			id,
			content,
			topic,
			...(partitionKey ? { partitionKey } : {}),
			priority,
			status,
			...(designDoc ? { designDoc } : {}),
			createdAt,
			updatedAt,
		});
	}
	return normalized;
}

export function createNotepadId(seed = ""): string {
	let hash = 0;
	const text = `${seed}:${Date.now()}:${Math.floor(Math.random() * 1e9)}`;
	for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) | 0;
	return `n-${Math.abs(hash).toString(36)}`;
}

export function addNotepadItem(list: NotepadItem[], input: NotepadAddInput): NotepadItem[] {
	const now = Date.now();
	const id = cleanStr(input.id) || createNotepadId(cleanStr(input.content));
	if (list.some((n) => n.id === id)) throw new Error(`notepad: duplicate id '${id}'`);
	const next: NotepadItem[] = [
		...list,
		{
			id,
			content: cleanStr(input.content),
			topic: cleanStr(input.topic),
			...(cleanOptStr(input.partitionKey) ? { partitionKey: cleanOptStr(input.partitionKey)! } : {}),
			priority: input.priority ?? "medium",
			status: "open",
			...(cleanOptStr(input.designDoc) ? { designDoc: cleanOptStr(input.designDoc)! } : {}),
			createdAt: now,
			updatedAt: now,
		},
	];
	return validateNotepads(next);
}

export function updateNotepadItem(
	list: NotepadItem[],
	id: string,
	patch: NotepadUpdatePatch,
): NotepadItem[] {
	const target = cleanStr(id);
	if (!target) throw new Error("notepad_update: id must be non-empty");
	let found = false;
	const now = Date.now();
	const next = list.map((item) => {
		if (item.id !== target) return item;
		found = true;
		const updated: NotepadItem = { ...item };
		if (patch.content !== undefined) updated.content = cleanStr(patch.content);
		if (patch.topic !== undefined) updated.topic = cleanStr(patch.topic);
		if (patch.partitionKey !== undefined) {
			if (patch.partitionKey === null) delete updated.partitionKey;
			else {
				const pk = cleanOptStr(patch.partitionKey);
				if (pk) updated.partitionKey = pk;
				else delete updated.partitionKey;
			}
		}
		if (patch.priority !== undefined) updated.priority = patch.priority;
		if (patch.status !== undefined) updated.status = patch.status;
		if (patch.designDoc !== undefined) {
			if (patch.designDoc === null) delete updated.designDoc;
			else {
				const dd = cleanOptStr(patch.designDoc);
				if (dd) updated.designDoc = dd;
				else delete updated.designDoc;
			}
		}
		updated.updatedAt = now;
		return updated;
	});
	if (!found) throw new Error(`notepad: unknown id '${target}'`);
	return validateNotepads(next);
}

export function removeNotepadItems(list: NotepadItem[], ids: string[]): NotepadItem[] {
	const doomed = new Set(ids.map((v) => cleanStr(v)).filter(Boolean));
	if (doomed.size === 0) throw new Error("notepad_remove: ids must be non-empty");
	return list.filter((item) => !doomed.has(item.id));
}

export interface PromoteSelector {
	ids?: string[];
	topics?: string[];
	partitionKeys?: string[];
	onlyResolved?: boolean;
}

const PRIORITY_RANK: Record<NotepadPriority, number> = { high: 0, medium: 1, low: 2 };

export function selectPromoteSubset(list: NotepadItem[], selector: PromoteSelector): NotepadItem[] {
	const onlyResolved = selector.onlyResolved ?? true;
	const idList = (selector.ids ?? []).map((v) => cleanStr(v)).filter(Boolean);
	if (idList.length > 0) {
		const byId = new Map(list.map((n) => [n.id, n]));
		const picked: NotepadItem[] = [];
		for (const id of idList) {
			const item = byId.get(id);
			if (!item) throw new Error(`notepad_promote: unknown id '${id}'`);
			picked.push(item);
		}
		if (onlyResolved) assertAllResolved(picked);
		return picked;
	}
	const topics = new Set((selector.topics ?? []).map((v) => cleanStr(v)).filter(Boolean));
	const partitions = new Set((selector.partitionKeys ?? []).map((v) => cleanStr(v)).filter(Boolean));
	if (topics.size === 0 && partitions.size === 0) {
		throw new Error("notepad_promote: provide ids or topics/partitionKeys");
	}
	let picked = list.filter((n) => {
		if (topics.size > 0 && !topics.has(n.topic)) return false;
		if (partitions.size > 0 && (!n.partitionKey || !partitions.has(n.partitionKey))) return false;
		return true;
	});
	if (onlyResolved) picked = picked.filter((n) => n.status === "resolved");
	if (picked.length === 0) {
		throw new Error("notepad_promote: no matching notepad items (resolve + land designDoc first?)");
	}
	if (onlyResolved) assertAllResolved(picked);
	return [...picked].sort(
		(a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.createdAt - b.createdAt,
	);
}

function assertAllResolved(items: NotepadItem[]): void {
	for (const n of items) {
		if (n.status !== "resolved") {
			throw new Error(
				`notepad_promote: item '${n.id}' is not resolved (status=${n.status}). Discuss, land designDoc, mark resolved first.`,
			);
		}
		if (!n.designDoc) {
			throw new Error(`notepad_promote: item '${n.id}' resolved but missing designDoc`);
		}
	}
}

export function summarizeNotepads(notepads: NotepadItem[]): string {
	if (notepads.length === 0) return "cleared notepad";
	const open = notepads.filter((n) => n.status === "open").length;
	const resolved = notepads.length - open;
	const topics = new Set(notepads.map((n) => n.topic)).size;
	return `${notepads.length} notes · ${open} open · ${resolved} resolved · ${topics} topics`;
}

export function convertNotepadsToTodos(
	selected: NotepadItem[],
	existing: TodoItem[],
	mode: "append" | "replace" = "append",
): TodoItem[] {
	const auto = selected.map((n) => ({
		id: `todo-${n.id}`,
		content: n.content,
		status: "pending" as const,
	}));
	// Ensure unique ids against existing when appending (suffix on collision).
	const used = new Set(existing.map((t) => t.id));
	for (const t of auto) {
		let base = t.id;
		let i = 2;
		while (used.has(t.id)) {
			t.id = `${base}-${i}`;
			i += 1;
		}
		used.add(t.id);
	}
	const combined = mode === "replace" ? auto : [...existing, ...auto];
	const normalized = validateTodos(combined);
	// Guarantee exactly one in_progress when we introduced new work and none exists.
	if (auto.length > 0 && !normalized.some((t) => t.status === "in_progress")) {
		const firstNewId = auto[0]?.id;
		return normalized.map((t) => (t.id === firstNewId ? { ...t, status: "in_progress" as const } : t));
	}
	return validateTodos(normalized);
}
