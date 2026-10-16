/**
 * Details! Actor Breakdown Modal Window (ApplicationV2 - Foundry v12-v14)
 */
import { DetailsTracker } from "./tracker.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class DetailsActorBreakdown extends HandlebarsApplicationMixin(ApplicationV2) {
  static currentInstance = null;

  constructor(actorId, segmentId = "current", options = {}) {
    super(options);
    this.actorId = actorId;
    this.segmentId = segmentId;
    this.activeTab = "abilities"; // "abilities" or "targets"
    this._unsubscribe = DetailsTracker.get().onChange(() => {
      if (this.rendered) this.render();
    });
  }

  static openFor(actorId, segmentId = "current") {
    if (DetailsActorBreakdown.currentInstance) {
      const inst = DetailsActorBreakdown.currentInstance;
      inst.actorId = actorId;
      inst.segmentId = segmentId;
      inst.render({ force: true });
      inst.bringToFront?.();
      return inst;
    }
    const inst = new DetailsActorBreakdown(actorId, segmentId);
    DetailsActorBreakdown.currentInstance = inst;
    inst.render({ force: true });
    return inst;
  }

  static DEFAULT_OPTIONS = {
    id: "details-actor-breakdown",
    classes: ["details-window", "details-breakdown-window"],
    tag: "div",
    window: {
      title: "Details! Actor Breakdown",
      icon: "fa-solid fa-magnifying-glass-chart",
      resizable: true,
      minimizable: true
    },
    position: {
      width: 540,
      height: 400
    }
  };

  static PARTS = {
    main: {
      template: "modules/details-5e/templates/actor-breakdown.hbs"
    }
  };

  async close(options = {}) {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    if (DetailsActorBreakdown.currentInstance === this) {
      DetailsActorBreakdown.currentInstance = null;
    }
    return super.close(options);
  }

  async _prepareContext(options) {
    const tracker = DetailsTracker.get();
    let segment = tracker.segments.find(s => s.id === this.segmentId);
    if (!segment && this.segmentId.startsWith("combat_")) {
      segment = tracker.pastCombats.find(s => s.id === this.segmentId);
    }
    if (!segment) segment = tracker.segments[1];

    const combatant = segment?.combatants?.[this.actorId];
    if (!combatant) {
      return { hasData: false, actorName: "Unknown Actor" };
    }

    const totalActionPool = (combatant.damageDealt || 0) + (combatant.healingDone || 0);

    // Process Abilities List
    const abilitiesList = Object.values(combatant.abilities || {}).map(ab => {
      const avg = ab.hits > 0 ? Math.round(ab.total / ab.hits) : 0;
      const denom = ab.type === "healing"
        ? (combatant.healingDone || totalActionPool)
        : (combatant.damageDealt || totalActionPool);
      const pct = denom > 0 ? Math.min(100, Math.round((ab.total / denom) * 100)) : 0;
      return {
        ...ab,
        avg,
        pct,
        formattedTotal: this._formatNumber(ab.total)
      };
    }).sort((a, b) => b.total - a.total);

    // Process Targets List
    const totalTargeted = Object.values(combatant.targets || {}).reduce((s, t) => s + (t.total || 0), 0);
    const targetsList = Object.values(combatant.targets || {}).map(tg => {
      const denom = totalTargeted > 0 ? totalTargeted : (combatant.damageDealt || 1);
      const pct = denom > 0 ? Math.min(100, Math.round((tg.total / denom) * 100)) : 0;
      return {
        ...tg,
        pct,
        formattedTotal: this._formatNumber(tg.total)
      };
    }).sort((a, b) => b.total - a.total);

    return {
      hasData: true,
      actor: combatant,
      activeTab: this.activeTab,
      isAbilitiesTab: this.activeTab === "abilities",
      isTargetsTab: this.activeTab === "targets",
      abilitiesList,
      targetsList,
      formattedDamage: this._formatNumber(combatant.damageDealt),
      formattedHealing: this._formatNumber(combatant.healingDone),
      formattedTaken: this._formatNumber(combatant.damageTaken)
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;
    if (!root) return;

    const tabBtns = root.querySelectorAll(".details-tab-btn");
    for (const btn of tabBtns) {
      btn.addEventListener("click", () => {
        this.activeTab = btn.dataset.tab || "abilities";
        this.render();
      });
    }
  }

  _formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
    if (num >= 1000) return (num / 1000).toFixed(1) + "k";
    return num.toString();
  }
}
