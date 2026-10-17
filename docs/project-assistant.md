# Local file assistant

The `project-assistant/` package is independent of `support/` and of the Python review. It uses the existing DeepSeek settings, TypeScript/Zod, MCP SDK 2.3.1 and a source format with paths, lines and hashes. The single-step support client was not changed: the local adapter supports native tool calls, a history of tool responses and a separate final schema. Thinking is disabled and reasoning_content is discarded.

The CLI starts `project-files` as a child process through `StdioClientTransport`; the server uses `McpServer` and `StdioServerTransport`. The exchange goes initialization → tools/list → tools/call. Closing the client terminates the server. The server's stdout is reserved for MCP; environment secrets are not passed to it.

## CLI commands

In PowerShell from the project root: `.\pa task "Goal"`, `.\pa runs`, `.\pa diff RUN_ID`, `.\pa apply RUN_ID`. The `pa.cmd` wrapper calls the built Node.js CLI and preserves the exit code; the PowerShell script execution policy does not get in its way. Installation and build: `npm.cmd ci --prefix project-assistant`. For a name without `.\` in the current session: `Set-Alias pa "$PWD\pa.cmd"`. On Linux/macOS the same subcommands are accepted by `node project-assistant/dist/cli.js`.

By default the repository is the current folder; `--repo PATH` selects another one. `.\pa config --env-file PATH` stores only the absolute path in `<repo>/.assistant/cli.json`. The path to the settings file is resolved relative to the current terminal folder. The key is not copied; the configuration is unavailable to MCP and is excluded from Git together with `.assistant/`. `.\pa config` shows the saved path. When `task` runs, an explicit `--env-file` replaces the saved path; `DEEPSEEK_API_KEY` and `DEEPSEEK_MODEL` values from the environment take priority over the file. The configuration of one root is not inherited by another.

`runs` shows the statuses of **proposals** from the manifest (`staged`, `applying`, `partial`, `applied`) and the number of files, not an assessment of research completeness; the analysis result is in report.md/result.json. Up to 200 runs by name; corrupted manifests are flagged with a separate error. The view and apply commands do not need an LLM key. `diff` refreshes the saved changes.patch from the manifest without modifying documents. `apply` always requires an explicit ID and never picks the last run automatically. The previous interface `--task GOAL`, `--repo PATH`, `apply --run ID` is preserved.

## Tools

| Name | Input and result |
|---|---|
| list_files | `directory?`, `extensions?`, `offset=0`, `limit=100`; relative paths, next_offset, truncated, exclusion scope |
| search_text | `query`, the same filters/pagination, `context_lines=1` (0–3); literal matches, paths, lines, context, scanned/skipped/truncated |
| read_file | `path`, `start_line=1`, `end_line?`; numbered lines, SHA-256 of the full source bytes, next_line, total_lines |
| stage_file_change | `path`, `expected_hash` (null for creation), full `content`, `explanation`, `sources`; staging without writing to the working copy |
| preview_changes | `{}`; affected files and a unified diff; when truncated, the full patch remains on disk |

Paths use `/` and contain no `..`, absolute/UNC/drive paths, backslashes, control characters, Windows ADS or reserved names. Errors have a stable code and a safe message. Search is implemented with Node facilities; there is no shell.

Before a change, the document must be read in full, including the last line; continue via next_line. Proposal sources must match the ranges actually read and the current hashes. Final references are verified by the application, and the original hashes are re-checked through MCP. This verifies the provenance of citations, not the truth of every model conclusion.

## Access policy

Nested `.gitignore` files and the root `.assistantignore` are taken into account. Mandatory prohibitions take priority over user exceptions: `.git`, `.assistant`, dependencies, virtualenv, builds/caches, keys, `.env*`, `.dev.vars*`, credentials, secrets/tokens/passwords files and authorization configurations. Allowed extensions are read as UTF-8; NUL, invalid UTF-8 and signs of known secrets lead to a refusal. The content check is a heuristic, not a universal detector of all secrets; additional sensitive paths must be excluded explicitly.

All symlinks/junctions are rejected, even if the target is inside the root. Before writing, parent components, hardlinks and the current content are re-checked. This is a local tool for a developer's work tree, not an OS sandbox against a hostile concurrent process.

Modifiable types: the README and `.md`, `.markdown`, `.txt`, `.rst`, `.adoc` inside documentation directories. AGENTS.md, the assistant configuration and code cannot be changed, and files cannot be deleted. The set of directories is defined by a human in the root `.assistant-config.json`:

```json
{ "documentationDirectories": ["manual", "support/docs"] }
```

`docs/` and `knowledge/` are always allowed; the secret and file-type restrictions remain. The configuration is not executed.

At startup the application records the available AGENTS.md files, and their scope and SHA-256 are stored in project-rules.json. Rules are passed separately from the text of the investigated files, apply only to their own subtree and cannot widen access or confirm application. Comments, README files and search results remain data. It cannot be guaranteed that the LLM will always follow a natural-language instruction; file operation restrictions are enforced by the server code.

## Limits and stopping

Up to 40 tool calls / 40 model turns, 10 minutes per run, 60 seconds per LLM request, 10 seconds per MCP call. One retry is allowed on a network error and HTTP 429/5xx. A third identical call with an unchanged result stops the loop.

A file up to 256 KiB; a tool result up to 24 KiB; total result volume up to 256 KiB. Traversal of up to 20 000 directory entries, total search scanning up to 32 MiB. A line that does not fit into the limited read result is rejected explicitly. AGENTS.md rules up to 6000 bytes in total. Staging: up to 10 documents, 512 KiB of new content. All truncations and stop reasons are reflected in the artifacts; a partial result is not considered a completed investigation.

## Storage and application

`.assistant/runs/RUN_ID/` contains task.json, events.jsonl, manifest.json, project-rules.json, changes.patch, report.md and result.json; after application apply-result.json is added. The manifest stores the original/new text, hashes, explanation, references and the status of each proposal. It is bound to the canonical repository root. A run folder cannot simply be moved to another root and applied without a new investigation.

Apply performs a common pre-check of all documents, then writes adjacent temporary files, synchronizes them and replaces the targets. Creation uses an operation that will not overwrite a file that appeared. The write of each document is logged; after a partial failure the next apply checks the new hashes already written and continues with the remaining proposals. Restoring the original versions is possible from the manifest; there is no automatic rollback.

If the process is interrupted, apply.lock may remain. Before deleting it manually, make sure the applying process no longer exists. Actions of several independent processes on the same files do not form a transaction.

For v1 file search is sufficient. D1 FTS5 support and the Python commit-based review index are not used as the current file version. Source code is not added to the support index.

## Verification

The automated tests use a mock LLM and a real MCP stdio. The live check is a separate, explicitly launched command with a real key. The fixture includes a real executable TypeScript route, validation and handler; only the documentation is outdated. In the live demo only a temporary copy of the fixture is used, and production proposals remain staged. CI without an API key runs the checks on Windows and Linux, and the preserved support workflow verifies day 33 and the day 32 Python regression.
