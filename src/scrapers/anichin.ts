import { fetchDOM } from "../lib/fetcher.js";
import { sources } from "../config/index.js";
import type { HTMLElement } from "node-html-parser";

const BASE = sources.anichin.baseUrl;

const USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function scrapeDOM(pathname: string): Promise<HTMLElement> {
	return fetchDOM(`${BASE}${pathname}`, { ref: `${BASE}/`, sanitize: false });
}

export async function scrapeText(pathname: string): Promise<string> {
	const res = await fetch(`${BASE}${pathname}`, {
		headers: { "user-agent": USER_AGENT, referer: `${BASE}/` },
	});
	if (!res.ok) {
		throw new Error(`Anichin returned ${res.status} for ${pathname}`);
	}
	return res.text();
}
