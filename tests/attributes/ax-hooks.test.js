/**
 * Tests for ax-*Hook attributes (ax-beforeClick, ax-onClick, ax-afterClick, etc.)
 *
 * Each primitive captures lifecycle hooks as raw strings:
 * - ax-click → ax-beforeClick, ax-onClick, ax-afterClick
 * - ax-edit → ax-beforeEdit, ax-onEdit, ax-afterEdit
 * - ax-nav → ax-beforeNav, ax-onNav, ax-afterNav
 * - ax-view → ax-beforeView, ax-onView, ax-afterView
 *
 * Hooks are stored in walk() output under `hooks: { before, on, after }`.
 * ax.js never evaluates them — the client harness interprets them.
 * If a hook is present without its primitive, it is ignored.
 */

import { describe, it, expect, beforeEach } from "bun:test";

/** @type {typeof import("../../src/index.js").default} */
let ax;

beforeEach(async () => {
  const mod = await import("../../src/index.js");
  ax = mod.default;
  document.body.innerHTML = "";
});

describe("ax-*Hook — lifecycle hooks as raw strings", () => {
  describe("ax-click hooks", () => {
    it("exposes before/on/after hooks in walk result", () => {
      document.body.innerHTML = `
        <button ax-click="save"
                ax-beforeClick="confirm('Are you sure?')"
                ax-onClick="trackEvent('save')"
                ax-afterClick="showToast('Saved!')">Save</button>
      `;

      const tree = ax.scan();
      const skill = tree.find((t) => t.name === "save");

      expect(skill.hooks).toBeDefined();
      expect(skill.hooks.before).toBe("confirm('Are you sure?')");
      expect(skill.hooks.on).toBe("trackEvent('save')");
      expect(skill.hooks.after).toBe("showToast('Saved!')");
    });

    it("hooks are stored as raw strings — never evaluated by ax.js", () => {
      document.body.innerHTML = `
        <button ax-click="danger"
                ax-beforeClick="alert('xss')"
                ax-onClick="eval('malicious')">Danger</button>
      `;

      const tree = ax.scan();
      const skill = tree.find((t) => t.name === "danger");

      // ax.js stores the raw strings, never calls eval/Function
      expect(skill.hooks.before).toBe("alert('xss')");
      expect(skill.hooks.on).toBe("eval('malicious')");
    });

    it("partial hooks (only some defined) appear correctly", () => {
      document.body.innerHTML = `
        <button ax-click="log"
                ax-onClick="console.log('clicked')">Log</button>
      `;

      const tree = ax.scan();
      const skill = tree.find((t) => t.name === "log");

      expect(skill.hooks.before).toBeUndefined();
      expect(skill.hooks.on).toBe("console.log('clicked')");
      expect(skill.hooks.after).toBeUndefined();
    });

    it("no hooks when no ax-*Hook attributes are present", () => {
      document.body.innerHTML = `
        <button ax-click="plain">Plain</button>
      `;

      const tree = ax.scan();
      const skill = tree.find((t) => t.name === "plain");

      expect(skill.hooks.before).toBeUndefined();
      expect(skill.hooks.on).toBeUndefined();
      expect(skill.hooks.after).toBeUndefined();
    });
  });

  describe("ax-edit hooks", () => {
    it("exposes before/on/after hooks in walk result", () => {
      document.body.innerHTML = `
        <form ax-edit="profile"
              ax-beforeEdit="validateForm()"
              ax-onEdit="draftAutosave()"
              ax-afterEdit="refreshPreview()">
          <input ax-edit="name" type="text" />
        </form>
      `;

      const tree = ax.scan();
      const skill = tree.find((t) => t.name === "profile");

      expect(skill.hooks.before).toBe("validateForm()");
      expect(skill.hooks.on).toBe("draftAutosave()");
      expect(skill.hooks.after).toBe("refreshPreview()");
    });

    it("hooks on form container are available via walk() after processing", () => {
      document.body.innerHTML = `
        <form ax-edit="contact"
              ax-beforeEdit="trackDirty()"
              ax-afterEdit="sync()">
          <input ax-edit="email" type="email" />
        </form>
      `;

      // Process first to populate internal data
      ax.scan();
      const el = document.querySelector("[ax-edit]");
      const result = ax.walk(el);

      expect(result.hooks.before).toBe("trackDirty()");
      expect(result.hooks.after).toBe("sync()");
      expect(result.hooks.on).toBeUndefined();
    });
  });

  describe("ax-nav hooks", () => {
    it("exposes before/on/after hooks in walk result", () => {
      document.body.innerHTML = `
        <a ax-nav="next page" href="/page/2"
           ax-beforeNav="saveScroll()"
           ax-onNav="trackNav('next')"
           ax-afterNav="restoreScroll()">Next</a>
      `;

      const tree = ax.scan();
      const nav = tree.find((t) => t.name === "next page");

      expect(nav.hooks.before).toBe("saveScroll()");
      expect(nav.hooks.on).toBe("trackNav('next')");
      expect(nav.hooks.after).toBe("restoreScroll()");
    });
  });

  describe("ax-view hooks", () => {
    it("exposes before/on/after hooks in walk result", () => {
      document.body.innerHTML = `
        <div ax-view="article"
             ax-beforeView="lockContent()"
             ax-onView="trackView()"
             ax-afterView="unlockContent()">
          <p>Content</p>
        </div>
      `;

      const tree = ax.scan();
      const view = tree.find((t) => t.name === "article");

      expect(view.hooks.before).toBe("lockContent()");
      expect(view.hooks.on).toBe("trackView()");
      expect(view.hooks.after).toBe("unlockContent()");
    });
  });

  describe("hook validation — orphaned hooks are ignored", () => {
    it("ax-beforeClick on an element without ax-click is ignored", () => {
      document.body.innerHTML = `
        <div ax-beforeClick="orphan()">No click</div>
      `;

      // Should not throw, should not create a primitive
      const tree = ax.scan();
      // No primitive should be found
      expect(tree).toHaveLength(0);
    });

    it("ax-beforeEdit on an element without ax-edit is ignored", () => {
      document.body.innerHTML = `
        <input ax-beforeEdit="orphan()" type="text" />
      `;

      const tree = ax.scan();
      expect(tree).toHaveLength(0);
    });

    it("ax-onNav on an element without ax-nav is ignored", () => {
      document.body.innerHTML = `
        <a ax-onNav="orphan()" href="/">Home</a>
      `;

      const tree = ax.scan();
      expect(tree).toHaveLength(0);
    });

    it("ax-afterView on an element without ax-view is ignored", () => {
      document.body.innerHTML = `
        <p ax-afterView="orphan()">Text</p>
      `;

      const tree = ax.scan();
      expect(tree).toHaveLength(0);
    });

    it("multiple orphan hooks on the same element are all ignored", () => {
      document.body.innerHTML = `
        <div ax-beforeClick="a()" ax-onClick="b()" ax-afterClick="c()">No click</div>
      `;

      const tree = ax.scan();
      expect(tree).toHaveLength(0);
    });
  });

  describe("hooks on multi-primitive elements", () => {
    it("element with ax-view and ax-edit has separate hooks for each primitive", () => {
      document.body.innerHTML = `
        <div ax-content="dashboard"
             ax-view="dashboard view"
             ax-edit="dashboard edit"
             ax-onView="trackView()"
             ax-onEdit="trackEdit()">
          <p>Dashboard</p>
        </div>
      `;

      const tree = ax.scan();

      // The scan returns one entry per primitive type
      const viewEntry = tree.find((t) => t.name === "dashboard view");
      const editEntry = tree.find((t) => t.name === "dashboard edit");

      expect(viewEntry).toBeDefined();
      expect(editEntry).toBeDefined();

      // View hook only appears on the view entry
      expect(viewEntry.hooks.on).toBe("trackView()");
      // Edit hook only appears on the edit entry
      expect(editEntry.hooks.on).toBe("trackEdit()");
    });

    it("element with ax-click and ax-nav has separate hooks for each", () => {
      document.body.innerHTML = `
        <div ax-content="actions"
             ax-click="submit"
             ax-nav="next"
             ax-beforeClick="validate()"
             ax-beforeNav="trackNav()">
          Act
        </div>
      `;

      const tree = ax.scan();

      const clickEntry = tree.find((t) => t.name === "submit");
      const navEntry = tree.find((t) => t.name === "next");

      expect(clickEntry.hooks.before).toBe("validate()");
      expect(navEntry.hooks.before).toBe("trackNav()");
    });
  });

  describe("data-ax-*Hook prefix support", () => {
    it("supports data-ax-beforeClick as fallback", () => {
      document.body.innerHTML = `
        <button ax-click="save"
                data-ax-beforeClick="validate()"
                data-ax-onClick="submit()">Save</button>
      `;

      const tree = ax.scan();
      const skill = tree.find((t) => t.name === "save");

      expect(skill.hooks.before).toBe("validate()");
      expect(skill.hooks.on).toBe("submit()");
    });
  });
});
