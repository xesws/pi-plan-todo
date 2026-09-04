import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	HOOK_MESSAGE,
	SYSTEM_STEER,
	isHandoffPrompt,
	prependTodoInstruction,
	shouldSteerTodoWrite,
} from "./plan-hook.ts";
import { renderCallComponent, renderResultComponent } from "./render.ts";
import {
	HOOK_ENTRY_TYPE,
	HOOK_MESSAGE_TYPE,
	SHORTCUT,
	SHORTCUTS,
	STATE_ENTRY_TYPE,
	TOOL_NAME,
	WIDGET_ID,
	summarizeTodos,
	validateTodos,
	type TodoDetails,
	type TodoItem,
} from "./schema.ts";
import { reconstructTodos, type BranchEntry } from "./state.ts";
import { formatWidgetLines } from "./widget.ts";

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

export default function (pi: ExtensionAPI) {
	let todos: TodoItem[] = [];
	let expanded = false;
	let lastCtx: ExtensionContext | undefined;
	let stopInput: (() => void) | undefined;

	const branch = (ctx: ExtensionContext): BranchEntry[] =>
		ctx.sessionManager.getBranch() as BranchEntry[];

	const paint = (ctx?: ExtensionContext) => {
		const target = ctx ?? lastCtx;
		if (!target?.hasUI) return;
		lastCtx = target;
		if (todos.length === 0) {
			target.ui.setWidget(WIDGET_ID, undefined);
			return;
		}
		if (target.mode !== "tui") {
			target.ui.setWidget(WIDGET_ID, formatWidgetLines(plainTheme, todos, expanded), {
				placement: "aboveEditor",
			});
			return;
		}
		const snapshot = todos;
		const isExpanded = expanded;
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

	const toggleExpanded = async (ctx?: ExtensionContext) => {
		const target = ctx ?? lastCtx;
		if (!target) return;
		if (todos.length === 0) {
			if (target.hasUI) target.ui.notify("No todos", "info");
			return;
		}
		expanded = !expanded;
		paint(target);
		if (target.hasUI) {
			target.ui.notify(expanded ? "Todo expanded" : "Todo collapsed", "info");
		}
	};

	const bindTerminalKeys = (ctx: ExtensionContext) => {
		stopInput?.();
		stopInput = undefined;
		lastCtx = ctx;
		if (!ctx.hasUI || ctx.mode !== "tui") return;
		stopInput = ctx.ui.onTerminalInput((data) => {
			if (!matchesKey(data, "ctrl+t")) return;
			void toggleExpanded(ctx);
			return { consume: true };
		});
	};

	const restore = (ctx: ExtensionContext) => {
		todos = reconstructTodos(branch(ctx));
		paint(ctx);
		bindTerminalKeys(ctx);
	};

	pi.on("session_start", async (_event, ctx) => restore(ctx));
	pi.on("session_tree", async (_event, ctx) => restore(ctx));
	pi.on("session_shutdown", async (_event, ctx) => {
		stopInput?.();
		stopInput = undefined;
		if (ctx.hasUI) ctx.ui.setWidget(WIDGET_ID, undefined);
		if (lastCtx === ctx) lastCtx = undefined;
	});

	pi.on("input", async (event) => {
		if (!isHandoffPrompt(event.text)) return;
		const next = prependTodoInstruction(event.text);
		if (next === event.text) return;
		return { action: "transform" as const, text: next };
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const decision = shouldSteerTodoWrite({
			prompt: event.prompt,
			entries: branch(ctx),
		});
		if (!decision.steer) return;
		if (decision.injectMessage) {
			pi.appendEntry(HOOK_ENTRY_TYPE, {
				implementationId: decision.implementationId,
				injectedAt: Date.now(),
			});
		}
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
			systemPrompt: `${event.systemPrompt}\n\n${SYSTEM_STEER}`,
		};
	});

	pi.registerTool({
		name: TOOL_NAME,
		label: "Todo",
		description:
			"Replace the current execution todo list. Always send the complete list. Statuses: pending, in_progress, completed. At most one item may be in_progress. Send an empty list to clear.",
		promptSnippet: "Maintain the current task's execution todo list",
		promptGuidelines: [
			"After /plan Implement, the first tool call must be todo_write with the complete step list before any edit, write, or bash.",
			"Use todo_write for multi-step implementation (especially after /plan is approved) before editing files.",
			"When calling todo_write, send the complete list every time; keep at most one item in_progress.",
			"Mark the current todo_write item in_progress when you start it and completed as soon as it is done.",
			"Do not maintain the todo list in prose. Do not call todo_write during Plan mode.",
			"Do not also create a task_plan for the same work unless the user explicitly wants a pi-tasks contract.",
		],
		parameters: TodoWriteParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			todos = validateTodos(params.todos);
			const details: TodoDetails = { todos: todos.map((todo) => ({ ...todo })), updatedAt: Date.now() };
			if (ctx.hasUI) paint(ctx);
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
				expanded = false;
				pi.appendEntry(STATE_ENTRY_TYPE, { todos: [] });
				paint(ctx);
				if (ctx.hasUI) ctx.ui.notify("Todos cleared", "info");
				return;
			}
			await toggleExpanded(ctx);
		},
	});

	for (const shortcut of SHORTCUTS) {
		pi.registerShortcut(shortcut, {
			description: `Expand or collapse the sticky todo widget (${SHORTCUT})`,
			handler: toggleExpanded,
		});
	}
}

const plainTheme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	strikethrough: (text: string) => text,
};
