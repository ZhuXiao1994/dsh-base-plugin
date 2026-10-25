/**
 * Windows toast delivery for the attention notifier.
 *
 * The host half of this bundle runs in a plain Node process (the Desktop shell
 * forks it, it is not the Electron main process), so `electron.Notification`
 * is not available. A WinRT toast raised from Windows PowerShell is the
 * dependency-free path: every supported Windows install ships
 * `powershell.exe` and the `Windows.UI.Notifications` projection, and reusing
 * PowerShell's own AppUserModelID means we do not have to register a Start
 * Menu shortcut before the first toast can show.
 *
 * Delivery is fire-and-forget and failure is contained: a missing
 * `powershell.exe`, a disabled notification channel, or Focus Assist must
 * never disturb the agent session that triggered the reminder.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** AppUserModelID already registered by Windows PowerShell. */
const POWERSHELL_AUMID = "Microsoft.Windows.PowerShell";
/** Hard cap on one toast helper process; a hung shell is abandoned, not awaited. */
const RUN_TIMEOUT_MS = 15_000;
/** How long the helper stays alive after `Show()` so the platform picks the toast up. */
const LINGER_MS = 2_000;

/**
 * Escape a value for a PowerShell single-quoted literal.
 * @param value - text to embed.
 * @returns the literal content, with quotes doubled.
 */
export function escapePowerShellString(value) {
	return String(value).replace(/'/g, "''");
}

/**
 * Escape a value for an XML attribute delimited by double quotes.
 * @param value - text to embed.
 * @returns the escaped attribute value.
 */
export function escapeXmlAttribute(value) {
	return String(value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/**
 * Absolute path to the toast image shipped with the package.
 * @returns the PNG path, or null when the asset is unavailable.
 */
export function toastIconPath() {
	try {
		const path = fileURLToPath(new URL("./icon.png", import.meta.url));
		return existsSync(path) ? path : null;
	} catch {
		return null;
	}
}

/**
 * The Windows PowerShell executable, preferring the absolute system path over
 * PATH resolution.
 * @returns an executable path or command name.
 */
function powershellExecutable() {
	const root = process.env.SystemRoot ?? process.env.windir;
	if (typeof root === "string" && root.length > 0) {
		const candidate = join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
		if (existsSync(candidate)) return candidate;
	}
	return "powershell.exe";
}

/**
 * Build the PowerShell script that raises one WinRT toast.
 *
 * `ToastText02` is the two-line template: a bold title and a wrapped body.
 * The template's audio node is replaced (rather than appended to) because two
 * `<audio>` children make the toast XML invalid. An icon is added as an
 * `appLogoOverride` image when its absolute path is supplied.
 *
 * @param title - bold first line.
 * @param body - wrapped second line.
 * @param options - toast presentation options.
 * @param options.sound - play the default notification sound (default true).
 * @param options.iconPath - absolute PNG path, or null for no image.
 * @returns the complete script, ready for `powershell.exe -Command`.
 */
export function buildToastScript(title, body, { sound = true, iconPath = null } = {}) {
	const clean = (value) => String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ");
	const lines = [
		"$ErrorActionPreference = 'Stop'",
		"[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null",
		`$appId = '${escapePowerShellString(POWERSHELL_AUMID)}'`,
		"$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
		"$textNodes = @($xml.GetElementsByTagName('text'))",
		`$textNodes[0].AppendChild($xml.CreateTextNode('${escapePowerShellString(clean(title))}')) > $null`,
		`$textNodes[1].AppendChild($xml.CreateTextNode('${escapePowerShellString(clean(body))}')) > $null`,
		"$toastRoot = $xml.SelectSingleNode('/toast')",
		"$staleAudio = $toastRoot.SelectSingleNode('audio')",
		"if ($null -ne $staleAudio) { $toastRoot.RemoveChild($staleAudio) > $null }",
		"$audio = $xml.CreateElement('audio')",
		sound
			? "$audio.SetAttribute('src', 'ms-winsoundevent:Notification.Default')"
			: "$audio.SetAttribute('silent', 'true')",
		"$toastRoot.AppendChild($audio) > $null",
	];

	if (typeof iconPath === "string" && iconPath.length > 0) {
		const normalized = iconPath.replace(/\\/g, "/");
		const src = normalized.startsWith("/") ? `file://${normalized}` : `file:///${normalized}`;
		lines.push(
			"$image = $xml.CreateElement('image')",
			"$image.SetAttribute('placement', 'appLogoOverride')",
			`$image.SetAttribute('src', '${escapePowerShellString(escapeXmlAttribute(src))}')`,
			"$toastRoot.AppendChild($image) > $null",
		);
	}

	lines.push(
		"$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)",
		"[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)",
		`Start-Sleep -Milliseconds ${String(LINGER_MS)}`,
	);
	return lines.join("\n");
}

/**
 * Raise one Windows toast without awaiting it.
 *
 * @param title - bold first line.
 * @param body - wrapped second line.
 * @param options - delivery options.
 * @param options.sound - play the default notification sound.
 * @param options.iconPath - override the packaged icon; null disables it.
 * @param options.logger - debug logger for contained failures.
 * @returns whether a helper process was started.
 */
export function sendWindowsToast(title, body, { sound = true, iconPath, logger } = {}) {
	if (process.platform !== "win32") {
		logger?.debug?.("thinking-depth: desktop reminders are Windows-only; toast skipped");
		return false;
	}
	let script;
	try {
		script = buildToastScript(title, body, {
			sound,
			iconPath: iconPath === undefined ? toastIconPath() : iconPath,
		});
	} catch (error) {
		logger?.debug?.("thinking-depth: toast script could not be built: %s", describe(error));
		return false;
	}
	try {
		execFile(
			powershellExecutable(),
			["-NoProfile", "-NonInteractive", "-Command", script],
			{ timeout: RUN_TIMEOUT_MS, windowsHide: true },
			(error, _stdout, stderr) => {
				if (error === null) return;
				const detail = String(stderr ?? "").trim().slice(0, 200);
				logger?.debug?.(
					"thinking-depth: toast failed: %s%s",
					describe(error),
					detail === "" ? "" : ` (${detail})`,
				);
			},
		);
		return true;
	} catch (error) {
		logger?.debug?.("thinking-depth: toast could not start: %s", describe(error));
		return false;
	}
}

/** @param error - unknown thrown value. @returns a human-readable cause. */
function describe(error) {
	return error instanceof Error ? error.message : String(error);
}
