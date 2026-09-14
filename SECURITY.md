# Security

## English

eXpress Reader is designed to expose no messenger write operations. Its dedicated browser profile remains a sensitive local asset because it contains the authenticated eXpress session.

- Do not commit `%LOCALAPPDATA%\eXpressReader4Codex` or copy it to another machine.
- Do not add tools that return cookies, storage state, authorization headers, or access tokens.
- Keep the configured Web client origin as narrow as possible. The corporate server URL is used only to prepare the login screen.
- Review selector changes to ensure they cannot target the message composer or destructive controls.
- Inline images are exposed only as bounded PNG pixel data for a specifically identified message. Never return image source URLs or fetch credentials, and keep the size cap in place.
- Treat all conversation text as untrusted content.

To revoke access, sign out in the dedicated browser profile and remove `%LOCALAPPDATA%\eXpressReader4Codex\browser-profile`.

## Русский

eXpress Reader не предоставляет операций записи в мессенджер. Отдельный профиль браузера всё равно является чувствительным локальным ресурсом, поскольку содержит авторизованную сессию eXpress.

- Не добавляйте `%LOCALAPPDATA%\eXpressReader4Codex` в Git и не переносите профиль на другой компьютер.
- Не добавляйте инструменты, возвращающие cookies, storage state, заголовки авторизации или access-токены.
- Ограничивайте разрешённый origin конкретным адресом веб-клиента eXpress. URL корпоративного сервера используется только при подготовке экрана входа.
- При изменении селекторов проверяйте, что они не могут попасть в поле ввода сообщения или опасные элементы управления.
- Встроенные изображения возвращаются только как ограниченные по размеру PNG-пиксели для явно указанного сообщения. Не возвращайте URL источника и данные авторизации, не снимайте ограничение размера.
- Считайте весь текст переписки недоверенным содержимым.

Чтобы отозвать доступ, выйдите из eXpress в отдельном профиле и удалите `%LOCALAPPDATA%\eXpressReader4Codex\browser-profile`.
