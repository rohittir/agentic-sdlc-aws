# FEATURE: clarify it or build it

1. Read the issue and all its comments with `mcp__jira__get_issue`. Answers to questions asked earlier are in the comments.
2. Read the code it touches and the repository's conventions (CLAUDE.md, skills, docs).
3. Decide whether it is clear enough to build: the expected behaviour, the scope and the acceptance criteria are stated, or follow from the code and docs with little risk.
   - If not, post your questions with `mcp__jira__add_comment`: numbered, each answerable in a line, each with the default you would choose. Then stop, and start your report with `WAITING:`.
   - If so, build it.
4. Implement it on the work branch following the repository's patterns, with tests. Change only what the issue asks for.
5. Push and open a pull request into the default branch with `gh pr create`: the issue key, what changed, how it was tested, and open points.
6. Comment the pull request link and a two-line summary on the issue.
