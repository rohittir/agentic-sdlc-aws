import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { S3Client } from "@aws-sdk/client-s3";
import { query, type Options, type SDKMessage, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { branchFor, buildPrompt, parseEvent, resumePrompt, systemPrompt } from "./event.js";
import { jiraServer } from "./jira.js";
import { S3SessionStore } from "./S3SessionStore.js";

const REPO_DIR = "/tmp/repo"; // must stay the same across attempts: the session store keys transcripts by cwd
const CONFIG_DIR = "/tmp/claude";
const SAFETY_MARGIN_MS = 120_000; // time left after the agent stops, to commit, push and return

/** What Step Functions passes in and gets back; the output of one attempt is the input of the next. */
export type State = { event: unknown; attempt?: number; executionName: string; sessionId?: string };
export type Output = State & { attempt: number; status: "DONE" | "CONTINUE" | "FAILED"; summary: string; costUsd?: number };

type Config = {
  ANTHROPIC_API_KEY: string;
  GITHUB_TOKEN: string;
  JIRA_BASE_URL?: string;
  JIRA_EMAIL?: string;
  JIRA_API_TOKEN?: string;
};

let cachedConfig: Config | undefined;
async function loadConfig(): Promise<Config> {
  if (cachedConfig) return cachedConfig;
  const res = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: required("SECRET_ID") }));
  const config = JSON.parse(res.SecretString ?? "{}") as Config;
  if (!config.ANTHROPIC_API_KEY || !config.GITHUB_TOKEN) {
    throw new Error("The secret needs ANTHROPIC_API_KEY and GITHUB_TOKEN");
  }
  return (cachedConfig = config);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export async function handler(input: State, context: { getRemainingTimeInMillis(): number }): Promise<Output> {
  const attempt = (input.attempt ?? 0) + 1;
  const allowedRepos = (process.env.ALLOWED_REPOS ?? "").split(",").map((r) => r.trim()).filter(Boolean);
  const { event, repo } = parseEvent(input.event, allowedRepos);
  const config = await loadConfig();
  const branch = branchFor(event, input.executionName);

  const jiraKey = "jiraKey" in event ? event.jiraKey : undefined;
  if (jiraKey && !(config.JIRA_BASE_URL && config.JIRA_EMAIL && config.JIRA_API_TOKEN)) {
    throw new Error("The event names a JIRA issue but the secret has no JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN");
  }

  const shellEnv = {
    ...process.env,
    HOME: "/tmp",
    GH_TOKEN: config.GITHUB_TOKEN,
    GH_PROMPT_DISABLED: "1",
    GIT_TERMINAL_PROMPT: "0",
    NO_COLOR: "1",
  };
  const sh = (cmd: string, args: string[], cwd = REPO_DIR) =>
    execFileSync(cmd, args, { cwd, env: shellEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

  // A warm container keeps /tmp: start each attempt from a fresh clone and an empty config dir.
  rmSync(REPO_DIR, { recursive: true, force: true });
  rmSync(CONFIG_DIR, { recursive: true, force: true });
  sh("gh", ["auth", "setup-git"], "/tmp");
  sh("git", ["config", "--global", "user.name", process.env.GIT_AUTHOR_NAME || "agentic-sdlc-bot"], "/tmp");
  sh("git", ["config", "--global", "user.email", process.env.GIT_AUTHOR_EMAIL || "agentic-sdlc-bot@users.noreply.github.com"], "/tmp");
  sh("git", ["clone", "--filter=blob:none", `https://github.com/${repo}.git`, REPO_DIR], "/tmp");
  if (branch) {
    const onRemote = sh("git", ["branch", "-r", "--list", `origin/${branch}`]) !== "";
    sh("git", onRemote ? ["checkout", "-B", branch, `origin/${branch}`] : ["checkout", "-b", branch]);
  }

  const abort = new AbortController();
  const maxRunMs = Number(process.env.MAX_RUN_MS) || Infinity;
  const timer = setTimeout(() => abort.abort(), Math.min(context.getRemainingTimeInMillis() - SAFETY_MARGIN_MS, maxRunMs));

  const options: Options = {
    cwd: REPO_DIR,
    model: process.env.AGENT_MODEL || "claude-opus-5-5",
    effort: (process.env.AGENT_EFFORT || "high") as Options["effort"],
    systemPrompt: { type: "preset", preset: "claude_code", append: systemPrompt() },
    settingSources: ["project"], // the target repo's CLAUDE.md, .claude/skills and .claude/settings.json
    skills: "all",
    permissionMode: "dontAsk", // nobody can approve: anything not allowed below is denied
    allowedTools: ["Read", "Edit", "Write", "Glob", "Grep", "Bash", "mcp__jira__get_issue", "mcp__jira__add_comment"],
    disallowedTools: ["WebFetch", "WebSearch"],
    mcpServers: jiraKey
      ? { jira: jiraServer(config.JIRA_BASE_URL!, config.JIRA_EMAIL!, config.JIRA_API_TOKEN!, jiraKey) }
      : {},
    maxTurns: Number(process.env.MAX_TURNS) || 200,
    maxBudgetUsd: Number(process.env.MAX_BUDGET_USD) || 20,
    abortController: abort,
    resume: input.sessionId,
    sessionStore: new S3SessionStore(new S3Client({}), required("SESSION_BUCKET")),
    env: {
      ...shellEnv,
      ANTHROPIC_API_KEY: config.ANTHROPIC_API_KEY,
      CLAUDE_CONFIG_DIR: CONFIG_DIR,
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    },
    stderr: (data) => console.error(data.trimEnd()),
  };

  let sessionId = input.sessionId;
  let result: SDKResultMessage | undefined;
  let error: unknown;
  try {
    const prompt = input.sessionId ? resumePrompt(branch) : buildPrompt(event, repo, branch);
    for await (const message of query({ prompt, options })) {
      log(message);
      if (message.type === "system" && message.subtype === "init") sessionId = message.session_id;
      if (message.type === "result") {
        result = message;
        sessionId = message.session_id;
      }
    }
  } catch (err) {
    error = err; // query() throws after an error result, and on abort
  } finally {
    clearTimeout(timer);
  }

  let status: Output["status"];
  let summary: string;
  if (result?.subtype === "success" && !result.is_error) {
    status = "DONE";
    summary = result.result;
  } else if (abort.signal.aborted || result?.subtype === "error_max_turns") {
    status = "CONTINUE";
    summary = `Attempt ${attempt} stopped at its ${abort.signal.aborted ? "time" : "turn"} limit.`;
  } else {
    status = "FAILED";
    summary = result && result.subtype !== "success" ? `${result.subtype}: ${result.errors.join("; ")}` : String(error ?? result?.result);
  }

  // Never lose work: whatever the outcome, commit what is left and push it to the work branch.
  if (branch) {
    try {
      sh("git", ["add", "-A"]);
      if (sh("git", ["status", "--porcelain"])) {
        sh("git", ["commit", "--no-verify", "-m", `WIP: agent checkpoint, attempt ${attempt}`]);
      }
      if (sh("git", ["rev-list", "--count", "origin/HEAD..HEAD"]) !== "0") {
        sh("git", ["push", "--no-verify", "origin", `HEAD:refs/heads/${branch}`]);
      }
    } catch (err) {
      console.error("Could not push the work branch", err);
      summary += ` (Pushing ${branch} failed: ${(err as Error).message.split("\n")[0]})`;
    }
  }

  console.log("outcome:", JSON.stringify({ status, attempt, sessionId, costUsd: result?.total_cost_usd }));
  return { ...input, attempt, sessionId, status, summary: summary.slice(0, 30_000), costUsd: result?.total_cost_usd };
}

function log(message: SDKMessage): void {
  if (message.type === "assistant") {
    for (const block of message.message.content) {
      if (block.type === "text") console.log("assistant:", block.text.slice(0, 2000));
      else if (block.type === "tool_use") console.log("tool:", block.name, JSON.stringify(block.input).slice(0, 500));
    }
  } else if (message.type === "system") {
    console.log("system:", message.subtype);
  } else if (message.type === "result") {
    console.log("result:", JSON.stringify({ subtype: message.subtype, turns: message.num_turns, costUsd: message.total_cost_usd }));
  }
}
