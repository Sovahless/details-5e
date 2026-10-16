/**
 * Details! Data Tracker Engine for D&D 5e (v3, v4, v5, v6+ & Foundry v12-v14)
 */

export class DetailsTracker {
  static instance = null;

  constructor() {
    DetailsTracker.instance = this;
    this.segments = [
      { id: "overall", name: "Overall Data", duration: 0, rounds: 1, combatants: {} },
      { id: "current", name: "Current Combat", duration: 0, rounds: 1, combatants: {} }
    ];
    this.activeSegmentId = "current";
    this.combatStartTime = null;
    this.isCombatActive = false;
    this.pastCombats = [];
    this.listeners = new Set();
    this._saveTimeout = null;
    this._processedIds = new Set();
    this._recordedRolls = new WeakSet();
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

    // D&D 5e Damage & Healing Roll Hooks (v3, v4, v5, v6+)
    Hooks.on("dnd5e.rollDamageV2", (rolls, data) => this.onDamageRoll(rolls, data));
    Hooks.on("dnd5e.rollDamage", (arg1, arg2) => this.onDamageRoll(arg1, arg2));
    Hooks.on("dnd5e.rollHealing", (arg1, arg2) => this.onHealingRoll(arg1, arg2));

    // ChatMessage hook for cross-client synchronization & enricher/macro rolls
    Hooks.on("createChatMessage", (message, options, userId) => this.onCreateChatMessage(message, options, userId));

    // D&D 5e Damage Application & HP Change Hooks
    Hooks.on("dnd5e.preApplyDamage", (actor) => {
      if (actor) actor._detailsApplyingDamage = true;
    });
    Hooks.on("dnd5e.applyDamage", (actor, amount, options) => this.onApplyDamage(actor, amount, options));
    Hooks.on("preUpdateActor", (actor, change, options, userId) => this.onPreUpdateActor(actor, change, options, userId));

    // Midi-QoL Support
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
      console.warn("Details! 5e | Failed to load persisted tracker data:", err);
    }
  }

  saveData() {
    if (!game.user?.isGM) return;
    clearTimeout(this._saveTimeout);
    this._saveTimeout = setTimeout(() => {
      try {
        const dataToSave = {
          overall: this.segments[0],
          pastCombats: this.pastCombats.slice(0, 10)
        };
        game.settings.set("details-5e", "trackerData", dataToSave);
      } catch (err) {
        console.warn("Details! 5e | Failed to save tracker data:", err);
      }
    }, 1500);
  }

  onChange(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notify() {
    for (const callback of this.listeners) {
      try {
        callback();
      } catch (err) {
        console.error("Details! 5e | Listener error:", err);
      }
    }
  }

  _markProcessed(actionId) {
    if (!actionId) return false;
    if (this._processedIds.has(actionId)) return true;
    this._processedIds.add(actionId);
    if (this._processedIds.size > 500) {
      const first = this._processedIds.values().next().value;
      this._processedIds.delete(first);
    }
    return false;
  }

  onCombatStart(combat) {
    this.isCombatActive = true;
    this.combatStartTime = Date.now();

    const currentSegment = {
      id: `combat_${Date.now()}`,
      name: `Encounter #${this.pastCombats.length + 1}`,
      duration: 1,
      rounds: combat?.round || 1,
      combatants: {}
    };

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
      this.segments[0].rounds = (this.segments[0].rounds || 0) + current.rounds;
      this.pastCombats.unshift({ ...current });
    }
    this.combatStartTime = null;
    this.saveData();
    this.notify();
  }

  onCombatUpdate(combat) {
    if (this.isCombatActive && this.combatStartTime) {
      const duration = Math.max(1, Math.round((Date.now() - this.combatStartTime) / 1000));
      const rounds = Math.max(1, combat?.round || 1);
      this.segments[1].duration = duration;
      this.segments[1].rounds = rounds;
      this.notify();
    }
  }

  /**
   * Primary entry point for recording combat actions (damage, healing, damageTaken)
   */
  recordAction({
    actionId = null,
    sourceActor = null,
    targetActor = null,
    item = null,
    amount = 0,
    type = "damage",
    isCrit = false,
    targetNames = [],
    emitSocket = true
  }) {
    if (!sourceActor && !targetActor) return;
    const cleanAmount = Math.round(Number(amount) || 0);
    if (cleanAmount <= 0) return;

    const id = actionId || foundry.utils?.randomID?.() || `${Date.now()}_${Math.random()}`;
    if (this._markProcessed(id)) return;

    const source = sourceActor ? this._getActorData(sourceActor) : null;
    const target = targetActor ? this._getActorData(targetActor) : null;
    const abilityName = item?.name || (type === "healing" ? "Healing" : "Attack / Damage");

    const resolvedTargets = [...targetNames];
    if (target?.name && !resolvedTargets.includes(target.name)) {
      resolvedTargets.push(target.name);
    }

    const activeSegments = [this.segments[0], this.segments[1]];

    for (const seg of activeSegments) {
      if (!seg) continue;

      if (source && (type === "damage" || type === "healing")) {
        const c = this._getOrCreateCombatant(seg, source);
        if (type === "damage") {
          c.damageDealt += cleanAmount;
          this._recordAbilityStat(c, abilityName, cleanAmount, "damage", isCrit, resolvedTargets);
        } else if (type === "healing") {
          c.healingDone += cleanAmount;
          this._recordAbilityStat(c, abilityName, cleanAmount, "healing", isCrit, resolvedTargets);
        }
      }

      if (target && (type === "damageTaken" || (type === "damage" && !source))) {
        const t = this._getOrCreateCombatant(seg, target);
        t.damageTaken += cleanAmount;
      }
    }

    if (emitSocket) {
      game.socket?.emit("module.details-5e", {
        type: "recordAction",
        payload: {
          actionId: id,
          sourceData: source,
          targetData: target,
          itemData: item ? { name: item.name } : null,
          amount: cleanAmount,
          actionType: type,
          isCrit,
          targetNames: resolvedTargets
        }
      });
    }

    if (game.user?.isGM) {
      this.saveData();
    }

    this.notify();
  }

  _getActorData(actor) {
    if (!actor) return null;
    if (actor.className && actor.id && actor.name && !actor.system) {
      return actor;
    }

    let dndClass = "default";
    if (actor.type === "npc") {
      dndClass = "npc";
    } else {
      const classItems = actor.itemTypes?.class || (actor.items ? Array.from(actor.items).filter(i => i.type === "class") : []);
      if (classItems.length > 0) {
        dndClass = classItems[0].system?.identifier || classItems[0].name;
      } else if (actor.classes && Object.keys(actor.classes).length > 0) {
        dndClass = Object.keys(actor.classes)[0];
      } else if (actor.system?.details?.class) {
        dndClass = actor.system.details.class;
      }
    }

    return {
      id: actor.id,
      name: actor.token?.name || actor.name || "Unknown",
      img: actor.img || actor.prototypeToken?.texture?.src || "icons/svg/mystery-man.svg",
      className: String(dndClass || "default").toLowerCase()
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
    } else {
      // Keep display info fresh
      const existing = segment.combatants[actorData.id];
      if (actorData.name) existing.name = actorData.name;
      if (actorData.img) existing.img = actorData.img;
      if (actorData.className && actorData.className !== "default") existing.className = actorData.className;
    }
    return segment.combatants[actorData.id];
  }

  _recordAbilityStat(combatant, abilityName, amount, type, isCrit, targetNames = []) {
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

    if (Array.isArray(targetNames) && targetNames.length > 0) {
      const share = Math.max(1, Math.round(amount / targetNames.length));
      for (const tName of targetNames) {
        if (!tName) continue;
        if (!combatant.targets[tName]) {
          combatant.targets[tName] = { name: tName, total: 0 };
        }
        combatant.targets[tName].total += share;
      }
    }
  }

  /**
   * Handles both D&D 5e v4/v5/v6 (rolls, { subject }) and legacy v3 (item, roll)
   */
  onDamageRoll(arg1, arg2) {
    // 1. D&D 5e v4 / v5 / v6+ format: (rolls: DamageRoll[], data?: { subject: Activity | Item })
    if (Array.isArray(arg1)) {
      const rolls = arg1.filter(r => r && !this._recordedRolls.has(r));
      if (!rolls.length) return;
      rolls.forEach(r => this._recordedRolls.add(r));

      const subject = arg2?.subject;
      const chatMsg = rolls[0]?.parent;
      const item = subject?.item || (subject?.documentName === "Item" ? subject : null) || chatMsg?.getAssociatedItem?.();
      let actor = subject?.actor || item?.actor || subject?.parent?.actor || chatMsg?.getAssociatedActor?.();
      if (!actor) {
        const speaker = chatMsg?.speaker || ChatMessage.getSpeaker?.();
        actor = (speaker ? ChatMessage.getSpeakerActor?.(speaker) : null) || canvas.tokens?.controlled?.[0]?.actor || game.user?.character;
      }
      if (!actor) return;

      const abilityLabel = item?.name || subject?.name || chatMsg?.flavor || "Attack / Damage";
      const targetDescriptors = chatMsg?.system?.targets || [];
      let targetNames = targetDescriptors.map(t => t.name).filter(Boolean);
      if (!targetNames.length && game.user?.targets?.size) {
        targetNames = Array.from(game.user.targets).map(t => t.name || t.actor?.name).filter(Boolean);
      }

      let damageSum = 0;
      let healingSum = 0;
      let anyCrit = false;

      for (const roll of rolls) {
        const rollTotal = roll.total || 0;
        if (rollTotal <= 0) continue;
        if (roll.isCritical || roll.options?.isCritical) anyCrit = true;

        const rollType = roll.options?.type || "";
        const rollTypes = roll.options?.types || [];
        const isHeal =
          subject?.type === "heal" ||
          chatMsg?.type === "healing" ||
          rollType === "healing" ||
          rollType === "temphp" ||
          rollTypes.includes("healing") ||
          rollTypes.includes("temphp");

        if (isHeal) healingSum += rollTotal;
        else damageSum += rollTotal;
      }

      const baseMsgId = chatMsg?.id ? `msg_${chatMsg.id}` : null;

      if (damageSum > 0) {
        this.recordAction({
          actionId: baseMsgId ? `${baseMsgId}_dmg` : null,
          sourceActor: actor,
          item: { name: abilityLabel },
          amount: damageSum,
          type: "damage",
          isCrit: anyCrit,
          targetNames,
          emitSocket: true
        });
      }

      if (healingSum > 0) {
        this.recordAction({
          actionId: baseMsgId ? `${baseMsgId}_heal` : null,
          sourceActor: actor,
          item: { name: abilityLabel },
          amount: healingSum,
          type: "healing",
          isCrit: anyCrit,
          targetNames,
          emitSocket: true
        });
      }
      return;
    }

    // 2. Legacy D&D 5e v3 format: (item, roll)
    const item = arg1;
    const roll = arg2;
    if (!item || !roll || this._recordedRolls.has(roll)) return;
    this._recordedRolls.add(roll);

    const actor = item.actor || item.parent;
    if (!actor) return;
    const isCrit = roll.isCritical || false;
    const total = roll.total || 0;
    const targetNames = Array.from(game.user?.targets || []).map(t => t.name || t.actor?.name).filter(Boolean);

    this.recordAction({
      sourceActor: actor,
      item,
      amount: total,
      type: "damage",
      isCrit,
      targetNames,
      emitSocket: true
    });
  }

  onHealingRoll(arg1, arg2) {
    if (Array.isArray(arg1)) {
      return this.onDamageRoll(arg1, arg2);
    }
    const item = arg1;
    const roll = arg2;
    if (!item || !roll || this._recordedRolls.has(roll)) return;
    this._recordedRolls.add(roll);

    const actor = item.actor || item.parent;
    if (!actor) return;
    const total = roll.total || 0;
    const targetNames = Array.from(game.user?.targets || []).map(t => t.name || t.actor?.name).filter(Boolean);

    this.recordAction({
      sourceActor: actor,
      item,
      amount: total,
      type: "healing",
      targetNames,
      emitSocket: true
    });
  }

  /**
   * Captures damage/healing chat cards across all clients (including player rolls, enrichers, macros)
   */
  onCreateChatMessage(message, options, userId) {
    if (!message) return;
    const isDamageMsg = message.type === "damage" || message.flags?.dnd5e?.roll?.type === "damage";
    const isHealingMsg = message.type === "healing" || message.flags?.dnd5e?.roll?.type === "healing";
    if (!isDamageMsg && !isHealingMsg) return;

    const rolls = message.rolls || [];
    if (!rolls.length) return;
    if (rolls.some(r => this._recordedRolls.has(r))) return;
    rolls.forEach(r => this._recordedRolls.add(r));

    const actor = message.getAssociatedActor?.() || (message.speaker ? ChatMessage.getSpeakerActor?.(message.speaker) : null);
    if (!actor) return;

    const item = message.getAssociatedItem?.() || message.getOriginatingMessage?.()?.getAssociatedItem?.();
    const activity = message.getAssociatedActivity?.();
    const abilityLabel = item?.name || activity?.name || message.flavor || (isHealingMsg ? "Healing" : "Attack / Damage");

    const targetDescriptors = message.system?.targets || message.flags?.dnd5e?.targets || [];
    const targetNames = targetDescriptors.map(t => t.name).filter(Boolean);

    let damageSum = 0;
    let healingSum = 0;
    let anyCrit = false;

    for (const roll of rolls) {
      const total = roll.total || 0;
      if (total <= 0) continue;
      if (roll.isCritical || roll.options?.isCritical) anyCrit = true;

      const rollType = roll.options?.type || "";
      const rollTypes = roll.options?.types || [];
      const isHeal =
        isHealingMsg ||
        activity?.type === "heal" ||
        rollType === "healing" ||
        rollType === "temphp" ||
        rollTypes.includes("healing") ||
        rollTypes.includes("temphp");

      if (isHeal) healingSum += total;
      else damageSum += total;
    }

    if (damageSum > 0) {
      this.recordAction({
        actionId: `msg_${message.id}_dmg`,
        sourceActor: actor,
        item: { name: abilityLabel },
        amount: damageSum,
        type: "damage",
        isCrit: anyCrit,
        targetNames,
        emitSocket: false
      });
    }

    if (healingSum > 0) {
      this.recordAction({
        actionId: `msg_${message.id}_heal`,
        sourceActor: actor,
        item: { name: abilityLabel },
        amount: healingSum,
        type: "healing",
        isCrit: anyCrit,
        targetNames,
        emitSocket: false
      });
    }
  }

  onApplyDamage(actor, amount, options = {}) {
    if (actor) actor._detailsApplyingDamage = false;
    if (!actor) return;

    const numAmount = typeof amount === "number" ? amount : (amount?.amount ?? amount?.value ?? 0);
    if (numAmount === 0 || isNaN(numAmount)) return;

    if (numAmount > 0) {
      // Actor took damage
      this.recordAction({
        sourceActor: null,
        targetActor: actor,
        item: null,
        amount: Math.round(numAmount),
        type: "damageTaken",
        emitSocket: true
      });
    } else if (numAmount < 0) {
      // Actor received healing directly (e.g. token bar delta) if no originating roll message
      const originMsg = options?.origin || options?.originatingMessage;
      if (!originMsg) {
        this.recordAction({
          sourceActor: actor,
          targetActor: actor,
          item: { name: "HP Recovery" },
          amount: Math.abs(Math.round(numAmount)),
          type: "healing",
          targetNames: [actor.name],
          emitSocket: true
        });
      }
    }
  }

  onPreUpdateActor(actor, change, options, userId) {
    if (userId && userId !== game.user?.id) return;
    if (!actor || actor._detailsApplyingDamage) return;

    const getProp = foundry.utils?.getProperty;
    if (!getProp) return;
    const newHp = getProp(change, "system.attributes.hp.value");
    if (typeof newHp !== "number") return;

    const oldHp = actor.system?.attributes?.hp?.value;
    if (typeof oldHp !== "number") return;

    const diff = newHp - oldHp;
    if (diff < 0) {
      this.recordAction({
        sourceActor: null,
        targetActor: actor,
        item: null,
        amount: Math.abs(diff),
        type: "damageTaken",
        emitSocket: true
      });
    } else if (diff > 0 && !options?.dnd5e?.rest) {
      this.recordAction({
        sourceActor: actor,
        targetActor: actor,
        item: { name: "HP Recovery" },
        amount: diff,
        type: "healing",
        targetNames: [actor.name],
        emitSocket: true
      });
    }
  }

  onMidiRollComplete(workflow) {
    if (!workflow) return;
    const rolls = workflow.damageRolls || (workflow.damageRoll ? [workflow.damageRoll] : []);
    if (rolls.some(r => this._recordedRolls.has(r))) return;
    rolls.forEach(r => this._recordedRolls.add(r));

    const sourceActor = workflow.actor;
    const item = workflow.item;
    const isCrit = workflow.isCritical || false;
    const damageTotal = workflow.damageTotal || 0;
    if (damageTotal <= 0 || !sourceActor) return;

    const targetNames = [];
    for (const t of (workflow.targets || [])) {
      const name = t.name || t.actor?.name;
      if (name) targetNames.push(name);
    }

    const isHealing = workflow.defaultDamageType === "healing" || workflow.defaultDamageType === "temphp";
    this.recordAction({
      actionId: workflow.id ? `midi_${workflow.id}` : null,
      sourceActor,
      item,
      amount: damageTotal,
      type: isHealing ? "healing" : "damage",
      isCrit,
      targetNames,
      emitSocket: true
    });
  }

  onSocketMessage(packet) {
    if (!packet || packet.type !== "recordAction" || !packet.payload) return;
    const {
      actionId,
      sourceData,
      targetData,
      sourceActorId,
      targetActorId,
      itemData,
      amount,
      actionType,
      isCrit,
      targetNames
    } = packet.payload;

    const sourceActor = sourceData || (sourceActorId ? game.actors?.get(sourceActorId) : null);
    const targetActor = targetData || (targetActorId ? game.actors?.get(targetActorId) : null);

    this.recordAction({
      actionId,
      sourceActor,
      targetActor,
      item: itemData,
      amount,
      type: actionType,
      isCrit,
      targetNames: targetNames || [],
      emitSocket: false
    });
  }

  resetCurrent() {
    this.segments[1] = {
      id: "current",
      name: "Current Combat",
      duration: 0,
      rounds: 1,
      combatants: {}
    };
    this.saveData();
    this.notify();
  }

  resetAll() {
    this.segments[0] = { id: "overall", name: "Overall Data", duration: 0, rounds: 1, combatants: {} };
    this.resetCurrent();
    this.pastCombats = [];
    this.saveData();
    this.notify();
  }
}
