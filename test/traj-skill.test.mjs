import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const SKILL_URL = new URL('../skills/traj/SKILL.md', import.meta.url);
const README_URL = new URL('../README.md', import.meta.url);

/**
 * The command surface of the released `traj` v0.1.0, taken from `traj schema --json`.
 * The skill must teach the agent to read the surface at run time, so a line that
 * opens with one of these paths and a flag is a copied command table that will go stale.
 */
const TRAJ_V0_1_0_COMMANDS = [
  'account add',
  'account close',
  'account list',
  'account show',
  'balance',
  'baseline show',
  'export',
  'help',
  'init',
  'inspect',
  'report networth',
  'report pnl',
  'scenario apply',
  'scenario diff',
  'scenario fork',
  'scenario list',
  'scenario rm',
  'scenario show',
  'schema',
  'tx add',
  'tx amend',
  'tx import',
  'tx list',
  'tx show',
  'tx void',
  'version',
];

/**
 * The reading instruments. `schema`, `help` and `version` are how the skill tells an
 * agent to read the surface, so naming them is required, not a copy of it; `--json`,
 * `--help` and `--version` are global options that no command can change.
 */
const DISCOVERY_COMMANDS = new Set(['schema', 'help', 'version']);

const TRIGGER_WORDS = [
  'money',
  'finance',
  'financial',
  'budget',
  'spending',
  'tax',
  'ledger',
  'what-if',
  'financial independence',
  'thailand',
];

/** The skill's frontmatter as a flat map of top-level `key: value` lines. */
function frontmatter(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert.ok(match, 'skills/traj/SKILL.md must open with a --- frontmatter block');
  const fields = new Map();
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (field) fields.set(field[1], field[2].trim());
  }
  return { fields, body: source.slice(match[0].length) };
}

/** A line with prose markers removed, so a fenced or listed command line still reads as one. */
function commandLine(line) {
  return line
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')
    .replace(/^`+/, '')
    .trim();
}

test('the traj skill declares name and a trigger-style description', async () => {
  const { fields } = frontmatter(await readFile(SKILL_URL, 'utf8'));

  assert.equal(fields.get('name'), 'traj', 'frontmatter name must be "traj"');

  const description = fields.get('description') ?? '';
  assert.ok(description.length > 0, 'frontmatter description must not be empty');
  assert.ok(
    description.length <= 1024,
    `the skills CLI rejects a description over 1024 characters (got ${description.length})`,
  );
  const lower = description.toLowerCase();
  assert.ok(
    TRIGGER_WORDS.some((word) => lower.includes(word)),
    `the description must carry a trigger word an agent fires on, one of: ${TRIGGER_WORDS.join(', ')}`,
  );
});

test('the traj skill is model-invoked', async () => {
  const { fields } = frontmatter(await readFile(SKILL_URL, 'utf8'));
  assert.equal(
    fields.has('disable-model-invocation'),
    false,
    'an agent must load this skill when the user talks about their money, so it must not set disable-model-invocation',
  );
});

test('the traj skill names the scoped package and the two discovery commands', async () => {
  const { body } = frontmatter(await readFile(SKILL_URL, 'utf8'));

  assert.ok(
    body.includes('@trajectonomics/cli'),
    'the skill must name the scoped npm package @trajectonomics/cli',
  );
  assert.ok(
    body.includes('traj --version'),
    'the skill must use `traj --version` as the sentinel that decides how to run the CLI',
  );
  assert.ok(
    body.includes('traj schema'),
    'the skill must point the agent at `traj schema` instead of a remembered command list',
  );
});

test('the traj skill never runs the unscoped traj package', async () => {
  const { body } = frontmatter(await readFile(SKILL_URL, 'utf8'));
  const unscoped = /npx\s+(?:-{1,2}[\w-]+\s+)*traj\b|bunx\s+(?:-{1,2}[\w-]+\s+)*traj\b/;

  assert.doesNotMatch(
    body,
    unscoped,
    'the unscoped npm package `traj` belongs to someone else: run it through @trajectonomics/cli',
  );
});

test('the traj skill carries no copied command table', async () => {
  const { body } = frontmatter(await readFile(SKILL_URL, 'utf8'));
  const copied = TRAJ_V0_1_0_COMMANDS.filter((command) => !DISCOVERY_COMMANDS.has(command)).map(
    (command) =>
      new RegExp(
        String.raw`^traj\s+${command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}\s+--`,
      ),
  );

  const offenders = body
    .split(/\r?\n/)
    .map(commandLine)
    .filter((line) => copied.some((pattern) => pattern.test(line)));

  assert.deepEqual(
    offenders,
    [],
    `these lines copy a v0.1.0 command invocation and will go stale; read it from \`traj schema\` instead:\n${offenders.join('\n')}`,
  );
});

test('the traj skill covers the contract rules an agent must not guess', async () => {
  const { body } = frontmatter(await readFile(SKILL_URL, 'utf8'));
  const rules = [
    ['--json', 'output format is explicit, never inferred from a terminal'],
    ['exitCode', 'errors arrive as an envelope whose exitCode names the class'],
    ['YYYY-MM-DD', 'dates are Gregorian ISO 8601, so a year must never be a Buddhist Era one'],
    ['TRAJ_HOME', 'the data directory is one path, overridden by TRAJ_HOME'],
    [/never calls an LLM|does not call an? LLM/i, 'the agent supplies the judgement, traj supplies the arithmetic'],
    ['sim-core', 'a Scenario document is sim-core\u2019s, not the CLI\u2019s'],
  ];

  for (const [needle, why] of rules) {
    const mentioned = typeof needle === 'string' ? body.includes(needle) : needle.test(body);
    assert.ok(mentioned, `the skill must mention ${needle}: ${why}`);
  }
});

test('the README publishes the traj skill and its outsider install command', async () => {
  const readme = await readFile(README_URL, 'utf8');
  const lower = readme.toLowerCase();

  assert.match(readme, /`traj`/, 'the README must list the traj skill by name');
  assert.ok(
    readme.includes('npx skills add trajectonomics/internal-skills --skill traj'),
    'the README must give the command that installs only the traj skill',
  );
  assert.ok(
    lower.includes('every skill') || lower.includes('all skills'),
    'the README must warn that the bare `npx skills add` command installs every skill',
  );
});
