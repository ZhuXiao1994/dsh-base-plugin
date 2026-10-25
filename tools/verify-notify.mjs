/**
 * Behaviour check for the attention notifier.
 *
 * It imports the real `notify.js` and drives the pure builders plus the
 * installer against a fake host context, so the exact toast text, the root /
 * subagent decision, dedupe, cancellation and cleanup are verifiable without a
 * running Harness or a real Windows toast.
 *
 * A real toast is exercised separately by `tools/notify-smoke.mjs`; this file
 * never starts PowerShell.
 */
import assert from "node:assert/strict";
import {
	buildApprovalNotification,
	buildDoneNotification,
	buildQuestionNotification,
	classifyTurnEnd,
	formatBody,
	formatDuration,
	installAttention,
	isRootAgent,
	isRootSession,
	lastTurn,
	sessionTitle,
} from "../notify.js";
import { buildToastScript, toastIconPath } from "../notify-windows.js";

const NOW = 1_700_000_000_000;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A session-shaped object with the one accessor the notifier reads. */
function makeSession({ id = "session-1", header = {}, events = [] } = {}) {
	return { id, header, events, snapshotEvents: () => events };
}

/** An event log with a title and one completed turn. */
function completedEvents({ title = "处理登录问题", end = NOW - 1_000, start = end - 55_000 } = {}) {
	return [
		{ type: "session/title", seq: 0, time: start - 1_000, data: { title } },
		{ type: "turn/start", seq: 1, time: start, data: { turn: 1 } },
		{ type: "turn/end", seq: 2, time: end, data: { turn: 1, reason: { kind: "completed" } } },
	];
}

/** A minimal Cordis-shaped context that records listeners and runs effects. */
function fakeContext() {
	const listeners = new Map();
	let cleanup = null;
	return {
		logger: { debug() {}, warn() {} },
		on(name, listener) {
			const list = listeners.get(name) ?? [];
			list.push(listener);
			listeners.set(name, list);
			return () => {
				const index = list.indexOf(listener);
				if (index >= 0) list.splice(index, 1);
			};
		},
		emit(name, ...args) {
			for (const listener of [...(listeners.get(name) ?? [])]) listener(...args);
		},
		effect(setup) {
			cleanup = setup();
			return () => cleanup?.();
		},
		dispose() {
			cleanup?.();
			cleanup = null;
		},
		listenerCount(name) {
			return (listeners.get(name) ?? []).length;
		},
	};
}

/** An agent-shaped payload for `agent/status`. */
function makeAgent(session, options = {}) {
	return { id: session.id, session, options };
}

// 1. Turn-end classification is silent for human stops and app-side moves.
{
	assert.equal(classifyTurnEnd({ kind: "completed" }).kind, "done");
	assert.equal(classifyTurnEnd({ kind: "error", error: { message: "boom" } }).kind, "error");
	assert.equal(classifyTurnEnd({ kind: "error", error: { message: "boom" } }).detail, "boom");
	assert.equal(classifyTurnEnd({ kind: "max-tokens" }).kind, "limit");
	assert.equal(classifyTurnEnd({ kind: "blocked" }).kind, "blocked");
	assert.equal(classifyTurnEnd({ kind: "aborted", reason: { kind: "user" } }), null);
	assert.equal(classifyTurnEnd({ kind: "interrupted" }), null);
	assert.equal(classifyTurnEnd({ kind: "forked" }), null);
	assert.equal(classifyTurnEnd(undefined), null);
}

// 2. Root / subagent detection reads the durable header and the runtime option.
{
	assert.equal(isRootSession(makeSession()), true);
	assert.equal(isRootSession(makeSession({ header: { delegationDepth: 0 } })), true);
	assert.equal(isRootSession(makeSession({ header: { delegationDepth: 1 } })), false);
	assert.equal(isRootSession(makeSession({ header: { parentSession: "parent" } })), false);
	assert.equal(isRootSession(makeSession({ header: { origin: "subagent" } })), false);
	assert.equal(isRootAgent(makeAgent(makeSession())), true);
	assert.equal(isRootAgent(makeAgent(makeSession({ header: { delegationDepth: 1 } }))), false);
	assert.equal(isRootAgent({ session: makeSession(), options: { subagentDepth: 1 } }), false);
}

// 3. Title and duration fold what the UI would show.
{
	const session = makeSession({ events: completedEvents() });
	assert.equal(sessionTitle(session), "处理登录问题");
	assert.equal(formatDuration(55_000), "55 秒");
	assert.equal(formatDuration(1_116_000), "18 分 36 秒");
	assert.equal(formatDuration(3_600_000), "1 小时");
	assert.equal(formatDuration(3_720_000), "1 小时 02 分");
	assert.equal(formatDuration(500), "");
	assert.equal(formatDuration(undefined), "");
	assert.equal(lastTurn(session).durationMs, 55_000);
	assert.equal(lastTurn(makeSession()), null);
}

