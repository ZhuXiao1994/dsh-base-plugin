/**
 * Host half of the Thinking Depth bundle.
 *
 * A hand-declared pi-ai route gets no reasoning metadata from the installed
 * catalog: `llm-pi-ai` looks a model up under the ROUTE's own name
 * (`catalogModels(provider)`), so a custom gateway's models resolve as
 * non-reasoning and the composer's native "reasoning effort" control offers
 * nothing at all.
 *
 * This plugin closes that gap at startup. For every model of a hand-declared
 * route that declares no `reasoningEfforts` of its own, it writes the
 * capability the model actually has — read off the shipped pi-ai catalog for
 * the ids that catalog describes, and off the model family's catalog shape
 * otherwise — so the native control lights up and no bespoke settings page is
 * needed.
 *
 * It only ever ADDS. A model that already declares `reasoningEfforts` — a
 * level map, or `false` for a model that cannot think — is left exactly as
 * configured, so the native Settings → Models page stays the final authority.
 */

/** The settings namespace that holds hand-declared provider routes. */
const SETTINGS_NS = "llm-pi-ai";
/** The protocol whose requests carry `compat.thinkingFormat`. */
const COMPLETIONS_API = "openai-completions";

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * An effort map for a set of levels, each with its canonical wire spelling.
 * `off` carries no value, which is how pi-ai spells "send nothing".
 * @param levels - the offered levels, in any order.
 * @returns the `reasoningEfforts` value.
 */
function canonical(levels) {
	const efforts = {};
	for (const level of levels) efforts[level] = level === "off" ? null : level;
	return efforts;
}

/**
 * Capability of one exact model id, read from the installed pi-ai catalog.
 *
 * Each entry was taken from that catalog's own record for the id. A
 * `thinkingFormat` is recorded only where the catalog's record speaks the same
 * protocol as the route it is borrowed onto, which is the same test `llm-pi-ai`
 * itself applies before inheriting a catalog compat block.
 */
const EXACT_RULES = new Map([
	// pi-ai catalog: openrouter entry, api openai-completions — the route's protocol.
	["deepseek/deepseek-v4.1-flash", { efforts: { off: "none", low: "low", high: "high", max: "max" }, thinkingFormat: "openrouter" }],
	// pi-ai catalog: openrouter entry, api openai-completions; the entry declares
	// reasoning without a level map, so the levels pi-ai would report are spelled out.
	["inclusionai/ling-3.0-flash-sante:free", { efforts: canonical(["off", "minimal", "low", "medium", "high"]), thinkingFormat: "openrouter" }],
	// pi-ai catalog: vercel-ai-gateway entry, api anthropic-messages — a different
	// protocol, so the levels are borrowed without the entry's compat block.
	["poolside/laguna-s-2.1-free", { efforts: canonical(["off", "minimal", "low", "medium", "high"]) }],
	// pi-ai catalog: anthropic entry, api anthropic-messages — levels only.
	["claude-opus-5-5", { efforts: canonical(["off", "low", "medium", "high", "xhigh", "max"]) }],
]);

/**
 * Family shapes, mined from every `openai-completions` reasoning model in the
 * installed catalog and reduced to the levels a family agrees on. A family
 * match adds levels only: it never borrows another protocol's compat block, so
 * an endpoint we cannot classify keeps pi-ai's own detection.
 */
const FAMILY_RULES = [
	{ match: /(^|\/)claude/u, efforts: canonical(["off", "low", "medium", "high", "xhigh", "max"]) },
	{ match: /(^|\/)deepseek/u, efforts: canonical(["off", "low", "high", "max"]) },
	{ match: /(^|\/)(o[1-9]|gpt-5|gpt-6)/u, efforts: canonical(["off", "minimal", "low", "medium", "high"]) },
	{ match: /(^|\/)gpt-/u, efforts: canonical(["off", "low", "medium", "high", "xhigh", "max"]) },
	{ match: /(^|\/)gemini/u, efforts: canonical(["off", "low", "medium", "high"]) },
	{ match: /(^|\/)(glm|zai)/u, efforts: canonical(["off", "low", "high", "max"]) },
	{ match: /(^|\/)(kimi|moonshot)/u, efforts: canonical(["off", "low", "high", "max"]) },
	{ match: /(^|\/)grok/u, efforts: canonical(["off", "low", "medium", "high", "xhigh"]) },
	{ match: /(^|\/)mistral/u, efforts: canonical(["off", "high"]) },
];

/** Any other model of a hand-declared route: the common OpenAI-compatible core. */
const ASSUMED_EFFORTS = canonical(["off", "low", "medium", "high"]);

/**
 * The capability to write for one model id.
 * @param modelId - the configured model id.
 * @returns the efforts to declare, an optional thinking format, and where the
 *   answer came from (`catalog`, `family`, or `assumed`).
 */
export function capabilityFor(modelId) {
	const exact = EXACT_RULES.get(modelId);
	if (exact !== undefined) {
		return {
			source: "catalog",
			efforts: exact.efforts,
			...(exact.thinkingFormat === undefined ? {} : { thinkingFormat: exact.thinkingFormat }),
		};
	}
	for (const rule of FAMILY_RULES) {
		if (rule.match.test(modelId)) return { source: "family", efforts: rule.efforts };
	}
	return { source: "assumed", efforts: ASSUMED_EFFORTS };
}

