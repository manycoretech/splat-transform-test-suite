const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = resolveWorkspacePath(process.env.SPLAT_TEST_OUT_DIR || 'out');
const BASELINE_DIR = resolveWorkspacePath(process.env.SPLAT_TEST_BASELINE_DIR || path.join('ci', 'baselines'));

const QUANTITY_RELATIVE_TOLERANCE = 0.01;
const QUANTITY_ABSOLUTE_TOLERANCE = 1;

const TESTS = [
  {
    label: 'bear lod:auto',
    output: 'bear.spz',
    kind: 'file',
    expectedFileCount: 1,
    log: {
      kind: 'auto',
      current: path.join('logs', 'bear-auto.log'),
      baseline: path.join('bear', 'auto.log'),
    },
  },
  {
    label: 'bear lod:auto-chunk',
    output: 'bear',
    kind: 'directory',
    baselineMeta: path.join('bear', 'lod-meta.json'),
    log: {
      kind: 'auto-chunk',
      current: path.join('logs', 'bear-auto-chunk.log'),
      baseline: path.join('bear', 'auto-chunk.log'),
    },
  },
  {
    label: 'xiaozhen lod:auto',
    output: 'xiaozhen.spz',
    kind: 'file',
    expectedFileCount: 1,
    log: {
      kind: 'auto',
      current: path.join('logs', 'xiaozhen-auto.log'),
      baseline: path.join('xiaozhen', 'auto.log'),
    },
  },
  {
    label: 'xiaozhen lod:auto-chunk',
    output: 'xiaozhen',
    kind: 'directory',
    baselineMeta: path.join('xiaozhen', 'lod-meta.json'),
    log: {
      kind: 'auto-chunk',
      current: path.join('logs', 'xiaozhen-auto-chunk.log'),
      baseline: path.join('xiaozhen', 'auto-chunk.log'),
    },
  },
];

function resolveWorkspacePath(value) {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(ROOT, value);
}

function readText(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing file: ${file}`);
  }

  return fs.readFileSync(file, 'utf8');
}

function readJson(file) {
  return JSON.parse(readText(file));
}

function listFiles(target) {
  const stats = fs.statSync(target);

  if (stats.isFile()) {
    return [target];
  }

  if (!stats.isDirectory()) {
    throw new Error(`Expected a file or directory: ${target}`);
  }

  return fs.readdirSync(target, { withFileTypes: true })
    .flatMap((entry) => listFiles(path.join(target, entry.name)));
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${label} changed: expected ${expected}, got ${actual}`);
  }
}

function assertArrayEqual(label, actual, expected) {
  if (actual.length !== expected.length) {
    throw new Error(`${label} length changed: expected ${expected.length}, got ${actual.length}`);
  }

  for (let index = 0; index < expected.length; index += 1) {
    assertEqual(`${label}[${index}]`, actual[index], expected[index]);
  }
}

function assertWithinTolerance(
  label,
  actual,
  expected,
  absoluteTolerance = QUANTITY_ABSOLUTE_TOLERANCE,
) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) {
    throw new Error(`${label} should contain finite numbers: expected ${expected}, got ${actual}`);
  }

  const delta = Math.abs(actual - expected);
  const allowed = Math.max(absoluteTolerance, Math.abs(expected) * QUANTITY_RELATIVE_TOLERANCE);
  const roundingEpsilon = Number.EPSILON * Math.max(1, Math.abs(actual), Math.abs(expected)) * 4;

  if (delta - allowed > roundingEpsilon) {
    throw new Error(`${label} changed beyond tolerance: expected ${expected}, got ${actual} (delta ${delta}, allowed ${allowed})`);
  }
}

