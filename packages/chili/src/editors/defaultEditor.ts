// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Snapper } from "../snap";
import { EditorEventHandler, FeaturePoint } from "./eventHandler";

export class DefaultEditorEventHandler extends EditorEventHandler {
    protected getSnapper(point: FeaturePoint): Snapper | undefined {
        return undefined;
    }

    featurePoints(): FeaturePoint[] {
        return [];
    }
}
