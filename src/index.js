/**
 * AX - semantic annotation schema for HTML.
 * Single-file implementation with JSDoc typing.
 */

/** @typedef {{ name: string, defaultTemplate: string }} PrimitiveDef */
/** @typedef {{ name: string, element: Element, primitives?: Record<string, any> }} ScopeEntry */

/** @type {Set<string>} */
const BUILTIN_TEMPLATES = new Set(["view", "item", "skill", "field"]);

/** @type {Map<string, (e: any) => any>} */
const templates = new Map();

/** @type {Map<string, PrimitiveDef>} */
const primitives = new Map([
    ["ax-view", { name: "ax-view", defaultTemplate: "view" }],
    ["ax-click", { name: "ax-click", defaultTemplate: "skill" }],
    ["ax-edit", { name: "ax-edit", defaultTemplate: "skill" }],
    ["ax-nav", { name: "ax-nav", defaultTemplate: "skill" }],
]);

/** @type {Map<string, ScopeEntry>} */
const scopes = new Map();

/**
 * @param {Element} el
 * @param {string} name
 * @returns {string | null}
 */
function getAttr(el, name) {
    if (el.hasAttribute(name)) return el.getAttribute(name);
    const dataName = `data-${name}`;
    if (el.hasAttribute(dataName)) return el.getAttribute(dataName);
    return null;
}

/**
 * @param {Element} el
 * @param {string} name
 * @returns {boolean}
 */
function hasAttr(el, name) {
    return el.hasAttribute(name) || el.hasAttribute(`data-${name}`);
}

/**
 * @param {Element} el
 * @returns {boolean}
 */
function isIgnored(el) {
    if (!el || !(el instanceof Element)) return false;
    // Check the element and all ancestors for ax-ignore
    let current = /** @type {Element | null} */ (el);
    while (current) {
        if (hasAttr(current, "ax-ignore")) return true;
        current = current.parentElement;
    }
    return false;
}

/**
 * @param {Element} el
 * @returns {string | undefined}
 */
function inferInputType(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "textarea") return "textarea";
    if (tag === "select") return "select";
    if (tag === "input") {
        const type = (el.getAttribute("type") || "text").toLowerCase();
        return type;
    }
    return undefined;
}

/**
 * @param {Element} el
 * @returns {{ primitive?: string, name?: string }[]}
 */
function readPrimitives(el) {
    /** @type {{ primitive?: string, name?: string }[]} */
    const found = [];
    const view = getAttr(el, "ax-view");
    const click = getAttr(el, "ax-click");
    const edit = getAttr(el, "ax-edit");
    const nav = getAttr(el, "ax-nav");

    if (view !== null) found.push({ primitive: "ax-view", name: view });
    if (click !== null) found.push({ primitive: "ax-click", name: click });
    if (edit !== null) found.push({ primitive: "ax-edit", name: edit });
    if (nav !== null) found.push({ primitive: "ax-nav", name: nav });

    return found;
}

/**
 * @param {Element} el
 * @param {string} primitive
 * @returns {{ before?: string, on?: string, after?: string }}
 */
function readHooks(el, primitive) {
    const suffix = primitive.replace("ax-", "");
    const cap = suffix.charAt(0).toUpperCase() + suffix.slice(1);
    const before = getAttr(el, `ax-before${cap}`);
    const on = getAttr(el, `ax-on${cap}`);
    const after = getAttr(el, `ax-after${cap}`);
    return {
        before: before !== null ? before : undefined,
        on: on !== null ? on : undefined,
        after: after !== null ? after : undefined,
    };
}

/**
 * @param {Element} el
 * @returns {{ status?: string, reason?: string }}
 */
function readStatus(el) {
    const disabled =
        "disabled" in el
            ? /** @type {HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement} */ (
                  el
              ).disabled
            : el.hasAttribute("disabled");

    if (disabled) return { status: "disabled" };

    const ariaDisabled = el.getAttribute("aria-disabled");
    if (ariaDisabled === "true") return { status: "disabled" };

    const busy = el.getAttribute("aria-busy");
    if (busy === "true") return { status: "loading" };

    if ("checkValidity" in el && typeof el.checkValidity === "function") {
        try {
            const valid = /** @type {HTMLInputElement} */ (el).checkValidity();
            if (!valid) return { status: "blocked", reason: "invalid" };
        } catch {
            // ignore validation failures in non-form contexts
        }
    }

    return {};
}

/**
 * @param {{ primitive?: string, name?: string }[]} list
 */
