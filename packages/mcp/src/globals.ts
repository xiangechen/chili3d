// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Runtime shims for running the shared browser/core code unbundled-of-DOM under
// Node (the MCP server, CLI scripts). Import this module FIRST so everything is in
// place before @chili3d/core / @chili3d/app are evaluated.
const g = globalThis as any;

// 1. Build-time globals injected by Rspack DefinePlugin in the app/test builds.
g.__DOCUMENT_VERSION__ ??= "0.7.1";
g.__APP_VERSION__ ??= "0.7.0-beta";
g.__IS_PRODUCTION__ ??= false;

// 2. ES2024 Float16Array — used by the serializer registry; absent in older Node.
//    Defining it (backed by Float32Array) lets half-float arrays round-trip.
if (typeof g.Float16Array === "undefined") {
    g.Float16Array = class Float16Array extends Float32Array {};
}

// 3. ES2025 Promise.try — used by command/application code paths.
if (typeof (Promise as any).try !== "function") {
    (Promise as any).try = (fn: (...args: any[]) => any, ...args: any[]) =>
        new Promise((resolve) => resolve(fn(...args)));
}
