const paths = {
  plan: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18M7 14h3m4 0h3M7 17h3"/>',
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4L19 5"/>',
  shop: '<path d="m4 8 2 12h12l2-12H4Zm4 0 4-6 4 6M9 12v4m6-4v4"/>',
  recipes: '<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1m0-15c3-2 6-2 9-1v15c-3-1-6-1-9 1V5Z"/>',
  household: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v3"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  link: '<path d="m10 13 4-4m-6 8-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2-1 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  back: '<path d="M20 12H4m6-6-6 6 6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  alert: '<path d="m12 3 10 18H2L12 3Zm0 6v5m0 3v.1"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] ?? paths.recipes}</svg>`;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const btn = (label, action, variant = 'primary', attrs = '') => `<button type="button" class="button ${variant}" data-action="${action}" ${attrs}>${label}</button>`;

const sampleMeals = [
  { id: 'fajitas', name: 'Chicken fajitas', category: 'Chicken', effort: 25, cook: 15, serves: 4, leftovers: true, safe: true, ingredients: ['500 g chicken breast', '3 peppers', '1 onion', '8 tortillas', '2 tsp smoked paprika', '1 lime'], steps: ['Slice the chicken and vegetables. Mix the paprika with a little oil.', 'Cook the chicken until cooked through. Reserve plain portions before combining, if needed.', 'Cook the peppers and onion. Warm the tortillas and serve with lime.', 'Set aside the household-confirmed extra dinner portion for the linked leftover night.'] },
  { id: 'lemon-chicken', name: 'Lemon chicken & rice', category: 'Chicken', effort: 30, cook: 25, serves: 3, safe: true, ingredients: ['450 g chicken thighs', '200 g rice', '1 lemon', '200 g green beans', '2 tbsp olive oil'], steps: ['Put the rice on to cook. Trim the beans and zest the lemon.', 'Season and cook the chicken until cooked through, using the lemon and olive oil.', 'Steam the beans. Serve the chicken over the rice with lemon wedges.'] },
  { id: 'chili', name: 'Slow-cooker chili', category: 'Hands-off', effort: 15, cook: 360, serves: 4, handsOff: true, safe: true, ingredients: ['400 g beef mince', '2 cans kidney beans', '2 cans chopped tomatoes', '1 onion', '2 tsp cumin'], steps: ['Brown the mince and drain if needed. Chop the onion.', 'Add the ingredients to the slow cooker and stir.', 'Use your appliance guidance to cook until the meat is safely cooked through and the vegetables are tender.', 'The sample household has confirmed it can start this recipe before the hands-off window.'] },
  { id: 'tomato-pasta', name: 'Pasta with roasted tomatoes', category: 'Vegetables', effort: 20, cook: 25, serves: 3, safe: true, ingredients: ['300 g pasta', '500 g tomatoes', '3 garlic cloves', '2 tbsp olive oil', '1 bunch basil'], steps: ['Roast the tomatoes and garlic with the olive oil until soft.', 'Cook the pasta. Keep a little cooking water.', 'Toss the pasta with the tomatoes and basil, adding cooking water as needed.'] },
  { id: 'salmon', name: 'Salmon traybake', category: 'Fish', effort: 15, cook: 25, serves: 3, safe: true, ingredients: ['3 salmon fillets', '600 g potatoes', '200 g broccoli', '1 lemon', '2 tbsp olive oil'], steps: ['Cut the potatoes into small pieces and roast with olive oil.', 'Add the broccoli, then the salmon and lemon.', 'Cook until the salmon is cooked through and the potatoes are tender.'] },
  { id: 'meatballs', name: 'Meatballs & tomato sauce', category: 'Beef', effort: 30, cook: 25, serves: 3, safe: true, ingredients: ['400 g beef mince', '1 can chopped tomatoes', '300 g pasta', '1 onion'], steps: ['Shape and cook the meatballs until cooked through.', 'Simmer the chopped onion and tomatoes into a sauce.', 'Cook the pasta and serve everything together.'] },
  { id: 'stir-fry', name: 'Ginger chicken stir-fry', category: 'Chicken', effort: 20, cook: 12, serves: 3, safe: true, ingredients: ['450 g chicken breast', '1 broccoli', '1 piece ginger', '200 g rice', '2 tbsp soy sauce'], steps: ['Prepare the rice and slice the chicken and vegetables.', 'Stir-fry the chicken until cooked through; add the vegetables and ginger.', 'Add the soy sauce and serve with rice.'] },
  { id: 'beans', name: 'Bean & sweet potato bowls', category: 'Vegetables', effort: 20, cook: 30, serves: 3, safe: true, ingredients: ['2 sweet potatoes', '1 can black beans', '200 g rice', '1 lime'], steps: ['Roast the cubed sweet potato and cook the rice.', 'Warm the beans and season to your household’s preference.', 'Serve in bowls with lime.'] },
  { id: 'soup', name: 'Tomato & lentil soup', category: 'Vegetables', effort: 15, cook: 30, serves: 3, safe: true, ingredients: ['150 g red lentils', '2 cans chopped tomatoes', '1 onion', '600 ml vegetable stock'], steps: ['Soften the chopped onion in a pan.', 'Add the lentils, tomatoes and stock.', 'Simmer until the lentils are tender, then adjust the consistency.'] },
  { id: 'tacos', name: 'Fish tacos', category: 'Fish', effort: 25, cook: 15, serves: 3, safe: true, ingredients: ['450 g white fish', '6 tortillas', '1 lime', '1 small cabbage'], steps: ['Shred the cabbage and cut the lime.', 'Cook the fish until cooked through and warm the tortillas.', 'Serve with the cabbage and lime.'] },
  { id: 'alfredo', name: 'Creamy mushroom pasta', category: 'Vegetables', effort: 25, cook: 20, serves: 3, safe: false, ingredients: ['300 g pasta', '250 g mushrooms', '150 ml cream'], steps: ['Cook the pasta and sauté the mushrooms.', 'Add the cream and combine with the pasta.', 'Review compatibility before this recipe is used for anyone with a hard restriction.'] },
  // Illustrative household recipes; compatibility and start-ahead notes are sample assertions.
  { id: 'chickpea-spinach-curry', name: 'Slow-cooker chickpea & spinach curry', category: 'Hands-off', effort: 15, cook: 300, serves: 4, handsOff: true, safe: true, ingredients: ['2 cans chickpeas', '1 can coconut milk', '1 can chopped tomatoes', '1 onion', '2 tbsp mild curry paste', '150 g spinach'], steps: ['Drain the chickpeas and chop the onion.', 'Add the chickpeas, coconut milk, tomatoes, onion and curry paste to the slow cooker; stir.', 'Use appliance guidance to cook until the onion is tender. Stir in the spinach near the end until wilted.', 'The sample household has confirmed it can start this recipe before the hands-off window.'] },
  { id: 'chicken-white-bean-stew', name: 'Slow-cooker chicken & white-bean stew', category: 'Hands-off', effort: 15, cook: 360, serves: 4, handsOff: true, safe: true, ingredients: ['500 g chicken thighs', '2 cans white beans', '2 carrots', '1 onion', '500 ml chicken stock', '1 tsp dried thyme'], steps: ['Drain the beans, chop the carrots and onion, and trim the chicken.', 'Put everything in the slow cooker with the stock and thyme.', 'Use appliance guidance to cook until the chicken is safely cooked through and the vegetables are tender; shred the chicken before serving.', 'The sample household has confirmed it can start this recipe before the hands-off window.'] },
  { id: 'egg-fried-rice', name: 'Egg & vegetable fried rice', category: 'Vegetables', effort: 15, cook: 10, serves: 3, safe: true, ingredients: ['300 g ready-to-heat rice', '4 eggs', '300 g frozen mixed vegetables', '2 tbsp soy sauce', '1 tbsp vegetable oil'], steps: ['Heat the oil and cook the vegetables until hot.', 'Scramble the eggs in the pan until set.', 'Add the rice and soy sauce; stir-fry until piping hot throughout and serve.'] },
  { id: 'pea-tomato-couscous', name: 'Pea & tomato couscous', category: 'Vegetables', effort: 10, cook: 10, serves: 3, safe: true, ingredients: ['250 g couscous', '250 g cherry tomatoes', '200 g frozen peas', '300 ml vegetable stock', '1 lemon', '2 tbsp olive oil'], steps: ['Bring the stock to a boil and pour it over the couscous; cover until tender.', 'Cook the peas until hot and halve the tomatoes.', 'Fluff the couscous with the oil and lemon juice, then fold in the peas and tomatoes.'] },
  { id: 'roast-vegetable-lasagne', name: 'Roast vegetable lasagne', category: 'Vegetables', effort: 45, cook: 45, serves: 4, safe: true, ingredients: ['1 aubergine', '2 courgettes', '2 peppers', '9 dairy-free lasagne sheets', '700 g tomato passata', '500 ml dairy-free white sauce', '2 tbsp olive oil'], steps: ['Chop the vegetables and roast with olive oil until tender.', 'Layer the passata, vegetables, lasagne sheets and dairy-free white sauce in a baking dish.', 'Bake until the pasta is tender and the top is browned; rest briefly before serving.'] },
  { id: 'creamy-slow-cooker-chicken', name: 'Creamy slow-cooker chicken', category: 'Hands-off', effort: 20, cook: 360, serves: 4, handsOff: true, safe: false, ingredients: ['500 g chicken thighs', '1 onion', '250 g mushrooms', '300 ml chicken stock', '150 ml cream'], steps: ['Chop the onion and mushrooms and trim the chicken.', 'Add the chicken, vegetables and stock to the slow cooker.', 'Use appliance guidance to cook until the chicken is safely cooked through; stir in the cream near the end and heat through.', 'This illustrative recipe still needs household compatibility review because it contains dairy.'] },
  { id: 'sandwiches', name: 'Sandwich night', category: 'Name-only', safe: false, ingredients: [], steps: [] },
];

export function createDemoState() {
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const ids = ['fajitas', 'fajitas', 'lemon-chicken', 'chili', 'tomato-pasta', 'takeout', 'salmon'];
  return {
    meals: structuredClone(sampleMeals), diners: ['Alex', 'Robin', 'Lee'], restrictions: ['Dairy-free · Alex'],
    plans: [{ id: 'plan-week', name: '5–11 October', confirmed: false, slots: ids.map((mealId, i) => ({ id: `slot-${i}`, day: names[i], date: `2026-10-${String(5 + i).padStart(2, '0')}`, mealId, capacity: i === 1 || i === 3 ? 'hands-off' : i === 0 ? 'quick' : 'normal', sourceId: i === 1 ? 'slot-0' : null, completed: false, elapsed: null, feedback: null })), shopping: { confirmed: false, checkedItems: [], unavailable: [], snapshot: null, history: [] } }],
    selectedPlanId: 'plan-week', revision: 8, repairs: [], corrections: [], view: 'plan', recipeId: null, query: '', category: 'All',
    saveState: 'saved', access: true, editSlotId: null,
    preview: null, broken: false, todayChoice: null, sampleDate: '2026-10-05', historyTarget: null, empty: false, showMealForm: false, showFeedback: false,
    inviteStep: 0, invitation: false, loading: false, largeLibrary: false, visibleMeals: 12, message: '',
  };
}
const currentPlan = (s) => s.plans.find((item) => item.id === s.selectedPlanId);
const shoppingFor = (s, planId = s.selectedPlanId) => s.plans.find((item) => item.id === planId).shopping;
const mealFor = (s, id) => s.meals.find((item) => item.id === id);
export function todaySelection(s) {
  if (s.historyTarget) {
    const plan = s.plans.find((p) => p.id === s.historyTarget.planId);
    const slot = plan?.slots.find((item) => item.id === s.historyTarget.slotId);
    return slot ? { plan, slot, history: true } : null;
  }
  const matches = s.plans.filter((p) => p.confirmed).flatMap((plan) => plan.slots.filter((slot) => slot.date === s.sampleDate).map((slot) => ({ plan, slot })));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return matches.find(({ plan, slot }) => plan.id === s.todayChoice?.planId && slot.id === s.todayChoice?.slotId && slot.date === s.todayChoice?.date) ?? null;
  return null;
}
export function eligible(s, meal, slot) {
  if (!meal || (s.restrictions.length && !meal.safe)) return false;
  if (slot.capacity === 'hands-off' && !meal.handsOff) return false;
  if (slot.capacity === 'quick' && (meal.effort === undefined || meal.effort > 30)) return false;
  return true;
}
export function previewMealChange(s, planId, slotId, mealId) {
  const plan = s.plans.find((item) => item.id === planId);
  const slot = plan?.slots.find((item) => item.id === slotId);
  if (!slot || slot.completed) throw Error('Completed dinners stay fixed. Use a correction instead.');
  if (!slot.sourceId && slot.mealId === mealId) return null;
  if (mealId !== 'takeout' && !eligible(s, mealFor(s, mealId), slot)) throw Error('This dinner needs confirmed compatibility and must fit this date’s capacity.');
  const changes = [{ slotId, before: slot.mealId, after: mealId, sourceId: null }, ...dependentChanges(s, plan, slot)];
  return { type: 'repair', planId, expectedRevision: s.revision, changes };
}
function dependentChanges(s, plan, slot) {
  const changes = [];
  for (const dependent of plan.slots.filter((item) => item.sourceId === slot.id)) {
    if (dependent.completed) throw Error('A completed leftover dinner depends on this source. Correct that dinner first.');
    const replacement = s.meals.find((meal) => eligible(s, meal, dependent));
    if (!replacement) throw Error('The leftover dinner needs a confirmed compatible replacement. Review its options first.');
    changes.push({ slotId: dependent.id, before: dependent.mealId, after: replacement.id, sourceId: null });
  }
  return changes;
}
export function previewCorrection(s, planId, slotId) {
  const plan = s.plans.find((item) => item.id === planId);
  const slot = plan?.slots.find((item) => item.id === slotId);
  if (!slot?.completed) throw Error('Record the dinner before correcting it.');
  return { type: 'correction', planId, slotId, expectedRevision: s.revision, before: structuredClone(slot), changes: [{ slotId, before: slot.mealId, after: 'takeout', sourceId: null }, ...dependentChanges(s, plan, slot)] };
}
export function confirmPreview(s, preview) {
  if (!s.access) return { ok: false, reason: 'Household access has ended.' };
  if (preview.expectedRevision !== s.revision) return { ok: false, reason: 'The household changed. Your draft is kept; review the updated week before confirming.' };
  const plan = s.plans.find((item) => item.id === preview.planId);
  if (!plan) return { ok: false, reason: 'Choose the plan again before confirming.' };
  if (preview.type === 'repair' || preview.type === 'correction') {
    const shopping = shoppingFor(s, preview.planId);
    const effect = groceryEffect(s, preview);
    const shoppingChanged = effect.added.length || effect.removed.length;
    for (const change of preview.changes) {
      const slot = plan.slots.find((item) => item.id === change.slotId);
      if (!slot || (slot.completed && !(preview.type === 'correction' && slot.id === preview.slotId))) return { ok: false, reason: 'The affected dinner is no longer available for repair.' };
    }
    for (const change of preview.changes) Object.assign(plan.slots.find((item) => item.id === change.slotId), { mealId: change.after, sourceId: change.sourceId });
    const currentIds = new Set(groceryItems(s, preview.planId).map((item) => item.id));
    shopping.checkedItems = shopping.checkedItems.filter((id) => currentIds.has(id));
    shopping.unavailable = shopping.unavailable.filter((id) => currentIds.has(id));
    if (shoppingChanged) shopping.confirmed = false;
    s.repairs.push(structuredClone(preview));
    if (preview.type === 'correction') {
      const slot = plan.slots.find((item) => item.id === preview.slotId);
      slot.elapsed = null; slot.activeEffortMinutes = null; slot.feedback = null;
      s.corrections.push(structuredClone(preview));
    }
  }
  s.revision += 1;
  return { ok: true };
}

export function groceryItems(s, planId = s.selectedPlanId, changes = []) {
  const plan = s.plans.find((item) => item.id === planId);
  return (plan?.slots ?? []).flatMap((slot) => {
    const change = changes.find((item) => item.slotId === slot.id);
    const sourceId = change ? change.sourceId : slot.sourceId;
    const mealId = change ? change.after : slot.mealId;
    const meal = mealFor(s, mealId);
    return sourceId || mealId === 'takeout' ? [] : (meal?.ingredients ?? []).map((name, index) => ({ id: `${planId}-${slot.id}-${mealId}-${index}`, name, meals: [`${meal.name} · ${slot.day}`] }));
  });
}
export function groceryEffect(s, preview) {
  const before = groceryItems(s, preview.planId);
  const after = groceryItems(s, preview.planId, preview.changes);
  const oldIds = new Set(before.map((item) => item.id));
  const newIds = new Set(after.map((item) => item.id));
  return { added: after.filter((item) => !oldIds.has(item.id)), removed: before.filter((item) => !newIds.has(item.id)), retained: after.filter((item) => oldIds.has(item.id)) };
}
export function recordFeedback(s, planId, slotId, responses, effort, leftoversProduced) {
  const slot = s.plans.find((plan) => plan.id === planId)?.slots.find((item) => item.id === slotId);
  if (!slot) throw Error('Choose the dinner and plan again.');
  if (slot.feedback) (slot.feedbackHistory ??= []).push({ responses: structuredClone(slot.feedback), effort: slot.activeEffortMinutes ?? null, leftoversProduced: slot.leftoversProduced ?? null });
  slot.feedback = responses;
  slot.activeEffortMinutes = effort;
  slot.leftoversProduced = leftoversProduced;
  s.revision++;
  const dependent = s.plans.find((plan) => plan.id === planId).slots.find((item) => item.sourceId === slotId && !item.completed);
  s.broken = leftoversProduced === false && !!dependent;
  return dependent;
}
export function readiness(s, planId = s.selectedPlanId) {
  const plan = s.plans.find((item) => item.id === planId);
  const compatible = plan.slots.every((slot) => slot.mealId === 'takeout' || (!!mealFor(s, slot.mealId) && (!s.restrictions.length || mealFor(s, slot.mealId).safe)));
  const capacity = plan.slots.every((slot) => {
    if (slot.mealId === 'takeout' || slot.sourceId || slot.capacity === 'normal') return true;
    const meal = mealFor(s, slot.mealId);
    return slot.capacity === 'hands-off' ? !!meal?.handsOff : meal?.effort !== undefined && meal.effort <= 30;
  });
  const leftovers = plan.slots.filter((slot) => slot.sourceId).every((slot) => {
    const source = plan.slots.find((item) => item.id === slot.sourceId);
    return source && source.leftoversProduced !== false && mealFor(s, source.mealId)?.leftovers;
  });
  return { compatible, capacity, leftovers, leftoverCount: plan.slots.filter((slot) => slot.sourceId).length };
}

let state = createDemoState();
let toastTimer;
const titleFor = (id) => id === 'takeout' ? 'Takeout' : mealFor(state, id)?.name ?? 'Choose a dinner';
const action = (label, key, variant, attrs) => btn(esc(label), key, variant, attrs);
const slotAttrs = (slot) => `data-slot="${slot.id}" data-plan="${currentPlan(state).id}" data-revision="${state.revision}"`;
const badge = (label, kind = '') => `<span class="badge ${kind}">${esc(label)}</span>`;

function saveBar() {
  if (state.saveState === 'pending') return `<div class="status-bar pending" role="status">${icon('clock')}<span>Saving your changes…</span>${action('Finish sample save', 'finish-save', 'text-button')}</div>`;
  if (state.saveState === 'failed') return `<div class="status-bar failed" role="alert">${icon('alert')}<span>Your changes couldn't be saved. They are still here.</span>${action('Try again', 'retry', 'text-button')}</div>`;
  if (state.saveState === 'conflict') return `<section class="alert"><h2>The household changed</h2><p>Someone else updated this week. Your draft is kept. Review their changes before saving yours.</p><div class="actions">${action('Review updated week', 'review-conflict', 'secondary')}${action('View my draft', 'view-draft', 'text-button')}</div></section>`;
  return `<div class="status-bar" role="status">${icon('check')}<span>${currentPlan(state)?.confirmed ? 'Saved for the household' : 'Your changes are saved · Week not confirmed yet'}</span></div>`;
}
function heading(title, description, right = '') {
  return `<header class="page-heading"><div><h1 id="page-title" tabindex="-1">${esc(title)}</h1><p>${esc(description)}</p></div>${right ? `<div class="heading-actions">${right}</div>` : ''}</header>`;
}
function planChoice() {
  return state.plans.length > 1 ? `<div class="content-section"><label for="plan-choice">Which plan?</label><select id="plan-choice">${state.plans.map((p) => `<option value="${p.id}" ${p.id === state.selectedPlanId ? 'selected' : ''}>${p.name}</option>`).join('')}</select></div>` : '';
}
function groceries() {
  return groceryItems(state);
}
function incompleteMeals() { return currentPlan(state)?.slots.filter((slot) => !slot.sourceId && slot.mealId !== 'takeout' && !mealFor(state, slot.mealId)?.ingredients.length) ?? []; }
function capacityText(slot) { return slot.capacity === 'hands-off' ? 'Hands-off night' : slot.capacity === 'quick' ? 'Quick-cook night' : ''; }
function weekAction() {
  const plan = currentPlan(state);
  return plan.confirmed ? action('Review shopping', 'go-shop', 'yellow') : action('Confirm this week', 'confirm-week', 'primary', state.empty || state.saveState === 'pending' ? 'disabled' : '');
}
function planView() {
  if (state.empty) return heading('Make room for the week', 'Start with the dinners your household already knows.') + `<section class="empty-state"><h2>A small meal library is enough to begin</h2><p>Add your diners and hard restrictions, then choose 8–12 household meals. Recipe Keeper recipes can help with ingredients; name-only meals can join the plan too.</p><div class="actions">${action('Set up the household', 'go-household')}${action('Add meals', 'go-recipes', 'secondary')}</div></section>`;
  const plan = currentPlan(state);
  const cooking = plan.slots.filter((slot) => slot.mealId !== 'takeout' && !slot.sourceId).length;
  const ready = readiness(state);
  return heading('Your week', '5–11 October · A starting point, with room to change.', weekAction()) + planChoice() + saveBar() +
    (state.message ? `<section class="alert"><p>${esc(state.message)}</p></section>` : '') +
    `<div class="week-layout"><section class="week-board" aria-labelledby="week-heading"><header class="board-heading"><div><h2 id="week-heading">Seven dinners, one household</h2><p>${cooking} cooking nights · ${plan.slots.filter((s) => s.sourceId).length} leftover night · Takeout is your choice</p></div>${badge(plan.confirmed ? 'Confirmed week' : 'Draft week', plan.confirmed ? 'success' : '')}</header><ol class="week-list">${plan.slots.map((slot, i) => {
      const meal = mealFor(state, slot.mealId);
      const edit = state.editSlotId === slot.id;
      return `<li class="dinner-row"><div class="day">${slot.day}<strong>${5 + i}</strong></div><div><div class="meal-title">${slot.sourceId ? 'Fajita leftovers' : esc(titleFor(slot.mealId))}</div><div class="row-notes"><span>${slot.mealId === 'takeout' ? 'Chosen by your household' : slot.sourceId ? 'Serve or reheat' : meal?.effort !== undefined ? `${meal.effort} min hands-on` : 'Hands-on effort unknown'}</span>${slot.completed ? '<span>Dinner recorded</span>' : ''}</div>${slot.sourceId ? '<span class="source-link">Monday cooking covers this dinner</span>' : ''}${capacityText(slot) ? `<span class="capacity ${slot.sourceId ? 'leftover' : ''}">${capacityText(slot)}</span>` : ''}</div>${action(slot.completed ? 'History' : edit ? 'Cancel' : 'Change', slot.completed ? 'history' : 'edit-slot', 'text-button row-action', slotAttrs(slot))}${edit ? `<div class="inline-editor"><label for="meal-choice">Dinner for ${slot.day}, ${5 + i} October</label><select id="meal-choice">${state.meals.filter((m) => eligible(state, m, slot)).map((m) => `<option value="${m.id}" ${m.id === slot.mealId ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}<option value="takeout">Takeout · explicit household choice</option></select><p class="small muted">Only confirmed compatible meals that fit this date are offered.</p><div class="actions">${action('Review changes', 'review-repair', 'primary', slotAttrs(slot))}${action('Keep this dinner', 'cancel-edit', 'secondary')}</div></div>` : ''}</li>`;
    }).join('')}</ol></section><aside class="readiness" aria-label="Week readiness"><h2>Week readiness</h2><ul class="readiness-list"><li>${icon(ready.compatible ? 'check' : 'alert')}<span>${ready.compatible ? 'Compatibility confirmed for the selected meals' : 'One or more dinners need compatibility review'}</span></li><li>${icon(ready.capacity ? 'clock' : 'alert')}<span>${ready.capacity ? 'Quick-cook and hands-off nights have a dinner that fits' : 'One or more dinners do not fit the date’s capacity'}</span></li><li>${icon(ready.leftovers ? 'link' : 'alert')}<span>${!ready.leftoverCount ? 'No leftover dinners planned' : ready.leftovers ? 'Planned leftover dinners have a source' : 'Planned leftovers need a replacement dinner'}</span></li><li>${icon('shop')}<span>${incompleteMeals().length ? 'Some ingredients still need your review' : 'Known ingredients are ready for your shopping list'}</span></li></ul>${weekAction()}<p>Confirming keeps this week together. Later changes show their effects before you save.</p><details class="capacity-info"><summary>Why these meals?</summary><p>Familiar household meals lead when compatibility, capacity and leftover coverage are confirmed.</p></details></aside></div><div class="action-dock"><small>${plan.confirmed ? 'The week is confirmed' : 'Review the seven dinners first'}</small>${weekAction()}</div>`;
}
function shopView() {
  if (!currentPlan(state)?.confirmed) return heading('Shopping', 'Start with a confirmed week.') + `<section class="empty-state"><h2>Your list follows your plan</h2><p>Review and confirm the seven dinners first. Then the list uses their known ingredients and leaves incomplete meals for you to review.</p>${action('Review the week', 'go-plan')}</section>`;
  const items = groceries();
  const shopping = shoppingFor(state);
  const checked = shopping.checkedItems.length;
  const missing = incompleteMeals();
  return heading('Shopping', `${currentPlan(state).name} · ${checked} of ${items.length} known items checked`) + planChoice() + saveBar() +
    (missing.length ? `<section class="alert"><h2>Some meals have no ingredient list</h2><p>${missing.map((slot) => esc(titleFor(slot.mealId))).join(', ')}. No ingredients have been guessed. Review these meals separately before confirming shopping.</p>${action('Review the week', 'go-plan', 'secondary')}</section>` : '') +
    (shopping.confirmed ? `<section class="alert"><h2>Shopping is confirmed</h2><p>${shopping.unavailable.length ? 'Unavailable items remain recorded. Dinners that use them need a confirmed repair.' : 'These shopping commitments stay with the week. A dinner change will preview the grocery effects.'}</p>${shopping.unavailable.length ? action('Review affected dinners', 'shopping-repair', 'secondary') : ''}</section>` : shopping.snapshot ? '<section class="alert"><h2>Updated list needs confirmation</h2><p>A dinner changed after shopping was confirmed. New ingredients are unchecked; the earlier shopping record is retained below.</p></section>' : '') +
    (shopping.snapshot ? `<details class="surface"><summary>Confirmed shopping history</summary>${shopping.history.map((snapshot, i) => `<h3>Confirmation ${i + 1}</h3><ul class="changes">${snapshot.map((item) => `<li>${esc(item.name)}<small>${esc(item.meals.join(' · '))} · ${item.unavailable ? 'Unavailable' : item.checked ? 'Checked' : 'Unchecked'}</small></li>`).join('')}</ul>`).join('')}</details>` : '') +
    `<div class="shop-layout"><section class="surface" aria-labelledby="grocery-heading"><div class="grocery-group"><h2 id="grocery-heading">Known ingredients</h2>${items.map((item) => `<div class="grocery-row ${shopping.checkedItems.includes(item.id) ? 'checked' : ''}"><label class="check-label"><input type="checkbox" data-item="${item.id}" ${shopping.checkedItems.includes(item.id) ? 'checked' : ''} ${shopping.confirmed ? 'disabled' : ''} /><span><span class="item-name">${esc(item.name)}</span><small>For ${[...new Set(item.meals)].map(esc).join(' · ')}</small></span></label>${action(shopping.unavailable.includes(item.id) ? 'Unavailable' : 'Not available?', 'unavailable', 'text-button', `data-item="${item.id}" ${shopping.confirmed ? 'disabled' : ''}`)}</div>`).join('')}</div></section><aside class="readiness"><h2>Bring the week home</h2><p>Check what you have or have bought. Mark anything unavailable so the household can choose a dinner repair.</p>${action(shopping.confirmed ? 'Go to Today' : 'Confirm shopping', shopping.confirmed ? 'go-today' : 'confirm-shopping', 'primary')}<p class="small">Ambiguous quantities stay separate. Leftover servings don't add another set of cooking ingredients.</p></aside></div><div class="action-dock"><small>${checked} of ${items.length} checked</small>${action(shopping.confirmed ? 'Go to Today' : 'Confirm shopping', shopping.confirmed ? 'go-today' : 'confirm-shopping', 'primary')}</div>`;
}
function todayView() {
  const matches = state.plans.filter((p) => p.confirmed).flatMap((plan) => plan.slots.filter((slot) => slot.date === state.sampleDate).map((slot) => ({ plan, slot })));
  const selection = todaySelection(state);
  if (!selection && matches.length > 1) return heading('Today', `${state.sampleDate} · Sample date`) + `<section class="empty-state"><h2>Choose today's dinner</h2><p>More than one confirmed plan includes this date.</p><ul class="list">${matches.map(({ plan, slot }) => `<li><div><strong>${esc(plan.name)}</strong><small>${esc(slot.day)} · ${esc(slot.sourceId ? 'Fajita leftovers' : titleFor(slot.mealId))}</small></div>${action('Use this dinner', 'choose-today-plan', 'secondary', `data-plan="${plan.id}" data-slot="${slot.id}"`)}</li>`).join('')}</ul></section>`;
  if (!selection || state.empty) return heading('Today', `${state.sampleDate} · Sample date`) + `<section class="empty-state"><h2>No confirmed dinner for today</h2><p>Make a week or choose an existing plan. The app won't pick an unfinished dinner from another date.</p>${action('Plan the week', 'go-plan')}</section>`;
  const { plan, slot } = selection;
  state.selectedPlanId = plan.id;
  const meal = mealFor(state, slot.mealId);
  return heading(selection.history ? 'Dinner record' : 'Today', `${slot.day}, ${Number(slot.date.slice(-2))} October · ${plan.name}${selection.history ? ' · History' : ''}`) + saveBar() +
    (state.broken ? `<section class="alert"><h2>Tuesday's leftovers need another plan</h2><p>Monday didn't produce the expected extra dinner. Tuesday is hands-off, so a quick recipe won't solve it.</p>${action('Choose a dinner repair', 'broken-repair', 'secondary', slotAttrs(slot))}</section>` : '') +
    `<div class="today-layout"><section class="today-meal"><h2>${slot.sourceId ? 'Fajita leftovers' : esc(titleFor(slot.mealId))}</h2><div class="row-notes"><span>${slot.sourceId ? 'Serve or reheat · No cooking timer' : meal?.effort ? `${meal.effort} min hands-on · Serves ${meal.serves}` : slot.mealId === 'takeout' ? 'Your household chose takeout' : 'Hands-on effort unknown'}</span></div>${capacityText(slot) ? `<span class="capacity">${capacityText(slot)}</span>` : ''}<p class="today-note">Expected at dinner: ${state.diners.map(esc).join(', ')}. One shared meal, with simple adjustments if needed.</p>${slot.completed ? `<div class="status-bar">${icon('check')}<span>Dinner recorded${slot.elapsed !== null ? ` · ${slot.elapsed < 1 ? 'Less than a minute' : `${slot.elapsed} minutes`} from start to ready` : ' · Cooking time unknown'}</span></div><div class="actions">${action(state.showFeedback ? 'Hide feedback' : 'Add feedback', 'toggle-feedback', 'primary')}${action('Correct this dinner', 'correct-dinner', 'secondary', slotAttrs(slot))}</div>${state.showFeedback ? feedbackForm(slot) : '<p class="small muted">Feedback is optional. You can return to it from dinner history.</p>'}` : `<div class="actions">${!slot.sourceId && slot.mealId !== 'takeout' ? action(slot.startedAt ? 'Cooking started' : 'Start cooking', 'start-cooking', 'primary', `${slotAttrs(slot)} ${slot.startedAt || state.broken ? 'disabled' : ''}`) : ''}${action(slot.mealId === 'takeout' ? 'Dinner obtained' : "Dinner's ready", 'dinner-ready', slot.startedAt || slot.sourceId || slot.mealId === 'takeout' ? 'primary' : 'secondary', `${slotAttrs(slot)} ${state.broken ? 'disabled' : ''}`)}${!slot.sourceId && slot.mealId !== 'takeout' ? action('Record dinner without timing', 'record-without-timing', 'text-button', `${slotAttrs(slot)} ${state.broken ? 'disabled' : ''}`) : ''}</div><div class="content-section">${action('Plans changed · show me options', 'recovery-options', 'secondary', slotAttrs(slot))}</div>`}</section><aside class="readiness"><h2>The dinner details</h2>${meal?.ingredients.length ? action('Open the recipe', 'open-recipe', 'secondary', `data-meal="${meal.id}"`) : '<p>This meal has no linked recipe. Ingredients stay unknown.</p>'}<details class="capacity-info"><summary>What can change?</summary><p>Options can include a stored simpler recipe, another household meal, confirmed leftovers, or takeout you choose. A repair shows affected dinners before confirmation.</p></details>${state.repairs.length ? `<p>${state.repairs.length} confirmed repair${state.repairs.length > 1 ? 's' : ''} retained in this plan's history.</p>` : ''}${correctionHistory(plan.id, slot.id)}</aside></div>`;
}
function correctionHistory(planId, slotId) {
  const records = state.corrections.filter((item) => item.planId === planId && item.slotId === slotId);
  return records.length ? `<details class="content-section"><summary>Earlier dinner records (${records.length})</summary><ul class="changes">${records.map(({ before }) => `<li>${esc(dinnerName(before))}<small>Elapsed cooking: ${before.elapsed ?? 'unknown'} min · Hands-on effort: ${before.activeEffortMinutes ?? 'unknown'} min · Responses: ${(before.feedback ?? []).map((answer, i) => `${esc(state.diners[i] ?? `Diner ${i + 1}`)} ${esc(answer ?? 'unreported')}`).join(' · ') || 'unreported'} · Extra dinner: ${before.leftoversProduced == null ? 'unreported' : before.leftoversProduced ? 'yes' : 'no'}</small></li>`).join('')}</ul></details>` : '';
}
function feedbackForm(slot) {
  const cooking = !slot.sourceId && slot.mealId !== 'takeout';
  const responses = [['', 'Not reported'], ['accepted', 'Ate and accepted'], ['rejected', 'Declined the shared meal'], ['absent', "Wasn't at dinner"], ['not-hungry', "Wasn't hungry"]];
  return `<form id="feedback-form" class="content-section" data-plan="${currentPlan(state).id}" data-slot="${slot.id}"><h3>How did the shared dinner work?</h3><p class="small muted">Keep everyone's response. Absence or lack of hunger isn't meal rejection.</p>${state.diners.map((name, i) => `<div class="feedback-row"><label for="response-${i}">${esc(name)}</label><select id="response-${i}" name="person-${i}">${responses.map(([value, label]) => `<option value="${value}" ${value === (slot.feedback?.[i] ?? '') ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></div>`).join('')}${cooking ? `<label for="effort">Hands-on effort, if you know it (minutes)</label><input id="effort" name="effort" type="number" min="0" max="240" value="${slot.activeEffortMinutes ?? ''}" placeholder="Leave unknown if you don't know" />` : ''}${cooking && mealFor(state, slot.mealId)?.leftovers ? `<fieldset><legend>Did you get the planned extra dinner?</legend><label class="check-label"><input type="radio" name="leftovers" value="unknown" ${slot.leftoversProduced == null ? 'checked' : ''} /><span>Not reported</span></label><label class="check-label"><input type="radio" name="leftovers" value="yes" ${slot.leftoversProduced === true ? 'checked' : ''} /><span>Yes, one additional household dinner</span></label><label class="check-label"><input type="radio" name="leftovers" value="no" ${slot.leftoversProduced === false ? 'checked' : ''} /><span>No, don't count on those leftovers</span></label></fieldset>` : ''}<button class="button primary" type="submit">Save feedback</button></form>${slot.feedbackHistory?.length ? `<details class="content-section"><summary>Earlier feedback (${slot.feedbackHistory.length})</summary><ul class="list">${slot.feedbackHistory.map((entry) => `<li><div>${state.diners.map((name, i) => `${esc(name)}: ${esc(responses.find(([value]) => value === (entry.responses[i] ?? ''))?.[1] ?? 'Not reported')}`).join(' · ')}<small>Hands-on effort: ${entry.effort ?? 'unknown'} min · Extra dinner: ${entry.leftoversProduced == null ? 'not reported' : entry.leftoversProduced ? 'yes' : 'no'}</small></div></li>`).join('')}</ul></details>` : ''}`;
}
function libraryMeals() {
  if (!state.largeLibrary) return state.empty ? state.meals.filter((m) => m.id.startsWith('user-')) : state.meals;
  const vegetables = ['Cauliflower', 'Broccoli', 'Carrots', 'Courgette', 'Sweet potato', 'Aubergine', 'Peppers', 'Squash'];
  const versions = ['with lemon & rice', 'with chickpeas', 'in tomato sauce', 'with herbed potatoes'];
  return [...state.meals, ...vegetables.flatMap((name, i) => versions.map((version, j) => ({ ...sampleMeals[7], id: `library-${i}-${j}`, name: `${name} ${version}`, safe: false, category: 'Vegetables', ingredients: [`500 g ${name.toLowerCase()}`, '200 g rice', '1 lemon'], steps: ['Prepare the vegetables and the accompanying grain or potatoes.', 'Cook the vegetables until tender and combine with the listed ingredients.', 'Review household compatibility before adding this sample recipe to a plan.'] })))];
}
function recipesView() {
  const all = libraryMeals();
  const filtered = all.filter((m) => m.name.toLowerCase().includes(state.query.toLowerCase()) && (state.category === 'All' || m.category === state.category));
  return heading('Meals & recipes', `${all.length} sample entries · Meals are the dinners; recipes are ways to make them.`, action('Add a meal', 'toggle-meal-form', 'primary')) +
    `<div class="actions mobile-add">${action(state.showMealForm ? 'Close meal form' : 'Add a meal', 'toggle-meal-form', 'secondary')}</div>${state.showMealForm ? `<form id="meal-form" class="surface content-section"><label for="meal-name">Meal name</label><input id="meal-name" name="name" maxlength="100" required placeholder="A dinner your household knows" /><p class="small muted">You can add a meal without a recipe. Ingredients and effort remain unknown until confirmed.</p><button class="button primary" type="submit">Add name-only meal</button></form>` : ''}<div class="content-section"><div class="toolbar"><div><label for="recipe-search">Search meals & recipes</label><div class="search-input">${icon('search')}<input id="recipe-search" value="${esc(state.query)}" placeholder="Find a household dinner" /></div></div><div><label for="recipe-category">Category</label><select id="recipe-category">${['All', 'Chicken', 'Fish', 'Beef', 'Vegetables', 'Hands-off', 'Name-only'].map((c) => `<option ${c === state.category ? 'selected' : ''}>${c}</option>`).join('')}</select></div></div>${!filtered.length ? `<section class="empty-state"><h2>${all.length ? 'No meals match that search' : 'Start with dinners you already know'}</h2><p>${all.length ? 'Try a different name or clear the category filter.' : 'Add a name-only meal or import Recipe Keeper recipes. Review associations and compatibility before planning.'}</p>${action(all.length ? 'Clear filters' : 'Add a meal', all.length ? 'clear-search' : 'toggle-meal-form', 'secondary')}</section>` : `<ul class="recipe-list">${filtered.map((m) => `<li class="recipe-entry"><div class="recipe-mark">${icon(m.handsOff ? 'clock' : 'recipes')}</div><div><a class="recipe-name" href="#recipe-${m.id}">${esc(m.name)}</a><p>${m.ingredients.length ? `${m.effort} min hands-on · ${m.category}` : 'Name-only meal · Ingredients unknown'}</p></div>${badge(m.safe ? 'Confirmed compatible' : 'Needs review', m.safe ? 'success' : 'warning')}</li>`).join('')}</ul>`}</div><section class="content-section surface"><h2>Bring your Recipe Keeper recipes</h2><p>Review each recipe as a new meal, a version of an existing meal, or a saved recipe only. Similar titles are suggestions, never automatic merges.</p><label for="recipe-zip">Recipe Keeper ZIP</label><input id="recipe-zip" type="file" accept=".zip" /><p id="import-note" class="small muted">This design preview demonstrates the review step; it does not upload or read the file.</p></section>`;
}
function recipeView() {
  const meal = libraryMeals().find((m) => m.id === state.recipeId) ?? mealFor(state, state.recipeId);
  if (!meal) return recipesView();
  return `<button type="button" class="text-button" data-action="go-recipes">${icon('back')} Back to meals & recipes</button>` + heading(meal.name, meal.ingredients.length ? 'A recipe linked to this household meal' : 'A meal with no linked recipe yet') +
    `<div>${badge(meal.safe ? 'Household confirmed compatible' : 'Compatibility needs review', meal.safe ? 'success' : 'warning')}</div>${!meal.safe ? `<section class="alert content-section"><h2>Check the hard restrictions first</h2><p>${state.restrictions.map(esc).join(', ') || 'No hard restrictions have been recorded.'} Ingredients and titles do not certify compatibility.</p><label class="check-label"><input id="compatibility-reviewed" type="checkbox" /><span>I have reviewed this meal and confirm it fits our household's hard restrictions.</span></label>${action('Confirm compatibility', 'confirm-safety', 'secondary', `data-meal="${meal.id}"`)}</section>` : ''}` +
    (meal.ingredients.length ? `<div class="recipe-facts"><div><strong>${meal.effort} min</strong><span class="small muted">Hands-on prep</span></div><div><strong>${meal.cook} min</strong><span class="small muted">Cooking time</span></div><div><strong>${meal.serves}</strong><span class="small muted">Servings</span></div></div><div class="recipe-body"><section><h2>Ingredients</h2><ul class="ingredients">${meal.ingredients.map((line) => `<li>${esc(line)}</li>`).join('')}</ul><h2>Method</h2><ol class="steps">${meal.steps.map((step) => `<li>${esc(step)}</li>`).join('')}</ol></section><aside><section class="surface"><h2>Meal & recipe versions</h2><p>This is the ${meal.id === 'fajitas' ? 'skillet' : 'household'} version of ${esc(meal.name)}.</p>${meal.id === 'fajitas' ? `<label for="recipe-version">Recipe version</label><select id="recipe-version"><option>Skillet version · 25 min hands-on</option><option>Sheet-pan version · 15 min hands-on</option></select><p class="small muted" id="version-note">Reserve plain chicken before combining if that helps the shared meal.</p>` : '<p class="small muted">A different recipe can belong to the same meal without creating a second dinner.</p>'}${meal.handsOff ? '<p>The household has explicitly confirmed it can start this slow cooker before the hands-off window.</p>' : ''}</section><section class="content-section"><h2>Household evidence</h2><p class="muted">Sample history: this familiar meal can be planned without prior feedback. Actual corrected outcomes will inform effort, acceptance and confidence.</p></section></aside></div>` : `<section class="empty-state content-section"><h2>The meal can still join a plan</h2><p>Once compatibility is confirmed, a name-only meal can fit a normal night. No ingredients or constrained-night effort will be fabricated.</p>${action('Go to the week', 'go-plan')}</section>`);
}
function householdView() {
  return heading('Your household', 'Shared dinners start with the people and the constraints that matter.') + saveBar() + `<div class="section-grid"><section class="surface"><h2>Expected diners</h2><ul class="list">${state.diners.map((name) => `<li><div><strong>${esc(name)}</strong><small>Expected at dinner unless the date says otherwise</small></div>${badge('Diner')}</li>`).join('')}</ul><form id="diner-form" class="form-row"><label for="diner-name">Diner name or label</label><input id="diner-name" name="name" required maxlength="50" placeholder="Add a household diner" /><button class="button secondary" type="submit">Add diner</button></form></section><section class="surface"><h2>Hard restrictions</h2><p class="small muted">Never relaxed or inferred. Compatibility requires household confirmation.</p><ul class="list">${state.restrictions.map((r) => `<li><strong>${esc(r)}</strong>${badge('Hard constraint')}</li>`).join('')}</ul><form id="restriction-form" class="content-section"><label for="restriction-name">Restriction</label><input id="restriction-name" name="restriction" required maxlength="80" placeholder="Record the exact restriction" /><label for="restriction-person">Applies to</label><select id="restriction-person" name="person"><option>Everyone</option>${state.diners.map((name) => `<option>${esc(name)}</option>`).join('')}</select><button class="button secondary" type="submit">Add hard restriction</button></form></section></div><section class="content-section surface"><h2>The week's capacity</h2><ul class="list"><li><div><strong>Monday, 5 October</strong><small>Quick-cook · at most 30 minutes of known hands-on effort</small></div>${badge('Quick-cook')}</li><li><div><strong>Tuesday & Thursday</strong><small>Hands-off · linked leftovers or your confirmed slow-cooker recipe</small></div>${badge('Hands-off')}</li></ul><form id="capacity-form" class="content-section"><label for="capacity-date">Dinner date</label><select id="capacity-date">${currentPlan(state).slots.map((slot) => `<option value="${slot.id}">${slot.day}, ${slot.date.slice(-2)} October</option>`).join('')}</select><label for="capacity-kind">Household capacity</label><select id="capacity-kind"><option value="normal">Normal night</option><option value="quick">Quick-cook night</option><option value="hands-off">Hands-off night</option></select><button class="button secondary" type="submit">Save capacity for review</button></form></section><section class="content-section surface"><h2>Shared access</h2><p>Alex is the sample creator. Robin is an invited member. All current members can edit; the creator manages invitations and access.</p><form id="member-form" class="form-row"><label for="member-email">Invite a member by email</label><input id="member-email" name="email" type="email" required placeholder="name@example.com" /><button class="button secondary" type="submit">Create sample invitation</button></form><p class="small muted" id="member-note">Invitation acceptance requires the same verified email. No email is sent from this prototype.</p></section>`;
}
function invitationView() {
  const content = state.inviteStep === 0 ? `<h2>You've been invited</h2><p>The invitation is for alex@example.test. Sign in and verify that same address before accepting.</p><form id="invite-form"><label for="invite-email">Email address</label><input id="invite-email" type="email" required value="alex@example.test" /><button class="button primary" type="submit">Continue sample sign-in</button></form>` : `<h2>Your email is verified</h2><p>This sample creator invitation will create an empty household. No pilot data is imported.</p>${action('Accept invitation', 'accept-invite', 'primary')}`;
  return heading('Welcome to the table', 'An invitation connects you to your household.') + `<section class="empty-state invitation">${content}</section>`;
}
function dinnerName(slot, mealId = slot.mealId) {
  return slot.sourceId && mealId === slot.mealId ? 'Fajita leftovers' : titleFor(mealId);
}
function groceryPreview(preview) {
  const effect = groceryEffect(state, preview);
  const shopping = shoppingFor(state, preview.planId);
  const items = (list) => list.length ? `<ul class="changes">${list.map((item) => `<li>${esc(item.name)}<small>${esc(item.meals.join(' · '))}${shopping.checkedItems.includes(item.id) ? ' · Previously checked' : ''}${shopping.unavailable.includes(item.id) ? ' · Marked unavailable' : ''}</small></li>`).join('')}</ul>` : '<p>None.</p>';
  const commitments = effect.retained.filter((item) => shopping.checkedItems.includes(item.id));
  return `<h3>Shopping effects</h3><p>New or changed ingredients need confirmation. The earlier shopping record stays in history.</p><h4>Add to current list · unconfirmed</h4>${items(effect.added)}<h4>Remove from current list</h4>${items(effect.removed)}<h4>Retained checked commitments</h4>${items(commitments)}${shopping.confirmed ? '<p>Confirmed shopping history remains recorded; the revised current list is separate.</p>' : ''}`;
}
function showDialog(preview) {
  state.preview = preview;
  const dialog = document.querySelector('#confirmation');
  let title = 'Review the dinner changes';
  let body = '';
  let confirmLabel = 'Confirm these changes';
  if (preview.type === 'week') {
    title = 'Confirm this week';
    body = '<p>Save these seven dinners as the household’s plan. Monday covers Tuesday’s leftovers, hands-off dates have a valid dinner, and takeout is an explicit choice.</p><p>Later changes will preview all affected dinners before saving.</p>';
    confirmLabel = 'Confirm the week';
  } else if (preview.type === 'shopping') {
    const shopping = shoppingFor(state, preview.planId);
    title = shopping.checkedItems.length < groceryItems(state, preview.planId).length || shopping.unavailable.length || incompleteMeals().length ? 'Confirm partial shopping' : 'Confirm shopping';
    body = `<p>${shopping.checkedItems.length} of ${groceryItems(state, preview.planId).length} known items are checked. ${shopping.unavailable.length} marked unavailable.</p><p>Unchecked and incomplete ingredients remain visible. The app won't claim they're available or silently change a dinner.</p>`;
    confirmLabel = 'Confirm shopping status';
  } else if (preview.type === 'correction') {
    title = 'Correct the completed dinner';
    const plan = state.plans.find((p) => p.id === preview.planId);
    body = `<p>Record that the household got takeout instead. Keep dinner completion history, remove false cooking evidence, and preview any unfinished leftover dependency.</p><ul class="changes">${preview.changes.map((c) => { const slot = plan.slots.find((s) => s.id === c.slotId); return `<li><strong>${slot.day}: ${esc(dinnerName(slot, c.before))} → ${esc(titleFor(c.after))}</strong><small>${slot.sourceId ? `Linked to ${esc(dinnerName(plan.slots.find((item) => item.id === slot.sourceId)))} on the source cooking day. ` : ''}${c.slotId === preview.slotId ? 'Completion and the earlier record are retained; false cooking evidence is removed.' : 'The unfinished dependent dinner receives a compatible replacement.'}</small></li>`; }).join('')}</ul>${groceryPreview(preview)}<label for="recovery-reason">What changed? This helps classify the recovery.</label><select id="recovery-reason"><option value="unknown">Not sure</option><option value="external">An unforeseeable disruption</option><option value="timing">Timing, effort or preparation didn't fit</option><option value="acceptance">The shared meal didn't work for everyone</option></select>`;
    confirmLabel = 'Confirm takeout correction';
  } else {
    body = `<p>Only this dinner and the dependencies it needs will change. Other dates and completed dinners stay fixed.</p><ul class="changes">${preview.changes.map((change) => { const slot = currentPlan(state).slots.find((s) => s.id === change.slotId); return `<li><strong>${slot.day}: ${esc(dinnerName(slot, change.before))} → ${esc(titleFor(change.after))}</strong><small>${slot.sourceId ? `Linked to ${esc(dinnerName(currentPlan(state).slots.find((item) => item.id === slot.sourceId)))} on the source cooking day. The old leftover link is removed.` : 'A household-compatible dinner that fits this date.'}</small></li>`; }).join('')}</ul>${groceryPreview(preview)}`;
  }
  document.querySelector('#dialog-content').innerHTML = `<header class="dialog-heading"><h2 id="dialog-title">${title}</h2><button class="icon-button" aria-label="Close review" data-action="close-dialog">${icon('close')}</button></header>${body}<div class="actions">${action(confirmLabel, 'confirm-preview', 'primary')}${action('Keep the current plan', 'close-dialog', 'secondary')}</div>`;
  dialog.showModal();
}
function announce(text) {
  const el = document.querySelector('#announcement');
  el.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.textContent = ''; }, 6500);
}
function render(focusHeading = false) {
  const activeId = document.activeElement?.id;
  const cursor = document.activeElement?.selectionStart;
  const routes = [['today', 'Today'], ['plan', 'Plan'], ['shop', 'Shop'], ['recipes', 'Recipes'], ['household', 'Household']];
  document.querySelector('#navigation').innerHTML = routes.map(([id, name]) => `<a class="nav-link" href="#${id}" ${state.view === id || state.view === 'recipe' && id === 'recipes' ? 'aria-current="page"' : ''}>${icon(id)}<span>${name}</span></a>`).join('');
  let content;
  if (!state.access) content = heading('Your access has ended', 'The household creator has revoked this membership.') + `<section class="empty-state"><h2>Your unsaved draft is kept</h2><p>Household data is no longer shown. Ask the creator for a new invitation if you should still have access.</p>${action('Return to sample sign-in', 'return-sign-in')}</section>`;
  else if (state.loading) content = heading('Loading the household', 'Your dinners are being retrieved.') + `<section class="loading-view" aria-busy="true"><h2>Getting the week ready</h2><p>You can wait or try again. No empty week is being saved over your household.</p><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>${action('Finish sample loading', 'finish-loading', 'secondary')}</section>`;
  else if (state.invitation) content = invitationView();
  else content = ({ plan: planView, today: todayView, shop: shopView, recipes: recipesView, recipe: recipeView, household: householdView }[state.view] ?? planView)();
  document.querySelector('#main').innerHTML = content;
  if (focusHeading) document.querySelector('#page-title')?.focus({ preventScroll: true });
  else if (activeId && document.getElementById(activeId)) {
    const el = document.getElementById(activeId);
    el.focus({ preventScroll: true });
    if (typeof cursor === 'number' && el.setSelectionRange && el.type === 'text') el.setSelectionRange(cursor, cursor);
  }
}
function navigate(view, recipeId = null) {
  state.view = view;
  state.recipeId = recipeId;
  state.editSlotId = null;
  state.message = '';
  render(true);
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function contextFrom(el) {
  if (Number(el.dataset.revision) !== state.revision) throw Error('The household changed. Review this dinner again before continuing.');
  const plan = state.plans.find((p) => p.id === el.dataset.plan);
  const slot = plan?.slots.find((s) => s.id === el.dataset.slot);
  if (!plan || !slot) throw Error('Choose the dinner and plan again.');
  return { plan, slot };
}
function complete(slot, timed) {
  slot.completed = true;
  slot.elapsed = timed && slot.startedAt ? Math.floor((Date.now() - slot.startedAt) / 60000) : null;
  state.revision += 1;
  render();
  announce('Dinner recorded. Add feedback whenever it suits you.');
}
function confirmAction() {
  const preview = state.preview;
  if (!preview) return;
  if (preview.type === 'correction') preview.reason = document.querySelector('#recovery-reason').value;
  const result = confirmPreview(state, preview);
  document.querySelector('#confirmation').close();
  if (!result.ok) { state.saveState = 'conflict'; state.message = result.reason; render(); announce(result.reason); return; }
  if (preview.type === 'week') currentPlan(state).confirmed = true;
  if (preview.type === 'shopping') { const shopping = shoppingFor(state, preview.planId); const snapshot = groceryItems(state, preview.planId).map((item) => ({ ...item, checked: shopping.checkedItems.includes(item.id), unavailable: shopping.unavailable.includes(item.id) })); shopping.history.push(snapshot); shopping.snapshot ??= snapshot; shopping.confirmed = true; }
  state.preview = null; state.editSlotId = null; state.broken = false; state.saveState = 'saved';
  render(); announce(preview.type === 'week' ? 'The week is confirmed. Your shopping list is ready.' : 'Confirmed. The household history is retained.');
}
function applyScenario(name) {
  state = createDemoState();
  const plan = currentPlan(state);
  if (name !== 'week' && name !== 'empty' && name !== 'invite') plan.confirmed = true;
  if (name === 'shopping') state.view = 'shop';
  if (['cooking', 'feedback', 'broken', 'multiple', 'no-plan', 'source-correction'].includes(name)) state.view = 'today';
  if (name === 'feedback') { plan.slots[0].completed = true; state.showFeedback = true; }
  if (name === 'broken') { state.broken = true; state.sampleDate = '2026-10-06'; }
  if (name === 'multiple') state.plans.push({ ...structuredClone(plan), id: 'plan-overlap', name: 'Catch-up plan · includes 5 October', slots: plan.slots.map((s, i) => ({ ...s, id: `other-${i}`, sourceId: null, mealId: i === 0 ? 'chili' : s.mealId })) });
  if (name === 'no-plan') plan.confirmed = false;
  if (name === 'empty' || name === 'invite') { state.empty = true; state.diners = []; state.restrictions = []; }
  if (name === 'empty') state.view = 'household';
  if (name === 'invite') state.invitation = true;
  if (name === 'loading') state.loading = true;
  if (['pending', 'failed', 'conflict'].includes(name)) state.saveState = name;
  if (name === 'revoked') state.access = false;
  if (name === 'library') { state.largeLibrary = true; state.view = 'recipes'; }
  if (name === 'source-correction') { plan.slots[0].completed = true; plan.slots[1].completed = true; }
  document.querySelector('#confirmation').close();
  document.querySelector('#situations').open = false;
  history.replaceState(null, '', `#${state.view}`);
  render(true); window.scrollTo({ top: 0, behavior: 'instant' });
}
if (typeof document !== 'undefined') {
  document.addEventListener('click', (event) => {
    const el = event.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const key = el.dataset.action;
    try {
      if (key.startsWith('go-')) { if (key === 'go-today') state.historyTarget = null; location.hash = key.slice(3); return; }
      if (key === 'close-dialog') { document.querySelector('#confirmation').close(); state.preview = null; return; }
      if (key === 'confirm-preview') { confirmAction(); return; }
      if (key === 'finish-save' || key === 'retry') { state.saveState = 'saved'; render(); announce('Sample save completed. Your draft is retained.'); return; }
      if (key === 'review-conflict') { state.saveState = 'saved'; state.revision++; state.message = 'The updated week is shown. Your draft remains available; confirm a fresh preview before applying it.'; render(); return; }
      if (key === 'view-draft') { announce('Your draft is retained. Review the updated week before saving.'); return; }
      if (key === 'finish-loading') { state.loading = false; render(); return; }
      if (key === 'return-sign-in') { state = createDemoState(); state.invitation = true; render(); return; }
      if (key === 'accept-invite') { state.invitation = false; state.empty = true; state.view = 'household'; render(true); return; }
      if (state.saveState === 'pending') { announce('Please wait for the current save before changing the week.'); return; }
      if (key === 'confirm-week') {
        const ready = readiness(state); if (!ready.compatible || !ready.capacity || !ready.leftovers) { announce('Compatibility, capacity, or leftovers need review before this week can be confirmed.'); return; }
        showDialog({ type: 'week', planId: currentPlan(state).id, expectedRevision: state.revision }); return;
      }
      if (key === 'edit-slot') { state.editSlotId = state.editSlotId === el.dataset.slot ? null : el.dataset.slot; render(); return; }
      if (key === 'cancel-edit') { state.editSlotId = null; render(); return; }
      if (key === 'review-repair') { const { plan, slot } = contextFrom(el); const preview = previewMealChange(state, plan.id, slot.id, document.querySelector('#meal-choice').value); if (preview) showDialog(preview); else announce('This dinner is already selected.'); return; }
      if (key === 'history') { navigate('today'); state.historyTarget = { planId: el.dataset.plan, slotId: el.dataset.slot }; state.showFeedback = true; render(); return; }
      if (key === 'open-recipe') { location.hash = `recipe-${el.dataset.meal}`; return; }
      if (key === 'toggle-meal-form') { state.showMealForm = !state.showMealForm; render(); document.querySelector('#meal-name')?.focus(); return; }
      if (key === 'clear-search') { state.query = ''; state.category = 'All'; render(); return; }
      if (key === 'confirm-safety') { if (!document.querySelector('#compatibility-reviewed').checked) { announce('Explicit confirmation is needed before compatibility can change.'); return; } const meal = libraryMeals().find((m) => m.id === el.dataset.meal); meal.safe = true; if (!state.meals.includes(meal)) state.meals.push(meal); render(); announce('Household compatibility explicitly confirmed for this sample meal.'); return; }
      if (key === 'unavailable') { const shopping = shoppingFor(state); const id = el.dataset.item; shopping.unavailable = shopping.unavailable.includes(id) ? shopping.unavailable.filter((x) => x !== id) : [...shopping.unavailable, id]; shopping.checkedItems = shopping.checkedItems.filter((x) => x !== id); render(); return; }
      if (key === 'confirm-shopping') { showDialog({ type: 'shopping', planId: currentPlan(state).id, expectedRevision: state.revision }); return; }
      if (key === 'shopping-repair') { navigate('plan'); state.message = 'Shopping is retained. Choose the affected dinner to preview a repair; ingredients have not been assumed available.'; render(); return; }
      if (key === 'choose-today-plan') { state.todayChoice = { planId: el.dataset.plan, slotId: el.dataset.slot, date: state.sampleDate }; render(); return; }
      if (key === 'start-cooking') { const { slot } = contextFrom(el); slot.startedAt = Date.now(); render(); announce('Cooking started. Elapsed time uses this recorded start.'); return; }
      if (key === 'dinner-ready' || key === 'record-without-timing') { const { slot } = contextFrom(el); complete(slot, key === 'dinner-ready'); return; }
      if (key === 'toggle-feedback') { state.showFeedback = !state.showFeedback; render(); return; }
      if (key === 'correct-dinner') { const { plan, slot } = contextFrom(el); showDialog(previewCorrection(state, plan.id, slot.id)); return; }
      if (key === 'broken-repair') { const { plan, slot } = contextFrom(el); showDialog(previewMealChange(state, plan.id, slot.id, 'chili')); return; }
      if (key === 'recovery-options') { const { slot } = contextFrom(el); navigate('plan'); state.editSlotId = slot.id; state.message = 'Choose a different compatible household dinner or explicit takeout. The review will show every required dependency change.'; render(); return; }
    } catch (error) { announce(error.message); }
  });
  document.addEventListener('input', (event) => { if (event.target.id === 'recipe-search') { state.query = event.target.value; render(); } });
  document.addEventListener('change', (event) => {
    const el = event.target;
    if (el.id === 'scenario') { applyScenario(el.value); return; }
    if (el.id === 'plan-choice') { state.selectedPlanId = el.value; render(); return; }
    if (el.id === 'recipe-category') { state.category = el.value; render(); return; }
    if (el.id === 'recipe-version') { document.querySelector('#version-note').textContent = el.selectedIndex ? 'Sample sheet-pan version: 15 minutes hands-on. Slice the same ingredients, spread on a tray, and roast until the chicken is cooked through. This is a version of the same meal.' : 'Reserve plain chicken before combining if that helps the shared meal.'; return; }
    if (el.id === 'recipe-zip') { document.querySelector('#import-note').textContent = 'Sample import review: add as a new meal, link to an existing meal, or save recipe only. The selected file has not been read or uploaded.'; return; }
    if (el.dataset.item) { const shopping = shoppingFor(state); shopping.checkedItems = el.checked ? [...new Set([...shopping.checkedItems, el.dataset.item])] : shopping.checkedItems.filter((id) => id !== el.dataset.item); if (el.checked) shopping.unavailable = shopping.unavailable.filter((id) => id !== el.dataset.item); render(); }
  });
  document.addEventListener('submit', (event) => {
    event.preventDefault(); const form = event.target; const values = new FormData(form);
    if (form.id === 'feedback-form') { const responses = state.diners.map((_, i) => values.get(`person-${i}`) || null); const effort = values.get('effort'); const leftover = values.get('leftovers'); const dependent = recordFeedback(state, form.dataset.plan, form.dataset.slot, responses, effort === null || effort === '' ? null : Number(effort), leftover === null || leftover === 'unknown' ? null : leftover === 'yes'); if (state.broken && dependent) { state.sampleDate = dependent.date; state.historyTarget = null; state.showFeedback = false; } render(); announce(responses.includes('rejected') ? 'Feedback saved. The shared dinner was not accepted by everyone; individual acceptance is retained.' : 'Feedback saved. Unreported and neutral responses remain distinct.'); }
    if (form.id === 'diner-form') { state.diners.push(values.get('name').trim()); render(); announce('Diner added to the sample household.'); }
    if (form.id === 'restriction-form') { state.restrictions.push(`${values.get('restriction').trim()} · ${values.get('person')}`); state.meals.forEach((m) => { m.safe = false; }); state.message = 'Compatibility needs review after the new hard restriction. Existing dinners have not been silently replaced.'; render(); announce('Restriction saved. Confirm meal compatibility before planning again.'); }
    if (form.id === 'meal-form') { state.meals.push({ id: `user-${state.meals.length}`, name: values.get('name').trim(), category: 'Name-only', safe: !state.restrictions.length, ingredients: [], steps: [] }); state.showMealForm = false; render(); announce('Name-only meal added. Ingredients and effort remain unknown.'); }
    if (form.id === 'capacity-form') { const slot = currentPlan(state).slots.find((s) => s.id === document.querySelector('#capacity-date').value); slot.capacity = document.querySelector('#capacity-kind').value; state.revision++; state.message = 'Capacity changed. Review the affected unfinished dinner before confirming any repair.'; announce(state.message); location.hash = 'plan'; }
    if (form.id === 'member-form') { document.querySelector('#member-note').textContent = `Sample invitation created for ${values.get('email')}. It must be accepted with that same verified address. No email was sent.`; }
    if (form.id === 'invite-form') { if (document.querySelector('#invite-email').value !== 'alex@example.test') { announce('This sample invitation belongs to alex@example.test. Use that verified address.'); return; } state.inviteStep = 1; render(); }
  });
  document.querySelector('#reset-demo').addEventListener('click', () => { document.querySelector('#scenario').value = 'week'; applyScenario('week'); });
  window.addEventListener('hashchange', () => { const hash = location.hash.slice(1); if (hash === 'today') state.historyTarget = null; hash.startsWith('recipe-') ? navigate('recipe', hash.slice(7)) : navigate(hash || 'plan'); });
  const initial = location.hash.slice(1);
  if (initial.startsWith('recipe-')) { state.view = 'recipe'; state.recipeId = initial.slice(7); }
  else if (['today', 'plan', 'shop', 'recipes', 'household'].includes(initial)) state.view = initial;
  render();
}
