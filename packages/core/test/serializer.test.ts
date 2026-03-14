// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    FolderNode,
    type IDocument,
    NodeUtils,
    type Serialized,
    Serializer,
    serializable,
    serialize,
} from "../src";
import { TestDocument } from "./testDocument";

interface TestObjectOptions {
    k1: string;
}

@serializable()
class TestObject {
    protected k2: string = "k2";
    public k3: string = "k3";

    @serialize()
    private k1: string;
    @serialize()
    private k4: string = "k4";
    @serialize()
    protected k5: string = "k5";
    @serialize()
    public k6: string = "k6";

    constructor(options: TestObjectOptions) {
        this.k1 = options.k1;
    }

    serialize(): Serialized {
        return Serializer.serializeObject(this);
    }
}

test("test Serializer", () => {
    const obj = new TestObject({ k1: "111" });
    const s = obj.serialize();
    expect("k1" in s).toBeTruthy();
    expect("k4" in s).toBeTruthy();
    expect("k5" in s).toBeTruthy();
    expect("k6" in s).toBeTruthy();
    s["k1"] = "222";
    const obj2 = Serializer.deserializeObject({} as any, s);
    expect(obj2.k1).toBe("222");
});

test("test Node Serializer", () => {
    const doc: IDocument = new TestDocument() as any;

    const n1 = new FolderNode({ document: doc, name: "n1" });
    const n2 = new FolderNode({ document: doc, name: "n2" });
    const n3 = new FolderNode({ document: doc, name: "n3" });
    const n4 = new FolderNode({ document: doc, name: "n4" });
    n1.add(n2, n3);
    n2.add(n4);
    const s = NodeUtils.serializeNode(n1);

    NodeUtils.deserializeNode(doc, s).then((n11: any) => {
        expect(n11.firstChild.name).toBe("n2");
        expect(n11.firstChild.nextSibling.name).toBe("n3");
        expect(n11.firstChild.firstChild.name).toBe("n4");
    });
});
