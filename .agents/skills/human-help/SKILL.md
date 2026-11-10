---
name: human-help
description: "Remind the owner how to act on Ideas: the verbs, an example of each, and the current queue. Usage: /human-help"
disable-model-invocation: true
---

# Human help

The owner forgot how to act on Ideas. Show the verbs and the queue. Change nothing.

1. **Print the verbs**, one line each, with an example:

   | Skill | Comment form | Does |
   | --- | --- | --- |
   | `/human-go sim-core#12` | first line `go` | send the Idea to the Spec drafter (`needs-triage`) |
   | `/human-decline sim-core#12 duplicate of #4` | first line `decline <reason>` | `wontfix`, close, keep on record |
   | `/human-postpone sim-core#12 30d` | first line `postpone 30d` or `postpone 2027-02-01` | `idea-postponed`, revisit on the date (90 days if none) |

   A comment is applied by the next Dispatcher pass (up to 6 hours); a skill applies it at once. You never set labels by hand.
2. **Show the queue** with `gh search issues --owner trajectonomics --state open --label <label> --json repository,number,title,url` for `idea-for-human` (read these first, the screener left context), `idea` (not yet screened) and `idea-postponed` (with the latest `revisit:` date from the issue's comments). Print counts and one line per issue. Report the idea count (`idea` plus `idea-for-human`) against the limits: 12 raises Ideas to the priority of other `needs-triage` issues, 24 stops the finder.
3. **Point to the rules**: "Owner words" and "Idea lifecycle" in `docs/next-steps-runbook.md` of `trajectonomics/factory` (`gh api repos/trajectonomics/factory/contents/docs/next-steps-runbook.md -H "Accept: application/vnd.github.raw+json"`). If the owner asks what an Idea is, read `GLOSSARY.md` in that repository.
