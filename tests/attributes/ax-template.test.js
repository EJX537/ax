/**
 * Agent-facing tests for ax-template.
 *
 * Templates transform content before the agent reads it.
 * The agent sees the transformed output — templates are applied bottom-up
 * via the DAG walk. The agent never sees raw template strings;
 * the client evaluates them.
 */

import { describe, it, expect, beforeEach } from "bun:test";

/** @type {typeof import("../../src/index.js").default} */
let ax;

beforeEach(async () => {
  const mod = await import("../../src/index.js");
  ax = mod.default;
  document.body.innerHTML = "";
});

describe("ax-template — content transformation for agents", () => {
  it("view with no explicit template defaults to 'view' type in output", () => {
    document.body.innerHTML = `
      <div ax-view="section">
        <p>Hello</p>
      </div>
    `;

    const tree = ax.scan();
    expect(tree[0].type).toBe("view");
  });

  it("child of view defaults to 'item' type in output", () => {
    document.body.innerHTML = `
      <ul ax-view="list">
        <li>Item one</li>
      </ul>
    `;

    const tree = ax.scan();
    expect(tree[0].children[0].type).toBe("item");
  });

  it("click action defaults to 'skill' type in output", () => {
    document.body.innerHTML = `
      <button ax-click="doThing">Do it</button>
    `;

    const tree = ax.scan();
    expect(tree[0].type).toBe("skill");
  });

  it("explicit ax-template overrides the default type in output", () => {
    document.body.innerHTML = `
      <div ax-view="content" ax-template="item">
        <p>Some content</p>
      </div>
    `;

    // The template is stored — the client interprets it
    const el = document.querySelector("[ax-view]");
    const result = ax.walk(el);
    expect(result.template).toBe("item");
  });

  it("inline lambda template is stored as raw string — ax.js never evaluates", () => {
    // Create element programmatically to avoid JS template-literal interpolation
    const el = document.createElement("div");
    el.setAttribute("ax-view", "log");
    el.setAttribute("ax-template", "(e) => `${Date.now()}: ${e}`");
    el.textContent = "Entry";
    document.body.appendChild(el);

    const result = ax.walk(el);

    // The raw lambda string is stored as-is. ax.js never evaluates it.
    expect(result.template).toContain("Date.now");
  });

  it("custom templates registered via defineTemplate are available in walk output", () => {
    ax.defineTemplate("shorten", (e) => e.slice(0, 10));

    document.body.innerHTML = `
      <div ax-view="summary" ax-template="shorten">
        Very long content that should be shortened
      </div>
    `;

    const el = document.querySelector("[ax-view]");
    const result = ax.walk(el);
    expect(result.template).toBe("shorten");
  });

  it("built-in templates cannot be overridden by defineTemplate", () => {
    expect(() => ax.defineTemplate("view", () => {})).toThrow();
    expect(() => ax.defineTemplate("item", () => {})).toThrow();
    expect(() => ax.defineTemplate("skill", () => {})).toThrow();
    expect(() => ax.defineTemplate("field", () => {})).toThrow();
  });

  it("templates in pipeline are listed in walk output", () => {
    document.body.innerHTML = `
      <div ax-view="wrapped" ax-template="(e) => e.toUpperCase()">
        <p ax-template="(e) => e.trim()">  hello world  </p>
      </div>
    `;

    const el = document.querySelector("[ax-view]");
    const result = ax.walk(el);

    // The walk collects templates from the pipeline
    expect(result.templates).toBeDefined();
    expect(result.templates.length).toBeGreaterThan(0);
  });

  describe("harness evaluation — templates produce prompt-ready output", () => {
    /**
     * Simulates a client harness evaluating template lambdas.
     * The harness reads the walk output and applies transforms bottom-up
     * to produce the final text the agent sees in its prompt.
     */
    function simulateHarness(result) {
      // Apply child transforms first (bottom-up pipeline)
      if (Array.isArray(result.children)) {
        result.children.forEach(function (child) {
          simulateHarness(child);
        });
      }

      if (!result.template || typeof result.template !== "string") {
        return result;
      }

      // Gather input text for this node
      var inputText;
      if (result.type === "view") {
        // For views, the template transforms the combined children text
        inputText = (result.children || [])
          .map(function (c) {
            return c.resolved !== undefined ? c.resolved : c.text || "";
          })
          .join(" ");
      } else if (result.type === "field") {
        inputText = String(
          result.value !== undefined ? result.value : "",
        );
      } else {
        inputText = result.text || "";
      }

      // Try as inline lambda — harness uses Function() to evaluate safely
      try {
        var lambda = new Function(
          "e",
          "return (" + result.template + ")(e)",
        );
        result.resolved = String(lambda(inputText));
      } catch (_) {
        // Not a valid lambda, leave as-is
      }

      return result;
    }

    /**
     * Builds a flat prompt line from the walk result.
     * This is what the harness would insert into the agent's context.
     */
    function toPromptLine(result, indent) {
      if (indent === void 0) indent = 0;
      var prefix = "  ".repeat(indent);
      var label = "• ";
      var text =
        result.resolved !== undefined
          ? result.resolved
          : result.text || "";

      if (result.type === "view") {
        var sectionLine = prefix + label + "SECTION “" + result.name + "”";
        if (result.resolved !== undefined) {
          sectionLine += ": " + result.resolved;
        }
        sectionLine += "\n";
        sectionLine += (result.children || [])
          .map(function (c) {
            return toPromptLine(c, indent + 1);
          })
          .join("\n");
        return sectionLine;
      }

      if (result.type === "item") {
        return prefix + label + text;
      }

      if (result.type === "skill") {
        var line = prefix + "ACTION “" + result.name + "”";
        if (text) line += ": " + text;
        if (result.children && result.children.length > 0) {
          line += "\n";
          line += result.children
            .map(function (c) {
              return toPromptLine(c, indent + 1);
            })
            .join("\n");
        }
        return line;
      }

      if (result.type === "field") {
        return (
          prefix +
          "FIELD “" +
          result.name +
          "” (" +
          (result.inputType || "text") +
          "): " +
          (text || (result.value !== undefined ? String(result.value) : ""))
        );
      }

      return prefix + label + text;
    }

    it("inline lambda evaluated by harness produces transformed text", () => {
      document.body.innerHTML =
        '<div ax-view="log" ax-template="(e) => `[${new Date().toISOString().slice(0, 10)}] ${e}`">' +
        '  <p>Agent action completed</p>' +
        "</div>";

      var result = ax.walk(
        document.querySelector("[ax-view]"),
      );

      // The harness evaluates the lambda and resolves the text
      simulateHarness(result);

      // Result should be a dated log entry the agent sees in-context
      expect(result.resolved).toContain("Agent action completed");
      // Should have a date prefix
      expect(result.resolved).toMatch(/\[\d{4}-\d{2}-\d{2}\]/);
    });

    it("harness builds a prompt section from view + inline lambda", () => {
      document.body.innerHTML =
        '<div ax-view="summary" ax-template="(e) => `TL;DR: ${e}`">' +
        "  <p>This is a long article about web technologies.</p>" +
        "</div>";

      var result = ax.walk(
        document.querySelector("[ax-view]"),
      );
      simulateHarness(result);

      var prompt = toPromptLine(result);

      // The harness should produce a section with the transformed text
      expect(prompt).toContain("TL;DR:");
      expect(prompt).toContain("web technologies");
      expect(prompt).toContain("SECTION “summary”");
    });

    it("harness builds an action prompt from click + text", () => {
      document.body.innerHTML =
        '<button ax-click="translate">Translate this page to French</button>';

      var result = ax.walk(
        document.querySelector("[ax-click]"),
      );
      var prompt = toPromptLine(result);

      expect(prompt).toContain("ACTION “translate”");
      expect(prompt).toContain("Translate this page to French");
    });

    it("harness builds a form prompt from edit + fields", () => {
      document.body.innerHTML =
        '<form ax-edit="profile">' +
        '  <input ax-edit="name" type="text" value="Alice" />' +
        '  <input ax-edit="age" type="number" value="30" />' +
        "</form>";

      var result = ax.walk(
        document.querySelector("[ax-edit]"),
      );
      var prompt = toPromptLine(result);

      expect(prompt).toContain("ACTION “profile”");
      expect(prompt).toContain("FIELD “name” (text)");
      expect(prompt).toContain("FIELD “age” (number): 30");
    });

    it("harness builds a navigation prompt from nav + swap", () => {
      document.body.innerHTML =
        '<a ax-nav="next article" ax-swap="page" href="/articles/2">Next article</a>';

      var result = ax.walk(
        document.querySelector("[ax-nav]"),
      );
      var prompt = toPromptLine(result);

      expect(prompt).toContain("ACTION “next article”");
      expect(prompt).toContain("Next article");
    });

    it("pipeline applies child template then parent template", () => {
      document.body.innerHTML =
        '<div ax-view="post" ax-template="(e) => `=== ${e} ===`">' +
        '  <p ax-template="(e) => e.toUpperCase()">hello</p>' +
        "</div>";

      var result = ax.walk(
        document.querySelector("[ax-view]"),
      );
      simulateHarness(result);

      // The parent inline lambda transforms the child's output
      expect(result.resolved).toMatch(/===.+HELLO.+===/);
    });

    it("harness handles mixed content: view + actions + form", () => {
      document.body.innerHTML =
        '<main ax-view="dashboard">' +
        "  <h1>Active Tasks</h1>" +
        '  <p>3 tasks pending</p>' +
        '  <button ax-click="refresh">Refresh</button>' +
        '  <form ax-edit="new task">' +
        '    <input ax-edit="title" type="text" placeholder="Task name" />' +
        "  </form>" +
        "</main>";

      var tree = ax.scan();

      // The harness would iterate each root and build a full prompt
      var promptParts = tree.map(function (result) {
        return toPromptLine(result);
      });

      var fullPrompt = promptParts.join("\n\n");

      expect(fullPrompt).toContain("SECTION “dashboard”");
      expect(fullPrompt).toContain("ACTION “refresh”");
      expect(fullPrompt).toContain("ACTION “new task”");
      expect(fullPrompt).toContain("FIELD “title” (text)");
    });

    it("harness skips ax-ignore content when building prompt", () => {
      document.body.innerHTML =
        '<ul ax-view="task list">' +
        "  <li>Buy milk</li>" +
        '  <li ax-ignore>Delete account (under review)</li>' +
        "  <li>Write tests</li>" +
        "</ul>";

      var tree = ax.scan();
      var prompt = toPromptLine(tree[0]);

      expect(prompt).toContain("Buy milk");
      expect(prompt).toContain("Write tests");
      expect(prompt).not.toContain("Delete account");
    });

    it("harness uses ax-swap to describe navigation effect", () => {
      document.body.innerHTML =
        '<a ax-nav="home" ax-swap="page" href="/">Home</a>' +
        '<a ax-nav="load more" ax-swap="region" href="/items?p=2">More</a>';

      var tree = ax.scan();
      var promptLines = tree.map(function (r) {
        return toPromptLine(r);
      });

      // The harness could attach swap type as a hint in the prompt
      expect(promptLines[0]).toContain("ACTION “home”");
      expect(promptLines[1]).toContain("ACTION “load more”");
    });
  });
});
