import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	HOOK_MESSAGE,
	findActiveImplementation,
	isHandoffPrompt,
	prependTodoInstruction,
	shouldSteerTodoWrite,
} from "../src/plan-hook.ts";
import { COLLAPSED_LIMIT, validateTodos, type TodoItem } from "../src/schema.ts";
import { reconstructTodos, type BranchEntry } from "../src/state.ts";
import { formatCollapsedMore, selectVisibleTodos } from "../src/widget.ts";

const sample = (
	overrides: Array<Partial<TodoItem> & Pick<TodoItem, "id" | "content" | "status">>,
): TodoItem[] => validateTodos(overrides);

describe("validateTodos", () => {
	it("accepts a legal list", () => {
		const todos = sample([
			{ id: "1", content: "Explore", status: "completed" },
			{ id: "2", content: "Implement", status: "in_progress" },
			{ id: "3", content: "Verify", status: "pending" },
		]);
		assert.equal(todos.length, 3);
		assert.equal(todos[1]?.status, "in_progress");
	});

	it("rejects two in_progress items", () => {
		assert.throws(
			() =>
				sample([
					{ id: "1", content: "A", status: "in_progress" },
					{ id: "2", content: "B", status: "in_progress" },
				]),
			/at most one/,
		);
	});

	it("rejects duplicate ids", () => {
		assert.throws(
			() =>
				sample([
					{ id: "1", content: "A", status: "pending" },
					{ id: "1", content: "B", status: "pending" },
				]),
			/duplicate id/,
		);
	});

	it("rejects empty content", () => {
		assert.throws(
			() => sample([{ id: "1", content: "  ", status: "pending" }]),
			/content must be non-empty/,
		);
	});
});

describe("collapse", () => {
	it("keeps the in_progress item in a 5-line window", () => {
		const todos = sample(
			Array.from({ length: 8 }, (_, index) => ({
				id: `S${index + 1}`,
				content: `Step ${index + 1}`,
				status:
					index === 1
						? ("completed" as const)
						: index === 2
							? ("in_progress" as const)
							: ("pending" as const),
			})),
		);
		// S2 completed, S3 in_progress, S4-S8 pending → 8 items
		const slice = selectVisibleTodos(todos, false);
		assert.ok(slice.visible.length <= COLLAPSED_LIMIT);
		assert.ok(slice.visible.some((todo) => todo.status === "in_progress"));
		assert.equal(slice.hidden, 3);
		assert.equal(slice.hiddenPending, 3);
		assert.match(formatCollapsedMore(todos, false) ?? "", /\+3 more \(3 pending\)/);
	});
});

describe("reconstruct", () => {
	it("uses the last successful write and skips errors", () => {
		const first = sample([{ id: "a", content: "One", status: "pending" }]);
		const second = sample([
			{ id: "a", content: "One", status: "completed" },
			{ id: "b", content: "Two", status: "in_progress" },
		]);
		const entries: BranchEntry[] = [
			{
				type: "message",
				message: {
					role: "toolResult",
					toolName: "todo_write",
					isError: false,
					details: { todos: first },
				},
			},
			{
				type: "message",
				message: {
					role: "toolResult",
					toolName: "todo_write",
					isError: true,
					details: { todos: [] },
				},
			},
			{
				type: "message",
				message: {
					role: "toolResult",
					toolName: "todo_write",
					isError: false,
					details: { todos: second },
				},
			},
		];
		assert.deepEqual(reconstructTodos(entries), second);
	});
});

describe("detectImplement", () => {
	it("matches both handoff prefixes and ignores ordinary prompts", () => {
		assert.equal(
			isHandoffPrompt(
				"Plan mode is now disabled. Full tool access is restored. Implement this proposed plan now:\n\n# Plan",
			),
			true,
		);
		assert.equal(
			isHandoffPrompt(
				"A previous agent produced the plan below to accomplish the user's task. Implement the plan.",
			),
			true,
		);
		assert.equal(isHandoffPrompt("Please implement the login form."), false);
		assert.equal(isHandoffPrompt("Implement the plan."), true);
		assert.equal(
			isHandoffPrompt(`${prependTodoInstruction("Implement the plan.")}`),
			true,
		);
	});

	it("does not treat a historical handoff as a live implement", () => {
		const decision = shouldSteerTodoWrite({
			prompt: "Please implement the login form.",
			entries: [
				{
					type: "message",
					message: {
						role: "user",
						content:
							"Plan mode is now disabled. Full tool access is restored. Implement this proposed plan now:\n\n# Old",
					},
				},
			],
		});
		assert.equal(decision.steer, false);
	});

	it("reads activeImplementation from plan-mode-state", () => {
		const found = findActiveImplementation([
			{
				type: "custom",
				customType: "plan-mode-state",
				data: { enabled: false, activeImplementation: { id: "impl-1" } },
			},
		]);
		assert.equal(found?.id, "impl-1");
	});
});

describe("hook", () => {
	it("keeps steering until todo_write even after the hook marker", () => {
		const entries: BranchEntry[] = [
			{
				type: "custom",
				customType: "plan-mode-state",
				data: { enabled: false, activeImplementation: { id: "impl-9" } },
			},
		];
		const first = shouldSteerTodoWrite({ prompt: "continue", entries });
		assert.equal(first.steer, true);
		if (!first.steer) return;
		assert.equal(first.implementationId, "impl-9");
		assert.equal(first.injectMessage, true);
		assert.ok(HOOK_MESSAGE.includes("todo_write"));

		const second = shouldSteerTodoWrite({
			prompt: "continue",
			entries: [
				...entries,
				{
					type: "custom",
					customType: "pi-plan-todo:hook",
					data: { implementationId: "impl-9", injectedAt: 1 },
				},
			],
		});
		assert.equal(second.steer, true);
		if (!second.steer) return;
		assert.equal(second.injectMessage, false);
	});

	it("does not steer after a successful todo_write in this implementation", () => {
		const decision = shouldSteerTodoWrite({
			prompt: "continue",
			entries: [
				{
					type: "custom",
					customType: "plan-mode-state",
					data: { enabled: false, activeImplementation: { id: "impl-2" } },
				},
				{
					type: "message",
					message: {
						role: "toolResult",
						toolName: "todo_write",
						isError: false,
						details: {
							todos: [{ id: "1", content: "Do it", status: "in_progress" }],
						},
					},
				},
			],
		});
		assert.equal(decision.steer, false);
	});
});
