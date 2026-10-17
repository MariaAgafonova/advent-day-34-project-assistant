# День 34 — результаты проверки

Проверено 17 октября 2026 года на Windows, Node.js 25.9.0, Python 3.12.10. Проект: `D:\AIAdvent\advent-day-34-project-assistant`. CI нового пакета настроен на Node 24, Linux и Windows; удалённый GitHub Actions в этой сессии не запускался.

## Автоматические проверки

| Проверка | Результат |
|---|---|
| Локальный CLI: TypeScript и сборка | PASS |
| Файловые инструменты, агент, адаптер DeepSeek | 29 passed |
| Реальный MCP stdio в автотестах | PASS: отдельные процессы, initialization/listTools/callTool |
| Support TypeScript | PASS |
| Support Workers/D1/MCP | 29 passed |
| Support Playwright mock API, desktop/mobile | 4 passed |
| Support production build | PASS, 178 modules |
| Оба Cloudflare Workers deploy --dry-run | PASS; публикация не выполнялась |
| Python дня 32: pytest -q | 44 passed, 7 deselected |
| Корневая команда project-assistant --help | PASS в конечной папке |
| YAML четырёх workflows | PASS |
| Известные production-секреты в поставке и артефактах | 0 совпадений |

Mock LLM в тестах не считается подтверждением самостоятельной работы настоящей модели. Проверки инструментов используют настоящий MCP-клиент и stdio-сервер, а не прямой вызов функций вместо протокола. Локальные тесты apply дополнительно проверяют частичный сбой записи и повторное применение.

Проверены границы доступа, traversal, секретные имена и содержимое, ignore-правила, бинарные данные, junction внутри/снаружи корня, hardlink при записи, диапазоны строк, Unicode/CRLF, лимиты/усечения, создание и изменение документов, хеш-конфликты, повторное применение, файл, появившийся после preflight, повреждённый путь manifest, scoped AGENTS, вымышленные ссылки и исключение секретных аргументов из журнала.

На Windows запуск дочерних процессов потребовал разрешения среды вне песочницы. Для support workerd использованы те же локальные Visual C++ runtime DLL, с которыми проверялся день 33; они не включаются в исходные файлы. Оставшиеся предупреждения: устаревшая конфигурация embeddings в Chroma и предупреждения Vite об импортах без расширений. Проверки завершились успешно.

## Реальная модель

Используется существующий DeepSeek-ключ из явно указанного файла настроек дня 33; ключ не копировался в новый проект и не выводился. Модель: `deepseek-v4-flash`.

Первый live-прогон: `.assistant/verification/2026-10-17T17-01-17-709Z/`. Исследование реального проекта и документации остановилось на лимите 40 вызовов; эти результаты сохранены как partial. Причина: повторные попытки чтения запрещённых файлов и смешение fixture с production API. Уточнены сообщения о запретах, контроль бюджета и правила исключения fixture при исследовании корневого проекта.

Настоящая LLM успешно исправила временную копию fixture: 13 вызовов, 4 прочитанных файла, непустой diff. В нём исправлены маршрут, обязательный UUID client_message_id, лимит 4000 и тело успешного ответа. Применение проверено, повторное применение возвращает already_applied.

Итоговые успешные проверки:

| Сценарий | Запуск | Результат |
|---|---|---|
| A: получение контекста тикета через MCP | `live-usage-verified` | complete; 39 вызовов, 12 прочитанных файлов, отчёт с путями и строками |
| B: API реального приложения | `live-docs-2026-10-17T17-03-28-033Z` | complete; 25 вызовов, 7 файлов, непустой diff для support/README.md, только staged |
| B: fixture, повторный прогон | `live-fixture-2026-10-17T17-03-28-033Z` | complete; 12 вызовов, 4 файла; apply → applied, повтор → already_applied; четыре проверки исправленного документа true |
| Проверка production-предложения исполнителем | `reviewed-support-docs` | 5 файлов через MCP; уточнена семантика ошибок; отдельное исправленное предложение, только staged |

Результаты и исходные события доступны в [отчёте A](../.assistant/runs/live-usage-verified/report.md), [отчёте B](../.assistant/runs/live-docs-2026-10-17T17-03-28-033Z/report.md), [production diff](../.assistant/runs/live-docs-2026-10-17T17-03-28-033Z/changes.patch) и [fixture diff](../.assistant/verification/2026-10-17T17-03-28-033Z/fixture.patch). Fixture и результаты применения находятся внутри `.assistant/verification/2026-10-17T17-03-28-033Z/`; машинный сводный файл — results.json.

