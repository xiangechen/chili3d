// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

export interface I18n {
    name: string;
    multiValue: string;
    // ui
    ribbonStartup: string;
    modelTree: string;
    property: string;

    // tip
    newGroup: string;
    expandAll: string;
    unexpandAll: string;
    delete: string;

    // categorys
    defaultCategory: string;
    categoryParemeter: string;
    // body
    position: string;
    rotate: string;
    visible: string;
    vertexBodyPoint: string;
    curveStart: string;
    curveEnd: string;

    // commands
    commandRedo: string;
    commandUndo: string;
    commandSetProperty: string;
    commandModifyArray: string;
    commandAddItemToSet: string;
    commandAddItemToArray: string;

    commandLine: string;

    // snap
    snapEndPoint: string;
    snapMidPoint: string;
    snapCenter: string;
    snapIntersection: string;
    snapPerpendicular: string;
}
