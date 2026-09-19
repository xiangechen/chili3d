// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@chili3d/core";
import { createMockDocument } from "@chili3d/core/test-utils";
import {
    conversationTitle,
    newConversation,
    readConversations,
    type StoredConversation,
    writeConversations,
} from "../src/history";

function documentHolding(conversations: StoredConversation[]): IDocument {
    const document = createMockDocument();
    writeConversations(document, conversations);
    return document;
}

describe("conversation history storage", () => {
    test("round-trips through the document's own userData", () => {
        const document = createMockDocument();
        const conversations = [newConversation()];

        writeConversations(document, conversations);

        expect(readConversations(document)).toEqual(conversations);
    });

    test("keeps each document's history apart", () => {
        const first = newConversation();
        const second = newConversation();

        const documentA = documentHolding([first]);
        const documentB = documentHolding([second]);

        expect(readConversations(documentA).map((c) => c.id)).toEqual([first.id]);
        expect(readConversations(documentB).map((c) => c.id)).toEqual([second.id]);
    });

    test("reads back an empty list for a document that never chatted", () => {
        expect(readConversations(createMockDocument())).toEqual([]);
    });

    test("ignores a stored value that is not a list", () => {
        const document = createMockDocument();
        document.userData!["chats"] = { not: "a list" };

        expect(readConversations(document)).toEqual([]);
    });

    test("creates an empty, uniquely identified conversation", () => {
        const first = newConversation();
        const second = newConversation();

        expect(first.messages).toEqual([]);
        expect(first.title).toBe("");
        expect(first.id).not.toBe(second.id);
    });
});

describe("conversationTitle", () => {
    test("collapses the opening message to its first line, clipped", () => {
        expect(conversationTitle("  make a box\nand then a lid ")).toBe("make a box and then a lid");
        expect(conversationTitle("建一个盒子".repeat(20))).toBe(`${"建一个盒子".repeat(20).slice(0, 39)}…`);
        expect(conversationTitle("建一个盒子".repeat(20)).length).toBe(40);
    });

    test("is empty when the message carried no text", () => {
        expect(conversationTitle("   \n ")).toBe("");
    });
});
