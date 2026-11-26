# Changelog

[**English**](./CHANGELOG.md) | [中文](./CHANGELOG-zh-CN.md)

## [Unreleased]

Choose whether new tabs follow a schedule or always open your base homepage.

### Added

- **Enable advanced features** controls temporary homepages, weekly schedules, and time previews. Fresh installations start with it off. Upgrading from 2.3.0 turns it on if you have a saved weekly rule or an active temporary homepage.

### Changed

- Turning the switch off applies to the next new tab and keeps saved rules and the temporary homepage’s original expiry. Turning it back on skips expired temporary homepages.
- Save the base homepage independently in basic mode. Options tabs share the switch state and retain their own unsaved edits.
- Reorganized Options so advanced mode shows the current destination above the homepage and schedule editors, with a single-column layout on narrow screens.

## [2.3.0] - 2026-11-25

Open a different homepage during scheduled hours or switch to a temporary destination. Options shows which site opens now and at a time you choose.

### Added

- Set a temporary homepage for 30 minutes, one hour, or a specified local date and time. End it early from Options or let the current schedule take over on expiry.
- Add weekly rules in the device’s local time. Rules can span midnight, and Options identifies overlaps between enabled rules before saving.
- Preview a selected time or the temporary homepage’s expiry with the current draft. Actual new tabs use saved settings.

### Changed

- Resolve the destination when each new tab opens, including the first new tab after Chrome restarts. Existing homepage addresses now serve as the base homepage. Pending migrations from legacy sync can still retry.
- When another options tab saves a schedule, keep the unsaved draft and show the saved schedule for review.

## [2.2.2] - 2026-11-25

Homepage changes now apply only to the device where you save them, with fixes for cross-tab options updates and the recovery page's manual link.

> [!IMPORTANT]
> If you previously enabled homepage sync, follow the migration steps on each device after upgrading.

### Breaking Changes

- **Homepage sync**: Cross-device homepage sync has been removed. Homepage settings are now stored only on the current device.

**Migration:**

1. After reloading the updated extension, open a new tab on each device that previously used sync. The extension imports the last synced homepage that Chrome can read and saves it locally.
2. If Chrome temporarily cannot read the synced address, the extension opens the local homepage and retries on a later settings read. To choose an address immediately, open Options on that device and save the address you want.

### Fixed

- The recovery page’s manual link opens the configured homepage when it is available.

### Maintenance & Dependencies

- Updated the installation instructions to use the current repository URL and renamed the Simplified Chinese introduction to `README-zh-CN.md`.
- Moved the [browser test report](./docs/实机测试报告.md) and its [screenshots](./docs/screenshots/) under `docs/`.

## [2.2.1] - 2026-11-12

The options page offers a retry when the settings script fails to load. Storage warnings follow the browser language.

### Changed

- Failed saves now show the underlying error message when one is available.
- Warnings for invalid local or synced homepage URLs and failed sync reads are available in English and Simplified Chinese.

### Fixed

- If `settings.js` fails to load, the options page keeps the form disabled, shows an error, and offers a button to reload the page.

### Maintenance & Dependencies

- Split the project introduction into linked English and Simplified Chinese pages and added a bilingual changelog.

## [2.2.0] - 2026-11-12

The first release lets Chrome open a homepage of your choice in every new tab. The default is Kagi.

### Added

- Choose a preset or enter a custom HTTP or HTTPS homepage. The extension validates the URL before saving and uses a local copy of the address to start the redirect as the new tab loads.
- Keep the homepage on the current device by default, or opt in to syncing the address through Chrome.
- Use the recovery page to open the homepage manually, return to the options page, or retry when a redirect stalls or fails.
- Use the options and recovery pages in English or Simplified Chinese. The extension follows the browser language and falls back to English.
- The extension requests only the `storage` permission and loads site icons locally.

[Unreleased]: https://github.com/YE4IM/chrome-new-tab-page/compare/v2.3.0...main
[2.3.0]: https://github.com/YE4IM/chrome-new-tab-page/compare/v2.2.2...v2.3.0
[2.2.2]: https://github.com/YE4IM/chrome-new-tab-page/compare/v2.2.1...v2.2.2
[2.2.1]: https://github.com/YE4IM/chrome-new-tab-page/compare/v2.2.0...v2.2.1
[2.2.0]: https://github.com/YE4IM/chrome-new-tab-page/releases/tag/v2.2.0
