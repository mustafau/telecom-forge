import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { sha256 } from "../lib/hash.js";
import { ForgeError } from "../lib/errors.js";
import { assertHistoryKey, HistoryConflictError, type HistoryStore } from "./storage.js";

export interface ObjectClient {
  put(input: {
    key: string;
    body: Buffer;
    contentType: string;
    ifNoneMatch?: string;
    ifMatch?: string;
    metadata: Record<string, string>;
  }): Promise<{ etag: string }>;
  get(key: string): Promise<{ body: Buffer; metadata: Record<string, string> }>;
  head(key: string): Promise<{ etag: string; metadata: Record<string, string> } | null>;
  list(prefix: string): AsyncIterable<string>;
}

export class S3HistoryStore implements HistoryStore {
  constructor(
    private readonly client: ObjectClient,
    private readonly prefix: string,
  ) {}

  async putImmutable(key: string, content: Buffer, contentType: string): Promise<void> {
    try {
      await this.client.put({
        key: this.full(key),
        body: content,
        contentType,
        ifNoneMatch: "*",
        metadata: { sha256: sha256(content) },
      });
    } catch (error) {
      if (isPrecondition(error)) throw new HistoryConflictError(key);
      throw error;
    }
  }

  async get(key: string): Promise<Buffer> {
    const result = await this.client.get(this.full(key));
    const recorded = result.metadata.sha256;
    if (!recorded || recorded !== sha256(result.body)) {
      throw new Error(`Checksum mismatch for history object ${key}.`);
    }
    return result.body;
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client.head(this.full(key))) !== null;
  }

  async *list(prefix: string): AsyncIterable<string> {
    const fullPrefix = this.full(prefix);
    for await (const key of this.client.list(fullPrefix)) {
      if (key.startsWith(this.prefix)) yield key.slice(this.prefix.length).replace(/^\//, "");
    }
  }

  async putMutableSnapshot(key: string, content: Buffer, expectedVersion?: string): Promise<string> {
    const digest = sha256(content);
    try {
      const result = await this.client.put({
        key: this.full(key),
        body: content,
        contentType: "application/json",
        ...(expectedVersion ? { ifMatch: expectedVersion } : { ifNoneMatch: "*" }),
        metadata: { sha256: digest },
      });
      return result.etag || digest;
    } catch (error) {
      if (isPrecondition(error)) throw new HistoryConflictError(key);
      throw error;
    }
  }

  private full(key: string): string {
    const safe = key.length === 0 ? "" : assertHistoryKey(key.replace(/\/$/, ""));
    return [this.prefix.replace(/\/$/, ""), safe].filter(Boolean).join("/");
  }
}

export function createS3HistoryStore(env: NodeJS.ProcessEnv = process.env): S3HistoryStore {
  const bucket = env.FORGE_HISTORY_BUCKET;
  const prefix = env.FORGE_HISTORY_PREFIX ?? "telecom-forge/v1";
  if (!bucket) {
    throw new ForgeError(
      "HISTORY_NOT_CONFIGURED",
      "FORGE_HISTORY_BUCKET is not set. Refusing to claim durable S3 history. Local mode uses the filesystem store.",
    );
  }
  if (!env.AWS_REGION && !env.AWS_DEFAULT_REGION) {
    throw new ForgeError("HISTORY_NOT_CONFIGURED", "AWS_REGION is required for the S3 history store.");
  }
  return new S3HistoryStore(new AwsObjectClient(bucket, env), prefix);
}

export class AwsObjectClient implements ObjectClient {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    env: NodeJS.ProcessEnv,
  ) {
    const config: S3ClientConfig = { region: env.AWS_REGION ?? env.AWS_DEFAULT_REGION };
    this.client = new S3Client(config);
  }

  async put(input: {
    key: string;
    body: Buffer;
    contentType: string;
    ifNoneMatch?: string;
    ifMatch?: string;
    metadata: Record<string, string>;
  }): Promise<{ etag: string }> {
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        Metadata: input.metadata,
        ...(input.ifNoneMatch ? { IfNoneMatch: input.ifNoneMatch } : {}),
        ...(input.ifMatch ? { IfMatch: input.ifMatch } : {}),
      }),
    );
    return { etag: result.ETag ?? "" };
  }

  async get(key: string): Promise<{ body: Buffer; metadata: Record<string, string> }> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Empty history object ${key}.`);
    return { body: Buffer.from(bytes), metadata: result.Metadata ?? {} };
  }

  async head(key: string): Promise<{ etag: string; metadata: Record<string, string> } | null> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { etag: result.ETag ?? "", metadata: result.Metadata ?? {} };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async *list(prefix: string): AsyncIterable<string> {
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const item of page.Contents ?? []) {
        if (item.Key) yield item.Key;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }
}

function isPrecondition(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  return name === "PreconditionFailed" || name === "ConditionalRequestConflict";
}

function isNotFound(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  return name === "NotFound" || name === "NoSuchKey";
}