Повторный общий runner завершился с ненулевым статусом из-за ранее прерванного сценария usage; это не скрыто и не представляется успешным общим прогоном. После исправлений A отдельно завершился с exit code 0. Сначала модель возвращала невалидный финальный JSON/ссылки: добавлены точная JSON schema, конкретные ошибки, максимум две корректирующие попытки и проверка объединённых соседних диапазонов без пропусков. Финальные хеши привязывает приложение по журналу чтений; модель не обязана перепечатывать длинные хеши. Предыдущие partial/failed артефакты сохранены.

**Статус production-предложений: staged, не применены.** SHA-256 support/README.md по-прежнему совпадает с original_hash manifest. Для дальнейшего использования подготовлено [проверенное предложение](../.assistant/runs/reviewed-support-docs/report.md) и [его diff](../.assistant/runs/reviewed-support-docs/changes.patch). Просмотр:

```powershell
Get-Content .assistant/runs/reviewed-support-docs/changes.patch
```

Команда применения проверенного предложения после просмотра пользователем:

```powershell
npm run project-assistant -- apply --repo . --run reviewed-support-docs
```

Ручной просмотр выявил ограничение качества текста LLM: в исходном production diff фраза «пользовательское сообщение остаётся со статусом failed» ошибочно обобщала все ошибки. В `reviewed-support-docs` она исправлена: обновление статуса относится к сбоям генерации после сохранения сообщения и ограничено активной попыткой; ошибки валидации/сессии до sendMessage не создают сообщение. Оригинальный model diff и замечание сохранены для аудита. Проверка исполнителя явно помечена `implementation_assistant_review`: её нельзя выдавать за дополнительный самостоятельный LLM-прогон.

В исходном отчёте A Node-пакет project-assistant неточно назван Git-контекстом ревью: фактически он исследует рабочие файлы и staging. Это отмеченная ошибка текста модели; проверка существования цитат не доказывает семантическую точность. Исправленный fixture отдельно проверен по коду.

## Переиспользование и состав изменений

Сохранены актуальные support-приложение, RAG D1 FTS5, CRM MCP, профили, панель оператора, журналы LLM, Cloudflare-конфигурации и все компоненты Python-ревью дня 32. Переиспользованы версия MCP SDK, настройки DeepSeek, TypeScript/Zod и структура источников с путями, строками и хешами. Одношаговый support-LLM-клиент остался без изменения; локальному агенту добавлен отдельный tool-calling адаптер.

Добавлены корневой npm-скрипт; пакет project-assistant с CLI, агентом, DeepSeek-адаптером, MCP-клиентом/сервером, политикой доступа, staging/apply, live-runner, fixture и тестами; отдельный CI workflow; .assistantignore и документация. Изменены корневые README и .gitignore. Взята поздняя правка форматирования YAML workflow support из исходной папки дня 33. Исходную папку разработка дня 34 не изменяла.

Новые исходные файлы относительно дня 33:

```text
package.json
.assistantignore
.github/workflows/project-assistant.yml
docs/project-assistant.md
docs/day34-verification.md
project-assistant/package.json
project-assistant/package-lock.json
project-assistant/tsconfig.json
project-assistant/tsconfig.build.json
project-assistant/.gitignore
project-assistant/.env.example
project-assistant/src/{agent,cli,common,live,llm,mcp,policy,server,store,tools}.ts
project-assistant/tests/{agent.test,files.test,transport.test,helpers}.ts
project-assistant/fixtures/chat-api/src/{routes,schemas,handler}.ts
project-assistant/fixtures/chat-api/docs/chat-api.md
```

История сохранена, новых commit/push/MR нет. Начальный снимок HEAD, статуса, diff и хешей исходных файлов находится в `.assistant/baseline/`. Секреты, зависимости, сборки и артефакты запусков исключены из Git.

## Ограничения

Редактируется только документация; shell, удаление, изменение кода и автоматическое применение отсутствуют. Общая многофайловая транзакция не реализована. Детектор секретов эвристический и может отклонять тестовые файлы с демонстрационными секретами; такой отказ явно отражается в отчёте модели. Семантическая точность LLM не гарантируется проверкой ссылок. AGENTS ограничены 6000 байт суммарно; работают только доступные правила внутри выбранного корня. Свежесть содержания обеспечивается чтением MCP и хешами, а не RAG.
