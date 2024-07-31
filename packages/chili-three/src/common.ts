// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { LineMaterial } from "three/examples/jsm/lines/LineMaterial";
import { ThreeHelper } from "./threeHelper";
import { VisualConfig } from "chili-core";
import { DoubleSide } from "three";

export const hilightEdgeMaterial = new LineMaterial({
    linewidth: 2,
    color: ThreeHelper.fromColor(VisualConfig.highlightEdgeColor),
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
});

export const hilightDashedEdgeMaterial = new LineMaterial({
    linewidth: 2,
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
    linewidth: 2,
    color: ThreeHelper.fromColor(VisualConfig.selectedEdgeColor),
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
});
