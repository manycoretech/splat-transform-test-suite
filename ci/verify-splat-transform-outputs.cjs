const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = resolveWorkspacePath(process.env.SPLAT_TEST_OUT_DIR || 'out');
const BASELINE_DIR = resolveWorkspacePath(process.env.SPLAT_TEST_BASELINE_DIR || path.join('ci', 'baselines'));

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

function assertDeepEqual(label, actual, expected, jsonPath = '$') {
  if (Object.is(actual, expected)) {
    return;
  }

  if (typeof actual !== typeof expected) {
    throw new Error(`${label} mismatch at ${jsonPath}: expected type ${typeof expected}, got ${typeof actual}`);
  }

  if (actual === null || expected === null || typeof actual !== 'object') {
    throw new Error(`${label} mismatch at ${jsonPath}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }

  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected)) {
      throw new Error(`${label} mismatch at ${jsonPath}: expected array shape changed.`);
    }

    assertEqual(`${label} array length at ${jsonPath}`, actual.length, expected.length);

    for (let index = 0; index < expected.length; index += 1) {
      assertDeepEqual(label, actual[index], expected[index], `${jsonPath}[${index}]`);
    }

    return;
  }

  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  assertArrayEqual(`${label} object keys at ${jsonPath}`, actualKeys, expectedKeys);

  for (const key of expectedKeys) {
    assertDeepEqual(label, actual[key], expected[key], `${jsonPath}.${key}`);
  }
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

      if (!Number.isInteger(lod.count) || lod.count <= 0) {
        throw new Error(`${label} meta tree[${blockIndex}].lods[${levelIndex}] has invalid count: ${lod.count}`);
      }
    }
  }
}

function normalizePathToken(value) {
  const normalized = value.replace(/\\/g, '/').replace(/^"|"$/g, '');
  return normalized.split('/').at(-1);
}

function normalizeAutoLog(log) {
  const readMatch = log.match(/counts:\s*(\d+),\s*SH:\s*(\d+)/);
  const expectedMatch = log.match(/expected ->\s*(\d+)\(([^)]+)\)\s*\|\s*ratio=([^\s]+)\s+counts=([^\s]+)/);
  const resultMatch = log.match(/result ->\s*(\d+)\(([^)]+)\)/);
  const writeMatch = log.match(/writing splat -> file=("[^"]+"|\S+)\s+count=(\d+)\s+SH=(\d+)/);

  if (!readMatch || !expectedMatch || !resultMatch || !writeMatch) {
    throw new Error('lod:auto log is missing one of read/expected/result/write lines.');
  }

  return [
    `read counts=${readMatch[1]} sh=${readMatch[2]}`,
    `expected count=${expectedMatch[1]} percent=${expectedMatch[2]} ratio=${expectedMatch[3]} counts=${expectedMatch[4]}`,
    `result count=${resultMatch[1]} percent=${resultMatch[2]}`,
    `write file=${normalizePathToken(writeMatch[1])} count=${writeMatch[2]} sh=${writeMatch[3]}`,
  ];
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

  const normalized = [
    `read counts=${readMatch[1]} sh=${readMatch[2]}`,
    `total blocks=${totalMatch[1]} chunkFiles=${totalMatch[2]}`,
  ];

  for (const match of levelMatches) {
    normalized.push(`level ${match[1]} target=${match[2].trim()} count=${match[3]} actual=${match[4].trim()}`);
  }

  normalized.push(`bundle files=${bundleMatches.at(-1)[1]}`);

  for (const match of writtenFileMatches) {
    normalized.push(`write ${match[2]}/${match[3]} ${normalizePathToken(match[1].trim())}`);
  }

  return normalized;
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

function assertLogMatchesBaseline(label, logConfig) {
  const currentLogFile = path.join(OUT_DIR, logConfig.current);
  const baselineLogFile = path.join(BASELINE_DIR, logConfig.baseline);
  const current = normalizeLog(readText(currentLogFile), logConfig.kind);
  const baseline = normalizeLog(readText(baselineLogFile), logConfig.kind);

  assertArrayEqual(`${label} normalized console log`, current, baseline);
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

  if (test.baselineMeta) {
    const currentMetaFile = path.join(target, 'lod-meta.json');
    const baselineMetaFile = path.join(BASELINE_DIR, test.baselineMeta);
    const currentMeta = readJson(currentMetaFile);
    const baselineMeta = readJson(baselineMetaFile);

    validateLodMeta(test.label, target, currentMeta);
    assertDeepEqual(`${test.label} lod-meta.json`, currentMeta, baselineMeta);

    expectedFileCount = baselineMeta.files.length + 1;
  }

  assertEqual(`${test.label} output file count`, files.length, expectedFileCount);

  if (test.log) {
    assertLogMatchesBaseline(test.label, test.log);
  }

  console.log(`[assert] ${test.label}: ${files.length} output file(s)`);
}

for (const test of TESTS) {
  assertOutput(test);
}
