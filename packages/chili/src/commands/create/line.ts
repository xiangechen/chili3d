// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { GeometryModel, IDocument, Precision, Property, XYZ, command } from "chili-core";
import { LineBody } from "../../bodys";
import { Dimension, SnapPointData } from "../../snap";
import { IStep, PointStep } from "../../step";
import { CreateCommand } from "./createCommand";
import { Application } from "../../application";

@command({
    name: "Line",
    display: "command.line",
    icon: "icon-line",
})
export class Line extends CreateCommand {
    private static count: number = 1;

    private _isLine: boolean = true;
    @Property.define("line.type.line", "common.type", "icon-line")
    get isLine() {
        return this._isLine;
    }
    set isLine(value: boolean) {
        if (!this._isXLine || !value) return;
        this._isLine = true;
        this._isXLine = false;
        this.emitPropertyChanged("isLine", false);
        this.emitPropertyChanged("isXLine", true);
    }

    private _isXLine: boolean = false;
    @Property.define("line.type.xline", "common.type", "icon-line")
    get isXLine() {
        return this._isXLine;
    }
    set isXLine(value: boolean) {
        if (!this._isLine || !value) return;
        this._isLine = false;
        this._isXLine = true;
        this.emitPropertyChanged("isLine", true);
        this.emitPropertyChanged("isXLine", false);
    }

    private _isContinue: boolean = false;
    @Property.dependence("isLine", true)
    @Property.dependence("repeatOperation", true)
    @Property.define("line.end", "common.type", "icon-line")
    get isContinue() {
        return this._isContinue;
    }
    set isContinue(value: boolean) {
        this.setProperty("isContinue", value);
    }

    create(document: IDocument): GeometryModel {
        let body = new LineBody(document, this.stepDatas[0].point, this.stepDatas[1].point);
        return new GeometryModel(document, `Line ${Line.count++}`, body);
    }

    getSteps(): IStep[] {
        let firstStep = new PointStep("operate.pickFistPoint");
        let secondStep = new PointStep("operate.pickNextPoint", this.getSecondPointData);
        return [firstStep, secondStep];
    }

    private getSecondPointData = (): SnapPointData => {
        let preview = this._isLine ? this.linePreview : this.xlinePreview;
        return {
            refPoint: this.stepDatas[0].point,
            dimension: Dimension.D1D2D3,
            validator: (point: XYZ) => {
                return this.stepDatas[0].point.distanceTo(point) > Precision.Length;
            },
            preview,
        };
    };

    private linePreview = (point: XYZ) => {
        return [Application.instance.shapeFactory.line(this.stepDatas[0].point, point).value?.mesh.edges!];
    };

    private xlinePreview = (point: XYZ) => {
        let line = this.createXline(point);
        return [line?.mesh.edges!];
    };

    private createXline(point: XYZ) {
        let vector = point.sub(this.stepDatas[0].point).normalize()!.multiply(1e6);
        let start = this.stepDatas[0].point.sub(vector);
        let end = this.stepDatas[0].point.add(vector);
        return Application.instance.shapeFactory.line(start, end).value;
    }
}
