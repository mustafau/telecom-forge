import { z } from "zod";

const Alias = z
  .string()
  .regex(/^[A-Za-z0-9._-]+$/)
  .refine((value) => value !== "." && value !== "..", "Alias is not a directory segment.");

const GithubName = z.string().regex(/^[A-Za-z0-9._-]+$/);

export const RepositorySchema = z
  .object({
    owner: GithubName,
    name: GithubName,
    checkout_path: z.string().min(1),
    default_branch: z.string().regex(/^[A-Za-z0-9._/-]+$/),
    access: z.enum(["read-only", "read-write"]).default("read-only"),
    build_profile: z.string().min(1),
    owned_by: z.string().min(1),
    description: z.string().min(1),
    depends_on: z.array(Alias).default([]),
    allow_submodules: z.boolean().default(false),
    allow_lfs: z.boolean().default(false),
  })
  .strict();

export const WorkspaceFileSchema = z
  .object({
    schema_version: z.literal(1),
    workspace: z
      .object({
        name: z.string().min(1),
        source_directory: z.string().min(1),
        working_directory: z.string().min(1),
        organization: z.string().min(1),
      })
      .strict(),
    harness: z
      .object({
        adapter: z.string().min(1),
        provider_env: z.string().min(1),
        model_env: z.string().min(1),
        max_runtime_minutes: z.number().int().positive().max(180),
        max_attempts_per_task: z.number().int().positive().max(5),
      })
      .strict(),
    policy: z
      .object({
        require_draft_pr: z.boolean(),
        allow_direct_merge: z.literal(false),
        allow_unlisted_repositories: z.literal(false),
        allow_modified_workflows: z.literal(false),
        allow_deployments: z.literal(false),
        max_writable_repositories: z.number().int().positive().max(5),
        max_patch_bytes_per_repository: z.number().int().positive(),
        max_changed_files: z.number().int().positive().default(200),
        max_deletions: z.number().int().nonnegative().default(50),
        fail_on_base_branch_movement: z.boolean(),
        permitted_branch_prefixes: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    history: z
      .object({
        backend: z.enum(["filesystem", "s3"]),
        local_root: z.string().min(1),
        s3_bucket_env: z.string().min(1),
        s3_prefix: z.string().min(1),
        raw_retention_days: z.number().int().positive().max(3650).default(120),
        metadata_retention_days: z.number().int().positive().max(3650).default(400),
      })
      .strict(),
    repositories: z.record(z.string(), RepositorySchema),
  })
  .strict();

export type WorkspaceFile = z.infer<typeof WorkspaceFileSchema>;
export type CatalogRepository = z.infer<typeof RepositorySchema>;

export const BuildCommandSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    argv: z.array(z.string().min(1)).min(1),
    timeout_seconds: z.number().int().positive().max(3600),
    working_directory: z.string().optional(),
    env_allowlist: z.array(z.string().regex(/^[A-Z_][A-Z0-9_]*$/)).default([]),
    max_output_bytes: z.number().int().positive().max(2_000_000).default(200_000),
  })
  .strict();

export const BuildProfilesSchema = z
  .object({
    schema_version: z.literal(1),
    profiles: z.record(
      z.string(),
      z
        .object({
          commands: z.array(BuildCommandSchema),
        })
        .strict(),
    ),
  })
  .strict();

export type BuildProfilesFile = z.infer<typeof BuildProfilesSchema>;
export type BuildCommand = z.infer<typeof BuildCommandSchema>;

export const LocalRemotesSchema = z
  .object({
    schema_version: z.literal(1),
    remotes: z.record(z.string(), z.string().min(1)),
  })
  .strict();

export type LocalRemotesFile = z.infer<typeof LocalRemotesSchema>;
