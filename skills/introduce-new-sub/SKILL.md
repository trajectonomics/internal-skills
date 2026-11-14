---
name: introduce-new-sub
description: "Introduce a new sub (coding-agent harness + model) to the org: wire it into T3 Code on every linked machine, smoke-test it per environment, and record it in fromsukong/infra AGENTS.md. Usage: /introduce-new-sub <harness> <model> [provider-instance-id]"
disable-model-invocation: true
---

# Introduce a new sub

A "sub" is a coding-agent harness + model the org runs inside T3 Code — e.g. Cursor CLI on `grok-4.7`, Mistral Vibe on `mistral-large-4`. This skill is the repeatable introduction ritual, distilled from two real introductions:

- **Grok 4.7** — [Cursor CLI Setup: Ubuntu and Homeserver](t3-thread://v2/0c608ec9-f1af-4456-aee8-01fc3808ea1c/92d7a173-6ff5-43fa-8f66-931d3286f1fa), recorded in `fromsukong/infra` PR #5.
- **Mistral Large 4** — [I just subscribed for Mistral Vibe and want to add it to our T3 Code](t3-thread://v2/4948f2db-e000-4e80-b1b0-799daa6d3422/cbfb85c4-f67d-43ab-b32d-5d925e30bfd3), recorded in `fromsukong/infra` PR #6.

Only the owner invokes this skill; never call it yourself.

## 1. Check the model against repo rules first

Model bans and routing rules live in repo `AGENTS.md` files (e.g. `trajectonomics/internal-skills` bans `gemini-3.8-flash` in favour of `gemini-4-hydrogen`). Read the target repos' `AGENTS.md` before picking the model, and never route a Pi session off DeepSeek 4.1 Flash.

## 2. Wire the provider into T3 Code on every linked machine

1. List machines with `t3_environment_links`; skip unreachable ones and note them.
2. On each, enable the provider instance environment-wide in `~/.t3/userdata/settings.json` → `providerInstances["<id>"]` (no per-project overrides). Back up the file first (`settings.json.bak-<timestamp>`) and `chmod 600` it if it holds keys. Most providers are picked up live; restart the T3 service (`systemd-run` so nothing is killed mid-run) only when they are not.
3. **Credentials never travel through threads.** For ACP providers (e.g. `mistral-vibe`) sign in per machine, or copy the key file (`~/.vibe/.env`, mode 0600) over the tailnet. For CLI providers (e.g. `cursor`) read the key from that box's own CLI auth store (`~/.config/cursor/auth.json`) — T3 keeps its own credential store and ignores the CLI login, so the key must also go into the provider's env (e.g. `CURSOR_API_KEY`, `sensitive: true`). Pin `binaryPath` to the stable `~/.local/bin/<cli>` symlink, not a versioned path.
4. Verify per environment: `orchestrator_capabilities` with `search: "<provider>"`, then one live smoke test via `delegate_task` targeting `{ providerInstanceId: "<id>", model: "<model>" }`. Keep each child thread's link for the announcement.

## 3. Optionally restrict the picker to the intended model

Set `providerModelPreferences.<provider>.hiddenModels` to hide all but the chosen model(s). This is a **visibility filter, not a hard block**: a hidden model still runs when named explicitly in `delegate_task` (proven with `composer-2.5`). For a real block, use the provider/account side (plan or key access), or remove the provider.

## 4. Record the sub in the org

In `fromsukong/infra` (the live production config repo):

1. Add the harness to the recognized-harness line in `AGENTS.md`: `**<Harness> running <model>** ... (joined YYYY-MM-DD)`.
2. Add a harness-specific rules file **only if the harness has its own config dir** — Cursor: `.cursor/rules/infra-agent.mdc` with frontmatter (`description`, `alwaysApply: true`) restating the AGENTS.md contract. Harnesses without one (Mistral Vibe, Claude, Pi, …) read `AGENTS.md` itself; do not invent a file for them.
3. Branch (`docs/*` or `feat/*`), commit, push, open a PR. Never push to `main` directly.

## 5. Make the harness's skills discovery work in every repo

Project skills only load from a **trusted** project root, and ACP/programmatic sessions never prompt for trust — so both layers must be set up explicitly:

1. **Host trust store, per machine.** Seed the harness's trust file with the project roots (back up first, `chmod 600`):
   - Mistral Vibe: `~/.vibe/trusted_folders.toml` → `trusted = ["/project", "/home/prame_assistant/project"]` on homeserver2, `trusted = ["/home/prame/project"]` on homeserver1 (prameubuntu when reachable). Vibe then discovers `.vibe/skills` and `.agents/skills` in every repo under those roots.
   - Pi: `~/.pi/agent/trust.json` → `"/project": true` (nearest-ancestor match).
2. **Repo skills dir, per repo.** Give the harness its own committed skills dir so the skills CLI maintains it: for Vibe, `.vibe/skills/<name> -> ../../.agents/skills/<name>` symlinks (the `mistral-vibe` agent target of `skills` uses `.vibe/skills`), mirroring the committed `.claude/skills` symlinks. Branch (`chore/*`), commit, push, one PR per repo.

## 6. Announce in the thread

Post a summary table — host, version/binary, auth state, smoke-test result with thread link — plus the caveats worth knowing: `binaryPath` staleness through version symlinks, plan/budget coverage of the model (check the provider's billing endpoint; included budget first, pay-as-you-go off means hard stop at reset), the `hiddenModels` semantics from step 3, and the trust/skills-discovery state from step 5.
