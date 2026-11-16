// V8 calculation tests. Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../public/v8-calc.js');

const food = { id: 1, name: 'Tavuk göğsü', kcal_100g: 120, protein_100g: 22.5, carbs_100g: 0, fat_100g: 2.6 };

test('nutrientsFor scales per-100g values by grams', () => {
  assert.deepEqual(C.nutrientsFor(food, 150), { grams: 150, kcal: 180, protein: 33.8, carbs: 0, fat: 3.9 });
  assert.equal(C.nutrientsFor(food, 0), null);
  assert.equal(C.nutrientsFor(food, 'x'), null);
  assert.equal(C.nutrientsFor(null, 100), null);
});

test('gramsFromPortion multiplies user-supplied portion size', () => {
  assert.equal(C.gramsFromPortion(1.5, 30), 45);
  assert.equal(C.gramsFromPortion(2, ''), null);
  assert.equal(C.gramsFromPortion(0, 30), null);
});

test('searchFoods is Turkish- and accent-insensitive, prefix matches first', () => {
  const foods = [food, { id: 2, name: 'Yulaf ezmesi' }, { id: 3, name: 'Izgara tavuk' }, { id: 4, name: 'Süt' }];
  assert.deepEqual(C.searchFoods(foods, 'gogsu').map(f => f.id), [1]);
  assert.deepEqual(C.searchFoods(foods, 'TAVUK').map(f => f.id), [1, 3]);
  assert.deepEqual(C.searchFoods(foods, 'sut').map(f => f.id), [4]);
  assert.deepEqual(C.searchFoods(foods, 'ızgara tav').map(f => f.id), [3]);
  assert.equal(C.searchFoods(foods, '').length, 4);
  assert.deepEqual(C.searchFoods(foods, 'pizza'), []);
});

const logs = [
  { consumed_on: '2026-11-16', grams: 200, kcal_100g: 100, protein_100g: 10, carbs_100g: 5, fat_100g: 1 },
  { consumed_on: '2026-11-16', grams: 100, kcal_100g: 300 },
  { consumed_on: '2026-11-14', grams: 100, kcal_100g: 1000 },
  { consumed_on: '2026-11-05', grams: 100, kcal_100g: 800 }
];

test('dailyTotals sums kcal and macros per day', () => {
  const t = C.dailyTotals(logs).get('2026-11-16');
  assert.equal(t.kcal, 500); assert.equal(t.protein, 20); assert.equal(t.count, 2);
});

test('daySeries marks empty days without inventing values', () => {
  const s = C.daySeries(logs, '2026-11-14', 3);
  assert.deepEqual(s.map(x => [x.date, x.kcal, x.hasData]), [['2026-11-14', 1000, true], ['2026-11-15', 0, false], ['2026-11-16', 500, true]]);
});

test('averages only count days/weeks with records', () => {
  assert.deepEqual(C.dailyAverage(logs, '2026-11-16', 7), { value: 750, days: 2 });
  assert.deepEqual(C.dailyAverage([], '2026-11-16', 7), { value: null, days: 0 });
  // 2026-11-16 is Monday: weeks 10-26..11-01 (none), 11-02 (800), 11-09 (1000), 11-16 (500)
  assert.deepEqual(C.weeklyAverage(logs, '2026-11-16', 4), { value: 767, weeks: 3 });
});

test('week and month helpers', () => {
  assert.equal(C.weekStart('2026-11-22'), '2026-11-16');
  assert.equal(C.weekStart('2026-11-16'), '2026-11-16');
  assert.equal(C.monthStart('2026-11-16'), '2026-11-01');
  assert.equal(C.daysInMonth('2028-02-10'), 29);
  assert.equal(C.shiftMonth('2026-01-31', -1), '2025-12-01');
  assert.equal(C.addDays('2026-12-31', 1), '2027-01-01');
});

test('bmi and WHO categories', () => {
  assert.equal(C.bmi(70, 175), 22.9);
  assert.equal(C.bmi(70, 50), null);
  assert.equal(C.bmiCategory(18.4).key, 'under');
  assert.equal(C.bmiCategory(18.5).key, 'normal');
  assert.equal(C.bmiCategory(25).key, 'over');
  assert.equal(C.bmiCategory(30).key, 'obese');
  assert.equal(C.bmiCategory(null), null);
});

test('Mifflin-St Jeor BMR and activity-based TDEE', () => {
  assert.equal(C.bmr({ sex: 'male', weight: 80, height: 180, age: 30 }), 1780);
  assert.equal(C.bmr({ sex: 'female', weight: 60, height: 165, age: 25 }), 1345);
  assert.equal(C.bmr({ sex: 'female', weight: 60, height: 165, age: 16 }), null);
  assert.deepEqual(C.tdee({ sex: 'male', weight: 80, height: 180, age: 30, activity: 'moderate' }), { bmr: 1780, factor: 1.55, tdee: 2759 });
  assert.equal(C.tdee({ sex: 'male', weight: 80, height: 180, age: 30, activity: '' }), null);
});
