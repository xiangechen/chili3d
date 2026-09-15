// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { VisualConfig, type VisualItemConfig } from "@chili3d/core";
import { DoubleSide, MeshLambertMaterial, PointsMaterial } from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { ThreeHelper } from "./threeHelper";

export const defaultVertexMaterial = new PointsMaterial({
    color: ThreeHelper.fromColor(VisualConfig.defaultEdgeColor),
    sizeAttenuation: false,
    size: 3,
});

export const highlightVertexMaterial = new PointsMaterial({
    color: ThreeHelper.fromColor(VisualConfig.highlightEdgeColor),
    sizeAttenuation: false,
    size: 5,
});

export const selectedVertexMaterial = new PointsMaterial({
    color: ThreeHelper.fromColor(VisualConfig.selectedEdgeColor),
    sizeAttenuation: false,
    size: 5,
});

const defaultEdgeMaterialOptions = {
    color: VisualConfig.defaultEdgeColor,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
};

export const defaultEdgeMaterial = new LineMaterial({
    ...defaultEdgeMaterialOptions,
    linewidth: 1,
});

const edgeMaterialsByWidth = new Map<number, LineMaterial>([[1, defaultEdgeMaterial]]);

/**
 * Shared edge material for a pixel `lineWidth` — `undefined`/1 maps to
 * `defaultEdgeMaterial`, anything else is cached per width so mesh data can carry a
 * `lineWidth` without every visual owning a material instance. The cache is
 * deliberately unbounded and never disposed: widths come from a small set of UI
 * constants and from document mesh data (`MeshData.lineWidth` is serialized), so
 * the key space stays bounded by the handful of widths real documents carry, and
 * sharing keeps the `defaultEdgeColor` listener below O(1) per material.
 * `ThreeGeometryFactory.createEdgeMaterial` is a separate source on purpose — it
 * builds per-visual materials at a different z-layer.
 */
export function edgeMaterialOfWidth(lineWidth: number | undefined): LineMaterial {
    const width = lineWidth ?? 1;
    let material = edgeMaterialsByWidth.get(width);
    if (material === undefined) {
        material = new LineMaterial({
            ...defaultEdgeMaterialOptions,
            linewidth: width,
        });
        edgeMaterialsByWidth.set(width, material);
    }
    return material;
}

VisualConfig.onPropertyChanged((property: keyof VisualItemConfig) => {
    if (property === "defaultEdgeColor") {
        defaultEdgeMaterial.color.set(VisualConfig.defaultEdgeColor);
        defaultVertexMaterial.color.set(VisualConfig.defaultEdgeColor);
        edgeMaterialsByWidth.forEach((material) => material.color.set(VisualConfig.defaultEdgeColor));
    }
});

export const hilightEdgeMaterial = new LineMaterial({
    linewidth: 3,
    color: ThreeHelper.fromColor(VisualConfig.highlightEdgeColor),
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
});

export const hilightDashedEdgeMaterial = new LineMaterial({
    linewidth: 3,
    color: ThreeHelper.fromColor(VisualConfig.highlightEdgeColor),
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    dashed: true,
    dashScale: 100,
    dashSize: 100,
    gapSize: 100,
});

export const selectedEdgeMaterial = new LineMaterial({
    linewidth: 3,
    color: ThreeHelper.fromColor(VisualConfig.selectedEdgeColor),
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
});

export const faceTransparentMaterial = new MeshLambertMaterial({
    transparent: true,
    side: DoubleSide,
    color: ThreeHelper.fromColor(VisualConfig.selectedFaceColor),
    opacity: 0.1,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
});

export const selectedFaceColoredMaterial = new MeshLambertMaterial({
    side: DoubleSide,
    color: ThreeHelper.fromColor(VisualConfig.selectedFaceColor),
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
});

export const highlightFaceMaterial = new MeshLambertMaterial({
    color: ThreeHelper.fromColor(VisualConfig.highlightFaceColor),
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
});

export const lockFaceMaterial = new MeshLambertMaterial({
    color: 0x6a6a6a,
    transparent: true,
    opacity: 0.5,
});

export const lockLineMaterial = new LineMaterial({
    color: 0x6a6a6a,
    transparent: true,
    opacity: 0.5,
});
