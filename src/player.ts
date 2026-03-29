import path from "node:path";
import { execa } from "execa";
import { connect } from "./browser.js";
import { loadPlaybook } from "./playbook-io.js";
import { executeAction, executeSegment } from "./executor.js";
import { ensureAudio } from "./tts.js";
import type { Action, Playbook, Segment } from "./schema.js";

async function play(
  playbookPath: string,
  options: { segment?: string; from?: string; to?: string; audio?: boolean }
): Promise<void> {
  const playbook = loadPlaybook(playbookPath);
  const { page } = await connect();

  const allIds = playbook.segments.map(s => s.id);
  let targetStart = 0;
  let targetEnd = allIds.length - 1;

  if (options.segment) {
    const idx = allIds.indexOf(options.segment);
    if (idx === -1) throw new Error(`Segment "${options.segment}" not found`);
    targetStart = idx;
    targetEnd = idx;
  }
  if (options.from) {
    const idx = allIds.indexOf(options.from);
    if (idx === -1) throw new Error(`Segment "${options.from}" not found`);
    targetStart = idx;
  }
  if (options.to) {
    const idx = allIds.indexOf(options.to);
    if (idx === -1) throw new Error(`Segment "${options.to}" not found`);
    targetEnd = idx;
  }

  // If --audio, ensure TTS audio is up to date for target segments
  const audioMap = new Map<string, { audioPath: string; durationMs: number }>();
  if (options.audio) {
    const playbookDir = path.dirname(path.resolve(playbookPath));
    const outputDir = path.resolve(playbookDir, playbook.recording.outputDir);
    console.log("Preparing audio...");
    for (let i = targetStart; i <= targetEnd; i++) {
      const seg = playbook.segments[i];
      process.stdout.write(`  ${seg.id}...`);
      const result = await ensureAudio(seg, playbook, outputDir);
      audioMap.set(seg.id, result);
      console.log(` ${(result.durationMs / 1000).toFixed(1)}s`);
    }
  }

  // Rewind
  console.log("Rewinding...");
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

  // Execute pre-target segments silently
  for (let i = 0; i < targetStart; i++) {
    const seg = playbook.segments[i];
    if (seg.actions.length === 0) {
      console.error(
        `Warning: segment "${seg.id}" has no actions, skipping during rewind`
      );
      continue;
    }
    const result = await executeSegment(page, seg);
    if (!result.ok) {
      throw new Error(`Rewind failed at segment "${seg.id}": ${result.error}`);
    }
  }

  // Play target segments with full output
  for (let i = targetStart; i <= targetEnd; i++) {
    const seg = playbook.segments[i];
    const audio = audioMap.get(seg.id);
    console.log(`\n▸ segment ${seg.id}: "${seg.narration}"`);

    if (seg.actions.length === 0 && !audio) {
      console.log("  (no actions)");
      continue;
    }

    const timing = seg.timing ?? "after";

    // Start audio playback if --audio
    let audioProcess: ReturnType<typeof execa> | null = null;
    if (audio) {
      audioProcess = execa("ffplay", [
        "-nodisp", "-autoexit", "-loglevel", "quiet",
        audio.audioPath,
      ]);
      audioProcess.catch(() => {});

      // "after" timing: wait for narration to finish before running actions
      if (timing === "after" && seg.actions.length > 0) {
        await page.waitForTimeout(audio.durationMs);
        try { await audioProcess; } catch {}
        audioProcess = null; // already done
      }
    }

    const segmentStart = Date.now();

    for (let j = 0; j < seg.actions.length; j++) {
      const action = seg.actions[j];
      const desc = describeAction(action);
      process.stdout.write(`  ${desc}...`);

      try {
        await executeAction(page, action, { cursor: true });
        console.log(" ✓");
      } catch (err) {
        console.log(" ✗");
        if (audioProcess) audioProcess.kill();
        throw new Error(`Failed at segment "${seg.id}", action ${j}: ${err}`);
      }
    }

    // For "parallel" timing, wait for audio to finish after actions complete
    if (audioProcess) {
      const elapsed = Date.now() - segmentStart;
      const remaining = audio!.durationMs - elapsed;
      if (remaining > 0) {
        await page.waitForTimeout(remaining);
      }
      try { await audioProcess; } catch {}
    }
  }

  console.log("\n✓ Done.");
}

function describeAction(action: Action): string {
  if (action.type === "wait")
    return `wait ${action.duration ?? 1000}ms`;
  if (action.type === "press")
    return `press ${action.key}`;
  const target = action.target!;
  const loc = target.role
    ? `[${target.role}${target.name ? ` "${target.name}"` : ""}]`
    : target.selector ?? target.text ?? target.label ?? "?";
  if (action.type === "type")
    return `type "${action.text}" into ${loc}`;
  return `${action.type} ${loc}`;
}

export { play };
