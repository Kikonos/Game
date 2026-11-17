# v0.25 overnight debug + improvements (player asked 17 Nov 22:50 UTC; hard stop 18 Nov 14:30 UTC = 2:30 pm Lisbon)
Base: branch v025 (= routes2 5dfccc2 = live v0.24.2). Worktrees /home/user/wt/*. Player save: /home/user/work/v025/malteser.json (from fixture v0231-vzh).
Schedule (UTC):
- WF1 HUNT 23:05 -> ~04:30: 8 finders (crew, ops, commercial, network, finance/save/perf, UI walkthrough, immersion, visual) + triage -> /home/user/work/v025/hunt/TRIAGE.json (lanes for WF2)
- WF2 BUILD ~04:30 -> ~10:45: fix/improve lanes from TRIAGE, 2 at a time, branches v025-<lane>, each with hard stop time
- WF3 INTEGRATE+VERIFY+REVIEW+FIX ~10:45 -> ~13:30: merge lanes into v025, full checks, review, fix
- RELEASE window 13:30 -> 14:15 only if player said go (ask in report) — otherwise leave ready. NOTHING runs after 14:30.
Each check-in: if a workflow died (container restart) resume it with resumeFromRunId; if behind schedule, cut scope (drop lowest-priority lanes) rather than overrun.
