import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { SessionKey, SessionStore, SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";

/**
 * Mirrors Agent SDK transcripts to S3 so a later Lambda invocation can resume the session.
 * One object per append(); load() lists the parts, sorts them by name and concatenates them.
 * shortcut: no listSubkeys(), so subagent transcripts are stored but not restored on resume.
 */
export class S3SessionStore implements SessionStore {
  private seq = 0;

  constructor(
    private readonly s3: Pick<S3Client, "send">,
    private readonly bucket: string,
    private readonly prefix = "sessions",
  ) {}

  private dir(key: SessionKey): string {
    const sub = key.subpath ? encodeURIComponent(key.subpath) : "_main";
    return `${this.prefix}/${encodeURIComponent(key.projectKey)}/${encodeURIComponent(key.sessionId)}/${sub}/`;
  }

  async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    if (entries.length === 0) return;
    // Zero-padded time, then a per-process counter: names sort in write order across invocations.
    const name = `${String(Date.now()).padStart(15, "0")}-${String(this.seq++).padStart(8, "0")}.jsonl`;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.dir(key) + name,
        Body: entries.map((e) => JSON.stringify(e)).join("\n"),
        ContentType: "application/x-ndjson",
      }),
    );
  }

  async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const page = await this.s3.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: this.dir(key), ContinuationToken: token }),
      );
      for (const o of page.Contents ?? []) if (o.Key) keys.push(o.Key);
      token = page.NextContinuationToken;
    } while (token);
    if (keys.length === 0) return null;

    keys.sort();
    const bodies = await Promise.all(
      keys.map(async (k) => {
        const obj = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: k }));
        return (await obj.Body?.transformToString()) ?? "";
      }),
    );

    // The SDK may re-deliver a batch after a retry: keep the first copy of each uuid, and every entry without one.
    const seen = new Set<string>();
    const out: SessionStoreEntry[] = [];
    for (const line of bodies.join("\n").split("\n")) {
      if (!line) continue;
      const entry = JSON.parse(line) as SessionStoreEntry;
      if (entry.uuid) {
        if (seen.has(entry.uuid)) continue;
        seen.add(entry.uuid);
      }
      out.push(entry);
    }
    return out;
  }
}
