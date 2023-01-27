// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { I18n, IDocument } from "chili-core";

export interface IStep<T> {
    perform(document: IDocument, tip: keyof I18n): Promise<T | undefined>;
}
