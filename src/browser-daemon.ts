import { chromium } from "playwright";
import { loadPlaybook } from "./playbook-io.js";
import { executeSetup } from "./setup.js";
import { zoomExtensionArgs, setBrowserZoom } from "./zoom.js";
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
  const userDataDir = path.join(".ndemo", "browser-profile");
  fs.mkdirSync(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--remote-debugging-port=${debugPort}`,
      `--window-size=${playbook.app.viewport.width},${playbook.app.viewport.height}`,
      `--force-device-scale-factor=1`,
      "--high-dpi-support=1",
      "--enable-gpu-rasterization",
      "--disable-lcd-text",
      "--font-render-hinting=medium",
      "--disable-default-apps",
      "--no-first-run",
      "--disable-infobars",
      "--disable-translate",
      "--disable-sync",
      "--disable-features=ChromeWhatsNewUI,MediaRouter",
      ...zoomExtensionArgs(),
    ],
    viewport: {
      width: playbook.app.viewport.width,
      height: playbook.app.viewport.height,
    },
    deviceScaleFactor: 1,
    colorScheme: playbook.app.colorScheme,
    locale: "en-US",
  });

  const page = context.pages()[0] || await context.newPage();

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

  // Wait for the zoom extension's service worker to be ready.
  if (context.serviceWorkers().length === 0) {
    await context.waitForEvent("serviceworker", { timeout: 5000 });
  }

  await page.goto(playbook.app.url, { waitUntil: "load" });

  // Apply real browser zoom via the extension
  await setBrowserZoom(page, playbook.app.zoom * 100);

  // Execute setup steps if any
  if (playbook.app.setup) {
    await executeSetup(page, playbook.app.setup);
  }

  // Stay alive. Exit when browser closes.
  context.browser()?.on("disconnected", () => process.exit(0));

  // Handle SIGTERM gracefully
  process.on("SIGTERM", async () => {
    await context.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(JSON.stringify({ error: String(err) }));
  process.exit(1);
});
