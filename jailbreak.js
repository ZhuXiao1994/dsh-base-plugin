/**
 * 真破甲注入：把操作者人格和末尾锚点写进系统提示词。
 *
 * 机制来自 DSH 的 `dsh-system-prompt`：`ctx.systemPrompt.section()` 注册的段落按
 * order 升序拼接（同 order 按名字的 code-unit 顺序），并在每次组装时重新求值。
 * 因此 `text` 必须是函数 —— 写成字符串只会在 apply 时求值一次，之后改设置不生效。
 *
 * 顺序表（来自 dsh-system-prompt 的 SECTION_ORDERS）：
 *   -1000  harness:identity
 *       0  deployment:persona-prefix
 *     500  plan policy
 *     900  file reference
 *   1000+  各工具说明
 *    5000  tools SDK
 *    9000  deliverable file references
 *    9900  structured output
 *   10000  harness source
 *   10100  web surface
 *   10200  deployment:persona-suffix  ← 第一方最后一个段落
 *
 * 所以"末尾锚点"的 order 必须大于 10200。参考实现 pojia 用的是 900，
 * 那只是文件引用段之前，锚点会被后面上万字的工具说明淹没 —— 这是它没能
 * 真正压住末尾的原因。这里用 60000，稳定落在最后。
 */

import { readSettings } from "./settings.js";
import { ANCHOR, PERSONA } from "./jailbreak-text.js";

/** 第一方最后一个段落的 order（DEPLOYMENT_PERSONA_SUFFIX）。 */
export const LAST_FIRST_PARTY_ORDER = 10200;

/** 两个段落的名字与 order。名字带命名空间，避免和别的插件撞名。 */
export const SECTIONS = Object.freeze({
	persona: Object.freeze({ name: "thinking-depth:operator-persona", order: 0 }),
	anchor: Object.freeze({ name: "thinking-depth:operator-anchor", order: 60000 }),
});

/** 设置读取的短缓存：section text 每个模型步都会被调用一次。 */
const SETTINGS_TTL_MS = 250;

/**
 * 段落计划：真正的注入内容与顺序。导出来给离线 harness 断言用。
 * @returns the two section descriptors, in registration order.
 */
export function sectionPlan() {
	return [
		{ key: "persona", ...SECTIONS.persona, text: PERSONA },
		{ key: "anchor", ...SECTIONS.anchor, text: ANCHOR },
	];
}

/**
 * 注册两个动态段落，按设置实时开关。
 *
 * 关闭时 `text` 返回空串：renderPrompt 会丢掉空段落，等于从提示词里消失，
 * 不需要卸载注册、不需要重启，也不会在注册表里留下重复项。
 *
 * @param ctx - host plugin context with the `systemPrompt` service.
 * @param options - test seams: `read` (settings reader) and `ttlMs` (cache window).
 * @returns the live gate and a disposer for the two registrations.
 */
export function installJailbreak(ctx, options = {}) {
	const read =
		typeof options.read === "function" ? options.read : () => readSettings(ctx);
	const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : SETTINGS_TTL_MS;
	const logger = options.logger ?? ctx.logger;

	let cached = { at: 0, enabled: false, primed: false };

	/** 当前是否开启破甲；读设置失败时按关闭处理（失败安全）。 */
	const enabled = () => {
		const now = Date.now();
		if (cached.primed && now - cached.at < ttlMs) return cached.enabled;
		const previous = cached;
		let value = false;
		try {
			value = read()?.enhancedMode === true;
		} catch {
			value = false;
		}
		cached = { at: now, enabled: value, primed: true };
		// 只在状态翻转时记一行，方便在应用日志里确认注入是否真的生效。
		if (!previous.primed || previous.enabled !== value) {
			try {
				logger?.info?.(
					value
						? "thinking-depth: jailbreak injected (persona order 0, anchor order %d)"
						: "thinking-depth: jailbreak off, prompt sections removed",
					SECTIONS.anchor.order,
				);
			} catch {
				/* logging must never throw */
			}
		}
		return value;
	};

	const disposers = [];
	for (const section of sectionPlan()) {
		disposers.push(
			ctx.effect(
				() =>
					ctx.systemPrompt.section({
						name: section.name,
						order: section.order,
						text: () => (enabled() ? section.text : ""),
					}),
				`thinking-depth: ${section.key} section`,
			),
		);
	}

	return {
		enabled,
		/** Invalidate the cache so the next assembly sees a freshly written switch. */
		invalidate() {
			cached = { at: 0, enabled: false, primed: false };
		},
		dispose() {
			for (const dispose of disposers) {
				try {
					dispose();
				} catch {
					/* disposal must never throw into the host */
				}
			}
		},
	};
}