// 4. Completion bodies carry the title, duration, or failure detail.
{
	const session = makeSession({ events: completedEvents() });
	const done = buildDoneNotification(session, session.id, NOW);
	assert.equal(done.title, "DSH：任务完成");
	assert.equal(done.body, "「处理登录问题」已完成 · 用时 55 秒");
	assert.equal(done.kind, "done");

	const errorSession = makeSession({
		events: [
			{ type: "turn/start", seq: 0, time: NOW - 2_000, data: { turn: 1 } },
			{
				type: "turn/end",
				seq: 1,
				time: NOW - 1_000,
				data: { turn: 1, reason: { kind: "error", error: { message: "upstream 502" } } },
			},
		],
	});
	const failed = buildDoneNotification(errorSession, errorSession.id, NOW);
	assert.equal(failed.title, "DSH：任务出错");
	assert.match(failed.body, /upstream 502/u);

	// A stale turn is not "the task that just finished".
	assert.equal(buildDoneNotification(session, session.id, NOW + 11 * 60_000), null);
	// A turn with no useful reason stays silent.
	const aborted = makeSession({
		events: [
			{ type: "turn/start", seq: 0, time: NOW - 2_000, data: { turn: 1 } },
			{ type: "turn/end", seq: 1, time: NOW - 1_000, data: { turn: 1, reason: { kind: "aborted" } } },
		],
	});
	assert.equal(buildDoneNotification(aborted, aborted.id, NOW), null);
}

// 5. A question carries its text, options and multi-select marker.
{
	const session = makeSession({ events: completedEvents() });
	const event = {
		type: "tool/call",
		seq: 10,
		data: {
			callId: "call-1",
			name: "ask_user_question",
			arguments: JSON.stringify({
				questions: [
					{
						id: "mode",
						question: "选哪个模式？",
						options: [{ label: "快速" }, { label: "完整" }, { label: "仅预览" }],
						multi_select: true,
					},
				],
			}),
		},
	};
	const question = buildQuestionNotification(session, event);
	assert.equal(question.title, "DSH：需要你的选择");
	assert.match(question.body, /处理登录问题/u);
	assert.match(question.body, /选哪个模式？/u);
	assert.match(question.body, /选项：快速 \/ 完整 \/ 仅预览/u);
	assert.match(question.body, /可多选/u);

	// Unparseable arguments still produce a useful generic reminder.
	const broken = buildQuestionNotification(session, {
		type: "tool/call",
		seq: 11,
		data: { name: "ask_user_question", arguments: "{not json" },
	});
	assert.equal(broken.title, "DSH：需要你的选择");
	assert.match(broken.body, /需要你的选择/u);
}

// 6. Approval reminders name the tool and keep the reason.
{
	const session = makeSession({ events: completedEvents() });
	const approval = buildApprovalNotification(session, {
		type: "approval/asked",
		seq: 20,
		data: { id: "approval-1", toolName: "pwsh", reason: "命令需要写入工作区" },
	});
	assert.equal(approval.title, "DSH：需要你的确认");
	assert.match(approval.body, /pwsh/u);
	assert.match(approval.body, /命令需要写入工作区/u);
}

// 7. Body normalization never splits a surrogate pair and always truncates.
{
	assert.equal(formatBody("  a\n\tb  "), "a b");
	assert.equal(formatBody("a\u0000b\u0007c"), "a b c");
	const emoji = "🙂".repeat(200);
	const cut = formatBody(emoji, 10);
	assert.equal(Array.from(cut).length, 10);
	assert.ok(cut.endsWith("…"));
}

