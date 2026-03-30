import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";

interface MergeSegment {
  id: string;
  audioPath: string | null;
  audioDurationMs: number;
  videoDurationMs: number;
}

interface MergeOptions {
  videoPath: string;
  segments: MergeSegment[];
  outputPath: string;
  outputDir: string;
  titleCardDurationMs?: number;
}

async function mergeAudioVideo(options: MergeOptions): Promise<void> {
  const { videoPath, segments, outputPath, outputDir } = options;

  const audioFiles: string[] = [];

  // Prepend silence for title card (no audio during title)
  if (options.titleCardDurationMs && options.titleCardDurationMs > 0) {
    const titleSilencePath = path.join(outputDir, "audio", "silence-titlecard.mp3");
    fs.mkdirSync(path.join(outputDir, "audio"), { recursive: true });
    await execa("ffmpeg", [
      "-y",
      "-f", "lavfi",
      "-i", "anullsrc=r=44100:cl=mono",
      "-t", String(options.titleCardDurationMs / 1000),
      "-q:a", "9",
      titleSilencePath,
    ]);
    audioFiles.push(titleSilencePath);
  }

  // Build concatenated audio with silence gaps
  for (const segment of segments) {
    if (segment.audioPath) {
      audioFiles.push(segment.audioPath);
    }

    // Fill remaining segment time (or full duration if no narration) with silence
    const gapMs = segment.audioPath
      ? Math.max(0, segment.videoDurationMs - segment.audioDurationMs)
      : segment.videoDurationMs;
    if (gapMs > 50) {
      const silencePath = path.join(outputDir, "audio", `silence-${segment.id}.mp3`);
      await execa("ffmpeg", [
        "-y",
        "-f", "lavfi",
        "-i", `anullsrc=r=44100:cl=mono`,
        "-t", String(gapMs / 1000),
        "-q:a", "9",
        silencePath,
      ]);
      audioFiles.push(silencePath);
    }
  }

  // Write concat file list
  const filelistPath = path.join(outputDir, "filelist.txt");
  const filelistContent = audioFiles
    .map(f => `file '${path.resolve(f)}'`)
    .join("\n");
  fs.writeFileSync(filelistPath, filelistContent);

  // Concatenate audio
  const combinedAudioPath = path.join(outputDir, "combined-audio.mp3");
  await execa("ffmpeg", [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", filelistPath,
    "-c", "copy",
    combinedAudioPath,
  ]);

  // Merge audio + video (video is already H.264, just mux)
  await execa("ffmpeg", [
    "-y",
    "-i", videoPath,
    "-i", combinedAudioPath,
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    "-shortest",
    outputPath,
  ]);

  // Clean up temp files
  try {
    fs.unlinkSync(filelistPath);
    fs.unlinkSync(combinedAudioPath);
    const titleSilencePath = path.join(outputDir, "audio", "silence-titlecard.mp3");
    if (fs.existsSync(titleSilencePath)) fs.unlinkSync(titleSilencePath);
    for (const segment of segments) {
      const silencePath = path.join(outputDir, "audio", `silence-${segment.id}.mp3`);
      if (fs.existsSync(silencePath)) fs.unlinkSync(silencePath);
    }
  } catch {
    // Non-critical cleanup
  }
}

export { mergeAudioVideo };
