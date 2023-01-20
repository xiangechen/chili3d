// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument } from "./document";

export interface ICommand {
    excute(document: IDocument): Promise<boolean>;
}
