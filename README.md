# Day 34 — assistant for working with project files

The local CLI takes a goal, chooses search and reading on its own through a real MCP stdio connection, reconciles current files and stores a report or proposed changes. Documentation is written by a separate user command after reviewing the diff. The day 33 client chat works separately and has no access to the file system.

```text
goal → DeepSeek → MCP project-files → files → report / staging → diff → apply
```

The base is the current working copy of day 33 with its Git history, including profiles, the operator panel and LLM logs. The original day 33 folder was not modified. The day 32 Python review and the Cloudflare configurations are preserved; no publication is required for day 34.

## Installation and launch

Node.js 22.12+ and npm are required; CI uses Node 24. From the root of this project:

```powershell
npm.cmd ci --prefix project-assistant
Copy-Item project-assistant/.env.example project-assistant/.env
```

Fill in `DEEPSEEK_API_KEY` in `project-assistant/.env`; store your model in `DEEPSEEK_MODEL` (the project default is `deepseek-v4-flash`). The file is ignored by Git and unavailable to the file tools. Save the settings path once:

```powershell
.\pa config --env-file project-assistant/.env
```

If the key is already configured in day 33, you can use the existing file instead of creating `.env`:

```powershell
.\pa config --env-file ..\advent-day-33-support-assistant\support\.dev.vars
```

Only the absolute path is stored, in the local `.assistant/cli.json`, without copying the key. `task` uses it automatically; an explicit `--env-file PATH` overrides the saved path. Environment variables take priority over the file contents. The API key is not passed to the MCP server. Authorized fragments of the project that were read are sent to DeepSeek.

`pa.cmd` is located in the project root and is run in PowerShell as `.\pa`, without installing a global command and without changing ExecutionPolicy. To get commands exactly like Git's, set an alias for the current PowerShell session:

```powershell
Set-Alias pa "$PWD\pa.cmd"
pa help
```

The root of the investigated project is the current folder by default. For another project add `--repo PATH`; the saved configuration and runs belong to the chosen root. The path in `config --env-file` is resolved from the current terminal folder.

| Command | Action |
|---|---|
| `.\pa task "Goal"` | Investigate the project and prepare a report or changes |
| `.\pa runs` | Show run IDs, proposal statuses and number of files |
| `.\pa diff RUN_ID` | Show the full prepared diff |
| `.\pa apply RUN_ID` | Apply the specified proposal with hash verification |
| `.\pa config` | Show the saved path to the LLM settings |
| `.\pa help` | Help |

On Linux/macOS use `node project-assistant/dist/cli.js` instead of `.\pa`. The older commands `npm.cmd run project-assistant -- --repo . --task "Goal"` and `apply --run ID` are also supported.

**A. Finding where a component is used:**

```powershell
.\pa task "Find how the application obtains ticket context through MCP. Show the calls, configuration, error handling and related tests." --run demo-mcp
```

**B. Reconciling documentation:**

```powershell
.\pa task "Reconcile the chat API documentation with the current handlers and schemas. Prepare a fix for the discrepancies found." --run demo-docs
```

Goals do not specify a list of files. If the real documentation is correct, the assistant must say so. A separate fixture `project-assistant/fixtures/chat-api` contains checkable discrepancies between documentation and the route, schema and handler; production code was not damaged for the demonstration.

The report, action log, original versions, manifest and full unified diff are stored in `<repo>/.assistant/runs/<run>/`. Without `--run` a unique ID is generated; an existing run is never overwritten. After reviewing `report.md` and `changes.patch`:

```powershell
.\pa runs
.\pa diff demo-docs
.\pa apply demo-docs
```

The apply command is the user's confirmation. The model cannot call it. The CLI re-checks the paths and original hashes of all proposals before the first write. On a conflict nothing is written; on a failure during writing it lists the files that were applied. Applying again returns `already_applied` or a conflict. Commit, push, MR and deploy are not performed automatically.

## Checks

```powershell
npm.cmd --prefix project-assistant run check
npm.cmd --prefix project-assistant test
.\pa help
```

In the automated tests the LLM is replaced by a mock model; the MCP client and the separate server are real. The explicit live check below performs paid DeepSeek requests: it investigates the real project, reconciles documentation and fixes a temporary copy of the fixture with verification of repeated application. Proposals for the real project remain staged.

```powershell
npm.cmd --prefix project-assistant run demo:live -- --repo .. --env-file .env
```

Here `--repo ..` and `.env` are resolved from `project-assistant`, as the working folder of the npm script. Live results are located in `.assistant/verification/`. Results of the last verified run: [day 34 report](docs/day34-verification.md).

## Access and reproducibility

