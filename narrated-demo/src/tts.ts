import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execa } from "execa";
import OpenAI from "openai";
import type { Playbook, Segment } from "./schema.js";

interface TtsResult {
  audioPath: string;
  durationMs: number;
}

async function generateTts(
  segment: Segment,
  playbook: Playbook,
  outputDir: string
): Promise<TtsResult> {
  const audioDir = path.join(outputDir, "audio");
  fs.mkdirSync(audioDir, { recursive: true });

  const audioPath = path.join(audioDir, `${segment.id}.mp3`);
  const hashPath = path.join(audioDir, `${segment.id}.hash`);

  const hash = crypto
    .createHash("sha256")
    .update(segment.narration + playbook.tts.voice + playbook.tts.speed)
    .digest("hex");

  // Check cache
  if (
    fs.existsSync(audioPath) &&
    fs.existsSync(hashPath) &&
    fs.readFileSync(hashPath, "utf-8") === hash
  ) {
    const durationMs = await probeDuration(audioPath);
    return { audioPath, durationMs };
  }

  if (playbook.tts.provider === "openai") {
    const openai = new OpenAI();
    const response = await openai.audio.speech.create({
      model: "tts-1-hd",
      voice: playbook.tts.voice as any,
      speed: playbook.tts.speed,
      input: segment.narration,
      response_format: "mp3",
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(audioPath, buffer);
    fs.writeFileSync(hashPath, hash);
  } else {
    throw new Error(`TTS provider "${playbook.tts.provider}" not yet implemented`);
  }

  const durationMs = await probeDuration(audioPath);
  return { audioPath, durationMs };
}

async function probeDuration(audioPath: string): Promise<number> {
  const { stdout } = await execa("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    audioPath,
  ]);
  const seconds = parseFloat(stdout.trim());
  if (isNaN(seconds)) {
    throw new Error(`Could not probe duration of ${audioPath}`);
  }
  return Math.round(seconds * 1000);
}

export { generateTts, probeDuration };