function assertPrimitiveValues(list) {
    for (const entry of list) {
        if (!entry.primitive) continue;
        if (entry.name === "" || entry.name == null) {
            throw new Error(`${entry.primitive} requires a value`);
        }
    }
}

/**
 * @param {Element} el
 * @returns {string | undefined}
 */
function primaryPrimitive(el) {
    const data = /** @type {any} */ (el)["__ax__internal"];
    if (data && data.primitive) return data.primitive;
    if (hasAttr(el, "ax-view")) return "ax-view";
    if (hasAttr(el, "ax-edit")) return "ax-edit";
    if (hasAttr(el, "ax-click")) return "ax-click";
    if (hasAttr(el, "ax-nav")) return "ax-nav";
    return undefined;
}

/**
 * @param {Element} el
 * @returns {string | undefined}
 */
function primitiveName(el) {
    const data = /** @type {any} */ (el)["__ax__internal"];
    if (data && data.name) return data.name;
    if (hasAttr(el, "ax-view")) return getAttr(el, "ax-view") || undefined;
    if (hasAttr(el, "ax-edit")) return getAttr(el, "ax-edit") || undefined;
    if (hasAttr(el, "ax-click")) return getAttr(el, "ax-click") || undefined;
    if (hasAttr(el, "ax-nav")) return getAttr(el, "ax-nav") || undefined;
    return undefined;
}

/**
 * @param {Element} el
 * @param {string} primitive
 * @param {string | undefined} name
 * @returns {boolean}
 */
function acceptsFor(el, primitive, name) {
    const data = /** @type {any} */ (el)["__ax__internal"];
    const forValue = data?.for ?? getAttr(el, "ax-for");
    if (!forValue) return true;
    return forValue === name;
}

/**
 * @param {Element} el
 * @param {string} parentPrimitive
 * @returns {any[]}
 */
function collectChildren(el, parentPrimitive) {
    /** @type {any[]} */
    const results = [];
    const parentName = primitiveName(el);

    for (const child of Array.from(el.children)) {
        if (isIgnored(child)) continue;

        const childPrimitive = primaryPrimitive(child);
        if (childPrimitive) {
            if (acceptsFor(child, parentPrimitive, parentName)) {
                const childResult = walk(child, undefined, undefined);
                if (childResult) results.push(childResult);
            }
            continue;
        }

        if (!acceptsFor(child, parentPrimitive, parentName)) {
            continue;
        }

        const childResult = walk(child, undefined, undefined);
        if (childResult) results.push(childResult);
    }

    return results;
}

/**
 * @param {Element} el
 * @returns {any[]}
 */
function collectTemplates(el) {
    /** @type {any[]} */
    const all = [];
    const own = getAttr(el, "ax-template");
    if (own) all.push(own);

    for (const child of Array.from(el.children)) {
        if (isIgnored(child)) continue;
        all.push(...collectTemplates(child));
    }

    return all;
}

/**
 * @param {Element} el
 * @returns {any | undefined}
 */
/**
 * Read a value from internal data or fall back to reading the attribute directly.
 * @param {Element} el
 * @param {string} dataKey
 * @param {string} attrName
 * @returns {string | undefined}
 */
function resolveAttr(el, dataKey, attrName) {
    const data = /** @type {any} */ (el)["__ax__internal"];
    if (data && data[dataKey] !== undefined) return data[dataKey];
    const val = getAttr(el, attrName);
    return val !== null ? val : undefined;
}

/**
 * @param {Element} el
 * @returns {any[]}
 */
function walkAll(el) {
    const data = /** @type {any} */ (el)["__ax__internal"] || {};
    const primitiveEntries = [];
    if (data.view)
        primitiveEntries.push({ primitive: "ax-view", name: data.view.name });
    if (data.edit)
        primitiveEntries.push({ primitive: "ax-edit", name: data.edit.name });
    if (data.click)
        primitiveEntries.push({ primitive: "ax-click", name: data.click.name });
    if (data.nav)
        primitiveEntries.push({ primitive: "ax-nav", name: data.nav.name });

    if (primitiveEntries.length === 0) {
        return [walk(el, undefined, undefined)].filter(Boolean);
    }

    return primitiveEntries
        .map((entry) => walk(el, entry.primitive, entry.name))
        .filter(Boolean);
}

/**
 * @param {Element} el
 * @param {string | undefined} forcedPrimitive
 * @param {string | undefined} forcedName
 * @returns {any | undefined}
 */
