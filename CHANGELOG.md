# Changelog

Each version lists changes in English and Simplified Chinese.

每个版本均提供英文和简体中文的变更记录。

## [2.3.0] - 2026-11-25

Open a different homepage during scheduled hours or switch to a temporary destination. Options shows which site opens now and at a time you choose.

### Added

- Set a temporary homepage for 30 minutes, one hour, or a specified local date and time. End it early from Options or let the current schedule take over on expiry.
- Add weekly rules in the device’s local time. Rules can span midnight, and Options identifies overlaps between enabled rules before saving.
- Preview a selected time or the temporary homepage’s expiry with the current draft. Actual new tabs use saved settings.

### Changed

- Resolve the destination when each new tab opens, including the first new tab after Chrome restarts. Existing homepage addresses now serve as the base homepage. Pending migrations from legacy sync can still retry.
- When another options tab saves a schedule, keep the unsaved draft and show the saved schedule for review.

每周可按设定的时段打开不同主页，也可临时切换到指定网站。选项页可以查看当前和指定时刻的跳转目标。

### 新增功能

- 临时主页可启用 30 分钟、1 小时或持续至指定的本地日期和时间。在选项页可提前结束，到期后按当时的排程跳转。
- 按设备当地时间添加每周规则。规则可以跨午夜，选项页在保存前会指出启用规则的重叠时段。
- 可用当前草稿预览指定时刻或临时主页到期时的目标。实际打开新标签时使用已保存的设置。

### 优化与改进

- 每次打开新标签时重新判断目标，包括 Chrome 重启后的首次打开。已有地址会成为基础主页，尚未完成的旧版同步迁移仍可重试。
- 另一选项页保存排程时，当前页保留未保存的草稿，并显示已保存的排程供核对。

## [2.2.2] - 2026-11-25

### Changed

- Homepage settings are stored on the current device. If homepage sync was enabled, the extension checks the previous synced address before the first redirect and saves it locally. If the sync read fails, it uses the local homepage and retries on a later load.

### Fixed

- The recovery page’s manual link opens the configured homepage when it is available.

### Maintenance & Dependencies

- Updated the installation instructions to use the current repository URL and renamed the Simplified Chinese introduction to `README-zh-CN.md`.
- Moved the [browser test report](./docs/实机测试报告.md) and its [screenshots](./docs/screenshots/) under `docs/`.

### 优化与改进

- 主页设置仅保存在当前设备。旧版启用了同步时，扩展会在首次跳转前查找原先同步的主页并迁入本机。如果同步读取失败，暂时使用本机主页，并在后续读取设置时重试。

### 问题修复

- 跳转未完成或失败时，恢复页的手动链接会打开已读取到的主页。

### 维护与依赖更新

- 安装说明改用当前仓库地址，简体中文介绍页更名为 `README-zh-CN.md`。
- [实机测试报告](./docs/实机测试报告.md)及其[截图](./docs/screenshots/)已移入 `docs/`。

## [2.2.1] - 2026-11-12

The options page offers a retry when the settings script fails to load. Storage warnings follow the browser language.

### Changed

- Failed saves now show the underlying error message when one is available.
- Warnings for invalid local or synced homepage URLs and failed sync reads are available in English and Simplified Chinese.

### Fixed

- If `settings.js` fails to load, the options page keeps the form disabled, shows an error, and offers a button to reload the page.

### Maintenance & Dependencies

- Split the project introduction into linked English and Simplified Chinese pages and added a bilingual changelog.

设置脚本加载失败时，选项页会提供重试入口。存储警告会跟随浏览器语言显示。

### 优化与改进

- 保存失败时，如果有具体错误信息，选项页会一并显示。
- 本机或同步的主页地址无效、同步读取失败时，警告支持英文和简体中文。

### 问题修复

- 如果 `settings.js` 加载失败，选项页会禁用表单、显示错误，并提供重新加载页面的按钮。

### 维护与依赖更新

- 将项目介绍拆为互相链接的英文页和简体中文页，并新增双语变更日志。

## [2.2.0] - 2026-11-12

The first release lets Chrome open a homepage of your choice in every new tab. The default is Kagi.

### Added

- Choose a preset or enter a custom HTTP or HTTPS homepage. The extension validates the URL before saving and uses a local copy of the address to start the redirect as the new tab loads.
- Keep the homepage on the current device by default, or opt in to syncing the address through Chrome.
- Use the recovery page to open the homepage manually, return to the options page, or retry when a redirect stalls or fails.
- Use the options and recovery pages in English or Simplified Chinese. The extension follows the browser language and falls back to English.
- The extension requests only the `storage` permission and loads site icons locally.

首个发布版本可让 Chrome 的每个新标签页打开你选定的主页，默认地址为 Kagi。

### 新增功能

- 可选择预设站点，也可填写自定义 HTTP 或 HTTPS 主页。扩展在保存前校验地址，并在新标签页加载时读取本地地址副本，提前发起跳转。
- 主页地址默认仅保存在本机，可主动开启 Chrome 跨设备同步。
- 跳转超时或失败时，可通过恢复页手动打开主页、返回选项页或重试。
- 选项页和恢复页支持英文和简体中文，跟随浏览器语言，其他语言使用英文。
- 扩展仅申请 `storage` 权限，网站图标从本地加载。

[2.3.0]: https://github.com/YE4IM/chrome-new-tab-page/compare/v2.2.2...v2.3.0
[2.2.2]: https://github.com/YE4IM/chrome-new-tab-page/compare/v2.2.1...v2.2.2
[2.2.1]: https://github.com/YE4IM/chrome-new-tab-page/compare/v2.2.0...v2.2.1
[2.2.0]: https://github.com/YE4IM/chrome-new-tab-page/releases/tag/v2.2.0