function assertDeepEqual(label, actual, expected, jsonPath = '$', leafComparator = null) {
  if (Object.is(actual, expected)) {
    return;
  }

  if (typeof actual !== typeof expected) {
    throw new Error(`${label} mismatch at ${jsonPath}: expected type ${typeof expected}, got ${typeof actual}`);
  }

  if (actual === null || expected === null || typeof actual !== 'object') {
    if (leafComparator && leafComparator(label, actual, expected, jsonPath)) {
      return;
    }

    throw new Error(`${label} mismatch at ${jsonPath}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }

  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected)) {
      throw new Error(`${label} mismatch at ${jsonPath}: expected array shape changed.`);
    }

    assertEqual(`${label} array length at ${jsonPath}`, actual.length, expected.length);

    for (let index = 0; index < expected.length; index += 1) {
      assertDeepEqual(label, actual[index], expected[index], `${jsonPath}[${index}]`, leafComparator);
    }

    return;
  }

  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  assertArrayEqual(`${label} object keys at ${jsonPath}`, actualKeys, expectedKeys);

  for (const key of expectedKeys) {
    assertDeepEqual(label, actual[key], expected[key], `${jsonPath}.${key}`, leafComparator);
  }
}

function assertLodMetaMatchesBaseline(label, actual, expected) {
  const lodQuantityPath = /^\$\.tree\[\d+\]\.lods\[\d+\]\.(count|offset)$/;

  assertDeepEqual(label, actual, expected, '$', (leafLabel, actualValue, expectedValue, jsonPath) => {
    const match = jsonPath.match(lodQuantityPath);

    if (!match || (match[1] === 'offset' && expectedValue === 0)) {
      return false;
    }

    assertWithinTolerance(`${leafLabel} quantity at ${jsonPath}`, actualValue, expectedValue);
    return true;
  });
}

function assertExpectedKind(label, target, kind) {
  const stats = fs.statSync(target);

  if (kind === 'file' && !stats.isFile()) {
    throw new Error(`${label} should be a file: ${target}`);
  }

  if (kind === 'directory' && !stats.isDirectory()) {
    throw new Error(`${label} should be a directory: ${target}`);
  }
}

function assertNonEmptyFiles(label, files) {
  const emptyFile = files.find((file) => fs.statSync(file).size <= 0);

  if (emptyFile) {
    throw new Error(`${label} produced an empty output file: ${emptyFile}`);
  }
}

function validateLodMetaRanges(label, meta) {
  const rangesByFile = new Map();

  for (const block of meta.tree) {
    for (const lod of block.lods) {
      const ranges = rangesByFile.get(lod.file) || new Map();
      ranges.set(`${lod.offset}:${lod.count}`, { offset: lod.offset, count: lod.count });
      rangesByFile.set(lod.file, ranges);
    }
  }

  for (const [fileIndex, uniqueRanges] of rangesByFile) {
    const ranges = [...uniqueRanges.values()].sort((left, right) => left.offset - right.offset);
    let expectedOffset = 0;

    for (const range of ranges) {
      if (range.offset !== expectedOffset) {
        throw new Error(
          `${label} meta file ${fileIndex} has a gap or overlap at offset ${range.offset}; expected ${expectedOffset}`,
        );
      }

      expectedOffset += range.count;
    }
  }
}

function validateLodMeta(label, outputDir, meta) {
  assertEqual(`${label} meta magicCode`, meta.magicCode, 2500660);
  assertEqual(`${label} meta type`, meta.type, 'lod-splat');
  assertEqual(`${label} meta version`, meta.version, '1.0');

  if (!Array.isArray(meta.files)) {
    throw new Error(`${label} meta files should be an array.`);
  }

  if (!Array.isArray(meta.tree)) {
    throw new Error(`${label} meta tree should be an array.`);
  }

  assertEqual(`${label} meta files unique count`, new Set(meta.files).size, meta.files.length);

  for (const file of meta.files) {
    if (!fs.existsSync(path.join(outputDir, file))) {
      throw new Error(`${label} meta references missing chunk file: ${file}`);
    }
  }

  for (const [blockIndex, block] of meta.tree.entries()) {
    if (!Array.isArray(block.lods)) {
      throw new Error(`${label} meta tree[${blockIndex}].lods should be an array.`);
    }

    assertEqual(`${label} meta tree[${blockIndex}].lod count`, block.lods.length, meta.levels);

    for (const [levelIndex, lod] of block.lods.entries()) {
      if (!Number.isInteger(lod.file) || lod.file < 0 || lod.file >= meta.files.length) {
        throw new Error(`${label} meta tree[${blockIndex}].lods[${levelIndex}] references invalid file index: ${lod.file}`);
      }

      if (!Number.isInteger(lod.offset) || lod.offset < 0) {
        throw new Error(`${label} meta tree[${blockIndex}].lods[${levelIndex}] has invalid offset: ${lod.offset}`);
      }

      if (!Number.isInteger(lod.count) || lod.count <= 0) {
        throw new Error(`${label} meta tree[${blockIndex}].lods[${levelIndex}] has invalid count: ${lod.count}`);
      }
    }
  }

  validateLodMetaRanges(label, meta);
}

function normalizePathToken(value) {
  const normalized = value.replace(/\\/g, '/').replace(/^"|"$/g, '');
  return normalized.split('/').at(-1);
}

function parsePercent(value, label) {
  const normalized = value.trim();

  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)%$/.test(normalized)) {
    throw new Error(`${label} is not a percentage: ${value}`);
  }

  return Number(normalized.slice(0, -1));
}

function normalizeAutoLog(log) {
  const readMatch = log.match(/counts:\s*(\d+),\s*SH:\s*(\d+)/);
  const expectedMatch = log.match(/expected ->\s*(\d+)\(([^)]+)\)\s*\|\s*ratio=([^\s]+)\s+counts=([^\s]+)/);
  const resultMatch = log.match(/result ->\s*(\d+)\(([^)]+)\)/);
  const writeMatch = log.match(/writing splat -> file=("[^"]+"|\S+)\s+count=(\d+)\s+SH=(\d+)/);

  if (!readMatch || !expectedMatch || !resultMatch || !writeMatch) {
    throw new Error('lod:auto log is missing one of read/expected/result/write lines.');
  }

  return {
    kind: 'auto',
    read: {
      count: Number(readMatch[1]),
      sh: Number(readMatch[2]),
    },
    expected: {
      count: Number(expectedMatch[1]),
      percent: expectedMatch[2].trim(),
      ratio: expectedMatch[3],
      counts: expectedMatch[4],
    },
    result: {
      count: Number(resultMatch[1]),
      percent: parsePercent(resultMatch[2], 'lod:auto result percent'),
    },
    write: {
      file: normalizePathToken(writeMatch[1]),
      count: Number(writeMatch[2]),
      sh: Number(writeMatch[3]),
    },
  };
}

function normalizeAutoChunkLog(log) {
  const readMatch = log.match(/counts:\s*(\d+),\s*SH:\s*(\d+)/);
  const totalMatch = log.match(/Total blocks:\s*(\d+),\s*files:\s*(\d+)/);
  const bundleMatches = [...log.matchAll(/writing bundle(?: done)? -> .* files=(\d+)/g)];
  const levelMatches = [...log.matchAll(/Level\s+(\d+)\s*\(([^)]*)\):\s*(\d+)\s*\(([^)]*)\)/g)];
  const writtenFileMatches = [...log.matchAll(/^\[Task:Write#[^\]]+\] - (.+) \((\d+)\/(\d+)\)$/gm)];

  if (!readMatch || !totalMatch || bundleMatches.length === 0 || levelMatches.length === 0 || writtenFileMatches.length === 0) {
    throw new Error('lod:auto-chunk log is missing one of read/total/level/bundle/write-file lines.');
  }

  return {
    kind: 'auto-chunk',
    read: {
      count: Number(readMatch[1]),
      sh: Number(readMatch[2]),
    },
    total: {
      blocks: Number(totalMatch[1]),
      chunkFiles: Number(totalMatch[2]),
    },
    levels: levelMatches.map((match) => ({
      level: Number(match[1]),
      target: match[2].trim(),
      count: Number(match[3]),
      actual: parsePercent(match[4], `lod:auto-chunk level ${match[1]} actual percent`),
    })),
    bundle: {
      files: Number(bundleMatches.at(-1)[1]),
    },
    writes: writtenFileMatches.map((match) => ({
      file: normalizePathToken(match[1].trim()),
      current: Number(match[2]),
      total: Number(match[3]),
    })),
  };
}

function normalizeLog(log, kind) {
  if (kind === 'auto') {
    return normalizeAutoLog(log);
  }

  if (kind === 'auto-chunk') {
    return normalizeAutoChunkLog(log);
  }

  throw new Error(`Unknown log kind: ${kind}`);
}

function roundedPercent(part, whole) {
  if (whole <= 0) {
    throw new Error(`Cannot calculate a percentage with denominator ${whole}.`);
  }

  return Number(((part / whole) * 100).toFixed(2));
}

function assertNormalizedLogConsistency(label, log) {
  if (log.kind === 'auto') {
    assertEqual(`${label} result/write count`, log.result.count, log.write.count);
    assertEqual(
      `${label} result percent`,
      log.result.percent,
      roundedPercent(log.result.count, log.expected.count),
    );
    return;
  }

  if (log.kind === 'auto-chunk') {
    for (const [index, level] of log.levels.entries()) {
      assertEqual(
        `${label} level ${index} actual percent`,
        level.actual,
        roundedPercent(level.count, log.read.count),
      );
    }
    return;
  }

  throw new Error(`Unknown normalized log kind: ${log.kind}`);
}

function assertNormalizedLogMatchesBaseline(label, current, baseline) {
  assertNormalizedLogConsistency(`${label} current`, current);
  assertNormalizedLogConsistency(`${label} baseline`, baseline);

  assertDeepEqual(label, current, baseline, '$', (leafLabel, actual, expected, jsonPath) => {
    const isAutoCount = current.kind === 'auto'
      && (jsonPath === '$.result.count' || jsonPath === '$.write.count');
    const isAutoPercent = current.kind === 'auto' && jsonPath === '$.result.percent';
    const isChunkCount = current.kind === 'auto-chunk'
      && /^\$\.levels\[\d+\]\.count$/.test(jsonPath);
    const isChunkPercent = current.kind === 'auto-chunk'
      && /^\$\.levels\[\d+\]\.actual$/.test(jsonPath);

    if (isAutoCount || isChunkCount) {
      assertWithinTolerance(`${leafLabel} quantity at ${jsonPath}`, actual, expected);
      return true;
    }

    if (isAutoPercent || isChunkPercent) {
      // The consistency checks above bind this rounded percentage to its count.
      // Comparing it independently would shrink the count tolerance at rounding boundaries.
      return true;
    }

    return false;
  });
}

function assertAutoChunkLogMatchesMeta(label, log, meta) {
  assertEqual(`${label} input count`, log.read.count, meta.counts);
  assertEqual(`${label} block count`, log.total.blocks, meta.tree.length);
  assertEqual(`${label} chunk file count`, log.total.chunkFiles, meta.files.length);
  assertEqual(`${label} level count`, log.levels.length, meta.levels);
  assertEqual(`${label} full-resolution count`, log.levels[0].count, meta.counts);

  for (const [levelIndex, level] of log.levels.entries()) {
    const metaCount = meta.tree.reduce(
      (sum, block) => sum + block.lods[levelIndex].count,
      0,
    );
    assertEqual(`${label} level ${levelIndex} count`, level.count, metaCount);
  }
}

function assertLogMatchesBaseline(label, logConfig) {
  const currentLogFile = path.join(OUT_DIR, logConfig.current);
  const baselineLogFile = path.join(BASELINE_DIR, logConfig.baseline);
  const current = normalizeLog(readText(currentLogFile), logConfig.kind);
  const baseline = normalizeLog(readText(baselineLogFile), logConfig.kind);

  assertNormalizedLogMatchesBaseline(`${label} normalized console log`, current, baseline);
  return current;
}

function assertOutput(test) {
  const target = path.join(OUT_DIR, test.output);

  if (!fs.existsSync(target)) {
    throw new Error(`${test.label} output is missing: ${target}`);
  }

  assertExpectedKind(test.label, target, test.kind);

  const files = listFiles(target);
  assertNonEmptyFiles(test.label, files);

  let expectedFileCount = test.expectedFileCount;
  let currentMeta = null;

  if (test.baselineMeta) {
    const currentMetaFile = path.join(target, 'lod-meta.json');
    const baselineMetaFile = path.join(BASELINE_DIR, test.baselineMeta);
    currentMeta = readJson(currentMetaFile);
    const baselineMeta = readJson(baselineMetaFile);

    validateLodMeta(test.label, target, currentMeta);
    assertLodMetaMatchesBaseline(`${test.label} lod-meta.json`, currentMeta, baselineMeta);

    expectedFileCount = baselineMeta.files.length + 1;
  }

  assertEqual(`${test.label} output file count`, files.length, expectedFileCount);

  if (test.log) {
    const currentLog = assertLogMatchesBaseline(test.label, test.log);

    if (currentMeta && currentLog.kind === 'auto-chunk') {
      assertAutoChunkLogMatchesMeta(`${test.label} log/lod-meta`, currentLog, currentMeta);
    }
  }

  console.log(`[assert] ${test.label}: ${files.length} output file(s)`);
}

function run() {
  for (const test of TESTS) {
    assertOutput(test);
  }
}

if (require.main === module) {
  run();
}

module.exports = {
  assertAutoChunkLogMatchesMeta,
  assertLodMetaMatchesBaseline,
  assertNormalizedLogMatchesBaseline,
  normalizeLog,
  validateLodMetaRanges,
};
