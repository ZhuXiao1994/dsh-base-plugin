/**
 * Behaviour check for the SMTP email channel.
 *
 * It exercises the pure configuration/address/message builders and the sender
 * with an injected transport, so the exact SMTP options and mail fields are
 * verifiable without a mail server or the nodemailer dependency.
 */
import assert from "node:assert/strict";
import {
	buildEmail,
	formatDateTime,
	isEmailAddress,
	isEmailConfigured,
	parseRecipients,
	sendEmail,
} from "../email.js";

const BASE = {
	thinkingDepth: true,
	notifications: true,
	email: true,
	smtpHost: "smtp.example.com",
	smtpPort: 587,
	smtpSecure: false,
	smtpUser: "user@example.com",
	smtpPass: "app-password",
	emailFrom: "from@example.com",
	emailTo: "to@example.com, second@example.com",
};

const NOTIFICATION = {
	kind: "done",
	title: "DSH：任务完成",
	body: "「处理登录问题」已完成 · 用时 55 秒",
	ts: Date.UTC(2026, 10, 2, 2, 46, 39),
};

// 1. Recipient parsing and address checks.
{
	assert.deepEqual(parseRecipients(" a@x.com, b@y.com; c@z.com "), ["a@x.com", "b@y.com", "c@z.com"]);
	assert.deepEqual(parseRecipients("a@x.com, a@x.com"), ["a@x.com"]);
	assert.deepEqual(parseRecipients(undefined), []);
	assert.equal(isEmailAddress("a@x.com"), true);
	assert.equal(isEmailAddress("a@x"), false);
	assert.equal(isEmailAddress("a b@x.com"), false);
	assert.equal(isEmailAddress(undefined), false);
}

// 2. Configuration completeness, including the auth pair.
{
	assert.equal(isEmailConfigured(BASE), true);
	assert.equal(isEmailConfigured({ ...BASE, smtpUser: "", smtpPass: undefined }), true);
	assert.equal(isEmailConfigured({ ...BASE, smtpUser: "u", smtpPass: undefined }), false);
	assert.equal(isEmailConfigured({ ...BASE, smtpHost: "" }), false);
	assert.equal(isEmailConfigured({ ...BASE, emailFrom: "not-an-address" }), false);
	assert.equal(isEmailConfigured({ ...BASE, emailTo: "not-an-address" }), false);
	assert.equal(isEmailConfigured({ ...BASE, smtpPort: 0 }), false);
	assert.equal(isEmailConfigured({ ...BASE, smtpPort: 70_000 }), false);
}

// 3. The mail fields carry the reminder and never the SMTP password.
{
	const mail = buildEmail(NOTIFICATION, BASE, Date.UTC(2026, 10, 2, 2, 46, 39));
	assert.equal(mail.from, "from@example.com");
	assert.equal(mail.to, "to@example.com, second@example.com");
	assert.equal(mail.subject, "DSH：任务完成");
	assert.match(mail.text, /处理登录问题/u);
	assert.match(mail.text, /时间：/u);
	assert.match(mail.text, /来源：DSH Thinking Depth & Notifications/u);
	assert.equal(mail.text.includes("app-password"), false);
	assert.equal(formatDateTime(Date.UTC(2026, 10, 2, 2, 46, 39)).length > 0, true);
}

// 4. The sender maps the configuration onto nodemailer options.
{
	let options;
	let message;
	let closed = false;
	const createTransport = (next) => {
		options = next;
		return {
			async sendMail(nextMessage) {
				message = nextMessage;
				return { messageId: "test" };
			},
			close() {
				closed = true;
			},
		};
	};
	const logs = [];
	const sent = await sendEmail(NOTIFICATION, BASE, {
		createTransport,
		logger: { debug: (...args) => logs.push(args) },
		now: Date.UTC(2026, 10, 2, 2, 46, 39),
	});
	assert.equal(sent, true);
	assert.equal(options.host, "smtp.example.com");
	assert.equal(options.port, 587);
	assert.equal(options.secure, false);
	assert.equal(options.requireTLS, true);
	assert.deepEqual(options.auth, { user: "user@example.com", pass: "app-password" });
	assert.equal(options.logger, false);
	assert.equal(message.to, "to@example.com, second@example.com");
	assert.equal(message.text.includes("app-password"), false);
	assert.equal(closed, true);
	assert.ok(logs.length > 0);
}

// 5. Secure mode and no-auth mode.
{
	let options;
	const createTransport = (next) => {
		options = next;
		return { async sendMail() {}, close() {} };
	};
	await sendEmail(NOTIFICATION, { ...BASE, smtpSecure: true }, { createTransport });
	assert.equal(options.secure, true);
	assert.equal(options.requireTLS, false);

	await sendEmail(NOTIFICATION, { ...BASE, smtpUser: "", smtpPass: undefined }, { createTransport });
	assert.equal("auth" in options, false);
}

// 6. Disabled or incomplete email never starts a transport.
{
	let transports = 0;
	const createTransport = () => {
		transports += 1;
		return { async sendMail() {}, close() {} };
	};
	assert.equal(await sendEmail(NOTIFICATION, { ...BASE, email: false }, { createTransport }), false);
	assert.equal(await sendEmail(NOTIFICATION, { ...BASE, smtpHost: "" }, { createTransport }), false);
	assert.equal(transports, 0);
}

// 7. Transport failures resolve false and are logged, never thrown.
{
	const logs = [];
	const createTransport = () => ({
		async sendMail() {
			throw new Error("smtp down");
		},
		close() {},
	});
	assert.equal(
		await sendEmail(NOTIFICATION, BASE, {
			createTransport,
			logger: { debug: (...args) => logs.push(args) },
		}),
		false,
	);
	assert.ok(logs.some((entry) => String(entry[0]).includes("email reminder failed")));
}

console.log("email channel: all behaviour checks passed");
