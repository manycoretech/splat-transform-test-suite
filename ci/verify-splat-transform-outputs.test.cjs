const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  assertAutoChunkLogMatchesMeta,
  assertLodMetaMatchesBaseline,
  assertNormalizedLogMatchesBaseline,
  normalizeLog,
  validateLodMeta,
  validateLodMetaRanges,
} = require('./verify-splat-transform-outputs.cjs');

function makeMeta() {
  const box = { min: [0, -1000, -1], max: [1, 1000, 1] };
  return {
    magicCode: 2500660,
    type: 'lod-splat',
    version: '1.0',
    counts: 20000,
    shDegree: 3,
    levels: 2,
    forwardBox: structuredClone(box),
    files: ['chunk_0.spz', 'chunk_1.spz'],
    permanentFiles: [1],
    tree: [0, 1].map((index) => ({
      bound: structuredClone(box),
      lods: [
        { file: 0, offset: index * 10000, count: 10000 },
        { file: 1, offset: index * 50, count: 50 },
      ],
    })),
  };
}

function makeAutoLog() {
  return {
    kind: 'auto',
    read: { count: 10000, sh: 3 },
    expected: { count: 3000, percent: '30.00%', ratio: '0.3', counts: 'Infinity' },
    result: { count: 3000, percent: 100 },
    write: { file: 'sample.spz', count: 3000, sh: 3 },
  };
}

for (const scene of ['bear', 'xiaozhen']) {
  test(`${scene} regenerated logs agree with the metadata`, () => {
    const baselineDir = path.join(__dirname, 'baselines', scene);
    const meta = JSON.parse(fs.readFileSync(path.join(baselineDir, 'lod-meta.json'), 'utf8'));
    validateLodMetaRanges(scene, meta);
    for (const kind of ['auto', 'auto-chunk']) {
      const log = normalizeLog(fs.readFileSync(path.join(baselineDir, `${kind}.log`), 'utf8'), kind);
      assertNormalizedLogMatchesBaseline(scene, log, structuredClone(log));
      if (kind === 'auto-chunk') {
        assertAutoChunkLogMatchesMeta(scene, log, meta);
      }
    }
  });
}

test('coordinates at the absolute tolerance boundary pass, including near zero', () => {
  const baseline = makeMeta();
  const current = structuredClone(baseline);
  for (const box of [current.forwardBox, ...current.tree.map((block) => block.bound)]) {
    box.min[0] = -0.000001;
    box.max[0] = 1.000001;
  }
  assertLodMetaMatchesBaseline('bounds', current, baseline);
});

test('large positive and negative coordinates use relative tolerance', () => {
  const baseline = makeMeta();
  const current = structuredClone(baseline);
  for (const box of [current.forwardBox, ...current.tree.map((block) => block.bound)]) {
    box.min[1] = -1000.001;
    box.max[1] = 1000.001;
  }
  assertLodMetaMatchesBaseline('bounds', current, baseline);
});

test('coordinate drift beyond either tolerance fails with its JSON path', () => {
  const baseline = makeMeta();
  for (const select of [(meta) => meta.forwardBox, (meta) => meta.tree[0].bound]) {
    for (const [side, axis, value] of [
      ['min', 0, -0.0000011], ['max', 0, 1.0000011],
      ['min', 1, -1000.0011], ['max', 1, 1000.0011],
    ]) {
      const current = structuredClone(baseline);
      select(current)[side][axis] = value;
      assert.throws(() => assertLodMetaMatchesBaseline('bounds', current, baseline),
        /coordinate at \$\..*changed beyond tolerance/);
    }
  }
});

test('coordinate tolerance rejects non-finite values and numeric strings', () => {
  const baseline = makeMeta();
  for (const value of [NaN, Infinity, -Infinity, '0']) {
    const current = structuredClone(baseline);
    current.forwardBox.min[0] = value;
    assert.throws(() => assertLodMetaMatchesBaseline('bounds', current, baseline),
      /finite numbers|expected type number/);
  }
});

test('count and nonzero offset tolerances still allow 1 percent or one point', () => {
  const baseline = makeMeta();
  const current = structuredClone(baseline);
  current.tree[0].lods[0].count = 10100;
  current.tree[1].lods[0].offset = 10100;
  current.tree[0].lods[1].count = 51;
  current.tree[1].lods[1].offset = 51;
  assertLodMetaMatchesBaseline('counts', current, baseline);
  validateLodMetaRanges('counts', current);
});

