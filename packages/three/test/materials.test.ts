// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { VisualConfig } from "@chili3d/core";
import { MeshLambertMaterial, PointsMaterial } from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import {
    defaultEdgeMaterial,
    defaultVertexMaterial,
    edgeMaterialOfWidth,
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

    describe("edgeMaterialOfWidth", () => {
        test("undefined and 1 map to defaultEdgeMaterial", () => {
            expect(edgeMaterialOfWidth(undefined)).toBe(defaultEdgeMaterial);
            expect(edgeMaterialOfWidth(1)).toBe(defaultEdgeMaterial);
        });

        test("other widths return a cached LineMaterial of that linewidth", () => {
            const material = edgeMaterialOfWidth(2);
            expect(material).toBeInstanceOf(LineMaterial);
            expect(material).not.toBe(defaultEdgeMaterial);
            expect(material.linewidth).toBe(2);
            expect(material.polygonOffset).toBe(true);
            expect(edgeMaterialOfWidth(2)).toBe(material);
        });

        test("cached material color follows VisualConfig.defaultEdgeColor", () => {
            const material = edgeMaterialOfWidth(2);
            const originalColor = VisualConfig.defaultEdgeColor;
            const testColor = 0x123fed;

            try {
                VisualConfig.defaultEdgeColor = testColor;
                expect(material.color.getHex()).toBe(testColor);
            } finally {
                VisualConfig.defaultEdgeColor = originalColor;
            }
            expect(material.color.getHex()).toBe(originalColor);
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

            try {
                VisualConfig.defaultEdgeColor = testColor;
                expect(defaultEdgeMaterial.color.getHex()).toBe(testColor);
            } finally {
                VisualConfig.defaultEdgeColor = originalColor;
            }
            expect(defaultEdgeMaterial.color.getHex()).toBe(originalColor);
        });

        test("defaultVertexMaterial color updates when VisualConfig.defaultEdgeColor changes", () => {
            const originalColor = VisualConfig.defaultEdgeColor;
            const testColor = 0xabcdef;

            try {
                VisualConfig.defaultEdgeColor = testColor;
                expect(defaultVertexMaterial.color.getHex()).toBe(testColor);
            } finally {
                VisualConfig.defaultEdgeColor = originalColor;
            }
            expect(defaultVertexMaterial.color.getHex()).toBe(originalColor);
        });
    });
});
