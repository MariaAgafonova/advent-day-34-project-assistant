# Архитектура приложения

NaToday («На сегодня») — ежедневник для Android. Работает без регистрации и без собственного сервера. В приложении один Gradle-модуль `app`; используются Kotlin, Compose Material 3, ViewModel, StateFlow, Coroutines, Room, Preferences DataStore и Navigation Compose.

## Точка входа и экраны

`app/src/main/java/ru/natoday/app/MainActivity.kt` — это Android-активити, которая содержит граф навигации Navigation Compose. Маршруты: today, review/{day}, voice/{day} и settings. Уведомление передаёт в маршрут review дату в виде epoch-day; экран Today остаётся под ним в стеке навигации.

`ui/DayScreen.kt` содержит список дня, карточки задач и экран вечернего разбора. `ui/PlannerViewModels.kt` отвечает за операции с задачами, выбранную дату и счётчики сессии разбора. `ui/VoiceScreen.kt` и `ui/VoiceViewModel.kt` реализуют редактируемый предпросмотр голосового ввода. `ui/SettingsScreen.kt` управляет настройками напоминаний. Эти пути указаны относительно `app/src/main/java/ru/natoday/app/`.

## Локальное хранение

`data/Task.kt` — сущность Room: id, title, scheduledDate, createdAt, completedAt. Плановая дата — LocalDate, хранится как epochDay. Создание и выполнение — Instant, хранятся как epoch-миллисекунды. Смена часового пояса не переносит задачи на другую календарную дату.

`data/TaskDao.kt` отдаёт Flow для выбранной даты. `data/TaskRepository.kt` проверяет заголовки и реализует создание, переименование, выполнение/отмену выполнения, перенос, удаление и восстановление. Перенос обновляет scheduledDate в той же строке; он никогда не создаёт копию и не помечает незавершённую задачу выполненной. Отмена удаления восстанавливает исходный идентификатор.

`data/TaskDatabase.kt` — версия схемы Room 1. Экспортированные схемы лежат в `app/schemas/`. `data/SettingsRepository.kt` хранит признак включения и время напоминания, а также метаданные планирования в Preferences DataStore. По умолчанию напоминания выключены, время — 22:00.

## Состояние и связывание зависимостей

`PlannerApplication.kt` создаёт одну базу Room, репозитории и ReminderScheduler. Зависимости передаются через фабрики ViewModel без DI-фреймворка. UI собирает StateFlow с учётом жизненного цикла. Каждое изменение сразу сохраняется в Room. Счётчики переносов в разборе переживают пересоздание через SavedStateHandle, но сбрасываются для новой сессии разбора.

## Сборка из исходников

В корне репозитория находятся `settings.gradle.kts`, `build.gradle.kts`, `gradlew.bat` и `gradle/libs.versions.toml`. Откройте этот корень в Android Studio. Debug-APK собирается командой `.\\gradlew.bat :app:assembleDebug`. Юнит-тесты запускаются через `:app:testDebugUnitTest`, lint — через `:app:lintDebug`, тесты на устройстве — через `:app:connectedDebugAndroidTest`.

Python-ассистент разработчика необязателен и находится в `developer_assistant/`; Android его не вызывает. Его MCP-сервер читает метаданные Git этого же корня репозитория. Проверка GitLab CLI не требуется.
