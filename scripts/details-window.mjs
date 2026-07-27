/**
 * Floating Details! Damage Meter UI Window
 */
import { DetailsTracker } from "./tracker.mjs";
import { DetailsActorBreakdown } from "./actor-breakdown.mjs";

export class DetailsWindow extends Application {
  constructor(options = {}) {
    super(options);
    this.currentMode = "dpt"; // "dpt", "hpt", "dtpt", "threat"
    this.currentSegmentId = "current";
    this.tracker = DetailsTracker.get();
    
    // Subscribe to tracker updates
    this.tracker.onChange(() => {
      if (this.rendered) this.render(false);
    });
  }

  static get defaultOptions() {
    const mergeObj = foundry.utils?.mergeObject || mergeObject;
    let savedPos = {};
    try {
      savedPos = game.settings.get("details-5e", "windowPosition") || {};
    } catch (e) {}

    return mergeObj(super.defaultOptions, {
      id: "details-meter-window",
      title: "Details! Damage Meter",
      template: "modules/details-5e/templates/details-window.hbs",
      classes: ["details-window"],
      width: savedPos.width || 350,
      height: savedPos.height || 280,
      top: savedPos.top,
      left: savedPos.left,
      resizable: true,
      minimizable: true,
      popOut: true
    });
  }

  async close(options = {}) {
    try {
      const pos = this.position;
      if (pos && typeof pos.left === "number") {
        game.settings.set("details-5e", "windowPosition", {
          top: pos.top,
          left: pos.left,
          width: pos.width,
          height: pos.height
        });
      }
    } catch (err) {}
    return super.close(options);
  }

  getData() {
    const tracker = this.tracker;
    let targetSegment = tracker.segments.find(s => s.id === this.currentSegmentId);
    if (!targetSegment && this.currentSegmentId.startsWith("combat_")) {
      targetSegment = tracker.pastCombats.find(s => s.id === this.currentSegmentId);
    }
    if (!targetSegment) targetSegment = tracker.segments[1]; // default to current

    const combatantsRaw = Object.values(targetSegment.combatants || {});
    const rounds = Math.max(1, targetSegment.rounds || 1);

    // Filter & Sort by current mode
    let metricKey = "damageDealt";
    if (this.currentMode === "hpt" || this.currentMode === "hps") metricKey = "healingDone";
    else if (this.currentMode === "dtpt" || this.currentMode === "dtps") metricKey = "damageTaken";

    const sorted = combatantsRaw
      .map(c => ({
        ...c,
        value: c[metricKey] || 0,
        rate: Math.round(((c[metricKey] || 0) / rounds) * 10) / 10
      }))
      .filter(c => c.value > 0)
      .sort((a, b) => b.value - a.value);

    const totalValue = sorted.reduce((sum, c) => sum + c.value, 0);
    const maxValue = sorted.length > 0 ? sorted[0].value : 1;

    const rows = sorted.map((c, index) => {
      const pctOfMax = Math.min(100, Math.round((c.value / maxValue) * 100));
      const pctOfTotal = totalValue > 0 ? Math.round((c.value / totalValue) * 100) : 0;
      
      const classInfo = this._getClassColorInfo(c.className);

      return {
        ...c,
        rank: index + 1,
        pctOfMax,
        pctOfTotal,
        barClass: classInfo.barClass,
        customStyle: classInfo.customStyle,
        formattedValue: this._formatNumber(c.value),
        formattedRate: `${this._formatNumber(c.rate)}/turn`
      };
    });

    const availableSegments = [
      ...tracker.segments,
      ...tracker.pastCombats
    ];

    return {
      rows,
      hasRows: rows.length > 0,
      currentMode: this.currentMode,
      currentSegmentId: this.currentSegmentId,
      availableSegments,
      modeOptions: [
        { id: "dpt", label: "Damage Dealt (DPT)" },
        { id: "hpt", label: "Healing Done (HPT)" },
        { id: "dtpt", label: "Damage Taken (DTPT)" }
      ]
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    // Mode Selector Change
    html.find("#details-mode-select").on("change", (e) => {
      this.currentMode = e.target.value;
      this.render(false);
    });

    // Segment Selector Change
    html.find("#details-segment-select").on("change", (e) => {
      this.currentSegmentId = e.target.value;
      this.render(false);
    });

    // Reset Button Click
    html.find("#details-reset-btn").on("click", () => {
      Dialog.confirm({
        title: "Reset Details! Data",
        content: "<p>Are you sure you want to reset current combat meter data?</p>",
        yes: () => this.tracker.resetCurrent(),
        defaultYes: false
      });
    });

    // Single Click Actor Row: Open Detailed Breakdown
    html.find(".details-row").on("click", (e) => {
      const actorId = $(e.currentTarget).data("actor-id");
      if (actorId) {
        new DetailsActorBreakdown(actorId, this.currentSegmentId).render(true);
      }
    });

    // Double Click Actor Row: Open Character Sheet
    html.find(".details-row").on("dblclick", (e) => {
      e.preventDefault();
      const actorId = $(e.currentTarget).data("actor-id");
      if (actorId) {
        const actor = game.actors.get(actorId) || canvas.tokens?.placeables.find(t => t.id === actorId || t.actor?.id === actorId)?.actor;
        actor?.sheet?.render(true);
      }
    });

    // Right Click Actor Row: Pan camera to token & ping on canvas
    html.find(".details-row").on("contextmenu", (e) => {
      e.preventDefault();
      const actorId = $(e.currentTarget).data("actor-id");
      if (!actorId) return;
      const token = canvas.tokens?.placeables.find(t => t.actor?.id === actorId || t.id === actorId);
      if (token) {
        canvas.animatePan({ x: token.x, y: token.y, scale: Math.max(1, canvas.stage.scale.x) });
        if (typeof token.ping === "function") token.ping();
      }
    });
  }

  _getClassColorInfo(className) {
    const recognized = [
      "barbarian", "bard", "cleric", "druid", "fighter", "monk",
      "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard",
      "artificer", "bloodhunter", "npc"
    ];
    const clean = (className || "default").toLowerCase().replace(/[^a-z0-9]/g, "");

    // Check if clean matches or starts with any recognized class
    const found = recognized.find(r => clean.includes(r));
    if (found) {
      return { barClass: `bar-${found}`, customStyle: "" };
    }

    // Deterministic HSL color generator for unrecognized / custom homebrew classes
    let hash = 0;
    for (let i = 0; i < clean.length; i++) {
      hash = clean.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    const gradient = `background: linear-gradient(90deg, hsl(${hue}, 65%, 25%) 0%, hsl(${hue}, 80%, 48%) 100%) !important;`;
    return { barClass: "bar-custom", customStyle: gradient };
  }

  _formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
    if (num >= 1000) return (num / 1000).toFixed(1) + "k";
    return num.toString();
  }
}
