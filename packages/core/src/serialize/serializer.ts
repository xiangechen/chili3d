// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "../document";
import { Observable } from "../foundation/observer";

export type PropertyInfo = {
    name: string;
    readonly?: boolean;
};

export const InternalClassName = "__cla$$__";

export type SerializedData = { [x: string]: any };

export type Serialized = { [InternalClassName]: string } & SerializedData;

export interface RefelectData {
    ctor: new (...args: any[]) => any;
    serialize?: (target: any) => SerializedData;
    deserialize?: (...args: any[]) => any;
}

export function registerReflect(data: RefelectData, name?: string) {
    const actualName = name ?? data.ctor.name;
    if (reflectMap.has(actualName)) {
        console.warn(`Class ${actualName} already registered, skip.`);
        return;
    }

    reflectMap.set(actualName, data);
}

export function registerTypeArray(
    TypeArray: new (array: number[]) => Float32Array | Uint32Array,
): RefelectData {
    return {
        ctor: TypeArray,
        serialize: (target: Float16Array | Uint32Array) => {
            return {
                buffer: Array.from(target),
            };
        },
        deserialize: (buffer) => {
            return new TypeArray(buffer);
        },
    };
}

const propertiesMap = new Map<new (...args: any[]) => any, Array<PropertyInfo>>();
const reflectMap = new Map<string, RefelectData>();
reflectMap.set("Float32Array", registerTypeArray(Float32Array));
reflectMap.set("Uint32Array", registerTypeArray(Uint32Array));

export function serializable<T>(options?: {
    deserialize?: (...args: any[]) => T;
    serialize?: (target: T) => SerializedData;
}) {
    return (target: new (options: any) => T) => {
        registerReflect({
            ctor: target,
            ...options,
        });
    };
}

/**
 * Set the property to be serialized
 *
 * @param options additional options, if property is readonly, the readonly option should be set to true. e.g. `@serialze({ readonly: true })`
 * @returns
 */
export function serialize(options?: Omit<PropertyInfo, "name">) {
    return (target: any, property: string) => {
        let props = propertiesMap.get(target);
        if (props === undefined) {
            props = [];
            propertiesMap.set(target, props);
        }
        props.push({
            name: property,
            ...options,
        });
    };
}

export class Serializer {
    /**
     * Deserialize an object
     *
     * @param document Document that contains the object.
     * @param data Serialize the data. If the serialized data does not contain
     * the parameters required by the deserialization function, these parameters
     * should be added to the serialized data, for example:
     * ```
     * data.properties[“parent”] = node.
     * ```
     * @returns Deserialized object
     */
    public static deserializeObject(document: IDocument, data: Serialized) {
        const instance = Serializer.deserializeInstance(document, data);
        Serializer.deserializeProperties(document, instance, data);
        return instance;
    }

    static deserializeInstance(document: IDocument, data: Serialized) {
        const className = data[InternalClassName];
        if (!className) {
            console.warn(`${data} cannot be deserialize.`);
            return data;
        }

        if (!reflectMap.has(data[InternalClassName])) {
            throw new Error(
                `${data[InternalClassName]} cannot be deserialize. Did you forget to add the decorator @Serializer.register?`,
            );
        }

        const { ctor, deserialize } = reflectMap.get(className)!;
        const parameters = Serializer.deserilizeParameters(document, ctor.prototype, data);
        if (deserialize) {
            return deserialize(parameters);
        }
        return new ctor(parameters);
    }

    static deserilizeParameters(document: IDocument, prototype: any, data: Serialized) {
        const parameters: Record<string, any> = { document };

        const props = propertiesMap.get(prototype) ?? [];
        for (const prop of props) {
            if (prop.readonly) {
                parameters[prop.name] = Serializer.deserialValue(document, data[prop.name]);
            }
        }
        return parameters;
    }

    static deserialValue(document: IDocument, value: any) {
        if (value === null || value === undefined) {
            return undefined;
        }
        if (Array.isArray(value)) {
            return value.map((v) => {
                if (v === null || v === undefined) {
                    return undefined;
                }
                return typeof v === "object" ? Serializer.deserializeObject(document, v) : v;
            });
        }
        return (value as Serialized)[InternalClassName]
            ? Serializer.deserializeObject(document, value)
            : value;
    }

    static deserializeProperties(document: IDocument, instance: any, data: Serialized) {
        const readonlyProps = new Set(
            propertiesMap
                .get(Object.getPrototypeOf(instance))
                ?.filter((x) => x.readonly)
                .map((x) => x.name),
        );

        const keys = Object.keys(data).filter((x) => !readonlyProps.has(x));
        for (const key of keys) {
            if (instance instanceof Observable) {
                instance.setPrivateValue(
                    key as keyof Observable,
                    Serializer.deserialValue(document, data[key]),
                );
            } else {
                instance[key] = Serializer.deserialValue(document, data[key]);
            }
        }
    }

    static serializeObject(target: object): Serialized {
        const className = target.constructor.name;
        if (!reflectMap.has(className)) {
            console.log(target);

            throw new Error(
                `Type ${target.constructor.name} is not registered, please add the @Serializer.register decorator.`,
            );
        }
        const data = reflectMap.get(className)!;
        const properties = data.serialize?.(target) ?? Serializer.serializeProperties(target);
        return {
            ...properties,
            [InternalClassName]: className,
        };
    }

    static serializeProperties(target: object) {
        const data: Record<string, any> = {};

        const props = Serializer.getAllKeysOfPrototypeChain(target, propertiesMap);
        for (const prop of props) {
            const value = (target as any)[prop.name];
            if (Array.isArray(value)) {
                data[prop.name] = value.map((v) => Serializer.serializePropertyValue(v));
            } else {
                data[prop.name] = Serializer.serializePropertyValue(value);
            }
        }
        return data;
    }

    private static serializePropertyValue(value: any) {
        const type = typeof value;
        if (type === "object") {
            return Serializer.serializeObject(value);
        }
        if (type !== "function" && type !== "symbol") {
            return value;
        }
        throw new Error(`Unsupported serialized object: ${value}`);
    }

    private static getAllKeysOfPrototypeChain(
        target: object,
        map: Map<new (...args: any[]) => any, Array<PropertyInfo>>,
    ) {
        const keys: PropertyInfo[] = [];
        let prototype = Object.getPrototypeOf(target);
        while (prototype !== null) {
            const k = map.get(prototype);
            if (k) keys.push(...k.values());
            prototype = Object.getPrototypeOf(prototype); // prototype chain
        }
        return new Set(keys);
    }
}
