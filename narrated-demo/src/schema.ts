import { z } from "zod";

// ─── Target ──────────────────────────────────────────

const TargetSchema = z.object({
  role: z.string().optional(),
  name: z.string().optional(),
  label: z.string().optional(),
  text: z.string().optional(),
  placeholder: z.string().optional(),
  testId: z.string().optional(),
  selector: z.string().optional(),
}).refine(
  t => Object.values(t).some(Boolean),
  "Target needs at least one field"
);

// ─── Done Condition ──────────────────────────────────

const DoneConditionSchema = z.object({
  visible: z.string().optional(),
  hidden: z.string().optional(),
  text: z.object({
    selector: z.string(),
    has: z.string(),
  }).optional(),
  attribute: z.object({
    selector: z.string(),
    name: z.string(),
    value: z.string(),
  }).optional(),
  networkIdle: z.boolean().optional(),
  stable: z.number().optional(),
  url: z.string().optional(),
}).refine(
  d => Object.values(d).some(Boolean),
  "Done condition needs at least one field"
);

// ─── Action ──────────────────────────────────────────

const ActionSchema = z.object({
  type: z.enum([
    "click", "type", "hover", "scroll",
    "wait", "select", "press"
  ]),
  target: TargetSchema.optional(),
  text: z.string().optional(),
  key: z.string().optional(),
  delay: z.number().optional(),
  duration: z.number().optional(),
  option: z.string().optional(),
  done: DoneConditionSchema.optional(),
}).refine(action => {
  if (action.type === "wait") return true;
  if (action.type === "press") return true;
  return action.target !== undefined;
}, "Non-wait/press actions require a target");

// ─── Segment ─────────────────────────────────────────

const SegmentSchema = z.object({
  id: z.string().regex(
    /^[a-z0-9][a-z0-9-]*$/,
    "Segment ID must be lowercase alphanumeric with hyphens"
  ),
  narration: z.string().min(1),
  intent: z.string().min(1),
  actions: z.array(ActionSchema).default([]),
  audioDuration: z.number().optional(),
});

// ─── Playbook ────────────────────────────────────────

const PlaybookSchema = z.object({
  app: z.object({
    url: z.string().url(),
    viewport: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }).default({ width: 1920, height: 1080 }),
    scale: z.number().positive().default(2),
    zoom: z.number().positive().default(1.25),
    colorScheme: z.enum(["light", "dark"]).default("light"),
    setup: z.array(ActionSchema).optional(),
  }),
  tts: z.object({
    provider: z.enum(["openai", "elevenlabs"]).default("openai"),
    voice: z.string().default("alloy"),
    speed: z.number().positive().default(1.0),
  }).default({}),
  recording: z.object({
    outputDir: z.string().default("."),
    fps: z.number().int().positive().default(30),
  }).default({}),
  segments: z.array(SegmentSchema).min(1),
});

type Playbook = z.infer<typeof PlaybookSchema>;
type Segment = z.infer<typeof SegmentSchema>;
type Action = z.infer<typeof ActionSchema>;
type Target = z.infer<typeof TargetSchema>;
type DoneCondition = z.infer<typeof DoneConditionSchema>;

export {
  PlaybookSchema, SegmentSchema, ActionSchema,
  TargetSchema, DoneConditionSchema,
};
export type {
  Playbook, Segment, Action, Target, DoneCondition,
};
