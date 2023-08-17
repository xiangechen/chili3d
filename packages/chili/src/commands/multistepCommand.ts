// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { AsyncState, IApplication, ICommand, Observable, Property, PubSub } from "chili-core";
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

    private _restarting: boolean = false;
    protected get restarting() {
        return this._restarting;
    }

    private _token?: AsyncState;
    protected get token() {
        return this._token;
    }
    protected set token(value: AsyncState | undefined) {
        if (this._token === value) return;
        this._token?.dispose();
        this._token = value;
    }

    protected restart() {
        this._restarting = true;
        this.token?.cancel();
    }

    @Property.define("common.cancel", "common.mode", "icon-cancel")
    cancel() {
        this.token?.cancel();
    }

    private _repeatOperation: boolean = false;
    @Property.define("common.repeat", "common.mode", "icon-rotate")
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
        let isCancel = false;
        try {
            if ((await this.beforeExecute()) && (await this.executeSteps(stepIndex))) {
                this.executeMainTask();
            } else {
                isCancel = true;
            }
        } finally {
            await this.afterExecute();
        }
        if (this._restarting || (this.repeatOperation && !isCancel)) {
            await this.executeFromStep(0);
        }
    }

    private async executeSteps(startIndex: number): Promise<boolean> {
        this.stepDatas.length = startIndex;
        let steps = this.getSteps();
        for (let i = startIndex; i < steps.length; i++) {
            this.token = new AsyncState();
            let data = await steps[i].execute(this.document, this.token);
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
        PubSub.default.pub("openContextTab", this);
        return Promise.resolve(true);
    }

    protected afterExecute(): Promise<void> {
        this.saveProperties();
        PubSub.default.pub("closeContextTab");
        this.token?.dispose();
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
