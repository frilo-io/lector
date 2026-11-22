// Lector voice worker: Kokoro-82M (hexgrad, Apache-2.0) on onnxruntime-web (MIT).
// Phonemes come from eSpeak NG: a compact English build (phonemizer.js) and the full build for other languages.
// Text normalization is ported from kokoro-js (Xenova, Apache-2.0).
import * as ort from '../ort/ort.wasm.min.js';
import { phonemize } from './phonemizer.js';
import ESpeakNg from './espeak-ng.js';
import { loader, queue, threads } from '../common.js';

const BASE = new URL('./', import.meta.url).href, ORT = new URL('../ort/', import.meta.url).href;
ort.env.wasm.wasmPaths = { mjs: ORT + 'ort-wasm-simd-threaded.js', wasm: ORT + 'ort-wasm-simd-threaded.wasm' };
ort.env.wasm.numThreads = threads();

const SR = 24000;
const VOCAB = {";":1,":":2,",":3,".":4,"!":5,"?":6,"—":9,"…":10,"\"":11,"(":12,")":13,"“":14,"”":15," ":16,"̃":17,"ʣ":18,"ʥ":19,"ʦ":20,"ʨ":21,"ᵝ":22,"ꭧ":23,"A":24,"I":25,"O":31,"Q":33,"S":35,"T":36,"W":39,"Y":41,"ᵊ":42,"a":43,"b":44,"c":45,"d":46,"e":47,"f":48,"h":50,"i":51,"j":52,"k":53,"l":54,"m":55,"n":56,"o":57,"p":58,"q":59,"r":60,"s":61,"t":62,"u":63,"v":64,"w":65,"x":66,"y":67,"z":68,"ɑ":69,"ɐ":70,"ɒ":71,"æ":72,"β":75,"ɔ":76,"ɕ":77,"ç":78,"ɖ":80,"ð":81,"ʤ":82,"ə":83,"ɚ":85,"ɛ":86,"ɜ":87,"ɟ":90,"ɡ":92,"ɥ":99,"ɨ":101,"ɪ":102,"ʝ":103,"ɯ":110,"ɰ":111,"ŋ":112,"ɳ":113,"ɲ":114,"ɴ":115,"ø":116,"ɸ":118,"θ":119,"œ":120,"ɹ":123,"ɾ":125,"ɻ":126,"ʁ":128,"ɽ":129,"ʂ":130,"ʃ":131,"ʈ":132,"ʧ":133,"ʊ":135,"ʋ":136,"ʌ":138,"ɣ":139,"ɤ":140,"χ":142,"ʎ":143,"ʒ":147,"ʔ":148,"ˈ":156,"ˌ":157,"ː":158,"ʰ":162,"ʲ":164,"↓":169,"→":171,"↗":172,"↘":173,"ᵻ":177};

const load = loader('lector-kokoro-v2');
let session = null;
const voices = new Map();

async function init(manifest){
  const started = performance.now();
  load.remote(new URL('../../', import.meta.url).href, manifest.fallback);
  try{ caches.delete('lector-kokoro-v1'); }catch(e){}
  const files = [...manifest.rt, ...manifest.model];
  load.expect(files.reduce((a, p) => a + p.size, 0));
  const [rt, model] = await Promise.all([load.parts(ORT, manifest.rt), load.parts(BASE, manifest.model)]);
  postMessage({ type:'progress', stage:'compile' });
  ort.env.wasm.wasmBinary = rt.buffer;
  session = await ort.InferenceSession.create(model, { executionProviders:['wasm'], graphOptimizationLevel:'all' });
  await synth({ text:'Ready.', voice:manifest.warm || 'af_heart', speed:1, lang:'en-us' });
  load.done();
  postMessage({ type:'ready', threads: ort.env.wasm.numThreads, cached: load.stats().cached, files: files.length, loadMs: Math.round(performance.now() - started) });
  jobs.start();
  // Then, quietly, stock every voice and the other-language pronunciation data, so any voice works with no connection.
  for(const v of manifest.voices || []){ try{ await voice(v, true); }catch(e){ return; } }
  try{ await load.bytes(BASE + 'espeak-ng.wasm', 0, true); }catch(e){}
}
async function voice(name, once){
  if(!voices.has(name)){ const b = await load.bytes(BASE + 'voices/' + name + '.bin', 0, once); voices.set(name, new Float32Array(b.buffer, b.byteOffset, b.byteLength >> 2)); }
  return voices.get(name);
}

