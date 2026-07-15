// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config, VisualConfig } from "../config";
import { AsyncController, Result } from "../foundation";
import type { XYZ } from "../math";
import type { IShape, IShapeFactory } from "../shape";
import { MeshDataUtils } from "../shape";
import type { SnapResult } from "../snap";
import type { IStep } from "../step";
import type { IView, VisualState } from "../visual";
import { ViewUtils } from "../visual";
import { CancelableCommand } from "./command";

export abstract class MultistepCommand extends CancelableCommand {
    protected stepDatas: SnapResult[] = [];

    protected canExcute(): Promise<boolean> {
        return Promise.resolve(true);
    }

    protected override onRestarting(): void {
        this.resetStepDatas();
    }

    protected async executeAsync(): Promise<void> {
        if (!(await this.canExcute()) || !(await this.executeSteps())) {
            return;
        }

        this.executeMainTask();
    }

    protected async executeSteps(): Promise<boolean> {
        const steps = this.getSteps();

        return Promise.try(async () => {
            while (this.stepDatas.length < steps.length) {
                this.controller = new AsyncController();
                const data = await steps[this.stepDatas.length].execute(this.document, this.controller);
                if (data === undefined || this.controller.result?.status !== "success") {
                    return false;
                }
                this.stepDatas.push(data);
            }
            return true;
        }).finally(() => {
            if (!this._isRestarting) {
                this.document?.selection.clearSelection();
            }
        });
    }

    protected resetStepDatas() {
        this.stepDatas.length = 0;
    }

    protected meshPoint(point: XYZ) {
        return MeshDataUtils.createVertexMesh(
            point,
            VisualConfig.editVertexSize,
            VisualConfig.editVertexColor,
        );
    }

    protected meshLine(start: XYZ, end: XYZ, color = VisualConfig.defaultEdgeColor, lineWith?: number) {
        const data = MeshDataUtils.createEdgeMesh(start, end, color, "solid");
        if (lineWith !== undefined) {
            data.lineWidth = lineWith;
        }
        return data;
    }

    protected meshCreatedShape<K extends keyof IShapeFactory>(
        method: K,
        ...args: Parameters<IShapeFactory[K] extends (...args: any) => any ? IShapeFactory[K] : never>
    ) {
        const shape = (shapeFactory as any)[method](...args);
        return this.meshShape(shape);
    }

    protected meshShape(shape: IShape | Result<IShape>, disposeShape = true) {
        if (shape instanceof Result && !shape.isOk) {
            throw shape.error;
        }

        const s = shape instanceof Result ? shape.value : shape;
        const edgeMesh = s.edgesMeshPosition();
        if (disposeShape) {
            s.dispose();
        }

        return edgeMesh;
    }

    protected findPlane(view: IView, origin: XYZ, point: XYZ | undefined) {
        if (point === undefined || !Config.instance.dynamicWorkplane) {
            return view.workplane.translateTo(origin);
        }

        return ViewUtils.raycastClosestPlane(view, origin, point);
    }

    protected transformdFirstShape(step: SnapResult, shouldDispose = true) {
        const shape = step.shapes[0].shape.transformedMul(step.shapes[0].transform);
        if (shouldDispose) this.disposeStack.add(shape);
        return shape;
    }

    protected transformdShapes(step: SnapResult, shouldDispose = true) {
        return step.shapes.map((s) => {
            const shape = s.shape.transformedMul(s.transform);
            if (shouldDispose) this.disposeStack.add(shape);
            return shape;
        });
    }

    protected readonly addFirstSelectedState = (state: VisualState) => {
        const shape = this.stepDatas.at(0)?.shapes.at(0);
        if (!shape) return;

        this.document.visual.highlighter.addState(
            shape.owner,
            state,
            shape.shape.shapeType,
            ...shape.indexes,
        );
    };

    protected readonly removeFirstSelectedState = (state: VisualState) => {
        const shape = this.stepDatas.at(0)?.shapes.at(0);
        if (!shape) return;

        this.document.visual.highlighter.removeState(
            shape.owner,
            state,
            shape.shape.shapeType,
            ...shape.indexes,
        );
    };

    protected abstract getSteps(): IStep[];

    protected abstract executeMainTask(): void;
}
