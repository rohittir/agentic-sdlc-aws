# OPERATIONS: deploy to the dev environment

Deploy the service to its dev environment through its GitHub Actions deploy workflow, then report the outcome.

1. Find how this repository deploys to dev: its deploy skill first, then CLAUDE.md, its docs and `.github/workflows/`. Use the workflow, ref and inputs they name. Never deploy to any other environment.
2. Start the workflow with `gh workflow run`.
3. Find the run you started (`gh run list --workflow <file> --limit 5`) and follow it to the end (`gh run watch <id> --exit-status`, or poll `gh run view <id>`).
4. If it fails, read the failed jobs' logs (`gh run view <id> --log-failed`) and explain the cause. Do not change code or re-run the workflow in this task.

Report the run URL, the result, the duration and, on failure, the cause.
