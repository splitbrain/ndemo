# narrated-demo

A CLI toolkit and [Claude Code skill](https://docs.anthropic.com/en/docs/claude-code/skills) for creating narrated demo videos of web applications. You describe what to show, Claude Code drives the browser, and the toolkit renders a polished mp4 with voiceover.

Claude Code is the agent. The toolkit provides browser management, page inspection, segment playback, and video rendering as CLI commands. The skill file (`narrated-demo.md`) teaches Claude Code how to use them.

## How it works

1. You write a **playbook** (YAML) that lists the segments of your demo — each with narration text and a description of what should happen on screen.
2. Claude Code opens a real browser, reads the page's accessibility tree, and fills in the concrete actions (clicks, typing, waits) for each segment.
3. You review each segment live in the browser, iterate with Claude Code until it looks right, then render the final video with TTS narration.

```
You: "Create a demo showing the new dashboard filters"
  → Claude Code writes the playbook, opens the browser,
    authors actions by inspecting the page, tests each
    segment, and renders the final mp4.
```

## Prerequisites

- **Node.js 20+**
- **ffmpeg** with libx264 and aac encoders (ffprobe ships with it)
- **Playwright Chromium**: installed via `npx playwright install chromium`
- **OPENAI_API_KEY** environment variable (for TTS narration)
- **Claude Code** with skills support

## Installation

### As a Claude Code skill (recommended)

Add this repo as a skill in your project's `.claude/settings.json`:

```json
{
  "skills": [
    "https://github.com/splitbrain/ndemo"
  ]
}
```

Then set up the toolkit in your project:

```bash
cd my-web-app/

# Clone and build the toolkit
git clone https://github.com/splitbrain/ndemo.git narrated-demo
cd narrated-demo && npm install && npm run build
```

### Manual setup

```bash
# Clone into your project
cd my-web-app/
git clone https://github.com/splitbrain/ndemo.git narrated-demo
cd narrated-demo

# Install dependencies and build
npm install
npm run build

# Install Playwright's Chromium
npx playwright install chromium

# Verify everything is set up
npx ndemo doctor
```

## Quick start

### 1. Create a playbook

Create `narrated-demo/demos/my-demo.yaml`:

```yaml
app:
  url: http://localhost:3000
  viewport: { width: 1920, height: 1080 }

segments:
  - id: intro
    narration: "Welcome to our app. Let's take a quick tour."
    intent: "show the landing page"
    actions:
      - type: wait
        duration: 3000

  - id: open-settings
    narration: "First, open the settings panel."
    intent: "click the settings button"
    actions: []
```

Write all your segments with narration and intent first. Leave `actions: []` for segments you want Claude Code to fill in.

### 2. Let Claude Code author the actions

In Claude Code, just say:

> Fill in the actions for my demo playbook at narrated-demo/demos/my-demo.yaml

Claude Code will:
- Open the browser with `ndemo open`
- Inspect the page with `ndemo page-state`
- Write the actions based on what it sees in the accessibility tree
- Test each segment with `ndemo play --segment <id>`
- Iterate until everything works

### 3. Review and render

Watch the full demo:

```bash
cd narrated-demo && npx ndemo play demos/my-demo.yaml
```

When you're happy with it:

```bash
cd narrated-demo && npx ndemo render demos/my-demo.yaml
```

This generates TTS audio for each segment, replays everything in a headless browser with video recording, and merges the result into a final mp4.

## CLI reference

All commands run from the `narrated-demo/` directory:

```bash
cd narrated-demo
npx ndemo <command>
```

| Command | Description |
|---------|-------------|
| `ndemo open <playbook>` | Launch a headed browser daemon and navigate to the app |
| `ndemo close` | Shut down the browser daemon |
| `ndemo reset` | Navigate back to the app URL with a fresh state |
| `ndemo page-state` | Print the current page's accessibility tree |
| `ndemo page-state --screenshot` | Same, plus save a screenshot to `.ndemo/screenshot.png` |
| `ndemo play <playbook>` | Play all segments in the live browser |
| `ndemo play <playbook> --segment <id>` | Play just one segment (rewinds first) |
| `ndemo play <playbook> --from <id>` | Play from a segment to the end |
| `ndemo play <playbook> --from <id> --to <id>` | Play a range of segments |
| `ndemo render <playbook>` | Full pipeline: TTS, headless replay, merge to mp4 |
| `ndemo render <playbook> --output path.mp4` | Render to a specific output path |
| `ndemo doctor` | Check that all dependencies are installed |

## Playbook format

```yaml
app:
  url: https://myapp.dev           # required
  viewport:                         # optional, defaults shown
    width: 1920
    height: 1080
  scale: 2                          # device scale factor
  zoom: 1.25                        # CSS zoom
  colorScheme: light                # light or dark
  setup:                            # optional actions to run on load
    - type: click
      target: { role: button, name: "Accept cookies" }

tts:                                # optional, defaults shown
  provider: openai
  voice: alloy
  speed: 1.0

recording:                          # optional, defaults shown
  outputDir: ./output
  fps: 30

segments:
  - id: segment-name                # lowercase, hyphens, unique
    narration: "What the viewer hears."
    intent: "What happens on screen (for Claude Code's reference)."
    actions:
      - type: click
        target: { role: button, name: "Settings" }
        done:
          visible: ".settings-panel"
      - type: wait
        duration: 2000
```

### Action types

| Type | Required fields | Notes |
|------|----------------|-------|
| `click` | `target` | |
| `type` | `target`, `text` | `delay: 60-100` for human-like typing |
| `hover` | `target` | |
| `scroll` | `target` | Scrolls the element into view |
| `wait` | `duration` (ms) | Pause so the viewer can see what happened |
| `press` | `key` | Keyboard key, e.g. `Enter`, `Escape` |
| `select` | `target`, `option` | Dropdown selection |

### Targets

Targets tell Playwright how to find an element. Use the output of `ndemo page-state` to pick the right one:

```yaml
target: { role: button, name: "Settings" }     # accessibility role + name
target: { label: "Email address" }              # form label
target: { placeholder: "Search..." }            # input placeholder
target: { text: "Learn more" }                  # visible text
target: { testId: "submit-btn" }                # data-testid attribute
target: { selector: "#my-element" }             # CSS selector (last resort)
```

### Done conditions

Every action that changes the page should have a `done` condition so the next action waits for the page to be ready:

```yaml
done:
  visible: ".panel"                  # element appears
  hidden: ".spinner"                 # element disappears
  networkIdle: true                  # no pending network requests
  stable: 500                        # DOM unchanged for 500ms
  url: "**/settings"                 # URL matches pattern
  text:                              # element contains text
    selector: ".status"
    has: "Saved"
  attribute:                         # element has attribute value
    selector: html
    name: data-theme
    value: dark
```

## Architecture

```
Claude Code (the agent)
  ├── reads narrated-demo.md (skill file) for workflow
  ├── reads the web app's source for context
  ├── edits playbook YAML
  └── runs ndemo CLI commands
        │
        ├── open ──── launches browser daemon
        ├── page-state ── reads accessibility tree
        ├── play ──── executes segments in live browser
        ├── render ── TTS + headless replay + merge
        └── close ─── kills browser daemon
```

The toolkit deliberately avoids building its own agent loop, conversation manager, retry logic, or element discovery. Claude Code already does all of that — the skill file just teaches it the workflow.

## License

MIT
