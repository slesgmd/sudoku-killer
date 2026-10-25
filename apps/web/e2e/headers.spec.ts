// Cabeceras del sitio (F12, S-05): `vite preview` sirve las mismas que `render.yaml`, y el detector
// de violaciones de la CSP que usan todas las E2E (fixture `player`) ve un script en línea bloqueado
// (control, como el de T-31.2).
import { contentSecurityPolicy, securityHeaders } from "../scripts/security-headers.ts";
import { expect, test, watchCsp } from "./fixtures.ts";

test("S-05 the site sends its security headers, and an inline script is blocked and reported (control)", async ({
  browser,
}) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const violations: string[] = [];
    watchCsp(page, violations);
    const response = await page.goto("/");
    const headers = response?.headers() ?? {};
    for (const { name, value } of securityHeaders(null))
      expect(headers[name.toLowerCase()], name).toBe(value);
    expect(headers["content-security-policy"]).toBe(contentSecurityPolicy(null));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(violations).toEqual([]);

    // Un script en línea, como el que dejaría un XSS: la CSP lo bloquea y el detector lo ve.
    await page.evaluate(() => {
      const script = document.createElement("script");
      script.textContent = "window.injected = true";
      document.body.append(script);
    });
    await expect.poll(() => violations.length).toBeGreaterThan(0);
    expect(await page.evaluate(() => "injected" in window)).toBe(false);
  } finally {
    await context.close();
  }
});
