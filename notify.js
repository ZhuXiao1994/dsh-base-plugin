/**
 * Attention notifier — the second host-only feature of the bundle.
 *
 * It raises a desktop notification when the agent stops working on a task and
 * when the session is blocked on the human:
 *
 * - a turn finished (completed, failed, hit its output limit, or was blocked);
 * - `ask_user_question` opened a choice UI;
 * - an approval request is waiting for a decision.
 *
 * Sources are the host's own session/agent events, so nothing is polled and a
 * replayed or restored session cannot notify twice: only live appends reach
 * `session/event`. Subagent sessions are ignored — the human owns the root
 * session, and a chatty child would otherwise steal the toast.
 *
 * Delivery is deliberately fire-and-forget. A notification failure must never
 * turn into an agent failure; every listener contains its own errors, and the
 * Windows sender never throws into the event loop.
 */

import { sendWindowsToast } from "./notify-windows.js";

/** The model-facing tool that opens a choice UI. */
const ASK_TOOL = "ask_user_question";
/** Settle time after `agent/status: idle` before the completion toast. */
const DEFAULT_DONE_DELAY_MS = 400;
/** Fallback settle time after `turn/end` when no status event reaches us. */
const FALLBACK_DONE_DELAY_MS = 2_500;
/** A question, approval or turn id is unique; this only guards against replays. */
const ATTENTION_DEDUPE_MS = 60_000;
/** A `turn/end` older than this is not "the task that just finished". */
const DONE_FRESHNESS_MS = 10 * 60_000;
/** Maximum characters in one toast body. */
const BODY_LIMIT = 160;

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/** @param value - candidate. @returns a non-empty string, or "". */
function textOf(value) {
	return typeof value === "string" ? value.trim() : "";
}

/**
 * The event log of one session, across the historical/current accessors.
 * @param session - session-like object from an event payload.
 * @returns its events, or an empty array when the shape is unknown.
 */
function eventsOf(session) {
	try {
		if (Array.isArray(session?.events)) return session.events;
		if (typeof session?.snapshotEvents === "function") return session.snapshotEvents();
		if (typeof session?.ownEvents === "function") return session.ownEvents();
	} catch {
		/* A malformed session must not break the listener. */
	}
	return [];
}

/** @param session - session-like object. @returns its durable id, or "". */
export function sessionIdOf(session) {
	const raw = session?.id ?? session?.header?.id;
	if (typeof raw === "string") return raw;
	if (raw === null || raw === undefined) return "";
	try {
		return String(raw);
	} catch {
		return "";
	}
}

/**
 * Whether a session is a human-owned root rather than a delegated child.
 * Unknown shapes are treated as root: missing a completion is worse than one
 * extra toast.
 * @param session - session-like object.
 * @returns true for a root session.
 */
export function isRootSession(session) {
	try {
		const header = session?.header;
		if (!isRecord(header)) return true;
		if (typeof header.delegationDepth === "number" && header.delegationDepth > 0) return false;
		if (header.parentSession !== undefined && header.parentSession !== null) return false;
		if (header.origin === "subagent") return false;
		return true;
	} catch {
		return true;
	}
}

/**
 * Whether an agent is a root agent.
 * @param agent - agent-like object from `agent/status`.
 * @returns true for a root agent.
 */
export function isRootAgent(agent) {
	try {
		if (!isRootSession(agent?.session)) return false;
		const depth = agent?.options?.subagentDepth;
		if (typeof depth === "number" && depth > 0) return false;
		return true;
	} catch {
		return true;
	}
}

/** @param content - message content blocks. @returns joined text, or "". */
function textOfContent(content) {
	if (!Array.isArray(content)) return "";
	return content
		.filter((block) => block?.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n")
		.trim();
}

/**
 * A short human label for a session: its title, else its first user prompt,
 * else a stable fallback id. This is the same fold the native session title
 * uses (`session/title` last-wins).
 * @param session - session-like object.
 * @param id - optional pre-read session id.
 * @returns a label suitable for a toast body.
 */
export function sessionTitle(session, id = sessionIdOf(session)) {
	const events = eventsOf(session);
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event?.type !== "session/title") continue;
		const title = textOf(event.data?.title);
		if (title !== "") return title;
	}
	for (const event of events) {
		if (event?.type !== "user/message") continue;
		if (event?.data?.source?.kind !== "user") continue;
		const text = textOfContent(event.data.content).replace(/\s+/g, " ").trim();
		if (text !== "") return text;
	}
	const short = typeof id === "string" ? id.slice(0, 8) : "";
	return short === "" ? "当前会话" : `会话 ${short}`;
}

