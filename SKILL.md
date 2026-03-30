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
| `${CLAUDE_SKILL_DIR}/ndemo play <playbook> --to <id>` | Stop after this segment |
| `${CLAUDE_SKILL_DIR}/ndemo play <playbook> --audio` | Play with TTS narration audio |
| `${CLAUDE_SKILL_DIR}/ndemo render <playbook>` | Full pipeline: TTS → replay → merge → mp4 |
| `${CLAUDE_SKILL_DIR}/ndemo render <playbook> --output <path>` | Render to a specific output file |
| `${CLAUDE_SKILL_DIR}/ndemo doctor` | Check dependencies |

## Workflow

### Step 1 — Create the playbook

Each playbook lives in its own directory under `demo/` in the
user's project. The directory name matches the playbook name.

```
demo/
  my-feature/
    my-feature.yaml    ← playbook
    fixtures/          ← files to restore during setup
    audio/             ← generated TTS files (auto)
    video-raw/         ← raw recording (auto)
    demo.mp4           ← final output (auto)
```

**Before writing the playbook**, think about what state the app
needs to be in for the demo to work reliably and repeatably:

- Does the user need to be logged in? → add conditional login steps
- Does the demo modify files/data that need restoring? → copy
  originals into the playbook's `fixtures/` directory so setup
  can restore them
- Does the demo depend on specific content existing? → create it
  in fixtures or via setup shell commands

**Copy any files that will be modified during the demo** into the
`fixtures/` subdirectory of the playbook directory. Setup steps
will copy them back before each run so the demo always starts
from a clean state.

Create the directory and YAML file. The full playbook schema supports
these top-level sections:

```yaml
# demo/edit-page/edit-page.yaml
app:
  url: http://localhost:8080/wiki
  viewport:                          # optional, default 1920x1080
    width: 1920
    height: 1080
  scale: 2                           # device scale factor (default 2)
  zoom: 1.25                         # CSS zoom level (default 1.25)
  colorScheme: light                 # "light" or "dark" (default "light")
  setup:
    # Restore files modified during the demo
    - run: cp demo/edit-page/fixtures/page.txt data/pages/page.txt
    # Clean up artifacts from previous runs
    - run: rm -f data/cache/*.tmp
    # Login if needed (conditional — skipped if already logged in)
    - type: click
      target: { role: link, name: "Login" }
      if:
        hidden: ".user-info"
    - type: type
      target: { role: textbox, name: "Username" }
      text: admin
      if:
        visible: ".login-form"
    - type: type
      target: { role: textbox, name: "Password" }
      text: password
      if:
        visible: ".login-form"
    - type: click
      target: { role: button, name: "Sign in" }
      if:
        visible: ".login-form"
      done:
        visible: ".user-info"

titleCard:                               # optional title card (shown as first frame)
  title: "Editing a Wiki Page"           # displayed prominently
  subtitle: "A quick tour of the editor" # optional subtitle
  duration: 3                            # seconds to hold (default 3)

tts:                                   # optional TTS configuration
  provider: openai                     # "openai" (default) or "elevenlabs"
  voice: alloy                         # TTS voice name (default "alloy")
  speed: 1.0                           # speech speed multiplier (default 1.0)

recording:                             # optional recording settings
  outputDir: "."                       # output directory relative to playbook (default ".")
  fps: 30                              # video frame rate (default 30)

segments:
  - id: intro
    narration: "Welcome to our wiki. Let's edit a page."
    intent: "show the wiki start page"
    timing: after                      # "after" (default) or "parallel"
    actions:
      - type: wait
        duration: 2000

  - id: open-editor
    narration: "Click the edit button to open the editor."
    intent: "click the edit button"
    actions: []
```

**Segment timing** controls when actions run relative to narration:
- `after` (default) — narration plays first, then actions execute
- `parallel` — actions execute while narration plays

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

Other target fields — use whichever best identifies the element:
```yaml
target: { selector: "#my-element" }        # CSS selector
target: { testId: "submit-btn" }           # data-testid attribute
target: { label: "Email" }                 # aria-label
target: { placeholder: "Search..." }       # placeholder text
target: { text: "Click me" }              # visible text content
```

At least one target field is required. Multiple fields can be
combined to narrow the match.

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
  timeout: 10000                    # override default timeout (ms)
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

## Setup Steps Reference

Setup steps run before the demo starts (on `open`, `reset`, `play`,
and `render`). They can be shell commands or browser actions.

**Shell commands execute relative to the project working directory**
(the directory ndemo was called from). All paths in `run` commands
should be relative to the project root.

**Shell commands** — use `run` for file operations:
```yaml
setup:
  - run: cp demo/my-feature/fixtures/original.txt data/page.txt
  - run: rm -f data/cache/*.tmp
  - run: ./scripts/reset-db.sh
```

**Browser actions** — same syntax as segment actions:
```yaml
setup:
  - type: click
    target: { role: button, name: "Login" }
  - type: type
    target: { role: textbox, name: "Username" }
    text: admin
```

**Conditional steps** — add `if` to skip when condition is not met:
```yaml
setup:
  # Only login if not already logged in
  - type: click
    target: { role: link, name: "Sign in" }
    if:
      hidden: ".user-menu"      # skip if user menu is visible
  # Only run on a specific page
  - type: click
    target: { role: button, name: "Reset" }
    if:
      url: "**/admin/settings"  # skip if not on this page
```

Condition fields:
- `visible: "<selector>"` — step runs only if selector matches visible elements
- `hidden: "<selector>"` — step runs only if selector matches no visible elements
- `url: "<pattern>"` — step runs only if current URL matches (`**` = any path)

## Action Types Reference

| Type   | Required fields | Notes |
|--------|----------------|-------|
| click  | target         | |
| type   | target, text   | Optional `delay` in ms between keystrokes (default 80) |
| hover  | target         | |
| scroll | target         | Scrolls element into view |
| wait   | duration (ms)  | Pause for the viewer (default 1000ms) |
| press  | key            | Keyboard key, e.g. "Enter", "Escape" |
| select | target, option | Dropdown selection |

## Segment ID Rules

- Lowercase alphanumeric with hyphens: `open-settings`, `toggle-dark`
- Must be unique within the playbook
- Used as filenames for audio/video, so keep them short

## Troubleshooting

- **Browser not responding**: `${CLAUDE_SKILL_DIR}/ndemo close` then `open` again.
  Check `.ndemo/daemon.log` for browser daemon output.
- **Element not found**: Run `${CLAUDE_SKILL_DIR}/ndemo page-state` to see what's
  actually on the page. The element might have a different name
  than expected. Check the app's source code for test IDs.
- **Actions pass but look wrong**: Run with `--segment <id>` to
  replay just that segment and watch carefully.
- **Render fails**: An error screenshot is saved as
  `error-<segment-id>.png` in the output directory.
- **TTS sounds wrong**: Edit narration text (punctuation affects
  pacing), or change voice/speed in playbook tts settings.
