/**
 * Details! Damage Meter for Foundry VTT (D&D 5e)
 * Main Entry Point
 */
import { DetailsTracker } from "./tracker.mjs";
import { DetailsWindow } from "./details-window.mjs";
import { DetailsActorBreakdown } from "./actor-breakdown.mjs";

let detailsApp = null;

Hooks.once("init", () => {
  console.log("Details! 5e | Initializing Details! Damage Meter Module...");

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
  Handlebars.registerHelper("eq", function (a, b) {
    return a === b;
  });
});

Hooks.once("ready", () => {
  console.log("Details! 5e | Module Ready.");
  
  // Initialize Tracker Engine Hooks
  const tracker = DetailsTracker.get();
  tracker.initHooks();

  // Create UI Application Instance
  detailsApp = new DetailsWindow();

  // Expose API
  game.modules.get("details-5e").api = {
    tracker,
    window: detailsApp,
    openMeter: () => detailsApp.render(true),
    closeMeter: () => detailsApp.close(),
    toggleMeter: () => {
      if (detailsApp.rendered) detailsApp.close();
      else detailsApp.render(true);
    },
    openBreakdown: (actorId, segmentId) => new DetailsActorBreakdown(actorId, segmentId).render(true)
  };
});

// Auto-open on combat start if enabled
Hooks.on("combatStart", () => {
  if (game.settings.get("details-5e", "autoOpenOnCombat")) {
    if (detailsApp && !detailsApp.rendered) {
      detailsApp.render(true);
    }
  }
});

// Add HUD button in left control palette under Token controls
Hooks.on("getSceneControlButtons", (controls) => {
  let tokenControls = null;
  if (Array.isArray(controls)) {
    tokenControls = controls.find(c => c?.name === "token" || c?.name === "tokens");
  } else if (controls && typeof controls === "object") {
    tokenControls = controls.token || controls.tokens || Object.values(controls).find(c => c?.name === "token" || c?.name === "tokens");
  }

  if (tokenControls) {
    const tool = {
      name: "details-meter",
      title: "Toggle Details! Damage Meter",
      icon: "fas fa-chart-bar details-hud-icon",
      visible: true,
      onClick: () => {
        if (detailsApp) {
          if (detailsApp.rendered) detailsApp.close();
          else detailsApp.render(true);
        }
      },
      button: true
    };

    if (Array.isArray(tokenControls.tools)) {
      tokenControls.tools.push(tool);
    } else if (tokenControls.tools && typeof tokenControls.tools === "object") {
      tokenControls.tools["details-meter"] = tool;
    }
  }
});