/**
 * The last finished turn of a session, with its completion reason and wall
 * time (when both boundaries are present).
 * @param session - session-like object.
 * @returns `{ reason, durationMs, endTime }`, or null when no turn finished.
 */
export function lastTurn(session) {
	const events = eventsOf(session);
	let endIndex = -1;
	for (let index = events.length - 1; index >= 0; index -= 1) {
		if (events[index]?.type === "turn/end") {
			endIndex = index;
			break;
		}
	}
	if (endIndex === -1) return null;
	const end = events[endIndex];
	const turn = end.data?.turn;
	let start = undefined;
	for (let index = endIndex - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event?.type === "turn/start" && event.data?.turn === turn) {
			start = event;
			break;
		}
	}
	const endTime = typeof end.time === "number" ? end.time : null;
	const startTime = typeof start?.time === "number" ? start.time : null;
	return {
		reason: end.data?.reason,
		endSeq: typeof end.seq === "number" ? end.seq : null,
		endTime,
		durationMs:
			startTime !== null && endTime !== null && endTime >= startTime ? endTime - startTime : null,
	};
}

/**
 * Classify a `turn/end` reason. `aborted`, `interrupted` and `forked` are
 * deliberately silent: the human stopped the work or the app moved it.
 * @param reason - `TurnEndReason` from a session event.
 * @returns a toast headline and kind, or null when this end is not worth one.
 */
export function classifyTurnEnd(reason) {
	const kind = reason?.kind;
	switch (kind) {
		case "completed":
			return { kind: "done", title: "DSH：任务完成" };
		case "error":
			return {
				kind: "error",
				title: "DSH：任务出错",
				detail: textOf(reason?.error?.message) || textOf(reason?.error?.code),
			};
		case "max-tokens":
			return { kind: "limit", title: "DSH：输出达到上限" };
		case "blocked":
			return { kind: "blocked", title: "DSH：任务被阻塞" };
		default:
			return null;
	}
}

/**
 * Render a duration compactly, in the style the rest of the app uses.
 * @param durationMs - elapsed milliseconds.
 * @returns `"55 秒"`, `"18 分 36 秒"`, `"1 小时 02 分"`, or "" when not useful.
 */
export function formatDuration(durationMs) {
	if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 1_000) return "";
	const totalSeconds = Math.round(durationMs / 1_000);
	if (totalSeconds < 60) return `${String(totalSeconds)} 秒`;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes < 60) {
		return seconds === 0
			? `${String(minutes)} 分`
			: `${String(minutes)} 分 ${String(seconds).padStart(2, "0")} 秒`;
	}
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest === 0 ? `${String(hours)} 小时` : `${String(hours)} 小时 ${String(rest).padStart(2, "0")} 分`;
}

/**
 * Collapse arbitrary text into one toast-body line, truncating on code-point
 * boundaries so a surrogate pair is never split.
 * @param value - arbitrary text.
 * @param maxLen - maximum characters, ellipsis included.
 * @returns the normalized body.
 */
