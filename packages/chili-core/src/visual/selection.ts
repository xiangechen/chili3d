// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { INode } from "../model";

export interface ISelection {
    getSelectedNodes(): INode[];
    setSelected(toggle: boolean, models: INode[]): void;
    clearSelected(): void;
    unSelected(models: INode[]): void;
}
