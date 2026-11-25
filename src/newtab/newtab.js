'use strict';

const settingsApi = globalThis.HomepageSettings;
const rulesApi = globalThis.HomepageRules;
const DEFAULT_HOMEPAGE = rulesApi?.DEFAULT_HOMEPAGE || settingsApi?.DEFAULT_HOMEPAGE || 'https://kagi.com/';
let homepage = DEFAULT_HOMEPAGE;
let recoveryTimer;

const msg = (key) => chrome.i18n.getMessage(key) || '';

function updateHomepage(value) {
  homepage = value;
  const target = document.getElementById('target');
  if (target) target.href = homepage;
}

function showRecovery(text) {
  clearTimeout(recoveryTimer);
  if (!document.getElementById('recovery')) {
    document.documentElement.lang = chrome.i18n.getUILanguage();
    const main = document.createElement('main');
    main.id = 'recovery';
    main.innerHTML = [
      '<h1>' + msg('recoveryHeading') + '</h1>',
      '<p id="message" role="status"></p>',
      '<a id="target">' + msg('recoveryManual') + '</a>',
      '<a id="settings" href="' + chrome.runtime.getURL('src/options/options.html') + '">' + msg('recoverySettings') + '</a>',
      '<button type="button" id="retry">' + msg('recoveryRetry') + '</button>',
    ].join('');
    document.body.appendChild(main);
    document.getElementById('retry').addEventListener('click', () => location.reload());
  }
  updateHomepage(homepage);
  document.getElementById('message').textContent = text;
}

async function redirect() {
  const openedAt = new Date();
  const useConfig = (config) => updateHomepage(rulesApi.resolveHomepage(config, openedAt).homepage);

  // 先设置恢复计时器，确保快速跳转失败时手动链接仍可用。
  recoveryTimer = setTimeout(() => showRecovery(msg('recoverySlow')), 3000);
  const cachedConfig = settingsApi?.readHomepageMirror();
  if (cachedConfig) {
    useConfig(cachedConfig);
  } else {
    try {
      useConfig(await settingsApi.loadSettings(useConfig));
    } catch {
      // 等待本机读取期间，另一个标签页可能已重建缓存。
      const availableConfig = settingsApi?.readHomepageMirror();
      if (availableConfig) useConfig(availableConfig);
      showRecovery(msg('recoveryLoadFail'));
    }
  }
  try {
    location.replace(homepage);
  } catch {
    showRecovery(msg('recoveryRedirectFail'));
  }
}

redirect();
