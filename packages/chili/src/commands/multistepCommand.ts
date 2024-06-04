// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    AsyncController,
    CancelableCommand,
    EdgeMeshData,
    LineType,
    Property,
    VertexMeshData,
    VisualConfig,
    XYZ,
} from "chili-core";
import { SnapedData } from "../snap";
import { IStep } from "../step";

export abstract class MultistepCommand extends CancelableCommand {
    protected stepDatas: SnapedData[] = [];

    private _repeatOperation: boolean = false;
    @Property.define("command.mode.repeat")
    get repeatOperation() {
        return this._repeatOperation;
    }

    set repeatOperation(value: boolean) {
        this.setProperty("repeatOperation", value);
    }

    protected canExcute(): Promise<boolean> {
        return Promise.resolve(true);
    }

    protected async executeAsync(): Promise<void> {
        if (!(await this.canExcute())) {
            return;
        }
        if (!(await this.executeSteps())) {
            return;
        }

        this.executeMainTask();

        if (this._repeatOperation) {
            this.resetSteps();
            await this.executeAsync();
        }
    }

    protected async executeSteps(): Promise<boolean> {
        let steps = this.getSteps();
        try {
            while (this.stepDatas.length < steps.length) {
                this.controller = new AsyncController();
                let data = await steps[this.stepDatas.length].execute(this.document, this.controller);
                if (data === undefined || this.controller.result?.status !== "success") {
                    return false;
                }
                this.stepDatas.push(data);
            }
            return true;
        } finally {
            this.document.selection.clearSelection();
            this.document.visual.highlighter.clear();
        }
    }

    protected resetSteps() {
        this.stepDatas.length = 0;
    }

    protected previewPoint(point: XYZ) {
        return VertexMeshData.from(point, VisualConfig.editVertexSize, VisualConfig.editVertexColor);
    }

    protected previewLine(start: XYZ, end: XYZ) {
        return EdgeMeshData.from(start, end, VisualConfig.temporaryEdgeColor, LineType.Dash);
    }

    protected abstract getSteps(): IStep[];

    protected abstract executeMainTask(): void;
}
