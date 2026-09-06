import { DEFAULT_GLOBAL_SETTINGS, normalizeGlobalSettings, type GlobalAppSettings } from "./appSettings.ts";

export type LucasCadProjectFile = {
  metadata?: { settings: GlobalAppSettings };
  schemaVersion: number;
  units: "mm";
  sketches: unknown[];
  features: unknown[];
  referenceGeometry: unknown[];
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function requireRecords(value: unknown, label: string, requiredKeys: string[]) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  value.forEach((item, index) => {
    if (!isRecord(item)) throw new Error(`${label} item ${index + 1} is not an object.`);
    for (const key of requiredKeys) if (!(key in item)) throw new Error(`${label} item ${index + 1} is missing ${key}.`);
  });
  return value;
}

export function parseLucasCadProject(serialized: string): LucasCadProjectFile {
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); }
  catch { throw new Error("The selected file is not valid JSON."); }
  if (!isRecord(parsed)) throw new Error("The selected file is not a LucasCad project.");
  const schemaVersion = parsed.schemaVersion === undefined ? 1 : Number(parsed.schemaVersion);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > 2) throw new Error(`LucasCad schema version ${String(parsed.schemaVersion)} is not supported.`);
  if (parsed.units !== undefined && parsed.units !== "mm") throw new Error("Only millimeter-based LucasCad project files are currently supported.");
  const sketches = requireRecords(parsed.sketches, "Sketches", ["id", "plane", "entities"]);
  sketches.forEach((sketch, index) => { if (!Array.isArray((sketch as Record<string, unknown>).entities)) throw new Error(`Sketches item ${index + 1} has invalid entities.`); });
  const features = requireRecords(parsed.features, "Features", ["id", "type"]);
  const referenceGeometry = parsed.referenceGeometry === undefined ? [] : requireRecords(parsed.referenceGeometry, "Reference geometry", ["id", "type"]);
  return { schemaVersion, units: "mm", sketches, features, referenceGeometry, ...(isRecord(parsed.metadata) && isRecord(parsed.metadata.settings) ? { metadata: { settings: normalizeGlobalSettings(parsed.metadata.settings) } } : {}) };
}

export function serializeLucasCadProject(document: { sketches: unknown[]; features: unknown[]; referenceGeometry?: unknown[] }, settings: GlobalAppSettings = DEFAULT_GLOBAL_SETTINGS) {
  return JSON.stringify({ metadata: { settings: normalizeGlobalSettings(settings) }, schemaVersion: 2, units: "mm", sketches: document.sketches, features: document.features, referenceGeometry: document.referenceGeometry ?? [] }, null, 2);
}

export function normalizeLucasCadFileName(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "Untitled Part.lucascad.json";
  if (trimmed.toLowerCase().endsWith(".json")) return trimmed;
  return `${trimmed}.lucascad.json`;
}
