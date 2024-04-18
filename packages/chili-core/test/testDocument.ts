// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { History, INodeChangedObserver, NodeLinkedListHistoryRecord, NodeRecord, Transaction } from "../src";

export class TestDocument {
    history = new History();
    notifyNodeChanged(records: NodeRecord[]) {
        Transaction.add(this, this.history, new NodeLinkedListHistoryRecord(records));
    }
    addNodeObserver(observer: INodeChangedObserver) {}
}
