import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	DISCUSS_STATE_ENTRY_TYPE,
	DISCUSS_SYSTEM_STEER,
	discussBlockReason,
	isDiscussActive,
	isPlanModeEnabled,
	shouldBlockDiscussTool,
} from "../src/discuss.ts";
import { PLAN_MODE_STATE_TYPE } from "../src/plan-hook.ts";
import type { BranchEntry } from "../src/state.ts";
import { formatNotepadLines } from "../src/widget.ts";
import { validateNotepads } from "../src/schema.ts";

const theme = {
	fg: (_c: string, t: string) => t,
	bold: (t: string) => t,
	strikethrough: (t: string) => t,
};

const discussEntry = (enabled: boolean): BranchEntry => ({
	type: "custom",
	customType: DISCUSS_STATE_ENTRY_TYPE,
	data: { enabled },
});

const planEntry = (enabled: boolean): BranchEntry => ({
	type: "custom",
	customType: PLAN_MODE_STATE_TYPE,
	data: { enabled },
});

describe("discuss state", () => {
	it("is inactive with no entries", () => {
		assert.equal(isDiscussActive([]), false);
	});

	it("last entry wins", () => {
		assert.equal(isDiscussActive([discussEntry(true)]), true);
		assert.equal(isDiscussActive([discussEntry(true), discussEntry(false)]), false);
		assert.equal(
			isDiscussActive([discussEntry(false), discussEntry(true), discussEntry(false)]),
			false,
		);
	});

	it("ignores other custom entries", () => {
		assert.equal(
			isDiscussActive([{ type: "custom", customType: "other", data: { enabled: true } }]),
			false,
		);
	});
});

describe("plan overlap", () => {
	it("detects enabled plan mode from latest entry", () => {
		assert.equal(isPlanModeEnabled([]), false);
		assert.equal(isPlanModeEnabled([planEntry(true)]), true);
		assert.equal(isPlanModeEnabled([planEntry(true), planEntry(false)]), false);
	});
});

describe("discuss tool block", () => {
	it("blocks mutation and execution-list tools", () => {
		for (const name of ["edit", "write", "bash", "powershell", "todo_write", "notepad_promote"]) {
			assert.equal(shouldBlockDiscussTool(name), true, name);
		}
	});

	it("allows reads, search and notepad curation", () => {
		for (const name of ["read", "ls", "grep", "find", "notepad_add", "notepad_update", "notepad_remove"]) {
			assert.equal(shouldBlockDiscussTool(name), false, name);
		}
		assert.equal(shouldBlockDiscussTool(undefined), false);
	});

	it("explains converge path for todo/promote", () => {
		assert.match(discussBlockReason("todo_write"), /\/discuss stop.*\/plan/);
		assert.match(discussBlockReason("edit"), /\/discuss stop/);
	});
});

describe("discuss steer prompt", () => {
	it("covers notepad rules, topic example and done condition", () => {
		assert.match(DISCUSS_SYSTEM_STEER, /notepad_add/);
		assert.match(DISCUSS_SYSTEM_STEER, /SPLIT big items/);
		assert.match(DISCUSS_SYSTEM_STEER, /partitionKey/);
		assert.match(DISCUSS_SYSTEM_STEER, /RAG/);
		assert.match(DISCUSS_SYSTEM_STEER, /load-test/);
		assert.match(DISCUSS_SYSTEM_STEER, /\/discuss stop.*\/plan/);
		assert.match(DISCUSS_SYSTEM_STEER, /designDoc/);
	});
});

describe("discuss widget badge", () => {
	const notes = validateNotepads([
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

	it("shows badge only when discussing", () => {
		const plain = formatNotepadLines(theme, notes, false);
		assert.ok(plain[0]?.includes("Notepad"));
		assert.ok(!plain[0]?.includes("[discussing]"));
		const badged = formatNotepadLines(theme, notes, false, "[discussing]");
		assert.ok(badged[0]?.includes("Notepad [discussing]"));
	});
});
