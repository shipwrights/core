import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, isAbsolute } from "node:path";
import { parse as parseYaml } from "yaml";
import Ajv from "ajv";

const SCHEMA_PATH = new URL("../schemas/shipwright-config.schema.json", import.meta.url);
let _validator = null;

function getValidator() {
  if (_validator) return _validator;
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const ajv = new Ajv({ allErrors: true, useDefaults: true, strict: false });
  _validator = ajv.compile(schema);
  return _validator;
}

export function validateConfig(config) {
  const validate = getValidator();
  const ok = validate(config);
  if (ok) return { ok: true };
  return {
    ok: false,
    errors: validate.errors.map((e) => ({
      path: e.instancePath || "(root)",
      message: e.message,
      params: e.params,
    })),
  };
}

function readYaml(path) {
  if (!existsSync(path)) {
    throw new Error(`Config file not found: ${path}`);
  }
  const text = readFileSync(path, "utf8");
  return parseYaml(text);
}

function applyExtends(config, baseDir, seen = new Set()) {
  if (!config?.extends) return config;
  const parentPath = isAbsolute(config.extends)
    ? config.extends
    : resolve(baseDir, config.extends);
  if (seen.has(parentPath)) {
    throw new Error(`Circular extends chain at ${parentPath}`);
  }
  seen.add(parentPath);
  const parent = readYaml(parentPath);
  const parentDir = dirname(parentPath);
  const resolvedParent = applyExtends(parent, parentDir, seen);
  return mergeConfigs(resolvedParent, config);
}

function mergeConfigs(parent, child) {
  if (parent === undefined || parent === null) return child;
  if (child === undefined || child === null) return parent;
  if (Array.isArray(parent) || Array.isArray(child)) return child ?? parent;
  if (typeof parent !== "object" || typeof child !== "object") return child;
  const out = { ...parent };
  for (const key of Object.keys(child)) {
    if (key === "extends") continue;
    out[key] = mergeConfigs(parent[key], child[key]);
  }
  return out;
}

export function loadConfig(projectRoot, configPath = ".shipwright.yml") {
  const fullPath = isAbsolute(configPath) ? configPath : resolve(projectRoot, configPath);
  const raw = readYaml(fullPath);
  const merged = applyExtends(raw, dirname(fullPath));
  delete merged.extends;
  const validation = validateConfig(merged);
  if (!validation.ok) {
    const summary = validation.errors
      .map((e) => `  ${e.path}: ${e.message}`)
      .join("\n");
    throw new Error(`Invalid .shipwright.yml:\n${summary}`);
  }
  return merged;
}
