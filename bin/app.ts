import { App } from "aws-cdk-lib";
import { AgentStack } from "../lib/agent-stack";

const app = new App();
const ctx = (key: string): string | undefined => app.node.tryGetContext(key);

const allowedRepos = (ctx("allowedRepos") ?? "").split(",").map((r) => r.trim()).filter(Boolean);
if (allowedRepos.length === 0) {
  throw new Error("Set the repositories the agent may work on: -c allowedRepos=owner/repo[,owner/repo]");
}

new AgentStack(app, ctx("stackName") ?? "AgenticSdlc", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  allowedRepos,
  secretName: ctx("secretName") ?? "agentic-sdlc/config",
  model: ctx("model"),
  maxAttempts: Number(ctx("maxAttempts") ?? 6),
  maxBudgetUsdPerAttempt: Number(ctx("maxBudgetUsd") ?? 20),
  maxRunMs: ctx("maxRunMs") ? Number(ctx("maxRunMs")) : undefined,
});
