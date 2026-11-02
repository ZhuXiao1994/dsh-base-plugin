/**
 * Plugin settings: reasoning levels, local reminders, email delivery and the
 * SMTP configuration behind it.
 *
 * The Settings service builds its editable forms from each active plugin
 * entry's `Config`. A profile-installed plugin cannot import
 * `@deepseek-ai/schemastery` (DSH packages are not resolvable at runtime), so
 * this module declares the tiny schema surface the service actually reads:
 * `meta`/`type`/`dict` for form projection and a `toJSON()` that schemastery
 * can rehydrate. The `~standard` validator is what Cordis uses to resolve the
 * entry's live configuration.
 *
 * `smtpPass` is a `role: "secret"` field: the Settings service strips it from
 * every remote read, so the browser only learns whether it is set. The host
 * reads the real value from its own `describe()` and uses it only to
 * authenticate the SMTP connection.
 *
 * Keep the schema additive: the persisted field names are a compatibility
 * surface.
 */

/** Profile entry id, which is also the settings namespace and client module id. */
export const PLUGIN_NS = "dsh-thinking-depth";

/** Accepted defaults when no profile override exists. `smtpPass` is optional. */
export const DEFAULT_SETTINGS = Object.freeze({
	thinkingDepth: true,
	notifications: true,
	email: false,
	smtpHost: "",
	smtpPort: 587,
	smtpSecure: false,
	smtpUser: "",
	emailFrom: "",
	emailTo: "",
});

/**
 * One boolean setting field.
 * @param description - text shown by the Settings page.
 * @param defaultValue - default value.
 * @returns a schemastery-shaped boolean schema.
 */
function booleanField(description, defaultValue = true) {
	const meta = { default: defaultValue, description, volatile: true };
	return {
		type: "boolean",
		meta,
		toJSON() {
			return { type: "boolean", meta: { ...meta } };
		},
	};
}

/**
 * One string setting field.
 * @param description - text shown by the Settings page.
 * @returns a schemastery-shaped string schema.
 */
function stringField(description) {
	const meta = { default: "", description, volatile: true };
	return {
		type: "string",
		meta,
		toJSON() {
			return { type: "string", meta: { ...meta } };
		},
	};
}

/**
 * One integer setting field.
 * @param description - text shown by the Settings page.
 * @param defaultValue - default value.
 * @returns a schemastery-shaped number schema.
 */
function numberField(description, defaultValue) {
	const meta = { default: defaultValue, description, volatile: true };
	return {
		type: "number",
		meta,
		toJSON() {
			return { type: "number", meta: { ...meta } };
		},
	};
}

/**
 * One write-only secret field. No default: an absent value means "no secret",
 * which is what `redactSecrets` reports as `set: false`.
 * @param description - text shown by the Settings page.
 * @returns a schemastery-shaped secret string schema.
 */
function secretField(description) {
	const meta = { role: "secret", description, volatile: true };
	return {
		type: "string",
		meta,
		toJSON() {
			return { type: "string", meta: { ...meta } };
		},
	};
}

const FIELDS = {
	thinkingDepth: booleanField("自动为手写声明的第三方模型补写推理档位。"),
	notifications: booleanField("在本机弹出 Windows 通知。"),
	email: booleanField("通过 SMTP 把提醒发送到邮箱。", false),
	smtpHost: stringField("SMTP 服务器地址，例如 smtp.qq.com。"),
	smtpPort: numberField("SMTP 端口；465 通常配 SSL，587 配 STARTTLS。", 587),
	smtpSecure: booleanField("端口 465 的 SSL/TLS 直连；587 通常关闭并使用 STARTTLS。", false),
	smtpUser: stringField("SMTP 登录用户名；不需要认证的服务器可留空。"),
	smtpPass: secretField("SMTP 密码或授权码；只写不读，留空表示保持原值。"),
	emailFrom: stringField("发件人地址；留空或只写昵称时使用 SMTP 用户名。"),
	emailTo: stringField("收件人地址；多个地址用逗号分隔。"),
};

