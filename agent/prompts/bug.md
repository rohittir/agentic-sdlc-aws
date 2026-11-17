# BUG: trace it, find the root cause, fix it, open a pull request

1. Read the issue with `mcp__jira__get_issue`.
2. Trace the bug: the code paths involved, recent commits on them (`git log -p`), and the service's logs and metrics when the issue points to a time, a request or an error (the skills say where they live).
3. Write down the root cause before you change code: what fails, why, since when, and the evidence.
4. Fix the root cause with the smallest change, and add or update a test that fails without the fix.
5. Commit on the work branch, push it, and open a pull request into the default branch with `gh pr create`. Its body: the issue key, the root cause, the fix, the tests you ran and the risks.
6. Comment on the issue with `mcp__jira__add_comment`: the root cause in a few sentences and the pull request link.

If you cannot find the root cause with confidence, do not guess a fix. Comment the evidence and what is missing on the issue, and stop.
