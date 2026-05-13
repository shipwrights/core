import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// Match {{token}} but NOT ${{ token }} — the latter is GitHub Actions syntax
// that must pass through unchanged into rendered workflow files.
const TOKEN_PATTERN = /(?<!\$)\{\{\s*([a-zA-Z_][\w.-]*)\s*\}\}/g;

function getNested(obj, path) {
	const parts = path.split(".");
	let cursor = obj;
	for (const part of parts) {
		if (cursor === null || cursor === undefined) return undefined;
		cursor = cursor[part];
	}
	return cursor;
}

export function renderTemplate(template, context) {
	return template.replace(TOKEN_PATTERN, (match, key) => {
		const value = getNested(context, key);
		if (value === undefined || value === null) {
			throw new Error(`Unresolved template token: {{${key}}}`);
		}
		return String(value);
	});
}

export function renderFile(srcPath, destPath, context) {
	const tmpl = readFileSync(srcPath, "utf8");
	const out = renderTemplate(tmpl, context);
	mkdirSync(dirname(destPath), { recursive: true });
	writeFileSync(destPath, out, "utf8");
}

export function templateUnchanged(srcPath, existingPath, context) {
	if (!existsSync(existingPath)) return false;
	const rendered = renderTemplate(readFileSync(srcPath, "utf8"), context);
	const existing = readFileSync(existingPath, "utf8");
	return rendered === existing;
}
