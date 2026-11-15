import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modisWindow } from './modis.ts';
import { places } from './data.ts';

test('MODIS window is the square around a city-sized area and rejects large or global areas', () => {
  const phoenix = modisWindow(places[0]);
  assert.ok(phoenix.half >= 25 && phoenix.half <= 40);
  assert.equal(modisWindow({name: 'p', kind: 'point', lon: 1, lat: 2}).half, 3);
  assert.throws(() => modisWindow(places[2]), /100 km/); // Amazon basin
  assert.throws(() => modisWindow({name: 'World', kind: 'global', lon: 0, lat: 0}), /100 km/);
});