function walk(el, forcedPrimitive, forcedName) {
    if (isIgnored(el)) return undefined;

    const data = /** @type {any} */ (el)["__ax__internal"] || {};
    const primitive = forcedPrimitive || primaryPrimitive(el);
    const name = forcedName || primitiveName(el) || "";

    // Resolve template from internal data or directly from attribute
    const template = resolveAttr(el, "template", "ax-template");
    const swap = resolveAttr(el, "swap", "ax-swap");

    if (!primitive) {
        if (template) {
            return {
                type: "item",
                text: (el.textContent || "").trim(),
                template: template,
            };
        }
        return { type: "item", text: (el.textContent || "").trim() };
    }

    if (primitive === "ax-view") {
        const children = collectChildren(el, primitive);
        const templatesList = collectTemplates(el);
        const result = {
            type: "view",
            name,
            children,
            template: template,
            templates: templatesList.length ? templatesList : undefined,
            hooks: forcedPrimitive ? data.view?.hooks : data.hooks,
            status: forcedPrimitive ? data.view?.status : data.status,
        };
        return result;
    }

    if (primitive === "ax-edit") {
        const fields = [];
        for (const child of Array.from(
            el.querySelectorAll("[ax-edit], [data-ax-edit]"),
        )) {
            if (child === el) continue;
            if (isIgnored(child)) continue;
            const childData = /** @type {any} */ (child)["__ax__internal"];
            // Child must be a field (not another skill-level ax-edit)
            const childTemplate =
                childData?.template ||
                resolveAttr(child, "template", "ax-template");
            if (childData && childTemplate && childTemplate !== "field")
                continue;
            if (!acceptsFor(child, primitive, name)) continue;
            const fieldName =
                childData?.name || getAttr(child, "ax-edit") || "";
            const inputType = childData?.inputType || inferInputType(child);
            let value;
            if (inputType === "checkbox" || inputType === "radio") {
                value = /** @type {HTMLInputElement} */ (child).checked;
            } else if ("value" in child) {
                value =
                    /** @type {HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement} */ (
                        child
                    ).value;
            } else {
                value = (child.textContent || "").trim();
            }
            fields.push({
                type: "field",
                name: fieldName,
                value,
                inputType,
            });
        }

        return {
            type: "skill",
            name,
            children: fields,
            template: template,
            hooks: forcedPrimitive ? data.edit?.hooks : data.hooks,
            status: forcedPrimitive ? data.edit?.status : data.status,
        };
    }

    if (primitive === "ax-click") {
        const children = collectChildren(el, primitive);
        return {
            type: "skill",
            name,
            text: (el.textContent || "").trim(),
            children,
            template: template,
            hooks: forcedPrimitive ? data.click?.hooks : data.hooks,
            status: forcedPrimitive ? data.click?.status : data.status,
        };
    }

    if (primitive === "ax-nav") {
        return {
            type: "skill",
            name,
            text: (el.textContent || "").trim(),
            href: el.getAttribute("href") || undefined,
            swap: swap,
            template: template,
            hooks: forcedPrimitive ? data.nav?.hooks : data.hooks,
            status: forcedPrimitive ? data.nav?.status : data.status,
        };
    }

    return undefined;
}

/**
 * @param {Element} root
 */
