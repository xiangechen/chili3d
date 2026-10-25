// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    connectedFaceGroups,
    type IFace,
    type IShape,
    Matrix4,
    Plane,
    ShapeTypes,
    thickenFaces,
} from "@chili3d/core";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { beforeAll, expect, rs, test } from "@rstest/core";

const WASM_BINARY = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../wasm/lib/chili-wasm.wasm"),
);

beforeAll(async () => {
    await initWasm({ wasmBinary: WASM_BINARY });
    Object.defineProperty(globalThis, "shapeFactory", {
        value: new ShapeFactory(),
        writable: true,
        configurable: true,
    });
});

/** Two faces that share an edge — one connected set. */
function adjacentPair(faces: readonly IFace[]): IFace[] {
    for (let i = 0; i < faces.length; i++) {
        for (let j = i + 1; j < faces.length; j++) {
            if (connectedFaceGroups([faces[i], faces[j]]).length === 1) return [faces[i], faces[j]];
        }
    }
    throw new Error("the box has no adjacent faces");
}

test("a connected set goes to the kernel as one shell, once per direction", () => {
    const box = shapeFactory.box(Plane.XY, 40, 30, 20).unchecked() as IShape;
    try {
        const faces = box.findSubShapes(ShapeTypes.face) as IFace[];
        const pair = adjacentPair(faces);
        expect(connectedFaceGroups(pair)).toEqual([[0, 1]]);

        const originalShell = shapeFactory.shell.bind(shapeFactory);
        const originalThicken = shapeFactory.makeThickSolidBySimple.bind(shapeFactory);
        const shells: IShape[] = [];
        const shellSpy = rs.spyOn(shapeFactory, "shell").mockImplementation((source: IFace[]) => {
            const result = originalShell(source);
            if (result.isOk) {
                shells.push(result.value);
                rs.spyOn(result.value, "dispose");
            }
            return result;
        });
        const thickenSpy = rs
            .spyOn(shapeFactory, "makeThickSolidBySimple")
            .mockImplementation((shape: IShape, thickness: number) => originalThicken(shape, thickness));

        try {
            const result = thickenFaces(pair, [2, -2]);

            expect(result.isOk).toBe(true);
            // One shell for the whole connected set, then one solid per direction.
            expect(shellSpy).toHaveBeenCalledTimes(1);
            expect(thickenSpy).toHaveBeenCalledTimes(2);
            // The shell this function sewed is its own to free.
            expect(shells).toHaveLength(1);
            expect((shells[0].dispose as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(
                1,
            );
            // The two directions are combined into one result.
            expect([ShapeTypes.compound, ShapeTypes.compoundSolid]).toContain(result.value.shapeType);
            result.value.dispose();
        } finally {
            shellSpy.mockRestore();
            thickenSpy.mockRestore();
        }
    } finally {
        box.dispose();
    }
});

test("faces from different coordinate systems fall apart into single-face groups", () => {
    // The contract callers must respect: grouping is topological, so copies do not group.
    const box = shapeFactory.box(Plane.XY, 40, 30, 20).unchecked() as IShape;
    try {
        const faces = box.findSubShapes(ShapeTypes.face) as IFace[];
        const copies = faces.map((face) => face.transformedMul(Matrix4.identity()) as IFace);
        try {
            expect(connectedFaceGroups(copies)).toHaveLength(copies.length);
        } finally {
            copies.forEach((copy) => copy.dispose());
        }
    } finally {
        box.dispose();
    }
});
