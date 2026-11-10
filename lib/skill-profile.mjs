import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_PROFILE = resolve(REPO_ROOT, 'profiles/factory.json');
export const SKILLS_CLI = 'skills@1.7.6';

const COMMIT_SHA = /^[0-9a-f]{40}$/i;
const OWNER_REPO = /^[^/\s]+\/[^/\s]+$/;

export const DEFAULT_JSON_FORMAT = {
  indent: '  ',
  trailingNewline: true,
  eol: '\n',
};

/** Preserve the indentation, line endings and final newline of an existing JSON file. */
export function detectJsonFormat(raw) {
  const propertyMatch = raw.match(/\r?\n([ \t]+)"/);
  const emptyObject = /^\s*\{\s*\}\s*$/.test(raw) && !/\r(?!\n)/.test(raw);
  let indent;
  if (propertyMatch) {
    indent = propertyMatch[1];
  } else if (emptyObject) {
    indent = '  ';
  } else if (raw.includes('\n')) {
    indent = '';
  } else {
    indent = null;
  }

  return {
    indent,
    trailingNewline: /\r?\n$/.test(raw),
    eol: raw.includes('\r\n') ? '\r\n' : '\n',
  };
}

/** Serialize JSON using a format returned by `detectJsonFormat`. */
export function formatJson(value, format = DEFAULT_JSON_FORMAT) {
  let rendered = JSON.stringify(value, null, format.indent ?? null);
  if (format.eol === '\r\n') rendered = rendered.replace(/\n/g, '\r\n');
  return format.trailingNewline ? rendered + format.eol : rendered;
}

/**
 * Turn the checked profile into the remote entries understood by the `skills`
 * CLI's package.json `skills` field.
 */
export function profileEntries(profile, profilePath = 'profile') {
  if (!profile || typeof profile !== 'object' || !Array.isArray(profile.sources)) {
    throw new Error(`${profilePath}: expected a "sources" array`);
  }
  if (profile.sources.length === 0) {
    throw new Error(`${profilePath}: "sources" must not be empty`);
  }

  const seenSources = new Set();
  const skillProviders = new Map();

  return profile.sources.map((entry, index) => {
    const where = `${profilePath}: sources[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${where}: expected an object`);
    }
    if (typeof entry.source !== 'string' || !OWNER_REPO.test(entry.source)) {
      throw new Error(`${where}: "source" must be an owner/repo string`);
    }
    if (typeof entry.ref !== 'string' || !COMMIT_SHA.test(entry.ref)) {
      throw new Error(`${where}: "ref" must be a full 40-character commit SHA`);
    }
    if (
      !Array.isArray(entry.skills) ||
      entry.skills.length === 0 ||
      entry.skills.some((name) => typeof name !== 'string' || name.trim() === '')
    ) {
      throw new Error(`${where}: "skills" must be a non-empty array of skill names`);
    }
    if (seenSources.has(entry.source)) {
      throw new Error(`${where}: duplicate source "${entry.source}"`);
    }
    seenSources.add(entry.source);

    for (const name of entry.skills) {
      const provider = skillProviders.get(name);
      if (provider === entry.source) {
        throw new Error(`${where}: duplicate skill "${name}"`);
      }
      if (provider !== undefined) {
        throw new Error(
          `${where}: skill "${name}" is already provided by "${provider}"`
        );
      }
      skillProviders.set(name, entry.source);
    }

    return {
      source: entry.source,
      ref: entry.ref,
      skills: [...entry.skills],
    };
  });
}

/** Read and validate a profile file from disk. */
export async function loadProfile(profilePath = DEFAULT_PROFILE) {
  let raw;
  try {
    raw = await readFile(profilePath, 'utf8');
  } catch (error) {
    throw new Error(`cannot read profile ${profilePath}: ${error.message}`);
  }

  let profile;
  try {
    profile = JSON.parse(raw);
  } catch (error) {
    throw new Error(`cannot parse profile ${profilePath}: ${error.message}`);
  }

  return { profile, entries: profileEntries(profile, profilePath) };
}

/**
 * Merge profile entries into an existing package.json `skills` array. Entries
 * for the profile's sources are replaced so changing the pin takes effect;
 * unrelated entries (for example another upstream skill source) are preserved.
 */
export function mergeSkillsField(existing, entries) {
  if (existing === undefined) existing = [];
  if (!Array.isArray(existing)) {
    throw new Error('package.json "skills" must be an array');
  }

  const profileSources = new Set(entries.map((entry) => entry.source));
  const belongsToProfile = (item) => {
    if (typeof item === 'string') {
      return profileSources.has(item) || profileSources.has(item.split('@')[0]);
    }
    if (item && typeof item === 'object' && typeof item.source === 'string') {
      return profileSources.has(item.source) || profileSources.has(item.source.split('@')[0]);
    }
    return false;
  };

  return [
    ...existing.filter((item) => !belongsToProfile(item)),
    ...entries.map((entry) => ({ ...entry, skills: [...entry.skills] })),
  ];
}
