# Curated engineering skill profile

`profiles/factory.json` is the checked profile of upstream engineering skills
that every Trajectonomics Factory repository installs. It names skills from
[`mattpocock/skills`](https://github.com/mattpocock/skills) and
[`cloudflare/skills`](https://github.com/cloudflare/skills); no upstream skill
content is copied into this repository, so no Apache-2.0 NOTICE is needed.

## Install

From the repository that should receive the profile:

```bash
npx -y --package=github:trajectonomics/internal-skills#main install-skills-profile
```

`#main` is intentional. Factory repositories track the profile itself on `main`:
the upstream skill pins are fixed, but the profile contents are not. Editing
`profiles/factory.json` on `main` changes every repository that re-runs the
installer.

The installer requires `npx` and network access at install time: `npx` fetches
`skills@1.7.6`, and `experimental_sync` fetches the pinned upstream commit.

The command:

1. Reads `profiles/factory.json`.
2. Merges its sources into the target repository's `package.json` `skills`
   field. Entries for the same source are replaced; unrelated sources are
   preserved.
3. Runs `npx -y skills@1.7.6 experimental_sync -y --no-frozen-lockfile`.

From a checkout of this repository, the equivalent is:

```bash
node scripts/install-profile.mjs
```

Extra arguments are passed to `experimental_sync`, for example
`--agent claude-code` or `--copy`. Use `--dry-run` to print the `package.json`
change without installing anything.

Commit both `package.json` and `skills-lock.json`. The lock records the pinned
commit and a content hash for every installed skill.

## Profile contents

The current profile has two sources.

`mattpocock/skills` is pinned at release `v1.3.2`, commit
`d1478fcb140db0b93c0c8df17bcfd311844749d0`, and installs:

`grilling`, `grill-with-docs`, `domain-modeling`, `to-spec`, `to-tickets`,
`implement`, `implement-spec`, `tdd`, `code-review`, `pr`, `triage`,
`diagnosing-bugs`, `retro`.

`cloudflare/skills` is pinned at commit
`6eb6c781aa9b6438e0c7307bd102788a75fe1a6d`, upstream `main` on 2026-11-06.
Upstream has no tags or releases, so its `version` label is
`main@2026-11-06`. It installs:

`cloudflare`, `cf-cli`, `wrangler`, `workers-best-practices`,
`workers-development`, `cloudflare-email-service`, `durable-objects`,
`cloudflare-one`.

The commit SHA, not the tag name, is the pin because tags can move. The
`version` field is kept for humans. To change either pin, update the source
entry to a new full commit SHA in a pull request, adjust the skill list if
needed, and re-run `npm test` and `bash scripts/reproduce-cli-findings.sh`.

Multiple sources are allowed, and their order does not matter. Two sources may
not ship the same skill name, within one source or across sources, because the
target installs every skill into the flat `.agents/skills/<name>` directory;
`profileEntries` rejects it. The installer does not remove unrelated skills
already installed in the target repository.

The Cloudflare skills are reference guidance and grant no authority: each
repository's own rules still hold, for example `infra`'s rule that live
Cloudflare or Wrangler changes need the owner's per-task opt-in, and Factory
Runs never touch a cloud platform. The upstream plugin's Cloudflare MCP server
is not installed.

Known trade-off: the `cloudflare` router skill mentions upstream skills that
this profile does not install (`basin`, `k2`, `nextjs-on-cloudflare` and
others). An agent that follows the router to one of them should fall back to
the Cloudflare documentation.

Org-specific skills such as `pick-the-issue` are still installed separately
from this repository with `npx skills add trajectonomics/internal-skills -y`.

## What the `skills` CLI can and cannot do

Tested on 2026-11-08 with `skills@1.7.6`, the current npm `latest`. All tests
ran in scratch directories under `/tmp`, outside this repository. Run
`bash scripts/reproduce-cli-findings.sh` to reproduce both observations below;
it uses the network and creates its own temporary scratch directory.

### `skills add` accepts a list and a ref, but does not make a reliable pinned profile

This form is accepted and exits successfully:

```bash
npx -y skills@1.7.6 add mattpocock/skills@v1.3.2 \
  --skill grilling grill-with-docs domain-modeling to-spec to-tickets \
          implement implement-spec tdd code-review pr triage \
          diagnosing-bugs retro \
  -a pi -y
```

It installs the 13 named skills into `.agents/skills/`, but its
`skills-lock.json` entries contain only `source`, `sourceType`, `skillPath` and
`computedHash`; they do **not** contain `ref`. Repeating the test with the full
commit SHA made no difference to the lock.

More importantly, the pinned install was not exact. In the scratch test,
`implement-spec` matched `main` (SHA-256
`1993a473cec40ac85d081c112cdffdc63ec3267c2e412055ad09e013a2f623d1`), not commit
`d1478fcb...`/tag `v1.3.2`
(`8d8300f7f12325dbfc99cad124a4bcc96ac0d02d0b2d73dfb348e9262afacfc4`).
The other 12 skills matched the tag. The mismatch reproduced with a single
`implement-spec` install, with the tag and the commit SHA, and with
`--full-depth`. Therefore `skills add` is not the basis of this profile.

### `package.json` `skills` plus `experimental_sync` is the CLI's profile mechanism

The CLI's documented profile mechanism is an array in `package.json`:

```json
{
  "skills": [
    {
      "source": "mattpocock/skills",
      "ref": "d1478fcb140db0b93c0c8df17bcfd311844749d0",
      "skills": ["implement", "tdd", "code-review"]
    }
  ]
}
```

Running `npx -y skills@1.7.6 experimental_sync -a pi -y` with that field
installed exactly the named skills, all matching commit `d1478fcb...`.
`skills-lock.json` recorded the SHA in `ref` for every skill. With tag
`v1.3.2` as the ref, it recorded `v1.3.2` and content also matched the tag.

`experimental_sync --frozen-lockfile` then found every skill locked and on
disk. After deleting `.agents/`, `experimental_install --frozen-lockfile`
restored the pinned skills from the lock.

### Why this repository has a small installer

The CLI can install from a `package.json` `skills` field, but it has no command
that reads a standalone profile from another repository.
`experimental_sync` only reads the current project and its installed
dependencies. `scripts/install-profile.mjs` therefore does the smallest
missing step: it merges this repository's checked profile into the target's
official `skills` field and delegates installation and locking to
`experimental_sync`. It does not copy or reimplement skill installation.

## Regression checks

`npm test` runs `test/install-profile.test.mjs`, which executes the installer's
merge-and-sync path in a scratch directory with a fake `npx`. The fake asserts
the exact CLI arguments and writes a lock from the target's `skills` field; the
test then asserts that every profile skill has a lock entry with the profile's
`source` and `ref`, including a Cloudflare skill and a `mattpocock/skills`
one. That installer test covers a tab-indented target `package.json` with no
trailing newline and a target file with a UTF-8 BOM. `test/skill-profile.test.mjs`
checks that the profile pins both sources, that the Cloudflare source lists
exactly the eight skills above, and that no skill name repeats across sources.
The formatting tests there cover tab and space indentation, trailing newlines,
and the empty-object fallback.

For a real-CLI check, run `bash scripts/reproduce-cli-findings.sh`. It clones
the pinned tag, runs `skills add repo@tag` and asserts it installed current
`main` instead of the tag, then runs `experimental_sync` from a `package.json`
`skills` entry and asserts it installed the pinned copy and wrote the expected
`ref` to the lock. Run this script as well as `npm test` whenever `SKILLS_CLI`
in `lib/skill-profile.mjs` is bumped. If current main cannot be fetched or still
matches the pinned tag, the script exits 2 with a time-dependent explanation.

Its companion for the org's own `traj` skill is
`bash scripts/check-traj-install.sh`, run the same way and pinned to the same
`SKILLS_CLI`. Bump both together with `SKILLS_CLI`; the README describes it.
