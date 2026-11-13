# AGENTS.md

Instructions for AI coding agents in `trajectonomics/internal-skills`.

## Rules

1. Model & Pi (`pi.dev`) rules:
   - Never use `gemini-3.8-flash` anywhere; use `gemini-4-hydrogen` instead for Antigravity tasks and reviews (and `gemini-4-argon` where configured).
   - When running the Pi coding agent (`pi.dev`), strictly use **DeepSeek 4.1 Flash** only (e.g., `deepseek/deepseek-v4.1-flash`, `deepseek/deepseek-v4.1-flash-fast`), whether routed via Command Code GOAT (`command-code`) or OpenCode Go (`opencode`). Do not switch to or run any other models (Claude, GPT, Gemini, etc.) in Pi sessions for this repository. This rule is mechanically enforced via `.pi/settings.json`.
2. Temporary files and scratch clones: `/tmp` is a shared, nearly full tmpfs. Never use fixed `/tmp` filenames (use `mktemp` and clean up, or `--body-file -` for `gh` bodies) and never install `node_modules` or clone scratch repos under `/tmp`; use `~/.cache/<slug>` (except ephemeral `mktemp` directories cleaned up by `trap`, as in `scripts/reproduce-cli-findings.sh`).

## Organisation goals

The organisation's goals are in https://github.com/trajectonomics/goals, `GOALS.md`. Read them before proposing a new direction. Only the owner edits that file; never edit it.

## Owner

- Save the owner's attention: finish everything agents can handle end-to-end (commit, push, PR, independent review, `gh pr merge` when green/told to proceed, follow-up steps) without stopping for small permission questions or handing back a `## Not done yet` list.
- When unsure, consult subagents on other models (`claude-sonnet-5-5`, `gemini-4-hydrogen`, `gemini-4-argon`, `deepseek-v4.1-flash`) via T3 Code `delegate_task` (outside Pi sessions; inside Pi sessions, stay on DeepSeek 4.1 Flash) instead of asking the owner; escalate to the owner only for genuinely important, hard-to-reverse, product/policy, or human-only (accounts, credentials, browser/UI) decisions.
- Verify live GitHub state (`gh issue view`, `gh pr view`) and CLI/API schemas before claiming something is blocked or unsupported.
- Keep owner replies short and lead with what only the owner must do.
- Record durable lessons in repo instructions rather than agent memory.
- Settle your own T3 thread (`t3_thread_organize`, `action: "settle"`) when done and nothing waits on the owner.

## Factory Runs

A Factory Run or Spec drafter (a thread titled `traj/trajectonomics/<repo>#<n>` or `triage/trajectonomics/<repo>#<n>`) takes its instructions from the Dispatcher runbook in `trajectonomics/factory`, never from this repository, where `docs/dispatcher-runbook.md` does not exist. Read it with `gh api repos/trajectonomics/factory/contents/docs/dispatcher-runbook.md -H "Accept: application/vnd.github.raw"`. If you cannot read it, stop and say so; do not build from the issue alone.
