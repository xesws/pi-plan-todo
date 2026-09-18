import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	addNotepadItem,
	convertNotepadsToTodos,
	removeNotepadItems,
	selectPromoteSubset,
	updateNotepadItem,
	validateNotepads,
	summarizeNotepads,
} from "../src/schema.ts";
import { reconstructNotepads, type BranchEntry } from "../src/state.ts";
import { formatNotepadLines, selectVisibleNotepads } from "../src/widget.ts";
import { hasSuccessfulTodoWriteAfter } from "../src/plan-hook.ts";

const theme = {
	fg: (_c: string, t: string) => t,
	bold: (t: string) => t,
	strikethrough: (t: string) => t,
};

describe("notepad model", () => {
	it("requires topic and defaults priority/status", () => {
		const list = addNotepadItem([], { content: "Try RAG", topic: "RAG" });
		assert.equal(list.length, 1);
		assert.equal(list[0]?.topic, "RAG");
		assert.equal(list[0]?.priority, "medium");
		assert.equal(list[0]?.status, "open");
	});

	it("rejects resolved without designDoc", () => {
		assert.throws(
			() =>
				validateNotepads([
					{
						id: "n1",
						content: "x",
						topic: "RAG",
						priority: "medium",
						status: "resolved",
						createdAt: 1,
						updatedAt: 1,
					},
				]),
			/designDoc/,
		);
	});

	it("update to resolved requires designDoc", () => {
		let list = addNotepadItem([], { content: "Load test", topic: "perf" });
		const id = list[0]!.id;
		assert.throws(() => updateNotepadItem(list, id, { status: "resolved" }), /designDoc/);
		list = updateNotepadItem(list, id, { status: "resolved", designDoc: "docs/perf.md" });
		assert.equal(list[0]?.status, "resolved");
	});

	it("remove drops ids", () => {
		let list = addNotepadItem([], { content: "a", topic: "t1" });
		list = addNotepadItem(list, { content: "b", topic: "t2" });
		const id = list[0]!.id;
		list = removeNotepadItems(list, [id]);
		assert.equal(list.length, 1);
		assert.equal(list[0]?.topic, "t2");
	});
});

describe("promote selector", () => {
	const seed = () => {
		let list = addNotepadItem([], {
			content: "Embed",
			topic: "RAG",
			priority: "high",
			id: "n-embed",
		});
		list = addNotepadItem(list, { content: "Chunk", topic: "RAG", id: "n-chunk" });
		list = addNotepadItem(list, { content: "k6", topic: "perf", id: "n-k6" });
		list = updateNotepadItem(list, "n-embed", { status: "resolved", designDoc: "docs/rag.md" });
		list = updateNotepadItem(list, "n-k6", { status: "resolved", designDoc: "docs/perf.md" });
		return list;
	};

	it("selects by ids in order and enforces resolved", () => {
		const list = seed();
		assert.throws(() => selectPromoteSubset(list, { ids: ["n-chunk"] }), /not resolved/);
		const picked = selectPromoteSubset(list, { ids: ["n-k6", "n-embed"] });
		assert.deepEqual(
			picked.map((n) => n.id),
			["n-k6", "n-embed"],
		);
	});

	it("selects by topic sorted by priority", () => {
		const list = seed();
		const picked = selectPromoteSubset(list, { topics: ["RAG"] });
		assert.deepEqual(
			picked.map((n) => n.id),
			["n-embed"],
		);
	});

	it("converts to todos append with single in_progress", () => {
		const list = seed();
		const picked = selectPromoteSubset(list, { ids: ["n-embed", "n-k6"] });
		const todos = convertNotepadsToTodos(picked, [], "append");
		assert.equal(todos.length, 2);
		assert.equal(todos[0]?.status, "in_progress");
		assert.equal(todos[1]?.status, "pending");
		assert.match(summarizeNotepads(list), /2 topics/);
	});
});

describe("notepad state", () => {
	it("reconstructs from last snapshot", () => {
		const snap = validateNotepads([
			{
				id: "n1",
				content: "a",
				topic: "RAG",
				priority: "medium",
				status: "open",
				createdAt: 1,
				updatedAt: 1,
			},
		]);
		const entries: BranchEntry[] = [
			{
				type: "message",
				message: { role: "toolResult", toolName: "notepad_add", isError: false, details: { notepads: snap } },
			},
		];
		assert.deepEqual(reconstructNotepads(entries), snap);
	});

	it("promote satisfies implement steering gate", () => {
		const decision = hasSuccessfulTodoWriteAfter(
			[
				{ type: "custom", customType: "plan-mode-state", data: { enabled: false, activeImplementation: { id: "x" } } },
				{
					type: "message",
					message: {
						role: "toolResult",
						toolName: "notepad_promote",
						isError: false,
						details: {
							todos: [{ id: "1", content: "Do", status: "in_progress" }],
							notepads: [],
						},
					},
				},
			],
			0,
		);
		assert.equal(decision, true);
	});
});

describe("notepad widget", () => {
	it("hides resolved unless expanded and groups by topic", () => {
		let list = addNotepadItem([], { content: "Embed", topic: "RAG", id: "a" });
		list = addNotepadItem(list, { content: "k6", topic: "perf", id: "b" });
		list = updateNotepadItem(list, "a", { status: "resolved", designDoc: "docs/rag.md" });
		const collapsed = selectVisibleNotepads(list, false);
		assert.equal(collapsed.visible.length, 1);
		assert.equal(collapsed.archived, 1);
		const lines = formatNotepadLines(theme, list, false);
		assert.ok(lines[0]?.includes("Notepad"));
		assert.ok(lines.some((l) => l.includes("archived")));
		const expanded = formatNotepadLines(theme, list, true);
		assert.ok(expanded.some((l) => l.includes("RAG")));
	});
});
