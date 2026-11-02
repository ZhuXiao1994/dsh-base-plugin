/**
 * Behaviour check for the plugin's Settings schema and namespace reader.
 *
 * The Settings service rehydrates this schema with schemastery on the Host and
 * in the browser. That rehydration is exercised by the app itself; this file
 * checks the contract the service projects (one object with three booleans,
 * three strings, one number and one write-only secret), the Cordis validator,
 * and the defaults used by the host halves.
 */
import assert from "node:assert/strict";
import { Config, DEFAULT_SETTINGS, PLUGIN_NS, readSettings, readSettingsFrom } from "../settings.js";
import { Config as ExportedConfig } from "../index.js";

const KEYS = [
	"thinkingDepth",
	"notifications",
	"email",
	"smtpHost",
	"smtpPort",
	"smtpSecure",
	"smtpUser",
	"smtpPass",
	"emailFrom",
	"emailTo",
];

// 1. The Config is the shape dsh-settings' volatileForm expects.
{
	assert.equal(Config.type, "object");
	assert.equal(Config.meta.volatile, undefined, "the root is not wholesale editable");
	assert.deepEqual(Object.keys(Config.dict), KEYS);
	const types = {
		thinkingDepth: "boolean",
		notifications: "boolean",
		email: "boolean",
		smtpHost: "string",
		smtpPort: "number",
		smtpSecure: "boolean",
		smtpUser: "string",
		smtpPass: "string",
		emailFrom: "string",
		emailTo: "string",
	};
	for (const [key, field] of Object.entries(Config.dict)) {
		assert.equal(field.type, types[key], `${key} is a ${types[key]}`);
		assert.equal(field.meta.volatile, true, `${key} is editable live`);
		const json = field.toJSON();
		assert.equal(json.type, types[key]);
		assert.equal(json.meta.volatile, true);
		if (key === "smtpPass") {
			assert.equal(field.meta.role, "secret");
			assert.equal(json.meta.role, "secret");
			assert.equal(field.meta.default, undefined, "a secret has no default");
		} else {
			assert.ok(field.meta.default !== undefined, `${key} has a default`);
		}
	}
	const json = Config.toJSON();
	assert.equal(json.type, "object");
	assert.deepEqual(Object.keys(json.dict), KEYS);
	assert.equal(json.dict.smtpPass.meta.role, "secret");
	assert.equal(ExportedConfig, Config, "index.js re-exports the same Config for Cordis");
}

// 2. The Cordis validator fills defaults, coerces nothing, and rejects bad types.
{
	assert.deepEqual(Config["~standard"].validate(undefined).value, DEFAULT_SETTINGS);
	assert.deepEqual(Config["~standard"].validate(null).value, DEFAULT_SETTINGS);
	assert.deepEqual(Config["~standard"].validate({}).value, DEFAULT_SETTINGS);
	assert.deepEqual(Config["~standard"].validate({ thinkingDepth: false }).value, {
		...DEFAULT_SETTINGS,
		thinkingDepth: false,
	});
	const full = {
		thinkingDepth: false,
		notifications: false,
		email: true,
		smtpHost: "smtp.example.com",
		smtpPort: 465,
		smtpSecure: true,
		smtpUser: "user@example.com",
		smtpPass: "secret",
		emailFrom: "from@example.com",
		emailTo: "to@example.com",
	};
	assert.deepEqual(Config["~standard"].validate(full).value, full);
	assert.ok(Config["~standard"].validate({ thinkingDepth: "no" }).issues);
	assert.ok(Config["~standard"].validate({ smtpPort: 0 }).issues);
	assert.ok(Config["~standard"].validate({ smtpPort: 70_000 }).issues);
	assert.ok(Config["~standard"].validate({ smtpPass: 42 }).issues);
	assert.ok(Config["~standard"].validate([]).issues);
}

// 3. The namespace reader defaults and follows explicit values.
{
	assert.equal(PLUGIN_NS, "dsh-thinking-depth");
	assert.deepEqual(readSettingsFrom([]), DEFAULT_SETTINGS);
	assert.deepEqual(
		readSettingsFrom([
			{ ns: "llm-pi-ai", value: { thinkingDepth: false, notifications: false, email: true } },
			{ ns: PLUGIN_NS, value: { thinkingDepth: false, notifications: true, email: true } },
		]),
		{ ...DEFAULT_SETTINGS, thinkingDepth: false, email: true },
	);
	assert.deepEqual(readSettingsFrom([{ ns: PLUGIN_NS }]), DEFAULT_SETTINGS);
	assert.deepEqual(
		readSettingsFrom([
			{
				ns: PLUGIN_NS,
				value: {
					email: true,
					smtpHost: "smtp.example.com",
					smtpPort: 465,
					smtpSecure: true,
					smtpUser: "u",
					smtpPass: "p",
					emailFrom: "f@example.com",
					emailTo: "t@example.com",
				},
			},
		]),
		{
			...DEFAULT_SETTINGS,
			email: true,
			smtpHost: "smtp.example.com",
			smtpPort: 465,
			smtpSecure: true,
			smtpUser: "u",
			smtpPass: "p",
			emailFrom: "f@example.com",
			emailTo: "t@example.com",
		},
	);
	assert.deepEqual(
		readSettings({ settings: { describe: () => [{ ns: PLUGIN_NS, value: { notifications: false } }] } }),
		{ ...DEFAULT_SETTINGS, notifications: false },
	);
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
