# <img src="./assets/a1-logo.svg" alt="A1" width="40"> Gmail MCP

[English](./README.md) | **Русский**

[![npm](https://img.shields.io/npm/v/mcp-google-gmail)](https://www.npmjs.com/package/mcp-google-gmail)
[![CI](https://github.com/A1-x-Tech/mcp-google-gmail/actions/workflows/ci.yml/badge.svg)](https://github.com/A1-x-Tech/mcp-google-gmail/actions/workflows/ci.yml)
[![Glama](https://glama.ai/mcp/servers/A1-x-Tech/mcp-google-gmail/badges/score.svg)](https://glama.ai/mcp/servers/A1-x-Tech/mcp-google-gmail)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**A1 Gmail MCP** позволяет AI-приложению работать с вашей почтой Gmail на естественном языке. Можно искать и читать письма, готовить ответы черновиками, отправлять их в нужный момент, поддерживать порядок в ярлыках и использовать корзину вместо безвозвратного удаления.

Сервер работает с Gmail API через ваш Google-аккаунт. Он отличает черновик, который ещё можно править, от отправленного письма, которое не вернуть, и явно показывает ограничения Gmail API, а не создаёт впечатление, что любое действие с почтой обратимо.

- **18 инструментов.** Поиск и чтение писем и переписок, отправка напрямую или через черновики, полный жизненный цикл черновиков, ярлыки и корзина.
- **Осознанная отправка.** Путь «черновик → проверка → отправка» — основной; отправка помечена как разрушительная, и после неоднозначного сбоя сервер никогда не отправляет письмо повторно — отправленное письмо не отозвать.
- **Корзина — страховка.** Удаление почты идёт через обратимую корзину (около 30 дней); инструмента безвозвратного удаления писем сознательно нет.
- **Чтение с ограничителем.** Декодированные тексты писем обрезаются по явному лимиту, а вложения возвращаются как метаданные, поэтому длинная рассылка не затопит диалог незаметно.
- **Минимальный scope Google.** Используется только `gmail.modify` — без безвозвратного удаления и без доступа к настройкам Gmail.

Начните с запроса, который только читает данные:

> Покажи непрочитанные письма за последнюю неделю и скажи, какие из них ждут ответа.

[Подключить сервер](#быстрый-старт) · [Посмотреть сценарии](#что-можно-поручить) · [Открыть техническую документацию](#техническая-документация)

---

## Увидеть работу за минуту

> **Вы:** Что непрочитанного пришло на этой неделе по контракту с Acme?
>
> **Ассистент:** Ищет письма синтаксисом запросов Gmail и показывает отправителей, темы, даты и фрагменты. Ничего не меняется.
>
> **Вы:** Подготовь ответ на последнее: подписанный экземпляр отправим в пятницу.
>
> **Ассистент:** Создаёт черновик в той же переписке и показывает его на проверку. Ничего не отправлено.
>
> **Вы:** Отправляй.
>
> **Ассистент:** Отправляет черновик. Отправка — отдельный, явно разрушительный шаг, поэтому AI-приложение может сначала запросить подтверждение.

## Содержание

- [Быстрый старт](#быстрый-старт)
- [Что можно поручить](#что-можно-поручить)
- [Как меняется почта](#как-меняется-почта)
- [Что может измениться](#что-может-измениться)
- [Как получить доступ](#как-получить-доступ)
- [Конфигурация](#конфигурация)
- [Данные, лимиты и работа в фоне](#данные-лимиты-и-работа-в-фоне)
- [Техническая документация](#техническая-документация)
- [Поддержка](#поддержка)

## Быстрый старт

Нужны Node.js 20+, Google-аккаунт и OAuth-данные из проекта Google Cloud с включённым Gmail API.

1. [Подготовьте Google OAuth-доступ](#как-получить-доступ).
2. Добавьте сервер в AI-приложение.
3. Отправьте запрос, который только читает данные.

<details open>
<summary><strong>Codex</strong></summary>

<br>

**В приложении:** откройте **Settings → Plugins → MCP servers**, нажмите **Add server**, затем добавьте `npx -y mcp-google-gmail@latest` с `GOOGLE_GMAIL_CLIENT_ID`, `GOOGLE_GMAIL_CLIENT_SECRET` и `GOOGLE_GMAIL_REFRESH_TOKEN`.

**В командной строке:**

```bash
codex mcp add google-gmail \
  --env GOOGLE_GMAIL_CLIENT_ID=your_client_id \
  --env GOOGLE_GMAIL_CLIENT_SECRET=your_client_secret \
  --env GOOGLE_GMAIL_REFRESH_TOKEN=your_refresh_token \
  -- npx -y mcp-google-gmail@latest
```

```bash
codex mcp list
```

[Документация Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

</details>

<details>
<summary><strong>Claude Code</strong></summary>

<br>

```bash
claude mcp add \
  --env GOOGLE_GMAIL_CLIENT_ID=your_client_id \
  --env GOOGLE_GMAIL_CLIENT_SECRET=your_client_secret \
  --env GOOGLE_GMAIL_REFRESH_TOKEN=your_refresh_token \
  --transport stdio --scope user google-gmail \
  -- npx -y mcp-google-gmail@latest
```

```bash
claude mcp list
```

[Документация Claude Code MCP](https://code.claude.com/docs/en/mcp)

</details>

<details>
<summary><strong>Claude Desktop</strong></summary>

<br>

Откройте **Settings → Developer → Edit Config** и добавьте:

```json
{
  "mcpServers": {
    "google-gmail": {
      "command": "npx",
      "args": ["-y", "mcp-google-gmail@latest"],
      "env": {
        "GOOGLE_GMAIL_CLIENT_ID": "your_client_id",
        "GOOGLE_GMAIL_CLIENT_SECRET": "your_client_secret",
        "GOOGLE_GMAIL_REFRESH_TOKEN": "your_refresh_token"
      }
    }
  }
}
```

Если **Edit Config** недоступна, отредактируйте `~/Library/Application Support/Claude/claude_desktop_config.json` на macOS или `%APPDATA%\Claude\claude_desktop_config.json` на Windows.

[Документация Claude Desktop MCP](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)

</details>

<details>
<summary><strong>Cursor</strong></summary>

<br>

Добавьте в `~/.cursor/mcp.json` на macOS/Linux или `%USERPROFILE%\.cursor\mcp.json` на Windows:

```json
{
  "mcpServers": {
    "google-gmail": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "mcp-google-gmail@latest"],
      "env": {
        "GOOGLE_GMAIL_CLIENT_ID": "your_client_id",
        "GOOGLE_GMAIL_CLIENT_SECRET": "your_client_secret",
        "GOOGLE_GMAIL_REFRESH_TOKEN": "your_refresh_token"
      }
    }
  }
}
```

[Документация Cursor MCP](https://cursor.com/docs/mcp)

</details>

<details>
<summary><strong>VS Code</strong></summary>

<br>

Запустите **MCP: Open User Configuration** и добавьте:

```json
{
  "servers": {
    "google-gmail": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "mcp-google-gmail@latest"],
      "env": {
        "GOOGLE_GMAIL_CLIENT_ID": "${input:gmail_client_id}",
        "GOOGLE_GMAIL_CLIENT_SECRET": "${input:gmail_client_secret}",
        "GOOGLE_GMAIL_REFRESH_TOKEN": "${input:gmail_refresh_token}"
      }
    }
  },
  "inputs": [
    { "type": "promptString", "id": "gmail_client_id", "description": "Google OAuth client ID" },
    { "type": "promptString", "id": "gmail_client_secret", "description": "Google OAuth client secret", "password": true },
    { "type": "promptString", "id": "gmail_refresh_token", "description": "Google OAuth refresh token", "password": true }
  ]
}
```

Проверьте сервер командой **MCP: List Servers**.

[Документация VS Code MCP](https://code.visualstudio.com/docs/agent-customization/mcp-servers)

</details>

## Что можно поручить

### Разобрать входящие

- Покажи непрочитанные письма за последние семь дней и сгруппируй по отправителям.
- Найди переписку с Acme о контракте и суммируй её от старых писем к новым.
- В каких письмах меня ждут вложения? Покажи темы и имена файлов.

### Написать и отправить письмо

- Подготовь ответ в этой переписке: подписанный экземпляр уйдёт в пятницу.
- Покажи черновик, сделай формулировки короче, затем отправь.
- Отправь команде короткое письмо о статусе, руководителя поставь в копию.

### Поддерживать порядок в почте

- Создай ярлык `Receipts/2026` и присвой его подходящим письмам.
- Отметь рассылки этой недели прочитанными и заархивируй их.
- Перемести эту переписку в корзину — и восстанови, если я передумаю.

## Как меняется почта

1. Безопасный путь к отправке — **черновик**: `create_draft` готовит письмо, `get_draft` показывает его на проверку, `send_draft` отправляет. `send_message` пропускает черновик и отправляет сразу.
2. Отправленное письмо необратимо во внешнем мире. После тайм-аута или ошибки `5xx` сервер не отправляет повторно; прежде чем пробовать снова, проверьте письма по запросу `in:sent` — повторённая отправка означала бы письмо, ушедшее дважды.
3. Удалить письмо или переписку — значит отправить в корзину. `manage_trash` обратим около 30 дней; инструмента безвозвратного удаления сознательно нет.
4. Черновики — исключение: `update_draft` заменяет черновик целиком (частичного редактирования в API нет), а `delete_draft` необратим, потому что черновики минуют корзину.

Каждый вызов работает с одним почтовым ящиком — аккаунтом, выдавшим токен. Декодированные тексты обрезаются по настраиваемому лимиту с явными флагами, а вложения возвращаются только как метаданные; содержимое вложений запрашивается через `raw_request` осознанно.

## Что может измениться

| Операция | Что происходит | Граница подтверждения |
|---|---|---|
| Поиск и чтение писем, переписок, черновиков, ярлыков, профиля | Читает данные почтового ящика | Ничего не меняет |
| Создание или обновление черновика | Готовит или заменяет неотправленное письмо | Меняет почтовый ящик |
| Смена состояния «прочитано», «в избранном», «в архиве», присвоение или снятие ярлыков | Меняет организацию почты | Меняет почтовый ящик |
| Создание или переименование ярлыка | Меняет словарь ярлыков | Меняет почтовый ящик |
| Корзина: отправка или восстановление письма или переписки | Перемещает почту в корзину и обратно; обратимо ~30 дней | Разрушительно |
| Отправка письма или черновика | Доставляет письмо реальным получателям; его не отозвать | Разрушительно |
| Удаление черновика или ярлыка | Удаляет его безвозвратно, минуя корзину | Разрушительно |
| Технический запрос API | Может вызвать метод API без отдельного инструмента | Потенциально разрушительно |

Как AI-приложение просит подтверждение, определяет само приложение. Сервер помечает операции чтения, записи и удаления, чтобы оно отличило проверку от рабочего изменения.

## Как получить доступ

Gmail требует OAuth 2.0: одного API-ключа недостаточно.

1. Создайте или выберите проект Google Cloud и включите **Gmail API**.
2. Настройте OAuth consent screen и создайте OAuth-клиент типа **Desktop app**.
3. Авторизуйте Google-аккаунт, чей почтовый ящик хотите подключить, — каждый вызов работает именно с этим ящиком. [OAuth 2.0 Playground](https://developers.google.com/oauthplayground) поможет получить refresh token, если включить **Use your own OAuth credentials**.
4. Запросите scope:

   ```text
   https://www.googleapis.com/auth/gmail.modify
   ```

   Он покрывает поиск, чтение, отправку, черновики, ярлыки и корзину — но не безвозвратное удаление и не настройки Gmail. Для безвозвратного удаления через `raw_request` дополнительно нужен полный scope `https://mail.google.com/`.

Refresh token OAuth-приложения в режиме Testing может истечь через семь дней. Для долгого доступа опубликуйте OAuth-приложение или используйте Internal-приложение в домене Workspace. Храните client secret и refresh token как пароли.

## Конфигурация

| Переменная | Обязательна | Описание |
|---|---|---|
| `GOOGLE_GMAIL_CLIENT_ID` | Да* | OAuth client ID. |
| `GOOGLE_GMAIL_CLIENT_SECRET` | Да* | OAuth client secret. |
| `GOOGLE_GMAIL_REFRESH_TOKEN` | Да* | OAuth refresh token. |
| `GOOGLE_GMAIL_ACCESS_TOKEN` | Да* | Короткоживущая альтернатива OAuth-тройке (около 1 часа). |
| `GOOGLE_GMAIL_API_BASE` | Нет | Переопределяет базовый URL Gmail API. |
| `GOOGLE_GMAIL_TIMEOUT_MS` | Нет | Тайм-аут одного запроса; по умолчанию `60000` мс. |
| `GOOGLE_GMAIL_MAX_RETRIES` | Нет | Повторы временных ошибок; по умолчанию `3`. |

\* Передайте OAuth-тройку или access token.

## Данные, лимиты и работа в фоне

- **Запросы идут в Gmail.** Локальный сервер обновляет OAuth-токены Google и вызывает Gmail API. Анонимная телеметрия содержит ID установки, версию пакета, версии AI-клиента и платформы и имена инструментов — но не OAuth-токены, содержимое почты, аргументы или промпты. Чтобы отключить её, задайте `ASKADS_TELEMETRY=0`.
- **Google считает единицы квоты.** Gmail разрешает примерно 250 единиц квоты в секунду на пользователя; отправка стоит 100 единиц, обычное чтение — 5. Обычные аккаунты отправляют около 500 писем в день, аккаунты Workspace — около 2000. При `429` сервер использует задержку; чтение также повторяется после сетевых и `5xx` ошибок, а отправка и другие записи после неопределённой ошибки не повторяются никогда.
- **Постоянного опроса нет.** Сервер работает только при вызове. Если AI-приложение поддерживает задания по расписанию, оно может периодически проверять входящие; через `raw_request` также доступен `history.list` для инкрементальной синхронизации.

## Техническая документация

- [Каталог MCP-возможностей](./docs/capabilities/index.md) — страницы по пользовательским задачам для каждого инструмента.
- [Все инструменты и параметры](./docs/TOOLS.md)
- [Документация по разработке](./docs/DEVELOPMENT.md)
- [Документация по публикации](./docs/PUBLISHING.md)
- [Справочник Gmail API](https://developers.google.com/gmail/api)

## Поддержка

Нашли ошибку или не хватает сценария? [Создайте issue](https://github.com/A1-x-Tech/mcp-google-gmail/issues) или напишите в [Telegram](https://t.me/a1_mcp).

<br>

<p align="center">
  <img src="https://github.com/ztemerbekov/a1-yandex-kit-skills/raw/main/assets/images/mona-hifive-yandex-kit-warm.gif" alt="Две Моны дают пять" width="256">
</p>

<p align="center">
  Вы дочитали до конца!
</p>
