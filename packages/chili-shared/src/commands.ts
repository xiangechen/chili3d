// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

export class Commands {
    LastCommand = "LastCommand";
    NewGroup = "NewGroup";
    Line = "Line";
    PLine = "PLine";
    Circle = "Circle";
    Rect = "Rect";
    Box = "Box";
    Delete = "Delete";
    Undo = "Undo";
    Redo = "Redo";

    private constructor() {}

    private static _instance: Commands | undefined;
    static get instance() {
        if (this._instance === undefined) {
            this._instance = new Commands();
        }
        return this._instance;
    }
}
