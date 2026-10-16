/**
 * Floating Details! Damage Meter UI Window (ApplicationV2 - Foundry v12-v14)
 */
import { DetailsTracker } from "./tracker.mjs";
import { DetailsActorBreakdown } from "./actor-breakdown.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

export class DetailsWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    let savedPos = {};
    try {
      savedPos = game.settings.get("details-5e", "windowPosition") || {};
    } catch (e) {}

    const position = {
      width: savedPos.width || 360,
      height: savedPos.height || 290,
      ...(typeof savedPos.top === "number" ? { top: savedPos.top } : {}),
      ...(typeof savedPos.left === "number" ? { left: savedPos.left } : {})
    };

    super(foundry.utils.mergeObject({ position }, options));

    try {
      this.currentMode = game.settings.get("details-5e", "defaultMode") || "dpt";
    } catch (e) {
      this.currentMode = "dpt";
    }
    this.currentSegmentId = "current";
    this.tracker = DetailsTracker.get();

    // Subscribe to tracker updates
    this.tracker.onChange(() => {
      if (this.rendered) this.render();
    });
  }

  static DEFAULT_OPTIONS = {
    id: "details-meter-window",
    classes: ["details-window"],
    tag: "div",
    window: {
      title: "Details! Damage Meter",
      icon: "fa-solid fa-chart-bar",
      resizable: true,
      minimizable: true
    },
    position: {
      width: 360,
      height: 290
    }
  };

  static PARTS = {
    main: {
      template: "modules/details-5e/templates/details-window.hbs"
    }
  };

  async close(options = {}) {
    try {
      const pos = this.position;
      if (pos && typeof pos.left === "number") {
        await game.settings.set("details-5e", "windowPosition", {
          top: pos.top,
          left: pos.left,
          width: pos.width,
          height: pos.height
        });
      }
    } catch (err) {}
    return super.close(options);
  }

  async _prepareContext(options) {
    return this._buildMeterData();
  }

  _buildMeterData() {
    const tracker = this.tracker;
    let targetSegment = tracker.segments.find(s => s.id === this.currentSegmentId);
    if (!targetSegment && this.currentSegmentId.startsWith("combat_")) {
      targetSegment = tracker.pastCombats.find(s => s.id === this.currentSegmentId);
    }
    if (!targetSegment) targetSegment = tracker.segments[1];

    const combatantsRaw = Object.values(targetSegment.combatants || {});
    const rounds = Math.max(1, targetSegment.rounds || 1);

    let metricKey = "damageDealt";
    let modeTitle = "Damage Dealt (DPT)";
    if (this.currentMode === "hpt" || this.currentMode === "hps") {
      metricKey = "healingDone";
      modeTitle = "Healing Done (HPT)";
    } else if (this.currentMode === "dtpt" || this.currentMode === "dtps") {
      metricKey = "damageTaken";
      modeTitle = "Damage Taken (DTPT)";
    }

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
      segmentName: targetSegment.name,
      modeTitle,
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

  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;
    if (!root) return;

    // Mode Selector Change
    const modeSelect = root.querySelector("#details-mode-select");
    modeSelect?.addEventListener("change", (e) => {
      this.currentMode = e.target.value;
      this.render();
    });

    // Segment Selector Change
    const segmentSelect = root.querySelector("#details-segment-select");
    segmentSelect?.addEventListener("change", (e) => {
      this.currentSegmentId = e.target.value;
      this.render();
    });

    // Report to Chat Button Click
    const reportBtn = root.querySelector("#details-report-btn");
    reportBtn?.addEventListener("click", () => this._reportToChat());

    // Reset Button Click
    const resetBtn = root.querySelector("#details-reset-btn");
    resetBtn?.addEventListener("click", async () => {
      if (DialogV2?.wait) {
        const choice = await DialogV2.wait({
          window: { title: "Reset Details! Data", icon: "fa-solid fa-rotate-right" },
          content: "<p>Which combat meter data would you like to reset?</p>",
          buttons: [
            {
              action: "current",
              label: "Current Combat",
              icon: "fa-solid fa-broom",
              default: true,
              callback: () => "current"
            },
            {
              action: "all",
              label: "All Data (Overall)",
              icon: "fa-solid fa-trash",
              callback: () => "all"
            },
            {
              action: "cancel",
              label: "Cancel",
              icon: "fa-solid fa-xmark",
              callback: () => null
            }
          ],
          close: () => null
        });
        if (choice === "current") this.tracker.resetCurrent();
        else if (choice === "all") this.tracker.resetAll();
      } else {
        this.tracker.resetCurrent();
      }
    });

    // Actor Row Interactions
    const actorRows = root.querySelectorAll(".details-row");
    for (const row of actorRows) {
      // Single Click: Open Detailed Breakdown
      row.addEventListener("click", (e) => {
        const actorId = row.dataset.actorId;
        if (actorId) {
          DetailsActorBreakdown.openFor(actorId, this.currentSegmentId);
        }
      });

      // Double Click: Open Character Sheet
      row.addEventListener("dblclick", (e) => {
        e.preventDefault();
        const actorId = row.dataset.actorId;
        if (actorId) {
          const actor =
            game.actors?.get(actorId) ||
            canvas.tokens?.placeables?.find(t => t.id === actorId || t.actor?.id === actorId)?.actor;
          actor?.sheet?.render(true);
        }
      });

      // Right Click: Pan camera to token & ping on canvas
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const actorId = row.dataset.actorId;
        if (!actorId) return;
        const token = canvas.tokens?.placeables?.find(t => t.actor?.id === actorId || t.id === actorId);
        if (token) {
          const center = token.center || { x: token.x, y: token.y };
          canvas.animatePan({ x: center.x, y: center.y, scale: Math.max(1, canvas.stage?.scale?.x || 1) });
          if (typeof canvas.ping === "function") canvas.ping(center);
        }
      });
    }
  }

  async _reportToChat() {
    const data = this._buildMeterData();
    if (!data.hasRows) {
      ui.notifications?.warn("Details! 5e | No combat data to report.");
      return;
    }

    const lines = data.rows.slice(0, 10).map(r => {
      return `<div style="display:flex;justify-content:space-between;padding:2px 4px;border-bottom:1px solid rgba(255,255,255,0.08);font-size:12px;">
        <span><strong>${r.rank}.</strong> ${foundry.utils.escapeHTML(r.name)}</span>
        <span><strong>${r.formattedValue}</strong> <span style="opacity:0.75;">(${r.formattedRate}, ${r.pctOfTotal}%)</span></span>
      </div>`;
    }).join("");

    const content = `
      <div class="details-chat-report" style="background:rgba(15,20,30,0.92);color:#fff;border:1px solid rgba(255,215,0,0.4);border-radius:6px;padding:8px;">
        <div style="font-weight:bold;color:#ffd700;border-bottom:1px solid rgba(255,215,0,0.3);padding-bottom:4px;margin-bottom:6px;font-size:13px;">
          <i class="fas fa-chart-bar"></i> Details! — ${foundry.utils.escapeHTML(data.modeTitle)} (${foundry.utils.escapeHTML(data.segmentName)})
        </div>
        ${lines}
      </div>
    `;

    await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker()
    });
  }

  _getClassColorInfo(className) {
    const recognized = [
      "barbarian", "bard", "cleric", "druid", "fighter", "monk",
      "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard",
      "artificer", "bloodhunter", "npc"
    ];
    const clean = (className || "default").toLowerCase().replace(/[^a-z0-9]/g, "");

    const found = recognized.find(r => clean.includes(r));
    if (found) {
      return { barClass: `bar-${found}`, customStyle: "" };
    }

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
