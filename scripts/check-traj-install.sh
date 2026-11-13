#!/usr/bin/env bash
# Proves that someone outside the organisation installs the `traj` skill and nothing else.
#
#   bash scripts/check-traj-install.sh              # this checkout, as a local path
#   bash scripts/check-traj-install.sh trajectonomics/internal-skills   # after it is on GitHub
#
# Why this matters: the bare `npx skills add trajectonomics/internal-skills` installs every
# skill in the repository, `pick-the-issue` and the Factory-only `human-*` skills included.
# `--skill traj` is the outsider command, and this check is what keeps that true.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="${1:-$REPO_ROOT}"
SKILLS_CLI="$(
  node --input-type=module -e "
    const { SKILLS_CLI } = await import(process.argv[1]);
    process.stdout.write(SKILLS_CLI);
  " "$REPO_ROOT/lib/skill-profile.mjs"
)"

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/traj-skill-install.XXXXXX")"
trap 'rm -rf "$SCRATCH"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

echo "Installing only the traj skill from $SOURCE with $SKILLS_CLI..."
mkdir -p "$SCRATCH/project"
(
  cd "$SCRATCH/project"
  git init -q
  npx -y "$SKILLS_CLI" add "$SOURCE" --skill traj -a claude-code codex -y \
    >"$SCRATCH/add.log" 2>&1
) || {
  cat "$SCRATCH/add.log"
  fail "skills add exited non-zero"
}

installed_in() {
  local dir="$1"
  [ -d "$dir" ] || return 0
  find "$dir" -mindepth 1 -maxdepth 1 -exec basename {} \; | sort
}

for agents in ".agents/skills" ".claude/skills"; do
  found="$(installed_in "$SCRATCH/project/$agents")"
  if [ "$found" != "traj" ]; then
    cat "$SCRATCH/add.log" >&2
    fail "$agents holds '$(echo "$found" | tr '\n' ' ')', expected exactly 'traj'"
  fi
done

[ -f "$SCRATCH/project/.agents/skills/traj/SKILL.md" ] ||
  fail "traj/SKILL.md was not installed"

# The rule the check exists for: a Factory-only skill following the outsider through.
for forbidden in pick-the-issue human-go human-decline human-postpone human-help; do
  [ -e "$SCRATCH/project/.agents/skills/$forbidden" ] &&
    fail "$forbidden was installed for an outsider"
done

echo "PASS: an outsider gets exactly the traj skill, and no Factory-only skill."
echo "      Source: $SOURCE"
