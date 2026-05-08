import { describe, it, expect, beforeEach } from "bun:test";

let ax;

beforeEach(async () => {
  const mod = await import("../../src/index.js");
  ax = mod.default;
  document.body.innerHTML = "";
});

describe("scan output", () => {
  it("shows structure", () => {
    document.body.innerHTML = `
      <div ax-view="resume">
        <nav>
          <button ax-nav="switch to about" ax-swap="page">About</button>
          <button ax-nav="switch to experience" ax-swap="page">Experience</button>
        </nav>
        <section ax-view="about">
          <h1>Alex Chen</h1>
          <p>Senior Software Engineer</p>
          <a ax-nav="send email" ax-swap="page" href="mailto:a@b.com">a@b.com</a>
          <a ax-nav="view github" ax-swap="page" href="https://github.com">github</a>
        </section>
      </div>
    `;

    const tree = ax.scan();
    console.log(JSON.stringify(tree, null, 2));
  });
});
