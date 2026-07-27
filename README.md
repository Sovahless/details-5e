# Details! Damage Meter (D&D 5e for Foundry VTT)

A **WoW Details!**-inspired real-time damage meter, healing tracker, and combat analytics module for **Foundry Virtual Tabletop** tailored specifically for the **D&D 5e system**.

![Foundry v12/v13](https://img.shields.io/badge/Foundry-v12%20%7C%20v13-orange)
![dnd5e](https://img.shields.io/badge/dnd5e-%3E%3D3.0.0-blue)
![License](https://img.shields.io/badge/License-MIT-green)

---

## 🌟 Key Features

- **⚡ Damage Per Turn (DPT)**: Real-time turn-based tabletop analytics (`/turn`).
- **🛡️ Multiple Modes**:
  - **Damage Dealt (DPT)**
  - **Healing Done (HPT)**
  - **Damage Taken (DTPT)**
- **🎨 Translucent Black UI & Glassmorphism**: Sleek 0.35 opacity translucent black HUD window with smooth CSS animations, shimmer effects, and gold top rank highlights.
- **🌈 Dynamic Class Color Bars**:
  - Signature D&D 5e class gradients (Barbarian crimson, Wizard arcane blue, Paladin gold, Cleric ice white, Rogue yellow, Warlock violet, etc.).
  - Automatic dynamic HSL color generator for homebrew & custom classes.
- **🔍 Detailed Actor Breakdown**: Click any actor in the meter to open a pop-up modal inspecting ability damage, hits, crits, min/max/avg, and target distribution.
- **🎯 Interactive Canvas Shortcuts**:
  - **Left-Click**: Open Detailed Actor Breakdown.
  - **Right-Click**: Smoothly pan/zoom canvas camera to the actor's token and ping it.
  - **Double-Click**: Open character sheet.
- **💾 World State Data Persistence**: Overall stats and the past 10 combat encounters persist across page reloads and canvas transitions.
- **📌 Window Position Memory**: Automatically remembers floating meter window location and dimensions.

---

## 📦 Installation

Manifest URL for Foundry VTT:
```
https://github.com/Sovahless/details-5e/releases/latest/download/module.json
```

1. Open your **Foundry VTT** setup screen or in-game module browser.
2. Go to **Add-on Modules** -> **Install Module**.
3. Paste the Manifest URL above into the field at the bottom.
4. Click **Install**.
5. Enable **Details! Damage Meter (D&D 5e)** in your world's **Manage Modules** setting!

---

## ⚙️ Usage & Controls

- Click the **Details!** chart button (`fas fa-chart-bar`) on the left sidebar canvas controls (under Token tools).
- The meter will also automatically open upon entering combat if enabled in settings.

---

## 📄 License

Distributed under the [MIT License](LICENSE).
