/**
 * Behaviour check for the loopback test-email route.
 *
 * The route is exercised with fake Node request/response objects, so method,
 * loopback and header guards plus the exact JSON response are verifiable
 * without a web server or a mailbox.
 */
import assert from "node:assert/strict";
import { handleTestEmail, installTestEmail, TEST_EMAIL_PATH } from "../test-email.js";

const NS = "dsh-thinking-depth";

const BASE = {
	thinkingDepth: true,
	notifications: true,
	email: true,
	smtpHost: "smtp.example.com",
	smtpPort: 465,
	smtpSecure: true,
	smtpUser: "u@example.com",
	smtpPass: "secret",
	emailFrom: "秋风萧瑟",
	emailTo: "to@example.com, second@example.com",
};

/** Fake host context with one settings row. */
function context(value = BASE) {
	return {
		logger: { debug() {} },
		settings: {
			describe: () => [{ ns: NS, value: { ...value } }],
		},
	};
}

/** Fake Node request carrying one JSON body. */
function request(overrides = {}) {
	const { body = "{}", headers = {}, socket = {}, method = "POST" } = overrides;
	return {
		method,
		headers: {
			"content-type": "application/json",
			"x-dsh-test-email": "1",
			...headers,
		},
		socket: { remoteAddress: "127.0.0.1", ...socket },
		async *[Symbol.asyncIterator]() {
			yield Buffer.from(body);
		},
	};
}

/** Fake Node response capturing status, headers and body. */
function response() {
	return {
		statusCode: 0,
		headers: {},
		body: "",
		setHeader(key, value) {
			this.headers[key] = value;
		},
		end(value) {
			this.body = value;
		},
	};
}

// 1. Success reports the recipients and forces the email copy on.
{
	let seen;
	const res = response();
	await handleTestEmail(
		context(),
		request(),
		res,
		{
			sendEmail: async (_notification, settings) => {
				seen = settings;
				return { ok: true };
			},
		},
	);
	const payload = JSON.parse(res.body);
	assert.equal(res.statusCode, 200);
	assert.equal(payload.ok, true);
	assert.match(payload.message, /to@example\.com/u);
	assert.equal(seen.email, true);
	assert.equal(seen.smtpPass, "secret");
}

// 2. A sender failure becomes the response error.
{
	const res = response();
	await handleTestEmail(context(), request(), res, {
		sendEmail: async () => ({ ok: false, error: "535 Authentication failed" }),
	});
	assert.equal(res.statusCode, 200);
	assert.deepEqual(JSON.parse(res.body), {
		ok: false,
		error: "535 Authentication failed",
	});
}

// 3. Method, loopback, header and content-type guards.
{
	for (const [overrides, status] of [
		[{ method: "GET" }, 405],
		[{ socket: { remoteAddress: "192.168.1.10" } }, 403],
		[{ headers: { "x-dsh-test-email": "" } }, 403],
		[{ headers: { "content-type": "text/plain" } }, 415],
	]) {
		const res = response();
		await handleTestEmail(context(), request(overrides), res);
		assert.equal(res.statusCode, status);
		assert.equal(JSON.parse(res.body).ok, false);
	}
}

// 4. A malformed body is rejected before any transport starts.
{
	let sent = 0;
	const res = response();
	await handleTestEmail(context(), request({ body: "not-json" }), res, {
		sendEmail: async () => {
			sent += 1;
			return { ok: true };
		},
	});
	assert.equal(res.statusCode, 400);
	assert.equal(sent, 0);
}

// 5. The route is registered on the web server when that service exists.
{
	let route;
	let injected = false;
	const ctx = context();
	ctx.inject = (names, callback) => {
		assert.deepEqual(names, ["webServer"]);
		injected = true;
		callback({
			effect(callback) {
				callback();
			},
			webServer: {
				register(next) {
					route = next;
					return () => {};
				},
			},
		});
	};
	installTestEmail(ctx);
	assert.equal(injected, true);
	assert.equal(route.kind, "exact");
	assert.equal(route.path, TEST_EMAIL_PATH);
	assert.equal(typeof route.handler, "function");
}

console.log("test email: all behaviour checks passed");
