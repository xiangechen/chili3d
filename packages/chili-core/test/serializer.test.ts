// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { History, IDocument, ISerialize, NodeLinkedList, Serialized, Serializer } from "../src";

class TestObject implements ISerialize {
    protected k2: string = "k2";
    public k3: string = "k3";

    @Serializer.property("constructor")
    private k1: string;
    @Serializer.property()
    private k4: string = "k4";
    @Serializer.property()
    protected k5: string = "k5";
    @Serializer.property()
    public k6: string = "k6";

    constructor(k1: string) {
        this.k1 = k1;
    }

    serialize(): Serialized {
        return Serializer.serialize(this);
    }

    @Serializer.deserializer()
    static from({ k1 }: { k1: string }) {
        return new TestObject(k1);
    }
}

test("test Serializer", () => {
    let obj = new TestObject("111");
    let s = obj.serialize();
    expect("k1" in s.properties).toBeFalsy();
    expect("k4" in s.properties).toBeTruthy();
    expect("k5" in s.properties).toBeTruthy();
    expect("k6" in s.properties).toBeTruthy();
    s.constructorParameters["k1"] = "222";
    let obj2 = Serializer.deserialize({} as any, s);
    expect(obj2.k1).toBe("222");
});

test("test Node Serializer", () => {
    let doc: IDocument = { history: new History() } as any;
    let n1 = new NodeLinkedList(doc, "n1");
    let n2 = new NodeLinkedList(doc, "n2");
    let n3 = new NodeLinkedList(doc, "n3");
    let n4 = new NodeLinkedList(doc, "n4");
    n1.add(n2, n3);
    n2.add(n4);
    let s = n1.serialize();
    let n11 = Serializer.deserialize(doc, s);
    expect(n11.firstChild.name).toBe("n2");
    expect(n11.firstChild.nextSibling.name).toBe("n3");
    expect(n11.firstChild.firstChild.name).toBe("n4");
});
