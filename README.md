# Trajectonomics Internal Skills

Internal AI coding agent skills for the Trajectonomics ecosystem, managed via [skills.sh](https://skills.sh/) (`npx skills`).

## Available Skills

- **`pick-the-issue`**: Discovers open GitHub issues in the current repository only, filters out blocked issues and issues actively handled by existing T3 Code sessions, provides an executive summary, and routes the work through Matt Pocock's skills framework (`ask-matt`) to advise on the exact commands and workflow.

- **`human-go`, `human-decline`, `human-postpone`, `human-help`**: The owner's words for Factory Ideas. The owner invokes them (`/human-go <repo>#<n>`) and the agent applies the labels. The rules live in `docs/next-steps-runbook.md` of `trajectonomics/factory`; the skills read them from there.

## Curated Engineering Profile

Factory repositories install a pinned set of upstream engineering skills (grilling, grill-with-docs, domain-modeling, to-spec, to-tickets, implement, implement-spec, tdd, code-review, pr, triage, diagnosing-bugs, retro) from [`mattpocock/skills`](https://github.com/mattpocock/skills) with one command:

```bash
npx -y --package=github:trajectonomics/internal-skills#main install-skills-profile
```

Factory repositories intentionally track this profile on `main`: the upstream skill pins are fixed, but the profile contents are not. Editing `profiles/factory.json` on `main` changes every repository that re-runs the installer.

The installer requires `npx` and network access at install time.

The checked profile is [`profiles/factory.json`](profiles/factory.json). It pins upstream to release `v1.3.2` at commit `d1478fcb140db0b93c0c8df17bcfd311844749d0`. No upstream skill content is copied into this repository. See [`docs/skill-profile.md`](docs/skill-profile.md) for the profile format, the CLI tests behind this design, and how to change the pin.

## Org-Specific Skills

Install this repository's own skills, such as `pick-the-issue`, separately:

```bash
# Add to the current repository
npx skills add trajectonomics/internal-skills -y

# Update to latest version
npx skills update -p -y
```
