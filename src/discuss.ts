import { NOTEPAD_PROMOTE_TOOL, TOOL_NAME } from "./schema.ts";
import { PLAN_MODE_STATE_TYPE } from "./plan-hook.ts";
import type { BranchEntry } from "./state.ts";

export const DISCUSS_STATE_ENTRY_TYPE = "pi-plan-discuss:state";
export const DISCUSS_COMMAND = "discuss";
export const DISCUSS_BADGE = "[discussing]";

/** Built-in mutation tools + execution-list writers. Reads, search and notepad ops stay open. */
export const DISCUSS_BLOCKED_TOOLS: ReadonlySet<string> = new Set([
	"edit",
	"write",
	"bash",
	"powershell",
	TOOL_NAME,
	NOTEPAD_PROMOTE_TOOL,
]);

export const DISCUSS_ENTER_MESSAGE =
	"Discussion mode 已开启：只讨论、不改代码。想法先记进 Notepad 再聊；切执行前先 /discuss stop。";

export const DISCUSS_EXIT_MESSAGE = "Discussion mode 已关闭，回到普通执行模式。";

export const DISCUSS_AUTO_CLOSE_MESSAGE =
	"Plan Mode 已激活，discussion 自动关闭（内容无交接，需要就自己看 Notepad）。先做 plan 吧。";

export const DISCUSS_SYSTEM_STEER = `## pi-plan-discuss (discussion mode, required)
You are in DISCUSSION mode: diverge, discuss, and curate the Notepad. Do NOT write code, run commands, or create execution todos in this mode (edit/write/bash/todo_write/notepad_promote are blocked).

### 1. Reference the Notepad every turn
The Notepad widget lists all open threads. Before replying, check which topic the user is on and which open notes belong to other topics — remind them of pending threads before they get lost.

### 2. Notepad maintenance rules (use the tools, never prose lists)
- ADD first, discuss later: when a new idea or sub-question appears mid-chat, call notepad_add immediately (content + topic), then switch back to the current thread.
- UPDATE to converge: retopic / reprioritize / edit content via notepad_update as understanding sharpens.
- SPLIT big items: one vague note becomes several precise notes sharing the topic but with different partitionKeys.
- REMOVE to drop: abandoned ideas go via notepad_remove, never silently ignored.
- RESOLVE to land: only mark resolved together with a designDoc path, after the design is written down.

### 3. Topic is the partition key of discussion (important)
A topic is one议题, like a Kafka topic; partitionKey is a sub-aspect inside it. Example — user says "系统怎么做 RAG" and "怎么做压力测试":
- topic "RAG", partitionKey "embedding" → "Embedding 选型与维度"
- topic "RAG", partitionKey "retrieval" → "检索链路：chunk 策略、rerank"
- topic "load-test" (no partition) → "k6 场景与目标 QPS"
Same topic = discuss and resolve together; different topics = independent threads. When the user jumps topics, stash the current one first.

### 4. Know when discussion is done
When every note of one or more topics is resolved with designDocs, tell the user: run /discuss stop, then /plan to converge into execution. Never call todo_write or notepad_promote yourself in this mode.`;

export function isDiscussActive(entries: BranchEntry[]): boolean {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.type !== "custom" || entry.customType !== DISCUSS_STATE_ENTRY_TYPE) continue;
		const data = entry.data as { enabled?: unknown } | undefined;
		return data?.enabled === true;
	}
	return false;
}

/** Latest plan-mode-state entry has enabled === true. */
export function isPlanModeEnabled(entries: BranchEntry[]): boolean {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.type !== "custom" || entry.customType !== PLAN_MODE_STATE_TYPE) continue;
		const data = entry.data as { enabled?: unknown } | undefined;
		return data?.enabled === true;
	}
	return false;
}

export function shouldBlockDiscussTool(toolName: string | undefined): boolean {
	return typeof toolName === "string" && DISCUSS_BLOCKED_TOOLS.has(toolName);
}

export function discussBlockReason(toolName: string): string {
	if (toolName === TOOL_NAME || toolName === NOTEPAD_PROMOTE_TOOL) {
		return `Discussion mode blocks '${toolName}': converge first — /discuss stop, then /plan, then promote after approval.`;
	}
	return `Discussion mode blocks mutating tool '${toolName}': discuss and curate the Notepad only; exit with /discuss stop to change code.`;
}
