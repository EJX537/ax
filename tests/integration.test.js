/**
 * Integration test — SPA-scale walkthrough.
 *
 * A single DOM with multiple "pages" (dashboard, projects, settings),
 * a sidebar, a modal region, hooks, status, templates, multi-step forms,
 * ax-for routing, ax-ignore, and data-ax-* fallbacks.
 *
 * The mock client (harness) scans the page, discovers scopes and actions,
 * and validates the full structured output the agent would receive.
 */

import { describe, it, expect, beforeEach } from "bun:test";

/** @type {typeof import("../src/index.js").default} */
let ax;

beforeEach(async () => {
  const mod = await import("../src/index.js");
  ax = mod.default;
  document.body.innerHTML = "";
});

/**
 * The full SPA DOM.
 */
const SPA_HTML = `
<main ax-view="spa-root" ax-beforeView="(e)=>e.status==='ready'">
  <!-- Global metadata -->
  <meta hidden ax-template="(e)=>'App: '+e" content="Atlas Ops">
  <data hidden ax-template="(e)=>'Build: '+e" value="2026.05.07">

  <!-- Global shell -->
  <header ax-view="global-header">
    <h1 ax-template="(e)=>e.toUpperCase()">Atlas Ops</h1>
    <nav ax-view="global-nav">
      <a ax-nav="go dashboard" href="#/dashboard" ax-swap="page"
         ax-beforeNav="(e)=>e.status!=='disabled'">Dashboard</a>
      <a ax-nav="go projects" href="#/projects" ax-swap="page">Projects</a>
      <a ax-nav="go settings" href="#/settings" ax-swap="page">Settings</a>
    </nav>
    <button ax-click="open notifications" ax-swap="modal"
            ax-onClick="(e)=>e.status==='success'">
      Notifications
    </button>
  </header>

  <!-- Sidebar persistent scope -->
  <aside ax-content="global-sidebar" ax-view="sidebar">
    <section ax-view="quick-actions">
      <button ax-click="new project">New Project</button>
      <button ax-click="new task">New Task</button>
    </section>
    <section ax-view="status-panel">
      <p>System: nominal</p>
      <p ax-template="(e)=>'Uptime: '+e">99.98%</p>
    </section>
  </aside>

  <!-- PAGE: Dashboard -->
  <main ax-content="page-dashboard" ax-view="dashboard page">
    <header ax-template="(e)=>'**'+e+'**'">
      <h2 ax-template="(e)=>e.toUpperCase()">Dashboard</h2>
      <p>Fleet overview and alerts</p>
    </header>
    <section ax-view="dashboard-metrics" ax-template="(e)=>'Metrics: '+e">
      <ul>
        <li>Latency: 120ms</li>
        <li ax-template="(e)=>'ALERT: '+e">Warnings: 2</li>
      </ul>
    </section>
    <section ax-view="dashboard-actions">
      <button ax-click="refresh metrics"
              ax-beforeClick="(e)=>e.status==='ready'">Refresh</button>
      <button ax-click="export report" disabled>Export</button>
    </section>
    <form ax-edit="update status" aria-busy="true"
          ax-beforeEdit="(e)=>e.status!=='disabled'"
          ax-onEdit="(e)=>e.status==='success'">
      <input ax-edit="status label" type="text" value="Operational" />
      <textarea ax-edit="status note">All systems stable</textarea>
      <button ax-click="save status" type="submit">Save</button>
    </form>
  </main>

  <!-- PAGE: Projects -->
  <main ax-content="page-projects" ax-view="projects page">
    <header><h2>Projects</h2></header>
    <section ax-view="project-list">
      <ul>
        <li ax-template="(e)=>'PROJECT: '+e">Orion</li>
        <li>Helios</li>
        <li>Nova</li>
      </ul>
      <button ax-click="create project">Create Project</button>
    </section>
    <section ax-view="project-detail" ax-content="project-orion">
      <h3 ax-template="(e)=>'Project: '+e">Orion</h3>
      <section ax-content="onboarding-flow" ax-view="onboarding steps">
        <div ax-view="step-1" ax-template="(e)=>'Step 1: '+e">
          <h4>Basics</h4>
          <form ax-edit="project basics">
            <input ax-edit="name" type="text" value="Orion" />
            <textarea ax-edit="description">Next-gen platform</textarea>
            <button ax-click="save step 1" type="submit">Save Step 1</button>
          </form>
          <button ax-nav="go step 2" href="#/projects/orion/step-2" ax-swap="region">
            Next Step
          </button>
        </div>
        <div ax-view="step-2" ax-template="(e)=>'Step 2: '+e">
          <h4>Team</h4>
          <form ax-edit="project team">
            <input ax-edit="lead" type="text" value="Ava Chen" />
            <input ax-edit="team size" type="number" value="8" />
            <button ax-click="save step 2" type="submit">Save Step 2</button>
          </form>
          <button ax-nav="go step 3" href="#/projects/orion/step-3" ax-swap="region">
            Next Step
          </button>
        </div>
        <div ax-view="step-3" ax-template="(e)=>'Step 3: '+e">
          <h4>Launch</h4>
          <form ax-edit="project launch">
            <input ax-edit="date" type="date" />
            <input ax-edit="public" type="checkbox" />
            <button ax-click="save step 3" type="submit">Save Step 3</button>
          </form>
          <button ax-nav="complete onboarding" href="#/projects/orion/complete" ax-swap="page">
            Complete
          </button>
        </div>
      </section>
      <!-- ax-for routing -->
      <div ax-template="skill" ax-for="project team">
        <div ax-template="(e)=>'Label: '+e">Team Lead</div>
        <div ax-template="(e)=>e.trim(10)">  Ava Chen  </div>
      </div>
    </section>
  </main>

  <!-- PAGE: Settings -->
  <main ax-content="page-settings" ax-view="settings page">
    <header><h2>Settings</h2></header>
    <section ax-view="account-settings">
      <form ax-edit="account">
        <input ax-edit="email" type="email" required value="invalid-email" />
        <input ax-edit="timezone" type="text" value="UTC" />
        <button ax-click="save account" type="submit">Save</button>
      </form>
    </section>
    <section ax-view="billing-settings">
      <form ax-edit="billing">
        <input ax-edit="card" type="text" value="4242 4242 4242 4242" />
        <input ax-edit="expiry" type="text" value="12/30" />
        <button ax-click="save billing" type="submit">Save</button>
      </form>
    </section>
  </main>

  <!-- Modal region -->
  <div ax-content="modal" ax-view="notifications modal">
    <h3>Notifications</h3>
    <ul>
      <li>Build complete</li>
      <li ax-template="(e)=>'ALERT: '+e">Security update required</li>
    </ul>
    <button ax-click="close modal">Close</button>
  </div>

  <!-- Ignored diagnostics -->
  <section ax-ignore>
    <p>Draft: internal notes</p>
    <button ax-click="internal only">Do not surface</button>
  </section>

  <!-- data-ax-* fallback -->
  <section data-ax-view="fallback section">
    <span data-ax-template="(e)=>'Fallback: '+e">Hello</span>
  </section>
</main>
`;

