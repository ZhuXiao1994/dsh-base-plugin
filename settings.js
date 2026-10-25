/**
 * Plugin settings: the two switches the Settings page edits, plus the
 * namespace reader the host halves use.
 *
 * The Settings service builds its editable forms from each active plugin
 * entry's `Config`. A profile-installed plugin cannot import
 * `@deepseek-ai/schemastery` (DSH packages are not resolvable at runtime), so
 * this module declares the tiny schema surface the service actually reads:
 * `meta`/`type`/`dict` for form projection and a `toJSON()` that schemastery
 * can rehydrate. The `~standard` validator is what Cordis uses to resolve the
 * entry's live configuration.
 *
 * Keep the schema additive: never rename `thinkingDepth` or `notifications`
 * without a migration, because they are persisted in the profile patch.
 */

/** Profile entry id, which is also the settings namespace and client module id. */
export const PLUGIN_NS = "dsh-thinking-depth";

/** Accepted defaults when no profile override exists. */
export const DEFAULT_SETTINGS = Object.freeze({
	thinkingDepth: true,
	notifications: true,
});

/**
 * One boolean setting field.
 * @param description - text shown by the Settings page.
 * @returns a schemastery-shaped boolean schema.
 */
function booleanField(description) {
	const meta = { default: true, description, volatile: true };
	return {
		type: "boolean",
		meta,
		toJSON() {
			return { type: "boolean", meta: { ...meta } };
		},
	};
}

const FIELDS = {
	thinkingDepth: booleanField("自动为手写声明的第三方模型补写推理档位。"),
	notifications: booleanField("任务结束或需要你选择/确认时弹出 Windows 通知。"),
};

/**
 * The plugin Config. Only the two fields below are editable from the native
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
			dict: {
				thinkingDepth: FIELDS.thinkingDepth.toJSON(),
				notifications: FIELDS.notifications.toJSON(),
			},
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
			const result = {
				thinkingDepth:
					value.thinkingDepth === undefined ? DEFAULT_SETTINGS.thinkingDepth : value.thinkingDepth,
				notifications:
					value.notifications === undefined ? DEFAULT_SETTINGS.notifications : value.notifications,
			};
			const issues = [];
			for (const key of Object.keys(DEFAULT_SETTINGS)) {
				if (typeof result[key] !== "boolean") {
					issues.push({ message: `${key} must be a boolean`, path: [key] });
				}
			}
			return issues.length === 0 ? { value: result } : { issues };
		},
	},
};

/**
 * Read the two switches from an already-computed `settings.describe()` list.
 * @param rows - descriptors returned by the settings service.
 * @returns the two switches.
 */
export function readSettingsFrom(rows) {
	const descriptor = Array.isArray(rows)
		? rows.find((row) => row?.ns === PLUGIN_NS)
		: undefined;
	const value = descriptor?.value;
	return {
		thinkingDepth: value?.thinkingDepth !== false,
		notifications: value?.notifications !== false,
	};
}

/**
 * Read the live values of this plugin's settings.
 *
 * A missing namespace or a Settings read that fails while the service is
 * reloading is treated as "both features on": the plugin must not silently
 * disable itself because of a transient read.
 *
 * @param ctx - host plugin context with the `settings` service.
 * @returns the two switches.
 */
export function readSettings(ctx) {
	try {
		return readSettingsFrom(ctx?.settings?.describe?.());
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}
