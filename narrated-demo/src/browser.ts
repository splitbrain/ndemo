import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { loadPlaybook } from "./playbook-io.js";
import { executeAction } from "./executor.js";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INFO_DIR = ".ndemo";
const INFO_PATH = path.join(INFO_DIR, "browser.json");

interface BrowserInfo {
  wsEndpoint: string;
  pid: number;
  playbookPath: string;
}

interface BrowserConnection {
  browser: Browser;
  page: Page;
}

async function open(playbookPath: string): Promise<void> {
  const absPlaybook = path.resolve(playbookPath);

  // Check if already running
  if (fs.existsSync(INFO_PATH)) {
    const existing = JSON.parse(fs.readFileSync(INFO_PATH, "utf-8"));
    try {
      process.kill(existing.pid, 0);
      console.log(`Browser daemon already running (PID ${existing.pid}). Use \`ndemo close\` first.`);
      return;
    } catch {
      // Dead process, clean up
      fs.rmSync(INFO_DIR, { recursive: true });
    }
  }

  const daemonScript = path.join(__dirname, "browser-daemon.js");
  const child = spawn(
    process.execPath,
    [daemonScript, absPlaybook],
    {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  // Read connection info from daemon stdout
  const info = await new Promise<{ wsEndpoint: string }>((resolve, reject) => {
    let output = "";
    let errOutput = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Browser daemon did not start within 15s. stderr: ${errOutput}`));
    }, 15000);

    child.stdout!.on("data", (data: Buffer) => {
      output += data.toString();
      try {
        const parsed = JSON.parse(output);
        clearTimeout(timeout);
        resolve(parsed);
      } catch {
        // Not complete JSON yet
      }
    });

    child.stderr!.on("data", (data: Buffer) => {
      errOutput += data.toString();
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Browser daemon exited with code ${code}. stderr: ${errOutput}`));
      }
    });
  });

  // Detach so daemon survives
  child.unref();

  // Write connection info
  fs.mkdirSync(INFO_DIR, { recursive: true });
  fs.writeFileSync(INFO_PATH, JSON.stringify({
    wsEndpoint: info.wsEndpoint,
    pid: child.pid,
    playbookPath: absPlaybook,
  }));

  console.log(`Browser daemon started (PID ${child.pid})`);
  const playbook = loadPlaybook(absPlaybook);
  console.log(`Connected to ${playbook.app.url}`);
  console.log("Ready.");
}

async function connect(): Promise<BrowserConnection> {
  if (!fs.existsSync(INFO_PATH)) {
    throw new Error(
      "No browser session found. Run `ndemo open <playbook.yaml>` first."
    );
  }

  const info: BrowserInfo = JSON.parse(fs.readFileSync(INFO_PATH, "utf-8"));

  // Verify daemon is still alive
  try {
    process.kill(info.pid, 0);
  } catch {
    fs.rmSync(INFO_DIR, { recursive: true });
    throw new Error(
      "Browser daemon is dead. Run `ndemo open <playbook.yaml>` again."
    );
  }

  const browser = await chromium.connectOverCDP(info.wsEndpoint);
  const contexts = browser.contexts();
  if (contexts.length === 0) throw new Error("No browser context found");
  const pages = contexts[0].pages();
  if (pages.length === 0) throw new Error("No page found");

  return { browser, page: pages[0] };
}

async function close(): Promise<void> {
  if (!fs.existsSync(INFO_PATH)) {
    console.log("No browser session to close.");
    return;
  }

  const info: BrowserInfo = JSON.parse(fs.readFileSync(INFO_PATH, "utf-8"));

  try {
    const browser = await chromium.connectOverCDP(info.wsEndpoint);
    await browser.close();
  } catch {
    try {
      process.kill(info.pid, "SIGTERM");
    } catch {
      // Already dead
    }
  }

  fs.rmSync(INFO_DIR, { recursive: true });
  console.log("Browser closed.");
}

async function reset(): Promise<void> {
  const { page } = await connect();
  const info: BrowserInfo = JSON.parse(fs.readFileSync(INFO_PATH, "utf-8"));
  const playbook = loadPlaybook(info.playbookPath);

  await page.goto(playbook.app.url, { waitUntil: "networkidle" });
  await page.evaluate(
    (z: number) => { document.body.style.zoom = String(z); },
    playbook.app.zoom
  );

  if (playbook.app.setup) {
    for (const action of playbook.app.setup) {
      await executeAction(page, action);
    }
  }

  console.log(`Reset to ${playbook.app.url}`);
}

export { open, connect, close, reset };
export type { BrowserInfo, BrowserConnection };
