# Agent Entry

1. Read `.agent/project.yaml` and only the rule cards relevant to the task.
2. Run the repository's governance `detect` command before planning.
3. Record one primary goal, measurable outcomes, non-goals, assumptions and allowed paths in `.agent/ledger/`.
4. Treat the initial task tier as a prediction. Run the Diff gate before completion and obey the Effective Tier.
5. Do not modify frozen paths, expand scope silently, add dependencies without justification, or perform T3 work without consequence confirmation.
6. Run the verification commands required by the Effective Tier. Code written without passing evidence is not complete.

7. Use `aeg files init --id TASK_ID` for disposable task files. Back up original files with `aeg files backup`, reuse equal-content snapshots, and never recursively back up backups. Move deliverables out of scratch or keep evidence with a reason. Session completion cleans scratch automatically; lightweight tasks use `aeg files complete --id TASK_ID --write`. Historical leftovers are inventory-only.
