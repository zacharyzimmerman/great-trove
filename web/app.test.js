// UI regression tests for Great Trove PWA
// Run: node --test web/app.test.js

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const __dirname = dirname(fileURLToPath(import.meta.url));

const indexHtml = readFileSync(join(__dirname, "index.html"), "utf-8");
const appJs = readFileSync(join(__dirname, "app.js"), "utf-8");
const fixtureData = JSON.parse(
  readFileSync(join(__dirname, "test-fixture.json"), "utf-8")
);

// Strip external script/link tags from HTML — we inject app.js manually
function cleanHtml(html) {
  return html
    .replace(/<link rel="stylesheet" href="https:\/\/[^"]+"/g, "")
    .replace(/<script src="https:\/\/[^"]+"><\/script>/g, "")
    .replace(/<script src="app\.js[^"]*"><\/script>/g, "");
}

// Minimal GreatApp framework mock
const frameworkMock = `
  const GreatApp = (() => {
    const $ = (sel) => document.querySelector(sel);
    function showView(viewId) {
      document.querySelectorAll(".view").forEach((v) => (v.hidden = true));
      $(viewId).hidden = false;
    }
    function initSearchToggle() {}
    function initKeyboard() {}
    function registerSW() {}
    return { $, showView, initSearchToggle, initKeyboard, registerSW };
  })();
`;

// Fetch stub script — must run before app.js so loadBundle() gets our data
const fetchStub = `
  window.fetch = async function(url) {
    if (url.includes("trove-bundle")) {
      return {
        ok: true,
        json: async () => (${JSON.stringify(fixtureData)})
      };
    }
    return { ok: false, status: 404 };
  };
  // Stub service worker
  if (!navigator.serviceWorker) {
    Object.defineProperty(navigator, "serviceWorker", {
      value: { register: () => Promise.resolve(), addEventListener: () => {} },
      writable: true
    });
  }
`;

function createApp() {
  // Inject stubs, framework mock, and app.js as inline scripts
  const htmlWithScripts = cleanHtml(indexHtml).replace(
    "</body>",
    `<script>${fetchStub}</script>` +
    `<script>${frameworkMock}</script>` +
    `<script>${appJs}</script>` +
    `</body>`
  );

  const dom = new JSDOM(htmlWithScripts, {
    url: "http://localhost:3000/",
    pretendToBeVisual: true,
    runScripts: "dangerously",
  });

  return { dom, window: dom.window, document: dom.window.document };
}

// Wait for loadBundle to complete (async)
async function waitForLoad(window) {
  // loadBundle is async and called from init(). Give it a tick to resolve.
  await new Promise((r) => setTimeout(r, 50));
}

describe("App initialization", () => {
  let env;

  before(async () => {
    env = createApp();
    await waitForLoad(env.window);
  });

  it("should load bundle and populate contest list", () => {
    const rows = env.document.querySelectorAll("#contest-list .item-row");
    assert.ok(rows.length > 0, "Should render at least one event row");
  });

  it("should show list view by default", () => {
    const listView = env.document.querySelector("#list-view");
    assert.equal(listView.hidden, false, "List view should be visible");
  });

  it("should set default filter to International Quartet", () => {
    const season = env.document.querySelector("#season-filter");
    const category = env.document.querySelector("#category-filter");
    assert.equal(season.value, "International");
    assert.equal(category.value, "Quartet");
  });

  it("should populate year filter", () => {
    const options = env.document.querySelectorAll("#year-filter option");
    assert.ok(options.length > 1, "Should have year options beyond 'All Years'");
  });

  it("should show event count in footer", () => {
    const count = env.document.querySelector("#contest-count");
    assert.ok(count.textContent.includes("event"), "Should show event count");
  });
});

