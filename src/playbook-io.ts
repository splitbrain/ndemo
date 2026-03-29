import fs from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { PlaybookSchema } from "./schema.js";
import type { Playbook } from "./schema.js";

function loadPlaybook(filePath: string): Playbook {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Playbook not found: ${absPath}`);
  }

  const raw = fs.readFileSync(absPath, "utf-8");
  const data = parse(raw);
  const result = PlaybookSchema.safeParse(data);

  if (!result.success) {
    const issues = result.error.issues
      .map(i => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid playbook:\n${issues}`);
  }

  return result.data;
}

function savePlaybook(filePath: string, playbook: Playbook): void {
  const absPath = path.resolve(filePath);
  const yamlStr = stringify(playbook, {
    lineWidth: 0,
    defaultKeyType: "PLAIN",
    defaultStringType: "QUOTE_DOUBLE",
  });
  fs.writeFileSync(absPath, yamlStr, "utf-8");
}

export { loadPlaybook, savePlaybook };
