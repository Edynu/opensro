// One-time activation of the repo's git hooks (`pnpm hooks:install`).
//
// The hooks live in `<git-root>/.githooks/` (currently just `pre-push`, which
// runs `pnpm check source` from the repository root). Git only runs them once
// `core.hooksPath` points at that directory; this script sets it and nothing
// else. It refuses to run until the workspace root is a real git repository
// (`git init` first — today `.git/` is an empty placeholder).

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, "..");
const hooksDir = path.join(workspaceRoot, ".githooks");

if (!existsSync(path.join(hooksDir, "pre-push"))) {
  fail(`missing ${path.join(hooksDir, "pre-push")}`);
}
if (!existsSync(path.join(workspaceRoot, ".git", "HEAD"))) {
  fail(
    `${path.join(workspaceRoot, ".git")} is not a git repository (no HEAD). ` +
      `Run \`git init\` at the workspace root first, then re-run pnpm hooks:install.`
  );
}

// Relative to the git root: hooks run from the top of the working tree, so a
// bare ".githooks" resolves correctly and survives the repo being moved.
runGit(["config", "core.hooksPath", ".githooks"]);
const configured = runGit(["config", "core.hooksPath"]).trim();
if (configured !== ".githooks") {
  fail(`core.hooksPath reads back as "${configured}", expected ".githooks"`);
}

console.log(`Set core.hooksPath = .githooks in ${workspaceRoot}`);
console.log("The pre-push hook now runs `pnpm check source` before every push.");

function runGit(args) {
  const result = spawnSync("git", ["-C", workspaceRoot, ...args], { encoding: "utf8" });
  if (result.error) {
    fail(`git ${args.join(" ")}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`git ${args.join(" ")} exited ${result.status}: ${(result.stderr ?? "").trim()}`);
  }
  return result.stdout ?? "";
}

function fail(message) {
  console.error(`hooks:install failed: ${message}`);
  process.exit(1);
}