describe("Event grouping", () => {
  let env;

  before(async () => {
    env = createApp();
    await waitForLoad(env.window);
  });

  it("should separate Varsity from main stage events", () => {
    // Clear filters to see all events
    env.document.querySelector("#season-filter").value = "";
    env.document.querySelector("#category-filter").value = "";
    env.document.querySelector("#search").value = "";
    env.document.querySelector("#search").dispatchEvent(
      new env.window.Event("input")
    );

    const rows = env.document.querySelectorAll("#contest-list .item-row");
    const titles = [...rows].map(
      (r) => r.querySelector(".item-title")?.textContent || ""
    );

    const mainStage = titles.filter(
      (t) => t.includes("Quartet") && !t.includes("Varsity")
    );
    const varsity = titles.filter((t) => t.includes("Varsity"));

    assert.ok(
      mainStage.length > 0,
      "Should have at least one main stage Quartet event"
    );
    assert.ok(
      varsity.length > 0,
      "Should have at least one Varsity event"
    );

    // They should be separate events
    for (const v of varsity) {
      assert.ok(
        !mainStage.includes(v),
        "Varsity should not be in main stage list"
      );
    }
  });
});

describe("Event detail (showEvent)", () => {
  let env;

  before(async () => {
    env = createApp();
    await waitForLoad(env.window);
  });

  it("should navigate to event detail when clicking a row", () => {
    const row = env.document.querySelector("#contest-list .item-row");
    assert.ok(row, "Should have at least one event row to click");
    row.click();

    const contestView = env.document.querySelector("#contest-view");
    assert.equal(contestView.hidden, false, "Contest view should be visible after click");
  });

  it("should render event title", () => {
    const title = env.document.querySelector("#contest-title");
    assert.ok(
      title.textContent.length > 0,
      "Contest title should not be empty"
    );
  });

  it("should render scores table with data", () => {
    const tables = env.document.querySelectorAll(
      "#rounds-container .scores-table"
    );
    assert.ok(tables.length > 0, "Should render at least one scores table");

    const rows = tables[0].querySelectorAll("tbody tr");
    assert.ok(rows.length > 0, "Scores table should have data rows");
  });

  it("should show placement numbers", () => {
    const firstCell = env.document.querySelector(
      "#rounds-container .scores-table tbody tr td:first-child"
    );
    assert.ok(firstCell, "Should have a placement cell");
    assert.ok(
      firstCell.textContent.trim() !== "",
      "Placement should not be empty"
    );
  });

  it("should show group names as entity links", () => {
    const links = env.document.querySelectorAll(
      '#rounds-container .entity-link[data-type="group"]'
    );
    assert.ok(links.length > 0, "Should have group entity links");
  });

  it("should render category columns (MUS, PER, SNG)", () => {
    const headers = env.document.querySelectorAll(
      "#rounds-container .scores-table thead th"
    );
    const headerTexts = [...headers].map((h) => h.textContent);
    // Look for typical BHS categories
    const hasCats = headerTexts.some(
      (t) => t === "MUS" || t === "PER" || t === "SNG"
    );
    assert.ok(hasCats, "Should render category columns in table header");
  });

  it("should show either Avg % or Total column", () => {
    const headers = env.document.querySelectorAll(
      "#rounds-container .scores-table thead th"
    );
    const headerTexts = [...headers].map((h) => h.textContent);
    const hasScoreCol = headerTexts.some(
      (t) => t === "Avg %" || t === "Total"
    );
    assert.ok(hasScoreCol, "Should have either 'Avg %' or 'Total' column");
  });
});

describe("showContest navigation", () => {
  let env;

  before(async () => {
    env = createApp();
    await waitForLoad(env.window);
  });

  it("should navigate to parent event when contest ID is used", () => {
    // Get the first contest ID from our fixture
    const contestId = fixtureData.contests[0].id;

    // Simulate navigateTo("contest", id) — this should find the parent event and show it
    env.window.eval(`navigateTo("contest", ${contestId})`);

    const contestView = env.document.querySelector("#contest-view");
    assert.equal(
      contestView.hidden,
      false,
      "Contest view should be visible after navigating by contest ID"
    );

    // Should have rendered scores
    const tables = env.document.querySelectorAll(
      "#rounds-container .scores-table"
    );
    assert.ok(
      tables.length > 0,
      "Should render scores table when navigating by contest ID"
    );
  });
});

