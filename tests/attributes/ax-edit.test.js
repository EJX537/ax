/**
 * Agent-facing tests for ax-edit.
 *
 * ax-edit tells an agent what it can write on a page.
 * - Container ax-edit → skill(name, [field(...), field(...)])
 * - Standalone ax-edit → skill(name, element)
 * - The input type is inferred so the agent knows how to interact
 *
 * Round-trip: agent reads → decides → client writes → DOM updated
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

    const notesSkill = tree.find((t) => t.name === "notes");
    expect(notesSkill).toBeDefined();
    expect(notesSkill.type).toBe("skill");
    expect(notesSkill.children).toHaveLength(2);

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

    const saveAction = tree.find((t) => t.type === "skill" && t.name === "save");
    expect(saveAction).toBeDefined();

    const notesSkill = tree.find((t) => t.name === "notes");
    expect(notesSkill).toBeDefined();
  });

  describe("round-trip — client writes agent decisions back to the DOM", () => {
    /**
     * The agent decides to write a field. The harness:
     * 1. Reads the ax-edit output to find the element and its location
     * 2. Writes the value to the DOM via native API
     * 3. The page reflects the new state
     */

    it("client can set a text field value and DOM updates", () => {
      document.body.innerHTML = `
        <form ax-edit="notes">
          <input ax-edit="title" type="text" />
          <textarea ax-edit="body">old body</textarea>
        </form>
      `;

      // Agent reads the form structure
      const tree = ax.scan();
      const formSkill = tree.find((s) => s.name === "notes");
      const titleField = formSkill.children.find((c) => c.name === "title");

      // Agent decides: "set title to 'Meeting notes'"
      // Client acts: finds the element and writes
      const titleInput = document.querySelector(
        '[ax-edit="title"]',
      );
      titleInput.value = "Meeting notes";

      // Agent re-reads to verify
      const updated = ax.scan();
      const updatedTitle = updated
        .find((s) => s.name === "notes")
        .children.find((c) => c.name === "title");

      expect(updatedTitle.value).toBe("Meeting notes");
    });

    it("client can check a checkbox and DOM reflects the change", () => {
      document.body.innerHTML = `
        <form ax-edit="prefs">
          <input ax-edit="newsletter" type="checkbox" />
        </form>
      `;

      // Agent reads current state
      const before = ax.scan();
      const fieldBefore = before[0].children.find(
        (c) => c.name === "newsletter",
      );
      expect(fieldBefore.value).toBe(false);

      // Agent decides: "enable newsletter"
      // Client acts: checks the checkbox
      const checkbox = document.querySelector(
        '[ax-edit="newsletter"]',
      );
      checkbox.checked = true;

      // Agent re-reads to verify
      const after = ax.scan();
      const fieldAfter = after[0].children.find(
        (c) => c.name === "newsletter",
      );
      expect(fieldAfter.value).toBe(true);
    });

    it("client can change a select value and DOM updates", () => {
      document.body.innerHTML = `
        <form ax-edit="settings">
          <select ax-edit="theme">
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </form>
      `;

      // Agent decides: "set theme to dark"
      const select = document.querySelector(
        '[ax-edit="theme"]',
      );
      select.value = "dark";

      // Agent re-reads to verify
      const tree = ax.scan();
      const themeField = tree[0].children.find(
        (c) => c.name === "theme",
      );

      expect(themeField.value).toBe("dark");
    });

    it("client can fill multiple fields in a form sequentially", () => {
      document.body.innerHTML = `
        <form ax-edit="profile">
          <input ax-edit="name" type="text" />
          <input ax-edit="age" type="number" />
        </form>
      `;

      // Agent decides two writes in sequence
      document.querySelector('[ax-edit="name"]').value = "Bob";
      document.querySelector('[ax-edit="age"]').value = "28";

      // Agent re-reads
      const tree = ax.scan();
      const children = tree[0].children;

      expect(children.find((c) => c.name === "name").value).toBe(
        "Bob",
      );
      expect(children.find((c) => c.name === "age").value).toBe(
        "28",
      );
    });

    it("client can clear a textarea and DOM reflects empty value", () => {
      document.body.innerHTML = `
        <form ax-edit="notes">
          <textarea ax-edit="body">Existing content</textarea>
        </form>
      `;

      // Agent decides: "clear the body"
      document.querySelector('[ax-edit="body"]').value = "";

      const tree = ax.scan();
      const bodyField = tree[0].children.find(
        (c) => c.name === "body",
      );

      expect(bodyField.value).toBe("");
    });
  });
});
