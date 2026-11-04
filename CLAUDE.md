# CLAUDE.md

Project rules live in `AGENTS.md` so every coding agent follows the same instructions. Loaded here in full, with the roadmap and the architecture quick reference:

@AGENTS.md

@ROADMAP.md

@ARCHITECTURE_ESSENTIALS.md

---

## Claude Code specifics

- **Start of every session:** read the Readiness table and Blockers in `ROADMAP.md`, then pick the next task (AGENTS.md §3).
- **End of every task:** update `ROADMAP.md` (task status, phase %, Readiness table, one Update-log line) **before** your final summary. A task without this update is not done (AGENTS.md §0).
- **Plan mode** for anything AGENTS.md §3 calls plan-first. Exit with a plan the human can approve.
- **Ask, don't guess** when a ⛔ pending item or a human decision blocks you: one question, options, your recommendation first.
- **Docs before APIs:** fetch the official docs page before coding against 1Click, NEAR, near-sdk or the wallet selector.
- **Long-running processes** (`pnpm dev`, `pnpm worker`, sandboxes) run in the background.
- **Subagents** only for broad read-only searches; money and contract code stays in the main session.
- **Commits** only when the human asks; one purpose each; the `ROADMAP.md` update goes in the same commit, with `Closes #N` for the task's GitHub issue.
- **GitHub issues** mirror the roadmap one-to-one (AGENTS.md §0.6). Use `gh issue view/comment/close`; never let an issue and `ROADMAP.md` disagree.
- **Don't change product decisions** in `PRD.md` on your own; propose and wait.
- **Final summary:** what changed, how it was tested, what's unverified, and which `ROADMAP.md` tasks moved.
