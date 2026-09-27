# Task registry

The source of truth for repository commands. Root `package.json` exposes only
category entry points (`build`, `test`, `check`, `assets`, `release`, `task`);
the modules here define each task's command, description, CI suitability,
requirements and timeout class, plus the named check pipelines.

```text
pnpm task list [--kind <kind>] [--json]
pnpm task explain <task>
pnpm check source
pnpm test world
pnpm assets refresh world-map
pnpm task build server-game-data
```

Selectors join words with `:`, so `pnpm assets refresh world-map` runs
`assets:refresh:world-map`. Arguments after `--` go to the task.

| Kind | Meaning |
| --- | --- |
| `build` | Produces a code or data product |
| `test` | Deterministic assertions; root suites are listed explicitly in `scripts/test/suites/` |
| `check` | Blocking repository or CI policy |
| `assets` | Builds, refreshes, publishes, compacts, locks or validates generated assets |
| `release` | Prepares a release workspace |
| `dev` | One-time developer setup |

| Module | Defines |
| --- | --- |
| `assets.mjs` | Asset build, refresh and publish families, compaction, integrity |
| `build.mjs`, `tests.mjs`, `misc.mjs` | Build, test and setup tasks |
| `checks.mjs` | Check tasks and the `source` and full check pipelines |
| `define.mjs`, `registry.mjs`, `runner.mjs` | Task shape, validation and execution |

To add a task, put it in the matching module with every metadata field, and add
it to a pipeline only when it belongs in that gate. The registry refuses
duplicate names and references to unknown tasks, suites or pipelines.
