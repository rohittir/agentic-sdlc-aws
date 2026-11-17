import assert from "node:assert/strict";
import { test } from "node:test";
import { branchFor, buildPrompt, parseEvent } from "../src/event.js";

const allowed = ["acme/orders-api"];
const base = { serviceName: "orders-api", repoUrl: "https://github.com/acme/orders-api" };

test("accepts each event type and picks its prompt", () => {
  const cases: Array<[unknown, string]> = [
    [{ ...base, eventType: "OPERATIONS" }, "# OPERATIONS"],
    [{ ...base, eventType: "BUG", jiraKey: "ORD-1" }, "# BUG"],
    [{ ...base, eventType: "FEATURE", jiraKey: "ORD-2" }, "# FEATURE"],
    [{ ...base, eventType: "INCIDENT", incident: { description: "5xx spike", startTime: "2026-11-16T10:00:00Z" } }, "# INCIDENT"],
  ];
  for (const [input, heading] of cases) {
    const { event, repo } = parseEvent(input, allowed);
    assert.equal(repo, "acme/orders-api");
    const prompt = buildPrompt(event, repo, branchFor(event, "exec-1"));
    assert.ok(prompt.startsWith(heading), `${heading} prompt`);
    assert.match(prompt, /- Repository: acme\/orders-api/);
  }
});

test("BUG and FEATURE need a JIRA key, INCIDENT needs incident details", () => {
  assert.throws(() => parseEvent({ ...base, eventType: "BUG" }, allowed));
  assert.throws(() => parseEvent({ ...base, eventType: "FEATURE", jiraKey: "not a key" }, allowed));
  assert.throws(() => parseEvent({ ...base, eventType: "INCIDENT" }, allowed));
  assert.throws(() => parseEvent({ ...base, eventType: "DEPLOY" }, allowed));
});

test("rejects repositories outside the allowlist and non-GitHub URLs", () => {
  assert.throws(() => parseEvent({ ...base, repoUrl: "https://github.com/evil/repo", eventType: "OPERATIONS" }, allowed), /ALLOWED_REPOS/);
  assert.throws(() => parseEvent({ ...base, repoUrl: "https://gitlab.com/acme/orders-api", eventType: "OPERATIONS" }, allowed));
  assert.throws(() => parseEvent({ ...base, eventType: "OPERATIONS" }, []), /ALLOWED_REPOS/);
});

test("accepts a .git suffix and any letter case", () => {
  const { repo } = parseEvent({ ...base, repoUrl: "https://github.com/Acme/Orders-API.git", eventType: "OPERATIONS" }, allowed);
  assert.equal(repo, "Acme/Orders-API");
});

test("rejects refs that git would read as an option or a path escape", () => {
  for (const ref of ["--upload-pack=touch /tmp/x", "a/../b", "-b"]) {
    assert.throws(() => parseEvent({ ...base, eventType: "OPERATIONS", ref }, allowed), ref);
  }
  assert.equal(parseEvent({ ...base, eventType: "OPERATIONS", ref: "release/1.2" }, allowed).event.eventType, "OPERATIONS");
});

test("work branch per issue, per execution without one, none for OPERATIONS", () => {
  const bug = parseEvent({ ...base, eventType: "BUG", jiraKey: "ORD-12" }, allowed).event;
  const incident = parseEvent({ ...base, eventType: "INCIDENT", incident: { description: "x" } }, allowed).event;
  const ops = parseEvent({ ...base, eventType: "OPERATIONS" }, allowed).event;
  assert.equal(branchFor(bug, "exec-1"), "agent/ord-12");
  assert.equal(branchFor(incident, "Exec_1:abc"), "agent/exec-1-abc");
  assert.equal(branchFor(ops, "exec-1"), undefined);
});
