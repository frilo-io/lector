# Lector

Reads your EPUBs aloud, on your device. No account, no server, no API.

Open the site, then install it:

- **iPhone or iPad:** Safari, Share, Add to Home Screen.
- **Mac:** Safari, File, Add to Dock. Or Chrome, the install icon in the address bar.

After the first voice download it works with no connection.

## What it does

- A library of covers. Books stay in the browser storage of each device.
- Reads aloud with a neural voice that runs locally, sentence by sentence, rendering up to four minutes ahead.
- Two engines: Kokoro (the most human) and Supertonic 3 (lighter, 31 languages).
- Remembers your place per book, and reopens the book you had open.
- Long press a paragraph to highlight it. Pinch to resize the text.
- Lock screen, Control Center and menu bar controls through the system's Now Playing.

## How it is put together

No build step. Static files only.

| Path | What |
|---|---|
| `index.html` | The whole app |
| `sw.js` | Offline shell, and the isolation headers that allow multi-threaded synthesis on a static host |
| `tts/kokoro/` | Kokoro worker, model (int8, split in 20 MB parts), voices, phonemizers |
| `tts/supertonic/` | Supertonic worker and weights |
| `tts/ort/` | ONNX Runtime Web |
| `tts/samples/` | One pre-rendered line per voice |

Run it locally with any static server, for example `python3 -m http.server`, and open `http://localhost:8000`.

## Licences

The app's own code is by Orlando Jimenez. Third-party parts keep their own licences, listed in `NOTICE.md`.
One of them, eSpeak NG, is GPL-3.0-or-later. It ships here unmodified as separate files. If you redistribute this repo, read that licence first.
