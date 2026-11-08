import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { SKILLS_CLI, loadProfile } from '../lib/skill-profile.mjs';

const INSTALLER = fileURLToPath(new URL('../scripts/install-profile.mjs', import.meta.url));

const NPX_STUB = `const { mkdir, readFile, writeFile } = require('node:fs/promises');
const { join } = require('node:path');

(async () => {
  const expected = process.env.EXPECTED_ARGS;
  const actual = process.argv.slice(2);
  if (expected && JSON.stringify(actual) !== expected) {
    console.error('unexpected npx arguments: ' + JSON.stringify(actual));
    process.exit(2);
  }

  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const lock = { version: 1, skills: {} };
  for (const entry of pkg.skills || []) {
    if (typeof entry === 'string') continue;
    for (const name of entry.skills || []) {
      const dir = join('.agents', 'skills', name);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'SKILL.md'), '---\\nname: ' + name + '\\ndescription: stub\\n---\\n');
      lock.skills[name] = {
        source: entry.source,
        ref: entry.ref,
        sourceType: 'github',
        skillPath: 'skills/' + name + '/SKILL.md',
        computedHash: 'stub-' + name,
        via: '.',
      };
    }
  }
  await writeFile('skills-lock.json', JSON.stringify(lock, null, 2) + '\\n');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;

async function runInstaller(packageJson) {
  const scratch = await mkdtemp(join(tmpdir(), 'skill-profile-install-'));
  try {
    const target = join(scratch, 'target');
    const bin = join(scratch, 'bin');
    await mkdir(target);
    await mkdir(bin);

    const packagePath = join(target, 'package.json');
    await writeFile(packagePath, packageJson);
    await writeFile(join(bin, 'npx-stub.cjs'), NPX_STUB);

    if (process.platform === 'win32') {
      await writeFile(
        join(bin, 'npx.cmd'),
        `@echo off\r\n"${process.execPath}" "%~dp0npx-stub.cjs" %*\r\n`
      );
    } else {
      await writeFile(join(bin, 'npx'), `#!/usr/bin/env node\n${NPX_STUB}`);
      await chmod(join(bin, 'npx'), 0o755);
    }

    const expectedArgs = [
      '-y',
      SKILLS_CLI,
      'experimental_sync',
      '-y',
      '--no-frozen-lockfile',
    ];
    const result = spawnSync(process.execPath, [INSTALLER], {
      cwd: target,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
        EXPECTED_ARGS: JSON.stringify(expectedArgs),
      },
    });
    const packageRaw = await readFile(packagePath, 'utf8');
    const lock =
      result.status === 0
        ? JSON.parse(await readFile(join(target, 'skills-lock.json'), 'utf8'))
        : null;

    return { result, packageRaw, lock };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

test('installer merges the profile and writes pinned lock refs through sync', async () => {
  const { result, packageRaw, lock } = await runInstaller(
    '{\n\t"name": "scratch",\n\t"private": true\n}'
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  assert.match(packageRaw, /^\{\n\t"name": "scratch",\n\t"private": true,\n\t"skills": \[\n\t\t\{/);
  assert.equal(packageRaw.endsWith('\n'), false);

  const { entries } = await loadProfile();
  const expectedNames = entries.flatMap((entry) => entry.skills).sort();
  assert.deepEqual(Object.keys(lock.skills).sort(), expectedNames);

  for (const entry of entries) {
    for (const name of entry.skills) {
      assert.equal(lock.skills[name].source, entry.source);
      assert.equal(lock.skills[name].ref, entry.ref);
    }
  }
});

test('installer accepts a target package.json with a UTF-8 BOM', async () => {
  const { result, packageRaw, lock } = await runInstaller(
    '\uFEFF{\n\t"name": "bom",\n\t"private": true\n}'
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(packageRaw.charCodeAt(0), 0x7b);
  assert.match(packageRaw, /^\{\n\t"name": "bom",\n\t"private": true,\n\t"skills": /);
  assert.equal(lock.skills.implement.ref, (await loadProfile()).entries[0].ref);
});
