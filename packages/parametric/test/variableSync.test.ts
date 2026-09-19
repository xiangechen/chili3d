// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { FolderNode, type IDocument } from "@chili3d/core";
import { TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { ensureVariableSync } from "../src/variableSync";

/** A node that re-derives from the table, with a recorded call and an optional failure. */
class Consumer extends FolderNode {
    constructor(
        document: IDocument,
        readonly variableSyncOrder: number,
        private readonly apply: () => void,
    ) {
        super({ document, name: `consumer-${variableSyncOrder}` });
    }

    applyVariables(): void {
        this.apply();
    }
}

function tableWrite(document: TestDocument): void {
    document.variables.setItems([{ id: "v1", name: "w", type: "length", expression: "50" }]);
}

describe("ensureVariableSync", () => {
    test("applies the consumers in role order, lowest first", () => {
        const document = new TestDocument();
        const applied: string[] = [];
        document.modelManager.rootNode.add(
            new Consumer(document, 1, () => applied.push("body")),
            new Consumer(document, 0, () => applied.push("sketch")),
        );
        ensureVariableSync(document);

        tableWrite(document);

        expect(applied).toEqual(["sketch", "body"]);
    });

    // The revision is spent before the dispatch, so a consumer that throws must not strand
    // the ones behind it on the previous parameter values — the table will not notify again
    // for that revision.
    test("one consumer failing does not stop the rest", () => {
        const document = new TestDocument();
        const applied: string[] = [];
        document.modelManager.rootNode.add(
            new Consumer(document, 0, () => {
                applied.push("sketch");
                throw new Error("solve failed");
            }),
            new Consumer(document, 1, () => applied.push("body")),
        );
        ensureVariableSync(document);

        tableWrite(document);

        expect(applied).toEqual(["sketch", "body"]);
    });

    test("a consumer nested under a plain folder is still reached, and the folder is skipped", () => {
        const document = new TestDocument();
        const folder = new FolderNode({ document, name: "group" });
        const applyVariables = rs.fn();
        folder.add(new Consumer(document, 0, applyVariables));
        document.modelManager.rootNode.add(folder);
        ensureVariableSync(document);

        tableWrite(document);

        expect(applyVariables).toHaveBeenCalledTimes(1);
    });
});
