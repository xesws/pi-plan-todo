import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	DISCUSS_AUTO_CLOSE_MESSAGE,
	DISCUSS_BADGE,
	DISCUSS_ENTER_MESSAGE,
	DISCUSS_EXIT_MESSAGE,
	DISCUSS_STATE_ENTRY_TYPE,
	DISCUSS_SYSTEM_STEER,
	discussBlockReason,
	isDiscussActive,
	isPlanModeEnabled,
	shouldBlockDiscussTool,
} from "./discuss.ts";
import {
	HOOK_MESSAGE,
	SYSTEM_STEER,
	isHandoffPrompt,
	prependTodoInstruction,
	shouldSteerTodoWrite,
} from "./plan-hook.ts";
import {
	renderCallComponent,
	renderNotepadCallComponent,
	renderNotepadResultComponent,
	renderPromoteCallText,
	renderResultComponent,
} from "./render.ts";
import {
	HOOK_ENTRY_TYPE,
	HOOK_MESSAGE_TYPE,
	NOTEPAD_ADD_TOOL,
	NOTEPAD_PROMOTE_TOOL,
	NOTEPAD_REMOVE_TOOL,
	NOTEPAD_SHORTCUTS,
	NOTEPAD_SHORTCUT,
	NOTEPAD_STATE_ENTRY_TYPE,
	NOTEPAD_UPDATE_TOOL,
	NOTEPAD_WIDGET_ID,
	SHORTCUT,
	SHORTCUTS,
	STATE_ENTRY_TYPE,
	TOOL_NAME,
	WIDGET_ID,
	addNotepadItem,
	convertNotepadsToTodos,
	removeNotepadItems,
	selectPromoteSubset,
	summarizeNotepads,
	summarizeTodos,
	updateNotepadItem,
	validateNotepads,
	validateTodos,
	type NotepadDetails,
	type NotepadItem,
	type TodoDetails,
	type TodoItem,
} from "./schema.ts";
import { reconstructNotepads, reconstructTodos, type BranchEntry } from "./state.ts";
import { formatNotepadLines, formatWidgetLines } from "./widget.ts";

const TodoItemSchema = Type.Object({
	id: Type.String({ description: "Stable id for this todo item" }),
	content: Type.String({ description: "Todo item text" }),
	status: StringEnum(["pending", "in_progress", "completed"] as const),
	activeForm: Type.Optional(
		Type.String({ description: "Present-tense label shown while in_progress" }),
	),
});

const TodoWriteParams = Type.Object({
	todos: Type.Array(TodoItemSchema, {
		description: "Complete replacement list for the current todos",
	}),
});

const NotepadPrioritySchema = StringEnum(["low", "medium", "high"] as const);
const NotepadStatusSchema = StringEnum(["open", "resolved"] as const);

const NotepadAddParams = Type.Object({
	content: Type.String({ description: "What to discuss later (future todo)" }),
	topic: Type.String({ description: "Topic / partition, e.g. RAG, load-test" }),
	id: Type.Optional(Type.String({ description: "Stable id; auto-generated when omitted" })),
	partitionKey: Type.Optional(Type.String({ description: "Sub-partition within the topic" })),
	priority: Type.Optional(NotepadPrioritySchema as never),
	designDoc: Type.Optional(Type.String({ description: "Design doc path once discussed" })),
});

