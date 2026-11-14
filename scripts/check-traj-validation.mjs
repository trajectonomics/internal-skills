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
// Four modes. The default builds the ledger and checks everything.
//   --verify <TRAJ_HOME>           judge a ledger an agent built: the as-of echo, the net worth, the period result
//   --verify-scenario <TRAJ_HOME>   judge the what-if an agent stored: amounts in minor units
//   --verify-plan <TRAJ_HOME>       judge the plan an agent stored: its FI answer on the fixture's horizon
// None of the verify modes writes to the ledger it is given.
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
    else if (flag === '--verify-plan' && value) options.verifyPlan = value;
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
function traj(binary, argv, { home, expectExit = 0, input } = {}) {
  const [command, ...prefix] = binary.split(/\s+/).filter(Boolean);
  const result = spawnSync(command, [...prefix, ...argv, '--json'], {
    env: { ...process.env, TRAJ_HOME: home, TRAJ_FORMAT: 'json' },
    encoding: 'utf8',
    input,
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
  return { status: result.status, error: result.error };
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

/** One rendered amount, in the form the CLI prints it. */
function money(currency, amount) {
  return `${currency} ${amount}`;
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
      fixture.expected.replayedExternalRef,
      replay.status,
    ),
  );
}

function assertTransactionCount(trajBinary, fixture, home, notes) {
  const listed = traj(trajBinary, ['tx', 'list'], { home });
  notes.push(same('record: transaction count', fixture.expected.transactionCount, listed.transactions.length));
}

/** The two reads both judge modes start from, so neither repeats the other's calls. */
function readFigures(trajBinary, fixture, home) {
  return {
    balance: traj(trajBinary, ['balance', '--as-of', fixture.expected.balanceAsOf], { home }),
    pnl: traj(
      trajBinary,
      ['report', 'pnl', '--since', fixture.expected.pnl.since, '--until', fixture.expected.pnl.until],
      { home },
    ),
  };
}

/**
 * What the user actually asked for, and what a harness run is judged on: the as-of date the
 * figure was read at, the net worth, and the period result. None of the three depends on the
 * account names or the number of rows an agent chose.
 */
function answerStep(trajBinary, fixture, home, notes) {
  const { balance, pnl } = readFigures(trajBinary, fixture, home);
  notes.push(same('answer: the net worth is read at the date asked for', fixture.expected.balanceAsOf, balance.asOf));
  notes.push(same('answer: net worth', fixture.expected.netWorth, totals(balance.netWorth).join(', ')));
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
  const { balance, pnl } = readFigures(trajBinary, fixture, home);
  notes.push(same('read: balance as-of echo', fixture.expected.balanceAsOf, balance.asOf));
  notes.push(same('read: balances', fixture.expected.balances, byAccount(balance.rows)));
  notes.push(same('read: net worth', fixture.expected.netWorth, totals(balance.netWorth).join(', ')));

  const netWorth = traj(trajBinary, ['report', 'networth', '--as-of', fixture.expected.netWorthAsOf], { home });
  notes.push(same('read: net worth rows', fixture.expected.netWorthRows, byAccount(netWorth.rows)));
  notes.push(same('read: net worth total', fixture.expected.netWorth, totals(netWorth.totals).join(', ')));
  notes.push(same('read: pnl rows', fixture.expected.pnl.rows, byAccount(pnl.rows)));
  notes.push(same('read: pnl total', fixture.expected.pnl.total, totals(pnl.totals).join(', ')));
}

/**
 * The Ledger mints account ids, and a Scenario has to declare those ids (cli ADR 0026), so the
 * fixture document names its accounts symbolically and this links each one to the id the Ledger
 * actually minted. Without the link a projection refuses the Baseline as undeclared.
 */
function ledgerAccountIds(trajBinary, home) {
  const listed = traj(trajBinary, ['account', 'list'], { home });
  return Object.fromEntries(listed.accounts.map((account) => [account.name, account.id]));
}

function linkScenario(document, symbolicNames, accountIds) {
  const id = (symbol) => {
    if (!(symbol in symbolicNames)) return symbol;
    const name = symbolicNames[symbol];
    const resolved = accountIds[name];
    if (!resolved) throw new Error(`the fixture's Scenario names an account the Ledger does not have: ${name}`);
    return resolved;
  };

  return {
    ...document,
    accounts: document.accounts.map((account) => ({ ...account, id: id(account.id) })),
    flows: document.flows.map((flow) => (flow.target ? { ...flow, target: id(flow.target) } : flow)),
    cashflow: {
      ...document.cashflow,
      surplus: document.cashflow.surplus.map((entry) => ({ ...entry, account: id(entry.account) })),
      contribute: document.cashflow.contribute.map(id),
      withdraw: document.cashflow.withdraw.map(id),
    },
  };
}

async function scenarioStep(trajBinary, fixture, home, documentPath, notes) {
  const scenario = fixture.expected.scenario;
  const document = JSON.parse(await readFile(documentPath, 'utf8'));
  const linked = linkScenario(document, scenario.accounts, ledgerAccountIds(trajBinary, home));
  const stdin = JSON.stringify(linked);

  const applied = traj(
    trajBinary,
    ['scenario', 'apply', scenario.base, '--file', '-', '--dry-run'],
    { home, input: stdin },
  );
  notes.push(same('scenario: a dry run reports the write it would make', scenario.dryRunStatus, applied.status));
  notes.push(same('scenario: a dry run rolls the write back, so no id is minted', null, applied.scenario.id));

  const base = traj(trajBinary, ['scenario', 'apply', scenario.base, '--file', '-'], { home, input: stdin });
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

/**
 * The planning half of the cli ADR 0002 test: the projection, the FI answer and the what-if the
 * conversation asks for. The plan states no interest and no inflation, so the numbers are
 * arithmetic a person can check: net worth grows by 60,800.00 a month for ten years.
 */
function planStep(trajBinary, fixture, home, notes) {
  const plan = fixture.expected.plan;
  const base = fixture.expected.scenario.base;
  const schema = traj(trajBinary, ['schema'], { home });
  const names = schema.commands.map((command) => command.name);
  for (const needed of ['projection run', 'projection compare', 'fi']) {
    notes.push(
      same(`plan: "${needed}" is a command, so the planning questions have an answer`, true, names.includes(needed)),
    );
  }

  const projection = traj(
    trajBinary,
    ['projection', 'run', '--scenario', base, '--as-of', plan.asOf, '--horizon', plan.horizon],
    { home },
  );
  const annual = projection.tables.find((table) => table.name === 'annual');
  const first = annual.rows[0];
  notes.push(same('plan: the projection echoes the as-of date', plan.asOf, projection.asOf));
  notes.push(same('plan: the projection states that no tax is applied', plan.tax, projection.tax));
  notes.push(same('plan: the plan never runs out of money', plan.runsOut, projection.runsOut));
  notes.push(same('plan: annual roll-up rows', plan.annualRows, annual.count));
  notes.push(
    same(
      'plan: first-year closing net worth',
      plan.firstYear.closingNetWorth,
      money(projection.currency, first.closingNetWorth),
    ),
  );
  notes.push(same('plan: first-year income', plan.firstYear.income, money(projection.currency, first.income)));
  notes.push(same('plan: first-year expenses', plan.firstYear.expense, money(projection.currency, first.expense)));
  notes.push(
    same(
      'plan: net worth at the horizon',
      plan.finalNetWorth,
      money(projection.currency, annual.rows.at(-1).closingNetWorth),
    ),
  );

  const fi = traj(trajBinary, ['fi', '--scenario', base, '--as-of', plan.asOf, '--horizon', plan.horizon], { home });
  notes.push(same('plan: the FI method is survival', plan.method, fi.method));
  notes.push(same('plan: the FI answer is reachable', true, fi.fi.reachable));
  notes.push(same('plan: the FI date', plan.fiDate, fi.fi.fiDate));

  const compare = traj(
    trajBinary,
    ['projection', 'compare', base, '--set', plan.whatIf.override, '--as-of', plan.asOf, '--horizon', plan.horizon],
    { home },
  );
  notes.push(
    same(
      'plan: the what-if leaves the FI date alone (deltas.fiMonths)',
      plan.whatIf.fiMonthsDelta,
      compare.deltas.fiMonths,
    ),
  );
  notes.push(
    same(
      'plan: the what-if leaves the final net worth alone (deltas.netWorth.nominal)',
      plan.whatIf.netWorthDelta,
      compare.deltas.netWorth.nominal,
    ),
  );
  notes.push(
    same(
      'plan: the what-if side ends at the same net worth',
      plan.finalNetWorth,
      money(compare.currency, compare.sides.b.netWorth.final.nominal),
    ),
  );
}

/**
 * The plan leg of a harness run: the agent stored its plan as a Scenario, and running `fi` on it
 * over the fixture's horizon gives the date the conversation asks for. The conversation pins the
 * assumptions, so the date does not depend on how the agent named or grouped its accounts.
 */
function planVerifyStep(trajBinary, fixture, home, notes) {
  const plan = fixture.expected.plan;
  const listed = traj(trajBinary, ['scenario', 'list'], { home });
  notes.push(same('plan: the plan is stored as a Scenario', true, listed.scenarios.length > 0));

  const dates = listed.scenarios.map((entry) => {
    const answer = traj(trajBinary, ['fi', '--scenario', entry.name, '--as-of', plan.asOf, '--horizon', plan.horizon], {
      home,
    });
    return answer.fi?.fiDate ?? null;
  });
  if (!dates.includes(plan.fiDate)) {
    throw new Mismatch(
      `plan: the stored Scenarios answer ${JSON.stringify(dates)} for the financial-independence question, expected ${plan.fiDate}`,
    );
  }
  notes.push(`plan: a stored Scenario answers the FI question with ${plan.fiDate}`);
}

export async function check(options = {}) {
  const trajBinary = options.traj ?? process.env.TRAJ ?? 'traj';
  const fixturePath = options.fixture ?? DEFAULT_FIXTURE;
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const documentPath = resolve(dirname(fixturePath), fixture.expected.scenario.document);
  const notes = [];

  // The verify modes judge a home some agent built from the same conversation, which is the
  // only way to measure a harness run. They read and never write.
  const verifyPlan = options.verifyPlan;
  if (verifyPlan) {
    planVerifyStep(trajBinary, fixture, verifyPlan, notes);
    return notes;
  }

  const verifyScenario = options.verifyScenario;
  if (verifyScenario) {
    scenarioVerifyStep(trajBinary, fixture, verifyScenario, notes);
    return notes;
  }

  const verifyHome = options.verify;
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
    await scenarioStep(trajBinary, fixture, home, documentPath, notes);
    planStep(trajBinary, fixture, home, notes);
    // `keepHome` is the seam the test uses to judge a known-good home with the
    // --verify modes, which would otherwise have nothing to point at.
    if (options.keepHome) return { notes, home, dispose: () => rm(home, { recursive: true, force: true }) };
    return notes;
  } finally {
    if (!options.keepHome) await rm(home, { recursive: true, force: true });
  }
}

/** Run the CLI against a home, for a caller that needs to change one on purpose. */
export function runTraj(binary, argv, home) {
  return traj(binary, argv, { home });
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
        (options.verifyScenario ? `, scenarios ${options.verifyScenario}` : '') +
        (options.verifyPlan ? `, plan ${options.verifyPlan}` : ''),
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