Reading is limited to the root, `.gitignore`, `.assistantignore` and the mandatory exclusions of secrets, binary files, dependencies and builds. Symlinks and junctions are rejected entirely; hardlinks cannot be modified. Writing is allowed only to the README and documents in `docs/`, `knowledge/` or explicitly configured directories. Source code is available for analysis only. The model has no shell, no file deletion and no test runs.

The goal, time, model, commit SHA, dirty status, sequence of calls, hashes and read ranges, original/new versions and the apply result are stored. Hidden reasoning and API keys are not stored. What is reproducible is the stored proposal against the same original version, not a repeated LLM text. A multi-file write is not one atomic transaction; deliberate concurrent file replacement by OS means is outside the guarantees.

Details on tools, limits, project rules and additional directories: [local assistant](docs/project-assistant.md).

---

# Day 33 — AI user support assistant

**Published chat:** https://day33-support-web.advent-day-18-scheduled-mcp.workers.dev

**Operator panel:** https://day33-support-web.advent-day-18-scheduled-mcp.workers.dev/operator — client names/IDs, profiles, history and LLM log. A separate password is required; [access setup](support/README.md#профиль-клиента-панель-оператора-и-журнал-llm). The client chat has an editable profile and a log of the user's own conversation.

The support service for the Daily Tasks training product is located in **`support/`**. It uses React, Cloudflare Workers, D1, a real MCP Streamable HTTP and DeepSeek. RAG looks up real instructions in `knowledge/support/` through D1 FTS5; no additional embeddings API is required. The conversation and sources are stored, and an unresolved request can be marked as requiring a specialist.

- [Setup, launch, indexing and deployment](support/README.md)
- [Verification results and limitations](support/VERIFICATION.md)
- [Training product knowledge base](knowledge/support/product.md)

The base is day 32, commit `1e647b509127aae7719e1d6fa8315936cfc93a42`. The Python RAG/MCP, the code review tools, their tests and the workflows `.github/workflows/ai-review.yml` / `review-request.yml` are preserved. [Developer assistant documentation](docs/assistant.md).

Daily Tasks is a training support subject with email authorization. Below is the preserved documentation of the original Android application «На сегодня», which works without registration; these are different products.

---

# На сегодня

A calm daily planner for Android: tasks for the selected date, voice input and an evening review. It works without registration and without its own server.

**This folder is the root of the Android project and of the Git repository.** Open it in Android Studio: `app/`, `gradle/`, `gradlew.bat` are located directly here. The old nested glab project no longer exists.

## What is implemented

- Adding and editing tasks, completing and uncompleting them.
- The selected day, navigation back/forward, a calendar of past and future days, returning to today's date.
- A counter of completed tasks, a collapsible list of completed tasks, an empty state.
- Moving an existing task to another date without copying. Deletion with undo through a Snackbar.
- Voice dictation through SpeechRecognizer with a preview and confirmation of the list.
- Evening review of a specific date: complete, move to tomorrow relative to the review date, choose another date, delete. Each decision is saved immediately.
- An inexact daily reminder, disabled by default; the time is 22:00. Opening the review from the notification and returning to the task list.
- Local Room and DataStore, Russian UI, light and dark themes.

## Opening and building

Android Studio with AGP 9.2.1 support, JDK 17+ (JDK 17 is used to compile Kotlin), Android SDK Platform 36 and Build Tools 36.0.0 are required. The minimum device version is Android 8.0 / API 26; target/compile SDK is 36. The Gradle Wrapper is included.

Specify the SDK path in `local.properties` (Android Studio creates the file automatically). For the current machine:

```properties
sdk.dir=D:/AndroidSDK
```

PowerShell commands from this folder:

```powershell
.\gradlew.bat :app:assembleDebug
.\gradlew.bat :app:testDebugUnitTest :app:lintDebug
.\gradlew.bat :app:connectedDebugAndroidTest
```

APK: **`app/build/outputs/apk/debug/app-debug.apk`**.

The last command requires a connected device or emulator and runs the tests with clearing of the data of the application under test. Use a separate test emulator. Pixel_10 / Android 16 is used on the current machine.

If the global Gradle configuration limits Metaspace, the verified command is:

```powershell
.\gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:connectedDebugAndroidTest --console=plain "-Dorg.gradle.jvmargs=-Xmx3g -XX:MaxMetaspaceSize=1536m -Dfile.encoding=UTF-8"
```

## How to use

Tap the date to open the calendar, then tap the required day — the calendar closes immediately and shows that day's entries, without additional confirmation. Completed tasks are available in an expandable list. The arrow buttons open adjacent days, «Сегодня» returns to the current calendar date. Add a task with the «Добавить задачу» button. Tap the title to change it; the task menu contains move and delete. When moving, choose a date and tap «Сохранить» to confirm. After deletion the «Отменить» button is available in the Snackbar.

