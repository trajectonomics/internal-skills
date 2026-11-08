#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="$REPO_ROOT/profiles/factory.json"
SKILL="implement-spec"
SKILLS_CLI="$(
  node --input-type=module -e "
    const { SKILLS_CLI } = await import(process.argv[1]);
    process.stdout.write(SKILLS_CLI);
  " "$REPO_ROOT/lib/skill-profile.mjs"
)"

profile_value() {
  node -e "
    const profile = require(process.argv[1]);
    const source = profile.sources[0];
    process.stdout.write(String(source[process.argv[2]]));
  " "$PROFILE" "$1"
}

PROFILE_SOURCE="$(profile_value source)"
TAG="$(profile_value version)"
REF="$(profile_value ref)"

if [ "$PROFILE_SOURCE" != "mattpocock/skills" ]; then
  echo "This reproduction expects the first profile source to be mattpocock/skills." >&2
  exit 1
fi

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/skills-cli-findings.XXXXXX")"
trap 'rm -rf "$SCRATCH"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

echo "Preparing pinned upstream copy at $TAG..."
git clone --quiet --depth 1 --branch "$TAG" "https://github.com/$PROFILE_SOURCE.git" "$SCRATCH/upstream"
SKILL_FILE="$(find "$SCRATCH/upstream" -type d -name "$SKILL" -print -quit)/SKILL.md"
[ -f "$SKILL_FILE" ] || fail "could not find $SKILL in the $TAG checkout"
SKILL_PATH="${SKILL_FILE#"$SCRATCH/upstream/"}"
curl -fsSL "https://raw.githubusercontent.com/$PROFILE_SOURCE/main/$SKILL_PATH" \
  -o "$SCRATCH/main-SKILL.md"

echo
echo "1) skills add $PROFILE_SOURCE@$TAG --skill $SKILL"
mkdir -p "$SCRATCH/add"
(
  cd "$SCRATCH/add"
  git init -q
  npx -y "$SKILLS_CLI" add "$PROFILE_SOURCE@$TAG" --skill "$SKILL" -a pi -y \
    >"$SCRATCH/add.log" 2>&1
)
ADDED="$SCRATCH/add/.agents/skills/$SKILL/SKILL.md"
[ -f "$ADDED" ] || {
  cat "$SCRATCH/add.log"
  fail "skills add did not install $SKILL"
}
if cmp -s "$ADDED" "$SKILL_FILE"; then
  fail "skills add now honors @$TAG; the documented finding has changed"
fi
cmp -s "$ADDED" "$SCRATCH/main-SKILL.md" ||
  fail "skills add installed neither $TAG nor current main"
if grep -q '"ref"' "$SCRATCH/add/skills-lock.json"; then
  fail "skills add now writes ref to skills-lock.json; the documented finding has changed"
fi
echo "PASS: skills add installed current main, not $TAG, and wrote no lock ref."

echo
echo "2) package.json skills + experimental_sync"
mkdir -p "$SCRATCH/sync"
cat >"$SCRATCH/sync/package.json" <<EOF
{
  "name": "skills-cli-findings",
  "private": true,
  "skills": [
    {
      "source": "$PROFILE_SOURCE",
      "ref": "$REF",
      "skills": ["$SKILL"]
    }
  ]
}
EOF
(
  cd "$SCRATCH/sync"
  npx -y "$SKILLS_CLI" experimental_sync -a pi -y >"$SCRATCH/sync.log" 2>&1
)
SYNCED="$SCRATCH/sync/.agents/skills/$SKILL/SKILL.md"
[ -f "$SYNCED" ] || {
  cat "$SCRATCH/sync.log"
  fail "experimental_sync did not install $SKILL"
}
cmp -s "$SYNCED" "$SKILL_FILE" ||
  fail "experimental_sync did not install the pinned $TAG copy"
LOCK_REF="$(
  cd "$SCRATCH/sync"
  node -e "
    const lock = require('./skills-lock.json');
    process.stdout.write(lock.skills[process.argv[1]]?.ref ?? '');
  " "$SKILL"
)"
[ "$LOCK_REF" = "$REF" ] ||
  fail "experimental_sync lock ref is '$LOCK_REF', expected '$REF'"
echo "PASS: experimental_sync installed the pinned copy and wrote ref=$REF to the lock."

echo
echo "Both CLI findings reproduced with $SKILLS_CLI."
