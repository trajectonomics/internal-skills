import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const SKILLS_URL = new URL('../skills/', import.meta.url);
const README_URL = new URL('../README.md', import.meta.url);

/**
 * The skills this repository publishes: one directory per skill, which is how
 * `npx skills add trajectonomics/internal-skills --list` finds one.
 *
 * `traj` is a customer's operating Skill and is retired here: it publishes from
 * `trajectonomics/skills` instead, so a second copy here would be a duplicate.
 */
async function publishedSkills() {
  const entries = await readdir(SKILLS_URL, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

test('the repository no longer publishes the traj skill', async () => {
  const names = await publishedSkills();

  assert.ok(names.length > 0, 'the repository still publishes its internal skills');
  assert.equal(
    names.includes('traj'),
    false,
    'traj publishes from trajectonomics/skills now; a copy here is the duplicate meant to go',
  );
});

test('every published skill carries a SKILL.md', async () => {
  for (const name of await publishedSkills()) {
    await assert.doesNotReject(
      readFile(new URL(`${name}/SKILL.md`, SKILLS_URL), 'utf8'),
      `skills/${name}/SKILL.md must exist, or the skills CLI cannot publish that skill`,
    );
  }
});

test('the README no longer gives the outsider traj install', async () => {
  const readme = await readFile(README_URL, 'utf8');

  assert.doesNotMatch(
    readme,
    /--skill traj/,
    'nothing here installs the retired traj skill; it publishes from trajectonomics/skills',
  );
  assert.doesNotMatch(
    readme,
    /check-traj-install|check-traj-validation|traj-skill-validation/,
    'the retired install check, validation checker and validation record are gone',
  );
  assert.ok(
    readme.includes('npx skills add trajectonomics/internal-skills -y'),
    'the bare install command stays, and so does its warning',
  );
  const warning = readme.toLowerCase();
  assert.ok(
    warning.includes('every skill') || warning.includes('all skills'),
    'the README must warn that the bare command installs every skill',
  );
});
