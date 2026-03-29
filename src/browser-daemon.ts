import { chromium } from "playwright";
import { loadPlaybook } from "./playbook-io.js";
import { executeSetup } from "./setup.js";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        reject(new Error("Could not find free port"));
      }
    });
    server.on("error", reject);
  });
}

async function main() {
  const playbookPath = process.argv[2];
  if (!playbookPath) {
    console.error(JSON.stringify({ error: "No playbook path provided" }));
    process.exit(1);
  }

  const playbook = loadPlaybook(playbookPath);
  const debugPort = await findFreePort();

  const browser = await chromium.launch({
    headless: false,
    args: [
      `--remote-debugging-port=${debugPort}`,
      `--window-size=${playbook.app.viewport.width},${playbook.app.viewport.height}`,
      `--force-device-scale-factor=${playbook.app.scale}`,
      "--high-dpi-support=1",
      "--enable-gpu-rasterization",
      "--disable-lcd-text",
      "--font-render-hinting=medium",
      "--disable-extensions",
      "--disable-default-apps",
      "--no-first-run",
      "--disable-infobars",
      "--disable-translate",
      "--disable-sync",
      "--disable-features=ChromeWhatsNewUI,MediaRouter",
    ],
  });

  const context = await browser.newContext({
    viewport: {
      width: playbook.app.viewport.width,
      height: playbook.app.viewport.height,
    },
    deviceScaleFactor: playbook.app.scale,
    colorScheme: playbook.app.colorScheme,
    locale: "en-US",
  });

  const page = await context.newPage();

  // Apply zoom via init script
  await page.addInitScript(`
    document.addEventListener('DOMContentLoaded', () => {
      document.body.style.zoom = '${playbook.app.zoom}';
    });
  `);

  // Print connection info to stdout BEFORE navigation so the parent
  // unblocks immediately — page load and setup can take arbitrarily long.
  const cdpEndpoint = `http://localhost:${debugPort}`;
  console.log(JSON.stringify({ wsEndpoint: cdpEndpoint }));

  // Reopen stdout/stderr to a log file so the daemon doesn't crash with
  // EPIPE when the parent exits and closes its end of the pipes.
  // Errors during navigation/setup will be visible in .ndemo/daemon.log.
  const logPath = path.join(".ndemo", "daemon.log");
  fs.mkdirSync(".ndemo", { recursive: true });
  fs.closeSync(1);
  fs.closeSync(2);
  fs.openSync(logPath, "w"); // becomes fd 1 (stdout)
  fs.openSync(logPath, "w"); // becomes fd 2 (stderr)

  await page.goto(playbook.app.url, { waitUntil: "load" });

  // Ensure zoom is applied
  await page.evaluate(
    (z: number) => { document.body.style.zoom = String(z); },
    playbook.app.zoom
  );

  // Execute setup steps if any
  if (playbook.app.setup) {
    await executeSetup(page, playbook.app.setup);
  }

  // Stay alive. Exit when browser closes.
  browser.on("disconnected", () => process.exit(0));

  // Handle SIGTERM gracefully
  process.on("SIGTERM", async () => {
    await browser.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(JSON.stringify({ error: String(err) }));
  process.exit(1);
});
