# `traj` skill validation, 2026-11-13

The dated record of the cli ADR 0002 validation test for the `traj` skill
([`skills/traj/SKILL.md`](../skills/traj/SKILL.md)), run for
[#16](https://github.com/trajectonomics/internal-skills/issues/16) against `traj` **v0.1.0**
([`@trajectonomics/cli@0.1.0`](https://www.npmjs.com/package/@trajectonomics/cli)).

The ADR 0002 test: *an agent, given only the CLI and its own `schema` output, builds a plan
from a conversation and answers what-ifs correctly.* The owner's answer on the Spec allows
the test to reach **the pinned `sim-core` public documentation and the `check()` error
output** as well as the CLI's own `schema`, because the Scenario document's shape is
`sim-core`'s ([cli ADR 0024](https://github.com/trajectonomics/cli/blob/main/docs/adr/0024-scenario-documents-and-overrides.md)).
The skill's *Scenarios* paragraph is where an agent is told to use them: it says in the
imperative to read the pinned documentation and to iterate against the `check()` errors, so
the test's permission is spent there rather than restated as a fact about the test.

The protocol has two halves, and only the second can show that the skill taught anything.

## The fixture

[`test/fixtures/traj/fixture.json`](../test/fixtures/traj/fixture.json) holds a short
conversation with a Thai employee: two opening balances, a monthly salary, rent, food, a
savings transfer and a mortgage payment, an explicit recording window ("up to 10 February
2026"), then three questions — net worth at a date, how January went, a what-if at 25,000
instead of 20,000 into savings, and when they can stop working.

The conversation is fixed, so the expected answers are too:

| Question | Expected |
| --- | --- |
| Net worth on 2026-02-10 | `THB 242800.00` (assets 818,800.00 − mortgage 576,000.00) |
| January 2026, income minus expenses | `THB 60800.00` (85,000.00 − 18,000.00 − 6,200.00) |
| The what-if | net worth unchanged; the split moves 5,000.00 |
| When can I stop working | not answerable on v0.1.0: `traj schema` has no `projection` and no `fi` |

[`test/fixtures/traj/scenario.json`](../test/fixtures/traj/scenario.json) is the Scenario v1
document for the same plan, so the what-if also exercises an Override
(`flows.savings.amount`) rather than only a read.

## The deterministic half

`node scripts/check-traj-validation.mjs` builds that ledger in a scratch `TRAJ_HOME` from
`--json` calls, reads it back, and compares 16 expectations: the transaction count, that a
replayed external reference is a duplicate at exit 0 rather than a second write, every
balance and the net worth, the January profit and loss, a Scenario dry run that mints no id,
the Override in a fork leaving the base Scenario alone, and the absence of the `projection`
and `fi` commands. It runs against the released CLI with

```bash
TRAJ="npx -y @trajectonomics/cli@latest" node scripts/check-traj-validation.mjs
```

Two modes judge a ledger some *agent* built from the same conversation:

- `--verify <TRAJ_HOME>` compares only what the user asked for: the as-of date the net worth
  was read at, the net worth, and the period result. Account names and row shape are the
  agent's business; those three are not.
- `--verify-scenario <TRAJ_HOME>` requires the what-if to be stored as a Scenario whose flows
  hold the amount in **minor units**. `sim-core`'s `check()` accepts a document whose amounts
  are a hundred times too small, so only the number itself catches that mistake.

[`test/traj-validation.test.mjs`](../test/traj-validation.test.mjs) shows the checker is real:
it passes on the correct ledger, and fails on a wrong amount in the setup, on a wrong
expectation, on a Scenario document `sim-core` rejects, on `--verify` against a ledger with an
extra transaction, and on `--verify-scenario` against a what-if in whole baht. It skips with a
reason when no `traj` is runnable, so `npm test` needs neither the network nor the CLI.

This half **cannot** show that the skill taught anything. It compares `traj` with `traj`.

## The harness half

Each harness got two prompts, each with its own empty `TRAJ_HOME` prepared by `traj init`, and
each run twice: **baseline** (the CLI and its `schema` output only) and **treatment** (the
same, with `npx skills add … --skill traj` installed into the project). The prompt named the
tool and how to invoke it, then the conversation, then: *every number you tell them must come
from the tool.* The second prompt additionally asked for the 25,000 version to be **kept as a
named what-if**.

### Record and read

| Harness | Baseline | Treatment |
| --- | --- | --- |
| Claude Code 2.1.323 | 242,800.00 and 60,800.00 — **correct**; 8 rows, one 3-posting opening | 242,800.00 and 60,800.00 — **correct**; 8 rows with an external reference on each write; kept the what-if in a separate scratch ledger |
| Pi, `deepseek-v4.1-flash` | 242,800.00 and 60,800.00 — **correct**; 9 rows | 242,800.00 and 60,800.00 — **correct**; 8 rows |
| Antigravity CLI (`agy`), `gemini-4-hydrogen-medium` | 242,800.00 and 60,800.00 — **correct** | 242,800.00 and 60,800.00 — **correct**; stated the as-of date and "excluding tax" on each figure |

All six ledgers pass `--verify`, and both Claude Code and Pi baselines also got the cross-account
arithmetic of the what-if right. All six declined the financial-independence date with a reason.

### Scenario

| Harness | Baseline | Treatment |
| --- | --- | --- |
| Claude Code 2.1.323 | stored `base` and a fork `save-25k` whose flows are **whole baht** (`85000`) — `--verify-scenario` fails | stored `base-20k` and a fork `savings-25k` in **minor units** (`8500000`) — passes |
| Pi, `deepseek-v4.1-flash` | `base-20k` and `save-25k`, **minor units**, passes | `plan-20000` and `savings-25000`, **minor units**, passes |
| Antigravity CLI (`agy`), `gemini-4-hydrogen-medium` | `base` and `save-25000`, **minor units**, but the change is a cap on `cashflow.surplus` (`2500000`) rather than the savings flow — `--verify-scenario` fails | `base` and `savings-25k` whose content hash **equals `base`**: the fork holds no change, because the agent did not find a flow kind for a transfer into savings and said so in its answer — `--verify-scenario` fails |

So the whole-baht document is **model-dependent, not skill-caused**: one baseline produced it
and the other did not. It is still the sharpest failure these runs found — the document is
schema-valid, the fork reports the change, and every number in it is a hundred times too
small — and the skill now states the unit in its *Scenarios* paragraph instead of leaving it
to be inferred from the ledger rules. That removes the inference; it does not prove the
inference was the cause.

The Antigravity runs are the first to fail the Scenario half *with* the skill. Both failures are
the same problem the Spec already recorded: an agent finds the Scenario document's top-level
keys but not the flow kind for money moved into an account (`contribution`) from `schema`
alone, and iterating on `check()` errors does not reveal it either. The baseline guessed a
different model (a surplus cap); the treatment gave up and stored a fork identical to its
parent, then wrote "named what-if saved" next to a fork that changes nothing. The first is a
`traj schema scenario apply` gap (the cli follow-up below). The second is a skill gap, and the
*Scenarios* paragraph now says a fork whose `contentHash` equals its parent's holds no change
and must be reported as such, not as the what-if.

### What the skill added

On record and read it added **wording, not arithmetic**: the treatment runs stated the as-of
date and the tax position of every figure, set an external reference on each write, and named
the missing `projection` command from `schema` rather than guessing. The baselines reached the
same numbers and left the tax position implicit. On a CLI that only records and reads, that is
the whole measurable difference, and it is worth saying plainly rather than presenting a tie
as a win.

One difference is a behaviour change worth arguing about: the Pi **baseline** answered the
what-if by hand (793,800.00 in the current account, 25,000.00 in savings), and the Pi
**treatment** refused to ("I can't give you that number, and I won't guess it"). The treatment
obeyed user story 16 — every figure you report is one `traj` returned — at the cost of a less
useful answer to a question with no projection behind it. If that trade is wrong, the rule in
the skill is wrong, not the agent: change the skill.

## What the runs changed

Three things, all found by running the protocol rather than reasoning about it:

1. The first draft expected 7 transactions and a net worth of 260,800.00. The conversation
   says "on the 25th of every month", so recording February's rent and mortgage on the 5th —
   before the 10 February as-of date — was right and the fixture was wrong. The conversation
   now states the recording window, and the expectation is 9 rows.
2. The first draft's `--verify` mode counted transactions and compared balances by account
   name. Claude Code recorded the two opening balances as one multi-posting row and named its
   accounts freely; the books were identical. Counting rows tests a recording style, not the
   answer, so `--verify` now compares the as-of echo, the net worth and the period result, and
   nothing that depends on how the agent named its accounts.
3. The Scenario unit, above. That is the only change to `skills/traj/SKILL.md` these runs
   produced.

## Re-running this

The scratch ledgers were deleted with the run: a `TRAJ_HOME` kept on this machine is not
evidence a month later, so nothing here cites one as if it were durable. To regenerate an
arm, in a new directory with its own empty `TRAJ_HOME`:

```bash
TRAJ_HOME="$PWD/home" npx -y @trajectonomics/cli@latest init
# treatment only: npx skills add trajectonomics/internal-skills --skill traj -a claude-code -y
claude -p "$(cat prompt.txt)" --dangerously-skip-permissions    # or: pi -p "$(cat prompt.txt)"
# or: agy --model gemini-4-hydrogen-medium --dangerously-skip-permissions -p "$(cat prompt.txt)" (treatment: -a antigravity-cli)
TRAJ="npx -y @trajectonomics/cli@latest" node scripts/check-traj-validation.mjs --verify "$PWD/home"
TRAJ="npx -y @trajectonomics/cli@latest" node scripts/check-traj-validation.mjs --verify-scenario "$PWD/home"
```

`prompt.txt` is the conversation from `test/fixtures/traj/fixture.json` with this framing:
the tool is `traj`, invoked as `npx -y @trajectonomics/cli@latest <args>`, its data directory
is `TRAJ_HOME`, work only in this directory, every number must come from the tool, and finish
by writing `answers.md`. The scenario prompt adds one line asking for the 25,000 version to be
kept as a named what-if. Fresh model runs vary; only the numbers are compared.

## Gaps this note does not close

- **Codex was not run, by the owner's decision.** #16 named Claude Code and Codex; on
  2026-11-14 the owner replaced that with "any two agent CLIs we already have". Three ran
  (Claude Code, Pi, Antigravity CLI), so the criterion is met without Codex, and infra#41
  (a Codex login) is not needed for this ticket. One run per harness and arm still cannot
  separate the model's choice from the skill's effect, and this note does not claim to.
- **`traj schema scenario apply` does not carry `sim-core`'s JSON Schema.** At the pinned
  `v0.1.0` tag the Scenario shape is public only in `src/fixtures/*.ts` and in `check()`'s
  errors; that tag's `README.md` does not describe it. The Spec's *Out of Scope* records the
  fix as a `trajectonomics/cli` follow-up that this Spec **cannot file**, so it is recorded
  here and in [#17](https://github.com/trajectonomics/internal-skills/issues/17). The
  practical effect: an agent discovers the top-level keys and then nested paths by trial, one
  dry-run error at a time, and needs the pinned fixture source for the rest.
- **Projection, FI and tax are absent from v0.1.0**, so the what-if's numbers and the
  retirement question have no answer in the tool. That is
  [trajectonomics/cli#11](https://github.com/trajectonomics/cli/issues/11), and the full run
  is [#17](https://github.com/trajectonomics/internal-skills/issues/17).
- **#15's post-merge check against GitHub** (`bash scripts/check-traj-install.sh
  trajectonomics/internal-skills`) can only run after this merges, and its output belongs on
  [#12](https://github.com/trajectonomics/internal-skills/issues/12) then.

## Verdict against ADR 0002

**Partial on three counts.** They are: v0.1.0 has no `projection`, no `fi` and no tax, so the
what-if's *numbers* cannot come from the tool and the financial-independence question has no
answer in it; one Claude Code baseline put a Scenario document's amounts in whole baht
instead of minor units; and both Antigravity runs failed to store the what-if the way the
fixture does, because the flow kind for money moved into an account is not discoverable from
`schema`. For the part v0.1.0
supports best — record and read — all six harness runs build a correct ledger from the
conversation and answer both answerable questions correctly, and the skill
now states the Scenario unit so no run has to infer it. One run per harness cannot show
whether that unit mistake came from the skill's absence or from the model's own choice, so
this note does not claim it did.

The full run, with projection and FI on two harnesses, is
[#17](https://github.com/trajectonomics/internal-skills/issues/17).
