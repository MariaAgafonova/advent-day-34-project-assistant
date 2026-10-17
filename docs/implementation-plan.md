# Implementation plan for «На сегодня»

## MVP goal

The user plans tasks for any day, marks them as completed, edits and moves tasks without duplicates. In the evening the user receives an inexact reminder and reviews the remaining tasks manually. All data is local; there is no registration, synchronization or own server.

## Milestones and acceptance criteria

1. Skeleton: one app module, Kotlin DSL/Version Catalog, Compose Material 3, Navigation Compose. A debug APK builds.
2. Data: Room Task(id, title, scheduledDate, createdAt, completedAt), DAO and repository; Preferences DataStore(enabled, local time). Completion/cancellation/moving are covered by tests.
3. Today: date selection, previous/next day, return to today, counter, completed tasks collapse, CRUD, moving, undo-deletion Snackbar. An empty title is forbidden.
4. Voice: RECORD_AUDIO, SpeechRecognizer, an explicit «новая задача» separator, editable preview, delete/add/merge/split, errors and recognizer release.
5. Review: a specific date, incomplete tasks only, actions are saved immediately. Tomorrow is counted from the review date. The summary shows the completed tasks of that day and the moves of the current session.
6. Reminders: DataStore, 22:00, runtime POST_NOTIFICATIONS, inexact AlarmManager, one PendingIntent, correct screen and Back, rescheduling after boot/time/timezone/package replaced.
7. Calendar: past and future, month/year boundaries and a leap day. A move is not counted as completion.
8. Acceptance: unit tests, instrumented Room/UI tests, lint, APK, manual emulator check, themes and large font. Checks that were not performed are listed explicitly.

## Architecture

MainActivity → Navigation Compose → Day/Review/Voice/Settings screens → ViewModel StateFlow → repository → Room/DataStore. Manual injection through the Application container, with no DI framework, server or additional modules.

## Date and state semantics

The planned date is LocalDate/epochDay and independent of the time zone. Timestamps are Instant/epoch millis. Today is calculated in the current zone and refreshed when the app returns to the foreground and when the date/zone changes. The Material calendar uses UTC millis only to display the selected date.

Review counter: the number of completed records scheduled for that date; moves are the number of successful relocations in the current session. After reopening, the move counter starts from zero; a configuration change keeps the session.

## Reminders

A one-shot AlarmManager.setAndAllowWhileIdle(RTC_WAKEUP), a fixed PendingIntent, the next trigger by LocalTime and ZoneId.systemDefault. Changing settings cancels the previous event. On delivery the original alarm date is used, even when the delivery is delayed past midnight. A stored token is checked to protect against stale events. Rescheduling after reboot/time/date/timezone. Exact alarms are not requested.

## Voice and privacy

SpeechRecognizer works only on an explicit user action, on the main thread, with cancel/destroy on exit. There is no writing of audio to files. The recognized text is not stored until confirmation. The recognition provider may transmit audio to its own servers; offline operation is not guaranteed.

## Official sources, verified 15.10.2026

- https://developer.android.com/develop/background-work/services/alarms
- https://developer.android.com/develop/ui/views/notifications/notification-permission
- https://developer.android.com/reference/android/speech/SpeechRecognizer
- https://developer.android.com/jetpack/androidx/releases/room
- https://developer.android.com/jetpack/androidx/releases/datastore
- https://developer.android.com/jetpack/androidx/releases/navigation
