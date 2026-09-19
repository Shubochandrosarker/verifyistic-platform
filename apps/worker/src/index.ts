/**
 * Verifyistic worker — async job runner (Phase 6, doc 13 §6).
 * Job families: pdf-finalize (processing sessions), webhooks (due deliveries),
 * email (outbox pump), retention (expiry sweeper; legal_hold respected — see
 * DocumentService retention contract, doc 09 §7).
 *
 * Every job is idempotent: retries never duplicate signatures, documents,
 * or deliveries (DB-backed queue with attempt counters + dead-letter).
 */
import type { AppServices } from "@verifyistic/api";

export interface JobRunSummary {
	webhookDeliveries: number;
	emails: number;
	finalizedSessions: string[];
	expiredSessions: number;
}

/** One worker tick — safe to run concurrently with the API against the same DB. */
export async function runJobsOnce(
	services: AppServices,
): Promise<JobRunSummary> {
	const webhookDeliveries = await services.webhooks.processDueDeliveries(20);
	const emails = await services.emailOutbox.processDue(
		services.emailSender,
		20,
	);
	const { finalized } = await services.documents.finalizeProcessing(10);
	const expiredSessions = await services.signing.expireOverdue();
	return {
		webhookDeliveries,
		emails,
		finalizedSessions: finalized,
		expiredSessions,
	};
}