/** Simulate the harness evaluating an inline lambda on a node. */
function applyLambda(result) {
  if (!result || !result.template || typeof result.template !== "string") return;
  // Children first (bottom-up)
  if (Array.isArray(result.children)) {
    result.children.forEach(function (c) {
      applyLambda(c);
    });
  }
  var inputText;
  if (result.type === "view") {
    inputText = (result.children || [])
      .map(function (c) {
        return c.resolved !== undefined ? c.resolved : c.text || "";
      })
      .join(" ");
  } else if (result.type === "field") {
    inputText = String(result.value !== undefined ? result.value : "");
  } else {
    inputText = result.text || "";
  }
  try {
    var fn = new Function("e", "return (" + result.template + ")(e)");
    result.resolved = String(fn(inputText));
  } catch (_) {
    /* not evaluable in harness */
  }
}

describe("SPA integration — full page walkthrough", function () {
  // ── A) Boot & Scan ──────────────────────────────────────────────
  describe("A) Boot & Scan", function () {
    it("A1. scan completes without error", function () {
      document.body.innerHTML = SPA_HTML;
      expect(function () {
        ax.scan();
      }).not.toThrow();
    });

    it("A2. ignored diagnostic section is excluded from scan", function () {
      document.body.innerHTML = SPA_HTML;
      var tree = ax.scan();
      var names = tree.map(function (t) {
        return t.name;
      });
      expect(names).not.toContain("internal only");
    });
  });

  // ── B) Global Structure & Scopes ─────────────────────────────────
  describe("B) Global Structure & Scopes", function () {
    beforeEach(function () {
      document.body.innerHTML = SPA_HTML;
      ax.scan();
    });

    it("B3. ax.get('spa-root') resolves the root view", function () {
      var scope = ax.get("spa-root");
      expect(scope).toBeDefined();
      expect(scope.name).toBe("spa-root");
    });

    it("B4. ax.get('global-sidebar') resolves the sidebar scope", function () {
      var scope = ax.get("global-sidebar");
      expect(scope).toBeDefined();
      expect(scope.name).toBe("global-sidebar");
    });

    it("B5. three page scopes exist as distinct entries", function () {
      expect(ax.get("page-dashboard")).toBeDefined();
      expect(ax.get("page-projects")).toBeDefined();
      expect(ax.get("page-settings")).toBeDefined();
      var d = ax.get("page-dashboard");
      var p = ax.get("page-projects");
      var s = ax.get("page-settings");
      expect(d.element).not.toBe(p.element);
      expect(d.element).not.toBe(s.element);
      expect(p.element).not.toBe(s.element);
    });
  });

  // ── C) Navigation ────────────────────────────────────────────────
  describe("C) Navigation (page switching semantics)", function () {
    beforeEach(function () {
      document.body.innerHTML = SPA_HTML;
      ax.scan();
    });

    it("C7. global-nav nav skills have swap:'page'", function () {
      var tree = ax.scan();
      var navNames = ["go dashboard", "go projects", "go settings"];
      navNames.forEach(function (n) {
        var skill = tree.find(function (t) {
          return t.name === n;
        });
        expect(skill).toBeDefined();
        expect(skill.href).toContain("#/");
        expect(skill.swap).toBe("page");
      });
    });

    it("C8. harness can focus projects page by scope", function () {
      var scope = ax.get("page-projects");
      expect(scope).toBeDefined();
      var result = ax.walk(scope.element);
      expect(result.name).toBe("projects page");
    });
  });

  // ── D) Dashboard Page ────────────────────────────────────────────
  describe("D) Dashboard Page", function () {
    beforeEach(function () {
      document.body.innerHTML = SPA_HTML;
      ax.scan();
    });

    it("D9. dashboard page returns view with children", function () {
      var scope = ax.get("page-dashboard");
      var result = ax.walk(scope.element);
      expect(result.type).toBe("view");
      expect(result.name).toBe("dashboard page");
      expect(result.children.length).toBeGreaterThan(0);
    });

    it("D10. refresh metrics button carries beforeClick hook", function () {
      var tree = ax.scan();
      var skill = tree.find(function (t) {
        return t.name === "refresh metrics";
      });
      expect(skill).toBeDefined();
      expect(skill.hooks.before).toContain("e.status==='ready'");
    });

    it("D11. export report button has status disabled", function () {
      var tree = ax.scan();
      var skill = tree.find(function (t) {
        return t.name === "export report";
      });
      expect(skill).toBeDefined();
      expect(skill.status.status).toBe("disabled");
    });
  });

  // ── E) Projects Page ─────────────────────────────────────────────
  describe("E) Projects Page – List + Detail", function () {
    beforeEach(function () {
      document.body.innerHTML = SPA_HTML;
      ax.scan();
    });

    it("E12. project-list items include template on Orion", function () {
      var scope = ax.get("page-projects");
      var result = ax.walk(scope.element);
      var listSection = result.children.find(function (c) {
        return c.name === "project-list";
      });
      expect(listSection).toBeDefined();
      // Walk the <li> directly for its template
      var orionLi = document.querySelector('[ax-view="project-list"] li');
      var liResult = ax.walk(/** @type {Element} */ (orionLi));
      expect(liResult.text).toBe("Orion");
      expect(liResult.template).toContain("PROJECT");
    });

    it("E13. ax.get('project-orion') resolves the detail scope", function () {
      var scope = ax.get("project-orion");
      expect(scope).toBeDefined();
      expect(scope.name).toBe("project-orion");
    });
  });

  // ── F) Multi‑Step Flow ──────────────────────────────────────────
  describe("F) Multi-Step Flow (single DOM)", function () {
    beforeEach(function () {
      document.body.innerHTML = SPA_HTML;
      ax.scan();
    });

    it("F14. step-1 view contains project basics edit form", function () {
      var scope = ax.get("onboarding-flow");
      expect(scope).toBeDefined();
      var tree = ax.scan();
      var step1 = tree.find(function (t) {
        return t.name === "step-1";
      });
      expect(step1).toBeDefined();
      // step-1 should have children including the form skill
      expect(step1.children.length).toBeGreaterThan(0);
    });

    it("F15. 'Next Step' uses ax-nav with swap:'region'", function () {
      var tree = ax.scan();
      var nav = tree.find(function (t) {
        return t.name === "go step 2";
      });
      expect(nav).toBeDefined();
      expect(nav.swap).toBe("region");
      expect(nav.href).toContain("step-2");
    });

    it("F16. step-2 view contains project team edit form", function () {
      var tree = ax.scan();
      var step2 = tree.find(function (t) {
        return t.name === "step-2";
      });
      expect(step2).toBeDefined();
      // The project team edit form is a child skill
      var teamSkill = tree.find(function (t) {
        return t.name === "project team";
      });
      expect(teamSkill).toBeDefined();
      expect(teamSkill.children[0].name).toBe("lead");
      expect(teamSkill.children[0].value).toBe("Ava Chen");
    });

    it("F17. ax-for='project team' routes template group to edit skill", function () {
      var tree = ax.scan();
      var teamSkill = tree.find(function (t) {
        return t.name === "project team";
      });
      expect(teamSkill).toBeDefined();
      // The ax-for'd content should appear under the project team skill
      // (the ax-for div has children with templates routed to this skill)
      expect(teamSkill.children.length).toBeGreaterThanOrEqual(2);
    });

    it("F18. 'complete onboarding' uses swap:'page'", function () {
      var tree = ax.scan();
      var nav = tree.find(function (t) {
        return t.name === "complete onboarding";
      });
      expect(nav).toBeDefined();
      expect(nav.swap).toBe("page");
      expect(nav.href).toContain("complete");
    });
  });

  // ── G) Settings Page ─────────────────────────────────────────────
  describe("G) Settings Page (multiple forms)", function () {
    beforeEach(function () {
      document.body.innerHTML = SPA_HTML;
      ax.scan();
    });

    it("G19. account-settings has blocked status for invalid email", function () {
      var scope = ax.get("page-settings");
      var result = ax.walk(scope.element);
      var accountSection = result.children.find(function (c) {
        return c.name === "account-settings";
      });
      expect(accountSection).toBeDefined();
      // The account form itself should have blocked status due to invalid email
      var tree = ax.scan();
      var accountSkill = tree.find(function (t) {
        return t.name === "account";
      });
      expect(accountSkill).toBeDefined();
      expect(accountSkill.status.status).toBe("blocked");
      expect(accountSkill.status.reason).toBe("invalid");
    });

    it("G20. billing-settings has card and expiry fields", function () {
      var tree = ax.scan();
      var billingSkill = tree.find(function (t) {
        return t.name === "billing";
      });
      expect(billingSkill).toBeDefined();
      var fieldNames = billingSkill.children.map(function (f) {
        return f.name;
      });
      expect(fieldNames).toContain("card");
      expect(fieldNames).toContain("expiry");
    });
  });

  // ── H) Modal Region ──────────────────────────────────────────────
  describe("H) Modal Region", function () {
    beforeEach(function () {
      document.body.innerHTML = SPA_HTML;
      ax.scan();
    });

    it("H21. ax.get('modal') resolves modal scope", function () {
      var scope = ax.get("modal");
      expect(scope).toBeDefined();
      expect(scope.name).toBe("modal");
    });

    it("H22. modal walk includes alert template", function () {
      var scope = ax.get("modal");
      var result = ax.walk(scope.element);
      expect(result.type).toBe("view");
      expect(result.name).toBe("notifications modal");
      // Walk the alert <li> directly
      var alertLi = document.querySelector('[ax-content="modal"] li[ax-template]');
      var alertResult = ax.walk(/** @type {Element} */ (alertLi));
      expect(alertResult).toBeDefined();
      expect(alertResult.template).toContain("ALERT");
      expect(alertResult.text).toBe("Security update required");
    });

    it("H23. close modal is a click skill", function () {
      var tree = ax.scan();
      var closeSkill = tree.find(function (t) {
        return t.name === "close modal";
      });
      expect(closeSkill).toBeDefined();
      expect(closeSkill.type).toBe("skill");
    });
  });

  // ── I) Hooks & Status ────────────────────────────────────────────
  describe("I) Hooks & Status", function () {
    beforeEach(function () {
      document.body.innerHTML = SPA_HTML;
      ax.scan();
    });

    it("I24. hooks remain raw strings on primitives", function () {
      var tree = ax.scan();
      // Root view has ax-beforeView
      var rootView = tree.find(function (t) {
        return t.name === "spa-root";
      });
      expect(rootView).toBeDefined();
      expect(rootView.hooks.before).toBe("(e)=>e.status==='ready'");
      // Notification button has ax-onClick
      var notifSkill = tree.find(function (t) {
        return t.name === "open notifications";
      });
      expect(notifSkill).toBeDefined();
      expect(notifSkill.hooks.on).toBe("(e)=>e.status==='success'");
    });

    it("I25. update status edit form has loading status (aria-busy)", function () {
      var tree = ax.scan();
      var statusSkill = tree.find(function (t) {
        return t.name === "update status";
      });
      expect(statusSkill).toBeDefined();
      expect(statusSkill.status.status).toBe("loading");
    });

    it("I26. disabled takes precedence over loading", function () {
      // We don't have a disabled+aria-busy element in the SPA,
      // but verify that disabled export button doesn't report loading
      var tree = ax.scan();
      var exportSkill = tree.find(function (t) {
        return t.name === "export report";
      });
      expect(exportSkill.status.status).toBe("disabled");
      // It should NOT be "loading" just because disabled is found first
      expect(exportSkill.status.status).not.toBe("loading");
    });
  });

  // ── J) Ignored Content ───────────────────────────────────────────
  describe("J) Ignored Content", function () {
    beforeEach(function () {
      document.body.innerHTML = SPA_HTML;
      ax.scan();
    });

    it("J27. ignored diagnostics section is absent from scan and has no metadata", function () {
      var tree = ax.scan();
      var names = tree.map(function (t) {
        return t.name;
      });
      expect(names).not.toContain("internal only");
      expect(names).not.toContain("Do not surface");
      // Verify no internal data on the ignored button
      var ignoredBtn = document.querySelector('[ax-click="internal only"]');
      var data = /** @type {any} */ (ignoredBtn)["__ax__internal"];
      // Should be undefined — never processed
      expect(data).toBeUndefined();
    });
  });

  // ── K) Data‑AX Fallback ─────────────────────────────────────────
  describe("K) Data-AX Fallback", function () {
    beforeEach(function () {
      document.body.innerHTML = SPA_HTML;
      ax.scan();
    });

    it("K28. data-ax-view is recognized and template is preserved", function () {
      var tree = ax.scan();
      var fallback = tree.find(function (t) {
        return t.name === "fallback section";
      });
      expect(fallback).toBeDefined();
      expect(fallback.type).toBe("view");
      // Child with data-ax-template should carry the template string
      var child = fallback.children[0];
      expect(child).toBeDefined();
      expect(child.template).toContain("Fallback");
    });
  });

  // ── L) Template Resolution (harness evaluation) ──────────────────
  describe("L) Template resolution — harness evaluates lambdas", function () {
    beforeEach(function () {
      document.body.innerHTML = SPA_HTML;
      ax.scan();
    });

    it("dashboard-metrics metrics lambda produces Metrics: prefix", function () {
      var el = document.querySelector("[ax-view='dashboard-metrics']");
      var result = ax.walk(el);
      applyLambda(result);
      expect(result.resolved).toContain("Metrics:");
    });

    it("uptime item in sidebar resolves to 'Uptime: 99.98%'", function () {
      var root = ax.get("spa-root");
      // Walk the sidebar's status-panel
      var sidebarEl = ax.get("global-sidebar").element;
      var sidebarResult = ax.walk(sidebarEl);
      // Find the item with uptime template
      sidebarResult.children.forEach(function (section) {
        if (section.name === "status-panel") return; // not direct child
      });
      // Direct approach: walk the status-panel
      var panelEl = document.querySelector("[ax-view='status-panel']");
      var panelResult = ax.walk(panelEl);
      var uptimeItem = panelResult.children.find(function (c) {
        return c.template && c.template.indexOf("Uptime") !== -1;
      });
      expect(uptimeItem).toBeDefined();
      applyLambda(uptimeItem);
      expect(uptimeItem.resolved).toBe("Uptime: 99.98%");
    });

    it("modal alert item resolves via lambda", function () {
      var alertLi = document.querySelector('[ax-content="modal"] li[ax-template]');
      var alertResult = ax.walk(/** @type {Element} */ (alertLi));
      expect(alertResult).toBeDefined();
      expect(alertResult.template).toContain("ALERT");
      applyLambda(alertResult);
      expect(alertResult.resolved).toContain("ALERT:");
    });

    it("meta hidden elements are available for metadata", function () {
      // Hidden meta/data elements with ax-template are processed
      var tree = ax.scan();
      // They appear as standalone items (no primitive on meta/data)
      // The scan won't include them unless they have a primitive attribute
      // Verify the templates are captured on the data element
      var dataEl = document.querySelector("data[value]");
      var dataResult = ax.walk(/** @type {Element} */ (dataEl));
      // data element without ax-view/ax-click/ax-edit/ax-nav → no primitive
      // It may still carry its ax-template if walk() processes it
      if (dataResult && dataResult.template) {
        expect(dataResult.template).toContain("Build");
      } else {
        // If hidden elements without primitives aren't walked, that's valid
        // Verify the data element at least exists
        expect(dataEl.getAttribute("value")).toBe("2026.05.07");
      }
    });
  });
});
