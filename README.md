# ndemo

A CLI toolkit and [Claude Code skill](https://docs.anthropic.com/en/docs/claude-code/skills) for creating narrated demo videos of web applications. You describe what to show, Claude Code drives the browser, and the toolkit renders a polished mp4 with voiceover.

Claude Code is the agent. The toolkit provides browser management, page inspection, segment playback, and video rendering as CLI commands. The skill file (`SKILL.md`) teaches Claude Code how to use them.

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
- **OPENAI_API_KEY** environment variable (for TTS narration)
- **Claude Code** with skills support

## Installation

### As a remote skill

Add this repo as a skill in your project's `.claude/settings.json`:

```json
{
  "skills": [
    "https://github.com/splitbrain/ndemo"
  ]
}
```

### As a local skill

Clone directly into a Claude Code skills directory:

```bash
# Project-level (this project only)
git clone https://github.com/splitbrain/ndemo .claude/skills/ndemo

# Personal (available in all projects)
git clone https://github.com/splitbrain/ndemo ~/.claude/skills/ndemo
```

This is useful during development — you can edit the skill files and
the CLI source directly, and Claude Code picks up changes immediately.

You can also symlink an existing clone:

```bash
ln -s /path/to/your/ndemo ~/.claude/skills/ndemo
```

Either way, the skill file tells Claude Code how to build the toolkit and install Playwright on first use. Everything runs from within the skill's own directory — nothing gets copied into your project.

## Quick start

In Claude Code, just say:

> Create a narrated demo of my app at http://localhost:3000

Claude Code will:
1. Build the toolkit (first time only)
2. Create a playbook YAML in your project
3. Open the browser and navigate to your app
4. Inspect the page and author actions for each segment
5. Test each segment live
6. Render the final mp4 with TTS narration

You can also create the playbook yourself and ask Claude Code to fill in the actions. Each playbook lives in its own directory under `demo/`:

```
demo/
  my-tour/
    my-tour.yaml       ← playbook
    audio/             ← TTS files (generated)
    video-raw/         ← raw recording (generated)
    demo.mp4           ← final output (generated)
```

```yaml
# demo/my-tour/my-tour.yaml
app:
  url: http://localhost:3000

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

> Fill in the actions for my demo playbook at demo/my-tour/my-tour.yaml

## CLI reference

The skill file teaches Claude Code to run these commands automatically, but you can also run them directly:

```bash
<skill-directory>/ndemo <command>
```

| Command | Description |
|---------|-------------|
| `ndemo open <playbook>` | Launch a headed browser daemon and navigate to the app |
| `ndemo close` | Shut down the browser daemon |
| `ndemo reset` | Navigate back to the app URL with a fresh state |
| `ndemo page-state` | Print the current page's accessibility tree |
| `ndemo page-state --screenshot` | Same, plus save a screenshot |
| `ndemo play <playbook>` | Play all segments in the live browser |
| `ndemo play <playbook> --segment <id>` | Play just one segment (rewinds first) |
| `ndemo play <playbook> --from <id>` | Play from a segment to the end |
| `ndemo play <playbook> --from <id> --to <id>` | Play a range of segments |
| `ndemo play <playbook> --audio` | Play with TTS narration (combinable with other flags) |
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
  outputDir: .                      # relative to playbook directory
  fps: 30

segments:
  - id: segment-name                # lowercase, hyphens, unique
    narration: "What the viewer hears."
    intent: "What happens on screen (for Claude Code's reference)."
    timing: after                    # after (default) or parallel
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
  ├── reads SKILL.md (skill file) for workflow
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