/* ---------- text to phonemes ---------- */
function splitNum(e){
  if(e.includes('.')) return e;
  if(e.includes(':')){ const [a, t] = e.split(':').map(Number); return t === 0 ? `${a} o'clock` : t < 10 ? `${a} oh ${t}` : `${a} ${t}`; }
  const a = parseInt(e.slice(0, 4), 10); if(a < 1100 || a % 1000 < 10) return e;
  const t = e.slice(0, 2), r = parseInt(e.slice(2, 4), 10), n = e.endsWith('s') ? 's' : '';
  if(a % 1000 >= 100 && a % 1000 <= 999){ if(r === 0) return `${t} hundred${n}`; if(r < 10) return `${t} oh ${r}${n}`; }
  return `${t} ${r}${n}`;
}
function flipMoney(e){
  const a = e[0] === '$' ? 'dollar' : 'pound';
  if(isNaN(Number(e.slice(1)))) return `${e.slice(1)} ${a}s`;
  if(!e.includes('.')){ const t = e.slice(1) === '1' ? '' : 's'; return `${e.slice(1)} ${a}${t}`; }
  const [t, r] = e.slice(1).split('.'); const n = parseInt(r.padEnd(2, '0'), 10);
  return `${t} ${a}${t === '1' ? '' : 's'} and ${n} ${e[0] === '$' ? (n === 1 ? 'cent' : 'cents') : (n === 1 ? 'penny' : 'pence')}`;
}
const pointNum = e => { const [a, t] = e.split('.'); return `${a} point ${t.split('').join(' ')}`; };
function normalizeEn(e){
  return e.replace(/[‘’]/g, "'").replace(/«/g, '“').replace(/»/g, '”').replace(/[“”]/g, '"').replace(/\(/g, '«').replace(/\)/g, '»')
    .replace(/[^\S \n]/g, ' ').replace(/  +/, ' ').replace(/(?<=\n) +(?=\n)/g, '')
    .replace(/\bD[Rr]\.(?= [A-Z])/g, 'Doctor').replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, 'Mister').replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, 'Miss').replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, 'Mrs')
    .replace(/\betc\.(?! [A-Z])/gi, 'etc').replace(/\b(y)eah?\b/gi, "$1e'a")
    .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, splitNum)
    .replace(/(?<=\d),(?=\d)/g, '')
    .replace(/[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi, flipMoney)
    .replace(/\d*\.\d+/g, pointNum).replace(/(?<=\d)-(?=\d)/g, ' to ').replace(/(?<=\d)S/g, ' S')
    .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S").replace(/(?<=X')S\b/g, 's')
    .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, m => m.replace(/\./g, '-')).replace(/(?<=[A-Z])\.(?=[A-Z])/gi, '-').trim();
}
const PUNCT = ';:,.!?¡¿—…"«»“”(){}[]';
const PUNCT_RE = new RegExp(`(\\s*[${PUNCT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]+\\s*)+`, 'g');
function segments(text){
  const parts = []; let last = 0;
  for(const m of text.matchAll(PUNCT_RE)){
    if(last < m.index) parts.push({ p:false, t:text.slice(last, m.index) });
    if(m[0].length) parts.push({ p:true, t:m[0] });
    last = m.index + m[0].length;
  }
  if(last < text.length) parts.push({ p:false, t:text.slice(last) });
  return parts;
}
// Other languages: the full eSpeak NG build, loaded on first use.
let espeakMod = null;
async function espeakFull(text, lang){
  if(!espeakMod) espeakMod = load.bytes(BASE + 'espeak-ng.wasm').then(b => WebAssembly.compile(b));
  const mod = await espeakMod;
  const inst = await ESpeakNg({
    arguments: ['--phonout', 'out', '-q', '--ipa=3', '-v', lang, '-f', 'in'],
    preRun: [m => m.FS.writeFile('in', text)],
    instantiateWasm: (imports, ok) => { WebAssembly.instantiate(mod, imports).then(i => ok(i, mod)); return {}; },
    print(){}, printErr(){}
  });
  return inst.FS.readFile('out', { encoding:'utf8' }).replace(/\s+/g, ' ').trim();
}
const TIE = '‍';
const E2M = [['a','ɪ','I'],['a','ʊ','W'],['d','z','ʣ'],['d','ʒ','ʤ'],['e','ɪ','A'],['o','ʊ','O'],['ə','ʊ','Q'],['s','s','S'],['t','s','ʦ'],['t','ʃ','ʧ'],['ɔ','ɪ','Y']];
async function toPhonemes(text, lang){
  if(lang !== 'en-us' && lang !== 'en'){
    text = text.replace(/[‘’]/g, "'").replace(/«/g, '“').replace(/»/g, '”').replace(/\(/g, '«').replace(/\)/g, '»').replace(/[¡¿]/g, '').replace(/\s+/g, ' ').trim();
    let ph = '';
    for(const x of segments(text)) ph += x.p ? x.t : await espeakFull(x.t, lang);
    for(const [a, b, m] of E2M) ph = ph.split(a + TIE + b).join(m);
    return ph.split(TIE).join('').replace(/-/g, '').replace(/«/g, '(').replace(/»/g, ')').trim();
  }
  text = normalizeEn(text);
  const out = (await Promise.all(segments(text).map(async x => x.p ? x.t : (await phonemize(x.t, lang)).join(' ')))).join('');
  let ph = out.replace(/ʲ/g, 'j').replace(/x/g, 'k').replace(/ɬ/g, 'l')
    .replace(/kəkˈoːɹoʊ/g, 'kˈoʊkəɹoʊ').replace(/kəkˈɔːɹəʊ/g, 'kˈəʊkəɹəʊ').replace(/r/g, 'ɹ')
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, ' ').replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, 'z');
  if(lang === 'en-us') ph = ph.replace(/(?<=nˈaɪn)ti(?!ː)/g, 'di');
  return ph.trim();
}