function process(root) {
    const start = root || document.body;
    if (!start) return;
    // Clear previously registered scopes — we start fresh
    scopes.clear();

    /**
     * @param {Element} el
     * @param {{ scope?: string, viewName?: string, editName?: string, siblingScopes?: Set<string> }} ctx
     */
    function visit(el, ctx) {
        if (isIgnored(el)) return;

        const primitivesFound = readPrimitives(el);
        assertPrimitiveValues(primitivesFound);

        const contentScope = getAttr(el, "ax-content");
        const viewName = getAttr(el, "ax-view");
        const editName = getAttr(el, "ax-edit");
        const template = getAttr(el, "ax-template");
        const forValue = getAttr(el, "ax-for");
        const swapValue = getAttr(el, "ax-swap");

        const definesScope =
            (contentScope !== null && contentScope !== "") ||
            (viewName !== null && viewName !== "");

        const activeScope = definesScope
            ? contentScope && contentScope !== ""
                ? contentScope
                : viewName || ctx.scope
            : ctx.scope;

        if (activeScope && definesScope && ctx.siblingScopes) {
            if (ctx.siblingScopes.has(activeScope)) {
                throw new Error(
                    `Duplicate scope name at same level: ${activeScope}`,
                );
            }
            ctx.siblingScopes.add(activeScope);
        }

        const hasExplicit =
            primitivesFound.length > 0 ||
            contentScope !== null ||
            template !== null ||
            forValue !== null ||
            swapValue !== null;

        const hasViewAncestor = Boolean(ctx.viewName);
        const hasEditAncestor = Boolean(ctx.editName);

        let data = /** @type {any} */ (el)["__ax__internal"];
        if (!data && (hasExplicit || hasViewAncestor)) {
            data = {};
            /** @type {any} */ (el)["__ax__internal"] = data;
        }

        if (data) {
            if (activeScope) data.scope = activeScope;
            if (forValue) data.for = forValue;
            if (swapValue) data.swap = swapValue;
        }

        const primitiveNames = primitivesFound
            .map((p) => p.primitive)
            .filter(Boolean);

        if (data && primitiveNames.length === 1) {
            const prim = primitiveNames[0] || "";
            const name = primitivesFound.find(
                (p) => p.primitive === prim,
            )?.name;
            data.primitive = prim;
            data.name = name;
            data.hooks = readHooks(el, prim);
            data.status = readStatus(el);
        }

        if (data && primitiveNames.length > 1) {
            for (const prim of primitivesFound) {
                if (!prim.primitive) continue;
                if (prim.primitive === "ax-view")
                    data.view = {
                        name: prim.name,
                        hooks: readHooks(el, "ax-view"),
                        status: readStatus(el),
                    };
                if (prim.primitive === "ax-edit")
                    data.edit = {
                        name: prim.name,
                        hooks: readHooks(el, "ax-edit"),
                        status: readStatus(el),
                    };
                if (prim.primitive === "ax-click")
                    data.click = {
                        name: prim.name,
                        hooks: readHooks(el, "ax-click"),
                        status: readStatus(el),
                    };
                if (prim.primitive === "ax-nav")
                    data.nav = {
                        name: prim.name,
                        hooks: readHooks(el, "ax-nav"),
                        status: readStatus(el),
                    };
            }
        }

        if (data) {
            if (template) {
                data.template = template;
            } else if (primitiveNames.includes("ax-view")) {
                data.template = "view";
            } else if (primitiveNames.includes("ax-edit")) {
                data.template = hasEditAncestor ? "field" : "skill";
            } else if (primitiveNames.includes("ax-click")) {
                data.template = "skill";
            } else if (primitiveNames.includes("ax-nav")) {
                data.template = "skill";
            } else if (hasViewAncestor) {
                data.template = "item";
            }
        }

        if (data && primitiveNames.includes("ax-edit")) {
            data.inputType = inferInputType(el);
        }

        if (activeScope && definesScope) {
            scopes.set(activeScope, {
                name: activeScope,
                element: el,
                primitives: data,
            });
        }

        const nextCtx = {
            scope: activeScope,
            viewName: viewName || ctx.viewName,
            editName: editName || ctx.editName,
            siblingScopes: new Set(),
        };

        for (const child of Array.from(el.children)) {
            visit(child, nextCtx);
        }
    }

    visit(start, {
        scope: undefined,
        viewName: undefined,
        editName: undefined,
        siblingScopes: new Set(),
    });
}

/**
 * @returns {any}
 */
/**
 * @returns {any}
 */
function scan() {
    if (!document || !document.body) return [];
    process(document.body);
    const roots = Array.from(
        document.body.querySelectorAll(
            "[ax-view], [data-ax-view], [ax-edit], [data-ax-edit], [ax-click], [data-ax-click], [ax-nav], [data-ax-nav]",
        ),
    );
    return roots.flatMap((el) => walkAll(el)).filter(Boolean);
}

/**
 * @param {string} name
 * @returns {ScopeEntry | undefined}
 */
function get(name) {
    if (!scopes.has(name)) {
        process(document.body);
    }
    return scopes.get(name);
}

/**
 * @param {string} name
 * @param {(e: any) => any} fn
 */
function defineTemplate(name, fn) {
    if (BUILTIN_TEMPLATES.has(name)) {
        throw new Error(
            `Template ${name} is built-in and cannot be overridden`,
        );
    }
    templates.set(name, fn);
}

/**
 * @param {string} name
 * @param {{ default: string }} def
 */
function definePrimitive(name, def) {
    if (primitives.has(name)) {
        throw new Error(`Primitive ${name} already exists`);
    }
    primitives.set(name, { name, defaultTemplate: def.default });
}

const ax = {
    process,
    scan,
    get,
    walk,
    defineTemplate,
    definePrimitive,
};

if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () =>
            process(document.body),
        );
    } else {
        process(document.body);
    }
}

export default ax;