describe("Group detail navigation", () => {
  let env;

  before(async () => {
    env = createApp();
    await waitForLoad(env.window);
  });

  it("should show group detail when clicking a group entity link", () => {
    // First navigate to an event
    const row = env.document.querySelector("#contest-list .item-row");
    row.click();

    // Find a group entity link in the scores table
    const groupLink = env.document.querySelector(
      '#rounds-container .entity-link[data-type="group"]'
    );
    assert.ok(groupLink, "Should have a group link to click");

    groupLink.click();

    const groupView = env.document.querySelector("#group-view");
    assert.equal(
      groupView.hidden,
      false,
      "Group view should be visible after clicking group link"
    );

    const groupName = env.document.querySelector("#group-name");
    assert.ok(
      groupName.textContent.length > 0,
      "Group name should not be empty"
    );
  });
});

describe("Filtering", () => {
  let env;

  before(async () => {
    env = createApp();
    await waitForLoad(env.window);
  });

  it("should filter by year", () => {
    // Clear default filters first
    env.document.querySelector("#season-filter").value = "";
    env.document.querySelector("#category-filter").value = "";

    const allRows = env.document.querySelectorAll(
      "#contest-list .item-row"
    ).length;

    // Filter to a year that exists in fixture
    env.document.querySelector("#year-filter").value = String(
      fixtureData.contests[0].year
    );
    env.document.querySelector("#year-filter").dispatchEvent(
      new env.window.Event("change")
    );

    const filteredRows = env.document.querySelectorAll(
      "#contest-list .item-row"
    ).length;
    assert.ok(
      filteredRows > 0,
      "Should show events for the selected year"
    );
    assert.ok(
      filteredRows <= allRows,
      "Filtered count should not exceed total"
    );
  });

  it("should show empty state for no results", () => {
    // Use search text that won't match anything
    env.document.querySelector("#year-filter").value = "";
    env.document.querySelector("#season-filter").value = "";
    env.document.querySelector("#category-filter").value = "";
    env.document.querySelector("#search").value =
      "xyznonexistentgroupname12345";
    env.window.eval("refreshList()");

    const empty = env.document.querySelector("#contest-list .empty-state");
    assert.ok(empty, "Should show empty state when no results");
    assert.ok(
      empty.textContent.includes("No contests"),
      "Empty state should say 'No contests found'"
    );
  });

  it("should filter by search text", () => {
    // Reset year filter
    env.document.querySelector("#year-filter").value = "";
    env.document.querySelector("#season-filter").value = "";
    env.document.querySelector("#category-filter").value = "";

    // Get a group name from fixture to search for
    const groupId = fixtureData.contests[0].scores[0]?.groupId;
    const groupName = fixtureData.groups[groupId]?.name;
    if (!groupName) return; // skip if no group data

    env.document.querySelector("#search").value = groupName.substring(0, 5);
    env.document.querySelector("#search").dispatchEvent(
      new env.window.Event("input")
    );

    const rows = env.document.querySelectorAll("#contest-list .item-row");
    assert.ok(rows.length > 0, "Should find events matching search text");
  });
});

describe("Hash navigation (deep links)", () => {
  let env;

  before(async () => {
    env = createApp();
    await waitForLoad(env.window);
  });

  it("should navigate to event via hash", () => {
    // Build an event key to navigate to — get it from eventsArray
    const eventKey = env.window.eval("eventsArray[0]?.key");
    assert.ok(eventKey, "Should have at least one event key");

    env.window.eval(
      `navigateToHash("#event/${encodeURIComponent(eventKey)}", false)`
    );

    const contestView = env.document.querySelector("#contest-view");
    assert.equal(
      contestView.hidden,
      false,
      "Contest view should be visible after hash navigation"
    );
  });

  it("should return to list view for empty hash", () => {
    env.window.eval('navigateToHash("#", false)');

    const listView = env.document.querySelector("#list-view");
    assert.equal(
      listView.hidden,
      false,
      "List view should be visible after empty hash"
    );
  });
});

