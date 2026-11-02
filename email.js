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
 * Whether the email channel has enough information to attempt a send.
 * `email` itself is checked separately; this only validates SMTP details.
 * @param settings - resolved plugin settings.
 * @returns whether host, port, sender, recipients and auth are complete.
 */
export function isEmailConfigured(settings) {
	if (typeof settings !== "object" || settings === null) return false;
	const host = String(settings.smtpHost ?? "").trim();
	const from = String(settings.emailFrom ?? "").trim();
	const recipients = parseRecipients(settings.emailTo);
	const port = settings.smtpPort;
	const user = String(settings.smtpUser ?? "").trim();
	const pass = settings.smtpPass;
	const authComplete =
		user === ""
			? pass === undefined
			: typeof pass === "string" && pass !== "";
	return (
		host !== "" &&
		from !== "" &&
		recipients.length > 0 &&
		Number.isInteger(port) &&
		port >= 1 &&
		port <= 65535 &&
		authComplete &&
		recipients.every(isEmailAddress) &&
		isEmailAddress(from)
	);
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
	const from = settings.emailFrom.trim();
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

/**
 * Send one reminder through SMTP.
 * @param notification - accepted reminder payload.
 * @param settings - resolved plugin settings, including `smtpPass`.
 * @param options - test/implementation seams.
 * @param options.logger - debug logger.
 * @param options.createTransport - injected transport factory for tests.
 * @param options.now - clock used in the mail body.
 * @returns whether the mail was accepted by the transport.
 */
export async function sendEmail(notification, settings, options = {}) {
	const logger = options.logger;
	if (settings?.email !== true) return false;
	if (!isEmailConfigured(settings)) {
		logger?.debug?.("thinking-depth: email channel is enabled but SMTP settings are incomplete");
		return false;
	}
	const message = buildEmail(notification, settings, options.now ?? Date.now());
	if (message === null) return false;

	let transporter;
	try {
		const createTransport =
			typeof options.createTransport === "function"
				? options.createTransport
				: (await loadNodemailer()).createTransport;
		if (typeof createTransport !== "function") {
			logger?.debug?.("thinking-depth: nodemailer did not expose createTransport");
			return false;
		}
		const user = settings.smtpUser.trim();
		const optionsForTransport = {
			host: settings.smtpHost.trim(),
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
		logger?.debug?.("thinking-depth: email reminder sent to %s", message.to);
		return true;
	} catch (error) {
		logger?.debug?.(
			"thinking-depth: email reminder failed: %s",
			error instanceof Error ? error.message : String(error),
		);
		return false;
	} finally {
		try {
			transporter?.close?.();
		} catch {
			/* closing a failed transport is best-effort */
		}
	}
}
