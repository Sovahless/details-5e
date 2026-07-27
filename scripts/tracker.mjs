/**
 * Details! Data Tracker Engine for D&D 5e
 */

export class DetailsTracker {
  static instance = null;

  constructor() {
    DetailsTracker.instance = this;
    this.segments = [
      { id: "overall", name: "Overall Data", duration: 0, combatants: {} },
      { id: "current", name: "Current Combat", duration: 0, combatants: {} }
    ];
    this.activeSegmentId = "current";
    this.combatStartTime = null;
    this.isCombatActive = false;
    this.pastCombats = [];
    this.listeners = new Set();
    this._saveTimeout = null;
  }

  static get() {
    if (!DetailsTracker.instance) {
      DetailsTracker.instance = new DetailsTracker();
    }
    return DetailsTracker.instance;
  }

  initHooks() {
    // Load persisted world state
    this.loadSavedData();

    // Combat lifecycle hooks
    Hooks.on("combatStart", (combat) => this.onCombatStart(combat));
    Hooks.on("deleteCombat", (combat) => this.onCombatEnd(combat));
    Hooks.on("updateCombat", (combat, change) => this.onCombatUpdate(combat, change));

    // D&D 5e System & Midi-QoL Damage / Healing Hooks
    Hooks.on("dnd5e.rollDamage", (item, roll) => this.onDamageRoll(item, roll));
    Hooks.on("dnd5e.rollHealing", (item, roll) => this.onHealingRoll(item, roll));
    Hooks.on("dnd5e.applyDamage", (actor, damageData) => this.onApplyDamage(actor, damageData));
    Hooks.on("updateActor", (actor, change, options, userId) => this.onUpdateActor(actor, change, options, userId));
    Hooks.on("midi-qol.RollComplete", (workflow) => this.onMidiRollComplete(workflow));

    // Socket synchronization listener
    game.socket?.on("module.details-5e", (packet) => this.onSocketMessage(packet));
  }

  loadSavedData() {
    try {
      const saved = game.settings.get("details-5e", "trackerData");
      if (saved && typeof saved === "object") {
        if (saved.overall && typeof saved.overall === "object") {
          this.segments[0] = saved.overall;
        }
        if (Array.isArray(saved.pastCombats)) {
          this.pastCombats = saved.pastCombats;
        }
      }
    } catch (err) {
      console.warn("Details Tracker | Failed to load persisted tracker data:", err);
    }
  }

  saveData() {
    if (!game.user.isGM) return;
    clearTimeout(this._saveTimeout);
    this._saveTimeout = setTimeout(() => {
      try {
        const dataToSave = {
          overall: this.segments[0],
          pastCombats: this.pastCombats.slice(0, 10)
        };
        game.settings.set("details-5e", "trackerData", dataToSave);
      } catch (err) {
        console.warn("Details Tracker | Failed to save tracker data:", err);
      }
    }, 2000);
  }

  onChange(callback) {
    this.listeners.add(callback);
  }

  notify() {
    for (const callback of this.listeners) {
      try {
        callback();
      } catch (err) {
        console.error("Details Tracker listener error:", err);
      }
    }
  }

  onCombatStart(combat) {
    this.isCombatActive = true;
    this.combatStartTime = Date.now();

    // Reset current combat segment
    const currentSegment = {
      id: `combat_${Date.now()}`,
      name: `Encounter #${this.pastCombats.length + 1}`,
      duration: 1,
      rounds: combat?.round || 1,
      combatants: {}
    };

    // Replace current segment
    this.segments[1] = currentSegment;
    this.notify();
  }

  onCombatEnd(combat) {
    if (!this.isCombatActive) return;
    this.isCombatActive = false;
    
    const current = this.segments[1];
    if (current && Object.keys(current.combatants).length > 0) {
      if (this.combatStartTime) {
        current.duration = Math.max(1, Math.round((Date.now() - this.combatStartTime) / 1000));
      }
      current.rounds = Math.max(1, combat?.round || current.rounds || 1);
      
      // Update overall rounds count
      this.segments[0].rounds = (this.segments[0].rounds || 0) + current.rounds;

      this.pastCombats.unshift({ ...current });
    }
    this.combatStartTime = null;
    this.saveData();
    this.notify();
  }

  onCombatUpdate(combat, change) {
    if (this.isCombatActive && this.combatStartTime) {
      const duration = Math.max(1, Math.round((Date.now() - this.combatStartTime) / 1000));
      const rounds = Math.max(1, combat?.round || 1);
      this.segments[1].duration = duration;
      this.segments[1].rounds = rounds;
      this.notify();
    }
  }

  /**
   * Primary entry point for recording combat actions (Damage, Healing, Damage Taken)
   */
  recordAction({ sourceActor, targetActor, item, amount, type = "damage", isCrit = false }) {
    if (!sourceActor && !targetActor) return;
    if (isNaN(amount) || amount <= 0) return;

    const source = sourceActor ? this._getActorData(sourceActor) : null;
    const target = targetActor ? this._getActorData(targetActor) : null;
    const abilityName = item?.name || "Basic Attack / Direct HP";

    // Record into 'current' and 'overall' segments
    const activeSegments = [this.segments[0], this.segments[1]];

    for (const seg of activeSegments) {
      if (!seg) continue;

      if (source) {
        const c = this._getOrCreateCombatant(seg, source);
        if (type === "damage") {
          c.damageDealt += amount;
          this._recordAbilityStat(c, abilityName, amount, "damage", isCrit, target?.name);
        } else if (type === "healing") {
          c.healingDone += amount;
          this._recordAbilityStat(c, abilityName, amount, "healing", isCrit, target?.name);
        }
      }

      if (target && type === "damage") {
        const t = this._getOrCreateCombatant(seg, target);
        t.damageTaken += amount;
      }
    }

    // Broadcast via socket to sync other connected players
    if (game.user.isGM) {
      game.socket?.emit("module.details-5e", {
        type: "recordAction",
        payload: { sourceActorId: sourceActor?.id, targetActorId: targetActor?.id, itemData: item ? { name: item.name } : null, amount, actionType: type, isCrit }
      });
      this.saveData();
    }

    this.notify();
  }

