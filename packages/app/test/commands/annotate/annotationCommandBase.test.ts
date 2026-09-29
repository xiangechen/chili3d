// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IDocument, Plane, TextAnnotation, Transaction, XY, XYZ } from "@chili3d/core";
import { createMockApplication, TestDocument } from "@chili3d/core/test-utils";
import { describe, expect, test } from "@rstest/core";
import { TextAnnotationCommand } from "../../../src/commands/annotate/text";
import { pointStepResult, seedStepDatas } from "../commandTestUtils";

const leader = () => new XYZ({ x: 0, y: 0, z: 0 });
const position = () => new XYZ({ x: 5, y: 5, z: 0 });

/** Wires a TextAnnotationCommand (the base class's simplest subclass) to a document. */
function textCommand(doc: IDocument, points: XYZ[] = [leader(), position()]) {
    const cmd = new TextAnnotationCommand();
    const app = createMockApplication();
    app.activeView = {
        document: doc,
        workplane: Plane.XY,
        direction: () => XYZ.unitNZ,
        up: () => XYZ.unitY,
        worldToScreen: (p: XYZ) => new XY({ x: p.x, y: -p.y }),
    } as any;
    (cmd as any)._application = app;
    seedStepDatas(
        cmd,
        points.map((point) => pointStepResult({ point })),
    );
    return cmd;
}

function textAnnotations(doc: TestDocument): TextAnnotation[] {
    return doc.modelManager.findNodes((node) => node instanceof TextAnnotation) as TextAnnotation[];
}

describe("AnnotationCommandBase.executeMainTask", () => {
    test("commits the preview annotation as one undo step", () => {
        const doc = new TestDocument();
        const cmd = textCommand(doc);

        (cmd as any).executeMainTask();

        const annotations = textAnnotations(doc);
        expect(annotations).toHaveLength(1);
        expect(annotations[0].leaderPoint?.isEqualTo(leader())).toBe(true);
        expect(annotations[0].position.isEqualTo(position())).toBe(true);
        expect(doc.history.undoCount()).toBe(1);
        expect((cmd as any).repeatOperation).toBe(true);
    });

    test("a commitAnnotation failure propagates and leaves no stranded transaction", () => {
        const doc = new TestDocument();
        const cmd = textCommand(doc);
        (cmd as any).commitAnnotation = () => {
            throw new Error("commit failed");
        };

        expect(() => (cmd as any).executeMainTask()).toThrow("commit failed");

        // the preview was rolled back and nothing reached the history
        expect(textAnnotations(doc)).toHaveLength(0);
        expect(doc.history.undoCount()).toBe(0);

        // the preview is cleared, so the cancel path does not roll back a second time
        (cmd as any).afterExecute();
        expect(textAnnotations(doc)).toHaveLength(0);
        expect(doc.history.undoCount()).toBe(0);

        // a follow-up transaction commits to the history again instead of joining a dead one
        Transaction.execute(doc, "follow-up", () => {
            Transaction.add(doc, { name: "noop", undo: () => {}, redo: () => {}, dispose: () => {} });
        });
        expect(doc.history.undoCount()).toBe(1);

        // and a manually started transaction no longer throws "started a transaction"
        const transaction = new Transaction(doc, "manual");
        transaction.start();
        transaction.rollback();
    });
});
