/**
 * AX — DOM annotation layer for agent interfaces
 *
 * Type declarations for the AX library.
 */

/** Primitive kind — built-in or custom (e.g. "ext:rating") */
export type AxFnKind = "click" | "view" | "edit" | "nav" | string;

export interface AxConfig {
    allowEval: boolean;
}

export interface AxHookSet {
    before?: string | undefined;
    on?: string | undefined;
    after?: string | undefined;
}

/** Function descriptor in the compiled DAG */
export interface AxFnEntry {
    on: AxFnKind;
    name: string;
    args?: Record<string, string> | undefined;
}

/** Serialized node in scan output */
export interface AxNode {
    id: string;
    parent: string | null;
    children: string[];
    fn: AxFnEntry[];
}

export interface AxScan {
    version: number;
    generatedAt: number;
    dag: Record<string, string[]>;
    nodes: AxNode[];
}

export interface AxInvokeResult {
    ok: boolean;
    canceled?: boolean | undefined;
    result?: any;
    error?: string | undefined;
}

export interface AxInvokeContext {
    phase: "before" | "on" | "after";
    action: string;
    scope: string | undefined;
    el: Element;
    args: any;
    scan: AxScan | null;
    fnEntry: AxFnEntry | undefined;
    hooks: AxHookSet;
    canceled: boolean;
    result: any;
    error?: string | undefined;
}

export interface AxExtensionApi {
    definePrimitive(attr: string, def: { kind: AxFnKind }): void;
    getScan(): AxScan | null;
}

export interface AxExtension {
    init?(api: AxExtensionApi): void;
    onScanStart?(ctx: { root: Element; scan: AxScan }): void;
    onNode?(ctx: { node: AxNode; element: Element; scan: AxScan }): void;
    onScanEnd?(ctx: { root: Element; scan: AxScan }): void;
    beforeAction?(ctx: AxInvokeContext): void;
    onInvoke?(ctx: AxInvokeContext): any;
    afterAction?(ctx: AxInvokeContext): void;
}

export interface Ax {
    config: AxConfig;

    scan(root?: Element): AxScan;
    process(root?: Element): AxScan;
    invoke(scope: string | undefined, el: Element, action: string, args?: any): AxInvokeResult;
    invoke(el: Element, action: string, args?: any): AxInvokeResult;
    getNodeId(el: Element): string | null;
    watch(callback?: (mutations: MutationRecord[]) => void): MutationObserver;
    unwatch(): void;

    defineExtension(name: string, ext: AxExtension): void;
    removeExtension(name: string): void;
    definePrimitive(attr: string, def: { kind: AxFnKind }): void;
}

declare const ax: Ax;
export default ax;
