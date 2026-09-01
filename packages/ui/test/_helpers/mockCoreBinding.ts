// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Registers the shared `@chili3d/core` mock for the tree item tests: no-op Binding,
// immediate Transaction. Lives in a helper module instead of inline in the test
// files so those tests can import `@chili3d/core/test-utils` FIRST — inline
// `rs.mock` calls are hoisted above the imports and would feed test-utils a
// half-initialized core namespace.
// Import this module BEFORE the module under test (but AFTER the test-utils import).

import { rs } from "@rstest/core";

rs.mock("@chili3d/core", () => {
    const actual = rs.hoisted(() => require("@chili3d/core"));
    const { BindingMock, FolderNodeMock, TransactionMock, isFeatureListNodeMock } = rs.hoisted(() =>
        require("./coreMocks"),
    );
    return {
        ...actual,
        Binding: BindingMock,
        Transaction: TransactionMock,
        FolderNode: FolderNodeMock,
        isFeatureListNode: isFeatureListNodeMock,
    };
});
