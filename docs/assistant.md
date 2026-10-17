# RAG/MCP developer assistant

An additional terminal Python tool studies the «На сегодня» documentation and the Git context of the same repository. The Android application works independently: it needs neither Python nor a model API.

## Installation and launch in PowerShell

From the repository root, Python 3.12:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-lock.txt
Copy-Item .env.example .env
```

For DeepSeek fill in `.env` (do not commit a real key to Git):

```dotenv
DEEPSEEK_API_KEY=your-key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_TIMEOUT_SECONDS=90
DEEPSEEK_MAX_TOKENS=1024
```

A non-empty `DEEPSEEK_API_KEY` selects DeepSeek, even if OpenAI settings are present. Variables of the current process take priority over `.env`. For OpenAI, leave `DEEPSEEK_API_KEY` empty and set `OPENAI_API_KEY` and `OPENAI_MODEL`.

Launch:

```powershell
.\.venv\Scripts\python.exe -m developer_assistant index
.\.venv\Scripts\python.exe -m developer_assistant mcp-check
.\.venv\Scripts\python.exe -m developer_assistant chat
```

Chat commands: `/help`, `/help How is the project structured?`, `/help What git branch is current?`, `/exit`.

Without an API:

```powershell
.\.venv\Scripts\python.exe -m developer_assistant search "How do I add tasks by voice?"
.\.venv\Scripts\python.exe -m developer_assistant ask "How is the project structured?" --context-only
.\.venv\Scripts\python.exe -m pytest -q -o addopts=
```

The first launch downloads multilingual-e5-small. After the download, if Hugging Face is unreachable you can set `$env:HF_HUB_OFFLINE = "1"`. The three live_api tests are skipped without an API key. With a key they perform real paid requests to the selected provider. Local tests without an API: `python -m pytest -q -o addopts= -m "not live_api"`.

## Data flow

README/docs documents → fragments by section with path and lines → multilingual sentence-transformers embeddings → local Chroma → up to 6 fragments per question → DeepSeek Chat Completions or OpenAI Responses API → Russian answer with path:line sources. Reindexing replaces the snapshot, reuses unchanged embeddings and removes deleted documents.

DeepSeek receives a JSON schema and a format example in the system instruction; the JSON Output is validated locally through Pydantic, then the source IDs are checked. For an answer about the structure, when documents and MCP_FILES are available, references to both groups of sources are mandatory; an answer without them is rejected. An incomplete or truncated answer is not shown as finished: increase `DEEPSEEK_MAX_TOKENS` if 1024 is not enough. Thinking is disabled for short answers. The timeout applies to a single attempt; the SDK allows one request retry.

According to the [official DeepSeek documentation](https://api-docs.deepseek.com/quick_start/pricing/), the name `deepseek-v4-flash` remains a valid legacy alias and is served by the current Flash model; the recommended name is `deepseek-flash`. User settings are not replaced automatically. [JSON Output](https://api-docs.deepseek.com/guides/json_mode/) and [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/) were verified on 15.10.2026.

The MCP SDK launches a separate stdio process. `get_current_branch` and `list_project_files` read the fixed root of this repository through Git with an argument list and a timeout. In the model context, documentation and checkout facts are kept separate. Document text is treated as untrusted data.

## Limitations

On this Windows machine the native HNSW caused a failure, so an exact Chroma buffer persisted in SQLite is used. Search is linear and suitable for a small training corpus. Do not reindex while the chat is running. The index and the model cache are not committed to Git.

The presence of citations and the source ID check do not guarantee the semantic accuracy of the model. The absence of documentation does not prove the absence of a feature. When no key is set, the application does not replace answers with canned text.
