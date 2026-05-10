import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const BUILTIN_SOURCES = {
  files: () => import("../sources/files/index.mjs"),
  "github-issues": () => import("../sources/github-issues/index.mjs"),
};

export async function loadSource(sourceConfig, { projectRoot }) {
  const kind = sourceConfig?.kind;
  if (!kind) {
    throw new Error("backlog.source.kind is required");
  }

  let factory;
  if (BUILTIN_SOURCES[kind]) {
    const mod = await BUILTIN_SOURCES[kind]();
    factory = mod.createSource ?? mod.default;
  } else {
    const pkgName = kind.startsWith("@") ? kind : `@shipwrights/source-${kind}`;
    let resolved;
    try {
      resolved = require.resolve(pkgName, { paths: [projectRoot] });
    } catch (err) {
      throw new Error(
        `Source adapter "${kind}" not found. Install it: npm install -D ${pkgName}`,
      );
    }
    const mod = await import(resolved);
    factory = mod.createSource ?? mod.default;
  }

  if (typeof factory !== "function") {
    throw new Error(
      `Source "${kind}" must export createSource (or default) as a factory function`,
    );
  }

  return factory({ ...sourceConfig.config, projectRoot });
}
