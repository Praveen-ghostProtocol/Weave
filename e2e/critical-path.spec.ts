import { test, expect, type Locator, type Page } from "@playwright/test";

// Waits until a locator's bounding box reports the same rect on two
// consecutive reads, not just once. A single boundingBox() read (what this
// test originally did) can land mid-layout-shift on a cold run — first
// Turbopack compile, @xyflow/react's own async chunk + CSS load, and its
// fitView/viewport-init animation can all still be moving the node when a
// single read happens, producing stale coordinates the drag then misses.
// Polling for agreement across two reads is a real stability check, not
// just "query later" — it fails loudly (a clear timeout error) rather than
// silently racing again if the layout genuinely never settles.
async function waitForStableBox(locator: Locator, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let previous = await locator.boundingBox();
  while (Date.now() < deadline) {
    await locator.page().waitForTimeout(100);
    const current = await locator.boundingBox();
    if (
      previous &&
      current &&
      previous.x === current.x &&
      previous.y === current.y &&
      previous.width === current.width &&
      previous.height === current.height
    ) {
      return current;
    }
    previous = current;
  }
  throw new Error("element position never stabilized within timeout");
}

// SPEC.md's one required e2e path: create node -> link two nodes -> see
// them in graph view -> export context -> exported text contains both
// nodes' content.

// Each Playwright test already runs in its own fresh, non-persistent
// browser context, so IndexedDB starts empty — but we clear it explicitly
// anyway (belt-and-suspenders against a locally reused profile) before the
// app's own mount effect ever gets a chance to open it. Same init script
// also stubs navigator.clipboard.writeText: the real clipboard API throws/
// denies under Playwright's default permissions, and DESIGN.md's "Copied"
// label is just UI state — asserting the actual markdown the app tried to
// copy is the real check for "exported text contains both nodes' content".
async function prepPage(page: Page) {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase("weave");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          (window as unknown as { __copiedText: string }).__copiedText = text;
          return Promise.resolve();
        },
      },
    });
  });
  await page.goto("/");
}

test("create node, link two nodes, see them in graph view, export both", async ({ page }) => {
  await prepPage(page);

  async function createNode(title: string, domain: string, body: string) {
    await page.getByRole("button", { name: "+ New node" }).click();
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Domain").fill(domain);
    await page.getByLabel("Notes").fill(body);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("button", { name: "+ New node" })).toBeVisible();
  }

  const bodyA = "Shipping the v1 launch checklist by Friday.";
  const bodyB = "Saturday trail runs with the climbing crew.";
  await createNode("Launch Plan", "work", bodyA);
  await createNode("Trail Running", "fitness", bodyB);

  // See them in graph view.
  const nodeA = page.locator(".react-flow__node", { hasText: "Launch Plan" });
  const nodeB = page.locator(".react-flow__node", { hasText: "Trail Running" });
  await expect(nodeA).toBeVisible();
  await expect(nodeB).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);

  // Link the two nodes: drag from node A's source handle (bottom) to node
  // B's target handle (top) — the graph view's only linking affordance
  // (plan.md Open Question 3), no separate "Link" button.
  const sourceHandle = nodeA.locator(".react-flow__handle-bottom");
  const targetHandle = nodeB.locator(".react-flow__handle-top");
  const sourceBox = await waitForStableBox(sourceHandle);
  const targetBox = await waitForStableBox(targetHandle);

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
    steps: 10,
  });
  await page.mouse.up();

  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  // Export context: select node A only — exportContext pulls in its
  // one-hop neighbor (node B) automatically, so this also exercises the
  // neighbor-inclusion rule from SPEC.md's Graph & Export Semantics.
  // Export sidebar is a toggleable overlay now (DESIGN.md: never a
  // permanent third column), so open it first.
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.locator("li", { hasText: "Launch Plan" }).locator('input[type="checkbox"]').check();
  await page.locator("button[data-state]").click();

  const copiedText = await page.evaluate(
    () => (window as unknown as { __copiedText?: string }).__copiedText,
  );
  expect(copiedText).toBeTruthy();
  expect(copiedText).toContain(bodyA);
  expect(copiedText).toContain(bodyB);
});
