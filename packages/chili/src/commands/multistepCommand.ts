// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { AsyncController, IApplication, ICanclableCommand, Observable, Property, PubSub } from "chili-core";
import { SnapedData } from "../snap";
import { IStep } from "../step";

const PropertiesCache: Map<string, any> = new Map(); // 所有命令共享

export abstract class MultistepCommand extends Observable implements ICanclableCommand {
    #complete: boolean = false;
    protected stepDatas: SnapedData[] = [];

    #application: IApplication | undefined;
    get application() {
        if (!this.#application) {
            throw new Error("application is not set");
        }
        return this.#application;
    }

    get document() {
        return this.#application!.activeDocument!;
    }

    protected _restarting: boolean = false;
    protected get restarting() {
        return this._restarting;
    }

    protected _controller?: AsyncController;
    protected get controller() {
        return this._controller;
    }
    protected set controller(value: AsyncController | undefined) {
        if (this._controller === value) return;
        this._controller?.dispose();
        this._controller = value;
    }

    protected restart() {
        this._restarting = true;
        this.controller?.cancel();
    }

    @Property.define("common.cancel")
    async cancel() {
        this.controller?.cancel();
        await new Promise(async (resolve) => {
            while (true) {
                if (this.#complete) {
                    break;
                }
                await new Promise((r) => setTimeout(r, 50));
            }
            resolve(true);
        });
    }

    private _repeatOperation: boolean = false;
    @Property.define("command.mode.repeat")
    get repeatOperation() {
        return this._repeatOperation;
    }

    set repeatOperation(value: boolean) {
        this.setProperty("repeatOperation", value);
    }

    async execute(application: IApplication): Promise<void> {
        if (!application.activeDocument) return;
        this.#application = application;
        try {
            let canExcute = await this.beforeExecute();
            if (canExcute) {
                await this.executeSteps();
            }
        } finally {
            await this.afterExecute();
        }
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

    protected beforeExecute(): Promise<boolean> {
        this.readProperties();
        PubSub.default.pub("openCommandContext", this);
        return Promise.resolve(true);
    }

    protected afterExecute(): Promise<void> {
        this.saveProperties();
        PubSub.default.pub("closeCommandContext");
        this.controller?.dispose();
        this.#complete = true;
        return Promise.resolve();
    }

    private readProperties() {
        Property.getProperties(this).forEach((x) => {
            let key = this.cacheKeyOfProperty(x);
            if (PropertiesCache.has(key)) {
                (this as any)[key] = PropertiesCache.get(key);
            }
        });
    }

    private saveProperties() {
        Property.getProperties(this).forEach((x) => {
            let key = this.cacheKeyOfProperty(x);
            let prop = (this as any)[key];
            if (typeof prop === "function") return;
            PropertiesCache.set(key, prop);
        });
    }

    private cacheKeyOfProperty(property: Property) {
        return property.name;
    }
}
