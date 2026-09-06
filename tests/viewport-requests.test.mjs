import assert from 'node:assert/strict';
import test from 'node:test';
import { geometryDocumentKey, LatestViewportRequest } from '../app/components/viewportRequests.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const calls = [], applied = [], errors = [];
  const queue = new LatestViewportRequest(key => new Promise((resolve, reject) => calls.push({key, resolve, reject})), (value, key) => applied.push({value, key}), error => errors.push(error));
  return {queue, calls, applied, errors};
}
test('display-only changes do not invalidate geometry, but dimensions do', () => {
  const doc = {sketches:[{id:'s', name:'Sketch', visible:true, entities:[]}], features:[{id:'f', name:'Extrude', distance:10, bodyVisible:true}]};
  const renamed = structuredClone(doc);
  renamed.features[0].name = 'Renamed'; renamed.features[0].bodyVisible = false; renamed.sketches[0].visible = false;
  assert.equal(geometryDocumentKey(doc), geometryDocumentKey(renamed));
  renamed.features[0].distance = 12;
  assert.notEqual(geometryDocumentKey(doc), geometryDocumentKey(renamed));
});
test('identical selection-time requests are deduplicated', async () => {
  const h = harness(); h.queue.request('A'); h.queue.request('A');
  assert.equal(h.calls.length, 1); h.calls[0].resolve('mesh'); await tick();
  h.queue.request('A'); assert.equal(h.calls.length, 1);
  assert.deepEqual(h.applied, [{value:'mesh', key:'A'}]);
});
test('rapid preview edits have one running request and only the latest pending input', async () => {
  const h = harness(); h.queue.request('A'); h.queue.request('B'); h.queue.request('C');
  assert.deepEqual(h.calls.map(c=>c.key), ['A']);
  h.calls[0].resolve('stale'); await tick();
  assert.deepEqual(h.applied, []); assert.deepEqual(h.calls.map(c=>c.key), ['A','C']);
  h.calls[1].resolve('latest'); await tick();
  assert.deepEqual(h.applied, [{value:'latest', key:'C'}]);
});
test('stale failures do not show rebuild errors for a newer valid preview', async () => {
  const h = harness(); h.queue.request('A'); h.queue.request('B');
  h.calls[0].reject(new Error('old failure')); await tick(); assert.equal(h.errors.length, 0);
  h.calls[1].resolve('ok'); await tick(); assert.equal(h.applied[0].value, 'ok');
});
test('current failures report without applying geometry and subsequent edits recover', async () => {
  const h = harness(); h.queue.request('A'); h.calls[0].reject(new Error('invalid radius')); await tick();
  assert.equal(h.errors[0].message, 'invalid radius'); assert.equal(h.applied.length, 0);
  h.queue.request('B'); h.calls[1].resolve('repaired'); await tick(); assert.equal(h.applied[0].value, 'repaired');
});
test('disposing or invalidating a drag rejects its late results', async () => {
  for (const action of ['dispose','invalidate']) {
    const h = harness(); h.queue.request('A'); h.queue.request('B'); h.queue[action]();
    h.calls[0].resolve('late'); await tick(); assert.equal(h.applied.length, 0); assert.equal(h.calls.length, 1);
  }
});
