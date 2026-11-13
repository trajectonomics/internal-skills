import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { Mismatch, check, probe } from '../scripts/check-traj-validation.mjs';

const FIXTURE = fileURLToPath(new URL('./fixtures/traj/fixture.json', import.meta.url));

/**
 * These tests drive a real `traj`, which downloads about 100 MB the first time. They run
 * wherever one is available and skip with a reason wherever it is not, so `npm test` needs
 * neither the network nor the CLI.
 */
function findTraj() {
  for (const candidate of [process.env.TRAJ, 'traj']) {
    if (!candidate) continue;
    if (probe(candidate).status === 0) return candidate;
  }
  return null;
}

const TRAJ = findTraj();
const skip = TRAJ
  ? false
  : 'no runnable traj: set TRAJ to a binary, or install one with npx @trajectonomics/cli';

/** A copy of the fixture with one field replaced, next to a copy of its Scenario document. */
async function mutatedFixture(mutate, mutateScenario) {
  const fixture = JSON.parse(await readFile(FIXTURE, 'utf8'));
  mutate(fixture);
  const directory = await mkdtemp(join(tmpdir(), 'traj-fixture-'));
  const path = join(directory, 'fixture.json');
  await writeFile(path, `${JSON.stringify(fixture, null, 2)}\n`);

  const scenarioPath = join(dirname(FIXTURE), 'scenario.json');
  const scenario = mutateScenario
    ? mutateScenario(JSON.parse(await readFile(scenarioPath, 'utf8')))
    : await readFile(scenarioPath, 'utf8');
  await writeFile(join(directory, 'scenario.json'), scenario);

  return { path, remove: () => rm(directory, { recursive: true, force: true }) };
}

test('the fixture ledger meets every expectation', { skip }, async () => {
  const notes = await check({ traj: TRAJ });

  assert.ok(notes.length >= 15, `expected the full protocol to run, got ${notes.length} checks`);
  assert.ok(
    notes.some((note) => note.startsWith('read: net worth')),
    'the read leg must compare net worth',
  );
  assert.ok(
    notes.some((note) => note.includes('flows.savings.amount')),
    'the scenario leg must compare the Override path',
  );
});

test('the checker fails on a wrong ledger', { skip }, async () => {
  const fixture = await mutatedFixture((copy) => {
    // One wrong amount in the setup is enough: every balance and the net worth move with it.
    copy.setup.transactions.find((entry) => entry.externalRef === 'salary-2026-01').amount = '86000.00';
  });

  try {
    await assert.rejects(check({ traj: TRAJ, fixture: fixture.path }), Mismatch);
  } finally {
    await fixture.remove();
  }
});

test('the checker fails on a wrong expectation', { skip }, async () => {
  const fixture = await mutatedFixture((copy) => {
    copy.expected.balances['Assets:Cash'] = '828800.01';
  });

  try {
    await assert.rejects(check({ traj: TRAJ, fixture: fixture.path }), Mismatch);
  } finally {
    await fixture.remove();
  }
});

test('the checker fails on a Scenario document sim-core rejects', { skip }, async () => {
  const fixture = await mutatedFixture(
    () => {},
    (scenario) => `${JSON.stringify({ ...scenario, notAScenarioField: true }, null, 2)}\n`,
  );

  try {
    // An unknown key is invalid_input at exit 2, and the apply's exit code is the finding.
    await assert.rejects(check({ traj: TRAJ, fixture: fixture.path }), /exited 2/);
  } finally {
    await fixture.remove();
  }
});
