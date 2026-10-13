import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, type HTMLElement } from "node-html-parser";

/** Muat fixture HTML asli dari situs sumber (lihat test/fixtures). */
export function fixture(name: string): HTMLElement {
	return parse(readFileSync(join(import.meta.dir, "fixtures", name), "utf8"));
}
