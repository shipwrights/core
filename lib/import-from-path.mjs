// Dynamic ESM import from an absolute filesystem path.
//
// On Windows `await import("D:\\some\\path.mjs")` throws ERR_UNSUPPORTED_ESM_URL_SCHEME
// ("Only URLs with a scheme in: file and data are supported by the default ESM loader.
//  On Windows, absolute paths must be valid file:// URLs.").
//
// pathToFileURL() handles both Windows and POSIX correctly — on Linux/macOS the
// absolute path is also returned as file:///path/to/foo.mjs, which import()
// accepts. So this helper is safe across all platforms and should be used for
// every dynamic import of a path produced by `require.resolve` or `path.join`.

import { pathToFileURL } from "node:url";

export function importFromPath(absolutePath) {
	return import(pathToFileURL(absolutePath).href);
}