// 8. The installer raises one completion, one question and one approval, and
//    suppresses duplicates.
{
	const context = fakeContext();
	const sent = [];
	assert.equal(
		installAttention(context, {
			send: (notification) => sent.push(notification),
			now: () => NOW,
			doneDelayMs: 5,
			fallbackDoneDelayMs: 5,
		}),
		true,
	);
	assert.equal(context.listenerCount("agent/status"), 1);
	assert.equal(context.listenerCount("session/event"), 1);

	const session = makeSession({ events: completedEvents() });
	context.emit("agent/status", { agent: makeAgent(session), status: "running" });
	context.emit("agent/status", { agent: makeAgent(session), status: "idle" });
	await wait(25);
	assert.equal(sent.length, 1);
	assert.equal(sent[0].kind, "done");

	const questionEvent = {
		type: "tool/call",
		seq: 30,
		data: {
			callId: "call-1",
			name: "ask_user_question",
			arguments: JSON.stringify({ questions: [{ id: "q", question: "继续吗？" }] }),
		},
	};
	context.emit("session/event", session, questionEvent);
	context.emit("session/event", session, questionEvent);
	assert.equal(sent.length, 2);
	assert.equal(sent[1].kind, "question");

	context.emit("session/event", session, {
		type: "approval/asked",
		seq: 31,
		data: { id: "approval-1", toolName: "edit" },
	});
	context.emit("session/event", session, {
		type: "approval/asked",
		seq: 32,
		data: { id: "approval-1", toolName: "edit" },
	});
	assert.equal(sent.length, 3);
	assert.equal(sent[2].kind, "approval");

	// A later turn is a different occurrence and must notify again: the done
	// dedupe is keyed by the turn's end sequence, not by the session alone.
	session.events.push(
		{ type: "turn/start", seq: 33, time: NOW, data: { turn: 2 } },
		{ type: "turn/end", seq: 34, time: NOW + 2_000, data: { turn: 2, reason: { kind: "completed" } } },
	);
	context.emit("agent/status", { agent: makeAgent(session), status: "running" });
	context.emit("agent/status", { agent: makeAgent(session), status: "idle" });
	await wait(25);
	assert.equal(sent.length, 4);
	assert.equal(sent[3].kind, "done");

	context.dispose();
	context.emit("agent/status", { agent: makeAgent(session), status: "idle" });
	await wait(10);
	assert.equal(sent.length, 4, "disposal removes the listeners");
}

// 9. A new turn cancels a pending completion; a subagent never notifies.
{
	const context = fakeContext();
	const sent = [];
	installAttention(context, {
		send: (notification) => sent.push(notification),
		now: () => NOW,
		doneDelayMs: 20,
		fallbackDoneDelayMs: 5,
	});
	const session = makeSession({ events: completedEvents() });
	context.emit("session/event", session, {
		type: "turn/end",
		seq: 40,
		time: NOW - 1_000,
		data: { turn: 1, reason: { kind: "completed" } },
	});
	context.emit("session/event", session, { type: "turn/start", seq: 41, data: { turn: 2 } });
	await wait(25);
	assert.equal(sent.length, 0, "turn/start cancels the fallback timer");

	const child = makeSession({ id: "child", header: { delegationDepth: 1 }, events: completedEvents() });
	context.emit("agent/status", { agent: makeAgent(child), status: "idle" });
	context.emit("session/event", child, {
		type: "tool/call",
		seq: 42,
		data: { callId: "child-call", name: "ask_user_question", arguments: '{"questions":[]}' },
	});
	await wait(10);
	assert.equal(sent.length, 0, "a subagent stays silent");
	context.dispose();
}

// 10. The turn/end fallback still fires when no agent/status event is seen.
{
	const context = fakeContext();
	const sent = [];
	installAttention(context, {
		send: (notification) => sent.push(notification),
		now: () => NOW,
		doneDelayMs: 1,
		fallbackDoneDelayMs: 5,
	});
	const session = makeSession({ events: completedEvents() });
	context.emit("session/event", session, {
		type: "turn/end",
		seq: 50,
		time: NOW - 1_000,
		data: { turn: 1, reason: { kind: "completed" } },
	});
	await wait(20);
	assert.equal(sent.length, 1);
	assert.equal(sent[0].kind, "done");
	context.dispose();
}

// 11. The opt-out installs nothing, and malformed payloads are survivable.
{
	const context = fakeContext();
	assert.equal(installAttention(context, { notifications: false }), false);
	assert.equal(context.listenerCount("agent/status"), 0);
	assert.equal(context.listenerCount("session/event"), 0);

	const live = fakeContext();
	installAttention(live, { send() {}, doneDelayMs: 0, fallbackDoneDelayMs: 0 });
	live.emit("agent/status", undefined);
	live.emit("agent/status", { agent: {}, status: "idle" });
	live.emit("session/event", undefined, undefined);
	live.emit("session/event", undefined, { type: "tool/call", data: {} });
	await wait(10);
	live.dispose();
}

// 12. The PowerShell script escapes quotes and carries the packaged icon.
{
	const script = buildToastScript("标题'with quote", "正文 <&> \"quoted\"");
	assert.match(script, /\$textNodes\[0\]\.AppendChild\(\$xml\.CreateTextNode\('标题''with quote'\)\)/u);
	assert.match(script, /CreateToastNotifier\(\$appId\)\.Show\(\$toast\)/u);
	assert.match(script, /ms-winsoundevent:Notification\.Default/u);

	const iconScript = buildToastScript("t", "b", { iconPath: "C:\\Program Files\\DSH\\icon.png" });
	assert.match(iconScript, /file:\/\/\/C:\/Program Files\/DSH\/icon\.png/u);
	assert.match(iconScript, /appLogoOverride/u);

	const icon = toastIconPath();
	assert.equal(typeof icon, "string");
	assert.ok(icon.endsWith("icon.png"));
}

console.log("attention notifier: all behaviour checks passed");
