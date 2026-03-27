// Minimal service worker for badge updates
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "badge" && typeof message.count === "number") {
    const text = message.count > 0 ? String(message.count) : "";
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color: "#00000000" });
    chrome.action.setBadgeTextColor({ color: "#d4af37" });
  }
});
