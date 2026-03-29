# ndemo

Create narrated screen-recording demo videos of web applications.

## Setup

On first use, you MUST build the toolkit before running any command.
Check if `${CLAUDE_SKILL_DIR}/dist/cli.js` exists. If not, run:

```bash
cd ${CLAUDE_SKILL_DIR} && npm install && npm run build
```

Then install the Playwright browser if needed:

```bash
cd ${CLAUDE_SKILL_DIR} && npx playwright install chromium
```

Verify the setup:

```bash
${CLAUDE_SKILL_DIR}/ndemo doctor
```

## Commands

All commands are run via `${CLAUDE_SKILL_DIR}/ndemo`:

| Command | What it does |
|---------|-------------|
| `${CLAUDE_SKILL_DIR}/ndemo open <playbook>` | Launch browser daemon, navigate to app |
| `${CLAUDE_SKILL_DIR}/ndemo close` | Shut down browser daemon |
| `${CLAUDE_SKILL_DIR}/ndemo reset` | Navigate back to app URL (fresh state) |
| `${CLAUDE_SKILL_DIR}/ndemo page-state` | Print current page accessibility tree |
| `${CLAUDE_SKILL_DIR}/ndemo page-state --screenshot` | Same + save screenshot to .ndemo/screenshot.png |
| `${CLAUDE_SKILL_DIR}/ndemo play <playbook>` | Play all segments |
| `${CLAUDE_SKILL_DIR}/ndemo play <playbook> --segment <id>` | Play one segment (rewinds first) |
| `${CLAUDE_SKILL_DIR}/ndemo play <playbook> --from <id>` | Play from segment to end |
| `${CLAUDE_SKILL_DIR}/ndemo play <playbook> --audio` | Play with TTS narration audio |
| `${CLAUDE_SKILL_DIR}/ndemo render <playbook>` | Full pipeline: TTS → replay → merge → mp4 |
| `${CLAUDE_SKILL_DIR}/ndemo doctor` | Check dependencies |

## Workflow

### Step 1 — Create the playbook

Each playbook lives in its own directory under `demo/` in the
user's project. The directory name matches the playbook name.
Audio, video, and rendered output all go into the same directory.

```
demo/
  my-feature/
    my-feature.yaml    ← playbook
    audio/             ← generated TTS files (auto)
    output/            ← rendered video (auto)
```

Create the directory and YAML file:

```yaml
# demo/my-feature/my-feature.yaml
app:
  url: https://the-app-url.dev
  # Optional: viewport, scale, zoom, colorScheme, setup

segments:
  - id: short-kebab-id
    narration: "What the voiceover says."
    intent: "What should happen on screen (for your reference)."
    timing: after    # "after" (default): actions run after narration finishes
                     # "parallel": actions run while narration plays
    actions: []
```

Write all segments with narration and intent first. Leave actions
as empty arrays. Use absolute paths when passing playbook paths
to ndemo commands.

### Step 2 — Open the browser

```bash
${CLAUDE_SKILL_DIR}/ndemo open /absolute/path/to/demo/my-demo/my-demo.yaml
```

### Step 3 — Author each segment

For each segment with empty actions:

a) Read the current page state:
```bash
${CLAUDE_SKILL_DIR}/ndemo page-state
```

b) Look at the accessibility tree output. Find the elements
referenced in the segment's intent. Write actions into the
playbook YAML using elements from the tree.

**How to write targets** — use info from page-state output:

If page-state shows `[button "Settings"]`:
```yaml
target: { role: button, name: "Settings" }
```

If page-state shows `[searchbox "Search reports" value=""]`:
```yaml
target: { role: searchbox, name: "Search reports" }
```

If there's no clear role/name, use a CSS selector:
```yaml
target: { selector: "#my-element" }
```

**Tip:** The web app's source code is available in the project repo.
Look at the component source for `data-testid` attributes,
class names, or IDs when the accessibility tree isn't sufficient.

**How to write done conditions:**
```yaml
done:
  visible: ".settings-panel"        # element appears
  hidden: ".loading-spinner"        # element disappears
  networkIdle: true                 # no pending requests
  stable: 500                       # DOM unchanged for 500ms
  url: "**/settings"                # URL changed
  text:                             # element contains text
    selector: ".results"
    has: "Q3 Revenue"
  attribute:                        # element has attribute
    selector: html
    name: data-theme
    value: dark
```

**Every action that changes the page MUST have a done condition.**
Without one, the next action may execute before the page is ready.

Add `wait` actions after visible changes so the viewer can see
what happened:
```yaml
- type: wait
  duration: 2000    # 2 seconds
```

c) Test the segment:
```bash
${CLAUDE_SKILL_DIR}/ndemo play /absolute/path/to/demo/my-demo/my-demo.yaml --segment <id>
```

d) If it fails, run `${CLAUDE_SKILL_DIR}/ndemo page-state` to see
what's on screen now, adjust the actions, and retry.

e) After the segment works, read page-state again before
authoring the next segment — the page has changed.

### Step 4 — Review

```bash
${CLAUDE_SKILL_DIR}/ndemo play /absolute/path/to/demo/my-demo/my-demo.yaml
```

Watch the full sequence in the browser. Ask the user if it
looks right.

To review with TTS narration (requires OPENAI_API_KEY and ffplay):

```bash
${CLAUDE_SKILL_DIR}/ndemo play /absolute/path/to/demo/my-demo/my-demo.yaml --audio
```

This generates TTS audio for each segment (cached by content hash),
plays the audio alongside the browser actions, and pads timing so
actions match the narration duration. If narration text changes, the
audio is automatically regenerated and the old file is deleted.

### Step 5 — Iterate

The user may request changes. Common patterns:

| User says | What to do |
|-----------|-----------|
| "Wrong button" | Run page-state, find correct element, update target |
| "Too fast" / "too slow" | Adjust wait durations, replay with `--audio` to check timing |
| "Change narration to ..." | Edit narration field |
| "Add a step showing X" | Insert new segment, author its actions |
| "Remove that step" | Delete the segment from YAML |
| "Replay from segment X" | `${CLAUDE_SKILL_DIR}/ndemo play --from <id>` |
| "Start over" | `${CLAUDE_SKILL_DIR}/ndemo reset` then play again |

After each change, replay the affected segment(s) to verify.

### Step 6 — Render

When the user approves:

```bash
${CLAUDE_SKILL_DIR}/ndemo render /absolute/path/to/demo/my-demo/my-demo.yaml
```

This produces the final mp4 with TTS narration.

## Action Types Reference

| Type   | Required fields | Notes |
|--------|----------------|-------|
| click  | target         | |
| type   | target, text   | Use delay: 60-100 for human-like typing |
| hover  | target         | |
| scroll | target         | Scrolls element into view |
| wait   | duration (ms)  | Pause for the viewer |
| press  | key            | Keyboard key, e.g. "Enter", "Escape" |
| select | target, option | Dropdown selection |

## Segment ID Rules

- Lowercase alphanumeric with hyphens: `open-settings`, `toggle-dark`
- Must be unique within the playbook
- Used as filenames for audio/video, so keep them short

## Troubleshooting

- **Browser not responding**: `${CLAUDE_SKILL_DIR}/ndemo close` then `open` again
- **Element not found**: Run `${CLAUDE_SKILL_DIR}/ndemo page-state` to see what's
  actually on the page. The element might have a different name
  than expected. Check the app's source code for test IDs.
- **Actions pass but look wrong**: Run with `--segment <id>` to
  replay just that segment and watch carefully.
- **TTS sounds wrong**: Edit narration text (punctuation affects
  pacing), or change voice/speed in playbook tts settings.
