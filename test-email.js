/**
 * Settings-driven test email.
 *
 * The Settings section cannot call host code directly, so the Host exposes one
 * loopback-only HTTP route. The route is CSRF-guarded by a custom header (which
 * forces a CORS preflight from any other origin) and by rejecting non-loopback
 * peers. It reads the live settings and performs one SMTP send; the browser gets
 * the exact success/failure message and renders it next to the button.
 *
 * No settings write is involved: the test never enters the settings HMR
 * transaction, which is what makes the result reliable.
 */

import { readSettings } from "./settings.js";
import { formatDateTime, parseRecipients, sendEmailDetailed } from "./email.js";

/** Exact path claimed on the host web server. */
export const TEST_EMAIL_PATH = "/dsh-thinking-depth/test-email";

const TEST_TITLE = "DSH 邮箱推送测试";
const TEST_BODY = [
	"这是一封来自 DSH 的测试邮件。",
	"如果你收到它，说明 SMTP 服务器、账号和收发件地址都已经配置正确。",
].join("\n");
const MAX_BODY = 4096;

/** @param req - Node request. @returns whether the peer is on this machine. */
function isLoopback(req) {
	const address = String(req.socket?.remoteAddress ?? "");
	return (
		address === "::1" ||
		address.startsWith("127.") ||
		address.startsWith("::ffff:127.")
	);
}

/** @param res - Node response. @param status - HTTP status. @param payload - JSON. */
function reply(res, status, payload) {
	res.statusCode = status;
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.setHeader("cache-control", "no-store");
	res.end(JSON.stringify(payload));
}

/** Read and parse a bounded JSON body. @param req - Node request. */
async function readJson(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > MAX_BODY) throw new Error("请求体过大");
		chunks.push(chunk);
	}
	const text = Buffer.concat(chunks).toString("utf8");
	return text === "" ? {} : JSON.parse(text);
}

/**
 * Handle one test-send request.
 * @param ctx - host plugin context with the `settings` service.
 * @param req - Node request.
 * @param res - Node response.
 * @param options - test/implementation seams.
 * @param options.sendEmail - sender used by the test; defaults to the real one.
 */
export async function handleTestEmail(ctx, req, res, options = {}) {
	if (req.method !== "POST") {
		reply(res, 405, { ok: false, error: "只支持 POST" });
		return;
	}
	if (!isLoopback(req)) {
		reply(res, 403, { ok: false, error: "仅允许本机测试发送" });
		return;
	}
	if (String(req.headers["x-dsh-test-email"] ?? "") !== "1") {
		reply(res, 403, { ok: false, error: "缺少测试请求头" });
		return;
	}
	if (!String(req.headers["content-type"] ?? "").includes("application/json")) {
		reply(res, 415, { ok: false, error: "请求必须是 JSON" });
		return;
	}
	try {
		await readJson(req);
	} catch (error) {
		reply(res, 400, {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		});
		return;
	}

	const send = typeof options.sendEmail === "function" ? options.sendEmail : sendEmailDetailed;
	const settings = readSettings(ctx);
	try {
		const result = await send(
			{ title: TEST_TITLE, body: TEST_BODY, ts: Date.now() },
			{ ...settings, email: true },
			{ logger: ctx.logger },
		);
		if (result.ok) {
			const recipients = parseRecipients(settings.emailTo).join(", ");
			reply(res, 200, {
				ok: true,
				message: `已发送到 ${recipients} · ${formatDateTime(Date.now())}`,
			});
			return;
		}
		reply(res, 200, { ok: false, error: result.error });
	} catch (error) {
		reply(res, 200, {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

/**
 * Install the test-email route when the host has a web server.
 * @param ctx - host plugin context with the `settings` service.
 * @param options - test/implementation seams forwarded to the handler.
 */
export function installTestEmail(ctx, options = {}) {
	ctx.inject(["webServer"], (webCtx) => {
		webCtx.effect(
			() =>
				webCtx.webServer.register({
					kind: "exact",
					path: TEST_EMAIL_PATH,
					handler: (req, res) => handleTestEmail(ctx, req, res, options),
				}),
			"thinking-depth: test email route",
		);
	});
}
