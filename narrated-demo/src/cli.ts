#!/usr/bin/env node

import { Command } from "commander";
import { open, close, reset } from "./browser.js";
import { connect } from "./browser.js";
import { readPageState } from "./page-reader.js";
import { play } from "./player.js";
import { render } from "./renderer.js";
import { loadPlaybook } from "./playbook-io.js";
import { execSync } from "node:child_process";
import fs from "node:fs";

const program = new Command();

program
  .name("ndemo")
  .description("Narrated demo video toolkit")
  .version("0.1.0");

// ─── open ────────────────────────────────────────────

program
  .command("open")
  .description("Launch browser daemon and navigate to app")
  .argument("<playbook>", "Path to playbook YAML file")
  .action(async (playbook: string) => {
    try {
      await open(playbook);
    } catch (err) {
      console.error(`Error: ${err}`);
      process.exit(1);
    }
  });

// ─── close ───────────────────────────────────────────

program
  .command("close")
  .description("Shut down browser daemon")
  .action(async () => {
    try {
      await close();
    } catch (err) {
      console.error(`Error: ${err}`);
      process.exit(1);
    }
  });

// ─── reset ───────────────────────────────────────────

program
  .command("reset")
  .description("Navigate back to app URL (fresh state)")
  .action(async () => {
    try {
      await reset();
    } catch (err) {
      console.error(`Error: ${err}`);
      process.exit(1);
    }
  });

// ─── page-state ──────────────────────────────────────

program
  .command("page-state")
  .description("Print current page accessibility tree")
  .option("--screenshot", "Also save a screenshot")
  .action(async (options: { screenshot?: boolean }) => {
    try {
      const { page } = await connect();
      const output = await readPageState(page, {
        screenshot: options.screenshot,
      });
      console.log(output);
    } catch (err) {
      console.error(`Error: ${err}`);
      process.exit(1);
    }
  });

// ─── play ────────────────────────────────────────────

program
  .command("play")
  .description("Play segments in the live browser")
  .argument("<playbook>", "Path to playbook YAML file")
  .option("--segment <id>", "Play just this segment")
  .option("--from <id>", "Play from this segment")
  .option("--to <id>", "Stop after this segment")
  .action(async (playbook: string, options: {
    segment?: string;
    from?: string;
    to?: string;
  }) => {
    try {
      await play(playbook, options);
    } catch (err) {
      console.error(`Error: ${err}`);
      process.exit(1);
    }
  });

// ─── render ──────────────────────────────────────────

program
  .command("render")
  .description("Full pipeline: TTS → replay → merge → mp4")
  .argument("<playbook>", "Path to playbook YAML file")
  .option("--output <path>", "Output file path")
  .action(async (playbook: string, options: { output?: string }) => {
    try {
      await render(playbook, options.output);
    } catch (err) {
      console.error(`Error: ${err}`);
      process.exit(1);
    }
  });

// ─── doctor ──────────────────────────────────────────

program
  .command("doctor")
  .description("Check dependencies")
  .action(async () => {
    let allOk = true;

    // Node version
    const nodeVersion = process.version;
    const nodeMajor = parseInt(nodeVersion.slice(1));
    if (nodeMajor >= 20) {
      console.log(`  ✓ node ${nodeVersion} (≥ 20 required)`);
    } else {
      console.log(`  ✗ node ${nodeVersion} (≥ 20 required)`);
      allOk = false;
    }

    // ffmpeg
    try {
      const ffmpegVersion = execSync("ffmpeg -version", { encoding: "utf-8" })
        .split("\n")[0]
        .match(/version\s+([\d.]+)/)?.[1] ?? "unknown";
      console.log(`  ✓ ffmpeg ${ffmpegVersion}`);
    } catch {
      console.log("  ✗ ffmpeg not found");
      allOk = false;
    }

    // ffprobe
    try {
      const ffprobeVersion = execSync("ffprobe -version", { encoding: "utf-8" })
        .split("\n")[0]
        .match(/version\s+([\d.]+)/)?.[1] ?? "unknown";
      console.log(`  ✓ ffprobe ${ffprobeVersion}`);
    } catch {
      console.log("  ✗ ffprobe not found");
      allOk = false;
    }

    // Playwright browsers
    try {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({ headless: true });
      await browser.close();
      console.log("  ✓ playwright browsers installed (chromium)");
    } catch {
      console.log("  ✗ playwright browsers not installed");
      console.log("    Run: npx playwright install chromium");
      allOk = false;
    }

    // OPENAI_API_KEY
    if (process.env.OPENAI_API_KEY) {
      console.log("  ✓ OPENAI_API_KEY is set");
    } else {
      console.log("  ✗ OPENAI_API_KEY not set (required for TTS)");
      allOk = false;
    }

    // ELEVENLABS_API_KEY (optional)
    if (process.env.ELEVENLABS_API_KEY) {
      console.log("  ✓ ELEVENLABS_API_KEY is set");
    } else {
      console.log("  ✗ ELEVENLABS_API_KEY not set (optional, needed for elevenlabs TTS)");
    }

    process.exit(allOk ? 0 : 1);
  });

program.parse();
