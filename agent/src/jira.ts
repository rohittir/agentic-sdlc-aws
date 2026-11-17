import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

type Comment = { author?: { displayName?: string }; created?: string; body?: string };

/**
 * Two JIRA tools bound to one issue, so the agent can read and comment on its own ticket only.
 * shortcut: JIRA REST API v2 with plain-text bodies; move to v3 + ADF if your site retires v2.
 */
export function jiraServer(baseUrl: string, email: string, apiToken: string, key: string) {
  const auth = `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;
  const issueUrl = `${baseUrl.replace(/\/+$/, "")}/rest/api/2/issue/${encodeURIComponent(key)}`;

  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(issueUrl + path, {
      ...init,
      headers: { Authorization: auth, Accept: "application/json", "Content-Type": "application/json" },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`JIRA ${res.status}: ${text.slice(0, 500)}`);
    return text ? JSON.parse(text) : {};
  };
  const ok = (data: unknown) => ({
    content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 1) }],
  });
  const fail = (err: unknown) => ({ ...ok(String(err)), isError: true });

  return createSdkMcpServer({
    name: "jira",
    tools: [
      tool("get_issue", `Read JIRA issue ${key}: summary, type, status, priority, labels, description and all comments.`, {}, async () => {
        try {
          const { fields: f } = await call("?fields=summary,issuetype,status,priority,labels,description,comment");
          return ok({
            key,
            summary: f.summary,
            type: f.issuetype?.name,
            status: f.status?.name,
            priority: f.priority?.name,
            labels: f.labels,
            description: f.description,
            comments: ((f.comment?.comments ?? []) as Comment[]).map((c) => ({
              author: c.author?.displayName,
              created: c.created,
              body: c.body,
            })),
          });
        } catch (err) {
          return fail(err);
        }
      }),
      tool("add_comment", `Add a plain-text comment to JIRA issue ${key}.`, { body: z.string().min(1).max(30000) }, async ({ body }) => {
        try {
          const c = await call("/comment", { method: "POST", body: JSON.stringify({ body }) });
          return ok(`Comment ${c.id} added to ${key}.`);
        } catch (err) {
          return fail(err);
        }
      }),
    ],
  });
}
