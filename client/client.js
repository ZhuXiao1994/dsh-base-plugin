/**
 * Browser half of the Thinking Depth bundle: the plugin's own Settings
 * section with its two switches.
 *
 * This file is served as the package's `./client` export and is wrapped in the
 * DSH client module loader by hand (no build step). It imports only modules
 * the client module table provides: `react` and the UI primitives. All
 * persistence goes through `ctx.configForms`, the settings domain's shared
 * form over the Host configuration document, so the host half's regular
 * `apply()` config validation is the authority.
 */

window.__ModuleLoader__.load({
	id: "dsh-thinking-depth",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		const h = React.createElement;

		const NS = "dsh-thinking-depth";

		const en = {
			nav: "Thinking Depth",
			title: "Thinking Depth",
			intro: "Controls the plugin's two features. Changes take effect immediately.",
			thinkingDepth: "Enable thinking levels for third-party models",
			thinkingDepthHint:
				"Fills in reasoning levels for hand-declared third-party models. Turning this off stops new fills; levels already written are kept.",
			notifications: "Enable desktop reminders",
			notificationsHint:
				"Show a Windows toast when a task ends or needs your choice or confirmation.",
			loading: "Reading settings…",
			readOnly: "Settings are read-only in this deployment.",
			unavailable: "Plugin settings are currently unavailable.",
			saveFailed: "The setting was not saved. Please try again.",
		};

		const zh = {
			nav: "思考深度",
			title: "思考深度",
			intro: "控制本插件的两个功能，修改后立即生效。",
			thinkingDepth: "启用非官方模型的思考深度",
			thinkingDepthHint:
				"自动为手写声明的第三方模型补写推理档位。关闭后不再补写；已经写入的档位会保留。",
			notifications: "启用消息推送",
			notificationsHint: "任务结束，或需要你选择/确认时，弹出 Windows 通知。",
			loading: "正在读取设置…",
			readOnly: "当前部署的设置为只读。",
			unavailable: "插件设置当前不可用。",
			saveFailed: "设置没有保存成功，请重试。",
		};

		const css = [
			".dsh-thinking-depth-section{max-width:720px;display:flex;flex-direction:column;gap:12px;color:var(--dsw-alias-label-primary,#1f2329)}",
			".dsh-thinking-depth-title{margin:0;font-size:16px;font-weight:500;line-height:24px}",
			".dsh-thinking-depth-intro{margin:0;color:var(--dsw-alias-label-tertiary,#6b7280);font-size:14px;line-height:22px}",
			".dsh-thinking-depth-card{border:.5px solid var(--dsw-alias-settings-card-stroke,#e5e7eb);background:var(--dsw-alias-settings-card-fill,#fff);border-radius:var(--dsw-radius-xl,12px);padding:2px 14px;display:flex;flex-direction:column}",
			".dsh-thinking-depth-row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:12px 0}",
			".dsh-thinking-depth-row+.dsh-thinking-depth-row{border-top:.5px solid var(--dsw-alias-border-l3,#eef0f3)}",
			".dsh-thinking-depth-copy{display:flex;flex-direction:column;gap:4px;min-width:0}",
			".dsh-thinking-depth-label{font-size:14px;font-weight:500;line-height:22px}",
			".dsh-thinking-depth-hint{margin:0;color:var(--dsw-alias-label-tertiary,#6b7280);font-size:12px;line-height:18px}",
			".dsh-thinking-depth-note{margin:0;color:var(--dsw-alias-label-tertiary,#6b7280);font-size:12px;line-height:18px}",
			".dsh-thinking-depth-error{margin:0;color:var(--dsw-alias-state-error-primary,#d92d20);font-size:12px;line-height:18px}",
		].join("");

		const tagId = "dsh-thinking-depth/Settings.module.css";
		if (
			typeof document !== "undefined" &&
			document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null
		) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-thinking-depth";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		/** Required client services (Cordis fiber inject). */
		const inject = ["slots", "locale", "configForms"];

		/**
		 * Subscribe to one config form's snapshot.
		 * @param form - `ctx.configForms.get()` controller.
		 * @returns its current snapshot, re-rendered on every change.
		 */
		function useFormSnapshot(form) {
			const subscribe = React.useCallback((listener) => form.subscribe(listener), [form]);
			const getSnapshot = React.useCallback(() => form.getSnapshot(), [form]);
			return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
		}

		/**
		 * One label + hint + switch row.
		 * @param props - row copy, current value, disabled state, change handler.
		 * @returns the row element.
		 */
		function SettingRow(props) {
			const { Switch } = primitives;
			return h(
				"div",
				{ className: "dsh-thinking-depth-row" },
				h(
					"div",
					{ className: "dsh-thinking-depth-copy" },
					h("span", { className: "dsh-thinking-depth-label" }, props.label),
					h("p", { className: "dsh-thinking-depth-hint" }, props.hint),
				),
				h(Switch, {
					checked: props.checked,
					label: props.label,
					disabled: props.disabled,
					onChange: props.onChange,
				}),
			);
		}

		/**
		 * The Settings section.
		 * @param props - locale reader and this namespace's config form.
		 * @returns the section element.
		 */
		function Section(props) {
			const { t, form } = props;
			const snapshot = useFormSnapshot(form);
			const [saveFailed, setSaveFailed] = React.useState(false);
			const ready = snapshot.status === "ready";
			const disabled = !ready || snapshot.writable === false;
			const value = snapshot.value ?? {};
			const thinkingDepth = value.thinkingDepth !== false;
			const notifications = value.notifications !== false;

			const change = (field, checked) => {
				setSaveFailed(false);
				void form.set(field, checked).then(
					(accepted) => {
						if (!accepted) setSaveFailed(true);
					},
					() => setSaveFailed(true),
				);
			};

			let status = null;
			if (snapshot.status === "unavailable") {
				status = h("p", { className: "dsh-thinking-depth-note" }, t("unavailable"));
			} else if (!ready) {
				status = h("p", { className: "dsh-thinking-depth-note" }, t("loading"));
			} else if (snapshot.writable === false) {
				status = h("p", { className: "dsh-thinking-depth-note" }, t("readOnly"));
			}

			return h(
				"section",
				{ className: "dsh-thinking-depth-section" },
				h("h2", { className: "dsh-thinking-depth-title" }, t("title")),
				h("p", { className: "dsh-thinking-depth-intro" }, t("intro")),
				h(
					"div",
					{ className: "dsh-thinking-depth-card" },
					h(SettingRow, {
						label: t("thinkingDepth"),
						hint: t("thinkingDepthHint"),
						checked: thinkingDepth,
						disabled,
						onChange: (checked) => change("thinkingDepth", checked),
					}),
					h(SettingRow, {
						label: t("notifications"),
						hint: t("notificationsHint"),
						checked: notifications,
						disabled,
						onChange: (checked) => change("notifications", checked),
					}),
				),
				status,
				saveFailed ? h("p", { className: "dsh-thinking-depth-error", role: "alert" }, t("saveFailed")) : null,
			);
		}

		/**
		 * Mount the Settings section once the Host serves this namespace.
		 * @param ctx - client plugin context.
		 */
		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(
				() => ctx.locale.register(NS, { zh, en }),
				"dsh-thinking-depth: dictionaries",
			);
			const form = ctx.configForms.get(NS);
			ctx.effect(
				() =>
					ctx.configForms.whileServed([NS], () =>
						ctx.slots.inject("settings.section", () =>
							ctx.slots.register(
								{
									name: "settings.section",
									id: "thinking-depth",
									order: 35,
									label: () => t("nav"),
									locale: NS,
									inject: () => ({ t, form }),
								},
								Section,
							),
						),
					),
				"dsh-thinking-depth: settings section",
			);
		}

		exports.name = "dsh-thinking-depth";
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
