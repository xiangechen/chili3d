// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, PubSub, Result, ShapeTypes } from "@chili3d/core";
import { setupShapeFactoryMock } from "@chili3d/core/test-utils";
import { afterEach, beforeEach, describe, expect, rs, test } from "@rstest/core";
import { GordonCommand } from "../../../src/commands/create/gordon";
import {
    mockShape,
    seedStepDatas,
    shapeStepResult,
    stubTransactionRun,
    wireCommand,
} from "../commandTestUtils";

let gordon: ReturnType<typeof rs.fn>;
beforeEach(() => {
    gordon = rs.fn(() => Result.ok(mockShape({ shapeType: ShapeTypes.face })));
    setupShapeFactoryMock({ gordon });
});
afterEach(() => {
    rs.restoreAllMocks();
});

/** Two (or `count`) empty pick entries — enough for a step answer, no geometry needed. */
function picks(count = 2) {
    return Array.from({ length: count }, () => ({}));
}

function gordonCmd() {
    const cmd = new GordonCommand();
    const { doc, addedNodes } = wireCommand(cmd);
    return { cmd, doc, addedNodes };
}

describe("GordonCommand", () => {
    test("declares its command metadata", () => {
        expect((GordonCommand as any).prototype.data).toMatchObject({
            key: "create.gordon",
            icon: "icon-loft",
        });
    });

    test("asks for profiles then guides, both multi-select", () => {
        const { cmd } = gordonCmd();

        const steps = (cmd as any).getSteps();

        expect(steps).toHaveLength(2);
        expect(steps[0].snapeType).toBe(ShapeTypes.edge);
        expect(steps[0].prompt).toBe("prompt.select.section");
        expect(steps[0].options.multiple).toBe(true);
        expect(steps[1].snapeType).toBe(ShapeTypes.edge);
        expect(steps[1].prompt).toBe("prompt.select.curve");
        expect(steps[1].options.multiple).toBe(true);
    });

    test("keeps the picked profiles highlighted while the guides are picked", () => {
        const { cmd, doc } = gordonCmd();
        seedStepDatas(cmd, [shapeStepResult(picks())]);
        const steps = (cmd as any).getSteps();

        steps[1].options.beforeSelection();
        expect(doc.visual.highlighter.addState).toHaveBeenCalledTimes(2);

        steps[1].options.afterSelection();
        expect(doc.visual.highlighter.removeState).toHaveBeenCalledTimes(2);
    });

    test("builds the surface and adds it as one face node", () => {
        const restore = stubTransactionRun();
        try {
            const { cmd, doc, addedNodes } = gordonCmd();
            const face = mockShape({ shapeType: ShapeTypes.face });
            gordon.mockReturnValue(Result.ok(face));
            seedStepDatas(cmd, [shapeStepResult(picks()), shapeStepResult(picks())]);

            (cmd as any).executeMainTask();

            const [profiles, guides, tolerance] = gordon.mock.calls[0];
            expect(profiles).toHaveLength(2);
            expect(guides).toHaveLength(2);
            expect(tolerance).toBe(1e-4);
            expect(addedNodes).toHaveLength(1);
            expect((addedNodes[0] as any).name).toBe(I18n.translate("command.create.gordon"));
            expect((addedNodes[0] as any).shape.value).toBe(face);
            expect(doc.visual.update).toHaveBeenCalled();
        } finally {
            restore();
        }
    });

    test("reports a kernel refusal without adding a node", () => {
        const restore = stubTransactionRun();
        const toast = rs.spyOn(PubSub.default, "pub");
        try {
            const { cmd, addedNodes } = gordonCmd();
            const error = "Failed to create Gordon surface: every profile must intersect every guide";
            gordon.mockReturnValue(Result.err(error));
            seedStepDatas(cmd, [shapeStepResult(picks()), shapeStepResult(picks())]);

            (cmd as any).executeMainTask();

            expect(toast).toHaveBeenCalledWith("showToast", "error.default:{0}", error);
            expect(addedNodes).toHaveLength(0);
        } finally {
            toast.mockRestore();
            restore();
        }
    });

    test("asks for at least two edges in each group", () => {
        const toast = rs.spyOn(PubSub.default, "pub");
        try {
            const { cmd, addedNodes } = gordonCmd();
            seedStepDatas(cmd, [shapeStepResult(picks(1)), shapeStepResult(picks())]);

            (cmd as any).executeMainTask();

            expect(gordon).not.toHaveBeenCalled();
            expect(toast).toHaveBeenCalledWith(
                "showToast",
                "error.default:{0}",
                I18n.translate("error.create.gordon.input"),
            );
            expect(addedNodes).toHaveLength(0);
        } finally {
            toast.mockRestore();
        }
    });

    test("passes the world-space edges to the kernel", () => {
        const restore = stubTransactionRun();
        try {
            const { cmd } = gordonCmd();
            const worldProfile = mockShape({ shapeType: ShapeTypes.edge });
            const profile = mockShape({
                shapeType: ShapeTypes.edge,
                transformedMul: rs.fn(() => worldProfile),
            });
            seedStepDatas(cmd, [
                shapeStepResult([{ shape: profile as any }, { shape: profile as any }]),
                shapeStepResult(picks()),
            ]);

            (cmd as any).executeMainTask();

            const [profiles] = gordon.mock.calls[0];
            expect(profiles).toEqual([worldProfile, worldProfile]);
        } finally {
            restore();
        }
    });
});
