import assets from "./assets.mjs";
import cif from "./cif.mjs";
import region from "./region.mjs";
import world from "./world.mjs";

/**
 * @typedef {object} TestStage
 * @property {"node"|"tsx"} runner
 * @property {boolean} [stripTypes]
 * @property {string} [tsconfig]
 * @property {string[]} [setupFiles]
 * @property {boolean} [serial]
 * @property {string[]} [membershipPatterns]
 * @property {Record<string, string>} [env]
 * @property {string[]} files
 * @typedef {{ name: string, description: string, stages: TestStage[] }
 *   | (TestStage & { name: string, description: string, stages?: undefined })} TestSuite
 */

export const SUITES = Object.freeze({
  assets,
  cif,
  region,
  world
});

/** @param {string} name @returns {TestSuite | undefined} */
export function getSuite(name) {
  return /** @type {Record<string, TestSuite>} */ (/** @type {unknown} */ (SUITES))[name];
}

/** @param {string | TestSuite} suite @returns {string[]} */
export function getSuiteFiles(suite) {
  const resolved = typeof suite === "string" ? getSuite(suite) : suite;
  if (!resolved) return [];
  const stages = resolved.stages ?? [resolved];
  return stages.flatMap((stage) => stage.files);
}
