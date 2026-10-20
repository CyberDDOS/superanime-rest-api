import { parse } from "node-html-parser";
import type { HTMLElement } from "node-html-parser";
import { fetchText } from "../lib/fetcher.js";
import { BadGatewayError, GatewayTimeoutError } from "../lib/errors.js";
import { sources } from "../config/index.js";

const BASE = sources.nimegami.baseUrl;

const TIMEOUT = 20_000;
const PLAYER_TIMEOUT = 6_000;

export interface NimegamiPage {
	doc: HTMLElement;
	html: string;
}

export async function scrapePage(pathname: string): Promise<NimegamiPage> {
	let html: string;
	try {
		html = await fetchText(`${BASE}${pathname}`, `${BASE}/`, TIMEOUT);
	} catch (err) {
		if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
			throw new GatewayTimeoutError(`Nimegami tidak merespons dalam ${TIMEOUT / 1000} detik. Coba lagi.`);
		}
		throw err;
	}
	if (!html || html.length < 50) {
		throw new BadGatewayError("Empty or too short response from upstream");
	}
	return { doc: parse(html), html };
}

export function isWrappedPlayer(url: string): boolean {
	return /\/\/[^/]+\/https?:\/\/(?:[^/]+\.)?desustream\.[a-z]+\//i.test(url);
}

export async function resolveWrappedPlayer(url: string): Promise<string> {
	if (!isWrappedPlayer(url)) return url;
	try {
		const html = await fetchText(url, `${BASE}/`, PLAYER_TIMEOUT);
		const src = html.match(/<video[^>]+src=["'](https?:\/\/[^"']+)["']/i)?.[1];
		return src ? src.replace(/&amp;/g, "&") : url;
	} catch {
		return url;
	}
}

export async function scrapeDOM(pathname: string): Promise<HTMLElement> {
	return (await scrapePage(pathname)).doc;
}
