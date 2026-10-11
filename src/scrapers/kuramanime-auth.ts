import { getQuickJS, shouldInterruptAfterDeadline } from "quickjs-emscripten";

/**
 * Field `authorization` untuk POST halaman stream Kuramanime tertanam di
 * `storage/leviathan.js` (ter-obfuscate, string-nya didekode saat runtime),
 * jadi nilainya hanya bisa didapat dengan menjalankan skrip itu.
 *
 * Skrip pihak ketiga TIDAK dijalankan di Node (`node:vm` bukan sandbox), tapi
 * di QuickJS (WebAssembly): tanpa akses ke process, file, maupun jaringan,
 * dengan batas memori dan waktu. Lingkungan browser yang dibutuhkan cukup
 * jQuery tiruan; `jLoadSecure()` dipanggil dan argumen `.load()`-nya ditangkap.
 */
const SANDBOX_PRELUDE = `
var __captured = null;
var __noop = function () {};
var __chain = function () {
	var target = function () {};
	var proxy = new Proxy(target, {
		get: function (_t, key) {
			if (key === "load") {
				return function (_url, data) {
					if (data && typeof data === "object") __captured = data;
					return proxy;
				};
			}
			if (key === "then") return undefined;
			return function () { return proxy; };
		},
		apply: function () { return proxy; },
	});
	return proxy;
};
var $ = function () { return __chain(); };
$.ajax = __noop; $.get = __noop; $.post = __noop; $.ajaxSetup = __noop;
var jQuery = $;
var window = globalThis; var self = globalThis;
var console = { log: __noop, warn: __noop, error: __noop, info: __noop, debug: __noop, table: __noop, clear: __noop };
var setTimeout = function () { return 0; }; var setInterval = setTimeout;
var clearTimeout = __noop; var clearInterval = __noop;
var location = { href: "https://localhost/anime/1/x/episode/1", origin: "https://localhost", hostname: "localhost", pathname: "/anime/1/x/episode/1", search: "" };
var navigator = { userAgent: "Mozilla/5.0 Chrome/131", webdriver: false };
var document = {
	cookie: "",
	querySelector: function () { return null; },
	querySelectorAll: function () { return []; },
	getElementById: function () { return null; },
	createElement: function () { return { setAttribute: __noop, addEventListener: __noop, style: {} }; },
	addEventListener: __noop,
	body: { appendChild: __noop },
};
var process = { env: {} };
`;

const SANDBOX_CALL = `
;(function () {
	if (typeof jLoadSecure !== "function") return "";
	jLoadSecure(".spad", "https://localhost/anime/1/x/episode/1?a=b", {}, function () {});
	return __captured && typeof __captured.authorization === "string" ? __captured.authorization : "";
})()`;

const MEMORY_LIMIT = 32 * 1024 * 1024;
const TIME_LIMIT_MS = 2_000;

/** Jalankan isi leviathan.js di sandbox dan kembalikan nilai `authorization`. */
export async function extractAuthorization(script: string): Promise<string> {
	const QuickJS = await getQuickJS();
	const runtime = QuickJS.newRuntime();
	runtime.setMemoryLimit(MEMORY_LIMIT);
	runtime.setMaxStackSize(1024 * 1024);
	runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + TIME_LIMIT_MS));
	const vm = runtime.newContext();

	try {
		const result = vm.evalCode(`${SANDBOX_PRELUDE}\n${script}\n${SANDBOX_CALL}`, "leviathan.js");
		if (result.error) {
			const error = vm.dump(result.error);
			result.error.dispose();
			throw new Error(`leviathan.js failed in sandbox: ${JSON.stringify(error).slice(0, 200)}`);
		}
		const value = vm.dump(result.value);
		result.value.dispose();
		return typeof value === "string" ? value : "";
	} finally {
		vm.dispose();
		runtime.dispose();
	}
}