/**
 * The writes one sweep needs, computed from a `llm-pi-ai` settings descriptor.
 *
 * The models list is read from the Profile's own patch layer, not from the
 * resolved value, so an addition never materializes catalog defaults a lower
 * layer supplied.
 *
 * A route counts as hand-maintained as soon as any of its models declares
 * `reasoningEfforts`, and is then skipped whole. Newly added routes — which by
 * definition declare nothing — are the ones filled in.
 * @param descriptor - the `settings.describe()` row for `llm-pi-ai`.
 * @returns ordered ops (empty when nothing is missing), one note per model
 *   filled in, and the routes left alone because they are hand-maintained.
 */
export function planSweep(descriptor) {
	const stored = descriptor?.user?.providers;
	const effective = descriptor?.value?.providers;
	if (!isRecord(stored) || !isRecord(effective)) return { ops: [], notes: [], skipped: [] };
	const ops = [];
	const notes = [];
	const skipped = [];
	for (const [route, profile] of Object.entries(effective)) {
		if (!isRecord(profile) || !Array.isArray(profile.models)) continue;
		const storedProfile = stored[route];
		// Nothing to extend when the route's own list lives in a lower layer.
		if (!isRecord(storedProfile) || !Array.isArray(storedProfile.models)) continue;
		// A route that declares levels on any of its models is hand-maintained:
		// its blanks are the user's decision, so the whole route is left alone.
		if (storedProfile.models.some((model) => isRecord(model) && model.reasoningEfforts !== undefined)) {
			skipped.push(route);
			continue;
		}
		let changed = false;
		const models = storedProfile.models.map((model) => {
			if (!isRecord(model) || typeof model.id !== "string" || model.id.length === 0) return model;
			// An explicit declaration — a level map, or false — is final.
			if (model.reasoningEfforts !== undefined) return model;
			const capability = capabilityFor(model.id);
			changed = true;
			const next = { ...model, reasoningEfforts: capability.efforts };
			const carriesFormat = capability.thinkingFormat !== undefined && profile.api === COMPLETIONS_API;
			if (carriesFormat) {
				next.compat = { ...(isRecord(model.compat) ? model.compat : {}), thinkingFormat: capability.thinkingFormat };
			}
			notes.push({
				route,
				model: model.id,
				source: capability.source,
				efforts: capability.efforts,
				...(carriesFormat ? { thinkingFormat: capability.thinkingFormat } : {}),
			});
			return next;
		});
		if (changed) ops.push({ op: "set", path: ["providers", route, "models"], value: models });
	}
	return { ops, notes, skipped };
}

/** Services this plugin reads. */
export const inject = ["settings"];

/**
 * Fill in the reasoning capability of hand-maintained-free routes' models, once
 * the Loader has settled and again whenever the configuration changes.
 * @param ctx - host plugin context.
 */
export function apply(ctx) {
	/** How often each write has been tried, so a persistently failing write cannot loop. */
	const attempts = new Map();
	let sweeping = false;
	let queued = false;

	/** Attempts allowed per distinct write before it is abandoned until restart. */
	const MAX_ATTEMPTS = 3;

	const sweep = async () => {
		if (sweeping) {
			// A change arriving mid-sweep is served by one more pass, never a queue.
			queued = true;
			return;
		}
		sweeping = true;
		try {
			await ctx.root?.loader?.await?.();
			const descriptor = ctx.settings.describe().find((row) => row.ns === SETTINGS_NS);
			if (descriptor === undefined) return;
			const { ops, notes, skipped } = planSweep(descriptor);
			for (const route of skipped) {
				ctx.logger?.debug?.("thinking-depth: route %s declares its own levels; leaving it alone", route);
			}
			if (ops.length === 0) return;
			const signature = JSON.stringify(ops);
			const tried = attempts.get(signature) ?? 0;
			if (tried >= MAX_ATTEMPTS) return;
			attempts.set(signature, tried + 1);
			await ctx.settings.mutate(SETTINGS_NS, ops, descriptor.revision);
			attempts.delete(signature);
			for (const note of notes) {
				ctx.logger?.info?.(
					"thinking-depth: %s on %s gets %s (%s%s)",
					note.model,
					note.route,
					JSON.stringify(note.efforts),
					note.source,
					note.thinkingFormat === undefined ? "" : `, thinkingFormat ${note.thinkingFormat}`,
				);
			}
		} catch (error) {
			ctx.logger?.warn?.("thinking-depth: %s", error instanceof Error ? error.message : String(error));
		} finally {
			sweeping = false;
			if (queued) {
				queued = false;
				void sweep();
			}
		}
	};

	ctx.effect(() => {
		void sweep();
		// Root-scoped listeners: both events are emitted by sibling plugins, and a
		// listener on this plugin's own context would never receive them.
		let timer;
		const schedule = () => {
			if (timer !== undefined) return;
			timer = setTimeout(() => {
				timer = undefined;
				void sweep();
			}, 500);
		};
		const offReload = ctx.root.on("app-boot/config-reload", schedule);
		const offDocument = ctx.root.on("settings/document-updated", schedule);
		// Safety net: configuration can also change through paths that emit neither
		// event (a directly edited profile patch, for one), and a sweep over an
		// unchanged configuration is a cheap read that writes nothing.
		const interval = setInterval(() => {
			void sweep();
		}, 60000);
		return () => {
			if (typeof offReload === "function") offReload();
			if (typeof offDocument === "function") offDocument();
			clearInterval(interval);
			if (timer !== undefined) clearTimeout(timer);
		};
	}, "thinking-depth: reasoning capability sweep");
}
