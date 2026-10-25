/**
 * Smoke test for the browser half without a browser.
 *
 * It executes the real `client/client.js` through a fake module loader, then
 * renders the registered Settings section with a minimal React shim. This
 * catches registration mistakes, missing require entries, bad props and
 * crashes in the ready/loading/read-only states; it does not pretend to test
 * real React rendering or CSS.
 */
import assert from "node:assert/strict";

const NS = "dsh-thinking-depth";

// --- fake React -----------------------------------------------------------
const fakeReact = {
	createElement(type, props, ...children) {
		const merged = { ...(props ?? {}) };
		if (children.length > 0) merged.children = children.flat();
		if (typeof type === "function") return type(merged);
		return { type, props: merged, children: children.flat() };
	},
	useCallback: (callback) => callback,
	useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
	useState: (initial) => [initial, () => {}],
};

const Switch = (props) => ({ type: "Switch", props, children: [] });

// --- fake browser ---------------------------------------------------------
const styleTags = [];
globalThis.document = {
	querySelector: () => null,
	createElement: () => ({ dataset: {}, textContent: "" }),
	head: { appendChild: (tag) => styleTags.push(tag) },
};

let moduleDefinition;
globalThis.window = {
	__ModuleLoader__: {
		load(definition) {
			moduleDefinition = definition;
		},
	},
};

await import(new URL("../client/client.js", import.meta.url).href);

assert.ok(moduleDefinition, "the bundle registers itself with the client module loader");
assert.equal(moduleDefinition.id, NS);

const bundle = moduleDefinition.factory((id) => {
	if (id === "react") return fakeReact;
	if (id === "@deepseek-ai/dsh-client-ui-primitives") return { Switch };
	throw new Error(`unexpected client require: ${id}`);
});

assert.equal(typeof bundle.apply, "function");
assert.equal(bundle.name, NS);
assert.deepEqual(bundle.inject, ["slots", "locale", "configForms"]);
assert.equal(styleTags.length, 1, "the stylesheet is injected once");

/** Minimal fake config form over one fixed snapshot. */
function makeForm(snapshot) {
	const calls = [];
	return {
		calls,
		subscribe: () => () => {},
		getSnapshot: () => snapshot,
		set(field, value) {
			calls.push([field, value]);
			return Promise.resolve(true);
		},
	};
}

/** Install the bundle on a fake client context and return its registration. */
function mount(form) {
	const dictionaries = {};
	let registered;
	const ctx = {
		locale: {
			register(namespace, dicts) {
				dictionaries[namespace] = dicts;
				return () => {};
			},
			bind(namespace) {
				return (key) => dictionaries[namespace]?.zh?.[key] ?? key;
			},
		},
		configForms: {
			get: () => form,
			whileServed(_namespaces, register) {
				return register();
			},
		},
		slots: {
			inject(_slot, callback) {
				return callback();
			},
			register(meta, component) {
				registered = { meta, component };
				return () => {};
			},
		},
		effect(callback) {
			return callback();
		},
	};
	bundle.apply(ctx);
	assert.ok(registered, "the settings section is registered");
	return registered;
}

/** Collect text content from a fake element tree. */
function textOf(node) {
	if (node === null || node === undefined || node === false) return "";
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(textOf).join("");
	return (node.children ?? []).map(textOf).join("");
}

/** Collect every element matching a predicate. */
function collect(node, predicate, out = []) {
	if (node === null || node === undefined || typeof node !== "object") return out;
	if (Array.isArray(node)) {
		for (const child of node) collect(child, predicate, out);
		return out;
	}
	if (predicate(node)) out.push(node);
	for (const child of node.children ?? []) collect(child, predicate, out);
	return out;
}

// 1. Ready state: both switches render with their labels and hints.
{
	const form = makeForm({
		status: "ready",
		value: { thinkingDepth: true, notifications: true },
		writable: true,
		revision: 0,
	});
	const registration = mount(form);
	assert.equal(registration.meta.name, "settings.section");
	assert.equal(registration.meta.id, "thinking-depth");
	assert.equal(registration.meta.order, 35);
	assert.equal(registration.meta.locale, NS);
	assert.equal(registration.meta.label(), "思考与消息");

	const tree = registration.component(registration.meta.inject());
	const text = textOf(tree);
	assert.match(text, /思考深度/u);
	assert.match(text, /启用非官方模型的思考深度/u);
	assert.match(text, /启用消息推送/u);

	const switches = collect(tree, (node) => node.type === "Switch");
	assert.equal(switches.length, 2);
	assert.equal(switches.every((node) => node.props.checked === true), true);
	assert.equal(switches.every((node) => node.props.disabled === false), true);

	switches[0].props.onChange(false);
	assert.deepEqual(form.calls, [["thinkingDepth", false]]);
}

// 2. Loading, read-only and unavailable states are explained and disabled.
{
	const loading = mount(
		makeForm({ status: "loading", value: undefined, writable: false, revision: undefined }),
	);
	const loadingTree = loading.component(loading.meta.inject());
	assert.match(textOf(loadingTree), /正在读取设置/u);
	assert.equal(
		collect(loadingTree, (node) => node.type === "Switch").every((node) => node.props.disabled === true),
		true,
	);

	const readOnly = mount(
		makeForm({
			status: "ready",
			value: { thinkingDepth: true, notifications: false },
			writable: false,
			revision: 1,
		}),
	);
	const readOnlyTree = readOnly.component(readOnly.meta.inject());
	assert.match(textOf(readOnlyTree), /只读/u);
	const readOnlySwitches = collect(readOnlyTree, (node) => node.type === "Switch");
	assert.equal(readOnlySwitches[1].props.checked, false);
	assert.equal(readOnlySwitches.every((node) => node.props.disabled === true), true);

	const unavailable = mount(
		makeForm({ status: "unavailable", value: undefined, writable: false, revision: undefined }),
	);
	assert.match(textOf(unavailable.component(unavailable.meta.inject())), /当前不可用/u);
}

console.log("client section: all behaviour checks passed");
