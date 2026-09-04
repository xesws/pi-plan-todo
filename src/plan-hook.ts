import { HOOK_ENTRY_TYPE } from "./schema.ts";
import type { BranchEntry } from "./state.ts";
import { isSuccessfulTodoWrite, userMessageText } from "./state.ts";

export const PLAN_MODE_STATE_TYPE = "plan-mode-state";

export const IMPLEMENT_HANDOFF_PREFIXES = [
	"Plan mode is now disabled. Full tool access is restored. Implement this proposed plan now:",
	"A previous agent produced the plan below to accomplish the user's task.",
] as const;

/** Same-session Implement here when plan-mode retention keeps conversation history. */
export const HISTORY_IMPLEMENT_PROMPT = "Implement the plan.";

export const TODO_STEER_BANNER =
	"[pi-plan-todo] First tool call MUST be todo_write with the complete step list from the approved plan (exactly one in_progress, rest pending). Do not edit files before todo_write succeeds.";

export const HOOK_MESSAGE =
	"Plan 已批准。先调用 `todo_write` 提交完整步骤（第一条 `in_progress`，其余 `pending`），再改代码。每完成一步就全量更新列表。";

export const SYSTEM_STEER = `## pi-plan-todo (required)
The todo_write tool is available. Your first tool call this turn MUST be todo_write with a complete list of implementation steps from the approved plan. Use exactly one in_progress item; the rest pending. Do not call edit, write, or bash until todo_write has succeeded. After each step, call todo_write again with the full updated list.`;

export function stripTodoBanner(text: string): string {
	const trimmed = text.trimStart();
	if (!trimmed.startsWith("[pi-plan-todo]")) return text;
	const rest = trimmed.slice(TODO_STEER_BANNER.length).replace(/^\s+/, "");
	return rest.length > 0 ? rest : trimmed;
}

export function isHandoffPrompt(text: string | undefined): boolean {
	if (!text) return false;
	const body = stripTodoBanner(text).trim();
	if (body === HISTORY_IMPLEMENT_PROMPT) return true;
	return IMPLEMENT_HANDOFF_PREFIXES.some(
		(prefix) => body.startsWith(prefix) || body.includes(`\n${prefix}`) || body.includes(prefix),
	);
}

export function prependTodoInstruction(text: string): string {
	if (text.includes("First tool call MUST be todo_write")) return text;
	if (!isHandoffPrompt(text)) return text;
	return `${TODO_STEER_BANNER}\n\n${text}`;
}

export function findActiveImplementation(
	entries: BranchEntry[],
): { id: string; index: number } | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.type !== "custom" || entry.customType !== PLAN_MODE_STATE_TYPE) continue;
		const data = asRecord(entry.data);
		if (!data) return undefined;
		if (data.enabled === true) return undefined;
		const active = asRecord(data.activeImplementation);
		const id = typeof active?.id === "string" ? active.id : "";
		if (id) return { id, index };
		return undefined;
	}
	return undefined;
}

export function findLatestHandoffIndex(entries: BranchEntry[]): number | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.type !== "message" || entry.message?.role !== "user") continue;
		if (isHandoffPrompt(userMessageText(entry.message))) return index;
	}
	return undefined;
}

export function hasHook(entries: BranchEntry[], implementationId: string): boolean {
	return entries.some((entry) => {
		if (entry.type !== "custom" || entry.customType !== HOOK_ENTRY_TYPE) return false;
		const data = asRecord(entry.data);
		return data?.implementationId === implementationId;
	});
}

export function findPendingSteer(
	entries: BranchEntry[],
): { id: string; index: number } | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.type !== "custom" || entry.customType !== HOOK_ENTRY_TYPE) continue;
		const data = asRecord(entry.data);
		const id = typeof data?.implementationId === "string" ? data.implementationId : "";
		if (!id) continue;
		if (hasSuccessfulTodoWriteAfter(entries, index)) return undefined;
		return { id, index };
	}
	return undefined;
}

export function hasSuccessfulTodoWriteAfter(entries: BranchEntry[], startIndex: number): boolean {
	for (let index = startIndex + 1; index < entries.length; index += 1) {
		const entry = entries[index];
		if (entry?.type === "message" && isSuccessfulTodoWrite(entry.message)) return true;
	}
	return false;
}

export function shouldSteerTodoWrite(input: {
	prompt?: string;
	entries: BranchEntry[];
}): { steer: false } | { steer: true; implementationId: string; injectMessage: boolean } {
	const impl = findActiveImplementation(input.entries);
	const promptHandoff = isHandoffPrompt(input.prompt);
	const pending = findPendingSteer(input.entries);
	if (!impl && !promptHandoff && !pending) {
		return { steer: false };
	}

	const implementationId =
		impl?.id ??
		pending?.id ??
		`handoff:${shortId((input.prompt ?? "").slice(0, 200))}`;

	const startIndex = Math.min(
		impl?.index ?? Number.POSITIVE_INFINITY,
		pending?.index ?? Number.POSITIVE_INFINITY,
		findLatestHandoffIndex(input.entries) ?? Number.POSITIVE_INFINITY,
	);
	const boundedStart = Number.isFinite(startIndex) ? startIndex : 0;
	if (hasSuccessfulTodoWriteAfter(input.entries, boundedStart)) {
		return { steer: false };
	}

	return {
		steer: true,
		implementationId,
		injectMessage: !hasHook(input.entries, implementationId),
	};
}

/** @deprecated use shouldSteerTodoWrite */
export function shouldInjectHook(input: {
	prompt?: string;
	entries: BranchEntry[];
}): { inject: false } | { inject: true; implementationId: string } {
	const decision = shouldSteerTodoWrite(input);
	if (!decision.steer) return { inject: false };
	return { inject: true, implementationId: decision.implementationId };
}

export function shortId(text: string): string {
	let hash = 0;
	for (let index = 0; index < text.length; index += 1) {
		hash = (hash * 31 + text.charCodeAt(index)) | 0;
	}
	return Math.abs(hash).toString(36);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	return value as Record<string, unknown>;
}

export type { BranchEntry };
