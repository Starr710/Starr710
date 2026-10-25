// SHADOW CELL — equipment (Step 23): a small foundation, not an inventory. Two independent
// equipped slots:
//   weapon   a combat weapon, used through AIM and FIRE as before (now: the existing pistol)
//   item     a utility item, used through the one reusable USE action (now: an empty magazine)
// Every piece of equipment is a definition in the registry (mv.EQUIPMENT): an id, a display
// name, its category ('weapon' | 'item'), a kind, its configurable values, a quantity and a
// `create(ctx)` that returns its controller. A controller may offer:
//   canUse(state) → '' or why not      use(state) → { ok, why }      update(dt, state)
//   pose(dt) (after her posture)       reset()      status() → short text
// Equipping puts a definition in its category's slot (one per slot; the other slot is never
// touched). USE always means "the equipped item's use()", so a future gadget only needs a
// definition, never a new button. No selection menu yet: the pistol and the magazine are the
// default selections, and RESET puts them back.
(function (mv) {
  'use strict';

  mv.EQUIPMENT = {};   // id → definition
  mv.registerEquipment = function (def) {
    if (!def || !def.id || !def.category) throw new Error('equipment needs an id and a category');
    mv.EQUIPMENT[def.id] = Object.assign({ name: def.id, kind: '', config: {}, quantity: Infinity }, def);
    return mv.EQUIPMENT[def.id];
  };

  // ctx: whatever the controllers need (the systems they reuse); defaults: { weapon: id, item: id }
  mv.Equipment = function (ctx, defaults) {
    this.ctx = ctx; this.defaults = Object.assign({ weapon: 'pistol', item: 'empty-magazine' }, defaults || {});
    this.slots = { weapon: null, item: null };
    this.controllers = {};   // id → controller (made once, reused)
    this.uses = 0; this.refused = 0; this.last = null;
    this.reset();
  };

  // put a registered definition in its slot (the other slot is untouched)
  mv.Equipment.prototype.equip = function (id) {
    const def = mv.EQUIPMENT[id];
    if (!def) return { ok: false, why: 'not registered: ' + id };
    if (!this.slots.hasOwnProperty(def.category)) return { ok: false, why: 'no slot for ' + def.category };
    if (!this.controllers[id]) this.controllers[id] = def.create ? def.create(this.ctx, def) : {};
    this.slots[def.category] = { id, def, ctl: this.controllers[id], quantity: def.quantity };
    return { ok: true, why: '' };
  };
  mv.Equipment.prototype.weapon = function () { return this.slots.weapon; };
  mv.Equipment.prototype.item = function () { return this.slots.item; };

  // USE: the equipped item's own action. state: what the game says she's doing right now
  mv.Equipment.prototype.useItem = function (state) {
    const s = this.slots.item;
    let why = !s ? 'no item equipped' : !(s.quantity > 0) ? 'none left' : '';
    if (!why && s.ctl.canUse) why = s.ctl.canUse(state || {});
    if (!why && !s.ctl.use) why = 'nothing to do';
    let res = { ok: false, why };
    if (!why) { res = s.ctl.use(state || {}) || { ok: true, why: '' }; if (res.ok && isFinite(s.quantity)) s.quantity--; }
    if (res.ok) this.uses++; else this.refused++;
    this.last = { item: s ? s.id : null, ok: res.ok, why: res.why };
    return res;
  };

  // per frame: only the equipped controllers that have something running
  mv.Equipment.prototype.update = function (dt, state) {
    for (const k of ['weapon', 'item']) { const s = this.slots[k]; if (s && s.ctl.update) s.ctl.update(dt, state || {}); }
  };
  mv.Equipment.prototype.pose = function (dt) {
    for (const k of ['weapon', 'item']) { const s = this.slots[k]; if (s && s.ctl.pose) s.ctl.pose(dt); }
  };

  // RESET: the default selections, every controller cleared
  mv.Equipment.prototype.reset = function () {
    for (const id in this.controllers) if (this.controllers[id].reset) this.controllers[id].reset();
    this.slots.weapon = null; this.slots.item = null;
    if (this.defaults.weapon) this.equip(this.defaults.weapon);
    if (this.defaults.item) this.equip(this.defaults.item);
    this.last = null;
  };

  mv.Equipment.prototype.status = function () {
    const w = this.slots.weapon, it = this.slots.item;
    const ws = w ? `${w.def.short || w.def.name} ${w.ctl.status ? w.ctl.status() : ''}` : 'none';
    const is = it ? `${it.def.short || it.def.name}${isFinite(it.quantity) ? ' ×' + it.quantity : ''} ${it.ctl.status ? it.ctl.status() : ''}` : 'none';
    return `${ws} · ${is}`;   // (compact for the stats bar: "PISTOL holstered · MAG ready")
  };

  // ---------------------------------------------------------------- the existing pistol, registered
  // The weapon slot's pistol IS the Step 19 pistol (ctx.pistol): nothing is rebuilt. AIM and FIRE
  // keep driving it exactly as before; the definition only describes it and reports on it
  mv.registerEquipment({
    id: 'pistol', name: 'Pistol', short: 'PISTOL', category: 'weapon', kind: 'firearm',
    config: { damage: mv.PistolDefaults ? mv.PistolDefaults.damage : 35, use: 'AIM, then FIRE' },
    create(ctx) {
      const P = () => ctx.pistol;
      return {
        pistol: P,
        status() { const p = P(); return p ? (p.check() ? 'holstered' : 'aimed') + (p.shots ? `, ${p.shots} shots` : '') : 'not ready'; },
        reset() {},
      };
    },
  });
})(SC.mv);
