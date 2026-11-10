import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectJsonFormat,
  formatJson,
  loadProfile,
  mergeSkillsField,
  profileEntries,
} from '../lib/skill-profile.mjs';

const EXPECTED_SKILLS = [
  'grilling',
  'grill-with-docs',
  'domain-modeling',
  'to-spec',
  'to-tickets',
  'implement',
  'implement-spec',
  'tdd',
  'code-review',
  'pr',
  'triage',
  'diagnosing-bugs',
  'retro',
];

const EXPECTED_CLOUDFLARE_SKILLS = [
  'cloudflare',
  'cf-cli',
  'wrangler',
  'workers-best-practices',
  'workers-development',
  'cloudflare-email-service',
  'durable-objects',
  'cloudflare-one',
];

const CLOUDFLARE_REF = '6eb6c781aa9b6438e0c7307bd102788a75fe1a6d';

test('factory profile pins the curated upstream skills to a commit', async () => {
  const { profile, entries } = await loadProfile();

  assert.equal(profile.name, 'factory');
  assert.equal(entries.length, 2);
  assert.equal(entries[0].source, 'mattpocock/skills');
  assert.match(entries[0].ref, /^[0-9a-f]{40}$/);
  assert.deepEqual(entries[0].skills, EXPECTED_SKILLS);
});

test('factory profile pins the curated Cloudflare skills to a commit', async () => {
  const { entries } = await loadProfile();
  const cloudflare = entries.find((entry) => entry.source === 'cloudflare/skills');

  assert.ok(cloudflare, 'factory profile has a cloudflare/skills source');
  assert.equal(cloudflare.ref, CLOUDFLARE_REF);
  assert.deepEqual(cloudflare.skills, EXPECTED_CLOUDFLARE_SKILLS);
});

test('factory profile installs every skill name once across sources', async () => {
  const { entries } = await loadProfile();
  const names = entries.flatMap((entry) => entry.skills);

  assert.equal(new Set(names).size, names.length);
});

test('merge replaces every profile source and preserves unrelated ones', () => {
  const existing = [
    'npm:some-package',
    { source: 'mattpocock/skills', ref: 'old-ref', skills: ['all'] },
    { source: 'cloudflare/skills', ref: 'old-cloudflare-ref', skills: ['all'] },
    { source: 'other/skills', ref: 'other-ref', skills: ['workers'] },
  ];
  const entries = profileEntries({
    sources: [
      {
        source: 'mattpocock/skills',
        ref: 'a'.repeat(40),
        skills: ['implement', 'tdd'],
      },
      {
        source: 'cloudflare/skills',
        ref: 'b'.repeat(40),
        skills: ['wrangler'],
      },
    ],
  });

  assert.deepEqual(mergeSkillsField(existing, entries), [
    'npm:some-package',
    { source: 'other/skills', ref: 'other-ref', skills: ['workers'] },
    { source: 'mattpocock/skills', ref: 'a'.repeat(40), skills: ['implement', 'tdd'] },
    { source: 'cloudflare/skills', ref: 'b'.repeat(40), skills: ['wrangler'] },
  ]);
});

test('merge rejects a non-array package.json skills field', () => {
  assert.throws(
    () => mergeSkillsField({ source: 'mattpocock/skills' }, []),
    /"skills" must be an array/
  );
});

test('preserves tab indentation and a missing trailing newline', () => {
  const raw = '{\n\t"name": "tabbed",\n\t"private": true\n}';
  const format = detectJsonFormat(raw);

  assert.deepEqual(format, { indent: '\t', trailingNewline: false, eol: '\n' });
  assert.equal(
    formatJson({ name: 'tabbed', private: true, skills: [] }, format),
    '{\n\t"name": "tabbed",\n\t"private": true,\n\t"skills": []\n}'
  );
});

test('preserves space indentation and a trailing newline', () => {
  const raw = '{\n    "name": "spaced"\n}\n';
  const format = detectJsonFormat(raw);

  assert.deepEqual(format, { indent: '    ', trailingNewline: true, eol: '\n' });
  assert.equal(
    formatJson({ name: 'spaced', skills: [] }, format),
    '{\n    "name": "spaced",\n    "skills": []\n}\n'
  );
});

test('falls back to two spaces for an empty object', () => {
  for (const raw of ['{}', '{\n}']) {
    const format = detectJsonFormat(raw);
    assert.equal(format.indent, '  ');
    assert.equal(
      formatJson({ name: 'empty', skills: [] }, format),
      '{\n  "name": "empty",\n  "skills": []\n}'
    );
  }
});

test('leaves CR-only JSON on its existing compact path', () => {
  assert.deepEqual(detectJsonFormat('{\r}'), {
    indent: null,
    trailingNewline: false,
    eol: '\n',
  });
});

test('profile validation rejects a duplicate source', () => {
  assert.throws(
    () =>
      profileEntries({
        sources: [
          { source: 'mattpocock/skills', ref: 'a'.repeat(40), skills: ['implement'] },
          { source: 'mattpocock/skills', ref: 'b'.repeat(40), skills: ['tdd'] },
        ],
      }),
    /duplicate source "mattpocock\/skills"/
  );
});

test('profile validation rejects a skill name duplicated across sources', () => {
  assert.throws(
    () =>
      profileEntries({
        sources: [
          { source: 'mattpocock/skills', ref: 'a'.repeat(40), skills: ['implement'] },
          { source: 'cloudflare/skills', ref: 'b'.repeat(40), skills: ['implement'] },
        ],
      }),
    /skill "implement" is already provided by "mattpocock\/skills"/
  );
});

test('profile validation rejects a skill name duplicated within one source', () => {
  assert.throws(
    () =>
      profileEntries({
        sources: [
          {
            source: 'mattpocock/skills',
            ref: 'a'.repeat(40),
            skills: ['implement', 'implement'],
          },
        ],
      }),
    /duplicate skill "implement"/
  );
});

test('profile validation rejects mutable or partial pins', () => {
  assert.throws(
    () =>
      profileEntries({
        sources: [
          { source: 'mattpocock/skills', ref: 'main', skills: ['implement'] },
        ],
      }),
    /full 40-character commit SHA/
  );
  assert.throws(
    () =>
      profileEntries({
        sources: [
          { source: 'mattpocock/skills', ref: 'a'.repeat(40), skills: [] },
        ],
      }),
    /non-empty array/
  );
});
