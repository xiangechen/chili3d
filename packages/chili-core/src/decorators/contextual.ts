// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { ICommand } from "../command";

export class ContextualControl {
    constructor(readonly header: string, readonly id: string, readonly tip?: string) {}
}

export class ContextualInputControl extends ContextualControl {}

export class ContextualCheckControl extends ContextualControl {}

export class ContextualComboControl extends ContextualControl {
    constructor(header: string, id: string, readonly items: string[], tip?: string) {
        super(header, id, tip);
    }
}

export namespace ContextualControl {
    export function get(command: ICommand): ContextualControl[] | undefined {
        return Object.getPrototypeOf(command).contextual;
    }
}

export function contextual<T extends { new (...args: any[]): ICommand }>(controls: ContextualControl[]) {
    return (ctor: T) => {
        ctor.prototype.contextual = controls;
    };
}
