import type { Page } from "playwright";
import type { Action, Segment } from "./schema.js";
import { toLocator } from "./locators.js";
import { waitForDone } from "./waiters.js";
import { pointAt, clickEffect, hideCursor } from "./cursor.js";

async function executeAction(
  page: Page,
  action: Action,
  options: { cursor?: boolean } = {}
): Promise<void> {
  const showCursor = options.cursor ?? false;

  if (action.type === "wait") {
    await page.waitForTimeout(action.duration ?? 1000);
    return;
  }

  if (action.type === "press") {
    await page.keyboard.press(action.key!);
    if (action.done) await waitForDone(page, action.done);
    return;
  }

  const locator = toLocator(page, action.target!);

  if (showCursor && (action.type === "click" || action.type === "type"
      || action.type === "hover" || action.type === "select")) {
    await pointAt(page, locator);
  }

  switch (action.type) {
    case "click":
      if (showCursor) await clickEffect(page);
      await locator.click();
      break;
    case "type":
      if (showCursor) await hideCursor(page);
      await locator.fill("");
      await locator.pressSequentially(
        action.text!,
        { delay: action.delay ?? 80 }
      );
      break;
    case "hover":
      await locator.hover();
      if (showCursor) await hideCursor(page);
      break;
    case "scroll":
      await locator.scrollIntoViewIfNeeded();
      break;
    case "select":
      if (showCursor) await clickEffect(page);
      await locator.selectOption(action.option!);
      break;
  }

  if (action.done) {
    await waitForDone(page, action.done);
  }
}

interface SegmentResult {
  ok: boolean;
  error?: string;
  actionIndex?: number;
}

async function executeSegment(
  page: Page,
  segment: Segment,
  options: { cursor?: boolean } = {}
): Promise<SegmentResult> {
  for (let i = 0; i < segment.actions.length; i++) {
    try {
      await executeAction(page, segment.actions[i], options);
    } catch (err) {
      return {
        ok: false,
        error: String(err),
        actionIndex: i,
      };
    }
  }
  return { ok: true };
}

/**
 * Shared orchestration for playing a segment with optional audio.
 * Used by both `play` and `render`.
 *
 * - Handles timing (after vs parallel)
 * - Optionally plays audio via a playAudio callback
 * - Waits for audio duration to ensure segment fills the narration
 * - Returns the actual wall-clock duration of the segment
 */
interface RunSegmentOptions {
  cursor?: boolean;
  audioDurationMs?: number;
  playAudio?: () => { kill: () => void; promise: Promise<unknown> };
  onActionStart?: (action: Action, index: number) => void;
  onActionDone?: (action: Action, index: number) => void;
  onActionError?: (err: unknown, action: Action, index: number) => void;
}

async function runSegment(
  page: Page,
  segment: Segment,
  options: RunSegmentOptions = {}
): Promise<{ ok: boolean; durationMs: number; error?: string; actionIndex?: number }> {
  const timing = segment.timing ?? "after";
  const audioDurationMs = options.audioDurationMs ?? 0;
  const segmentStart = Date.now();

  // Start audio
  let audioHandle: { kill: () => void; promise: Promise<unknown> } | null = null;
  if (options.playAudio) {
    audioHandle = options.playAudio();
  }

  // "after" timing: wait for narration to finish before running actions
  if (timing === "after" && audioDurationMs > 0 && segment.actions.length > 0) {
    await page.waitForTimeout(audioDurationMs);
    if (audioHandle) {
      try { await audioHandle.promise; } catch {}
      audioHandle = null;
    }
  }

  // Execute actions
  for (let i = 0; i < segment.actions.length; i++) {
    const action = segment.actions[i];
    options.onActionStart?.(action, i);

    try {
      await executeAction(page, action, { cursor: options.cursor });
      options.onActionDone?.(action, i);
    } catch (err) {
      options.onActionError?.(err, action, i);
      if (audioHandle) audioHandle.kill();
      return {
        ok: false,
        durationMs: Date.now() - segmentStart,
        error: String(err),
        actionIndex: i,
      };
    }
  }

  // Pad to audio duration
  const elapsed = Date.now() - segmentStart;
  const remaining = audioDurationMs - elapsed;
  if (remaining > 0) {
    await page.waitForTimeout(remaining);
  }

  // Wait for audio to finish
  if (audioHandle) {
    try { await audioHandle.promise; } catch {}
  }

  return {
    ok: true,
    durationMs: Date.now() - segmentStart,
  };
}

export { executeAction, executeSegment, runSegment };
export type { SegmentResult, RunSegmentOptions };
