// Minimal service worker for badge updates
// Draws count directly on icon to avoid badge box

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "badge" && typeof message.count === "number") {
    void updateIconWithCount(message.count);
  }
});

async function updateIconWithCount(count: number): Promise<void> {
  if (count <= 0) {
    await chrome.action.setIcon({ path: "milady-logo.png" });
    await chrome.action.setBadgeText({ text: "" });
    return;
  }

  try {
    const canvas = new OffscreenCanvas(128, 128);
    const ctx = canvas.getContext("2d")!;

    const response = await fetch(chrome.runtime.getURL("milady-logo.png"));
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    ctx.drawImage(bitmap, 0, 0, 128, 128);

    const text = String(count);
    ctx.font = "bold 52px sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.lineJoin = "round";

    // White outer outline for legibility
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 12;
    ctx.strokeText(text, 122, 124);

    // Black inner outline
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 6;
    ctx.strokeText(text, 122, 124);

    // Green fill
    ctx.fillStyle = "#3d6510";
    ctx.fillText(text, 122, 124);

    const imageData = ctx.getImageData(0, 0, 128, 128);
    await chrome.action.setIcon({ imageData: { 128: imageData } });
    await chrome.action.setBadgeText({ text: "" });
  } catch {
    // Fallback to regular badge if OffscreenCanvas fails
    await chrome.action.setBadgeText({ text: String(count) });
    await chrome.action.setBadgeBackgroundColor({ color: [0, 0, 0, 0] });
    await chrome.action.setBadgeTextColor({ color: "#2f4d0c" });
  }
}