  _getActorData(actor) {
    let dndClass = "default";
    if (actor.type === "npc") {
      dndClass = "npc";
    } else {
      const classItem = actor.itemTypes?.class?.[0] || actor.items?.find(i => i.type === "class");
      if (classItem) {
        dndClass = classItem.name;
      } else if (actor.system?.details?.class) {
        dndClass = actor.system.details.class;
      }
    }

    return {
      id: actor.id,
      name: actor.name,
      img: actor.img || actor.prototypeToken?.texture?.src || "icons/svg/mystery-man.svg",
      className: dndClass.toLowerCase()
    };
  }

  _getOrCreateCombatant(segment, actorData) {
    if (!segment.combatants[actorData.id]) {
      segment.combatants[actorData.id] = {
        id: actorData.id,
        name: actorData.name,
        img: actorData.img,
        className: actorData.className,
        damageDealt: 0,
        healingDone: 0,
        damageTaken: 0,
        abilities: {},
        targets: {}
      };
    }
    return segment.combatants[actorData.id];
  }

  _recordAbilityStat(combatant, abilityName, amount, type, isCrit, targetName) {
    if (!combatant.abilities[abilityName]) {
      combatant.abilities[abilityName] = {
        name: abilityName,
        type,
        total: 0,
        hits: 0,
        crits: 0,
        min: amount,
        max: amount
      };
    }

    const ab = combatant.abilities[abilityName];
    ab.total += amount;
    ab.hits += 1;
    if (isCrit) ab.crits += 1;
    ab.min = Math.min(ab.min, amount);
    ab.max = Math.max(ab.max, amount);

    if (targetName) {
      if (!combatant.targets[targetName]) {
        combatant.targets[targetName] = { name: targetName, total: 0 };
      }
      combatant.targets[targetName].total += amount;
    }
  }

  // Hook Handlers
  onDamageRoll(item, roll) {
    const actor = item?.actor;
    if (!actor) return;
    const isCrit = roll.isCritical || false;
    const total = roll.total || 0;
    this.recordAction({ sourceActor: actor, targetActor: null, item, amount: total, type: "damage", isCrit });
  }

  onHealingRoll(item, roll) {
    const actor = item?.actor;
    if (!actor) return;
    const total = roll.total || 0;
    this.recordAction({ sourceActor: actor, targetActor: null, item, amount: total, type: "healing" });
  }

  onApplyDamage(actor, damageData) {
    const amount = typeof damageData === "number" ? damageData : (damageData.amount || damageData.value || 0);
    if (amount > 0) {
      this.recordAction({ sourceActor: null, targetActor: actor, item: null, amount, type: "damage" });
    }
  }

  onUpdateActor(actor, change, options, userId) {
    if (userId !== game.user.id && !game.user.isGM) return;
    const getProp = foundry.utils?.getProperty || getProperty;
    const hpChange = getProp(change, "system.attributes.hp");
    if (!hpChange) return;

    if (typeof hpChange.value === "number") {
      const oldHp = actor.system.attributes.hp.value;
      const diff = hpChange.value - oldHp;
      if (diff > 0) {
        // Healing received
        this.recordAction({ sourceActor: actor, targetActor: actor, item: { name: "HP Recovery" }, amount: diff, type: "healing" });
      }
    }
  }

  onMidiRollComplete(workflow) {
    if (!workflow) return;
    const sourceActor = workflow.actor;
    const item = workflow.item;
    const isCrit = workflow.isCritical;
    const damageTotal = workflow.damageTotal || 0;

    for (const targetToken of (workflow.damageList || workflow.targets || [])) {
      const targetActor = targetToken.actor || targetToken;
      if (damageTotal > 0) {
        this.recordAction({ sourceActor, targetActor, item, amount: damageTotal, type: "damage", isCrit });
      }
    }
  }

  onSocketMessage(packet) {
    if (!packet || packet.type !== "recordAction") return;
    const { sourceActorId, targetActorId, itemData, amount, actionType, isCrit } = packet.payload;
    const sourceActor = sourceActorId ? game.actors.get(sourceActorId) : null;
    const targetActor = targetActorId ? game.actors.get(targetActorId) : null;
    this.recordAction({ sourceActor, targetActor, item: itemData, amount, type: actionType, isCrit });
  }

  resetCurrent() {
    this.segments[1] = {
      id: "current",
      name: "Current Combat",
      duration: 0,
      combatants: {}
    };
    this.saveData();
    this.notify();
  }

  resetAll() {
    this.segments[0] = { id: "overall", name: "Overall Data", duration: 0, combatants: {} };
    this.resetCurrent();
    this.pastCombats = [];
    this.saveData();
    this.notify();
  }
}
