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
Both the skill and this note say so.

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

- `--verify <TRAJ_HOME>` compares only the figures the user asked for, the net worth and the
  period result. Account names and row shape are the agent's business; the numbers are not.
- `--verify-scenario <TRAJ_HOME>` requires the what-if to be stored as a Scenario whose flows
  hold the amount in **minor units**. `sim-core`'s `check()` accepts a document whose amounts
  are a hundred times too small, so only the number itself catches that mistake.

[`test/traj-validation.test.mjs`](../test/traj-validation.test.mjs) shows the checker is real:
it passes on the correct ledger, and fails on a wrong amount in the setup, on a wrong
expectation, and on a Scenario document `sim-core` rejects. It skips with a reason when no
`traj` is runnable, so `npm test` needs neither the network nor the CLI.

This half **cannot** show that the skill taught anything. It compares `traj` with `traj`.

## The harness half

The same prompt was given to each harness, with an empty `TRAJ_HOME` prepared by `traj init`,
twice: **baseline** (the CLI and its `schema` output only) and **treatment** (the same, with
`npx skills add … --skill traj` installed into the project). The prompt named the tool and how
to invoke it, then the conversation, then: *every number you tell them must come from the
tool.* A second, scenario-only prompt then asked for the 25,000 version to be **kept as a
named what-if**.

### Record and read

| Harness | Baseline | Treatment |
| --- | --- | --- |
| Claude Code 2.1.323 | 242,800.00 and 60,800.00 — **correct**; 8 rows, one 3-posting opening | 242,800.00 and 60,800.00 — **correct**; 8 rows with an external reference on each write; kept the what-if in a separate scratch ledger (`work/whatif-home`) |
| Pi, `deepseek-v4.1-flash` | 242,800.00 and 60,800.00 — **correct**; 9 rows | 242,800.00 and 60,800.00 — **correct**; 8 rows |

All four ledgers pass `--verify`. Both baselines also got the cross-account arithmetic of the
what-if right, and all four declined the financial-independence date with a reason.

### Scenario

| Harness | Baseline | Treatment |
| --- | --- | --- |
| Claude Code 2.1.323 | stored `base` and a fork `save-25k`; the fork's flows are **whole baht** (`85000`) | stored `base-20k` and a fork `savings-25k`; the fork's flows are **minor units** (`8500000`) |

`--verify-scenario` passes the treatment and fails the baseline. The Scenario amounts are
integers of minor units like every other amount in `traj`, and `check()` accepts either
scale, so a document in whole baht is schema-valid and wrong by a hundred times. The skill
now states that unit in its Scenario paragraph, which it did not before this run.

### What the skill added

On record and read it added **wording, not arithmetic**: the treatment runs stated the as-of
date and the tax position of every figure, set an external reference on each write, and named
the missing `projection` command from `schema` rather than guessing. The baselines reached the
same numbers and left the tax position implicit. On a CLI that only records and reads, that is
the whole measurable difference, and it is worth saying plainly rather than presenting a tie
as a win.

On Scenario it added a **correct document**, which is the one place these runs separated
baseline from treatment on the result itself.

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
   answer, so `--verify` now compares only the net worth and the period result.
3. The Scenario unit: `skills/traj/SKILL.md` now says its amounts are integer minor units and
   that `check()` will not catch a document a hundred times too small. That is the only change
   to the skill these runs produced.

## Gaps this note does not close

- **`traj schema scenario apply` does not carry `sim-core`'s JSON Schema.** At the pinned
  `v0.1.0` tag the Scenario shape is public only in `src/fixtures/*.ts` and in `check()`'s
  errors; `README.md` there does not describe it. The Spec's *Out of Scope* records the fix as
  a `trajectonomics/cli` follow-up that this Spec **cannot file**, so it is recorded here and
  in [#17](https://github.com/trajectonomics/internal-skills/issues/17) instead. The practical
  effect: an agent can discover the top-level keys and then nested paths by trial, one
  `MISSING_KEY` per dry run, and needs the pinned fixture source for the rest.
- **Projection, FI and tax are absent from v0.1.0**, so the what-if's numbers and the
  retirement question have no answer in the tool. That is
  [trajectonomics/cli#11](https://github.com/trajectonomics/cli/issues/11), and the full run
  is [#17](https://github.com/trajectonomics/internal-skills/issues/17).
- **Codex did not run.** #16 names Claude Code and Codex; Codex is installed on this host but
  not logged in (`codex login status` → `Not logged in`; no `auth.json`, no
  `OPENAI_API_KEY`), and its login is a browser flow that no agent thread can do. Pi was run
  instead, so this ticket is not blocked — that is a substitution for the harness #16 names,
  not an equivalent, and it is recorded rather than quietly swapped. The credential is filed
  for the owner as [infra#41](https://github.com/trajectonomics/infra/issues/41); when
  `codex exec` runs, its pair of runs belongs in both tables above.

## Verdict against ADR 0002

**Partial, and the boundary is the CLI's, not the skill's.** v0.1.0 has no `projection`, no
`fi` and no tax, so the what-if's *numbers* cannot come from the tool and the
financial-independence question has no answer in it. For the part v0.1.0 does support —
record, read, and hold a Scenario document — every harness builds a correct ledger from the
conversation, answers both answerable questions correctly, and the skill carries the
difference on the Scenario document.

The full run, with projection and FI on two harnesses, is
[#17](https://github.com/trajectonomics/internal-skills/issues/17).
