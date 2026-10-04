import assert from 'node:assert/strict';
import { createDemoState, previewMealChange, previewCorrection, confirmPreview } from '../docs/prototypes/production-ui/prototype.js';

const s = createDemoState();
s.plans[0].confirmed = true;
const preview = previewMealChange(s, 'plan-week', 'slot-0', 'stir-fry');
assert.deepEqual(preview.changes.map((c) => c.slotId), ['slot-0', 'slot-1']);
assert.equal(preview.changes[1].after, 'chili');
const original = structuredClone(s.plans);
s.revision++;
assert.equal(confirmPreview(s, preview).ok, false, 'a stale preview must not save');
assert.deepEqual(s.plans, original, 'a stale preview must preserve the plan');
s.revision--;
assert.equal(confirmPreview(s, preview).ok, true);
assert.equal(s.plans[0].slots[1].sourceId, null);
assert.equal(s.repairs.length, 1);

const completed = createDemoState();
completed.plans[0].slots[1].completed = true;
assert.throws(() => previewMealChange(completed, 'plan-week', 'slot-0', 'stir-fry'), /completed leftover/i);

const unsafe = createDemoState();
unsafe.meals.find((meal) => meal.id === 'chili').safe = false;
assert.throws(() => previewMealChange(unsafe, 'plan-week', 'slot-0', 'stir-fry'), /replacement|compatible/i, 'a dependency repair must not choose an unconfirmed replacement');
const corrected = createDemoState();
corrected.plans[0].slots[2].completed = true;
corrected.plans[0].slots[2].feedback = ['accepted', 'absent'];
corrected.plans[0].slots[2].elapsed = 30;
const correction = previewCorrection(corrected, 'plan-week', 'slot-2');
assert.equal(confirmPreview(corrected, correction).ok, true);
assert.equal(corrected.plans[0].slots[2].mealId, 'takeout');
assert.equal(corrected.plans[0].slots[2].completed, true);
assert.equal(corrected.plans[0].slots[0].mealId, 'fajitas', 'a correction must use its explicit dinner context');
assert.deepEqual(corrected.corrections[0].before.feedback, ['accepted', 'absent']);
assert.equal(corrected.corrections[0].before.elapsed, 30);
console.log('Prototype checks pass: source/leftover repair, stale preview, retained history, completed dependencies, and explicit compatibility.');
