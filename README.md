# Trajectonomics Internal Skills

Internal AI coding agent skills for the Trajectonomics ecosystem, managed via [skills.sh](https://skills.sh/) (`npx skills`).

## Available Skills

- **`traj`**: Teaches an agent to operate [`traj`](https://github.com/trajectonomics/cli), the Trajectonomics ledger and projection CLI: find the CLI and run it without installing anything, read `traj schema` and `--help` instead of a memorised command list, keep every amount, date and account explicit, and never compute a number the CLI should. Model-invoked, so an agent loads it when someone talks about their money. Validated against cli ADR 0002 with [`scripts/check-traj-validation.mjs`](scripts/check-traj-validation.mjs); the dated result is [`docs/traj-skill-validation.md`](docs/traj-skill-validation.md).

- **`pick-the-issue`**: Discovers open GitHub issues in the current repository only, filters out blocked issues and issues actively handled by existing T3 Code sessions, provides an executive summary, and routes the work through Matt Pocock's skills framework (`ask-matt`) to advise on the exact commands and workflow.

- **`human-go`, `human-decline`, `human-postpone`, `human-help`**: The owner's words for Factory Ideas. The owner invokes them (`/human-go <repo>#<n>`) and the agent applies the labels. The rules live in `docs/next-steps-runbook.md` of `trajectonomics/factory`; the skills read them from there.

## Curated Engineering Profile

Factory repositories install a pinned set of upstream engineering skills (grilling, grill-with-docs, domain-modeling, to-spec, to-tickets, implement, implement-spec, tdd, code-review, pr, triage, diagnosing-bugs, retro) from [`mattpocock/skills`](https://github.com/mattpocock/skills), plus Cloudflare skills (cloudflare, cf-cli, wrangler, workers-best-practices, workers-development, cloudflare-email-service, durable-objects, cloudflare-one) from [`cloudflare/skills`](https://github.com/cloudflare/skills), with one command:

```bash
npx -y --package=github:trajectonomics/internal-skills#main install-skills-profile
```

Factory repositories intentionally track this profile on `main`: the upstream skill pins are fixed, but the profile contents are not. Editing `profiles/factory.json` on `main` changes every repository that re-runs the installer.

The installer requires `npx` and network access at install time.

The checked profile is [`profiles/factory.json`](profiles/factory.json). It pins `mattpocock/skills` to release `v1.3.2` at commit `d1478fcb140db0b93c0c8df17bcfd311844749d0` and `cloudflare/skills` to commit `6eb6c781aa9b6438e0c7307bd102788a75fe1a6d` (upstream `main` on 2026-11-06; upstream has no tags, so its `version` label is `main@2026-11-06`). No upstream skill content is copied into this repository, so no Apache-2.0 NOTICE is needed. See [`docs/skill-profile.md`](docs/skill-profile.md) for the profile format, the CLI tests behind this design, and how to change a pin.

The Cloudflare skills are reference guidance only: they grant no authority, each repository's own rules still hold (for example, live Cloudflare or Wrangler changes in `infra` need the owner's per-task opt-in, and Factory Runs never touch a cloud platform), and the upstream plugin's Cloudflare MCP server is not installed. One known trade-off: the `cloudflare` router skill names upstream skills this profile does not install; fall back to the Cloudflare documentation when it points at one.

## Org-Specific Skills

Install this repository's own skills separately. To install **only** the `traj` skill, pass its name:

```bash
# Add just the traj skill to the current repository
npx skills add trajectonomics/internal-skills --skill traj -y

# Update to latest version
npx skills update -p -y
```

That is the outsider command: `traj` is public and anyone can install it this way. The bare command installs **every** skill in this repository, `pick-the-issue` and the Factory-only `human-*` skills included, which is what the organisation wants in a Factory repository and what someone outside it does not:

```bash
# Every skill in this repository — for a Factory repository, not for an outsider
npx skills add trajectonomics/internal-skills -y
```

Omit `-y` to review the plan first. `scripts/check-traj-install.sh` proves the `--skill traj` form installs exactly one skill; see [the check](#check-the-outsider-install) below.

## Check the outsider install

[`scripts/check-traj-install.sh`](scripts/check-traj-install.sh) is the reproduction script for the outsider path. In a scratch directory it runs the pinned `skills` CLI from [`lib/skill-profile.mjs`](lib/skill-profile.mjs) with `--skill traj -a claude-code codex -y`, then asserts that `traj` is the only skill installed and that no `pick-the-issue` or `human-*` skill followed it. It exits non-zero on either failure.

```bash
# This checkout, as a local path
bash scripts/check-traj-install.sh

# After merge: the same check against GitHub, which is what an outsider actually runs
bash scripts/check-traj-install.sh trajectonomics/internal-skills
```

It needs `npx` and network access. [`scripts/reproduce-cli-findings.sh`](scripts/reproduce-cli-findings.sh) does the same job for the profile's upstream pins.
