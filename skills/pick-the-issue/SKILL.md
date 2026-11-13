---
name: pick-the-issue
description: Pick the next open, unblocked issue for the current repository that is not currently handled by any active T3 Code session, summarize it, and provide Matt Pocock skill routing and execution commands.
disable-model-invocation: true
---

# Pick The Issue

Pick the next highest-leverage, unblocked GitHub issue in the current repository that has no active T3 Code session working on it, provide a concise executive summary, and route it through Matt Pocock's skills framework (`ask-matt`) to advise on the exact commands and workflow.

## Overview

When choosing the next task, agents should not pick issues blindly or pick issues that:
1. Are already being worked on in another T3 Code session (wasting parallel effort).
2. Are blocked by open dependencies or upstream issues.
3. Lack necessary domain grounding or groom decisions.

This skill inspects open issues in the current repository only, resolves dependency graphs, excludes in-flight T3 Code threads, and routes the winning issue into the right Matt Pocock engineering flow.

The organisation's goals are in https://github.com/trajectonomics/goals, `GOALS.md`. Read them before proposing a new direction. Only the owner edits that file; never edit it.

## How to Run

### Option 1: Automated Script Execution (Fastest & Deterministic)

Run the included automated resolver script:

```bash
# In the current repo:
python3 <skill-dir>/scripts/pick_issue.py

# As structured JSON (for agent parsing):
python3 <skill-dir>/scripts/pick_issue.py --json
```

The script automatically:
1. Detects the current repository from git remote.
2. Queries GitHub CLI (`gh issue list`, `gh issue view`) for open issues in the current repository only.
3. Checks GitHub native `blocked-by` metadata and body dependency patterns (verifying whether blocker issues are closed or open).
4. Reads active runs and thread titles from T3 Code (`statev2.sqlite` / thread list) to exclude issues actively in-flight.
5. Ranks ready issues by dependency leverage (issues that unblock others first) and FIFO order.
6. Runs the issue through Matt Pocock's `ask-matt` router.

### Option 2: Step-by-Step Agent Protocol

If running manually or in an environment without direct script execution:

1. **List Active T3 Code Sessions**:
   - Check `t3_thread_list` with `{"allProjects": true, "limit": 20}`.
   - Note down thread titles and running tasks (e.g. `Deterministic Event Projection Engine`, `US 2026 State Income Tax Engine`, `Implement Issue 12`).
   - Any open issue matching an active thread title or issue number in the current repository is marked **HANDLED** and skipped.

2. **List Open Issues**:
   - Run `gh issue list --state open --json number,title,labels,body` in the current repository.

3. **Check Blockers**:
   - For candidate issues, inspect `gh issue view <number>`.
   - Check `blocked-by:` and body text for `Blocked by #...`.
   - If the blocking issue is still OPEN, mark candidate as **BLOCKED** and skip.

4. **Select Candidate**:
   - Filter down to `is_open == true`, `is_blocked == false`, `is_handled == false`.
   - Prioritize issues that unblock other downstream issues (`blocking:` list), or issues labeled `ready-for-agent`.

5. **Route Through `ask-matt`**:
   - Map the candidate issue to the appropriate Matt Pocock engineering skill:
     - **Bug / Flake / Regression**:
       - Primary Skill: `/diagnosing-bugs`
       - Flow: Reproduce with tight feedback loop first (`diagnosing-bugs`), then `/tdd`, then `/retro`.
     - **Greenfield / Foggy Architectural Scope**:
       - Primary Skill: `/wayfinder`
       - Flow: Chart map of decision tickets, resolve decisions on issue tracker, merge to `/to-spec`.
     - **Codebase Health / Modular Deepening**:
       - Primary Skill: `/improve-codebase-architecture`
       - Flow: Identify seams, design interfaces with `/codebase-design`, implement with `/tdd`.
     - **Groomed / Ready Tracer-Bullet Ticket**:
       - Primary Skill: `/implement`
       - Flow: Open fresh session in repo, execute `/implement` test-first (`/tdd`), review with `/code-review`, create pull request with `/pr`.
     - **Unrefined Feature / Needs Grooming**:
       - Primary Skill: `/grill-with-docs`
       - Flow: Stateful interview to update `GLOSSARY.md` and ADRs before writing code.

## Output Format

Present the decision cleanly to the user:

1. **Repository & Issue Header**:
   - Repo: `org/repo`
   - Issue: `#<number> - <title>`
   - URL: `https://github.com/...`
   - Dependencies Unblocked: List downstream tickets enabled by this work.

2. **Executive Summary**:
   - Clear statement of Goal and key Scope items.

3. **Routing via `ask-matt`**:
   - Flow Name (e.g., `Main Flow: Ready Implementation`).
   - Primary Skill (e.g., `/implement`).
   - Skill Sequence (e.g., `/implement → /tdd → /code-review → /pr`).
   - Rationale explaining why this skill fits.

4. **Recommended Next Steps & Launch Command**:
   - Exact directory to navigate to.
   - Slash command or thread launch prompt to start work.
