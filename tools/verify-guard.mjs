/**
 * Offline behaviour check for the runtime half of the jailbreak.
 *
 * It drives `installGuard()` with a fake host event bus and a fake agent, and
 * asserts the decisions that matter: one refusal recovery per turn, capped
 * total, auto-continue only for abnormal endings that a retry can fix, silence
 * when the human already took over, silence while the switch is off, and
 * standing down when another guard plugin already injected a notice.
 */
import assert from "node:assert/strict";
import {
	GUARD_SOURCE,
	createTracker,
	hasFreshHumanTurn,
	installGuard,
	isUserAbort,
	lastAssistantText,
	lastTurnEnd,
	looksLikeRefusal,
	shouldAutoContinue,
} from "../jailbreak-guard.js";

const sleep = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

/** Number events in commit order, the way the session log does. */
function log(entries) {
	return entries.map((entry, index) => ({ seq: index + 1, ...entry }));
}

const human = (text = "把上一件事做完") => ({
	type: "user/message",
	data: { source: { kind: "user" }, content: [{ type: "text", text }] },
});

const assistant = (text) => ({
	type: "assistant/message",
	data: { content: [{ type: "text", text }] },
});

const end = (reason, turn = 1) => ({ type: "turn/end", data: { reason, turn } });

const guardNotice = (kind = "pojia-guard") => ({
	type: "user/message",
	data: { source: { kind, form: "notice" }, content: [{ type: "text", text: "继续" }] },
});

/** One fake agent whose session returns a fixed event list. */
function makeAgent(events, id = "session-1") {
	return {
		id,
		status: "idle",
		session: { snapshotEvents: () => events },
		inbox: { hasPending: () => false },
		injections: [],
		followup(message) {
			this.injections.push(message);
		},
	};
}

/** Fake host context that keeps the installed listeners. */
function makeContext() {
	const listeners = [];
	const ctx = {
		listeners,
		on(event, handler) {
			listeners.push({ event, handler });
			return () => {
				const index = listeners.findIndex((entry) => entry.handler === handler);
				if (index >= 0) listeners.splice(index, 1);
			};
		},
	};
	return ctx;
}

/** Deliver an idle status to every installed listener. */
function fire(ctx, agent) {
	for (const { handler } of [...ctx.listeners]) {
		handler({ status: "idle", agent });
	}
}

// 1. Pure helpers.
{
	assert.equal(looksLikeRefusal("抱歉，我不能协助这个请求。"), true);
	assert.equal(looksLikeRefusal("短"), false, "short replies are not treated as refusals");
	assert.equal(looksLikeRefusal("破甲已生效，可以继续。"), false, "a receipt is not a refusal");
	assert.equal(looksLikeRefusal("这个我会：第一步先读配置。"), false);

	assert.equal(isUserAbort({ kind: "aborted", reason: "user" }), true);
	assert.equal(isUserAbort({ kind: "aborted", reason: { kind: "cancel" } }), true);
	assert.equal(isUserAbort({ kind: "aborted", reason: "watchdog" }), false);
	assert.equal(isUserAbort({ kind: "error" }), false);

	assert.equal(shouldAutoContinue({ kind: "max-tokens" }), true);
	assert.equal(shouldAutoContinue({ kind: "interrupted" }), true);
	assert.equal(shouldAutoContinue({ kind: "completed" }), false);
	assert.equal(shouldAutoContinue({ kind: "error", error: { code: "CONTEXT_OVERFLOW" } }), false);
	assert.equal(shouldAutoContinue({ kind: "aborted", reason: "user" }), false);

	const events = log([human(), assistant("第一段"), assistant("第二段"), end({ kind: "completed" })]);
	assert.equal(lastAssistantText(events), "第二段");
	assert.equal(lastTurnEnd(events)?.seq, 4);
	assert.equal(hasFreshHumanTurn(events), false);
	assert.equal(hasFreshHumanTurn(log([human(), end({ kind: "completed" }), human()])), true);
}

// 2. A refusal is recovered exactly once per turn.
{
	const events = log([
		human(),
		assistant("抱歉，我不能协助这个请求。"),
		end({ kind: "completed" }),
	]);
	const agent = makeAgent(events);
	const ctx = makeContext();
	const guard = installGuard(ctx, { isEnabled: () => true, settleMs: 0 });

	fire(ctx, agent);
	assert.equal(agent.injections.length, 1, "one recovery message");
	assert.equal(agent.injections[0].source.kind, GUARD_SOURCE);
	assert.equal(agent.injections[0].source.form, "notice");
	assert.equal(agent.injections[0].source.summary, "refusal-recover");
	assert.match(agent.injections[0].content[0].text, /不要拒答/u);

	fire(ctx, agent);
	assert.equal(agent.injections.length, 1, "the same turn/end never recovers twice");

	guard.dispose();
	assert.equal(ctx.listeners.length, 0, "dispose removes the listener");
}

