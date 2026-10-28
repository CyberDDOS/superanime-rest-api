import { fetchDOM } from "../lib/fetcher.js";
import { sources } from "../config/index.js";
import type { HTMLElement } from "node-html-parser";
import { postJSON } from "../lib/fetcher.js";

const BASE = sources.oploverz.baseUrl;

export async function scrapeDOM(
	pathname: string,
	ref?: string,
	sanitize = false,
): Promise<HTMLElement> {
	return fetchDOM(`${BASE}${pathname}`, { ref, sanitize });
}

/**
 * Permalink `/anime/...` dan `/genres/...` di Oploverz rusak (404), tetapi
 * query string WordPress masih dilayani dengan markup yang sama.
 */
export function archivePath(params: Record<string, string>, page: number | string = 1): string {
	const search = new URLSearchParams({ post_type: "anime", ...params });
	const pageNumber = Number(page) || 1;
	if (pageNumber > 1) search.set("page", String(pageNumber));
	return `/?${search.toString()}`;
}

export function animePath(slug: string): string {
	return `/?anime=${encodeURIComponent(slug)}`;
}

export async function scrapeTooltip(
	postId: string,
	referer: string,
): Promise<string> {
	const data = await postJSON<{ content: string }>(
		`${BASE}/wp-admin/admin-ajax.php`,
		{ action: "tooltip_action", id: postId },
		referer,
	);
	return data.content;
}
