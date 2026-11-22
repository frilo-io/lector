// Lector voice worker: Supertonic 3 (Supertone, OpenRAIL-M weights; ONNX conversion by sherpa-onnx) on onnxruntime-web (MIT).
// Pipeline ported from supertone-inc/supertonic web/helper.js (MIT). Text goes in as characters: no phonemizer.
import * as ort from '../ort/ort.wasm.min.js';
import { loader, queue, threads } from '../common.js';

const BASE = new URL('./', import.meta.url).href, ORT = new URL('../ort/', import.meta.url).href;
ort.env.wasm.wasmPaths = { mjs: ORT + 'ort-wasm-simd-threaded.js', wasm: ORT + 'ort-wasm-simd-threaded.wasm' };
ort.env.wasm.numThreads = threads();

const SR = 44100, CHUNK = 512 * 6, LATENT = 24 * 6;   // from the model's tts.json
const TTL = 50 * 256, DP = 8 * 16;                    // per-voice style sizes
const load = loader('lector-supertonic-v2');
let M = null, indexer = null, ttl = null, dpStyle = null, voices = 0;
let steps = 5, pace = 0; // refinement steps follow how fast this device is, never below 5

async function init(manifest){
  const started = performance.now();
  try{ caches.delete('lector-supertonic-v1'); }catch(e){}
  const names = ['idx', 'voice', 'dp', 'te', 've', 'voc'];
  const files = [...manifest.rt, ...names.flatMap(n => manifest[n])];
  load.expect(files.reduce((a, p) => a + p.size, 0));
  const [rt, idx, voice, dp, te, ve, voc] = await Promise.all([load.parts(ORT, manifest.rt), ...names.map(n => load.parts(BASE, manifest[n]))]);
  postMessage({ type:'progress', stage:'compile' });
  ort.env.wasm.wasmBinary = rt.buffer;
  indexer = new Int32Array(idx.slice().buffer);
  voices = Number(new DataView(voice.buffer, voice.byteOffset, voice.byteLength).getBigInt64(0, true));
  const f = new Float32Array(voice.slice(48).buffer);
  ttl = f.subarray(0, voices * TTL); dpStyle = f.subarray(voices * TTL, voices * (TTL + DP));
  const opt = { executionProviders:['wasm'], graphOptimizationLevel:'all' };
  M = { dp: await ort.InferenceSession.create(dp, opt), te: await ort.InferenceSession.create(te, opt), ve: await ort.InferenceSession.create(ve, opt), voc: await ort.InferenceSession.create(voc, opt) };
  await one('Ready.', 'en', 0, 1, 2);
  load.done();
  postMessage({ type:'ready', threads: ort.env.wasm.numThreads, cached: load.stats().cached, files: files.length, loadMs: Math.round(performance.now() - started) });
  jobs.start();
}

