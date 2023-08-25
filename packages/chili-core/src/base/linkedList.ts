// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

interface LinkedListNode<T> {
    data: T;
    next?: LinkedListNode<T>;
    prev?: LinkedListNode<T>;
}

export class LinkedList<T> {
    #head: LinkedListNode<T> | undefined;
    get head() {
        return this.#head?.data;
    }

    #tail: LinkedListNode<T> | undefined;
    get tail() {
        return this.#tail?.data;
    }

    #size: number = 0;
    get size() {
        return this.#size;
    }

    push(...items: T[]) {
        items.forEach((item) => {
            const node: LinkedListNode<T> = { data: item };
            if (this.#head === undefined) {
                this.#head = node;
            } else {
                this.#tail!.next = node;
                node.prev = this.#tail;
            }
            this.#tail = node;
            this.#size++;
        });
    }

    insert(index: number, item: T) {
        let node = this.nodeAt(index);
        if (node) {
            const newNode: LinkedListNode<T> = {
                data: item,
                next: node,
                prev: node.prev,
            };
            if (node.prev) {
                node.prev.next = newNode;
            } else {
                this.#head = newNode;
            }
            node.prev = newNode;
            this.#size++;
        }
    }

    remove(item: T) {
        let current = this.#head;
        while (current) {
            if (current.data === item) {
                this.removeNode(current);
                break;
            }
            current = current.next;
        }
    }

    removeAt(index: number) {
        let node = this.nodeAt(index);
        if (node) this.removeNode(node);
    }

    private removeNode(node: LinkedListNode<T>) {
        if (node.prev) {
            node.prev.next = node.next;
        } else {
            this.#head = node.next;
        }
        if (node.next) {
            node.next.prev = node.prev;
        } else {
            this.#tail = node.prev;
        }
        this.#size--;
        return;
    }

    private nodeAt(index: number) {
        if (index < 0 || index >= this.#size) {
            return undefined;
        }
        if (index === this.#size - 1) return this.#tail;
        let [current, currentIndex] = [this.#head, 0];
        while (current) {
            if (currentIndex === index) {
                break;
            }
            current = current.next;
            currentIndex++;
        }
        return current;
    }

    clear() {
        this.#head = undefined;
        this.#tail = undefined;
        this.#size = 0;
    }

    reverse() {
        let currentNode = this.#head;
        while (currentNode) {
            const next = currentNode.next;
            currentNode.next = currentNode.prev;
            currentNode.prev = next;
            currentNode = currentNode.prev;
        }
        const tail = this.#tail;
        this.#tail = this.#head;
        this.#head = tail;
    }

    *[Symbol.iterator](): IterableIterator<T> {
        let current = this.#head;
        while (current) {
            yield current.data;
            current = current.next;
        }
    }
}
