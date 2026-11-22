// Lector voice worker: Piper VITS (rhasspy, MIT) running the Daniela voice (es_AR, trained on OpenSLR 61, CC BY-SA 4.0) on onnxruntime-web (MIT).
// Phonemes come from the same full eSpeak NG build Kokoro uses; its copy on the device is shared.
import * as ort from '../ort/ort.wasm.min.js';
import ESpeakNg from '../kokoro/espeak-ng.js';
import { loader, queue, threads } from '../common.js';

const BASE = new URL('./', import.meta.url).href, ORT = new URL('../ort/', import.meta.url).href, KOKORO = new URL('../kokoro/', import.meta.url).href;
ort.env.wasm.wasmPaths = { mjs: ORT + 'ort-wasm-simd-threaded.js', wasm: ORT + 'ort-wasm-simd-threaded.wasm' };
ort.env.wasm.numThreads = threads();

const load = loader('lector-piper-v1');
let session = null, C = null, espeakMod = null;

async function init(manifest){
  const started = performance.now();
  const root = new URL('../../', import.meta.url).href;
  load.remote(root, manifest.fallback);
  C = await (await fetch(BASE + manifest.config)).json();
  // eSpeak NG is shared with Kokoro: use Kokoro's copy when the device already has it.
  const ek = KOKORO + manifest.espeak.file;
  let have = null; try{ const r = await (await caches.open('lector-kokoro-v2')).match(ek); if(r) have = new Uint8Array(await r.arrayBuffer()); }catch(e){}
  const files = [...manifest.rt, ...manifest.model, ...(have ? [] : [manifest.espeak])];
  load.expect(files.reduce((a, p) => a + p.size, 0));
  const [rt, model, es] = await Promise.all([load.parts(ORT, manifest.rt), load.parts(BASE, manifest.model), have || load.bytes(ek, manifest.espeak.size)]);
  espeakMod = WebAssembly.compile(es);
  postMessage({ type:'progress', stage:'compile' });
  ort.env.wasm.wasmBinary = rt.buffer;
  session = await ort.InferenceSession.create(model, { executionProviders:['wasm'], graphOptimizationLevel:'all' });
  await synth({ text:'Listo.', speed:1 });
  load.done();
  postMessage({ type:'ready', threads: ort.env.wasm.numThreads, cached: load.stats().cached, files: files.length, loadMs: Math.round(performance.now() - started) });
  jobs.start();
}

/* ---------- text to phonemes ---------- */
async function espeak(text){
  const mod = await espeakMod;
  const inst = await ESpeakNg({
    arguments: ['--phonout', 'out', '-q', '--ipa=3', '-v', C.espeak, '-f', 'in'],
    preRun: [m => m.FS.writeFile('in', text)],
    instantiateWasm: (imports, ok) => { WebAssembly.instantiate(mod, imports).then(i => ok(i, mod)); return {}; },
    print(){}, printErr(){}
  });
  return inst.FS.readFile('out', { encoding:'utf8' }).replace(/\s+/g, ' ').trim();
}
// Piper was trained on eSpeak output with the punctuation kept in place.
const PUNCT = /(\s*[;:,.!?¡¿«»"“”()—…]+\s*)+/g;
async function toPhonemes(text){
  text = text.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
  let ph = '', last = 0;
  for(const m of text.matchAll(PUNCT)){
    if(last < m.index) ph += await espeak(text.slice(last, m.index));
    ph += m[0].replace(/[«»"“”()]/g, '').replace(/—/g, ',').replace(/…/g, '.').replace(/\s+/g, ' ');
    last = m.index + m[0].length;
  }
  if(last < text.length) ph += await espeak(text.slice(last));
  return ph.replace(/‍/g, '').replace(/\([a-z-]+\)/g, '').replace(/ +/g, ' ').trim();
}

/* ---------- synthesis ---------- */
function chunks(ph, max = 400){
  const out = [];
  while(ph.length > max){
    let cut = -1;
    for(const sep of ['. ', '! ', '? ', '; ', ': ', ', ', ' ']){ const k = ph.lastIndexOf(sep, max); if(k > max * 0.4){ cut = k + sep.length; break; } }
    if(cut < 0) cut = max;
    out.push(ph.slice(0, cut)); ph = ph.slice(cut);
  }
  if(ph.trim()) out.push(ph);
  return out;
}
async function synth(job){
  const M = C.map, I = C.inference, pieces = [];
  for(const part of chunks(await toPhonemes(job.text))){
    const ids = [M['^'], M['_']];
    for(const ch of part){ const v = M[ch]; if(v !== undefined) ids.push(v, M['_']); }
    ids.push(M['$']);
    if(ids.length < 5) continue;
    const res = await session.run({
      input: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
      input_lengths: new ort.Tensor('int64', BigInt64Array.from([ids.length], BigInt), [1]),
      scales: new ort.Tensor('float32', new Float32Array([I.noise_scale, I.length_scale / (job.speed || 1), I.noise_w]), [3])
    });
    pieces.push(res.output.data);
  }
  const audio = new Float32Array(pieces.reduce((a, p) => a + p.length, 0)); let o = 0; for(const p of pieces){ audio.set(p, o); o += p.length; }
  if(!audio.length) throw new Error('nothing to say');
  return { audio, rate:C.sr };
}

const jobs = queue(synth);
self.onmessage = e => {
  const m = e.data;
  if(m.type === 'init') init(m.manifest).catch(err => postMessage({ type:'error', message:String(err && err.message || err) }));
  else if(m.type === 'gen') jobs.add(m);
  else if(m.type === 'clear') jobs.clear();
};
