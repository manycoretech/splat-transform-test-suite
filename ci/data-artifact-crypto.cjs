const crypto = require('crypto');
const fs = require('fs');

const MAGIC = Buffer.from('STDATA1');
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;

const [mode, inputPath, outputPath] = process.argv.slice(2);
const password = process.env.DATA_ARTIFACT_PASSWORD;

if (!['encrypt', 'decrypt'].includes(mode) || !inputPath || !outputPath) {
  throw new Error('Usage: node ci/data-artifact-crypto.cjs <encrypt|decrypt> <input> <output>');
}

if (!password) {
  throw new Error('DATA_ARTIFACT_PASSWORD is required.');
}

function keyFrom(password, salt) {
  return crypto.scryptSync(password, salt, 32);
}

if (mode === 'encrypt') {
  const input = fs.readFileSync(inputPath);
  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(password, salt), iv);
  const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
  const tag = cipher.getAuthTag();

  fs.writeFileSync(outputPath, Buffer.concat([MAGIC, salt, iv, tag, encrypted]));
} else {
  const input = fs.readFileSync(inputPath);
  const headerBytes = MAGIC.length + SALT_BYTES + IV_BYTES + TAG_BYTES;

  if (input.length <= headerBytes || !input.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Invalid encrypted data artifact.');
  }

  let offset = MAGIC.length;
  const salt = input.subarray(offset, offset + SALT_BYTES);
  offset += SALT_BYTES;
  const iv = input.subarray(offset, offset + IV_BYTES);
  offset += IV_BYTES;
  const tag = input.subarray(offset, offset + TAG_BYTES);
  offset += TAG_BYTES;
  const encrypted = input.subarray(offset);

  const decipher = crypto.createDecipheriv('aes-256-gcm', keyFrom(password, salt), iv);
  decipher.setAuthTag(tag);
  fs.writeFileSync(outputPath, Buffer.concat([decipher.update(encrypted), decipher.final()]));
}
