/**
 * Details! Actor Breakdown Modal Window
 */
import { DetailsTracker } from "./tracker.mjs";

export class DetailsActorBreakdown extends Application {
  constructor(actorId, segmentId = "current", options = {}) {
    super(options);
    this.actorId = actorId;
    this.segmentId = segmentId;
    this.activeTab = "abilities"; // "abilities" or "targets"
  }

  static get defaultOptions() {
    const mergeObj = foundry.utils?.mergeObject || mergeObject;
    return mergeObj(super.defaultOptions, {
      id: "details-actor-breakdown",
      title: "Details! Actor Breakdown",
      template: "modules/details-5e/templates/actor-breakdown.hbs",
      classes: ["details-window", "details-breakdown-window"],
      width: 540,
      height: 400,
      resizable: true,
      popOut: true
    });
  }

  getData() {
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

    // Process Abilities List
    const abilitiesList = Object.values(combatant.abilities || {}).map(ab => {
      const avg = ab.hits > 0 ? Math.round(ab.total / ab.hits) : 0;
      const pct = combatant.damageDealt > 0 ? Math.round((ab.total / combatant.damageDealt) * 100) : 0;
      return {
        ...ab,
        avg,
        pct,
        formattedTotal: this._formatNumber(ab.total)
      };
    }).sort((a, b) => b.total - a.total);

    // Process Targets List
    const targetsList = Object.values(combatant.targets || {}).map(tg => {
      const pct = combatant.damageDealt > 0 ? Math.round((tg.total / combatant.damageDealt) * 100) : 0;
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

  activateListeners(html) {
    super.activateListeners(html);

    html.find(".details-tab-btn").on("click", (e) => {
      this.activeTab = $(e.currentTarget).data("tab");
      this.render(false);
    });
  }

  _formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
    if (num >= 1000) return (num / 1000).toFixed(1) + "k";
    return num.toString();
  }
}
