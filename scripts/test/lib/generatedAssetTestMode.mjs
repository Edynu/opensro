import { existsSync } from "node:fs";
import { test } from "node:test";

import { publishedAssetExistsSync } from "../../lib/publishedAsset.mjs";

export const GENERATED_ASSET_TEST_MODE = process.env.SRO_TEST_ASSET_MODE === "full"
	? "full"
	: "compact";

export function generatedAssetPrerequisites(paths) {
	const normalized = paths.map((entry) => entry instanceof URL ? entry : String(entry));
	const missing = normalized.filter((entry) => !generatedAssetExists(entry));
	return {
		available: GENERATED_ASSET_TEST_MODE === "full" && missing.length === 0,
		missing,
		test: createGeneratedAssetTest(paths)
	};
}

export function createGeneratedAssetTest(paths) {
	const normalized = paths.map((entry) => entry instanceof URL ? entry : String(entry));
	const missing = normalized.filter((entry) => !generatedAssetExists(entry));
	return (name, fn) => {
		if (GENERATED_ASSET_TEST_MODE === "compact") {
			return test(name, { skip: "requires generated asset corpus; run pnpm test mission (full mode)" }, fn);
		}
		if (missing.length === 0) return test(name, fn);
		const reason = `requires generated asset corpus: ${missing.join(", ")}`;
		return test(name, () => {
			throw new Error(`full generated-asset verification cannot skip: ${reason}`);
		});
	};
}

export function testWithGeneratedAssets(name, paths, fn) {
	return createGeneratedAssetTest(paths)(name, fn);
}

function generatedAssetExists(entry) {
	return typeof entry === "string" && entry.startsWith("/assets/")
		? publishedAssetExistsSync(entry)
		: existsSync(entry);
}
