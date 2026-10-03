// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { JoinType } from "@chili3d/core";
import { createMockApplication, TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import "../src/features"; // registers all feature handlers
import { featureHandler, type ShellFeatureData } from "../src/features/feature";
import { ParametricBodyNode } from "../src/parametricBodyNode";

describe("shell feature", () => {
    let doc: TestDocument;

    beforeEach(() => {
        doc = new TestDocument({ application: createMockApplication() });
    });

    function shellFeature(overrides?: Partial<ShellFeatureData>): ShellFeatureData {
        return { id: "s1", type: "shell", faces: [], thickness: 2, ...overrides };
    }

    function bodyWith(features: ShellFeatureData[]) {
        const body = new ParametricBodyNode({ document: doc, features });
        doc.modelManager.addNode(body);
        return body;
    }

    test("is registered with its ribbon identity and reselect", () => {
        const handler = featureHandler("shell");
        expect(handler).toBeDefined();
        expect(handler!.display).toBe("command.feature.shell");
        expect(handler!.icon).toBe("icon-shell");
        expect(handler!.reselectable).toBe(true);
    });

    test("the join type is a dropdown of the two the command offers", () => {
        const joinType = featureHandler("shell")!.parameters!(shellFeature()).find(
            (x) => x.key === "joinType",
        );

        // Restated rather than derived from `JoinTypes`: what the row OFFERS is the thing this
        // pins, and it is deliberately narrower than what the field accepts.
        expect(joinType).toEqual({
            key: "joinType",
            display: "option.command.joinType",
            value: "arc",
            choices: [
                { value: "arc", display: "option.command.joinType.arc" },
                { value: "intersection", display: "option.command.joinType.intersection" },
            ],
        });
    });

    test("an undefined join type reads as the arc default", () => {
        const parameters = featureHandler("shell")!.parameters!(shellFeature());
        expect(parameters.find((x) => x.key === "joinType")?.value).toBe("arc");
    });

    test("a join type the dropdown does not offer still evaluates", () => {
        // `tangent` is outside the row but inside the field's type, and the kernel builds it — so
        // the guard is the kernel's set, not the dropdown's, and a file carrying one is not
        // rejected. The error here is the missing chain link, i.e. the guard did NOT fire.
        const body = bodyWith([shellFeature({ joinType: "tangent" as JoinType })]);

        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[0].error).toBe("Shell requires a preceding feature");
    });

    test("an invalid join type surfaces as a feature error without reaching the kernel", () => {
        // The value a hand-edited project file can carry. `getJoinType` throws on it, and a throw
        // inside `evaluate` escapes `evaluateFeature` and aborts the whole chain — so the guard
        // has to turn it into an ordinary error before anything reads the context.
        const makeThickSolidByJoin = rs.fn(() => {
            throw new Error("Unknown join type: bogus");
        });
        const previous = Object.getOwnPropertyDescriptor(globalThis, "shapeFactory");
        Object.defineProperty(globalThis, "shapeFactory", {
            value: { makeThickSolidByJoin },
            writable: true,
            configurable: true,
        });
        try {
            // No input at all: the join type is checked first, so the error names the value
            // rather than the missing chain link.
            const body = bodyWith([shellFeature({ joinType: "bogus" as JoinType })]);

            expect(body.shape.isOk).toBe(false);
            expect(body.featureItems()[0].error).toBe("Invalid join type: bogus");
            expect(makeThickSolidByJoin).not.toHaveBeenCalled();
        } finally {
            if (previous) Object.defineProperty(globalThis, "shapeFactory", previous);
            else delete (globalThis as { shapeFactory?: unknown }).shapeFactory;
        }
    });
});
