import fs from "node:fs";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { loadPlaybook } from "./playbook-io.js";
import { executeSetup } from "./setup.js";
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

/**
 * Kill a process and all its children.
 */
function killProcessTree(pid: number): void {
  try {
    // Kill the entire process group (negative PID)
    process.kill(-pid, "SIGKILL");
  } catch {
    // Process group kill failed, try individual kill
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already dead
    }
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function open(playbookPath: string): Promise<void> {
  const absPlaybook = path.resolve(playbookPath);

  // Check if already running
  if (fs.existsSync(INFO_PATH)) {
    const existing = JSON.parse(fs.readFileSync(INFO_PATH, "utf-8"));
    if (isProcessAlive(existing.pid)) {
      console.log(`Browser daemon already running (PID ${existing.pid}). Use \`ndemo close\` first.`);
      return;
    }
    // Dead process, clean up
    fs.rmSync(INFO_DIR, { recursive: true });
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

  if (!isProcessAlive(info.pid)) {
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

  // Kill the daemon process tree — this takes down both the node
  // daemon and the Chromium process it spawned.
  killProcessTree(info.pid);

  // Wait briefly for processes to die, then verify
  await new Promise(r => setTimeout(r, 500));

  if (isProcessAlive(info.pid)) {
    // Last resort: SIGKILL directly
    try { process.kill(info.pid, "SIGKILL"); } catch {}
  }

  fs.rmSync(INFO_DIR, { recursive: true });
  console.log("Browser closed.");
}

async function reset(): Promise<void> {
  const { page } = await connect();
  const info: BrowserInfo = JSON.parse(fs.readFileSync(INFO_PATH, "utf-8"));
  const playbook = loadPlaybook(info.playbookPath);

  await page.goto(playbook.app.url, { waitUntil: "load" });

  if (playbook.app.setup) {
    await executeSetup(page, playbook.app.setup);
  }

  console.log(`Reset to ${playbook.app.url}`);
}

export { open, connect, close, reset };
export type { BrowserInfo, BrowserConnection };
