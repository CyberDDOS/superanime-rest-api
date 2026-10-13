import type { Request, Response, NextFunction } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { ServiceUnavailableError, UnauthorizedError } from "../lib/errors.js";

/**
 * Lindungi rute yang memicu scraping massal (`POST /sync/...`).
 *
 * Secret dikirim sebagai `Authorization: Bearer <secret>` — format yang sama
 * dengan yang dikirim Vercel Cron, jadi `CRON_SECRET` juga diterima. Tanpa
 * secret yang terkonfigurasi, rute ini ditutup (fail closed).
 */
export function requireSyncSecret(req: Request, _res: Response, next: NextFunction): void {
	const secret = process.env.SYNC_SECRET || process.env.CRON_SECRET || "";
	if (!secret) {
		next(new ServiceUnavailableError("Sync dinonaktifkan: SYNC_SECRET belum diatur"));
		return;
	}

	const header = req.get("authorization") ?? "";
	const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

	// Bandingkan hash-nya supaya panjang buffer selalu sama untuk timingSafeEqual.
	const digest = (value: string) => createHash("sha256").update(value).digest();
	if (!token || !timingSafeEqual(digest(token), digest(secret))) {
		next(new UnauthorizedError("Invalid or missing sync secret"));
		return;
	}

	next();
}
