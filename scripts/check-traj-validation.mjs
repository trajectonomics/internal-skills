#!/usr/bin/env node
// The deterministic half of the cli ADR 0002 validation protocol: build the fixture
// ledger from the fixture conversation in a scratch TRAJ_HOME, read it back, and compare
// every number with the expectation. It proves the skill's instructions produce a correct
// ledger; only the harness runs can show whether an agent followed them.
//
//   node scripts/check-traj-validation.mjs
//   node scripts/check-traj-validation.mjs --traj "npx -y @trajectonomics/cli@latest"
//   node scripts/check-traj-validation.mjs --fixture test/fixtures/traj/fixture.json
//
// Exit 0 all expectations met, 1 a mismatch, 2 the fixture or the CLI could not be used.
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FIXTURE = join(REPO_ROOT, 'test/fixtures/traj/fixture.json');

function parseArgs(argv) {
  const options = { traj: process.env.TRAJ ?? 'traj', fixture: DEFAULT_FIXTURE, verify: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--traj' && value) options.traj = value;
    else if (flag === '--fixture' && value) options.fixture = value;
    else if (flag === '--verify' && value) options.verify = value;
    else if (flag === '--verify-scenario' && value) options.verifyScenario = value;
    else throw new Error(`unknown argument: ${flag}`);
    index += 1;
  }
  return options;
}

class Mismatch extends Error {}

export { Mismatch };

/**
 * Run the CLI and return its parsed JSON. `expect` is the exit code the call must
 * report inside the envelope (or from the process); a mismatch is a finding, not a crash.
 */
function traj(binary, argv, { home, expectExit = 0 } = {}) {
  const [command, ...prefix] = binary.split(/\s+/).filter(Boolean);
  const result = spawnSync(command, [...prefix, ...argv, '--json'], {
    env: { ...process.env, TRAJ_HOME: home, TRAJ_FORMAT: 'json' },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: 600_000,
  });

  if (result.error) throw new Error(`could not run "${binary}": ${result.error.message}`);
  if (result.status !== expectExit) {
    throw new Mismatch(
      `traj ${argv.join(' ')} exited ${result.status}, expected ${expectExit}\n${result.stderr.trim()}`,
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Mismatch(
      `traj ${argv.join(' ')} did not print JSON on stdout\n${result.stdout.trim()}\n${result.stderr.trim()}`,
    );
  }
}

/** Whether the CLI can be started at all, which is the one thing a skip depends on. */
export function probe(binary) {
  const [command, ...prefix] = binary.split(/\s+/).filter(Boolean);
  const result = spawnSync(command, [...prefix, '--version'], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 300_000,
  });
  return { status: result.status, version: result.stdout.trim(), error: result.error };
}

