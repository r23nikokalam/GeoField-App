const WORKSPACE_SCHEMA_VERSION = 1;
const MAX_PROJECTS = 1000;
const MAX_OBSERVATIONS = 10000;
const MAX_SAMPLES = 50000;

function cleanText(value, field, max = 200) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(field + " must be text.");
  }
  const result = String(value).trim();
  if (result.length > max) throw new Error(field + " is too long.");
  return result;
}

function createId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  throw new Error("Secure random ID generation is unavailable on this device.");
}

function uniqueIds(items, label) {
  const ids = new Set();
  for (const item of items) {
    if (!item.id || ids.has(item.id)) throw new Error(label + " contains a missing or duplicate ID.");
    ids.add(item.id);
  }
}

export function createProject(input = {}) {
  const now = new Date().toISOString();
  const id = cleanText(input.id, "Project ID", 128) || createId();
  const name = cleanText(input.name, "Project name", 120);
  if (!name) throw new Error("Project name is required.");
  return {
    id,
    name,
    code: cleanText(input.code, "Project code", 40),
    client: cleanText(input.client, "Client", 120),
    area: cleanText(input.area, "Project area", 160),
    description: cleanText(input.description, "Project description", 2000),
    createdAt: cleanText(input.createdAt, "Creation date", 40) || now,
    updatedAt: cleanText(input.updatedAt, "Update date", 40) || now
  };
}

export function createSample(input = {}) {
  const id = cleanText(input.id, "Sample ID", 128) || createId();
  const code = cleanText(input.code, "Sample code", 80);
  if (!code) throw new Error("Sample code is required.");
  return {
    id,
    projectId: cleanText(input.projectId, "Project ID", 128),
    observationId: cleanText(input.observationId, "Observation ID", 128),
    code,
    sampleType: cleanText(input.sampleType, "Sample type", 80),
    material: cleanText(input.material, "Sample material", 120),
    notes: cleanText(input.notes, "Sample notes", 2000),
    collectedAt: cleanText(input.collectedAt, "Collection date", 40)
  };
}

export function createWorkspace({ projects = [], observations = [], samples = [] } = {}) {
  const workspace = {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    projects: projects.map(project => createProject(project)),
    observations: observations.map(item => ({ ...item })),
    samples: samples.map(sample => createSample(sample))
  };
  return validateWorkspace(workspace);
}

export function migrateLegacyRecords(records, options = {}) {
  if (!Array.isArray(records)) throw new Error("Legacy observations must be an array.");
  if (records.length > MAX_OBSERVATIONS) throw new Error("The workspace exceeds the observation limit.");
  const project = createProject({
    id: options.projectId || "project-imported-legacy",
    name: options.projectName || "Imported observations",
    code: "LEGACY"
  });
  const observations = records.map((record, index) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error("Legacy observation " + (index + 1) + " is invalid.");
    }
    const id = cleanText(record.id, "Observation ID", 128) || "legacy-observation-" + index;
    return { ...record, id, projectId: project.id };
  });
  return validateWorkspace({
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    projects: [project],
    observations,
    samples: []
  });
}

export function validateWorkspace(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Workspace must be an object.");
  }
  if (value.schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
    throw new Error("Unsupported workspace schema version.");
  }
  const projects = value.projects;
  const observations = value.observations;
  const samples = value.samples;
  if (!Array.isArray(projects) || !Array.isArray(observations) || !Array.isArray(samples)) {
    throw new Error("Workspace collections are invalid.");
  }
  if (projects.length > MAX_PROJECTS || observations.length > MAX_OBSERVATIONS || samples.length > MAX_SAMPLES) {
    throw new Error("Workspace exceeds supported collection limits.");
  }
  uniqueIds(projects, "Projects");
  uniqueIds(observations, "Observations");
  uniqueIds(samples, "Samples");
  const projectIds = new Set(projects.map(item => item.id));
  const observationIds = new Set(observations.map(item => item.id));
  for (const observation of observations) {
    if (typeof observation.projectId !== "string" || !projectIds.has(observation.projectId)) {
      throw new Error("An observation references a project that does not exist.");
    }
  }
  for (const sample of samples) {
    if (typeof sample.projectId !== "string" || !projectIds.has(sample.projectId)) {
      throw new Error("A sample references a project that does not exist.");
    }
    if (sample.observationId && !observationIds.has(sample.observationId)) {
      throw new Error("A sample references an observation that does not exist.");
    }
  }
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    projects,
    observations,
    samples
  };
}

export { WORKSPACE_SCHEMA_VERSION };
