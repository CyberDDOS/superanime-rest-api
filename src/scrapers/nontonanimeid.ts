import { fetchDOM, postText } from "../lib/fetcher.js";
import { sources } from "../config/index.js";
import type { HTMLElement } from "node-html-parser";

const BASE = sources.nontonanimeid.baseUrl;
const AJAX_ENDPOINT = `${BASE}/wp-admin/admin-ajax.php`;

export async function scrapeDOM(pathname: string): Promise<HTMLElement> {
	return fetchDOM(`${BASE}${pathname}`, { cf: true });
}

/** Potongan HTML `<iframe>` milik satu server pemutar. */
export async function scrapePlayer(
	body: { post: string; nume: string; type: string },
	nonce: string,
	referer: string,
): Promise<string> {
	return postText(
		AJAX_ENDPOINT,
		{ action: "player_ajax", post: body.post, nume: body.nume, serverName: body.type, nonce },
		referer,
		15_000,
		true,
	);
}

/** Satu batch episode tambahan untuk series panjang ("Load more" di halaman anime). */
export async function scrapeEpisodeBatch(
	params: Record<string, string>,
	page: number,
	referer: string,
): Promise<string> {
	return postText(AJAX_ENDPOINT, { action: "loadmore2", ...params, page: String(page) }, referer, 20_000, true);
}
