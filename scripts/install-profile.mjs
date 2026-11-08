#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import {
  DEFAULT_PROFILE,
  SKILLS_CLI,
  loadProfile,
  mergeSkillsField,
} from '../lib/skill-profile.mjs';

function usage() {
  console.log(`Usage: install-skills-profile [options] [-- <skills experimental_sync options>]

Install the checked engineering skill profile into the current repository.

Options:
  --profile <path>  Use another profile file instead of profiles/factory.json
  --dry-run         Show the package.json change without writing or installing
  -h, --help        Show this help

The command records the profile in package.json "skills", then runs:
  npx -y ${SKILLS_CLI} experimental_sync -y --no-frozen-lockfile [options]

Unrelated "skills" entries in the target package.json are preserved.`);
}

async function readPackageJson(packagePath) {
  if (!existsSync(packagePath)) {
    return { name: basename(process.cwd()), private: true };
  }
  const raw = await readFile(packagePath, 'utf8');
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`cannot parse ${packagePath}: ${error.message}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${packagePath}: expected a JSON object`);
  }
  return value;
}

async function main(argv) {
  let profilePath = DEFAULT_PROFILE;
  let dryRun = false;
  const syncArgs = [];

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '-h' || arg === '--help') {
      usage();
      return;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--profile') {
      index++;
      if (!argv[index]) throw new Error('--profile requires a path');
      profilePath = resolve(argv[index]);
      continue;
    }
    syncArgs.push(arg);
  }

  const { profile, entries } = await loadProfile(profilePath);
  const packagePath = resolve(process.cwd(), 'package.json');
  const packageJson = await readPackageJson(packagePath);
  const skills = mergeSkillsField(packageJson.skills, entries);
  packageJson.skills = skills;
  const rendered = `${JSON.stringify(packageJson, null, 2)}\n`;

  if (dryRun) {
    console.log(`Would update ${packagePath}`);
    console.log(JSON.stringify({ skills }, null, 2));
    return;
  }

  await writeFile(packagePath, rendered);
  console.log(
    `Recorded ${profile.name ?? 'skill'} profile (${entries.length} source(s)) in ${packagePath}`
  );

  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(
    npx,
    [
      '-y',
      SKILLS_CLI,
      'experimental_sync',
      '-y',
      '--no-frozen-lockfile',
      ...syncArgs,
    ],
    { cwd: process.cwd(), stdio: 'inherit', env: process.env }
  );

  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

main(process.argv.slice(2)).catch((error) => {
  console.error(`install-skills-profile: ${error.message}`);
  process.exitCode = 1;
});
