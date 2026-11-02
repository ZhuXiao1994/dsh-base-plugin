/**
 * Browser half of the Thinking Depth & Notifications bundle: the plugin's own
 * Settings section with its switches and SMTP form.
 *
 * This file is served as the package's `./client` export and is wrapped in the
 * DSH client module loader by hand (no build step). It imports only modules
 * the client module table provides: `react` and the UI primitives. All
 * persistence goes through `ctx.configForms`, the settings domain's shared
 * form over the Host configuration document, so the host half's regular
 * `apply()` config validation is the authority.
 *
 * The SMTP password is a `role: "secret"` field. A remote settings read never
 * returns it; the page reads the redacted view only to show whether a password
 * is already configured, and writes a replacement only when the user types one.
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
			nav: "Thinking & Notifications",
			title: "Thinking Depth & Notifications",
			intro: "Controls thinking-level fill and reminder delivery. Changes take effect immediately.",
			thinkingDepth: "Enable thinking levels for third-party models",
			thinkingDepthHint:
				"Fills in reasoning levels for hand-declared third-party models. Turning this off stops new fills; levels already written are kept.",
			delivery: "Reminder delivery",
			localNotifications: "Local notifications",
			localNotificationsHint: "Show a Windows toast on this computer.",
			emailNotifications: "Email notifications",
			emailNotificationsHint:
				"Send reminders through SMTP so you can follow tasks away from this computer.",
			emailSettings: "Email (SMTP)",
			emailSettingsHint:
				"Use an app password or authorization code rather than your normal account password.",
			smtpHost: "SMTP server",
			smtpPort: "Port",
			smtpSecure: "SSL/TLS",
			smtpUser: "Username",
			smtpPass: "Password",
			smtpPassConfigured: "A password is configured. Leave blank to keep it.",
			smtpPassUnset: "No password configured.",
			emailFrom: "From address",
			emailFromHint: "Leave blank to use the SMTP username; a display name alone is not an address.",
			emailTo: "To",
			emailToHint: "Separate multiple addresses with commas.",
			emailIncomplete:
				"Email delivery is on but the SMTP settings are incomplete; no mail will be sent.",
			save: "Save email settings",
			saving: "Saving…",
			saved: "Saved.",
			clearPassword: "Clear password",
			testEmail: "Send test email",
			testing: "Sending…",
			testFailed: "The test request could not be sent. Try again.",
			testSuccess: "Test email sent.",
			testTimeout: "Timed out waiting for the test result. Check the app log.",
			testEmailHint:
				"The test saves the current form first, then sends one email with the saved SMTP settings.",
			invalidPort: "Port must be an integer between 1 and 65535.",
			loading: "Reading settings…",
			readOnly: "Settings are read-only in this deployment.",
			unavailable: "Plugin settings are currently unavailable.",
			saveFailed: "The setting was not saved. Please try again.",
		};

		const zh = {
			nav: "思考与消息",
			title: "思考深度与消息推送",
			intro: "控制推理档位补写和提醒的发送方式，修改后立即生效。",
			thinkingDepth: "启用非官方模型的思考深度",
			thinkingDepthHint:
				"自动为手写声明的第三方模型补写推理档位。关闭后不再补写；已经写入的档位会保留。",
			delivery: "提醒方式",
			localNotifications: "本地通知",
			localNotificationsHint: "在运行 DSH 的电脑上弹出 Windows 通知。",
			emailNotifications: "邮箱推送",
			emailNotificationsHint: "通过 SMTP 发送提醒，离开电脑也能知道任务情况。",
			emailSettings: "邮箱设置（SMTP）",
			emailSettingsHint: "建议使用邮箱的授权码，不要填写登录密码。",
			smtpHost: "SMTP 服务器",
			smtpPort: "端口",
			smtpSecure: "SSL/TLS",
			smtpUser: "用户名",
			smtpPass: "密码 / 授权码",
			smtpPassConfigured: "已保存密码；留空表示保持不变。",
			smtpPassUnset: "尚未保存密码。",
			emailFrom: "发件人地址",
			emailFromHint: "留空时使用 SMTP 用户名；只写昵称不会发信。",
			emailTo: "收件人",
			emailToHint: "多个地址用逗号分隔。",
			emailIncomplete: "邮箱推送已开启，但 SMTP 信息不完整，暂时不会发信。",
			save: "保存邮箱设置",
			saving: "保存中…",
			saved: "已保存。",
			clearPassword: "清除密码",
			testEmail: "测试发送",
			testing: "发送中…",
			testFailed: "测试请求没有发出去，请重试。",
			testSuccess: "测试邮件已发送。",
			testTimeout: "等待测试结果超时，请检查应用日志。",
			testEmailHint: "点击测试时会先保存当前表单，再用已保存的 SMTP 设置发送一封测试邮件。",
			invalidPort: "端口必须是 1–65535 之间的整数。",
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
			".dsh-thinking-depth-success{margin:0;color:var(--dsw-alias-state-success-primary,#15803d);font-size:12px;line-height:18px}",
			".dsh-thinking-depth-group{padding:10px 0 2px;border-top:.5px solid var(--dsw-alias-border-l3,#eef0f3);margin-top:2px;font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-secondary,#4b5563)}",
			".dsh-thinking-depth-form{border:.5px solid var(--dsw-alias-settings-card-stroke,#e5e7eb);background:var(--dsw-alias-settings-card-fill,#fff);border-radius:var(--dsw-radius-xl,12px);padding:14px;display:flex;flex-direction:column;gap:12px}",
			".dsh-thinking-depth-formHead{display:flex;flex-direction:column;gap:4px}",
			".dsh-thinking-depth-formTitle{font-size:14px;font-weight:500;line-height:22px}",
			".dsh-thinking-depth-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}",
			".dsh-thinking-depth-field{display:flex;flex-direction:column;gap:6px;min-width:0}",
			".dsh-thinking-depth-fieldLabel{font-size:12px;font-weight:500;line-height:18px;color:var(--dsw-alias-label-secondary,#4b5563)}",
			".dsh-thinking-depth-input{box-sizing:border-box;width:100%;height:34px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l3,#d9dce1);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2329);font:inherit;font-size:13px}",
			".dsh-thinking-depth-input:focus{outline:none;border-color:var(--dsw-alias-border-primary,#6b7280)}",
			".dsh-thinking-depth-input:disabled{opacity:.6}",
			".dsh-thinking-depth-inline{display:flex;align-items:center;gap:8px;min-height:34px}",
			".dsh-thinking-depth-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}",
			".dsh-thinking-depth-button{height:32px;padding:0 14px;border:.5px solid var(--dsw-alias-border-l3,#d9dce1);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2329);font:inherit;font-size:13px;cursor:pointer}",
			".dsh-thinking-depth-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,#f3f4f6)}",
			".dsh-thinking-depth-button:disabled{opacity:.5;cursor:default}",
			".dsh-thinking-depth-linkButton{border:none;background:none;padding:0;color:var(--dsw-alias-link,#2563eb);font:inherit;font-size:12px;cursor:pointer}",
			".dsh-thinking-depth-linkButton:disabled{opacity:.5;cursor:default}",
			"@media (width<=600px){.dsh-thinking-depth-grid{grid-template-columns:1fr}}",
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
		const inject = ["slots", "locale", "configForms", "remote", "remote.settings"];

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
		 * One labelled text input for the SMTP form.
		 * @param props - label, value, input type, hint, disabled state, change handler.
		 * @returns the field element.
		 */
		function Field(props) {
			return h(
				"label",
				{ className: "dsh-thinking-depth-field" },
				h("span", { className: "dsh-thinking-depth-fieldLabel" }, props.label),
				h("input", {
					className: "dsh-thinking-depth-input",
					type: props.type ?? "text",
					value: props.value ?? "",
					placeholder: props.placeholder,
					autoComplete: props.autoComplete ?? "off",
					inputMode: props.inputMode,
					disabled: props.disabled,
					onChange: (event) => props.onChange(event.target.value),
				}),
				props.hint ? h("span", { className: "dsh-thinking-depth-hint" }, props.hint) : null,
			);
		}

		/**
		 * The Settings section.
		 * @param props - locale reader, config form and the remote settings reader.
		 * @returns the section element.
		 */
		function Section(props) {
			const { t, form, remote } = props;
			const snapshot = useFormSnapshot(form);
			const [saveFailed, setSaveFailed] = React.useState(false);
			const [secretSet, setSecretSet] = React.useState(false);
			const [saving, setSaving] = React.useState(false);
			const [saved, setSaved] = React.useState(false);
			const [fieldError, setFieldError] = React.useState("");
			const [dirty, setDirty] = React.useState(false);
			const [draft, setDraft] = React.useState({});
			const [testing, setTesting] = React.useState(false);
			const [testMessage, setTestMessage] = React.useState("");
			const [testOk, setTestOk] = React.useState(false);

			const ready = snapshot.status === "ready";
			const disabled = !ready || snapshot.writable === false;
			const value = snapshot.value ?? {};
			const emailEnabled = value.email === true;

			const refreshSecret = React.useCallback(async () => {
				try {
					const response = await remote.settings.describe();
					if (!response?.ok) return;
					const view = response.value?.namespaces?.find((row) => row.ns === NS);
					const secret = view?.secrets?.find(
						(item) => item.path.length === 1 && item.path[0] === "smtpPass",
					);
					setSecretSet(secret?.set === true);
				} catch {
					/* the page still works without the secret marker */
				}
			}, [remote]);

			React.useEffect(() => {
				void refreshSecret();
			}, [refreshSecret]);

			React.useEffect(() => {
				if (!ready || dirty) return;
				setDraft({
					smtpHost: value.smtpHost ?? "",
					smtpPort: String(value.smtpPort ?? 587),
					smtpSecure: value.smtpSecure === true,
					smtpUser: value.smtpUser ?? "",
					emailFrom: value.emailFrom ?? "",
					emailTo: value.emailTo ?? "",
					smtpPass: "",
				});
			}, [ready, dirty, snapshot.revision]);

			React.useEffect(() => {
				if (!testing) return;
				const timer = setTimeout(() => {
					setTesting(false);
					setTestOk(false);
					setTestMessage(t("testTimeout"));
				}, 45_000);
				return () => clearTimeout(timer);
			}, [testing, t]);

			const edit = (key, next) => {
				setSaved(false);
				setFieldError("");
				setDirty(true);
				setDraft((previous) => ({ ...previous, [key]: next }));
			};

			const change = (field, checked) => {
				setSaveFailed(false);
				setSaved(false);
				void form.set(field, checked).then(
					(accepted) => {
						if (!accepted) setSaveFailed(true);
					},
					() => setSaveFailed(true),
				);
			};

			const saveEmail = async () => {
				if (disabled || saving) return false;
				const port = Number.parseInt(String(draft.smtpPort ?? ""), 10);
				if (!Number.isInteger(port) || port < 1 || port > 65535) {
					setFieldError(t("invalidPort"));
					return false;
				}
				const next = {
					smtpHost: String(draft.smtpHost ?? "").trim(),
					smtpPort: port,
					smtpSecure: draft.smtpSecure === true,
					smtpUser: String(draft.smtpUser ?? "").trim(),
					emailFrom: String(draft.emailFrom ?? "").trim(),
					emailTo: String(draft.emailTo ?? "").trim(),
				};
				const ops = [];
				for (const [key, entry] of Object.entries(next)) {
					if (value[key] !== entry) ops.push({ op: "set", path: [key], value: entry });
				}
				if (String(draft.smtpPass ?? "") !== "") {
					ops.push({ op: "set", path: ["smtpPass"], value: draft.smtpPass });
				}
				if (ops.length === 0) {
					setSaved(true);
					setDirty(false);
					return true;
				}
				setSaving(true);
				setSaveFailed(false);
				setFieldError("");
				try {
					const accepted = await form.mutate(ops);
					if (!accepted) {
						setSaveFailed(true);
						return false;
					}
					setSaved(true);
					setDirty(false);
					setDraft((previous) => ({ ...previous, smtpPass: "" }));
					await refreshSecret();
					return true;
				} catch {
					setSaveFailed(true);
					return false;
				} finally {
					setSaving(false);
				}
			};

			const clearPassword = async () => {
				if (disabled || saving || !secretSet) return;
				setSaving(true);
				setSaveFailed(false);
				try {
					const accepted = await form.unset("smtpPass");
					if (!accepted) {
						setSaveFailed(true);
						return;
					}
					setSecretSet(false);
					setDraft((previous) => ({ ...previous, smtpPass: "" }));
					setSaved(true);
				} catch {
					setSaveFailed(true);
				} finally {
					setSaving(false);
				}
			};

			const testEmail = async () => {
				if (disabled || saving || testing) return;
				if (dirty) {
					const saved = await saveEmail();
					if (!saved) return;
				}
				setTesting(true);
				setTestOk(false);
				setTestMessage("");
				try {
					const response = await fetch("/dsh-thinking-depth/test-email", {
						method: "POST",
						headers: {
							"content-type": "application/json",
							"x-dsh-test-email": "1",
						},
						body: "{}",
					});
					const payload = await response.json().catch(() => ({}));
					if (!response.ok || payload?.ok !== true) {
						setTestOk(false);
						setTestMessage(String(payload?.error ?? t("testFailed")));
					} else {
						setTestOk(true);
						setTestMessage(String(payload?.message ?? t("testSuccess")));
					}
				} catch {
					setTestOk(false);
					setTestMessage(t("testFailed"));
				} finally {
					setTesting(false);
				}
			};

			const addressLike = (candidate) =>
				/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(String(candidate ?? "").trim());
			const savedUser = String(value.smtpUser ?? "").trim();
			const savedFrom = String(value.emailFrom ?? "").trim();
			const sender = addressLike(savedFrom) ? savedFrom : addressLike(savedUser) ? savedUser : "";
			const recipients = String(value.emailTo ?? "")
				.split(/[,;]/u)
				.map((entry) => entry.trim())
				.filter((entry) => entry !== "");
			const authComplete = savedUser === "" ? !secretSet : secretSet;
			const emailConfigured =
				String(value.smtpHost ?? "").trim() !== "" &&
				sender !== "" &&
				recipients.length > 0 &&
				recipients.every(addressLike) &&
				Number.isInteger(value.smtpPort) &&
				value.smtpPort >= 1 &&
				value.smtpPort <= 65535 &&
				authComplete;

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
						checked: value.thinkingDepth !== false,
						disabled,
						onChange: (checked) => change("thinkingDepth", checked),
					}),
					h("div", { className: "dsh-thinking-depth-group" }, t("delivery")),
					h(SettingRow, {
						label: t("localNotifications"),
						hint: t("localNotificationsHint"),
						checked: value.notifications !== false,
						disabled,
						onChange: (checked) => change("notifications", checked),
					}),
					h(SettingRow, {
						label: t("emailNotifications"),
						hint: t("emailNotificationsHint"),
						checked: emailEnabled,
						disabled,
						onChange: (checked) => change("email", checked),
					}),
				),
				emailEnabled
					? h(
							"div",
							{ className: "dsh-thinking-depth-form" },
							h(
								"div",
								{ className: "dsh-thinking-depth-formHead" },
								h("span", { className: "dsh-thinking-depth-formTitle" }, t("emailSettings")),
								h("p", { className: "dsh-thinking-depth-hint" }, t("emailSettingsHint")),
							),
							h(Field, {
								label: t("smtpHost"),
								value: draft.smtpHost,
								disabled: disabled || saving,
								onChange: (next) => edit("smtpHost", next),
							}),
							h(
								"div",
								{ className: "dsh-thinking-depth-grid" },
								h(Field, {
									label: t("smtpPort"),
									value: draft.smtpPort,
									inputMode: "numeric",
									disabled: disabled || saving,
									onChange: (next) => edit("smtpPort", next),
								}),
								h(
									"div",
									{ className: "dsh-thinking-depth-field" },
									h("span", { className: "dsh-thinking-depth-fieldLabel" }, t("smtpSecure")),
									h(
										"div",
										{ className: "dsh-thinking-depth-inline" },
										h(primitives.Switch, {
											checked: draft.smtpSecure === true,
											label: t("smtpSecure"),
											disabled: disabled || saving,
											onChange: (checked) => edit("smtpSecure", checked),
										}),
									),
								),
							),
							h(Field, {
								label: t("smtpUser"),
								value: draft.smtpUser,
								disabled: disabled || saving,
								onChange: (next) => edit("smtpUser", next),
							}),
							h(Field, {
								label: t("smtpPass"),
								type: "password",
								value: draft.smtpPass,
								placeholder: secretSet ? t("smtpPassConfigured") : t("smtpPassUnset"),
								hint: secretSet ? t("smtpPassConfigured") : t("smtpPassUnset"),
								autoComplete: "new-password",
								disabled: disabled || saving,
								onChange: (next) => edit("smtpPass", next),
							}),
							h(
								"div",
								{ className: "dsh-thinking-depth-grid" },
								h(Field, {
									label: t("emailFrom"),
									value: draft.emailFrom,
									hint: t("emailFromHint"),
									disabled: disabled || saving,
									onChange: (next) => edit("emailFrom", next),
								}),
								h(Field, {
									label: t("emailTo"),
									value: draft.emailTo,
									hint: t("emailToHint"),
									disabled: disabled || saving,
									onChange: (next) => edit("emailTo", next),
								}),
							),
							h(
								"div",
								{ className: "dsh-thinking-depth-actions" },
								h(
									"button",
									{
										type: "button",
										className: "dsh-thinking-depth-button",
										disabled: disabled || saving,
										onClick: () => void saveEmail(),
									},
									saving ? t("saving") : t("save"),
								),
								h(
									"button",
									{
										type: "button",
										className: "dsh-thinking-depth-button",
										disabled: disabled || saving || testing,
										onClick: () => void testEmail(),
									},
									testing ? t("testing") : t("testEmail"),
								),
								secretSet
									? h(
											"button",
											{
												type: "button",
												className: "dsh-thinking-depth-linkButton",
												disabled: disabled || saving || testing,
												onClick: () => void clearPassword(),
											},
											t("clearPassword"),
										)
									: null,
								saved ? h("span", { className: "dsh-thinking-depth-success" }, t("saved")) : null,
							),
							h("p", { className: "dsh-thinking-depth-hint" }, t("testEmailHint")),
							fieldError ? h("p", { className: "dsh-thinking-depth-error" }, fieldError) : null,
							testMessage
								? h(
										"p",
										{
											className: testOk
												? "dsh-thinking-depth-success"
												: "dsh-thinking-depth-error",
											role: testOk ? "status" : "alert",
										},
										testMessage,
									)
								: null,
						)
					: null,
				emailEnabled && !dirty && !emailConfigured
					? h("p", { className: "dsh-thinking-depth-note" }, t("emailIncomplete"))
					: null,
				status,
				saveFailed
					? h("p", { className: "dsh-thinking-depth-error", role: "alert" }, t("saveFailed"))
					: null,
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
									inject: () => ({ t, form, remote: ctx.remote }),
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
