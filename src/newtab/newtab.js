'use strict';

const settingsApi = globalThis.HomepageSettings;
const DEFAULT_HOMEPAGE = settingsApi?.DEFAULT_HOMEPAGE || 'https://kagi.com/';
const cachedHomepage = settingsApi?.readHomepageMirror();
let homepage = cachedHomepage || DEFAULT_HOMEPAGE;
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
  // 先设置恢复计时器：快速导航发起后，Chrome 可能会中止对当前页面的 HTML 解析。
  recoveryTimer = setTimeout(() => showRecovery(msg('recoverySlow')), 3000);
  let fastRedirectHomepage;
  if (cachedHomepage) {
    try {
      location.replace(cachedHomepage);
      fastRedirectHomepage = cachedHomepage;
    } catch { /* 读取设置后再尝试。 */ }
  }
  try {
    const settings = await settingsApi.loadSettings(updateHomepage);
    updateHomepage(settings.homepage);
  } catch {
    updateHomepage(settingsApi?.readHomepageMirror() || homepage);
    showRecovery(msg('recoveryLoadFail'));
  }
  if (homepage === fastRedirectHomepage) return;
  try {
    location.replace(homepage);
  } catch {
    showRecovery(msg('recoveryRedirectFail'));
  }
}

redirect();
