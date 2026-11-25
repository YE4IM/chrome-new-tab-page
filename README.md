<a href="https://opc.fish"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/YE4IM/readme/main/project%20readme/assets/opc-fish-project-signature-web-dark.svg"><img src="https://raw.githubusercontent.com/YE4IM/readme/main/project%20readme/assets/opc-fish-project-signature.svg" alt="OPC.FISH Project" width="720"></picture></a>

# Homepage New Tab

[**English**](./README.md) | [中文](./README-zh-CN.md)

A Chrome extension that opens a website of your choice in every new tab.

[Go to installation](#installation)

<img src="./docs/screenshots/options-2.2.2.png" alt="Homepage settings with Google selected and https://www.google.com/ filled in" width="540">

## Contents

[Overview](#overview) · [Requirements](#requirements) · [Installation](#installation) · [Quick Start](#quick-start) · [Features](#features) · [Usage](#usage) · [Troubleshooting](#troubleshooting) · [Testing](#testing) · [Changelog](#changelog) · [License](#license)

## Overview

Use your search engine, work dashboard, or local service as the starting point for new tabs. The default destination is `https://kagi.com/`.

## Requirements

- Google Chrome with support for Manifest V3 and loading unpacked extensions.
- Git to clone the repository.

## Installation

1. Clone the repository.

   ```bash
   git clone https://github.com/YE4IM/chrome-new-tab-page.git
   ```

2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the `chrome-new-tab-page` directory containing `manifest.json`.

## Quick Start

Open a new tab after installation. With the default settings, it opens `https://kagi.com/`.

## Features

- Opens the saved homepage as the new tab loads, using a local copy of the address to start the redirect early.
- Stores your homepage on the current device.
- Uses only the `storage` permission. The extension loads its icons locally and connects to the destination through normal browser navigation.
- Shows the settings and recovery pages in English or Simplified Chinese based on the browser language, with English as the fallback.

## Usage

1. Open the extension's **Options** from its toolbar menu.
2. Choose Kagi, Google, Bing, or DuckDuckGo, or enter your own HTTP or HTTPS address. If you omit the scheme, the extension uses HTTPS. For a local HTTP service, enter the full address, such as `http://localhost:3000/`.
3. Click **Save settings** and open a new tab to check the destination.

To restore Kagi, choose **Restore default URL** and save.

To update, replace the files in the same directory and click **Reload** for the extension on `chrome://extensions`. When upgrading to 2.2.2 with homepage sync previously enabled, the extension copies the last synced homepage available to Chrome into local settings. If Chrome cannot read the synced address, the extension opens the local homepage and retries the migration the next time it loads settings. Saving an address in Options uses that address immediately.

## Troubleshooting

- If the new tab stays on the recovery page, use its homepage link, open the settings, or retry the redirect.

## Testing

Run the unit tests with Node.js from the repository root. They cover URL validation, settings migration and storage, the redirect cache, and recovery links.

```bash
node --test
```

See the [browser test report](./docs/实机测试报告.md) for the earlier manual checks and screenshots.

## Changelog

See the [bilingual changelog](./CHANGELOG.md) for version history.

## License

[MIT](./LICENSE)
