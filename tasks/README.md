# Tasks

A task is a pair of files on a feature branch:

- `tasks/<id>/task.yaml` is validated metadata.
- `tasks/<id>/task.md` is the human specification.

Create one with `pnpm forge init-task --id TF-0002 --branch feature/TF-0002`, edit it, and commit it. `forge validate-task` reads the committed revision, not uncommitted editor buffers.

`TF-0001` is an illustrative sample. It does not target a real GitHub repository until `catalog/workspace.yaml` is changed through review.
