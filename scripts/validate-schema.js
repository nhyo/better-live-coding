'use strict';
// Compiles the JSON Schema with Ajv (strict mode) and validates every example
// presentation and the starter template against it.
const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv');

const root = path.resolve(__dirname, '..');
const schema = JSON.parse(fs.readFileSync(path.join(root, 'schemas', 'presentation.schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
ajv.addKeyword('enumDescriptions');
const validate = ajv.compile(schema);

const targets = fs
  .readdirSync(path.join(root, 'examples'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(root, 'examples', entry.name, '.better-live-coding', 'presentation.json'))
  .filter((file) => fs.existsSync(file));

let failures = 0;
const check = (label, data) => {
  if (validate(data)) {
    console.log(`✓ schema: ${label}`);
  } else {
    failures += 1;
    console.error(`✗ schema: ${label}`);
    for (const error of validate.errors) console.error(`    ${error.instancePath || '/'} ${error.message}`);
  }
};
for (const file of targets) check(path.relative(root, file).replace(/\\/g, '/'), JSON.parse(fs.readFileSync(file, 'utf8')));

const templatePath = path.join(root, 'out', 'src', 'presentation', 'template.js');
if (fs.existsSync(templatePath)) check('starter template', JSON.parse(JSON.stringify(require(templatePath).STARTER_PRESENTATION)));
else console.warn('! starter template not compiled; run npm run compile first');

if (targets.length === 0) {
  console.error('No example presentations found.');
  failures += 1;
}
process.exitCode = failures ? 1 : 0;