const NotepadUpdateParams = Type.Object({
	id: Type.String({ description: "Notepad item id" }),
	content: Type.Optional(Type.String({ description: "New content" })),
	topic: Type.Optional(Type.String({ description: "New topic" })),
	partitionKey: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	priority: Type.Optional(NotepadPrioritySchema as never),
	status: Type.Optional(NotepadStatusSchema as never),
	designDoc: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const NotepadRemoveParams = Type.Object({
	ids: Type.Array(Type.String(), { description: "Notepad ids to delete (dropped ideas)" }),
});

const NotepadPromoteParams = Type.Object({
	ids: Type.Optional(Type.Array(Type.String(), { description: "Explicit notepad ids; order = todo order" })),
	topics: Type.Optional(Type.Array(Type.String(), { description: "Topic filter (batch pop)" })),
	partitionKeys: Type.Optional(Type.Array(Type.String(), { description: "Partition filter" })),
	onlyResolved: Type.Optional(Type.Boolean({ description: "Default true: only resolved+designDoc items" })),
	mode: Type.Optional(StringEnum(["append", "replace"] as const) as never),
	todos: Type.Optional(
		Type.Array(TodoItemSchema, {
			description: "Optional final todo list override (agent-replanned order/content)",
		}),
	),
});

export default function (pi: ExtensionAPI) {
	let todos: TodoItem[] = [];
	let notepads: NotepadItem[] = [];
	let expandedTodo = false;
	let expandedNotepad = false;
	let discussing = false;
	let prevNotepadExpanded = false;
	let lastCtx: ExtensionContext | undefined;
	let stopInput: (() => void) | undefined;

	const branch = (ctx: ExtensionContext): BranchEntry[] =>
		ctx.sessionManager.getBranch() as BranchEntry[];

	const paintTodos = (ctx?: ExtensionContext) => {
		const target = ctx ?? lastCtx;
		if (!target?.hasUI) return;
		lastCtx = target;
		if (todos.length === 0) {
			target.ui.setWidget(WIDGET_ID, undefined);
			return;
		}
		if (target.mode !== "tui") {
			target.ui.setWidget(WIDGET_ID, formatWidgetLines(plainTheme, todos, expandedTodo), {
				placement: "aboveEditor",
			});
			return;
		}
		const snapshot = todos;
		const isExpanded = expandedTodo;
		target.ui.setWidget(
			WIDGET_ID,
			(_tui, theme) => ({
				render: (width: number) =>
					formatWidgetLines(theme, snapshot, isExpanded).map((line) => truncateToWidth(line, width)),
				invalidate() {},
			}),
			{ placement: "aboveEditor" },
		);
	};

	const paintNotepad = (ctx?: ExtensionContext) => {
		const target = ctx ?? lastCtx;
		if (!target?.hasUI) return;
		lastCtx = target;
		if (notepads.length === 0) {
			target.ui.setWidget(NOTEPAD_WIDGET_ID, undefined);
			return;
		}
		if (target.mode !== "tui") {
			target.ui.setWidget(
				NOTEPAD_WIDGET_ID,
				formatNotepadLines(plainTheme, notepads, expandedNotepad, discussing ? DISCUSS_BADGE : undefined),
				{ placement: "aboveEditor" },
			);
			return;
		}
		const snapshot = notepads;
		const isExpanded = expandedNotepad;
		const badge = discussing ? DISCUSS_BADGE : undefined;
		target.ui.setWidget(
			NOTEPAD_WIDGET_ID,
			(_tui, theme) => ({
				render: (width: number) =>
					formatNotepadLines(theme, snapshot, isExpanded, badge).map((line) =>
						truncateToWidth(line, width),
					),
				invalidate() {},
			}),
			{ placement: "aboveEditor" },
		);
	};

	const paint = (ctx?: ExtensionContext) => {
		paintTodos(ctx);
		paintNotepad(ctx ?? lastCtx);
	};

	const toggleTodoExpanded = async (ctx?: ExtensionContext) => {
		const target = ctx ?? lastCtx;
		if (!target) return;
		if (todos.length === 0) {
			if (target.hasUI) target.ui.notify("No todos", "info");
			return;
		}
		expandedTodo = !expandedTodo;
		paintTodos(target);
		if (target.hasUI) {
			target.ui.notify(expandedTodo ? "Todo expanded" : "Todo collapsed", "info");
		}
	};

	const toggleNotepadExpanded = async (ctx?: ExtensionContext) => {
		const target = ctx ?? lastCtx;
		if (!target) return;
		if (notepads.length === 0) {
			if (target.hasUI) target.ui.notify("No notes", "info");
			return;
		}
		expandedNotepad = !expandedNotepad;
		paintNotepad(target);
		if (target.hasUI) {
			target.ui.notify(expandedNotepad ? "Notepad expanded" : "Notepad collapsed", "info");
		}
	};

	const bindTerminalKeys = (ctx: ExtensionContext) => {
		stopInput?.();
		stopInput = undefined;
		lastCtx = ctx;
		if (!ctx.hasUI || ctx.mode !== "tui") return;
		stopInput = ctx.ui.onTerminalInput((data) => {
			if (matchesKey(data, "ctrl+t")) {
				void toggleTodoExpanded(ctx);
				return { consume: true };
			}
			if (matchesKey(data, "ctrl+n")) {
				void toggleNotepadExpanded(ctx);
				return { consume: true };
			}
			return;
		});
	};

	const restore = (ctx: ExtensionContext) => {
		const entries = branch(ctx);
		todos = reconstructTodos(entries);
		notepads = reconstructNotepads(entries);
		discussing = isDiscussActive(entries);
		if (discussing && isPlanModeEnabled(entries)) {
			// User entered Plan Mode without stopping: auto-close, no content handoff.
			discussing = false;
			pi.appendEntry(DISCUSS_STATE_ENTRY_TYPE, { enabled: false, closedBy: "plan" });
			if (ctx.hasUI) ctx.ui.notify(DISCUSS_AUTO_CLOSE_MESSAGE, "info");
		}
		paint(ctx);
		bindTerminalKeys(ctx);
	};

	const setDiscussing = (next: boolean, ctx: ExtensionContext, closedBy?: string) => {
		if (next === discussing && closedBy === undefined) return;
		discussing = next;
		if (next) {
			prevNotepadExpanded = expandedNotepad;
			expandedNotepad = true;
			pi.appendEntry(DISCUSS_STATE_ENTRY_TYPE, { enabled: true, startedAt: Date.now() });
		} else {
			expandedNotepad = prevNotepadExpanded;
			pi.appendEntry(
				DISCUSS_STATE_ENTRY_TYPE,
				closedBy ? { enabled: false, closedBy } : { enabled: false },
			);
		}
		paint(ctx);
		if (ctx.hasUI) ctx.ui.notify(next ? DISCUSS_ENTER_MESSAGE : DISCUSS_EXIT_MESSAGE, "info");
	};

	pi.on("session_start", async (_event, ctx) => restore(ctx));
	pi.on("session_tree", async (_event, ctx) => restore(ctx));
	pi.on("session_shutdown", async (_event, ctx) => {
		stopInput?.();
		stopInput = undefined;
		if (ctx.hasUI) {
			ctx.ui.setWidget(WIDGET_ID, undefined);
			ctx.ui.setWidget(NOTEPAD_WIDGET_ID, undefined);
		}
		if (lastCtx === ctx) lastCtx = undefined;
	});

	pi.on("input", async (event) => {
		if (!isHandoffPrompt(event.text)) return;
		const next = prependTodoInstruction(event.text);
		if (next === event.text) return;
		return { action: "transform" as const, text: next };
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const entries = branch(ctx);
		if (discussing && isPlanModeEnabled(entries)) {
			setDiscussing(false, ctx, "plan");
			if (ctx.hasUI) ctx.ui.notify(DISCUSS_AUTO_CLOSE_MESSAGE, "info");
		}
		const decision = shouldSteerTodoWrite({
			prompt: event.prompt,
			entries,
		});
		const systemSteers: string[] = [];
		if (discussing) systemSteers.push(DISCUSS_SYSTEM_STEER);
		if (!decision.steer) {
			if (systemSteers.length === 0) return;
			return { systemPrompt: `${event.systemPrompt}\n\n${systemSteers.join("\n\n")}` };
		}
		if (decision.injectMessage) {
			pi.appendEntry(HOOK_ENTRY_TYPE, {
				implementationId: decision.implementationId,
				injectedAt: Date.now(),
			});
		}
		systemSteers.push(SYSTEM_STEER);
		return {
			...(decision.injectMessage
				? {
						message: {
							customType: HOOK_MESSAGE_TYPE,
							content: HOOK_MESSAGE,
							display: false,
						},
				  }
				: {}),
			systemPrompt: `${event.systemPrompt}\n\n${systemSteers.join("\n\n")}`,
		};
	});

	pi.on("tool_call", async (event) => {
		if (!discussing) return;
		if (!shouldBlockDiscussTool(event.toolName)) return;
		return { block: true, reason: discussBlockReason(event.toolName) };
	});

	const notepadResult = (ctx: ExtensionContext, action: string) => {
		const details: NotepadDetails = {
			notepads: notepads.map((n) => ({ ...n })),
			updatedAt: Date.now(),
		};
		if (ctx.hasUI) paintNotepad(ctx);
		return {
			content: [{ type: "text" as const, text: `notepad ${action}: ${summarizeNotepads(notepads)}` }],
			details,
		};
	};

	pi.registerTool({
		name: TOOL_NAME,
		label: "Todo",
		description:
			"Replace the current execution todo list. Always send the complete list. Statuses: pending, in_progress, completed. At most one item may be in_progress. Send an empty list to clear.",
		promptSnippet: "Maintain the current task's execution todo list",
		promptGuidelines: [
			"After /plan Implement, the first tool call must be todo_write (or notepad_promote when promoting a resolved Notepad subset) with the complete step list before any edit, write, or bash.",
			"Use todo_write for multi-step implementation (especially after /plan is approved) before editing files.",
			"When calling todo_write, send the complete list every time; keep at most one item in_progress.",
			"Mark the current todo_write item in_progress when you start it and completed as soon as it is done.",
			"Do not maintain the todo list in prose. Do not call todo_write during Plan mode or discussion mode (/discuss).",
			"Do not also create a task_plan for the same work unless the user explicitly wants a pi-tasks contract.",
			"Notepad (notepad_add/update/remove) holds future todos during divergent discussion; allow it in Plan-mode policy via /plan tools. notepad_promote copies a resolved subset into todos after Implement.",
		],
		parameters: TodoWriteParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			todos = validateTodos(params.todos);
			const details: TodoDetails = { todos: todos.map((todo) => ({ ...todo })), updatedAt: Date.now() };
			if (ctx.hasUI) paintTodos(ctx);
			return {
				content: [{ type: "text" as const, text: summarizeTodos(todos) }],
				details,
			};
		},
		renderCall(args, theme) {
			const list = Array.isArray(args.todos) ? (args.todos as TodoItem[]) : undefined;
			return renderCallComponent(theme, list);
		},
		renderResult(result, { expanded: toolExpanded }, theme) {
			const details = result.details as TodoDetails | undefined;
			const list = Array.isArray(details?.todos) ? details.todos : todos;
			return renderResultComponent(theme, list, toolExpanded);
		},
	});

	pi.registerTool({
		name: NOTEPAD_ADD_TOOL,
		label: "Notepad",
		description:
			"Stash a future todo during divergent discussion. Requires content + topic; optional partitionKey/priority. Status starts open. Mark resolved (with designDoc) via notepad_update once the design lands.",
		promptSnippet: "Stash divergent ideas into the notepad queue",
		promptGuidelines: [
			"Use notepad_add during divergent discussion before there is a converged todo list.",
			"Every note needs a topic (e.g. RAG, load-test) and optional partitionKey/priority for queue grouping.",
			"notepad_add/update/remove may be allowed in Plan-mode policy via /plan tools; todo_write and notepad_promote run only after Implement.",
			"In discussion mode (/discuss) notepad_add/update/remove are the primary tools: stash first, discuss later.",
			"Resolving a note requires designDoc; promote only accepts resolved notes.",
		],
		parameters: NotepadAddParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			notepads = addNotepadItem(notepads, {
				id: typeof params.id === "string" ? params.id : undefined,
				content: params.content,
				topic: params.topic,
				partitionKey: typeof params.partitionKey === "string" ? params.partitionKey : undefined,
				priority: (params.priority as NotepadItem["priority"] | undefined) ?? undefined,
				designDoc: typeof params.designDoc === "string" ? params.designDoc : undefined,
			});
			return notepadResult(ctx, "add");
		},
		renderCall(args, theme) {
			const count = notepads.length + 1;
			return renderNotepadCallComponent(theme, "add", count);
		},
		renderResult(result, _opts, theme) {
			const details = result.details as NotepadDetails | undefined;
			return renderNotepadResultComponent(theme, details?.notepads ?? notepads);
		},
	});

	pi.registerTool({
		name: NOTEPAD_UPDATE_TOOL,
		label: "Notepad",
		description:
			"Update a notepad item by id: retopic, reprioritize, edit content, or mark resolved (requires designDoc).",
		promptSnippet: "Update a stashed notepad item",
		promptGuidelines: [
			"Mark a note resolved only after the discussion lands in a design doc; set designDoc in the same call.",
			"Use topic/partitionKey to regroup queue items as understanding converges.",
		],
		parameters: NotepadUpdateParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			notepads = updateNotepadItem(notepads, params.id, {
				...(params.content !== undefined ? { content: params.content as string } : {}),
				...(params.topic !== undefined ? { topic: params.topic as string } : {}),
				...(params.partitionKey !== undefined
					? { partitionKey: params.partitionKey as string | null }
					: {}),
				...(params.priority !== undefined
					? { priority: params.priority as NotepadItem["priority"] }
					: {}),
				...(params.status !== undefined ? { status: params.status as NotepadItem["status"] } : {}),
				...(params.designDoc !== undefined
					? { designDoc: params.designDoc as string | null }
					: {}),
			});
			return notepadResult(ctx, "update");
		},
		renderCall(_args, theme) {
			return renderNotepadCallComponent(theme, "update", notepads.length);
		},
		renderResult(result, _opts, theme) {
			const details = result.details as NotepadDetails | undefined;
			return renderNotepadResultComponent(theme, details?.notepads ?? notepads);
		},
	});

	pi.registerTool({
		name: NOTEPAD_REMOVE_TOOL,
		label: "Notepad",
		description: "Delete dropped notepad ideas by ids. Resolved history stays unless explicitly removed.",
		promptSnippet: "Drop notepad ideas",
		parameters: NotepadRemoveParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			notepads = removeNotepadItems(notepads, params.ids as string[]);
			try {
				notepads = validateNotepads(notepads);
			} catch {
				// Removal cannot invalidate survivors; ignore.
			}
			if (notepads.length === 0) {
				pi.appendEntry(NOTEPAD_STATE_ENTRY_TYPE, { notepads: [] });
			}
			return notepadResult(ctx, "remove");
		},
		renderCall(args, theme) {
			const ids = Array.isArray(args.ids) ? args.ids.length : 0;
			return renderNotepadCallComponent(theme, "remove", ids);
		},
		renderResult(result, _opts, theme) {
			const details = result.details as NotepadDetails | undefined;
			return renderNotepadResultComponent(theme, details?.notepads ?? notepads);
		},
	});

	pi.registerTool({
		name: NOTEPAD_PROMOTE_TOOL,
		label: "Promote",
		description:
			"Promote a resolved Notepad subset into the Todo list (agent-driven). Select by ids (order = todo order) or by topics/partitionKeys. Only resolved items with designDoc qualify. Mode append (default) or replace. Optionally pass a replanned todos list.",
		promptSnippet: "Promote resolved notes into todos",
		promptGuidelines: [
			"After /plan Implement, the first tool call must be todo_write or notepad_promote before any edit, write, or bash.",
			"Promote only resolved notes with designDoc; resolve via notepad_update first.",
			"Prefer ids for an exact subset and order; use topics/partitionKeys for batch pops (sorted by priority then age).",
			"Do not call notepad_promote during Plan mode or discussion mode; it runs only after Implement.",
		],
		parameters: NotepadPromoteParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const onlyResolved = params.onlyResolved !== false;
			const mode = params.mode === "replace" ? "replace" : "append";
			const selected = selectPromoteSubset(notepads, {
				ids: Array.isArray(params.ids) ? (params.ids as string[]) : undefined,
				topics: Array.isArray(params.topics) ? (params.topics as string[]) : undefined,
				partitionKeys: Array.isArray(params.partitionKeys)
					? (params.partitionKeys as string[])
					: undefined,
				onlyResolved,
			});
			if (Array.isArray(params.todos) && params.todos.length > 0) {
				const provided = validateTodos(params.todos);
				todos = mode === "replace" ? provided : validateTodos([...todos, ...provided]);
			} else {
				todos = convertNotepadsToTodos(selected, todos, mode);
			}
			// Copy-retain: notepad keeps resolved archive; active queue pops by hiding resolved.
			const todoDetails: TodoDetails = {
				todos: todos.map((t) => ({ ...t })),
				updatedAt: Date.now(),
			};
			const notepadDetails: NotepadDetails = {
				notepads: notepads.map((n) => ({ ...n })),
				updatedAt: Date.now(),
			};
			if (ctx.hasUI) paint(ctx);
			const promotedIds = selected.map((n) => n.id);
			return {
				content: [
					{
						type: "text" as const,
						text: `promoted ${selected.length} notes (${promotedIds.join(", ")}) → ${summarizeTodos(todos)} · ${summarizeNotepads(notepads)}`,
					},
				],
				details: {
					todos: todoDetails.todos,
					notepads: notepadDetails.notepads,
					promotedIds,
					mode,
					updatedAt: Date.now(),
				},
			};
		},
		renderCall(args, theme) {
			const count = Array.isArray(args.ids)
				? args.ids.length
				: Array.isArray(args.topics)
					? args.topics.length
					: 0;
			void count;
			// Best-effort preview; exact selection resolves at execute time.
			return renderNotepadCallComponent(
				theme,
				`promote (${typeof args.mode === "string" ? args.mode : "append"})`,
				notepads.length,
			);
		},
		renderResult(result, _opts, theme) {
			const details = result.details as
				| { todos?: TodoItem[]; notepads?: NotepadItem[] }
				| undefined;
			void renderPromoteCallText;
			return renderNotepadResultComponent(theme, details?.notepads ?? notepads);
		},
	});

	pi.registerCommand("todos", {
		description: "Toggle the sticky todo widget, or /todos clear to empty it",
		getArgumentCompletions: (prefix: string) => {
			const items = [{ value: "clear", label: "clear", description: "Clear the todo list" }];
			const filtered = items.filter((item) => item.value.startsWith(prefix.trim()));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			if (args.trim() === "clear") {
				todos = [];
				expandedTodo = false;
				pi.appendEntry(STATE_ENTRY_TYPE, { todos: [] });
				paintTodos(ctx);
				if (ctx.hasUI) ctx.ui.notify("Todos cleared", "info");
				return;
			}
			await toggleTodoExpanded(ctx);
		},
	});

	pi.registerCommand("notepad", {
		description: "Toggle the notepad widget, or /notepad clear to empty it",
		getArgumentCompletions: (prefix: string) => {
			const items = [{ value: "clear", label: "clear", description: "Clear the notepad" }];
			const filtered = items.filter((item) => item.value.startsWith(prefix.trim()));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			if (args.trim() === "clear") {
				notepads = [];
				expandedNotepad = false;
				pi.appendEntry(NOTEPAD_STATE_ENTRY_TYPE, { notepads: [] });
				paintNotepad(ctx);
				if (ctx.hasUI) ctx.ui.notify("Notepad cleared", "info");
				return;
			}
			await toggleNotepadExpanded(ctx);
		},
	});

	pi.registerCommand("discuss", {
		description: "Enter/exit discussion mode (diverge + curate Notepad, no code changes)",
		getArgumentCompletions: (prefix: string) => {
			const items = [
				{ value: "start", label: "start", description: "Enter discussion mode" },
				{ value: "stop", label: "stop", description: "Exit discussion mode" },
			];
			const filtered = items.filter((item) => item.value.startsWith(prefix.trim()));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "stop" || arg === "exit" || arg === "off") {
				if (!discussing) {
					if (ctx.hasUI) ctx.ui.notify("Not in discussion mode", "info");
					return;
				}
				setDiscussing(false, ctx);
				return;
			}
			if (arg === "start" || arg === "on") {
				if (discussing) {
					if (ctx.hasUI) ctx.ui.notify("Already in discussion mode", "info");
					return;
				}
				setDiscussing(true, ctx);
				return;
			}
			// Bare /discuss toggles.
			setDiscussing(!discussing, ctx);
		},
	});

	for (const shortcut of SHORTCUTS) {
		pi.registerShortcut(shortcut, {
			description: `Expand or collapse the sticky todo widget (${SHORTCUT})`,
			handler: toggleTodoExpanded,
		});
	}
	for (const shortcut of NOTEPAD_SHORTCUTS) {
		pi.registerShortcut(shortcut, {
			description: `Expand or collapse the notepad widget (${NOTEPAD_SHORTCUT})`,
			handler: toggleNotepadExpanded,
		});
	}
}

const plainTheme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	strikethrough: (text: string) => text,
};
