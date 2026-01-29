// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { getCurrentApplication, VisualConfig, type VisualItemConfig } from "chili-core";
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

export const defaultEdgeMaterial = new LineMaterial({
    linewidth: 1,
    color: VisualConfig.defaultEdgeColor,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
});
VisualConfig.onPropertyChanged((property: keyof VisualItemConfig) => {
    if (property === "defaultEdgeColor") {
        defaultEdgeMaterial.color.set(VisualConfig.defaultEdgeColor);
        getCurrentApplication()?.views.forEach((x) => x.update());
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
});

export const faceColoredMaterial = new MeshLambertMaterial({
    side: DoubleSide,
    color: ThreeHelper.fromColor(VisualConfig.highlightFaceColor),
});
