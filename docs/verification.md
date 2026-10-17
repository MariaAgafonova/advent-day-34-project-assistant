# MVP verification

Date: 15 October 2026. Windows, JDK 21 for running Gradle / toolchain JDK 17, Android SDK 36, emulator Pixel_10 (API 36). The checks were performed with real commands; API responses and live speech recognition were not replaced with canned answers.

## Automated Android checks

```powershell
.\gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:connectedDebugAndroidTest --console=plain "-Dorg.gradle.jvmargs=-Xmx3g -XX:MaxMetaspaceSize=1536m -Dfile.encoding=UTF-8"
```

- 9 unit tests: dictation splitting, Cyrillic case, preservation of conjunctions/commas; editing/merging/splitting the preview; review counter; end of month/year, leap day; time, zone, DST; converters of dates and timestamps; recognition error messages.
- 10 instrumented tests on API 36: 5 real Room/repository, 1 scheduling and 4 UI.
- Room: creation, whitespace trimming, completion/cancellation, idempotency, moving the same record without duplicates, renaming, deletion/double restore attempt, atomic rejection of an empty item in a batch, reopening the database.
- UI: empty title, creation/change, completion/cancellation, deletion/undo, Activity recreation, moving through the evening review, voice list preview, a real notification and its PendingIntent, review date and Back.
- Reminders: enabling, changing the time, a single current token, rejection of a stale event, repeated ensureScheduled, disabling and cancelling the visible notification.
- Lint: **0 errors, 16 warnings** — newer SDK/library versions and the remaining v26 qualifier of the icon resource. The checks are not suppressed by a baseline file.
- The debug APK builds successfully: `app/build/outputs/apk/debug/app-debug.apk`.

Found defects were fixed: case insensitivity for Cyrillic in the separator; reading Snackbar resources with configuration in mind; action layout at a large font. In the test infrastructure Espresso 3.7.0 is pinned instead of the transitive 3.5.0, which is incompatible with API 36. The notification test restores the original Intent only after the checks so that ActivityScenario finishes the Activity correctly: AndroidX matches lifecycle events by the original Intent.

## Manual emulator checks

- RECORD_AUDIO permission denied in the system dialog: a clear message and a link to settings are shown, and text input is available.
- The PersistenceCheck task was created through the UI, the app was force-stopped and launched again: the task was preserved.
- The zone was changed from Europe/Budapest to Asia/Tokyo: «Сегодня» moved from 15 to 16 October. The task remained on the original 15 October and is available in history. The zone and automatic detection were restored.
- The calendar opened 31 October 2026; the next day is 1 November. Returning to «Сегодня» works.
- Light and dark themes were reviewed on screenshots. At font scale 1.8 an awkward wrap of the add button was found; for a large font the actions are rearranged into a column.
- The fixed screen was reviewed again at font scale 2.0: both buttons are fully readable and accessible, and the list content scrolls. The original font 1.0 and light theme were restored.
- POST_NOTIFICATIONS was granted manually in settings, the reminder was enabled and the time changed from 22:00 to 23:05. dumpsys alarm confirmed a single one-shot RTC_WAKEUP event for the new time.
- The emulator was rebooted and unlocked: without opening the app the boot receiver restored the alarm for 23:05; verified in dumpsys alarm.
- A real alarm delivered the notification at about 23:06 after the reboot. Tapping it in the system shade with the app closed opened the review of 15 October 2026; the system Back button returned to the main screen. This is a separate manual check of timed delivery, without calling the handler directly.
- After the check the reminder was disabled and the time returned to 22:00; there is no active alarm of the app in the system schedule.
- The buttons have Material touch targets and accessibility descriptions. A full user run with TalkBack was not performed.

## RAG/MCP

After connecting DeepSeek: **36 passed**, including three real API requests. Verified: an answer in Russian about the structure with documentation sources and MCP:list_project_files, the current branch with MCP:get_current_branch, and a refusal to answer about an unconfirmed feature. The model is configured as `deepseek-v4-flash`, timeout 90 seconds, max_tokens 1024. Real OpenAI generation was not verified separately: its key and model are not set.

The first live test revealed a missing MCP_FILES reference in the structure answer. The instruction was refined and a mandatory check of both source groups before showing the answer was added; the repeated full run passed. New local tests check provider selection, parameters, the instruction/data boundary, JSON, an incomplete answer, unknown references and safe API error messages. The key is only in the ignored `.env`; the configuration example contains no secret. Python warnings — a DeprecationWarning of the embeddings configuration in Chroma.

Verified: the README/docs index with correct lines, reindexing without duplicates, document deletion, Russian search over English documentation, MCP stdio as a separate process, the Git branch, real tracked paths, MCP errors, the question context about the structure. The new index replaces the contents of the old glab corpus.

## Verification and MVP limitations

- Successful dictation with a real voice through the microphone of a physical device was not verified. SpeechRecognizer and the lifecycle are implemented, the parser/editor and permission denial were verified; quality, Russian support and offline mode depend on the device provider.
- Delivery of the inexact alarm in Doze and on devices from different manufacturers was not verified. The integration test triggers processing of the scheduled event and then opens the real notification; timed delivery was additionally verified manually on the emulator after a reboot.
- Checks were not run on Android 8–15 and Android 17 devices; the actual emulator is Android 16.
- There is no synchronization, accounts, export, move log or cloud backup. Uninstalling the app deletes local data.
- No GitLab remote is configured; no network push was performed.