describe("renderScoresTableInto (regression: TDZ bug)", () => {
  let env;

  before(async () => {
    env = createApp();
    await waitForLoad(env.window);
  });

  it("should not throw when rendering scores", () => {
    // Create a container with a unique ID
    const container = env.document.createElement("div");
    container.id = "tdz-test";
    env.document.body.appendChild(container);

    const contest = fixtureData.contests.find((c) => c.scores?.length > 0);
    assert.ok(contest, "Need a contest with scores for this test");

    // This would throw with the TDZ bug (sorted used before declaration)
    assert.doesNotThrow(() => {
      env.window.eval(`
        renderScoresTableInto(
          document.getElementById("tdz-test"),
          ${JSON.stringify(contest)}
        );
      `);
    }, "renderScoresTableInto should not throw");

    // Verify it actually rendered a table
    const table = container.querySelector(".scores-table");
    assert.ok(table, "Should have rendered a scores table");
  });

  it("should display percentage when available", () => {
    const container = env.document.createElement("div");
    container.id = "pct-test";
    env.document.body.appendChild(container);

    // Create a contest with percentage data
    const contestWithPct = {
      scores: [
        {
          groupId: Object.keys(fixtureData.groups)[0],
          placement: 1,
          total: 2000,
          percentage: 85.3,
          categories: { MUS: 700, PER: 650, SNG: 650 },
          songs: [],
          members: [],
        },
      ],
      judges: [],
    };

    env.window.eval(`
      renderScoresTableInto(
        document.querySelector("#pct-test"),
        ${JSON.stringify(contestWithPct)}
      );
    `);

    const headers = container.querySelectorAll(".scores-table thead th");
    const headerTexts = [...headers].map((h) => h.textContent);
    assert.ok(
      headerTexts.includes("Avg %"),
      "Should show 'Avg %' header when percentage data present"
    );

    const cells = container.querySelectorAll(".scores-table tbody td");
    const cellTexts = [...cells].map((c) => c.textContent);
    assert.ok(
      cellTexts.some((t) => t.includes("85.3%")),
      "Should display percentage value"
    );
  });

  it("should display Total when no percentage data", () => {
    const container = env.document.createElement("div");
    container.id = "total-test";
    env.document.body.appendChild(container);

    const contestNoPct = {
      scores: [
        {
          groupId: Object.keys(fixtureData.groups)[0],
          placement: 1,
          total: 2000,
          percentage: null,
          categories: { MUS: 700, PER: 650, SNG: 650 },
          songs: [],
          members: [],
        },
      ],
      judges: [],
    };

    env.window.eval(`
      renderScoresTableInto(
        document.querySelector("#total-test"),
        ${JSON.stringify(contestNoPct)}
      );
    `);

    const headers = container.querySelectorAll(".scores-table thead th");
    const headerTexts = [...headers].map((h) => h.textContent);
    assert.ok(
      headerTexts.includes("Total"),
      "Should show 'Total' header when no percentage data"
    );
  });
});

describe("Multi-round event rendering", () => {
  let env;

  before(async () => {
    env = createApp();
    await waitForLoad(env.window);
  });

  it("should render multiple round sections for multi-round events", () => {
    // Find the main stage International Quartet event (should have Final, Semi, QF)
    const eventKey = env.window.eval(`
      eventsArray.find(e =>
        e.season === "International" &&
        e.category === "Quartet" &&
        e.subEvent === "main" &&
        e.contests.length > 1
      )?.key
    `);

    if (!eventKey) return; // skip if fixture doesn't have multi-round event

    env.window.eval(`showEvent("${eventKey}")`);

    const roundSections = env.document.querySelectorAll(
      "#rounds-container .round-section"
    );
    assert.ok(
      roundSections.length > 1,
      `Should render multiple round sections, got ${roundSections.length}`
    );
  });

  it("should show round headers for multi-round events", () => {
    const headers = env.document.querySelectorAll(
      "#rounds-container .round-header"
    );
    // Only check if we're on a multi-round view
    const sections = env.document.querySelectorAll(
      "#rounds-container .round-section"
    );
    if (sections.length > 1) {
      assert.ok(
        headers.length > 0,
        "Should show round headers for multi-round events"
      );
    }
  });
});
