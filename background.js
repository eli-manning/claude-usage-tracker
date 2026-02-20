// background.js - Service worker

const ALARM_NAME = 'fetch-usage';
const HISTORY_KEY = 'usageHistory';
const LATEST_KEY = 'latestUsage';
const BADGE_PREF_KEY = 'badgePreference';
const MAX_HISTORY = 200;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'USAGE_DATA') {
    saveUsageData(message.data);
  }
  if (message.type === 'UPDATE_BADGE') {
    updateBadge(message.value);
  }
});

async function saveUsageData(data) {
  const result = await chrome.storage.local.get([HISTORY_KEY, LATEST_KEY, BADGE_PREF_KEY]);
  const history = result[HISTORY_KEY] || [];
  const latest = result[LATEST_KEY];
  const pref = result[BADGE_PREF_KEY] || 'weekly';

  if (latest) {
    const timeDiff = data.timestamp - latest.timestamp;
    if (timeDiff < 5 * 60 * 1000 && latest.session === data.session && latest.weekly === data.weekly) return;
  }

  history.push(data);
  if (history.length > MAX_HISTORY) history.shift();

  await chrome.storage.local.set({ [HISTORY_KEY]: history, [LATEST_KEY]: data });

  // Badge shows whichever metric the user prefers
  const badgeVal = pref === 'session' ? data.session : data.weekly;
  updateBadge(badgeVal);

  checkThresholds(data, latest);
}

function updateBadge(pct) {
  if (pct === null || pct === undefined) return;
  const text = pct >= 100 ? '!!' : pct + '%';
  const color = pct >= 90 ? '#c85c5c' : pct >= 70 ? '#d4a843' : '#CC785C';
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

function checkThresholds(data, previous) {
  if (!previous) return;
  const thresholds = [75, 90, 100];
  for (const threshold of thresholds) {
    if (previous.weekly < threshold && data.weekly >= threshold) {
      chrome.notifications.create({
        type: 'basic', iconUrl: 'icons/icon48.png',
        title: 'Claude Usage Alert',
        message: `Weekly usage hit ${threshold}%.`
      });
    }
    if (previous.session < threshold && data.session >= threshold) {
      chrome.notifications.create({
        type: 'basic', iconUrl: 'icons/icon48.png',
        title: 'Claude Usage Alert',
        message: `Session usage hit ${threshold}%.`
      });
    }
  }
}

function openSettingsTab() {
  chrome.tabs.create({ url: 'https://claude.ai/settings/usage', active: false }, (tab) => {
    setTimeout(() => chrome.tabs.remove(tab.id).catch(() => {}), 15000);
  });
}

chrome.alarms.create(ALARM_NAME, { periodInMinutes: 30 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  const tabs = await chrome.tabs.query({ url: 'https://claude.ai/settings/usage*' });
  if (tabs.length > 0) return;
  openSettingsTab();
});

chrome.runtime.onInstalled.addListener(() => openSettingsTab());
