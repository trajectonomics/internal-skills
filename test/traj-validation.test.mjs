import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { Mismatch, check, probe, runTraj } from '../scripts/check-traj-validation.mjs';

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

  assert.equal(notes.length, 31, 'the protocol documents 31 expectations; a deleted one must fail here');
  assert.ok(
    notes.some((note) => note.startsWith('read: net worth')),
    'the read leg must compare net worth',
  );
  assert.ok(
    notes.some((note) => note.includes('flows.savings.amount')),
    'the scenario leg must compare the Override path',
  );
  assert.ok(
    notes.some((note) => note.startsWith('plan: the FI date')),
    'the plan leg must compare the FI answer',
  );
  assert.ok(
    notes.some((note) => note.startsWith('plan: net worth at the horizon')),
    'the plan leg must compare the projected net worth',
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

test('--verify passes a ledger the protocol built and fails one it did not', { skip }, async () => {
  const protocol = await check({ traj: TRAJ, keepHome: true });

  try {
    const judged = await check({ traj: TRAJ, verify: protocol.home });
    assert.equal(judged.length, 3, 'the answer mode is three checks: the as-of echo, the net worth and the period');

    // One extra salary moves the net worth and the period result, so the ledger no longer answers.
    runTraj(
      TRAJ,
      ['tx', 'add', '--from', 'Income:Salary', '--to', 'Assets:Cash', '--amount', '1000.00', '--date', '2026-02-05'],
      protocol.home,
    );
    await assert.rejects(check({ traj: TRAJ, verify: protocol.home }), Mismatch);
  } finally {
    await protocol.dispose();
  }
});

test('--verify-plan passes a stored plan and fails one that answers differently', { skip }, async () => {
  const protocol = await check({ traj: TRAJ, keepHome: true });
  const directory = await mkdtemp(join(tmpdir(), 'traj-plan-'));

  try {
    const judged = await check({ traj: TRAJ, verifyPlan: protocol.home });
    assert.equal(judged.length, 2, 'the plan leg is two expectations: stored, and the FI date');

    // Replace the plan with one whose earned income never starts, so no FI date is reachable.
    const stored = runTraj(TRAJ, ['scenario', 'show', 'plan'], protocol.home).scenario.document;
    stored.flows = stored.flows.map((flow) => (flow.kind === 'income' ? { ...flow, amount: 0 } : flow));
    const path = join(directory, 'broke.json');
    await writeFile(path, `${JSON.stringify(stored, null, 2)}\n`);

    runTraj(TRAJ, ['scenario', 'rm', 'plan'], protocol.home);
    runTraj(TRAJ, ['scenario', 'rm', 'what-if-savings-25000'], protocol.home);
    runTraj(TRAJ, ['scenario', 'apply', 'broke', '--file', path], protocol.home);

    await assert.rejects(check({ traj: TRAJ, verifyPlan: protocol.home }), Mismatch);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await protocol.dispose();
  }
});

test('--verify-scenario passes a stored what-if and fails one in the wrong unit', { skip }, async () => {
  const protocol = await check({ traj: TRAJ, keepHome: true });
  const directory = await mkdtemp(join(tmpdir(), 'traj-scenario-'));

  try {
    const judged = await check({ traj: TRAJ, verifyScenario: protocol.home });
    assert.equal(judged.length, 2, 'the scenario leg is two expectations: stored, and the right amount');

    // What the Claude Code baseline produced: the same what-if in whole baht, which check() accepts.
    const scenario = JSON.parse(await readFile(new URL('./fixtures/traj/scenario.json', import.meta.url), 'utf8'));
    scenario.flows = scenario.flows.map((flow) =>
      flow.id === 'savings' ? { ...flow, amount: flow.amount / 100 } : flow,
    );
    const path = join(directory, 'whole-baht.json');
    await writeFile(path, `${JSON.stringify(scenario, null, 2)}\n`);

    runTraj(TRAJ, ['scenario', 'apply', 'whole-baht', '--file', path], protocol.home);
    runTraj(TRAJ, ['scenario', 'rm', 'what-if-savings-25000'], protocol.home);

    await assert.rejects(check({ traj: TRAJ, verifyScenario: protocol.home }), Mismatch);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await protocol.dispose();
  }
});
