# Third-party components

| Component | Where | Licence |
|---|---|---|
| Kokoro-82M v1.0 weights and voices (hexgrad), int8 ONNX export from thewh1teagle/kokoro-onnx | `tts/kokoro/model`, `tts/kokoro/voices` | Apache-2.0 |
| Text normalization adapted from kokoro-js (Xenova) | `tts/kokoro/worker.js` | Apache-2.0 |
| phonemizer.js 1.2.1 (Xenova), bundles eSpeak NG | `tts/kokoro/phonemizer.js` | Apache-2.0, eSpeak NG GPL-3.0-or-later |
| espeak-ng.js 1.0.2 (Ian Armour), eSpeak NG compiled to WebAssembly | `tts/kokoro/espeak-ng.*` | GPL-3.0-or-later |
| ONNX Runtime Web 1.31.1 (Microsoft) | `tts/ort` | MIT |
| JSZip 3.10.1 | `lib/jszip.min.js` | MIT or GPL-3.0 |
| Newsreader (Production Type), via Fontsource | `fonts` | SIL Open Font Licence 1.1 |

Sources: https://github.com/hexgrad/kokoro, https://github.com/thewh1teagle/kokoro-onnx, https://github.com/espeak-ng/espeak-ng, https://github.com/ianmarmour/espeak-ng.js, https://github.com/microsoft/onnxruntime
