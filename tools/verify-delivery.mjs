/**
 * Behaviour check for reminder channel dispatch.
 *
 * The notifier decides *when* a reminder happens; `createDelivery` decides
 * *which channels* carry it. This drives the real dispatcher with fake toast
 * and email transports, so local/email selection and failure isolation are
 * verifiable without a desktop or a mail server.
 */
import assert from "node:assert/strict";
import { createDelivery } from "../delivery.js";

const BASE = {
	thinkingDepth: true,
	notifications: true,
	email: true,
	smtpHost: "smtp.example.com",
	smtpPort: 587,
	smtpSecure: false,
	smtpUser: "",
	emailFrom: "from@example.com",
	emailTo: "to@example.com",
};

/** Fake host context whose settings row is supplied by the test. */
function context(value) {
	const logs = [];
	return {
		logs,
		settings: {
			describe: () => [{ ns: "dsh-thinking-depth", value }],
		},
		logger: { debug: (...args) => logs.push(args) },
	};
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// 1. Both channels selected: both transports receive one notification.
{
	const ctx = context(BASE);
	const calls = [];
	const deliver = createDelivery(ctx, {
		toast: (title) => calls.push(`local:${title}`),
		email: async (notification) => {
			calls.push(`email:${notification.title}`);
		},
	});
	deliver({ title: "DSH：任务完成", body: "done", ts: 1 });
	await tick();
	assert.deepEqual(calls, ["local:DSH：任务完成", "email:DSH：任务完成"]);
}

// 2. Channel selection is live.
{
	const ctx = context({ ...BASE, notifications: false });
	const calls = [];
	const deliver = createDelivery(ctx, {
		toast: () => calls.push("local"),
		email: async () => {
			calls.push("email");
		},
	});
	deliver({ title: "t", body: "b" });
	await tick();
	assert.deepEqual(calls, ["email"]);

	ctx.settings.describe = () => [{ ns: "dsh-thinking-depth", value: { ...BASE, email: false } }];
	deliver({ title: "t", body: "b" });
	await tick();
	assert.deepEqual(calls, ["email", "local"]);
}

// 3. The static master switch disables both channels.
{
	const ctx = context(BASE);
	const calls = [];
	const deliver = createDelivery(ctx, {
		allow: () => false,
		toast: () => calls.push("local"),
		email: async () => {
			calls.push("email");
		},
	});
	deliver({ title: "t", body: "b" });
	await tick();
	assert.deepEqual(calls, []);
}

// 4. One channel failing never suppresses the other.
{
	const ctx = context(BASE);
	const calls = [];
	const deliver = createDelivery(ctx, {
		toast: () => {
			throw new Error("toast failed");
		},
		email: async () => {
			calls.push("email");
		},
	});
	deliver({ title: "t", body: "b" });
	await tick();
	assert.deepEqual(calls, ["email"]);
	assert.ok(ctx.logs.some((entry) => String(entry[0]).includes("local reminder failed")));

	const ctx2 = context(BASE);
	const calls2 = [];
	const deliver2 = createDelivery(ctx2, {
		toast: () => calls2.push("local"),
		email: async () => {
			throw new Error("smtp failed");
		},
	});
	deliver2({ title: "t", body: "b" });
	await tick();
	assert.deepEqual(calls2, ["local"]);
	assert.ok(ctx2.logs.some((entry) => String(entry[0]).includes("email reminder rejected")));
}

console.log("reminder delivery: all behaviour checks passed");
