import { type Page, expect, test } from "@playwright/test";

/** Check real, permission-scoped operational tables at phone and desktop widths. */
export async function expectResponsiveTables(page: Page) {
  const tables = page.locator("main table");
  expect(await tables.count()).toBeGreaterThan(0);
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const table of await tables.all()) {
      await expect(table).toHaveClass(/responsive-table/);
      expect(await table.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      expect(
        await table.evaluate((element) => element.getBoundingClientRect().right <= innerWidth + 1),
      ).toBe(true);
      const rows = table.locator("tbody > tr");
      if ((await rows.count()) > 0) {
        expect(await rows.first().evaluate((element) => getComputedStyle(element).display)).toBe(
          width < 640 ? "block" : "table-row",
        );
      }
      const labels = await table.evaluate((element) => {
        const headings = Array.from(element.querySelectorAll("thead th"), (node) =>
          node.textContent?.trim(),
        );
        return Array.from(element.querySelectorAll("tbody > tr"), (row) => {
          let column = 0;
          return Array.from(row.querySelectorAll("td"), (cell) => {
            const expected = headings.slice(column, column + cell.colSpan).join(" / ");
            column += cell.colSpan;
            return {
              expected,
              actual: cell.querySelector(".responsive-table-label")?.textContent?.trim(),
            };
          });
        }).flat();
      });
      for (const label of labels) expect(label.actual).toBe(label.expected);
      for (const button of await table.getByRole("button").all()) {
        expect(
          await button.evaluate(
            (element) => element.getBoundingClientRect().right <= innerWidth + 1,
          ),
        ).toBe(true);
      }
    }
  }
  // Keep the rest of the existing workflow on the phone, including dialogs and form submission.
  await page.screenshot({
    path: test.info().outputPath(`mobile-${new URL(page.url()).pathname.replaceAll("/", "-")}.png`),
    fullPage: true,
  });
}
