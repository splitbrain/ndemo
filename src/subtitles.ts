interface SubtitleSegment {
  narration: string | undefined;
  videoDurationMs: number;
  audioDurationMs: number;
}

const MAX_CUE_CHARS = 80;

function formatSrtTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const millis = Math.round(ms % 1000);
  return (
    String(hours).padStart(2, "0") +
    ":" +
    String(minutes).padStart(2, "0") +
    ":" +
    String(seconds).padStart(2, "0") +
    "," +
    String(millis).padStart(3, "0")
  );
}

function splitIntoCues(text: string): string[] {
  // Step 1: split into sentences
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [text];
  const cues: string[] = [];

  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;

    if (sentence.length <= MAX_CUE_CHARS) {
      cues.push(sentence);
      continue;
    }

    // Step 2: split long sentences at commas
    const parts = sentence.split(/,\s*/);
    let current = "";
    for (const part of parts) {
      const candidate = current ? `${current}, ${part}` : part;
      if (candidate.length <= MAX_CUE_CHARS) {
        current = candidate;
      } else {
        if (current) cues.push(current);
        current = part;
      }
    }

    // Step 3: if still too long, split at word boundaries
    if (current.length <= MAX_CUE_CHARS) {
      if (current) cues.push(current);
    } else {
      const words = current.split(/\s+/);
      let line = "";
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (candidate.length <= MAX_CUE_CHARS) {
          line = candidate;
        } else {
          if (line) cues.push(line);
          line = word;
        }
      }
      if (line) cues.push(line);
    }
  }

  return cues;
}

function generateSrt(segments: SubtitleSegment[]): string {
  const entries: string[] = [];
  let index = 1;
  let offsetMs = 0;

  for (const segment of segments) {
    if (segment.narration) {
      const cues = splitIntoCues(segment.narration);
      const totalChars = cues.reduce((sum, c) => sum + c.length, 0);

      let cueOffsetMs = offsetMs;
      for (const cue of cues) {
        const proportion = cue.length / totalChars;
        const durationMs = segment.audioDurationMs * proportion;
        const startMs = cueOffsetMs;
        const endMs = cueOffsetMs + durationMs;

        entries.push(
          `${index}\n${formatSrtTime(startMs)} --> ${formatSrtTime(endMs)}\n${cue}`
        );
        index++;
        cueOffsetMs = endMs;
      }
    }
    offsetMs += segment.videoDurationMs;
  }

  return entries.join("\n\n") + "\n";
}

export { generateSrt, splitIntoCues, formatSrtTime };
export type { SubtitleSegment };
