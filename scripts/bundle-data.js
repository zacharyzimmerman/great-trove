#!/usr/bin/env node

/**
 * bundle-data.js
 *
 * Reads the barbershop-database SQLite DB and produces web/trove-bundle.json
 * for the great-trove PWA. All contest data is denormalized into a single
 * JSON file so the PWA can work fully offline.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_PATH = resolve(ROOT, '..', 'barbershop-database', 'data', 'barbershop.db');
const OUT_PATH = resolve(ROOT, 'web', 'trove-bundle.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readVersion() {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
  return pkg.version;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('bundle-data: opening', DB_PATH);
const db = new Database(DB_PATH, { readonly: true });

// -- Fetch all rows in bulk (avoid N+1) ------------------------------------

const contests = db.prepare(`
  SELECT c.id, c.year, c.season, c.district, c.category, c.round,
         c.location, c.date, c.note, s.source_url
  FROM contests c
  LEFT JOIN sources s ON c.source_id = s.id
  ORDER BY c.year DESC, c.season, c.category, c.round
`).all();

const allScores = db.prepare(`
  SELECT id, contest_id, group_id, placement, total_score, percentage,
         num_on_stage, cumulative_score, note
  FROM scores
  ORDER BY contest_id, placement
`).all();

const allScoreCategories = db.prepare(`
  SELECT score_id, category, value FROM score_categories
`).all();

const allSongs = db.prepare(`
  SELECT id, score_id, song_name, song_order, arranger FROM songs
`).all();

const allSongCategories = db.prepare(`
  SELECT song_id, category, value FROM song_categories
`).all();

const allJudges = db.prepare(`
  SELECT contest_id, role, judge_number, name, district FROM judges
  ORDER BY contest_id, role, judge_number
`).all();

const allAnnotations = db.prepare(`
  SELECT source_id, contest_id, type, marker, text, applies_to FROM annotations
`).all();

const allAppearances = db.prepare(`
  SELECT contest_id, group_id, appearance_order, session, scheduled_time
  FROM appearances
  ORDER BY contest_id, appearance_order
`).all();

const allGroups = db.prepare(`
  SELECT id, name, city, state, type FROM groups
`).all();

db.close();

// -- Index bulk data by parent key -----------------------------------------

/** Group an array of rows by a key column, returning a Map<key, row[]>. */
function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const k = row[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
}

const scoresByContest = groupBy(allScores, 'contest_id');
const scoreCatsByScore = groupBy(allScoreCategories, 'score_id');
const songsByScore = groupBy(allSongs, 'score_id');
const songCatsBySong = groupBy(allSongCategories, 'song_id');
const judgesByContest = groupBy(allJudges, 'contest_id');
const annotationsByContest = groupBy(allAnnotations, 'contest_id');
const appearancesByContest = groupBy(allAppearances, 'contest_id');

// -- Build categories object from rows ------------------------------------

function buildCategories(rows) {
  if (!rows || rows.length === 0) return {};
  const obj = {};
  for (const r of rows) obj[r.category] = r.value;
  return obj;
}

// -- Track referenced group IDs -------------------------------------------

const referencedGroupIds = new Set();

// -- Assemble contests ----------------------------------------------------

let totalScores = 0;
let totalJudges = 0;
let totalAnnotations = 0;

const bundledContests = contests.map((c) => {
  // Scores
  const scores = (scoresByContest.get(c.id) || []).map((s) => {
    referencedGroupIds.add(s.group_id);
    totalScores++;

    const songs = (songsByScore.get(s.id) || []).map((song) => ({
      name: song.song_name,
      order: song.song_order,
      arranger: song.arranger,
      categories: buildCategories(songCatsBySong.get(song.id)),
    }));

    return {
      groupId: s.group_id,
      placement: s.placement,
      total: s.total_score,
      percentage: s.percentage,
      numOnStage: s.num_on_stage,
      cumulativeScore: s.cumulative_score,
      note: s.note,
      categories: buildCategories(scoreCatsByScore.get(s.id)),
      songs,
    };
  });

  // Judges
  const judges = (judgesByContest.get(c.id) || []).map((j) => {
    totalJudges++;
    return {
      role: j.role,
      number: j.judge_number,
      name: j.name,
      district: j.district,
    };
  });

  // Annotations
  const annotations = (annotationsByContest.get(c.id) || []).map((a) => {
    totalAnnotations++;
    return {
      type: a.type,
      marker: a.marker,
      text: a.text,
      appliesTo: a.applies_to,
    };
  });

  // Appearances
  const appearances = (appearancesByContest.get(c.id) || []).map((a) => {
    referencedGroupIds.add(a.group_id);
    return {
      groupId: a.group_id,
      order: a.appearance_order,
      session: a.session,
      time: a.scheduled_time,
    };
  });

  return {
    id: c.id,
    year: c.year,
    season: c.season,
    district: c.district,
    category: c.category,
    round: c.round,
    location: c.location,
    date: c.date,
    sourceUrl: c.source_url,
    note: c.note,
    scores,
    judges,
    annotations,
    appearances,
  };
});

// -- Build groups lookup (only referenced groups) --------------------------

const groups = {};
for (const g of allGroups) {
  if (referencedGroupIds.has(g.id)) {
    groups[g.id] = {
      name: g.name,
      city: g.city,
      state: g.state,
      type: g.type,
    };
  }
}

// -- Write bundle ----------------------------------------------------------

const bundle = {
  version: readVersion(),
  generated: new Date().toISOString(),
  contests: bundledContests,
  groups,
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
const json = JSON.stringify(bundle);
writeFileSync(OUT_PATH, json, 'utf-8');

// -- Stats -----------------------------------------------------------------

const groupCount = Object.keys(groups).length;
const sizeBytes = Buffer.byteLength(json, 'utf-8');

console.log();
console.log('--- Bundle Stats ---');
console.log(`  Contests:    ${contests.length}`);
console.log(`  Scores:      ${totalScores}`);
console.log(`  Groups:      ${groupCount}`);
console.log(`  Judges:      ${totalJudges}`);
console.log(`  Annotations: ${totalAnnotations}`);
console.log(`  File size:   ${formatBytes(sizeBytes)}`);
console.log();
console.log(`Wrote ${OUT_PATH}`);
