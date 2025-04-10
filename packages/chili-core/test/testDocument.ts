// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import {
    History,
    IDocument,
    INodeChangedObserver,
    NodeLinkedListHistoryRecord,
    NodeRecord,
    Transaction,
} from "../src";

export class TestDocument {
    history = new History();
    notifyNodeChanged(records: NodeRecord[]) {
        Transaction.add(this as unknown as IDocument, new NodeLinkedListHistoryRecord(records));
    }
    addNodeObserver(observer: INodeChangedObserver) {}
}
