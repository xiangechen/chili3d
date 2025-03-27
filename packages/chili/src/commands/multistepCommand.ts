// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    AsyncController,
    CancelableCommand,
    EdgeMeshData,
    IShape,
    IShapeFactory,
    LineType,
    Property,
    Result,
    VertexMeshData,
    VisualConfig,
    XYZ,
} from "chili-core";
import { SnapResult } from "../snap";
import { IStep } from "../step";

export abstract class MultistepCommand extends CancelableCommand {
    protected stepDatas: SnapResult[] = [];

    @Property.define("command.mode.repeat")
    get repeatOperation() {
        return this.getPrivateValue("repeatOperation", false);
    }

    set repeatOperation(value: boolean) {
        this.setProperty("repeatOperation", value);
    }

    protected canExcute(): Promise<boolean> {
        return Promise.resolve(true);
    }

    protected async executeAsync(): Promise<void> {
        if (!(await this.canExcute()) || !(await this.executeSteps())) {
            return;
        }

        this.executeMainTask();

        if (this.repeatOperation) {
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

    protected meshPoint(point: XYZ) {
        return VertexMeshData.from(point, VisualConfig.editVertexSize, VisualConfig.editVertexColor);
    }

    protected meshLine(start: XYZ, end: XYZ) {
        return EdgeMeshData.from(start, end, VisualConfig.defaultEdgeColor, LineType.Solid);
    }

    protected meshCreatedShape<K extends keyof IShapeFactory>(
        method: K,
        ...args: Parameters<IShapeFactory[K] extends (...args: any) => any ? IShapeFactory[K] : never>
    ) {
        const shape = (this.application.shapeFactory as any)[method](...args);
        return this.meshShape(shape);
    }

    protected meshShape(shape: IShape | Result<IShape>, disposeShape = true) {
        if (shape instanceof Result && !shape.isOk) {
            throw shape.error;
        }

        const s = shape instanceof Result ? shape.value : shape;
        const edgeMesh = s.mesh.edges!;
        if (disposeShape) {
            s.dispose();
            edgeMesh.groups.forEach((g) => g.shape.dispose());
        }

        return edgeMesh;
    }

    protected abstract getSteps(): IStep[];

    protected abstract executeMainTask(): void;
}