/** A JSON dump whose object keys are sorted, so a `{ name: amount }` map compares by content. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

/** Compare one expected value with what the CLI reported. */
function same(label, expected, actual) {
  if (JSON.stringify(canonical(expected)) !== JSON.stringify(canonical(actual))) {
    throw new Mismatch(`${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
  return `${label} = ${JSON.stringify(actual)}`;
}

/** A `{ name: amount }` map, so an expectation never depends on a generated id. */
function byAccount(rows, key = 'account') {
  return Object.fromEntries(rows.map((row) => [row[key].name, row.amount]));
}

function totals(rows) {
  return rows.map((row) => `${row.currency} ${row.amount}`);
}

/**
 * Read a dotted Override path out of a document. Object keys are dotted and a list item is
 * addressed by its stable `id`, never by array index (cli ADR 0024), which is the same
 * grammar the skill teaches.
 */
function readPath(document, path) {
  return path.split('.').reduce((node, key) => {
    if (node === null || node === undefined) return undefined;
    if (Array.isArray(node)) return node.find((item) => item?.id === key);
    return node[key];
  }, document);
}

function recordStep(trajBinary, fixture, home, notes) {
  traj(trajBinary, ['init'], { home });
  for (const account of fixture.setup.accounts) {
    traj(trajBinary, ['account', 'add', account.name, '--type', account.type, '--currency', account.currency], { home });
  }

  for (const transaction of fixture.setup.transactions) {
    const argv = ['tx', 'add'];
    if (transaction.opening) argv.push('--opening');
    argv.push('--from', transaction.from, '--to', transaction.to, '--amount', transaction.amount);
    argv.push('--date', transaction.date, '--memo', transaction.memo);
    if (transaction.externalRef) argv.push('--external-ref', transaction.externalRef);
    traj(trajBinary, argv, { home });
  }

  assertTransactionCount(trajBinary, fixture, home, notes);

  const last = fixture.setup.transactions.at(-1);
  const replay = traj(
    trajBinary,
    [
      'tx', 'add',
      '--from', last.from, '--to', last.to, '--amount', last.amount,
      '--date', last.date, '--memo', last.memo, '--external-ref', last.externalRef,
    ],
    { home },
  );
  notes.push(
    same(
      'record: replaying an external reference is a duplicate at exit 0, not a second write',
      fixture.expected.replayedExternalRef.status,
      replay.status,
    ),
  );
}

function assertTransactionCount(trajBinary, fixture, home, notes) {
  const listed = traj(trajBinary, ['tx', 'list'], { home });
  notes.push(same('record: transaction count', fixture.expected.transactionCount, listed.transactions.length));
}

/**
 * What the user actually asked for, and what a harness run is judged on: two figures that do
 * not depend on the account names or the number of rows an agent chose.
 */
function answerStep(trajBinary, fixture, home, notes) {
  const balance = traj(trajBinary, ['balance', '--as-of', fixture.expected.balanceAsOf], { home });
  notes.push(same('answer: the net worth is read at the date asked for', fixture.expected.balanceAsOf, balance.asOf));
  notes.push(same('answer: net worth', fixture.expected.netWorth, totals(balance.netWorth).join(', ')));

  const pnl = traj(
    trajBinary,
    ['report', 'pnl', '--since', fixture.expected.pnl.since, '--until', fixture.expected.pnl.until],
    { home },
  );
  notes.push(same('answer: how January went', fixture.expected.pnl.total, totals(pnl.totals).join(', ')));
}

/**
 * The scenario leg of a harness run: the what-if someone asked to keep has to be stored, and
 * its amounts have to be integers of minor units. A document a hundred times too small passes
 * sim-core's check(), so nothing but the number itself catches it.
 */
function scenarioVerifyStep(trajBinary, fixture, home, notes) {
  const expected = fixture.expected.scenario.overrideTo;
  const listed = traj(trajBinary, ['scenario', 'list'], { home });
  notes.push(same('scenario: the what-if is stored as a Scenario', true, listed.scenarios.length > 0));

  const amounts = listed.scenarios.flatMap((entry) => {
    const document = traj(trajBinary, ['scenario', 'show', entry.name], { home }).scenario.document;
    return (document.flows ?? []).map((flow) => flow.amount);
  });
  notes.push(
    same(
      `scenario: a stored flow holds ${expected} minor units, which is the amount asked for`,
      true,
      amounts.includes(expected),
    ),
  );
}

function readStep(trajBinary, fixture, home, notes) {
  const balance = traj(trajBinary, ['balance', '--as-of', fixture.expected.balanceAsOf], { home });
  notes.push(same('read: balance as-of echo', fixture.expected.balanceAsOf, balance.asOf));
  notes.push(same('read: balances', fixture.expected.balances, byAccount(balance.rows)));
  notes.push(same('read: net worth', fixture.expected.netWorth, totals(balance.netWorth).join(', ')));

  const netWorth = traj(trajBinary, ['report', 'networth', '--as-of', fixture.expected.netWorthAsOf], { home });
  notes.push(same('read: net worth rows', fixture.expected.netWorthRows, byAccount(netWorth.rows)));
  notes.push(same('read: net worth total', fixture.expected.netWorth, totals(netWorth.totals).join(', ')));

  const pnl = traj(
    trajBinary,
    ['report', 'pnl', '--since', fixture.expected.pnl.since, '--until', fixture.expected.pnl.until],
    { home },
  );
  notes.push(same('read: pnl rows', fixture.expected.pnl.rows, byAccount(pnl.rows)));
  notes.push(same('read: pnl total', fixture.expected.pnl.total, totals(pnl.totals).join(', ')));
}

function scenarioStep(trajBinary, fixture, home, documentPath, notes) {
  const scenario = fixture.expected.scenario;
  const applied = traj(
    trajBinary,
    ['scenario', 'apply', scenario.base, '--file', documentPath, '--dry-run'],
    { home },
  );
  notes.push(same('scenario: a dry run reports the write it would make', scenario.dryRunStatus, applied.status));
  notes.push(same('scenario: a dry run rolls the write back, so no id is minted', null, applied.scenario.id));

  const base = traj(trajBinary, ['scenario', 'apply', scenario.base, '--file', documentPath], { home });
  notes.push(
    same(
      `scenario: the document states ${scenario.overridePath} before the what-if`,
      scenario.overrideFrom,
      readPath(base.scenario.document, scenario.overridePath),
    ),
  );

  const forked = traj(
    trajBinary,
    ['scenario', 'fork', scenario.base, scenario.fork, '--set', scenario.override],
    { home },
  );
  notes.push(
    same(
      `scenario: the Override moves ${scenario.overridePath} in the fork`,
      scenario.overrideTo,
      readPath(forked.scenario.document, scenario.overridePath),
    ),
  );
  notes.push(
    same(
      'scenario: the base Scenario is left alone by the fork',
      scenario.overrideFrom,
      readPath(
        traj(trajBinary, ['scenario', 'show', scenario.base], { home }).scenario.document,
        scenario.overridePath,
      ),
    ),
  );
}

function capabilityStep(trajBinary, fixture, home, notes) {
  const schema = traj(trajBinary, ['schema'], { home });
  const names = schema.commands.map((command) => command.name);
  for (const missing of fixture.expected.missingCapabilities) {
    const present = names.some((name) => name === missing || name.startsWith(`${missing} `));
    notes.push(same(`capability: v0.1.0 has no "${missing}" command, so an agent must say so`, false, present));
  }
}

export async function check(options = {}) {
  const trajBinary = options.traj ?? process.env.TRAJ ?? 'traj';
  const fixturePath = options.fixture ?? DEFAULT_FIXTURE;
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const documentPath = resolve(dirname(fixturePath), fixture.expected.scenario.document);
  const notes = [];

  // `--verify <TRAJ_HOME>` judges a ledger some agent built from the same conversation, which
  // is the only way to measure a harness run. It reads and never writes, and it compares only
  // the figures the user asked for: an agent may name its accounts and shape its rows freely.
  const verifyScenario = options.verifyScenario;
  if (verifyScenario) {
    scenarioVerifyStep(trajBinary, fixture, verifyScenario, notes);
    return notes;
  }

  const verifyHome = options.verifyHome ?? options.verify;
  if (verifyHome) {
    answerStep(trajBinary, fixture, verifyHome, notes);
    return notes;
  }

  const home = await mkdtemp(join(tmpdir(), 'traj-validation-'));

  try {
    const availability = probe(trajBinary);
    if (availability.status !== 0) {
      const reason = availability.error?.message ?? `${trajBinary} --version exited ${availability.status}`;
      throw new Error(`the traj CLI is not runnable here (${reason}); install it with npx or set TRAJ`);
    }

    recordStep(trajBinary, fixture, home, notes);
    readStep(trajBinary, fixture, home, notes);
    scenarioStep(trajBinary, fixture, home, documentPath, notes);
    capabilityStep(trajBinary, fixture, home, notes);
    return notes;
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const notes = await check(options);
    for (const note of notes) console.log(`ok  ${note}`);
    console.log(
      `\nPASS: ${notes.length} expectations met with ${options.traj}, fixture ${options.fixture}` +
        (options.verify ? `, ledger ${options.verify}` : '') +
        (options.verifyScenario ? `, scenarios ${options.verifyScenario}` : ''),
    );
  } catch (error) {
    if (error instanceof Mismatch) {
      console.error(`FAIL: ${error.message}`);
      process.exitCode = 1;
    } else {
      console.error(`ERROR: ${error.message}`);
      process.exitCode = 2;
    }
  }
}
