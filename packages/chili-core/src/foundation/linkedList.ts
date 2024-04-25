// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

interface LinkedListNode<T> {
    data: T;
    next?: LinkedListNode<T>;
    prev?: LinkedListNode<T>;
}

export class LinkedList<T> {
    private _head: LinkedListNode<T> | undefined;
    get head() {
        return this._head?.data;
    }

    private _tail: LinkedListNode<T> | undefined;
    get tail() {
        return this._tail?.data;
    }

    private _size: number = 0;
    get size() {
        return this._size;
    }

    push(...items: T[]) {
        items.forEach((item) => {
            const node: LinkedListNode<T> = { data: item };
            if (this._head === undefined) {
                this._head = node;
            } else {
                this._tail!.next = node;
                node.prev = this._tail;
            }
            this._tail = node;
            this._size++;
        });
    }

    insert(index: number, item: T) {
        let node = this.nodeAt(index);
        if (!node) return;

        const newNode: LinkedListNode<T> = {
            data: item,
            next: node,
            prev: node.prev,
        };
        if (node.prev) {
            node.prev.next = newNode;
        } else {
            this._head = newNode;
        }
        node.prev = newNode;
        this._size++;
    }

    remove(item: T) {
        let current = this._head;
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
            this._head = node.next;
        }
        if (node.next) {
            node.next.prev = node.prev;
        } else {
            this._tail = node.prev;
        }
        this._size--;
    }

    private nodeAt(index: number) {
        if (index < 0 || index >= this._size) {
            return undefined;
        }
        if (index === this._size - 1) return this._tail;
        let [current, currentIndex] = [this._head, 0];
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
        this._head = undefined;
        this._tail = undefined;
        this._size = 0;
    }

    reverse() {
        let currentNode = this._head;
        while (currentNode) {
            const next = currentNode.next;
            currentNode.next = currentNode.prev;
            currentNode.prev = next;
            currentNode = currentNode.prev;
        }
        const tail = this._tail;
        this._tail = this._head;
        this._head = tail;
    }

    *[Symbol.iterator](): IterableIterator<T> {
        let current = this._head;
        while (current) {
            yield current.data;
            current = current.next;
        }
    }
}
