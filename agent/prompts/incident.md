# INCIDENT: find the root cause and propose a fix

1. Build the timeline: the alarm and its metric history, error rates and latency around the window below (the last 2 hours if none is given), and the deploys before it (`gh run list`, `git log`, CloudFormation stack events).
2. Read the logs of the affected functions and services in that window with CloudWatch Logs Insights (`aws logs start-query`, then `aws logs get-query-results`), starting from the errors. The skills say where the logs live.
3. Find the root cause and its evidence: the first failing request or error, what changed, the blast radius, and whether it is still happening.
4. If a code or configuration change in this repository fixes it, make it on the work branch with a test, push, and open a pull request into the default branch. If the fix is operational (a rollback, scaling, a setting outside the repository), describe it but do not do it.
5. Write the RCA: summary, timeline, root cause, evidence (queries and log lines, without secrets or personal data), the fix or recommended action, and follow-ups. Post it on the issue with `mcp__jira__add_comment` if a JIRA issue is given, otherwise open a GitHub issue with `gh issue create`.
