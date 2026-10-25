/**
 * Send one real Windows toast, for manual verification of the notification
 * channel. This is a development tool, not part of the plugin.
 *
 * Usage: node tools/notify-smoke.mjs ["title"] ["body"]
 *
 * It prints whether the helper process started and waits four seconds so the
 * toast platform can pick the toast up before the Node process exits.
 */
import { sendWindowsToast, toastIconPath } from "../notify-windows.js";

const title = process.argv[2] ?? "DSH 提醒测试";
const body = process.argv[3] ?? "「思考深度」通知通道正常。";

if (toastIconPath() === null) {
	console.warn("icon.png is missing; the toast will use the PowerShell icon");
}

const started = sendWindowsToast(title, body, {
	logger: { debug: (...args) => console.debug("[toast]", ...args) },
});

if (!started) {
	console.error("the toast helper did not start (this feature is Windows-only)");
	process.exitCode = 1;
} else {
	console.log(`toast handed to Windows: ${title} / ${body}`);
	setTimeout(() => {}, 4_000);
}
