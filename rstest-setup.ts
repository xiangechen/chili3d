// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// packages/core/src/serialize/serializer.ts registers `Float16Array` at module
// load time. It is a native global in browsers and Node 22+, but happy-dom (our
// unit-test environment) does not expose it, so importing @chili3d/core throws
// `ReferenceError: Float16Array is not defined` before any test runs.
//
// This setup file provides a Float16Array stand-in for the test environment only
// (production runtimes have the real one). No test exercises half-float values,
// so backing it with Float32Array is sufficient.
const g = globalThis as any;
if (typeof g.Float16Array === "undefined") {
    g.Float16Array = class Float16Array extends Float32Array {};
}

// packages/core/src/command/command.ts uses Promise.try (ES2025), which the
// rstest worker runtime does not expose. Provide a spec-faithful shim for tests:
// it runs the callback synchronously and folds a synchronous throw into a
// rejected promise. Production runtimes have the native method.
if (typeof (Promise as any).try !== "function") {
    (Promise as any).try = (fn: (...args: any[]) => any, ...args: any[]) =>
        new Promise((resolve) => resolve(fn(...args)));
}
