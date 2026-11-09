# Hedge Face Swap

Puts a face (transparent PNG) on the head in the "backs into the hedge" frame set, tracking the head frame by frame and hiding the face behind the leaves as the hedge closes in. Writes every frame as PNG plus the finished GIF.

## Run

Needs Node 18 or later and nothing else (no `npm install`). From the repository root:

```bash
node sites/homer-face-swap/server.mjs
```

Open http://localhost:5178. The source frames aren't in the repository: put the frame images (`frame_0001.png`, `frame_0002.png`, …) in a `frames` folder next to `server.mjs`, or point `FRAMES_DIR` at the folder that has them. To pick files or a GIF in the browser instead, use **Load frames…**. For a face to start with, the page loads `samples/sample-face.png` if one is there; otherwise drop a transparent PNG onto the page. `frames/`, `samples/`, `output/` and `tools/` are all git-ignored.

## Output

**Generate** saves the GIF, and with **Every frame too** ticked a ZIP of every frame as PNG, to the place chosen under **Save to**:

- **A folder:** one you pick in the browser (Chrome or Edge); it's remembered.
- **Downloads:** the browser's usual downloads.
- **App folder:** `output/run-YYYYMMDD-HHMMSS/` next to `server.mjs`.

The page also shows the last export with download buttons, and warns before a run when frames would be huge (past about 4K).

## How the matching works

| Step | What happens |
|---|---|
| Reference | Frame 1 (or any frame you choose) is searched for the highest large patch of yellow skin. That head's silhouette, the box from skull top to muzzle bottom, and a template of its edges come from there. |
| Tracking | Each frame is matched against the template for position and scale. Only visible, matching pixels count, so the match holds while the hedge covers most of the head. Results are cached in the browser. |
| Hedge | A face pixel over Homer is hidden where the frame there is leaf green. A face pixel outside his outline follows the nearest stretch of his outline, so leaves that swallow his edge swallow the face too. Nothing is hidden until the hedge has covered part of his outline. |

## Enhancing the source frames

**Enhance frames…** opens a page with two ways to clean up the TV capture and write the frames back into the frames folder:

- **Real-ESRGAN (recommended):** an AI upscaler trained on anime, run by the server on the graphics card (about 20 seconds for 147 frames at 2x). It uses the official `realesrgan-ncnn-vulkan` build in `tools/realesrgan/` (git-ignored; get it from the Real-ESRGAN releases page, or point the `REALESRGAN` environment variable at the exe) with the `realesr-animevideov3` model at 2x, 3x or 4x.
- **Filters:** hand-tuned clean-up in the browser (noise smoothing, a shared palette, colour lift, sharpening), with a drag-to-compare preview.

Before anything is replaced, each untouched capture is copied into `original\` inside the frames folder. Every run starts from those copies, so re-running never compounds, and **Restore the originals** puts them back. Tracking and the preview always work at a 960 px wide copy, so frames of any size behave the same; export uses the full source resolution, and the app re-tracks whenever the frames on disk change.

## Editing

| Control | What it does |
|---|---|
| Face box | Click the face in the preview, then drag it to move, drag a corner to resize, drag the round knob to rotate (Shift snaps to 15°). Esc lets go. |
| Paint out the original head | Erases the cartoon head and hair under the face by continuing the fence and hedge across it; the neck stays. |
| Steadiness | Smooths the tracked path (0 = raw tracking). The default, 3, removes the jitter from the character's expressions while following the camera pan. |
| Trim strip | Drag the yellow brackets to set the first and last frame, or use **Start here** / **End here** (`[` / `]`). Hover a frame and click × (or press X) to drop it. |

Settings, trim and per-frame corrections persist in the browser. **Tracking → Correct this frame** adds keyframed nudges if a frame needs help.
