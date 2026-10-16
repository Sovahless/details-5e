/**
 * Details! Damage Meter for Foundry VTT (D&D 5e)
 * Main Entry Point (Foundry v12-v14 & D&D 5e v3-v6+)
 */
import { DetailsTracker } from "./tracker.mjs";
import { DetailsWindow } from "./details-window.mjs";
import { DetailsActorBreakdown } from "./actor-breakdown.mjs";

let detailsApp = null;
let _lastToggleTime = 0;

function toggleDetailsWindow() {
  const now = Date.now();
  if (now - _lastToggleTime < 150) return;
  _lastToggleTime = now;

  if (!detailsApp) {
    detailsApp = new DetailsWindow();
  }
  if (detailsApp.rendered) {
    detailsApp.close();
  } else {
    detailsApp.render({ force: true });
  }
}

Hooks.once("init", () => {
  console.log("Details! 5e | Initializing Details! Damage Meter Module v2.0.0...");

  // Register Settings
  game.settings.register("details-5e", "autoOpenOnCombat", {
    name: "Auto-Open on Combat",
    hint: "Automatically opens the Details! damage meter when combat starts.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register("details-5e", "defaultMode", {
    name: "Default Meter Mode",
    hint: "Default mode to show when opening the window.",
    scope: "client",
    config: true,
    type: String,
    choices: {
      "dpt": "Damage Dealt (DPT)",
      "hpt": "Healing Done (HPT)",
      "dtpt": "Damage Taken (DTPT)"
    },
    default: "dpt"
  });

  game.settings.register("details-5e", "trackerData", {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register("details-5e", "windowPosition", {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  // Handlebars Helpers
  if (!Handlebars.helpers?.eq) {
    Handlebars.registerHelper("eq", function (a, b) {
      return a === b;
    });
  }
});

Hooks.once("setup", () => {
  if (game.keybindings?.register) {
    game.keybindings.register("details-5e", "toggleMeter", {
      name: "Toggle Details! Damage Meter",
      hint: "Opens or closes the Details! real-time damage and healing meter window.",
      editable: [{ key: "KeyD", modifiers: ["Alt"] }],
      onDown: () => {
        toggleDetailsWindow();
        return true;
      }
    });
  }
});

Hooks.once("ready", () => {
  console.log("Details! 5e | Module Ready.");

  // Initialize Tracker Engine Hooks
  const tracker = DetailsTracker.get();
  tracker.initHooks();

  // Create UI Application Instance
  detailsApp = new DetailsWindow();

  // Expose API
  const mod = game.modules.get("details-5e");
  if (mod) {
    mod.api = {
      tracker,
      window: detailsApp,
      openMeter: () => detailsApp.render({ force: true }),
      closeMeter: () => detailsApp.close(),
      toggleMeter: () => toggleDetailsWindow(),
      openBreakdown: (actorId, segmentId) => DetailsActorBreakdown.openFor(actorId, segmentId)
    };
  }
});

// Auto-open on combat start if enabled
Hooks.on("combatStart", () => {
  if (game.settings.get("details-5e", "autoOpenOnCombat")) {
    if (detailsApp && !detailsApp.rendered) {
      detailsApp.render({ force: true });
    }
  }
});

// Add HUD button in left control palette under Token controls (v12, v13, v14 compatible)
Hooks.on("getSceneControlButtons", (controls) => {
  let tokenControls = null;
  if (Array.isArray(controls)) {
    tokenControls = controls.find(c => c?.name === "token" || c?.name === "tokens");
  } else if (controls && typeof controls === "object") {
    tokenControls = controls.tokens || controls.token || Object.values(controls).find(c => c?.name === "token" || c?.name === "tokens");
  }

  if (tokenControls) {
    const tool = {
      name: "details-meter",
      title: "Toggle Details! Damage Meter",
      icon: "fa-solid fa-chart-bar details-hud-icon",
      visible: true,
      button: true,
      onChange: () => toggleDetailsWindow(),
      onClick: () => toggleDetailsWindow()
    };

    if (Array.isArray(tokenControls.tools)) {
      tokenControls.tools.push(tool);
    } else if (tokenControls.tools && typeof tokenControls.tools === "object") {
      tokenControls.tools["details-meter"] = tool;
    }
  }
});
