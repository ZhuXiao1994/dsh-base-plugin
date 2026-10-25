/**
 * Behaviour check for the Thinking Depth host half.
 *
 * It imports the real `index.js` and exercises the exported planning functions
 * against a settings descriptor shaped like the one `settings.describe()`
 * returns, so the exact writes this plugin would make are verifiable without
 * booting a profile.
 *
 * It is a development check, not part of the plugin.
 */
import assert from "node:assert/strict";
import { capabilityFor, planSweep } from "../index.js";

/** The four models the profile declares on its hand-declared route. */
const MODELS = [
	{ id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", contextWindow: 1000000, input: ["text", "image"], maxTokens: 256000 },
	{ id: "poolside/laguna-s-2.1-free", name: "Laguna S 2.1", contextWindow: 256000 },
	{ id: "inclusionai/ling-3.0-flash-sante:free", name: "Ling 3.0 Flash Sante", contextWindow: 262144 },
	{ id: "claude-opus-5-5", name: "Claude Opus 5.5", contextWindow: 1000000 },
];

/** The profile patch layer's `commandcode` route, as the user authored it. */
function providers(models = MODELS) {
	return {
		commandcode: {
			displayName: "commandcode",
			apiKeyEnv: "COMMANDCODE_API_KEY",
			api: "openai-completions",
			baseURL: "https://api.commandcode.ai/provider/v1",
			models,
		},
	};
}

/** A `settings.describe()` row: the patch layer plus the resolved value. */
function descriptor(patchProviders = providers(), resolvedProviders = patchProviders, revision = 7) {
	return {
		ns: "llm-pi-ai",
		revision,
		value: { providers: resolvedProviders },
		user: { providers: patchProviders },
		base: {},
	};
}

const modelsOf = (result) => result.ops[0].value;
const byId = (models, id) => models.find((model) => model.id === id);

// 1. Every model without a declaration gets the level map the catalog records.
{
	const result = planSweep(descriptor());
	assert.equal(result.ops.length, 1, "one route needs one write");
	assert.deepEqual(result.ops[0].path, ["providers", "commandcode", "models"]);
	assert.equal(result.ops[0].op, "set");
	const models = modelsOf(result);
	assert.equal(models.length, MODELS.length, "no model may be dropped");

	assert.deepEqual(byId(models, "deepseek/deepseek-v4.1-flash").reasoningEfforts, { off: "none", low: "low", high: "high", max: "max" });
	assert.deepEqual(byId(models, "poolside/laguna-s-2.1-free").reasoningEfforts, { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high" });
	assert.deepEqual(byId(models, "inclusionai/ling-3.0-flash-sante:free").reasoningEfforts, { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high" });
	assert.deepEqual(byId(models, "claude-opus-5-5").reasoningEfforts, { off: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" });

	// A compat block rides only where the catalog entry shares the route protocol.
	assert.equal(byId(models, "deepseek/deepseek-v4.1-flash").compat.thinkingFormat, "openrouter");
	assert.equal(byId(models, "inclusionai/ling-3.0-flash-sante:free").compat.thinkingFormat, "openrouter");
	assert.equal(byId(models, "poolside/laguna-s-2.1-free").compat, undefined);
	assert.equal(byId(models, "claude-opus-5-5").compat, undefined);

	// Unrelated model fields survive untouched.
	const flash = byId(models, "deepseek/deepseek-v4.1-flash");
	assert.equal(flash.name, "DeepSeek V4.1 Flash");
	assert.equal(flash.maxTokens, 256000);
	assert.deepEqual(flash.input, ["text", "image"]);
	assert.equal(byId(models, "poolside/laguna-s-2.1-free").contextWindow, 256000);
}

// 2. Re-planning what was just written is a no-op, so no reload loop is possible.
{
	const first = planSweep(descriptor());
	const after = providers(modelsOf(first));
	const second = planSweep(descriptor(after, after));
	assert.deepEqual(second.ops, [], "a completed sweep must not write again");
	assert.deepEqual(second.notes, []);
}

// 3. An explicit declaration is final, including `false` and a hand-written map.
{
	const declared = [
		{ id: "deepseek/deepseek-v4.1-flash", reasoningEfforts: false },
		{ id: "poolside/laguna-s-2.1-free", reasoningEfforts: { off: null, max: "ultra" } },
		{ id: "inclusionai/ling-3.0-flash-sante:free", reasoningEfforts: { off: null, high: "high" } },
		{ id: "claude-opus-5-5", reasoningEfforts: { off: null, low: "low" } },
	];
	const result = planSweep(descriptor(providers(declared)));
	assert.deepEqual(result.ops, [], "nothing may be added beside explicit declarations");
	assert.deepEqual(result.skipped, ["commandcode"]);
}

// 4. A route that declares levels anywhere is hand-maintained: its blanks are
//    the user's decision, so the whole route is left alone.
{
	const mixed = [
		{ id: "deepseek/deepseek-v4.1-flash", reasoningEfforts: false },
		{ id: "claude-opus-5-5" },
	];
	const result = planSweep(descriptor(providers(mixed)));
	assert.deepEqual(result.ops, [], "a hand-maintained route is never written to");
	assert.deepEqual(result.skipped, ["commandcode"], "the skipped route is reported");
	assert.deepEqual(result.notes, []);
}

// 4b. A route nobody has curated is filled in whole, and routes are judged
//     independently of one another.
{
	const patch = {
		curated: {
			api: "openai-completions",
			models: [{ id: "workbuddy/glm-5.3", reasoningEfforts: { low: "low", high: "high", max: "max" } }, { id: "workbuddy/kimi-k2.6" }],
		},
		fresh: {
			api: "openai-completions",
			models: [{ id: "acme/glm-9" }, { id: "acme/totally-unknown" }],
		},
	};
	const result = planSweep(descriptor(patch, patch));
	assert.equal(result.ops.length, 1, "only the uncurated route is written");
	assert.deepEqual(result.ops[0].path, ["providers", "fresh", "models"]);
	assert.deepEqual(result.skipped, ["curated"]);
	assert.equal(result.notes.length, 2, "both models of the fresh route are reported");
	assert.ok(result.ops[0].value.every((model) => model.reasoningEfforts !== undefined));
}

// 5. A route whose models live in a lower layer is left alone.
{
	const lower = providers();
	const result = planSweep(descriptor({}, lower));
	assert.deepEqual(result.ops, [], "no patch-layer list means nothing to extend");
}

// 6. Family and assumed rules cover models the catalog does not list by id.
{
	const future = [
		{ id: "acme/claude-fable-9" },
		{ id: "acme/deepseek-v9" },
		{ id: "acme/gpt-5.2-preview" },
		{ id: "acme/glm-9" },
		{ id: "acme/totally-unknown" },
	];
	const result = planSweep(descriptor(providers(future)));
	const models = modelsOf(result);
	assert.deepEqual(byId(models, "acme/claude-fable-9").reasoningEfforts, { off: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" });
	assert.deepEqual(byId(models, "acme/deepseek-v9").reasoningEfforts, { off: null, low: "low", high: "high", max: "max" });
	assert.deepEqual(byId(models, "acme/gpt-5.2-preview").reasoningEfforts, { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high" });
	assert.deepEqual(byId(models, "acme/glm-9").reasoningEfforts, { off: null, low: "low", high: "high", max: "max" });
	assert.deepEqual(byId(models, "acme/totally-unknown").reasoningEfforts, { off: null, low: "low", medium: "medium", high: "high" });
	// Only catalog-matched ids may carry a thinking format.
	assert.ok(models.every((model) => model.compat === undefined), "family fallbacks must not set a wire format");
	assert.deepEqual(result.notes.map((note) => note.source), ["family", "family", "family", "family", "assumed"]);
}

// 7. A non-completions route never receives a thinking format.
{
	const anthropic = {
		acme: { api: "anthropic-messages", models: [{ id: "deepseek/deepseek-v4.1-flash" }] },
	};
	const result = planSweep(descriptor(anthropic, anthropic));
	const [model] = modelsOf(result);
	assert.ok(model.reasoningEfforts !== undefined, "levels still apply");
	assert.equal(model.compat, undefined, "a thinking format is completions-only");
}

// 8. Missing or malformed descriptors are survivable.
{
	assert.deepEqual(planSweep(undefined).ops, []);
	assert.deepEqual(planSweep({ ns: "llm-pi-ai" }).ops, []);
	assert.deepEqual(planSweep({ ns: "llm-pi-ai", value: { providers: {} }, user: {} }).ops, []);
}

// 9. capabilityFor reports where each answer came from.
{
	assert.equal(capabilityFor("deepseek/deepseek-v4.1-flash").source, "catalog");
	assert.equal(capabilityFor("acme/claude-x").source, "family");
	assert.equal(capabilityFor("acme/whatever").source, "assumed");
}

console.log("host half: all behaviour checks passed");