export function formatBody(value, maxLen = BODY_LIMIT) {
	const normalized = String(value ?? "")
		.replace(/[\u0000-\u001f\u007f]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	const limit = Math.max(1, Math.floor(Number(maxLen) || BODY_LIMIT));
	const characters = Array.from(normalized);
	if (characters.length <= limit) return normalized;
	return `${characters.slice(0, limit - 1).join("")}…`;
}

/**
 * Build the toast for a finished turn.
 * @param session - session-like object.
 * @param id - optional session id.
 * @param now - clock for the freshness guard.
 * @returns the notification, or null when this turn should stay silent.
 */
export function buildDoneNotification(session, id = sessionIdOf(session), now = Date.now()) {
	const turn = lastTurn(session);
	if (turn === null) return null;
	const classification = classifyTurnEnd(turn.reason);
	if (classification === null) return null;
	if (turn.endTime !== null && now - turn.endTime > DONE_FRESHNESS_MS) return null;

	const title = formatBody(sessionTitle(session, id), 80);
	const duration = formatDuration(turn.durationMs);
	let body;
	if (classification.kind === "done") {
		body = `「${title}」已完成`;
		if (duration !== "") body += ` · 用时 ${duration}`;
	} else if (classification.kind === "error") {
		body = `「${title}」执行失败`;
		if (classification.detail) body += `：${classification.detail}`;
	} else if (classification.kind === "limit") {
		body = `「${title}」在输出上限处结束`;
		if (duration !== "") body += ` · 用时 ${duration}`;
	} else {
		body = `「${title}」被阻塞，等待处理`;
	}
	return { kind: classification.kind, title: classification.title, body: formatBody(body) };
}

/** @param text - raw tool arguments. @returns the parsed object, or null. */
function parseArguments(text) {
	if (typeof text !== "string" || text.trim() === "") return null;
	try {
		const parsed = JSON.parse(text);
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * Build the toast for an `ask_user_question` call: the model is blocked until
 * the human chooses.
 * @param session - session-like object.
 * @param event - the `tool/call` session event.
 * @param id - optional session id.
 * @returns the notification.
 */
export function buildQuestionNotification(session, event, id = sessionIdOf(session)) {
	const args = parseArguments(event?.data?.arguments);
	const questions = Array.isArray(args?.questions) ? args.questions.filter(isRecord) : [];
	const first = questions[0];
	const title = formatBody(sessionTitle(session, id), 80);
	let body = `「${title}」`;
	if (first !== undefined) {
		const question = textOf(first.question) || textOf(first.header) || "需要你的选择";
		body += question;
		const options = Array.isArray(first.options)
			? first.options
					.map((option) => textOf(option?.label))
					.filter((label) => label !== "")
					.slice(0, 4)
			: [];
		if (options.length > 0) {
			const more = Array.isArray(first.options) && first.options.length > options.length ? "…" : "";
			body += `（选项：${options.join(" / ")}${more}）`;
		}
		if (first.multi_select === true) body += "（可多选）";
		if (questions.length > 1) body += ` 等 ${String(questions.length)} 个问题`;
	} else {
		body += "需要你的选择";
	}
	return {
		kind: "question",
		title: "DSH：需要你的选择",
		body: formatBody(body),
	};
}

/**
 * Build the toast for an approval request.
 * @param session - session-like object.
 * @param event - the `approval/asked` session event.
 * @param id - optional session id.
 * @returns the notification.
 */
export function buildApprovalNotification(session, event, id = sessionIdOf(session)) {
	const data = event?.data;
	const title = formatBody(sessionTitle(session, id), 80);
	const tool = textOf(data?.toolName);
	let body = `「${title}」`;
	body += tool === "" ? "有操作等待你的确认" : `工具 ${tool} 请求授权`;
	const reason = textOf(data?.reason);
	if (reason !== "") body += `：${reason}`;
	return {
		kind: "approval",
		title: "DSH：需要你的确认",
		body: formatBody(body),
	};
}

/** @param ctx - host plugin context. @returns a tiny logger with debug/warn. */
function makeLogger(ctx) {
	const host = ctx?.logger;
	return {
		debug:
			typeof host?.debug === "function"
				? host.debug.bind(host)
				: () => {
						/* logging is optional */
					},
		warn:
			typeof host?.warn === "function"
				? host.warn.bind(host)
				: (message) => console.warn(String(message)),
	};
}

/** @param error - unknown thrown value. @returns a human-readable cause. */
function describe(error) {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Install the attention notifier on a host plugin context.
 *
 * The feature is on by default. Pass `notifications: false` to disable it
 * without uninstalling the bundle; `send`, `now`, `doneDelayMs`,
 * `fallbackDoneDelayMs` and `sound` are test seams.
 *
 * @param ctx - host plugin context (`on`, `effect`, `logger`).
 * @param options - notifier options.
 * @returns whether the notifier was installed.
 */
export function installAttention(ctx, options = {}) {
	if (options?.notifications === false) return false;

	const logger = makeLogger(ctx);
	const now = typeof options.now === "function" ? options.now : Date.now;
	const doneDelayMs = Number.isFinite(options.doneDelayMs)
		? Math.max(0, options.doneDelayMs)
		: DEFAULT_DONE_DELAY_MS;
	const fallbackDoneDelayMs = Number.isFinite(options.fallbackDoneDelayMs)
		? Math.max(0, options.fallbackDoneDelayMs)
		: FALLBACK_DONE_DELAY_MS;
	const send =
		typeof options.send === "function"
			? options.send
			: (notification) =>
					sendWindowsToast(notification.title, notification.body, {
						logger,
						sound: options.sound !== false,
					});

	/** Pending completion timers, keyed by session id. */
	const pending = new Map();
	/** Dedupe marks for already-raised notifications. */
	const seen = new Map();

	const pruneSeen = (ts) => {
		if (seen.size < 256) return;
		for (const [key, at] of seen) if (ts - at > ATTENTION_DEDUPE_MS) seen.delete(key);
		while (seen.size >= 256) {
			const oldest = seen.keys().next().value;
			if (oldest === undefined) break;
			seen.delete(oldest);
		}
	};

	/**
	 * Raise one notification at most once per dedupe window.
	 * @param key - stable identity of this occurrence.
	 * @param notification - already-formatted notification.
	 * @returns whether it was handed to the sender.
	 */
	const notify = (key, notification) => {
		if (!isRecord(notification)) return false;
		const ts = now();
		const last = seen.get(key);
		if (last !== undefined && ts - last < ATTENTION_DEDUPE_MS) return false;
		seen.set(key, ts);
		pruneSeen(ts);
		try {
			const result = send(notification);
			if (result !== null && typeof result?.then === "function") {
				result.then(undefined, (error) => {
					logger.debug("thinking-depth: notification send rejected: %s", describe(error));
				});
			}
		} catch (error) {
			logger.debug("thinking-depth: notification send threw: %s", describe(error));
		}
		return true;
	};

	/** @param sessionId - session whose pending completion should be dropped. */
	const cancelDone = (sessionId) => {
		if (sessionId === "") return;
		const timer = pending.get(sessionId);
		if (timer === undefined) return;
		clearTimeout(timer);
		pending.delete(sessionId);
	};

	/**
	 * Schedule one completion toast; a newer signal replaces the pending one.
	 * @param sessionId - owning session.
	 * @param session - session-like object used for the body.
	 * @param delayMs - settle time.
	 */
	const scheduleDone = (sessionId, session, delayMs = doneDelayMs) => {
		if (sessionId === "") return;
		cancelDone(sessionId);
		const timer = setTimeout(() => {
			pending.delete(sessionId);
			try {
				const turn = lastTurn(session);
				if (turn === null) return;
				const notification = buildDoneNotification(session, sessionId, now());
				if (notification !== null) notify(`done:${sessionId}:${String(turn.endSeq ?? "?")}`, notification);
			} catch (error) {
				logger.debug("thinking-depth: completion notification failed: %s", describe(error));
			}
		}, Math.max(0, delayMs));
		if (typeof timer.unref === "function") timer.unref();
		pending.set(sessionId, timer);
	};

	const onStatus = (payload) => {
		try {
			const agent = payload?.agent;
			const status = payload?.status;
			if (!isRecord(agent) || typeof status !== "string") return;
			if (!isRootAgent(agent)) return;
			const session = agent.session;
			const sessionId = sessionIdOf(agent) || sessionIdOf(session);
			if (sessionId === "") return;
			if (status === "running") {
				cancelDone(sessionId);
				return;
			}
			if (status === "idle") scheduleDone(sessionId, session);
		} catch (error) {
			logger.debug("thinking-depth: agent/status handling failed: %s", describe(error));
		}
	};

	const onSessionEvent = (session, event) => {
		try {
			if (!isRecord(event) || typeof event.type !== "string") return;
			if (!isRootSession(session)) return;
			const sessionId = sessionIdOf(session);
			if (sessionId === "") return;
			switch (event.type) {
				case "turn/start":
					cancelDone(sessionId);
					return;
				case "turn/end":
					// Fallback when the agent/status event is unavailable or filtered
					// out; the status event normally replaces this timer with a shorter one.
					scheduleDone(sessionId, session, Math.max(doneDelayMs, fallbackDoneDelayMs));
					return;
				case "tool/call": {
					if (event.data?.name !== ASK_TOOL) return;
					const occurrence = event.data?.callId ?? event.seq ?? "?";
					notify(`question:${sessionId}:${String(occurrence)}`, buildQuestionNotification(session, event, sessionId));
					return;
				}
				case "approval/asked": {
					const occurrence = event.data?.id ?? event.seq ?? "?";
					notify(`approval:${sessionId}:${String(occurrence)}`, buildApprovalNotification(session, event, sessionId));
					return;
				}
				default:
					return;
			}
		} catch (error) {
			logger.debug("thinking-depth: session event handling failed: %s", describe(error));
		}
	};

	const install = () => {
		const offStatus = ctx.on("agent/status", onStatus, { global: true });
		const offSession = ctx.on("session/event", onSessionEvent, { global: true });
		return () => {
			if (typeof offStatus === "function") offStatus();
			if (typeof offSession === "function") offSession();
			for (const timer of pending.values()) clearTimeout(timer);
			pending.clear();
			seen.clear();
		};
	};

	if (typeof ctx.effect === "function") {
		ctx.effect(install, "thinking-depth: attention notifier");
	} else {
		install();
	}
	return true;
}
