// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Registers the `@chili3d/core` mock for the propertyView test: PubSub recorder
// plus PropertyUtils / Node-marker stubs. This lives in a helper module instead of
// inline in the test file so the test can import `@chili3d/core/test-utils` FIRST —
// inline `rs.mock` calls are hoisted above the imports and would feed test-utils a
// half-initialized core namespace.
// Import this module BEFORE the module under test (but AFTER the test-utils import).

import { rs } from "@rstest/core";

/** PubSub recorder: `sub` handlers keyed by topic plus recorded `pub` calls. */
export const pubSubRecorder = rs.hoisted(() => {
    const { createPubSubRecorder } = require("./coreMocks");
    return createPubSubRecorder();
});

rs.mock("@chili3d/core", () => {
    const actual = rs.hoisted(() => require("@chili3d/core"));
    const { LocalizeMock, BindingMock, TransactionMock } = rs.hoisted(() => require("./coreMocks"));

    return {
        ...actual,
        Localize: LocalizeMock,
        Binding: BindingMock,
        Transaction: TransactionMock,
        PubSub: pubSubRecorder.stub,
        PropertyUtils: {
            getProperties: (_proto: unknown) => [
                { name: "name", display: "test.name", type: "string" },
                { name: "color", display: "test.color", type: "color" },
            ],
            getOwnProperties: (_proto: unknown) => [
                { name: "transform", display: "test.transform", type: "matrix" },
            ],
        },
        Node: class {},
        FolderNode: class {},
        GroupNode: class {},
        VisualNode: class {
            display() {
                return "VisualObject";
            }
        },
        // rs.hoisted(require(...)) may snapshot a partial core module; provide the
        // real duck-type semantics explicitly so PropertyView's feature list works.
        isFeatureListNode: (node: unknown) => typeof (node as any)?.featureItems === "function",
    };
});
