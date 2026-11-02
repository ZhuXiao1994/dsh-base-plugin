/**
 * SMTP email delivery for task reminders.
 *
 * The transport is `nodemailer`, loaded lazily so a profile that only uses
 * local toasts never touches the dependency and a missing install degrades to
 * a debug log instead of failing the plugin row. The SMTP password is read
 * from the host-side settings descriptor and never leaves the process.
 *
 * All failures are contained: `sendEmail` resolves `false` and logs at debug
 * level, so a dead mail server cannot disturb the agent or the local toast.
 */

/**
 * Format an epoch-millisecond timestamp for the mail body.
 * @param ts - epoch milliseconds.
 * @returns a local `YYYY-MM-DD HH:mm:ss` string.
 */
export function formatDateTime(ts) {
	const date = new Date(ts);
	if (Number.isNaN(date.getTime())) return "";
	const pad = (value) => String(value).padStart(2, "0");
	return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Cached `nodemailer` module promise; a missing dependency is cached too. */
let nodemailerPromise;

/**
 * Load nodemailer without making the plugin import it at startup.
 * @returns the module namespace's default export.
 */
async function loadNodemailer() {
	nodemailerPromise ??= import("nodemailer").then((module) => module.default ?? module);
	return nodemailerPromise;
}

/**
 * Split a comma/semicolon separated recipient list.
 * @param value - configured recipient string.
 * @returns trimmed, de-duplicated, non-empty entries.
 */
export function parseRecipients(value) {
	const entries = String(value ?? "")
		.split(/[,;]/u)
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "");
	return [...new Set(entries)];
}

/**
 * A deliberately small address check: plain addr-spec only, no display names.
 * @param value - candidate address.
 * @returns whether it looks like `local@domain.tld`.
 */
export function isEmailAddress(value) {
	return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value.trim());
}

/**
 * Resolve the sender address. A non-address value in `emailFrom` is treated as
 * a display name the user typed by mistake and falls back to the SMTP
 * username when that is a valid address.
 * @param settings - resolved plugin settings.
 * @returns a plain sender address, or "" when neither field is usable.
 */
export function emailFromAddress(settings) {
	const configured = String(settings?.emailFrom ?? "").trim();
	if (isEmailAddress(configured)) return configured;
	const user = String(settings?.smtpUser ?? "").trim();
	return isEmailAddress(user) ? user : "";
}

/**
 * List the missing or invalid SMTP fields, in user-facing terms.
 * @param settings - resolved plugin settings.
 * @returns an empty list when the channel can attempt a send.
 */
export function emailConfigurationProblems(settings) {
	if (typeof settings !== "object" || settings === null) return ["SMTP 设置"];
	const problems = [];
	if (String(settings.smtpHost ?? "").trim() === "") problems.push("SMTP 服务器");
	const port = settings.smtpPort;
	if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push("端口");
	if (emailFromAddress(settings) === "") problems.push("发件人地址（留空时使用用户名）");
	const recipients = parseRecipients(settings.emailTo);
	if (recipients.length === 0 || !recipients.every(isEmailAddress)) problems.push("收件人地址");
	const user = String(settings.smtpUser ?? "").trim();
	const pass = settings.smtpPass;
	if (user !== "" && (typeof pass !== "string" || pass === "")) problems.push("SMTP 密码");
	if (user === "" && typeof pass === "string" && pass !== "") problems.push("SMTP 用户名");
	return problems;
}

/**
 * Whether the email channel has enough information to attempt a send.
 * `email` itself is checked separately; this only validates SMTP details.
 * @param settings - resolved plugin settings.
 * @returns whether host, port, sender, recipients and auth are complete.
 */
export function isEmailConfigured(settings) {
	return emailConfigurationProblems(settings).length === 0;
}

/**
 * Build the plain-text mail for one notification.
 * @param notification - accepted reminder payload.
 * @param settings - resolved plugin settings.
 * @param now - clock used when the payload has no timestamp.
 * @returns the mail fields, or null when the configuration is unusable.
 */
export function buildEmail(notification, settings, now = Date.now()) {
	if (!isEmailConfigured(settings)) return null;
	const from = emailFromAddress(settings);
	const recipients = parseRecipients(settings.emailTo);
	const timestamp = Number.isFinite(notification?.ts) ? notification.ts : now;
	const body = String(notification?.body ?? "").trim();
	const text = [
		body,
		"",
		"--",
		`时间：${formatDateTime(timestamp)}`,
		"来源：DSH Thinking Depth & Notifications",
	].join("\n");
	return {
		from,
		to: recipients.join(", "),
		subject: String(notification?.title ?? "DSH 任务提醒"),
		text,
	};
}

/** @param error - unknown thrown value. @returns a short single-line cause. */
function describeError(error) {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/\s+/g, " ").trim().slice(0, 300);
}

/**
 * Send one reminder through SMTP and report the exact outcome.
 *
 * This is the test-button path: it returns the failure reason so the Settings
 * page can show it. The reminder path uses {@link sendEmail}, which discards
 * the detail and only logs at debug level.
 *
 * @param notification - accepted reminder payload.
 * @param settings - resolved plugin settings, including `smtpPass`.
 * @param options - test/implementation seams.
 * @param options.logger - debug logger.
 * @param options.createTransport - injected transport factory for tests.
 * @param options.now - clock used in the mail body.
 * @returns `{ ok: true }` or `{ ok: false, error }`.
 */
export async function sendEmailDetailed(notification, settings, options = {}) {
	const logger = options.logger;
	if (settings?.email !== true) return { ok: false, error: "邮箱推送未启用" };
	const problems = emailConfigurationProblems(settings);
	if (problems.length > 0) {
		return { ok: false, error: `SMTP 设置不完整：${problems.join("、")}` };
	}
	const message = buildEmail(notification, settings, options.now ?? Date.now());
	if (message === null) return { ok: false, error: "邮件内容无法构建" };

	let transporter;
	try {
		const createTransport =
			typeof options.createTransport === "function"
				? options.createTransport
				: (await loadNodemailer()).createTransport;
		if (typeof createTransport !== "function") {
			return { ok: false, error: "nodemailer 未提供 createTransport" };
		}
		const user = String(settings.smtpUser ?? "").trim();
		const optionsForTransport = {
			host: String(settings.smtpHost ?? "").trim(),
			port: settings.smtpPort,
			secure: settings.smtpSecure === true,
			requireTLS: settings.smtpSecure !== true,
			connectionTimeout: 15_000,
			greetingTimeout: 15_000,
			socketTimeout: 20_000,
			logger: false,
			debug: false,
			...(user === "" ? {} : { auth: { user, pass: settings.smtpPass } }),
		};
		transporter = createTransport(optionsForTransport);
		await transporter.sendMail(message);
		logger?.debug?.("thinking-depth: email sent to %s", message.to);
		return { ok: true };
	} catch (error) {
		const detail = describeError(error);
		logger?.debug?.("thinking-depth: email failed: %s", detail);
		return { ok: false, error: detail };
	} finally {
		try {
			transporter?.close?.();
		} catch {
			/* closing a failed transport is best-effort */
		}
	}
}

/**
 * Send one reminder, discarding the failure detail for the notification path.
 * @param notification - accepted reminder payload.
 * @param settings - resolved plugin settings.
 * @param options - test/implementation seams.
 * @returns whether the mail was accepted by the transport.
 */
export async function sendEmail(notification, settings, options = {}) {
	return (await sendEmailDetailed(notification, settings, options)).ok;
}
