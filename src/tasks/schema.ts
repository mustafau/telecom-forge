import { z } from "zod";

export const TaskFileSchema = z
  .object({
    schema_version: z.literal(1),
    id: z.string().regex(/^TF-[0-9]{4,8}$/),
    title: z.string().min(8).max(160),
    task_branch: z.string().min(1).max(200),
    feature_branch: z.string().min(1).max(200),
    spec_file: z.string().min(1).max(200),
    scope: z
      .object({
        writable_repositories: z.array(z.string()).min(1).max(5),
        context_repositories: z.array(z.string()).default([]),
      })
      .strict(),
    requirements: z
      .object({
        implementation_required: z.boolean().default(true),
        require_tests: z.boolean().default(true),
        draft_pull_requests: z.literal(true).default(true),
        documentation_only: z.boolean().default(false),
      })
      .strict(),
    acceptance: z.array(z.string().min(8).max(500)).default([]),
    constraints: z.array(z.string().min(1).max(500)).default([]),
  })
  .strict()
  .superRefine((task, context) => {
    if (!task.task_branch.startsWith("task/")) {
      context.addIssue({
        code: "custom",
        message: 'task_branch must start with "task/" (metarepo task branch).',
        path: ["task_branch"],
      });
    }
    if (!task.feature_branch.startsWith("feature/")) {
      context.addIssue({
        code: "custom",
        message: 'feature_branch must start with "feature/" (publish branch on target repositories).',
        path: ["feature_branch"],
      });
    }
    if (task.task_branch === task.feature_branch) {
      context.addIssue({
        code: "custom",
        message: "task_branch and feature_branch must differ so a self-targeted metarepo publish cannot collide with the task branch.",
        path: ["feature_branch"],
      });
    }
    if (task.requirements.documentation_only) return;
    if (task.acceptance.length === 0 && task.requirements.require_tests) {
      context.addIssue({
        code: "custom",
        message: "A task needs at least one acceptance criterion unless it is documentation-only.",
        path: ["acceptance"],
      });
    }
  });

export type TaskFile = z.infer<typeof TaskFileSchema>;
