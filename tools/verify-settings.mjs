/**
 * Behaviour check for the plugin's Settings schema and namespace reader.
 *
 * The Settings service rehydrates this schema with schemastery on the Host and
 * in the browser. That rehydration is exercised by the app itself; this file
 * checks the contract the service projects (object with two volatile boolean
 * fields), the Cordis validator, and the defaults used by the host halves.
 */
import assert from "node:assert/strict";
import { Config, DEFAULT_SETTINGS, PLUGIN_NS, readSettings, readSettingsFrom } from "../settings.js";
import { Config as ExportedConfig } from "../index.js";

// 1. The Config is the shape dsh-settings' volatileForm expects.
{
	assert.equal(Config.type, "object");
	assert.equal(Config.meta.volatile, undefined, "the root is not wholesale editable");
	assert.deepEqual(Object.keys(Config.dict), ["thinkingDepth", "notifications"]);
	for (const [key, field] of Object.entries(Config.dict)) {
		assert.equal(field.type, "boolean", `${key} is a boolean`);
		assert.equal(field.meta.volatile, true, `${key} is editable live`);
		assert.equal(field.meta.default, true, `${key} defaults on`);
		const json = field.toJSON();
		assert.equal(json.type, "boolean");
		assert.equal(json.meta.volatile, true);
		assert.equal(json.meta.default, true);
	}
	const json = Config.toJSON();
	assert.equal(json.type, "object");
	assert.deepEqual(Object.keys(json.dict), ["thinkingDepth", "notifications"]);
	assert.equal(json.dict.notifications.meta.volatile, true);
	assert.equal(ExportedConfig, Config, "index.js re-exports the same Config for Cordis");
}

// 2. The Cordis validator fills defaults and rejects non-booleans.
{
	assert.deepEqual(Config["~standard"].validate(undefined).value, DEFAULT_SETTINGS);
	assert.deepEqual(Config["~standard"].validate(null).value, DEFAULT_SETTINGS);
	assert.deepEqual(Config["~standard"].validate({}).value, DEFAULT_SETTINGS);
	assert.deepEqual(Config["~standard"].validate({ thinkingDepth: false }).value, {
		thinkingDepth: false,
		notifications: true,
	});
	assert.deepEqual(
		Config["~standard"].validate({ thinkingDepth: false, notifications: false }).value,
		{ thinkingDepth: false, notifications: false },
	);
	const invalid = Config["~standard"].validate({ thinkingDepth: "no" });
	assert.ok(Array.isArray(invalid.issues));
	assert.deepEqual(invalid.issues[0].path, ["thinkingDepth"]);
	assert.ok(Config["~standard"].validate([]).issues);
}

// 3. The namespace reader defaults on and follows explicit false values.
{
	assert.equal(PLUGIN_NS, "dsh-thinking-depth");
	assert.deepEqual(readSettingsFrom([]), { thinkingDepth: true, notifications: true });
	assert.deepEqual(
		readSettingsFrom([
			{ ns: "llm-pi-ai", value: { thinkingDepth: false, notifications: false } },
			{ ns: PLUGIN_NS, value: { thinkingDepth: false, notifications: true } },
		]),
		{ thinkingDepth: false, notifications: true },
	);
	assert.deepEqual(readSettingsFrom([{ ns: PLUGIN_NS }]), {
		thinkingDepth: true,
		notifications: true,
	});
	assert.deepEqual(readSettings({ settings: { describe: () => [{ ns: PLUGIN_NS, value: { notifications: false } }] } }), {
		thinkingDepth: true,
		notifications: false,
	});
	assert.deepEqual(
		readSettings({
			settings: {
				describe() {
					throw new Error("settings is restarting");
				},
			},
		}),
		DEFAULT_SETTINGS,
	);
	assert.deepEqual(readSettings(undefined), DEFAULT_SETTINGS);
}

console.log("settings schema: all behaviour checks passed");
