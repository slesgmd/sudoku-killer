// Cabeceras del sitio (S-05): `vite preview` sirve las mismas que `render.yaml`, y el detector
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

test("T-45.2 the site icon and the manifest load under the real CSP", async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const violations: string[] = [];
    watchCsp(page, violations);
    const requested: string[] = [];
    page.on("request", (request) => {
      requested.push(new URL(request.url()).pathname);
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Una visita normal no descarga el icono de Android.
    expect(requested).not.toContain("/android-chrome-192x192.png");
    console.log(`T-45.2 pedido en una visita: ${requested.join(" ")}`);

    // El navegador sin ventana no pide el icono: se carga como imagen, bajo la CSP de la página.
    for (const [path, size] of [
      ["/favicon.ico", 48],
      ["/favicon-16x16.png", 16],
      ["/favicon-32x32.png", 32],
      ["/apple-touch-icon.png", 180],
      ["/android-chrome-192x192.png", 192],
    ] as const) {
      const natural = await page.evaluate(async (src) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        return image.naturalWidth;
      }, path);
      expect(natural, path).toBe(size);
      const response = await context.request.get(path);
      expect(response.status(), path).toBe(200);
      expect(response.headers()["content-type"], path).toMatch(/^image\//);
    }

    // El manifiesto, leído por el propio navegador, también bajo la CSP.
    const cdp = await context.newCDPSession(page);
    const manifest = await cdp.send("Page.getAppManifest");
    expect(manifest.errors).toEqual([]);
    expect(new URL(manifest.url).pathname).toBe("/site.webmanifest");
    expect(JSON.parse(manifest.data ?? "{}")).toMatchObject({
      name: "Sudoku Killer",
      display: "browser",
    });

    expect(violations).toEqual([]);
    // Negativa: una ruta que no existe no devuelve una imagen, así que la comprobación distingue.
    const missing = await context.request.get("/no-existe.ico");
    expect(missing.headers()["content-type"] ?? "").not.toMatch(/^image\//);
  } finally {
    await context.close();
  }
});
