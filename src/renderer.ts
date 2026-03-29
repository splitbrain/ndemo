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
  const playbookName = path.basename(playbookPath, path.extname(playbookPath));
  const outputDir = path.resolve(playbookDir, playbook.recording.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  // Step 1: TTS
  console.log("Generating TTS audio...");
  const audioResults: Array<{ id: string; audioPath: string | null; durationMs: number }> = [];
  for (const segment of playbook.segments) {
    process.stdout.write(`  ${segment.id}...`);
    if (segment.narration) {
      const result = await ensureAudio(segment, playbook, outputDir);
      segment.audioDuration = result.durationMs;
      audioResults.push({ id: segment.id, audioPath: result.audioPath, durationMs: result.durationMs });
      console.log(` ${(result.durationMs / 1000).toFixed(1)}s`);
    } else {
      segment.audioDuration = 0;
      audioResults.push({ id: segment.id, audioPath: null, durationMs: 0 });
      console.log(" (no narration)");
    }
  }

  // Save updated durations back to playbook
  savePlaybook(playbookPath, playbook);
  console.log("  Audio durations saved to playbook.");

  // Step 2: Headless replay with video recording
  console.log("\nRecording video...");
  // Playwright needs a temp dir for its auto-named webm; we rename it after.
  const videoTmpDir = path.join(outputDir, ".video-tmp");
  fs.mkdirSync(videoTmpDir, { recursive: true });

  // Use a physically larger viewport instead of deviceScaleFactor to get
  // high-resolution video. Playwright's video recorder captures at logical
  // pixel dimensions, so deviceScaleFactor > 1 would leave the content at
  // 1/scale² of the video frame. We compensate with increased zoom below.
  const scaledWidth = playbook.app.viewport.width * playbook.app.scale;
  const scaledHeight = playbook.app.viewport.height * playbook.app.scale;

  const renderZoom = playbook.app.zoom * playbook.app.scale;
  const browser = await chromium.launch({ headless: true });

  // Run setup in a non-recording context, then capture browser state
  let storageState: Awaited<ReturnType<import("playwright").BrowserContext["storageState"]>> | undefined;
  let startUrl = playbook.app.url;

  if (playbook.app.setup) {
    console.log("  Running setup...");
    const setupContext = await browser.newContext({
      viewport: { width: scaledWidth, height: scaledHeight },
      deviceScaleFactor: 1,
      colorScheme: playbook.app.colorScheme,
      locale: "en-US",
    });
    const setupPage = await setupContext.newPage();
    await setupPage.addInitScript(`
      document.addEventListener('DOMContentLoaded', () => {
        document.body.style.zoom = '${renderZoom}';
      });
    `);
    await setupPage.goto(playbook.app.url, { waitUntil: "load" });
    await setupPage.evaluate(
      (z: number) => { document.body.style.zoom = String(z); },
      renderZoom
    );
    await executeSetup(setupPage, playbook.app.setup);
    startUrl = setupPage.url();
    storageState = await setupContext.storageState();
    await setupContext.close();
  }

  // Create the recording context (with saved state from setup if any)
  const context = await browser.newContext({
    viewport: {
      width: scaledWidth,
      height: scaledHeight,
    },
    deviceScaleFactor: 1,
    colorScheme: playbook.app.colorScheme,
    locale: "en-US",
    storageState,
    recordVideo: {
      dir: videoTmpDir,
      size: {
        width: scaledWidth,
        height: scaledHeight,
      },
    },
  });

  const page = await context.newPage();

  // Apply zoom, scaled up to compensate for the larger viewport
  await page.addInitScript(`
    document.addEventListener('DOMContentLoaded', () => {
      document.body.style.zoom = '${renderZoom}';
    });
  `);

  await page.goto(startUrl, { waitUntil: "load" });
  await page.evaluate(
    (z: number) => { document.body.style.zoom = String(z); },
    renderZoom
  );

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

  const videoTmpPath = videoObj ? await videoObj.path() : undefined;
  if (!videoTmpPath) {
    throw new Error("No video recorded");
  }

  // Move webm to output dir with playbook name
  const videoPath = path.join(outputDir, `${playbookName}.webm`);
  fs.renameSync(videoTmpPath, videoPath);
  fs.rmSync(videoTmpDir, { recursive: true, force: true });

  // Step 3: Merge
  console.log("\nMerging audio and video...");
  const finalOutput = outputPath ?? path.join(outputDir, `${playbookName}.mp4`);

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
