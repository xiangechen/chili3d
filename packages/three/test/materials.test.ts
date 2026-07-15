// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { VisualConfig } from "@chili3d/core";
import { MeshLambertMaterial, PointsMaterial } from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import {
    defaultEdgeMaterial,
    defaultVertexMaterial,
    faceTransparentMaterial,
    highlightFaceMaterial,
    highlightVertexMaterial,
    hilightDashedEdgeMaterial,
    hilightEdgeMaterial,
    lockFaceMaterial,
    lockLineMaterial,
    selectedEdgeMaterial,
    selectedFaceColoredMaterial,
    selectedVertexMaterial,
} from "../src/materials";

describe("materials", () => {
    describe("vertex materials", () => {
        test("defaultVertexMaterial is PointsMaterial with correct size", () => {
            expect(defaultVertexMaterial).toBeInstanceOf(PointsMaterial);
            expect(defaultVertexMaterial.size).toBe(3);
            expect(defaultVertexMaterial.sizeAttenuation).toBe(false);
        });

        test("highlightVertexMaterial has larger size", () => {
            expect(highlightVertexMaterial).toBeInstanceOf(PointsMaterial);
            expect(highlightVertexMaterial.size).toBe(5);
            expect(highlightVertexMaterial.sizeAttenuation).toBe(false);
        });

        test("selectedVertexMaterial has larger size", () => {
            expect(selectedVertexMaterial).toBeInstanceOf(PointsMaterial);
            expect(selectedVertexMaterial.size).toBe(5);
            expect(selectedVertexMaterial.sizeAttenuation).toBe(false);
        });
    });

    describe("edge materials", () => {
        test("defaultEdgeMaterial is LineMaterial with linewidth 1", () => {
            expect(defaultEdgeMaterial).toBeInstanceOf(LineMaterial);
            expect(defaultEdgeMaterial.linewidth).toBe(1);
            expect(defaultEdgeMaterial.polygonOffset).toBe(true);
        });

        test("hilightEdgeMaterial has linewidth 3", () => {
            expect(hilightEdgeMaterial).toBeInstanceOf(LineMaterial);
            expect(hilightEdgeMaterial.linewidth).toBe(3);
        });

        test("hilightDashedEdgeMaterial has dash properties", () => {
            expect(hilightDashedEdgeMaterial).toBeInstanceOf(LineMaterial);
            expect(hilightDashedEdgeMaterial.linewidth).toBe(3);
            expect(hilightDashedEdgeMaterial.dashed).toBe(true);
            expect(hilightDashedEdgeMaterial.dashScale).toBe(100);
            expect(hilightDashedEdgeMaterial.dashSize).toBe(100);
            expect(hilightDashedEdgeMaterial.gapSize).toBe(100);
        });

        test("selectedEdgeMaterial has linewidth 3", () => {
            expect(selectedEdgeMaterial).toBeInstanceOf(LineMaterial);
            expect(selectedEdgeMaterial.linewidth).toBe(3);
        });
    });

    describe("face materials", () => {
        test("faceTransparentMaterial is transparent", () => {
            expect(faceTransparentMaterial).toBeInstanceOf(MeshLambertMaterial);
            expect(faceTransparentMaterial.transparent).toBe(true);
            expect(faceTransparentMaterial.opacity).toBeCloseTo(0.1);
        });

        test("selectedFaceColoredMaterial has polygon offset", () => {
            expect(selectedFaceColoredMaterial).toBeInstanceOf(MeshLambertMaterial);
            expect(selectedFaceColoredMaterial.polygonOffset).toBe(true);
        });

        test("highlightFaceMaterial has polygon offset", () => {
            expect(highlightFaceMaterial).toBeInstanceOf(MeshLambertMaterial);
            expect(highlightFaceMaterial.polygonOffset).toBe(true);
        });
    });

    describe("lock materials", () => {
        test("lockFaceMaterial is gray and semi-transparent", () => {
            expect(lockFaceMaterial).toBeInstanceOf(MeshLambertMaterial);
            expect(lockFaceMaterial.color.getHex()).toBe(0x6a6a6a);
            expect(lockFaceMaterial.transparent).toBe(true);
            expect(lockFaceMaterial.opacity).toBeCloseTo(0.5);
        });

        test("lockLineMaterial is gray and semi-transparent", () => {
            expect(lockLineMaterial).toBeInstanceOf(LineMaterial);
            expect(lockLineMaterial.color.getHex()).toBe(0x6a6a6a);
            expect(lockLineMaterial.transparent).toBe(true);
            expect(lockLineMaterial.opacity).toBeCloseTo(0.5);
        });
    });

    describe("VisualConfig reactivity", () => {
        test("defaultEdgeMaterial color updates when VisualConfig.defaultEdgeColor changes", () => {
            const originalColor = VisualConfig.defaultEdgeColor;
            const testColor = 0xabcdef;

            VisualConfig.defaultEdgeColor = testColor;
            expect(defaultEdgeMaterial.color.getHex()).toBe(testColor);

            // Restore original
            VisualConfig.defaultEdgeColor = originalColor;
            expect(defaultEdgeMaterial.color.getHex()).toBe(originalColor);
        });
    });
});