test('count and offset changes beyond tolerance fail', () => {
  const baseline = makeMeta();
  for (const change of [
    (meta) => { meta.tree[0].lods[0].count = 10101; },
    (meta) => { meta.tree[1].lods[0].offset = 10101; },
    (meta) => { meta.tree[0].lods[1].count = 52; },
  ]) {
    const current = structuredClone(baseline);
    change(current);
    assert.throws(() => assertLodMetaMatchesBaseline('counts', current, baseline), /beyond tolerance/);
  }
});

test('schema, file references, input counts and zero offsets remain exact', () => {
  const baseline = makeMeta();
  for (const change of [
    (meta) => { meta.version = '1.1'; },
    (meta) => { meta.magicCode += 1; },
    (meta) => { meta.counts += 1; },
    (meta) => { meta.shDegree = 2; },
    (meta) => { meta.levels = 3; },
    (meta) => { meta.files[0] = 'wrong.spz'; },
    (meta) => { meta.permanentFiles[0] = 0; },
    (meta) => { meta.tree[0].lods[0].file = 1; },
    (meta) => { meta.tree[0].lods[0].offset = 1; },
    (meta) => { meta.tree.pop(); },
    (meta) => { meta.forwardBox.min.pop(); },
    (meta) => { meta.forwardBox.extra = 0; },
  ]) {
    const current = structuredClone(baseline);
    change(current);
    assert.throws(() => assertLodMetaMatchesBaseline('structure', current, baseline));
  }
});

test('range gaps and overlaps fail even when the offset is within tolerance', () => {
  const baseline = makeMeta();
  for (const offset of [9999, 10001]) {
    const current = structuredClone(baseline);
    current.tree[1].lods[0].offset = offset;
    assertLodMetaMatchesBaseline('ranges', current, baseline);
    assert.throws(() => validateLodMetaRanges('ranges', current), /gap or overlap/);
  }
});

test('metadata validation rejects malformed and inverted boxes independently of tolerance', (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'splat-meta-'));
  const baseline = makeMeta();
  t.after(() => {
    for (const file of baseline.files) fs.unlinkSync(path.join(outputDir, file));
    fs.rmdirSync(outputDir);
  });
  for (const file of baseline.files) fs.writeFileSync(path.join(outputDir, file), 'fixture');
  validateLodMeta('valid', outputDir, baseline);
  for (const select of [(meta) => meta.forwardBox, (meta) => meta.tree[0].bound]) {
    for (const change of [
      (box) => { box.min = [0, 0]; },
      (box) => { box.max[0] = Infinity; },
      (box) => { box.min[0] = '0'; },
      (box) => { box.min[0] = box.max[0] + 1e-8; },
    ]) {
      const current = structuredClone(baseline);
      change(select(current));
      assert.throws(() => validateLodMeta('invalid', outputDir, current), /finite coordinates|inverted bounds/);
    }
  }
});

test('auto logs accept the count tolerance boundary and reject larger changes', () => {
  const baseline = makeAutoLog();
  const current = structuredClone(baseline);
  current.result = { count: 3030, percent: 101 };
  current.write.count = 3030;
  assertNormalizedLogMatchesBaseline('auto', current, baseline);
  current.result = { count: 3031, percent: 101.03 };
  current.write.count = 3031;
  assert.throws(() => assertNormalizedLogMatchesBaseline('auto', current, baseline), /beyond tolerance/);
});

test('log count and percentage consistency remain strict', () => {
  const baseline = makeAutoLog();
  const current = structuredClone(baseline);
  current.result.percent = 100.01;
  assert.throws(() => assertNormalizedLogMatchesBaseline('auto', current, baseline), /result percent/);
  current.result.percent = 100;
  current.write.count += 1;
  assert.throws(() => assertNormalizedLogMatchesBaseline('auto', current, baseline), /result\/write count/);
});

test('chunk log totals must match metadata exactly', () => {
  const meta = makeMeta();
  const log = {
    read: { count: 20000 },
    total: { blocks: 2, chunkFiles: 2 },
    levels: [{ count: 20000 }, { count: 100 }],
  };
  assertAutoChunkLogMatchesMeta('chunk', log, meta);
  log.levels[1].count += 1;
  assert.throws(() => assertAutoChunkLogMatchesMeta('chunk', log, meta), /level 1 count/);
});
