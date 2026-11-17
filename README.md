# agentic-sdlc-aws

An event-driven software engineering agent on AWS Lambda. Send it an event naming a service, its GitHub repository and a type of work, and it deploys to dev, fixes a bug, builds or clarifies a feature, or finds the root cause of an incident, finishing with a pull request, a workflow run or a JIRA comment.

It runs the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) in a Lambda container, learns each repository from its `CLAUDE.md` and `.claude/skills/`, and resumes across Lambda's 15-minute limit through Step Functions. See [DESIGN.md](DESIGN.md) for the architecture, the four paths, permissions and risks.

## Prerequisites

- An AWS account bootstrapped for CDK, with Docker on the machine that deploys (the image is built for arm64).
- Node.js 24.
- An Anthropic API key, a GitHub fine-grained personal access token for the target repositories (Contents, Pull requests, Actions and Issues: read and write), and, for `BUG`, `FEATURE` and `INCIDENT` with an issue, a JIRA API token.
- Optionally, skills in each target repository under `.claude/skills/<name>/SKILL.md`, saying how it deploys to dev and where its logs live.

## Deploy

1. Create the secret in the account and region you deploy to:

   ```bash
   aws secretsmanager create-secret --name agentic-sdlc/config --secret-string file://secret.json
   ```

   where `secret.json` holds:

   ```json
   {
     "ANTHROPIC_API_KEY": "...",
     "GITHUB_TOKEN": "...",
     "JIRA_BASE_URL": "https://your-site.atlassian.net",
     "JIRA_EMAIL": "...",
     "JIRA_API_TOKEN": "..."
   }
   ```

   Delete `secret.json` afterwards.

2. Install and deploy:

   ```bash
   npm install && npm install --prefix agent
   ```

   ```bash
   npx cdk deploy -c allowedRepos=acme/orders-api
   ```

   Other settings are in [DESIGN.md, Configuration](DESIGN.md#configuration).

## Send an event

Directly to the state machine (its ARN is the stack output `StateMachineArn`):

```bash
aws stepfunctions start-execution --state-machine-arn <arn> --input file://examples/bug.json
```

Or through EventBridge:

```bash
aws events put-events --entries '[{"EventBusName":"agentic-sdlc","Source":"agentic-sdlc","DetailType":"AgentRequest","Detail":"{\"serviceName\":\"orders-api\",\"repoUrl\":\"https://github.com/acme/orders-api\",\"eventType\":\"BUG\",\"jiraKey\":\"ORD-123\"}"}]'
```

Follow it in the Step Functions console, and the agent's steps in the Lambda's log group. Sample events for each type are in [`examples/`](examples).

## Develop

```bash
npm test
```

```bash
npx tsc -p . && npx cdk synth -c allowedRepos=acme/example
```