/**
 * The plugin Config. Only the fields below are editable from the native
 * Settings page; everything else about the plugin is code.
 */
export const Config = {
	type: "object",
	meta: { default: {} },
	dict: FIELDS,
	toJSON() {
		return {
			type: "object",
			meta: { default: {} },
			dict: Object.fromEntries(
				Object.entries(FIELDS).map(([key, field]) => [key, field.toJSON()]),
			),
		};
	},
	"~standard": {
		version: 1,
		vendor: "dsh-thinking-depth",
		validate(value) {
			if (value === undefined || value === null) return { value: { ...DEFAULT_SETTINGS } };
			if (typeof value !== "object" || Array.isArray(value)) {
				return { issues: [{ message: "expected an object", path: [] }] };
			}
			const booleanKeys = ["thinkingDepth", "notifications", "email", "smtpSecure"];
			const stringKeys = ["smtpHost", "smtpUser", "emailFrom", "emailTo"];
			const result = {};
			const issues = [];
			for (const key of booleanKeys) {
				const fallback = DEFAULT_SETTINGS[key];
				result[key] = value[key] === undefined ? fallback : value[key];
				if (typeof result[key] !== "boolean") {
					issues.push({ message: `${key} must be a boolean`, path: [key] });
				}
			}
			for (const key of stringKeys) {
				const fallback = DEFAULT_SETTINGS[key];
				result[key] = value[key] === undefined ? fallback : value[key];
				if (typeof result[key] !== "string") {
					issues.push({ message: `${key} must be a string`, path: [key] });
				}
			}
			const port = value.smtpPort === undefined ? DEFAULT_SETTINGS.smtpPort : value.smtpPort;
			result.smtpPort = port;
			if (!Number.isInteger(port) || port < 1 || port > 65535) {
				issues.push({ message: "smtpPort must be an integer between 1 and 65535", path: ["smtpPort"] });
			}
			if (value.smtpPass !== undefined) {
				if (typeof value.smtpPass !== "string") {
					issues.push({ message: "smtpPass must be a string", path: ["smtpPass"] });
				} else {
					result.smtpPass = value.smtpPass;
				}
			}
			return issues.length === 0 ? { value: result } : { issues };
		},
	},
};

/**
 * Read the settings from an already-computed `settings.describe()` list.
 * @param rows - descriptors returned by the settings service.
 * @returns normalized settings, including the real (host-side) SMTP secret.
 */
export function readSettingsFrom(rows) {
	const descriptor = Array.isArray(rows)
		? rows.find((row) => row?.ns === PLUGIN_NS)
		: undefined;
	const value = descriptor?.value ?? {};
	const text = (key) => (typeof value[key] === "string" ? value[key] : DEFAULT_SETTINGS[key]);
	const result = {
		thinkingDepth: value.thinkingDepth !== false,
		notifications: value.notifications !== false,
		email: value.email === true,
		smtpHost: text("smtpHost"),
		smtpPort: Number.isInteger(value.smtpPort) ? value.smtpPort : DEFAULT_SETTINGS.smtpPort,
		smtpSecure: value.smtpSecure === true,
		smtpUser: text("smtpUser"),
		emailFrom: text("emailFrom"),
		emailTo: text("emailTo"),
	};
	if (typeof value.smtpPass === "string" && value.smtpPass !== "") result.smtpPass = value.smtpPass;
	return result;
}

/**
 * Read the live values of this plugin's settings.
 *
 * A missing namespace or a Settings read that fails while the service is
 * reloading is treated as "levels and local reminders on, email off": the
 * plugin must not silently disable itself because of a transient read.
 *
 * @param ctx - host plugin context with the `settings` service.
 * @returns the settings.
 */
export function readSettings(ctx) {
	try {
		return readSettingsFrom(ctx?.settings?.describe?.());
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}
