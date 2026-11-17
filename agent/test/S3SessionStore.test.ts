import assert from "node:assert/strict";
import { test } from "node:test";
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { S3SessionStore } from "../src/S3SessionStore.js";

/** An in-memory stand-in for the three S3 calls the store makes, listing one key per page to exercise paging. */
function fakeS3() {
  const objects = new Map<string, string>();
  return {
    objects,
    async send(cmd: unknown): Promise<any> {
      if (cmd instanceof PutObjectCommand) objects.set(cmd.input.Key!, String(cmd.input.Body));
      if (cmd instanceof GetObjectCommand) {
        const body = objects.get(cmd.input.Key!)!;
        return { Body: { transformToString: async () => body } };
      }
      if (cmd instanceof ListObjectsV2Command) {
        const keys = [...objects.keys()].filter((k) => k.startsWith(cmd.input.Prefix!)).reverse(); // unsorted on purpose
        const i = Number(cmd.input.ContinuationToken ?? 0);
        return { Contents: keys[i] ? [{ Key: keys[i] }] : [], NextContinuationToken: i + 1 < keys.length ? String(i + 1) : undefined };
      }
    },
  };
}

test("load returns appended entries in order, drops re-delivered uuids, keeps entries without one", async () => {
  const s3 = fakeS3();
  const store = new S3SessionStore(s3, "bucket");
  const key = { projectKey: "-tmp-repo", sessionId: "s1" };
  await store.append(key, [{ type: "user", uuid: "a" }, { type: "user", uuid: "b" }]);
  await store.append(key, [{ type: "user", uuid: "b" }, { type: "summary" }]); // retry re-delivers "b"
  await store.append(key, []);
  await store.append({ ...key, subpath: "subagents/agent-1" }, [{ type: "user", uuid: "z" }]);

  assert.equal(s3.objects.size, 3);
  assert.deepEqual(await store.load(key), [{ type: "user", uuid: "a" }, { type: "user", uuid: "b" }, { type: "summary" }]);
  assert.deepEqual(await store.load({ ...key, subpath: "subagents/agent-1" }), [{ type: "user", uuid: "z" }]);
  assert.equal(await store.load({ ...key, sessionId: "unknown" }), null);
});
