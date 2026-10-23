// SHADOW CELL — movement: context-sensitive actions (framework only).
// Stage 1 registers no actions. Later stages add them here (wall hug, corner
// peek, vault/mantle, ladder, doors, pickups, takedowns), each as an object:
//
//   {
//     id: 'vault',
//     label: 'VAULT',                       // shown on the action button
//     priority: 10,                         // highest available action wins
//     available(ctx) { return bool },       // ctx = { motor, world, visual, input }
//     start(ctx) {},                        // takes over motor + animator
//     update(ctx, dt) { return done },      // runs until it returns true
//     end(ctx) {},
//   }
//
// While an action runs, the motor's free movement is suspended and the
// animation controller enters the action's state instead of GROUNDED.
(function (mv) {
  'use strict';

  mv.ActionSystem = function () {
    this.actions = [];
    this.active = null;
    this.available = null;
  };
  mv.ActionSystem.prototype.register = function (action) {
    this.actions.push(action);
    this.actions.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  };
  mv.ActionSystem.prototype.update = function (ctx, dt, pressed) {
    if (this.active) {
      if (this.active.update(ctx, dt)) { this.active.end(ctx); this.active = null; }
      return;
    }
    this.available = this.actions.find(a => a.available(ctx)) || null;
    if (pressed && this.available) { this.active = this.available; this.active.start(ctx); }
  };
  mv.ActionSystem.prototype.busy = function () { return !!this.active; };
})(SC.mv);
