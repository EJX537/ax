/**
 * Agent-facing tests for ax-edit.
 *
 * ax-edit tells an agent what it can write on a page.
 * - Container ax-edit → skill(name, [field(...), field(...)])
 * - Standalone ax-edit → skill(name, element)
 * - The input type is inferred so the agent knows how to interact
 */

import { describe, it, expect, beforeEach } from "bun:test";

/** @type {typeof import("../../src/index.js").default} */
let ax;

beforeEach(async () => {
  const mod = await import("../../src/index.js");
  ax = mod.default;
  document.body.innerHTML = "";
});

describe("ax-edit — agent writable fields", () => {
  it("scan returns form edits as a skill with field children", () => {
    document.body.innerHTML = `
      <form ax-edit="notes">
        <input ax-edit="title" type="text" />
        <textarea ax-edit="body"></textarea>
        <button ax-click="save" type="submit">Save</button>
      </form>
    `;

    const tree = ax.scan();

    // Agent sees: skill("notes", [field("title", ...), field("body", ...)])
    const notesSkill = tree.find((t) => t.name === "notes");
    expect(notesSkill).toBeDefined();
    expect(notesSkill.type).toBe("skill");
    expect(notesSkill.children).toHaveLength(2);

    // Agent sees individual fields
    const fields = notesSkill.children;
    expect(fields[0].type).toBe("field");
    expect(fields[0].name).toBe("title");
    expect(fields[1].type).toBe("field");
    expect(fields[1].name).toBe("body");
  });

  it("agent sees input types so it knows how to fill each field", () => {
    document.body.innerHTML = `
      <form ax-edit="contact">
        <input ax-edit="name" type="text" />
        <input ax-edit="email" type="email" />
        <input ax-edit="age" type="number" />
        <textarea ax-edit="bio"></textarea>
        <select ax-edit="country">
          <option value="us">US</option>
          <option value="uk">UK</option>
        </select>
      </form>
    `;

    const tree = ax.scan();
    const fields = tree[0].children;

    const nameField = fields.find((f) => f.name === "name");
    const emailField = fields.find((f) => f.name === "email");
    const ageField = fields.find((f) => f.name === "age");
    const bioField = fields.find((f) => f.name === "bio");
    const countryField = fields.find((f) => f.name === "country");

    expect(nameField.inputType).toBe("text");
    expect(emailField.inputType).toBe("email");
    expect(ageField.inputType).toBe("number");
    expect(bioField.inputType).toBe("textarea");
    expect(countryField.inputType).toBe("select");
  });

  it("agent sees checkbox and file types correctly", () => {
    document.body.innerHTML = `
      <form ax-edit="settings">
        <input ax-edit="active" type="checkbox" />
        <input ax-edit="avatar" type="file" />
      </form>
    `;

    const tree = ax.scan();
    const fields = tree[0].children;

    expect(fields.find((f) => f.name === "active").inputType).toBe("checkbox");
    expect(fields.find((f) => f.name === "avatar").inputType).toBe("file");
  });

  it("agent reads current field values from the DOM", () => {
    document.body.innerHTML = `
      <form ax-edit="profile">
        <input ax-edit="name" type="text" value="Alice" />
        <textarea ax-edit="bio">Software engineer</textarea>
      </form>
    `;

    const tree = ax.scan();
    const fields = tree[0].children;

    expect(fields.find((f) => f.name === "name").value).toBe("Alice");
    expect(fields.find((f) => f.name === "bio").value).toBe("Software engineer");
  });

  it("agent sees checkbox current state", () => {
    document.body.innerHTML = `
      <form ax-edit="prefs">
        <input ax-edit="newsletter" type="checkbox" checked />
        <input ax-edit="dark-mode" type="checkbox" />
      </form>
    `;

    const tree = ax.scan();
    const fields = tree[0].children;

    expect(fields.find((f) => f.name === "newsletter").value).toBe(true);
    expect(fields.find((f) => f.name === "dark-mode").value).toBe(false);
  });

  it("standalone ax-edit (outside form) appears as skill for the agent", () => {
    document.body.innerHTML = `
      <input ax-edit="quick note" type="text" value="Remember this" />
    `;

    const tree = ax.scan();

    // A standalone ax-edit defaults to skill
    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe("skill");
    expect(tree[0].name).toBe("quick note");
  });

  it("agent discovers the save action alongside fields", () => {
    document.body.innerHTML = `
      <form ax-edit="notes">
        <input ax-edit="title" type="text" />
        <textarea ax-edit="body"></textarea>
        <button ax-click="save" type="submit">Save</button>
      </form>
    `;

    const tree = ax.scan();

    // Agent sees both the form skill and the save action
    const saveAction = tree.find((t) => t.type === "skill" && t.name === "save");
    expect(saveAction).toBeDefined();

    const notesSkill = tree.find((t) => t.name === "notes");
    expect(notesSkill).toBeDefined();
  });

  describe("round-trip — client writes agent decisions back to the DOM", () => {
    /**
     * Agent tool example: "fill title", "set body", "check active".
     * The harness reads ax-edit output to locate the DOM element,
     * then writes using the native DOM API.
     */
    function findEditElement(name) {
      // The harness uses the scope name to find the element
      const scope = ax.get(name);
      if (scope) {
        const el = scope.element;
        // For named scopes that are form containers, the harness
        // reads the walk children to find fields
        const tree = ax.scan();
        const skill = tree.find((s) => s.name === name);
        if (skill) return { element: el, skill };
        return { element: el };
      }
      // Fallback: search DOM for element with matching ax-edit value
      return {
        element: document.querySelector(
          "[ax-edit=\\
