import { commandTask } from "./define.mjs";

export const MISC_TASKS = [
  commandTask({
    name: "hooks:install",
    description: "Install the repository-owned Git hooks",
    kind: "dev",
    ci: false,
    requires: ["git-worktree"],
    timeoutClass: "short",
    command: "node",
    args: ["scripts/setup_git_hooks.mjs"]
  })
];
