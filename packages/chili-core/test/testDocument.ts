// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

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
