// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument } from "./document";
import { VisualNode } from "./model";

export interface IDataExchange {
    importFormats(): string[];
    exportFormats(): string[];
    import(document: IDocument, files: FileList | File[]): Promise<void>;
    export(type: string, nodes: VisualNode[]): Promise<BlobPart[] | undefined>;
}
