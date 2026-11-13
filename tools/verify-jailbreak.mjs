/**
 * Offline behaviour check for the real jailbreak injection.
 *
 * It drives `installJailbreak()` on a fake host context and asserts the two
 * things that decide whether the injection is real:
 *
 *   1. the sections are registered on `ctx.systemPrompt` (not written to a
 *      preset directory that nothing reads), and
 *   2. the anchor's order is greater than the last first-party section, so the
 *      model actually reads it last.
 *
 * It also checks the live gate: the section text is a function that follows
 * the `enhancedMode` switch, returns an empty string when off, and never
 * contains an unresolved interpolation group.
 */
import assert from "node:assert/strict";
import { ANCHOR, PERSONA } from "../jailbreak-text.js";
import {
	LAST_FIRST_PARTY_ORDER,
	SECTIONS,
	installJailbreak,
	sectionPlan,
} from "../jailbreak.js";

/** Build a fake host context that records prompt-section registrations. */
function makeContext() {
	const registered = [];
	const effects = [];
	const ctx = {
		systemPrompt: {
			section(descriptor) {
				registered.push(descriptor);
				return () => {
					const index = registered.indexOf(descriptor);
					if (index >= 0) registered.splice(index, 1);
				};
			},
		},
		effect(run, label) {
			const dispose = run();
			effects.push({ label, dispose });
			return () => {
				dispose?.();
				effects.splice(
					effects.findIndex((entry) => entry.label === label),
					1,
				);
			};
		},
	};
	return { ctx, registered, effects };
}

// 1. Two sections, registered through the prompt registry, in ascending order.
{
	const { ctx, registered, effects } = makeContext();
	let live = true;
	const install = installJailbreak(ctx, { read: () => ({ enhancedMode: live }), ttlMs: 0 });

	assert.equal(registered.length, 2, "persona and anchor are both registered");
	assert.deepEqual(
		registered.map((section) => section.name),
		[SECTIONS.persona.name, SECTIONS.anchor.name],
	);
	assert.deepEqual(
		registered.map((section) => section.order),
		[0, 60000],
	);
	assert.ok(
		registered[1].order > LAST_FIRST_PARTY_ORDER,
		"the anchor sorts after deployment:persona-suffix (10200)",
	);
	assert.equal(effects.length, 2, "each section is owned by one Cordis effect");
	assert.equal(install.enabled(), true);

	// 2. The text follows the live switch and is a function, not a snapshot.
	assert.equal(registered[0].text(), PERSONA);
	assert.equal(registered[1].text(), ANCHOR);
	live = false;
	assert.equal(install.enabled(), false);
	assert.equal(registered[0].text(), "", "off means an empty section, which renderPrompt drops");
	assert.equal(registered[1].text(), "");
	live = true;
	assert.equal(registered[1].text(), ANCHOR, "turning it back on needs no re-registration");

	// 3. A throwing settings read is treated as off, never as an exception.
	const failing = makeContext();
	const failingInstall = installJailbreak(failing.ctx, {
		read() {
			throw new Error("settings is restarting");
		},
		ttlMs: 0,
	});
	assert.equal(failingInstall.enabled(), false);
	assert.equal(failing.registered[0].text(), "");

	// 4. Disposal removes every registration.
	install.dispose();
	assert.equal(registered.length, 0);
}

// 5. The plan is exactly the two expected slots and carries real text.
{
	const plan = sectionPlan();
	assert.deepEqual(
		plan.map((entry) => [entry.key, entry.name, entry.order]),
		[
			["persona", SECTIONS.persona.name, 0],
			["anchor", SECTIONS.anchor.name, 60000],
		],
	);
	assert.ok(plan[0].text.length > 2000, "the persona is a complete ruleset, not a stub");
	assert.ok(plan[1].text.length > 1000, "the anchor is a complete ruling block, not a stub");
}

// 5b. Drift check against the installed DSH source of truth, when present.
// `LAST_FIRST_PARTY_ORDER` is the only number that makes the anchor the last
// thing the model reads; if a DSH upgrade moves the tail, this check fails.
{
	const { existsSync, readFileSync } = await import("node:fs");
	const tail = [
		"C:\\Users\\94438\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app\\dsh\\node_modules",
		"@deepseek-ai",
		"dsh-system-prompt",
		"lib",
		"index.js",
	].join("\\");
	if (existsSync(tail)) {
		const source = readFileSync(tail, "utf8");
		const match = /DEPLOYMENT_PERSONA_SUFFIX:\s*([\d.e]+)/u.exec(source);
		assert.ok(match, "the shipped order table still names DEPLOYMENT_PERSONA_SUFFIX");
		const shipped = Number(match[1]);
		assert.equal(
			shipped,
			LAST_FIRST_PARTY_ORDER,
			"the shipped tail order changed; re-check the anchor order in jailbreak.js",
		);
		assert.ok(SECTIONS.anchor.order > shipped);
		console.log(`jailbreak injection: shipped tail order ${shipped}, anchor ${SECTIONS.anchor.order}`);
	} else {
		console.log("jailbreak injection: shipped DSH sources not found, drift check skipped");
	}
}

// 6. Interpolation safety: no unresolved variable groups in either block.
{
	for (const [label, text] of [
		["persona", PERSONA],
		["anchor", ANCHOR],
	]) {
		assert.equal(text.includes("{{"), false, `${label} must not contain an interpolation group`);
		assert.equal(text.includes("`"), false, `${label} must not contain a backtick`);
	}
	assert.match(PERSONA, /第一原则/u);
	assert.match(PERSONA, /第三原则/u);
	assert.match(ANCHOR, /OPERATOR ANCHOR/u);
	assert.match(ANCHOR, /最末尾/u);
	assert.match(ANCHOR, /CATEGORY RULE — CODE/u);
}

console.log("jailbreak injection: all behaviour checks passed");
