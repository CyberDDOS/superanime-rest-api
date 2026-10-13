import { describe, expect, test } from "bun:test";
import * as parser from "../src/parsers/oploverz.js";
import { fixture } from "./helpers.js";

describe("oploverz search parser", () => {
	test("halaman pertama: 10 judul dan 2 halaman", () => {
		const doc = fixture("oploverz-search-page1.html");
		expect(parser.parseAnimeByGenre(doc)).toHaveLength(10);
		expect(parser.parsePagination(doc)).toMatchObject({ currentPage: 1, totalPages: 2, hasNextPage: true });
	});

	test("halaman kedua: sisa 5 judul", () => {
		const doc = fixture("oploverz-search-page2.html");
		expect(parser.parseAnimeByGenre(doc)).toHaveLength(5);
		expect(parser.parsePagination(doc)).toMatchObject({ hasNextPage: false });
	});
});
