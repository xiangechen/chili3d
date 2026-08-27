// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Registers the `@chili3d/core` mock for the tree test: marker classes for
// instanceof checks, immediate Transaction, no-op Binding, NodeUtils stubs.
// Lives in a helper module instead of inline in the test file so the test can
// import `@chili3d/core/test-utils` FIRST — inline `rs.mock` calls are hoisted
// above the imports and would feed test-utils a half-initialized core namespace.
// Import this module BEFORE the module under test (but AFTER the test-utils import).

import { rs } from "@rstest/core";

import type { PubSubRecorder } from "./coreMocks";

const pubSubRecorder = rs.hoisted((): PubSubRecorder => {
    const { createPubSubRecorder } = require("./coreMocks");
    return createPubSubRecorder();
});

/** PubSub publications recorded through the mocked core. */
export function getPubSubPubs() {
    return pubSubRecorder.pubs;
}

rs.mock("@chili3d/core", () => {
    const actual = rs.hoisted(() => require("@chili3d/core"));
    const { BindingMock, TransactionMock } = rs.hoisted(() => require("./coreMocks"));
    class VisualNode {}
    class Annotation {}
    class NodeSelectionHandler {}
    class ShapeSelectionHandler {
        constructor(readonly shapeType: unknown) {}
    }
    return {
        ...actual,
        Binding: BindingMock,
        Transaction: TransactionMock,
        // The hoisted `actual` snapshots core mid-initialization, so PubSub must be stubbed.
        PubSub: pubSubRecorder.stub,
        VisualNode,
        Annotation,
        NodeSelectionHandler,
        ShapeSelectionHandler,
        NodeUtils: {
            isLinkedListNode: (node: { isGroup?: boolean }) => node.isGroup === true,
            getNodesBetween: () => [],
            findTopLevelNodes: (nodes: unknown[]) => Array.from(nodes),
            containsDescendant: () => false,
        },
    };
});
