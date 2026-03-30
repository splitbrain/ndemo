import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { execa } from "execa";
import { loadPlaybook, savePlaybook } from "./playbook-io.js";
import { runSegment } from "./executor.js";
import { executeSetup } from "./setup.js";
import { ensureAudio } from "./tts.js";
import { mergeAudioVideo } from "./merger.js";
import { generateSrt } from "./subtitles.js";
import { zoomExtensionArgs, setBrowserZoom } from "./zoom.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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

  // Step 2: Headless replay with CDP screencast
  console.log("\nRecording video...");
  const framesDir = path.join(outputDir, ".frames");
  fs.mkdirSync(framesDir, { recursive: true });

  // Use a physically larger viewport so CDP screencast (which captures at
  // logical pixel dimensions) produces high-resolution frames. Real browser
  // zoom via the bundled extension then scales content up to fill this
  // viewport while keeping vh/vw units correct.
  const scaledWidth = playbook.app.viewport.width * playbook.app.scale;
  const scaledHeight = playbook.app.viewport.height * playbook.app.scale;
  const zoomPercent = playbook.app.zoom * playbook.app.scale * 100;

  // Extensions require a persistent context and --headless=new.
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ndemo-render-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      "--headless=new",
      ...zoomExtensionArgs(),
    ],
    viewport: { width: scaledWidth, height: scaledHeight },
    deviceScaleFactor: 1,
    colorScheme: playbook.app.colorScheme,
    locale: "en-US",
  });

  // Wait for the zoom extension's service worker to be ready.
  if (context.serviceWorkers().length === 0) {
    await context.waitForEvent("serviceworker", { timeout: 5000 });
  }

  const page = context.pages()[0] || await context.newPage();

  // Navigate to app and apply real browser zoom (needs an HTTP page for
  // the extension content script). Zoom persists across navigations.
  let startUrl = playbook.app.url;
  await page.goto(playbook.app.url, { waitUntil: "load" });
  await setBrowserZoom(page, zoomPercent);

  if (playbook.app.setup) {
    console.log("  Running setup...");
    await executeSetup(page, playbook.app.setup);
    startUrl = page.url();
  }

  // Start CDP screencast for high-quality frame capture
  const cdp = await context.newCDPSession(page);

  interface CapturedFrame {
    filePath: string;
    timestamp: number;
  }
  const frames: CapturedFrame[] = [];
  let frameIndex = 0;
  let pendingWrites = 0;

  cdp.on("Page.screencastFrame", async (params) => {
    const filePath = path.join(framesDir, `frame-${String(frameIndex).padStart(7, "0")}.jpeg`);
    const timestamp = params.metadata.timestamp ?? (Date.now() / 1000);
    frameIndex++;
    pendingWrites++;
    fs.writeFileSync(filePath, Buffer.from(params.data, "base64"));
    frames.push({ filePath, timestamp });
    pendingWrites--;

    await cdp.send("Page.screencastFrameAck", { sessionId: params.sessionId });
  });

  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 95,
    maxWidth: scaledWidth,
    maxHeight: scaledHeight,
    everyNthFrame: 1,
  });

  // Track total pre-segment time (title card + navigation) so the merger
  // can insert matching silence.  The screencast is already running, so any
  // time spent here appears in the video and must be mirrored in the audio.
  const preSegmentStart = Date.now();

  // Title card
  let titleCardDurationMs = 0;
  if (playbook.titleCard) {
    const tc = playbook.titleCard;
    titleCardDurationMs = tc.duration;
    const isDark = playbook.app.colorScheme === "dark";
    const bg = isDark ? "#1a1a2e" : "#f5f5f5";
    const fg = isDark ? "#e0e0e0" : "#1a1a1a";
    const subtitleColor = isDark ? "#a0a0b0" : "#666666";

    const titleHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 100vw; height: 100vh;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    background: ${bg}; color: ${fg};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  h1 { font-size: 4rem; font-weight: 700; text-align: center; line-height: 1.2; }
  p  { font-size: 1.8rem; font-weight: 400; margin-top: 1rem; color: ${subtitleColor}; text-align: center; }
</style></head><body>
  <h1>${escapeHtml(tc.title)}</h1>
  ${tc.subtitle ? `<p>${escapeHtml(tc.subtitle)}</p>` : ""}
</body></html>`;

    console.log("  Recording title card...");
    await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(titleHtml)}`, { waitUntil: "load" });
    await new Promise(r => setTimeout(r, titleCardDurationMs));
  }

  // Navigate to the app for segment recording
  await page.goto(startUrl, { waitUntil: "load" });

  const preSegmentDurationMs = Date.now() - preSegmentStart;

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
      await cdp.send("Page.stopScreencast");
      await cdp.detach();
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
      throw new Error(
        `Render failed at segment "${segment.id}", action ${result.actionIndex}: ${result.error}`
      );
    }

    segment.videoDuration = result.durationMs;
    segmentTimings.push({
      id: segment.id,
      durationMs: result.durationMs,
      audioDurationMs: segment.audioDuration!,
    });
    console.log(` ${(result.durationMs / 1000).toFixed(1)}s`);
  }

  // Stop screencast and wait for pending frame writes
  await cdp.send("Page.stopScreencast");
  while (pendingWrites > 0) {
    await new Promise(r => setTimeout(r, 50));
  }
  await cdp.detach();
  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });

  // Save video durations back to playbook
  savePlaybook(playbookPath, playbook);

  if (frames.length === 0) {
    throw new Error("No frames captured");
  }

  console.log(`  Captured ${frames.length} frames`);

  // Assemble frames into video using ffmpeg concat demuxer.
  // The expected total duration lets us hold the last frame long enough to
  // cover static segments where the screencast sends no new frames.
  const expectedTotalSec =
    (preSegmentDurationMs + segmentTimings.reduce((s, t) => s + t.durationMs, 0)) / 1000;

  const concatFilePath = path.join(framesDir, "frames.txt");
  let concatContent = "";
  for (let i = 0; i < frames.length; i++) {
    const duration = i < frames.length - 1
      ? frames[i + 1].timestamp - frames[i].timestamp
      : Math.max(
          expectedTotalSec - (frames[i].timestamp - frames[0].timestamp),
          1 / 30,
        );
    concatContent += `file '${path.resolve(frames[i].filePath)}'\n`;
    concatContent += `duration ${Math.max(duration, 0.001).toFixed(6)}\n`;
  }
  // concat demuxer needs the last file repeated without duration
  concatContent += `file '${path.resolve(frames[frames.length - 1].filePath)}'\n`;
  fs.writeFileSync(concatFilePath, concatContent);

  const videoPath = path.join(outputDir, `${playbookName}-video.mp4`);
  await execa("ffmpeg", [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", concatFilePath,
    "-r", String(playbook.recording.fps),
    "-c:v", "libx264",
    "-crf", "17",
    "-preset", "slow",
    "-pix_fmt", "yuv420p",
    videoPath,
  ]);

  // Clean up frames
  fs.rmSync(framesDir, { recursive: true, force: true });

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
    preSegmentDurationMs,
  });

  // Clean up intermediate video
  if (videoPath !== finalOutput) {
    try { fs.unlinkSync(videoPath); } catch {}
  }

  // Generate SRT subtitles
  const srtPath = finalOutput.replace(/\.mp4$/, ".srt");
  const srtContent = generateSrt(
    playbook.segments.map((s, i) => ({
      narration: s.narration,
      videoDurationMs: segmentTimings[i].durationMs,
      audioDurationMs: s.audioDuration!,
    })),
    preSegmentDurationMs
  );
  fs.writeFileSync(srtPath, srtContent);

  // Summary
  const stats = fs.statSync(finalOutput);
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(1);
  const totalDuration = preSegmentDurationMs + segmentTimings.reduce((s, t) => s + t.durationMs, 0);
  const minutes = Math.floor(totalDuration / 60000);
  const seconds = Math.round((totalDuration % 60000) / 1000);

  console.log(`\n✓ ${finalOutput}`);
  console.log(`  Duration: ${minutes}m ${seconds}s`);
  console.log(`  Size: ${sizeMb} MB`);
  console.log(`  Segments: ${playbook.segments.length}`);
  console.log(`  Subtitles: ${srtPath}`);
}

export { render };
