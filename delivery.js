/**
 * Channel dispatch for one accepted reminder.
 *
 * The notifier owns triggers, dedupe and scheduling; this module only decides
 * which configured channels carry one accepted notification. It reads the
 * live Settings document at delivery time, so turning local or email delivery
 * off applies to the next reminder without reinstalling anything.
 *
 * Each channel is isolated: a failed toast or mail send is a debug log and
 * never prevents the other channel from being attempted.
 */

import { sendEmail } from "./email.js";
import { readSettings } from "./settings.js";
import { sendWindowsToast } from "./notify-windows.js";

/** @param ctx - host plugin context. @returns a logger safe to call. */
function makeLogger(ctx) {
	const host = ctx?.logger;
	return {
		debug:
			typeof host?.debug === "function"
				? host.debug.bind(host)
				: () => {
						/* logging is optional */
					},
	};
}

/**
 * Build the delivery function installed on the notifier.
 * @param ctx - host plugin context.
 * @param options - delivery seams.
 * @param options.allow - static master switch; false disables every channel.
 * @param options.sound - whether local toasts play the default sound.
 * @param options.toast - injected local transport for tests.
 * @param options.email - injected email transport for tests.
 * @returns a fire-and-forget delivery function.
 */
export function createDelivery(ctx, options = {}) {
	const logger = makeLogger(ctx);
	const allow = typeof options.allow === "function" ? options.allow : () => options.allow !== false;
	const toast = typeof options.toast === "function" ? options.toast : sendWindowsToast;
	const email = typeof options.email === "function" ? options.email : sendEmail;
	const sound = options.sound !== false;

	return (notification) => {
		try {
			if (!allow()) return;
			const settings = readSettings(ctx);

			if (settings.notifications) {
				try {
					toast(notification.title, notification.body, { logger, sound });
				} catch (error) {
					logger.debug(
						"thinking-depth: local reminder failed: %s",
						error instanceof Error ? error.message : String(error),
					);
				}
			}

			if (settings.email) {
				try {
					const pending = email(notification, settings, { logger });
					if (pending !== null && typeof pending?.then === "function") {
						pending.then(undefined, (error) => {
							logger.debug(
								"thinking-depth: email reminder rejected: %s",
								error instanceof Error ? error.message : String(error),
							);
						});
					}
				} catch (error) {
					logger.debug(
						"thinking-depth: email reminder failed: %s",
						error instanceof Error ? error.message : String(error),
					);
				}
			}
		} catch (error) {
			logger.debug(
				"thinking-depth: reminder delivery failed: %s",
				error instanceof Error ? error.message : String(error),
			);
		}
	};
}
