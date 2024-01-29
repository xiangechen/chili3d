// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { AsyncController, CancelableCommand, Property } from "chili-core";
import { SnapedData } from "../snap";
import { IStep } from "../step";

export abstract class MultistepCommand extends CancelableCommand {
    protected stepDatas: SnapedData[] = [];

    protected _restarting: boolean = false;
    protected get restarting() {
        return this._restarting;
    }

    protected restart() {
        this._restarting = true;
        this.controller?.cancel();
    }

    private _repeatOperation: boolean = false;
    @Property.define("command.mode.repeat")
    get repeatOperation() {
        return this._repeatOperation;
    }

    set repeatOperation(value: boolean) {
        this.setProperty("repeatOperation", value);
    }

    protected async executeAsync(): Promise<void> {
        await this.executeSteps();
    }

    protected async executeSteps(): Promise<void> {
        let steps = this.getSteps();
        while (this.stepDatas.length < steps.length) {
            this.controller = new AsyncController();
            let data = await steps[this.stepDatas.length].execute(this.document, this.controller);
            if (this._restarting) {
                this._restarting = false;
                this.stepDatas.length = 0;
                continue;
            }
            if (data === undefined || this.controller.result?.status !== "success") {
                break;
            }
            this.stepDatas.push(data);
            if (this.stepDatas.length === steps.length) {
                this.executeMainTask();
                if (this._repeatOperation) {
                    this.setRepeatDatas();
                }
            }
        }
    }

    protected setRepeatDatas() {
        this.stepDatas.length = 0;
    }

    protected abstract getSteps(): IStep[];

    protected abstract executeMainTask(): void;
}