/* ---------- text ---------- */
const SWAP = { '–':'-', '‑':'-', '—':'-', '_':' ', '“':'"', '”':'"', '‘':"'", '’':"'", '´':"'", '`':"'", '[':' ', ']':' ', '|':' ', '/':' ', '#':' ', '→':' ', '←':' ', '«':'"', '»':'"' };
function prep(text, lang){
  text = text.normalize('NFKD').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]+/gu, '');
  for(const k in SWAP) text = text.replaceAll(k, SWAP[k]);
  text = text.replace(/[♥☆♡©\\]/g, '').replaceAll('@', ' at ')
    .replace(/ ([,.!?;:'])/g, '$1').replace(/"{2,}/g, '"').replace(/'{2,}/g, "'").replace(/\s+/g, ' ').trim();
  if(!/[.!?;:,'")\]}…。」』】〉》›»]$/.test(text)) text += '.';
  return `<${lang}>${text}</${lang}>`;
}
function split(text, max){
  const out = [];
  while(text.length > max){
    let cut = -1;
    for(const sep of ['. ', '! ', '? ', '; ', ': ', ', ', ' ']){ const k = text.lastIndexOf(sep, max); if(k > max * 0.4){ cut = k + sep.length; break; } }
    if(cut < 0) cut = max;
    out.push(text.slice(0, cut).trim()); text = text.slice(cut);
  }
  if(text.trim()) out.push(text.trim());
  return out;
}

/* ---------- synthesis ---------- */
function noise(n){
  const x = new Float32Array(n);
  for(let i = 0; i < n; i += 2){
    const u = Math.max(1e-4, Math.random()), v = Math.random(), r = Math.sqrt(-2 * Math.log(u));
    x[i] = r * Math.cos(2 * Math.PI * v); if(i + 1 < n) x[i + 1] = r * Math.sin(2 * Math.PI * v);
  }
  return x;
}
async function one(text, lang, sid, speed, nSteps){
  const ids = [];
  for(const ch of prep(text, lang)){ const cp = ch.codePointAt(0); const v = cp < indexer.length ? indexer[cp] : -1; if(v >= 0) ids.push(v); }
  const n = ids.length;
  const textIds = new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, n]);
  const textMask = new ort.Tensor('float32', new Float32Array(n).fill(1), [1, 1, n]);
  const styleDp = new ort.Tensor('float32', dpStyle.slice(sid * DP, (sid + 1) * DP), [1, 8, 16]);
  const styleTtl = new ort.Tensor('float32', ttl.slice(sid * TTL, (sid + 1) * TTL), [1, 50, 256]);
  const dur = Math.max(0.1, (await M.dp.run({ text_ids:textIds, style_dp:styleDp, text_mask:textMask })).duration.data[0] / speed);
  const emb = (await M.te.run({ text_ids:textIds, style_ttl:styleTtl, text_mask:textMask })).text_emb;
  const wavLen = Math.floor(dur * SR), L = Math.floor((wavLen + CHUNK - 1) / CHUNK);
  const latentMask = new ort.Tensor('float32', new Float32Array(L).fill(1), [1, 1, L]);
  const totalStep = new ort.Tensor('float32', new Float32Array([nSteps]), [1]);
  let xt = noise(LATENT * L);
  for(let s = 0; s < nSteps; s++){
    xt = (await M.ve.run({ noisy_latent:new ort.Tensor('float32', xt, [1, LATENT, L]), text_emb:emb, style_ttl:styleTtl, latent_mask:latentMask, text_mask:textMask,
      current_step:new ort.Tensor('float32', new Float32Array([s]), [1]), total_step:totalStep })).denoised_latent.data;
  }
  const wav = (await M.voc.run({ latent:new ort.Tensor('float32', xt, [1, LATENT, L]) })).wav_tts.data;
  return wav.slice(0, Math.min(wavLen, wav.length));
}
async function synth(job){
  const used = job.steps || steps, sid = Math.min(voices - 1, Math.max(0, job.voice | 0)), t0 = performance.now();
  const pieces = [], gap = new Float32Array(Math.floor(SR * 0.12));
  for(const part of split(job.text, job.lang === 'ja' || job.lang === 'ko' ? 110 : 290)){ if(pieces.length) pieces.push(gap); pieces.push(await one(part, job.lang, sid, 1.05 * (job.speed || 1), used)); }
  const audio = new Float32Array(pieces.reduce((a, p) => a + p.length, 0)); let o = 0; for(const p of pieces){ audio.set(p, o); o += p.length; }
  const fade = Math.min(220, audio.length >> 1);
  for(let i = 0; i < fade; i++){ const g = i / fade; audio[i] *= g; audio[audio.length - 1 - i] *= g; }
  // Spend spare speed on quality and give it back if the device falls behind. Never below 5: fewer steps thin the voice and add hiss.
  if(!job.steps){
    const rtf = (performance.now() - t0) / 1000 / (audio.length / SR); pace = pace ? pace * 0.6 + rtf * 0.4 : rtf;
    if(used === 5 && pace < 0.3){ steps = 8; pace = 0; } else if(used === 8 && pace > 0.55){ steps = 5; pace = 0; }
  }
  return { audio, rate:SR, steps:used };
}

const jobs = queue(synth);
self.onmessage = e => {
  const m = e.data;
  if(m.type === 'init') init(m.manifest).catch(err => postMessage({ type:'error', message:String(err && err.message || err) }));
  else if(m.type === 'gen') jobs.add(m);
  else if(m.type === 'clear') jobs.clear();
};