The «Подвести итоги дня» screen shows incomplete tasks of the selected date. The «На завтра» button contains the resulting move date. Tasks are not moved automatically. The completed counter is the current number of completed tasks scheduled for that day. The move counter belongs to the current review session and starts again when the screen is reopened.

History shows the current state of the entries, not a full log of moves. A moved task disappears from the original day and is not counted as completed.

## Voice input

Open «Голосом» → «Начать диктовку», allow microphone access. Say **«новая задача»** between tasks:

> Купить продукты новая задача закончить отчёт новая задача позвонить маме

Conjunctions and commas do not split tasks. Before confirmation you can correct the recognized text, split it again, change individual tasks, add/remove a row, merge with the next one or split manually with a line break. Splitting the source text again replaces the list edits. Empty tasks cannot be saved.

Recognition depends on the device service. It may require a network and send audio to the recognition provider. The app does not store audio recordings and does not guarantee offline recognition. If access is denied, the service is missing or an error occurs, text input can be used instead.

## How to check notifications

1. In «Настройках» enable the evening reminder and allow POST_NOTIFICATIONS on Android 13+.
2. Set the nearest future time. Make sure notifications and the «Вечерний разбор» channel are allowed in Android.
3. Wait for the notification «Как прошёл день? / Отметь выполненные дела». It arrives **approximately**, not exactly on the minute.
4. Tapping it opens the review of the date for which the alarm was scheduled; «Назад» returns to the planner.
5. Change the time: one scheduled event remains. Turn the switch off: the alarm and the visible notification are cancelled.

The mechanism is a one-shot `AlarmManager.setAndAllowWhileIdle(RTC_WAKEUP)`; after delivery the next local day is calculated. Exact alarms and battery optimization exemption are not requested. Rescheduling is provided for on reboot, time/date/time zone changes and package updates; opening the app also restores the schedule.

Delays are possible because of Doze, power saving and manufacturer rules. After a force-stop the app must be opened again. If the notification is delayed past midnight, it keeps the original review date.

## Structure

One module `app`; versions in `gradle/libs.versions.toml`.

```text
app/src/main/java/ru/natoday/app/
  MainActivity.kt                  Navigation Compose, Intent handling
  PlannerApplication.kt            manual dependency injection
  data/                            Task, DAO, Room, repository, DataStore
  ui/                              screens, ViewModel, StateFlow, theme
  voice/                           SpeechRecognizer, text splitting
  reminders/                       AlarmManager, receiver, time calculation
app/src/main/res/values/strings.xml all user strings
app/schemas/                       exported Room schema
app/src/test/                      unit tests for logic and ViewModel
app/src/androidTest/               real Room, UI, reminders
docs/implementation-plan.md        milestones and acceptance criteria
docs/architecture.md               architecture and build
docs/voice.md                      voice input
docs/notifications.md              reminders
docs/verification.md               results of actual checks
developer_assistant/               additional Python RAG/MCP
tests/                             tests of the Python assistant
```

## Technical decisions

Kotlin, Compose Material 3, ViewModel + StateFlow + Coroutines, Room 2.8.4, Preferences DataStore 1.2.1, Navigation Compose 2.9.6. No DI framework, no additional modules and no own server. Settings and tasks survive a restart.

`scheduledDate` is LocalDate/epochDay without a time zone. `createdAt` and `completedAt` are Instant/UTC epoch millis. A time zone change does not shift a task's date. Transitions across a month, year and leap day are performed with java.time. The reminder's local time is recalculated in the current zone; a DST gap is shifted forward, and for an ambiguous time the first occurrence is used.

The MVP has no full action log, accounts, synchronization, export or cloud backup. The backup settings exclude local data.

## Developer assistant

The Python assistant remains a separate terminal tool and studies the documentation of this same Android repository. It is not part of the APK. Installation, indexing, `/help` and MCP verification instructions are in [docs/assistant.md](docs/assistant.md).

The Android application itself needs no API keys. The Python assistant supports DeepSeek (`DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, URL/timeout/token limit) and OpenAI (`OPENAI_API_KEY`, `OPENAI_MODEL`). A non-empty DeepSeek key selects it first. Without a key, indexing, search and MCP are available; settings and commands are in [docs/assistant.md](docs/assistant.md).

## GitLab

Git includes the sources, documentation, Gradle Wrapper, Room schema and Python dependency files. `local.properties`, keys, the virtual environment, the index, the model, IDE files and build outputs are excluded through `.gitignore`.

Create an empty repository in your GitLab namespace, then set its address:

```powershell
git remote add origin https://gitlab.com/YOUR_NAMESPACE/na-today.git
git push -u origin main
```

The remote repository address is not set automatically. Verification results and remaining limitations are in [docs/verification.md](docs/verification.md).
