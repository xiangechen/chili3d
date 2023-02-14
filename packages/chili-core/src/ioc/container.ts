// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { container as tsContainer, DependencyContainer as TsDependencyContainer, Lifecycle } from "tsyringe";

import { Token } from "../decorators/token";
import { IRegister, IResolve } from "./";

export class Container implements IRegister, IResolve {
    private container: TsDependencyContainer;

    constructor() {
        this.container = tsContainer.createChildContainer();
    }

    createResolve(): IResolve {
        return this;
    }

    register<T>(token: Token, ctor: new (...args: any[]) => T): void {
        this.container.register<T>(token.token, {
            useClass: ctor,
        });
    }

    registerSingleton<T>(token: Token, ctor: new (...args: any[]) => T): void {
        this.container.register<T>(
            token.token,
            {
                useClass: ctor,
            },
            {
                lifecycle: Lifecycle.Singleton,
            }
        );
    }

    resolve<T>(token: Token): T | undefined {
        if (!this.container.isRegistered<T>(token.token)) return undefined;
        return this.container.resolve<T>(token.token);
    }
}
