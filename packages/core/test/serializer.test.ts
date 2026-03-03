// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    FolderNode,
    type IDocument,
    NodeUtils,
    type Serialized,
    Serializer,
    serializable,
    serialze,
} from "../src";
import { TestDocument } from "./testDocument";

@serializable(["k1" as any])
class TestObject {
    protected k2: string = "k2";
    public k3: string = "k3";

    @serialze()
    private k1: string;
    @serialze()
    private k4: string = "k4";
    @serialze()
    protected k5: string = "k5";
    @serialze()
    public k6: string = "k6";

    constructor(k1: string) {
        this.k1 = k1;
    }

    serialize(): Serialized {
        return Serializer.serializeObject(this);
    }
}

test("test Serializer", () => {
    const obj = new TestObject("111");
    const s = obj.serialize();
    expect("k1" in s.properties).toBeTruthy();
    expect("k4" in s.properties).toBeTruthy();
    expect("k5" in s.properties).toBeTruthy();
    expect("k6" in s.properties).toBeTruthy();
    s.properties["k1"] = "222";
    const obj2 = Serializer.deserializeObject({} as any, s);
    expect(obj2.k1).toBe("222");
});

test("test Node Serializer", () => {
    const doc: IDocument = new TestDocument() as any;

    const n1 = new FolderNode(doc, "n1");
    const n2 = new FolderNode(doc, "n2");
    const n3 = new FolderNode(doc, "n3");
    const n4 = new FolderNode(doc, "n4");
    n1.add(n2, n3);
    n2.add(n4);
    const s = NodeUtils.serializeNode(n1);

    NodeUtils.deserializeNode(doc, s).then((n11: any) => {
        expect(n11.firstChild.name).toBe("n2");
        expect(n11.firstChild.nextSibling.name).toBe("n3");
        expect(n11.firstChild.firstChild.name).toBe("n4");
    });
});
