# Trajectonomics Internal Skills

Internal AI coding agent skills for the Trajectonomics ecosystem, managed via [skills.sh](https://skills.sh/) (`npx skills`).

## Available Skills

- **`pick-the-issue`**: Discovers open GitHub issues in the current repository only, filters out blocked issues and issues actively handled by existing T3 Code sessions, provides an executive summary, and routes the work through Matt Pocock's skills framework (`ask-matt`) to advise on the exact commands and workflow.

- **`human-go`, `human-decline`, `human-postpone`, `human-help`**: The owner's words for Factory Ideas. The owner invokes them (`/human-go <repo>#<n>`) and the agent applies the labels. The rules live in `docs/next-steps-runbook.md` of `trajectonomics/factory`; the skills read them from there.

- **`introduce-new-sub`**: The ritual for adding a new sub (coding-agent harness + model) to the org: wire the provider into T3 Code on every linked machine, smoke-test it per environment, and record the harness in `fromsukong/infra`'s `AGENTS.md`. Owner-invoked: `/introduce-new-sub <harness> <model> [provider-instance-id]`. Distilled from the Grok 4.7 and Mistral Large 4 introductions.

## Curated Engineering Profile

Factory repositories install a pinned set of upstream engineering skills (grilling, grill-with-docs, domain-modeling, to-spec, to-tickets, implement, implement-spec, tdd, code-review, pr, triage, diagnosing-bugs, retro) from [`mattpocock/skills`](https://github.com/mattpocock/skills), plus Cloudflare skills (cloudflare, cf-cli, wrangler, workers-best-practices, workers-development, cloudflare-email-service, durable-objects, cloudflare-one) from [`cloudflare/skills`](https://github.com/cloudflare/skills), with one command:

```bash
npx -y --package=github:trajectonomics/internal-skills#main install-skills-profile
```

Factory repositories intentionally track this profile on `main`: the upstream skill pins are fixed, but the profile contents are not. Editing `profiles/factory.json` on `main` changes every repository that re-runs the installer.

The installer requires `npx` and network access at install time.

The checked profile is [`profiles/factory.json`](profiles/factory.json). It pins `mattpocock/skills` to release `v1.3.2` at commit `d1478fcb140db0b93c0c8df17bcfd311844749d0` and `cloudflare/skills` to commit `6eb6c781aa9b6438e0c7307bd102788a75fe1a6d` (upstream `main` on 2026-11-06; upstream has no tags, so its `version` label is `main@2026-11-06`). No upstream skill content is copied into this repository, so no Apache-2.0 NOTICE is needed. See [`docs/skill-profile.md`](docs/skill-profile.md) for the profile format, the CLI tests behind this design, and how to change a pin.

The Cloudflare skills are reference guidance only: they grant no authority, each repository's own rules still hold (for example, live Cloudflare or Wrangler changes in `infra` need the owner's per-task opt-in, and Factory Runs never touch a cloud platform), and the upstream plugin's Cloudflare MCP server is not installed. One known trade-off: the `cloudflare` router skill names upstream skills this profile does not install; fall back to the Cloudflare documentation when it points at one.

[`scripts/reproduce-cli-findings.sh`](scripts/reproduce-cli-findings.sh) reproduces the profile's upstream pins; it needs `npx` and network access.

## Org-Specific Skills

Install this repository's own skills separately:

```bash
# Every skill in this repository — for a Factory repository
npx skills add trajectonomics/internal-skills -y
```

Omit `-y` to review the plan first. The command above installs **every** skill in this repository, `pick-the-issue` and the Factory-only `human-*` skills included, which is what the organisation wants in a Factory repository and what someone outside it does not: `traj` is a customer's operating Skill, and it publishes from [`trajectonomics/skills`](https://github.com/trajectonomics/skills).