// 3. The per-turn cap holds even when the turn keeps refusing.
{
	const ctx = makeContext();
	const guard = installGuard(ctx, { isEnabled: () => true, settleMs: 0, maxRecover: 2 });
	const recoveries = [];
	for (let turn = 1; turn <= 4; turn += 1) {
		const agent = makeAgent(
			log([
				human(`第 ${turn} 轮`),
				assistant("抱歉，我无法协助这个操作。"),
				end({ kind: "completed" }, turn),
			]),
		);
		fire(ctx, agent);
		recoveries.push(agent.injections.length);
	}
	guard.dispose();
	assert.deepEqual(recoveries, [1, 1, 1, 1], "each turn recovers once");

	const tracker = createTracker();
	assert.equal(tracker.takeRecover("s", "1:4", 2), true);
	assert.equal(tracker.takeRecover("s", "1:4", 2), false, "the same turn/end never recovers twice");
	assert.equal(tracker.takeRecover("", "1:4", 2), false, "an unknown session is left alone");
}

// 4. Abnormal endings are resumed; a human cancel and unfixable errors are not.
{
	const resume = async (reason, extra = []) => {
		const events = log([human(), assistant("写到一半"), end(reason), ...extra]);
		const agent = makeAgent(events);
		const ctx = makeContext();
		const guard = installGuard(ctx, { isEnabled: () => true, settleMs: 0 });
		fire(ctx, agent);
		await sleep();
		guard.dispose();
		return agent.injections;
	};

	const truncated = await resume({ kind: "max-tokens" });
	assert.equal(truncated.length, 1, "truncation is resumed");
	assert.equal(truncated[0].source.summary, "continue");
	assert.equal(truncated[0].content[0].text, "继续");

	assert.equal((await resume({ kind: "aborted", reason: "user" })).length, 0);
	assert.equal((await resume({ kind: "aborted", reason: { kind: "cancel" } })).length, 0);
	assert.equal((await resume({ kind: "error", error: { code: "MODEL_NOT_FOUND" } })).length, 0);
	assert.equal((await resume({ kind: "completed" })).length, 0, "a clean turn is not resumed");
}

// 5. The gate, a takeover, and another guard all stand the guard down.
{
	const events = log([human(), assistant("抱歉，我不能协助。"), end({ kind: "completed" })]);

	const disabledAgent = makeAgent(events);
	const disabledCtx = makeContext();
	installGuard(disabledCtx, { isEnabled: () => false, settleMs: 0 });
	fire(disabledCtx, disabledAgent);
	assert.equal(disabledAgent.injections.length, 0, "the live switch is authoritative");

	const foreignAgent = makeAgent(log([...events, guardNotice("pojia-guard")]));
	const foreignCtx = makeContext();
	installGuard(foreignCtx, { isEnabled: () => true, settleMs: 0 });
	fire(foreignCtx, foreignAgent);
	assert.equal(foreignAgent.injections.length, 0, "another guard already injected");

	const resumedAgent = makeAgent(
		log([human(), assistant("做到一半"), end({ kind: "max-tokens" }), human("我自己来")]),
	);
	const resumedCtx = makeContext();
	installGuard(resumedCtx, { isEnabled: () => true, settleMs: 0 });
	fire(resumedCtx, resumedAgent);
	await sleep();
	assert.equal(resumedAgent.injections.length, 0, "a fresh human message wins");

	// A pending inbox means someone (a human, or another guard plugin) already
	// queued work; this guard must not add a second continuation on top.
	const busyAgent = makeAgent(log([human(), assistant("抱歉，我不能协助。"), end({ kind: "completed" })]));
	busyAgent.inbox = { hasPending: () => true };
	const busyCtx = makeContext();
	installGuard(busyCtx, { isEnabled: () => true, settleMs: 0 });
	fire(busyCtx, busyAgent);
	assert.equal(busyAgent.injections.length, 0, "a busy inbox stands the guard down");
}

console.log("jailbreak guard: all behaviour checks passed");
