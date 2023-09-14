// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { AsyncController, IApplication, ICommand, Observable, Property, PubSub } from "chili-core";
import { SnapedData } from "../snap";
import { IStep } from "../step";

const PropertiesCache: Map<string, any> = new Map(); // 所有命令共享

export abstract class MultistepCommand extends Observable implements ICommand {
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
    cancel() {
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

    async execute(application: IApplication): Promise<void> {
        if (!application.activeDocument) return;
        this.#application = application;
        await this.executeFromStep(0);
    }

    protected async executeFromStep(stepIndex: number): Promise<void> {
        if (this._restarting) {
            this._restarting = false;
        }
        let isSuccess = false;
        try {
            if ((await this.beforeExecute()) && (await this.executeSteps(stepIndex))) {
                this.executeMainTask();
                isSuccess = true;
            }
        } finally {
            await this.afterExecute();
        }

        if (this._restarting) {
            await this.executeFromStep(0);
        } else if (this.repeatOperation && isSuccess) {
            await this.repeatCommand();
        }
    }

    protected async repeatCommand() {
        await this.executeFromStep(0);
    }

    protected async executeSteps(startIndex: number): Promise<boolean> {
        this.stepDatas.length = startIndex;
        let steps = this.getSteps();
        for (let i = startIndex; i < steps.length; i++) {
            this.controller = new AsyncController();
            let data = await steps[i].execute(this.document, this.controller);
            if (this._restarting || data === undefined) {
                return false;
            }
            this.stepDatas.push(data);
        }
        return true;
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
