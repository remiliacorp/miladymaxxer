import { DEFAULT_SETTINGS } from "./shared/constants";
import { loadSettings, saveSettings } from "./shared/storage";
import type { FilterMode } from "./shared/types";

const styles = document.createElement("style");
styles.textContent = `
  :root {
    color-scheme: dark;
    font-family: ui-sans-serif, system-ui, sans-serif;
  }

  body {
    margin: 0;
    background: linear-gradient(160deg, #120f17 0%, #23122d 100%);
    color: #f5f3ff;
    min-width: 280px;
  }

  .popup {
    padding: 18px 16px;
  }

  h1 {
    margin: 0 0 8px;
    font-size: 18px;
  }

  .lede,
  .footnote {
    margin: 0;
    color: #d8d1e8;
    font-size: 13px;
    line-height: 1.5;
  }

  .mode-form {
    display: grid;
    gap: 10px;
    margin: 16px 0;
  }

  .mode-form label {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid rgba(216, 209, 232, 0.15);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.04);
  }
`;
document.head.append(styles);

void init();

async function init(): Promise<void> {
  const form = document.getElementById("mode-form");
  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  const settings = await loadSettings();
  setModeSelection(form, settings.mode);

  form.addEventListener("change", async () => {
    const mode = getSelectedMode(form);
    await saveSettings({
      mode,
    });
  });
}

function getSelectedMode(form: HTMLFormElement): FilterMode {
  const selected = new FormData(form).get("mode");
  if (
    selected === "hide" ||
    selected === "scale" ||
    selected === "fade" ||
    selected === "off"
  ) {
    return selected;
  }
  return DEFAULT_SETTINGS.mode;
}

function setModeSelection(form: HTMLFormElement, mode: FilterMode): void {
  const input = form.querySelector<HTMLInputElement>(`input[name="mode"][value="${mode}"]`);
  if (input) {
    input.checked = true;
  }
}
