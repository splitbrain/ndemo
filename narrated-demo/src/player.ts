import { connect } from "./browser.js";
import { loadPlaybook } from "./playbook-io.js";
import { executeAction, executeSegment } from "./executor.js";
import type { Action } from "./schema.js";

async function play(
  playbookPath: string,
  options: { segment?: string; from?: string; to?: string }
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
      console.error(
        `Rewind failed at segment "${seg.id}": ${result.error}`
      );
      process.exit(1);
    }
  }

  // Play target segments with full output
  for (let i = targetStart; i <= targetEnd; i++) {
    const seg = playbook.segments[i];
    console.log(`\n▸ segment ${seg.id}: "${seg.narration}"`);

    if (seg.actions.length === 0) {
      console.log("  (no actions)");
      continue;
    }

    for (let j = 0; j < seg.actions.length; j++) {
      const action = seg.actions[j];
      const desc = describeAction(action);
      process.stdout.write(`  ${desc}...`);

      try {
        await executeAction(page, action);
        console.log(" ✓");
      } catch (err) {
        console.log(" ✗");
        console.error(`  Error: ${err}`);
        console.error(
          `  Failed at segment "${seg.id}", action ${j}`
        );
        process.exit(1);
      }
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
