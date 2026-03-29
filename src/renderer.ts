import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadPlaybook, savePlaybook } from "./playbook-io.js";
import { runSegment } from "./executor.js";
import { executeSetup } from "./setup.js";
import { ensureAudio } from "./tts.js";
import { mergeAudioVideo } from "./merger.js";

async function render(
  playbookPath: string,
  outputPath?: string
): Promise<void> {
  const playbook = loadPlaybook(playbookPath);

  // Validate: every segment must have at least one action
  const emptySegments = playbook.segments.filter(s => s.actions.length === 0);
  if (emptySegments.length > 0) {
    const ids = emptySegments.map(s => s.id).join(", ");
    throw new Error(
      `Cannot render: the following segments have no actions: ${ids}\n` +
      `Add actions to these segments before rendering.`
    );
  }

  const playbookDir = path.dirname(path.resolve(playbookPath));
  const outputDir = path.resolve(playbookDir, playbook.recording.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  // Step 1: TTS
  console.log("Generating TTS audio...");
  const audioResults: Array<{ id: string; audioPath: string; durationMs: number }> = [];
  for (const segment of playbook.segments) {
    process.stdout.write(`  ${segment.id}...`);
    const result = await ensureAudio(segment, playbook, outputDir);
    segment.audioDuration = result.durationMs;
    audioResults.push({ id: segment.id, audioPath: result.audioPath, durationMs: result.durationMs });
    console.log(` ${(result.durationMs / 1000).toFixed(1)}s`);
  }

  // Save updated durations back to playbook
  savePlaybook(playbookPath, playbook);
  console.log("  Audio durations saved to playbook.");

  // Step 2: Headless replay with video recording
  console.log("\nRecording video...");
  const videoRawDir = path.join(outputDir, "video-raw");
  fs.mkdirSync(videoRawDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: {
      width: playbook.app.viewport.width,
      height: playbook.app.viewport.height,
    },
    deviceScaleFactor: playbook.app.scale,
    colorScheme: playbook.app.colorScheme,
    locale: "en-US",
    recordVideo: {
      dir: videoRawDir,
      size: {
        width: playbook.app.viewport.width * playbook.app.scale,
        height: playbook.app.viewport.height * playbook.app.scale,
      },
    },
  });

  const page = await context.newPage();

  // Apply zoom
  await page.addInitScript(`
    document.addEventListener('DOMContentLoaded', () => {
      document.body.style.zoom = '${playbook.app.zoom}';
    });
  `);

  await page.goto(playbook.app.url, { waitUntil: "load" });
  await page.evaluate(
    (z: number) => { document.body.style.zoom = String(z); },
    playbook.app.zoom
  );

  if (playbook.app.setup) {
    await executeSetup(page, playbook.app.setup);
  }

  // Record segments
  const segmentTimings: Array<{ id: string; durationMs: number; audioDurationMs: number }> = [];

  for (let i = 0; i < playbook.segments.length; i++) {
    const segment = playbook.segments[i];
    process.stdout.write(`  ${segment.id}...`);

    const result = await runSegment(page, segment, {
      cursor: true,
      audioDurationMs: segment.audioDuration!,
      onActionError: async (err, action, actionIndex) => {
        await page.screenshot({
          path: path.join(outputDir, `error-${segment.id}.png`),
        });
      },
    });

    if (!result.ok) {
      await context.close();
      await browser.close();
      throw new Error(
        `Render failed at segment "${segment.id}", action ${result.actionIndex}: ${result.error}`
      );
    }

    segmentTimings.push({
      id: segment.id,
      durationMs: result.durationMs,
      audioDurationMs: segment.audioDuration!,
    });
    console.log(` ${(result.durationMs / 1000).toFixed(1)}s`);
  }

  // Close context to finalize video
  const videoObj = page.video();
  await context.close();
  await browser.close();

  const videoPath = videoObj ? await videoObj.path() : undefined;
  if (!videoPath) {
    throw new Error("No video recorded");
  }

  // Step 3: Merge
  console.log("\nMerging audio and video...");
  const finalOutput = outputPath ?? path.join(outputDir, "demo.mp4");

  await mergeAudioVideo({
    videoPath,
    segments: playbook.segments.map((s, i) => ({
      id: s.id,
      audioPath: audioResults[i].audioPath,
      audioDurationMs: s.audioDuration!,
      videoDurationMs: segmentTimings[i].durationMs,
    })),
    outputPath: finalOutput,
    outputDir,
  });

  // Summary
  const stats = fs.statSync(finalOutput);
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(1);
  const totalDuration = segmentTimings.reduce((s, t) => s + t.durationMs, 0);
  const minutes = Math.floor(totalDuration / 60000);
  const seconds = Math.round((totalDuration % 60000) / 1000);

  console.log(`\n✓ ${finalOutput}`);
  console.log(`  Duration: ${minutes}m ${seconds}s`);
  console.log(`  Size: ${sizeMb} MB`);
  console.log(`  Segments: ${playbook.segments.length}`);
}

export { render };