/* ---------- synthesis ---------- */
function chunks(ph, max = 480){
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
  const ph = await toPhonemes(job.text, job.lang), style = await voice(job.voice), pieces = [];
  for(const part of chunks(ph)){
    const ids = []; for(const ch of part){ const v = VOCAB[ch]; if(v !== undefined) ids.push(v); }
    if(!ids.length) continue;
    const n = Math.min(ids.length, 509);
    const tokens = new BigInt64Array(ids.length + 2); ids.forEach((v, k) => tokens[k + 1] = BigInt(v));
    const res = await session.run({
      tokens: new ort.Tensor('int64', tokens, [1, tokens.length]),
      style: new ort.Tensor('float32', style.slice(256 * n, 256 * n + 256), [1, 256]),
      speed: new ort.Tensor('float32', new Float32Array([job.speed || 1]), [1])
    });
    pieces.push(res.audio.data);
  }
  const audio = new Float32Array(pieces.reduce((a, p) => a + p.length, 0)); let o = 0; for(const p of pieces){ audio.set(p, o); o += p.length; }
  if(!audio.length) throw new Error('nothing to say');
  return { audio, rate:SR };
}

const jobs = queue(synth);
self.onmessage = e => {
  const m = e.data;
  if(m.type === 'init') init(m.manifest).catch(err => postMessage({ type:'error', message:String(err && err.message || err) }));
  else if(m.type === 'gen') jobs.add(m);
  else if(m.type === 'clear') jobs.clear();
};
