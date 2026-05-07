/**
 * Tests for status normalization on ax-* primitives.
 *
 * Status is derived from native HTML attributes:
 * - disabled / aria-disabled="true" → {status: "disabled"}
 * - aria-busy="true" → {status: "loading"}
 * - checkValidity() fails → {status: "blocked", reason: "invalid"}
 * - none → undefined/empty
 *
 * Priority: disabled wins over aria-busy.
 * Status is exposed in walk() output as the `status` field.
 */

import { describe, it, expect, beforeEach } from "bun:test";

/** @type {typeof import("../../src/index.js").default} */
let ax;

beforeEach(async () => {
  const mod = await import("../../src/index.js");
  ax = mod.default;
  document.body.innerHTML = "";
});

describe("ax-status — element state from HTML attributes", () => {
  describe("disabled", () => {
    it("button with disabled attribute returns status disabled", () => {
      document.body.innerHTML = `
        <button ax-click="save" disabled>Save</button>
      `;

      const tree = ax.scan();
      const skill = tree.find((t) => t.name === "save");

      expect(skill.status).toBeDefined();
      expect(skill.status.status).toBe("disabled");
    });

    it("input with disabled attribute returns status disabled", () => {
      document.body.innerHTML = `
        <input ax-edit="name" type="text" disabled />
      `;

      const tree = ax.scan();
      const skill = tree.find((t) => t.name === "name");

      expect(skill.status.status).toBe("disabled");
    });

    it("input with aria-disabled='true' returns status disabled", () => {
      document.body.innerHTML = `
        <input ax-edit="email" type="email" aria-disabled="true" />
      `;

      const tree = ax.scan();
      const skill = tree.find((t) => t.name === "email");

      expect(skill.status.status).toBe("disabled");
    });

    it("link with aria-disabled='true' returns status disabled", () => {
      document.body.innerHTML = `
        <a ax-nav="next" href="/page/2" aria-disabled="true">Next</a>
      `;

      const tree = ax.scan();
      const nav = tree.find((t) => t.name === "next");

      expect(nav.status.status).toBe("disabled");
    });

    it("element without disabled/aria-disabled has no disabled status", () => {
      document.body.innerHTML = `
        <button ax-click="active">Active</button>
      `;

      const tree = ax.scan();
      const skill = tree.find((t) => t.name === "active");

      expect(skill.status).toBeDefined();
      expect(skill.status.status).toBeUndefined();
    });
  });

  describe("loading (aria-busy)", () => {
    it("button with aria-busy='true' returns status loading", () => {
      document.body.innerHTML = `
        <button ax-click="fetch" aria-busy="true">Fetch</button>
      `;

      const tree = ax.scan();
      const skill = tree.find((t) => t.name === "fetch");

      expect(skill.status.status).toBe("loading");
    });

    it("form with aria-busy='true' returns status loading", () => {
      document.body.innerHTML = `
        <form ax-edit="signup" aria-busy="true">
          <input ax-edit="email" type="email" />
        </form>
      `;

      const tree = ax.scan();
      const skill = tree.find((t) => t.name === "signup");

      expect(skill.status.status).toBe("loading");
    });
  });

  describe("blocked (validation)", () => {
    it("required input with empty value returns status blocked", () => {
      document.body.innerHTML = `
        <form ax-edit="login">
          <input ax-edit="email" type="email" required />
        </form>
      `;

      const tree = ax.scan();
      const skill = tree.find((t) => t.name === "login");

      // The form itself is invalid because the required input is empty
      expect(skill.status.status).toBe("blocked");
      expect(skill.status.reason).toBe("invalid");
    });

    it("valid form has no blocked status", () => {
      document.body.innerHTML = `
        <form ax-edit="login">
          <input ax-edit="email" type="email" required value="a@b.com" />
        </form>
      `;

      const tree = ax.scan();
      const skill = tree.find((t) => t.name === "login");

      expect(skill.status.status).not.toBe("blocked");
    });
  });

  describe("priority — disabled wins over aria-busy", () => {
    it("element with both disabled and aria-busy reports disabled", () => {
      document.body.innerHTML = `
        <button ax-click="submit" disabled aria-busy="true">Submit</button>
      `;

      const tree = ax.scan();
      const skill = tree.find((t) => t.name === "submit");

      // disabled takes priority over aria-busy
      expect(skill.status.status).toBe("disabled");
    });

    it("element with aria-disabled and aria-busy reports disabled", () => {
      document.body.innerHTML = `
        <input ax-edit="name" type="text" aria-disabled="true" aria-busy="true" />
      `;

      const tree = ax.scan();
      const skill = tree.find((t) => t.name === "name");

      expect(skill.status.status).toBe("disabled");
    });
  });

  describe("neutral state", () => {
    it("element with no status indicators has empty status", () => {
      document.body.innerHTML = `
        <button ax-click="go">Go</button>
      `;

      const tree = ax.scan();
      const skill = tree.find((t) => t.name === "go");

      // status is an object but status.status is undefined
      expect(skill.status).toBeDefined();
      expect(skill.status.status).toBeUndefined();
    });

    it("form with valid inputs has no blocked status", () => {
      document.body.innerHTML = `
        <form ax-edit="feedback">
          <input ax-edit="message" type="text" value="Great!" />
        </form>
      `;

      const tree = ax.scan();
      const skill = tree.find((t) => t.name === "feedback");

      expect(skill.status.status).toBeUndefined();
    });
  });
});
