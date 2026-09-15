#!/usr/bin/env node
/**
 * Sync NEWCARLA/stories YAML → webtest/src/data JSON for the City Lab app.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const STORIES = path.join(ROOT, "stories");
const OUT = path.resolve(__dirname, "../src/data");
const PEOPLE_OUT = path.join(OUT, "people");

function readYaml(file) {
  return yaml.load(fs.readFileSync(file, "utf8"));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

ensureDir(PEOPLE_OUT);

const catalog = readYaml(path.join(STORIES, "catalog.yaml"));
writeJson(path.join(OUT, "catalog.json"), catalog);

const peopleIndex = [];

for (const entry of catalog.people || []) {
  const id = entry.id;
  const dir = path.join(STORIES, "people", id);
  const pack = {
    id,
    catalog: entry,
    person: null,
    story: null,
    journey: null,
  };

  const personFile = path.join(dir, "person.yaml");
  const storyFile = path.join(dir, "story.yaml");
  const journeyFile = path.join(dir, "journey.yaml");

  if (fs.existsSync(personFile)) pack.person = readYaml(personFile);
  if (fs.existsSync(storyFile)) pack.story = readYaml(storyFile);
  if (fs.existsSync(journeyFile)) pack.journey = readYaml(journeyFile);

  writeJson(path.join(PEOPLE_OUT, `${id}.json`), pack);
  peopleIndex.push({
    id,
    name: entry.name,
    comfort_score: entry.comfort_score,
    comfort_level: entry.comfort_level,
    tags: entry.tags || [],
    status: entry.status,
    has_journey: Boolean(pack.journey),
  });
}

writeJson(path.join(OUT, "people-index.json"), peopleIndex);

const arcs = [];
for (const arc of catalog.arcs || []) {
  const mdPath = path.join(STORIES, arc.path || "");
  arcs.push({
    ...arc,
    markdown: fs.existsSync(mdPath) ? fs.readFileSync(mdPath, "utf8") : "",
  });
}
writeJson(path.join(OUT, "arcs.json"), arcs);

console.log(`Synced ${peopleIndex.length} people → ${path.relative(ROOT, OUT)}`);
