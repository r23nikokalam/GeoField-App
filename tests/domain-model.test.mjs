import test from "node:test";
import assert from "node:assert/strict";
import {
  createProject,
  createSample,
  migrateLegacyRecords,
  validateWorkspace,
  WORKSPACE_SCHEMA_VERSION
} from "../www/domain-model.js";

test("migrates legacy observations without losing their original fields", () => {
  const legacy = [
    { id: "old-1", WPT_NO: "17", Lithology: "Andesite", X_UTM: "412300" },
    { id: "old-2", WPT_NO: "18", Lithology: "Limestone", Describe: "Bedded" }
  ];
  const workspace = migrateLegacyRecords(legacy);
  assert.equal(workspace.schemaVersion, WORKSPACE_SCHEMA_VERSION);
  assert.equal(workspace.projects.length, 1);
  assert.equal(workspace.observations.length, 2);
  assert.equal(workspace.observations[0].Lithology, "Andesite");
  assert.equal(workspace.observations[0].X_UTM, "412300");
  assert.equal(workspace.observations[0].projectId, workspace.projects[0].id);
  assert.deepEqual(workspace.samples, []);
});

test("rejects duplicate IDs and broken project references", () => {
  const project = createProject({ id: "p1", name: "North Ridge" });
  assert.throws(() => validateWorkspace({
    schemaVersion: 1,
    projects: [project, project],
    observations: [],
    samples: []
  }), /duplicate ID/i);
  assert.throws(() => validateWorkspace({
    schemaVersion: 1,
    projects: [project],
    observations: [{ id: "o1", projectId: "missing" }],
    samples: []
  }), /project that does not exist/i);
});

test("validates sample-to-observation relationships", () => {
  const project = createProject({ id: "p1", name: "North Ridge" });
  const sample = createSample({
    id: "s1", projectId: "p1", observationId: "missing", code: "S-001"
  });
  assert.throws(() => validateWorkspace({
    schemaVersion: 1, projects: [project], observations: [], samples: [sample]
  }), /observation that does not exist/i);
});

test("requires project and sample codes to be valid", () => {
  assert.throws(() => createProject({ name: " " }), /required/i);
  assert.throws(() => createSample({ code: " " }), /required/i);
});

test("rejects unknown workspace schema versions", () => {
  assert.throws(() => validateWorkspace({
    schemaVersion: 99, projects: [], observations: [], samples: []
  }), /unsupported workspace schema/i);
});
