// Shared by both voice workers: download with retry, keep a copy on the device, report progress.
export const join = bufs => {
  if(bufs.length === 1) return bufs[0];
  const out = new Uint8Array(bufs.reduce((a, b) => a + b.length, 0)); let o = 0;
  for(const b of bufs){ out.set(b, o); o += b.length; }
  return out;
};

export function loader(cacheName){
  let cache = null, hits = 0, got = 0, total = 0, last = 0, quiet = false, root = null, remote = null;
  const ready = (async () => { try{ cache = await caches.open(cacheName); }catch(e){} })();
  const tick = n => { if(quiet) return; got = Math.max(0, Math.min(total, got + n)); const now = performance.now(); if(now - last > 120){ last = now; postMessage({ type:'progress', got, total, stage:'download' }); } };

  // On a weak connection, wait and try again instead of giving up. Only a missing file is fatal.
  // once: a background fetch that may simply fail (used to stock the device for offline use).
  async function bytes(url, size = 0, once = false){
    await ready;
    if(cache){ try{ const hit = await cache.match(url); if(hit){ const b = new Uint8Array(await hit.arrayBuffer()); hits++; tick(size); return b; } }catch(e){} }
    let src = url;
    for(let attempt = 0;; attempt++){
      let n = 0;
      try{
        const r = await fetch(src);
        // Not on this host: take it from the public repo. It is still kept on the device under its own address.
        if(r.status === 404 && remote && src === url && url.startsWith(root)){ src = remote + url.slice(root.length); attempt = -1; continue; }
        if(!r.ok){ if(r.status >= 400 && r.status < 500) throw Object.assign(new Error('HTTP ' + r.status + ' for ' + url.split('/').pop()), { fatal:true }); throw new Error('HTTP ' + r.status); }
        const reader = r.body.getReader(); const chunks = [];
        for(;;){ const { done, value } = await reader.read(); if(done) break; chunks.push(value); n += value.length; tick(value.length); }
        const out = join(chunks);
        if(cache) cache.put(url, new Response(out.slice())).catch(() => {});
        return out;
      }catch(e){
        if(e.fatal || once) throw e;
        tick(-n); postMessage({ type:'progress', stage:'waiting' });
        await new Promise(r => setTimeout(r, Math.min(8000, 1000 * 2 ** attempt)));
      }
    }
  }
  return {
    bytes,
    expect(n){ total += n; },
    parts: (base, list) => Promise.all(list.map(p => bytes(base + p.file, p.size))).then(join),
    stats: () => ({ cached: hits }),
    remote(siteRoot, base){ if(base){ root = siteRoot; remote = base; } },
    done(){ quiet = true; },   // the engine is up: later fetches are background stocking, not progress to show
  };
}

// A tiny job queue: newest priority request first, one synthesis at a time.
export function queue(run){
  const jobs = []; let busy = false, open = false;
  async function pump(){
    if(busy || !open) return;
    const job = jobs.shift(); if(!job) return;
    busy = true;
    try{
      const t0 = performance.now(); const r = await run(job); const ms = performance.now() - t0;
      postMessage({ type:'audio', id:job.id, audio:r.audio, rate:r.rate, ms, rtf: ms / 1000 / (r.audio.length / r.rate), steps:r.steps || 0 }, [r.audio.buffer]);
    }catch(err){ postMessage({ type:'genError', id:job.id, message:String(err && err.message || err) }); }
    busy = false; pump();
  }
  return {
    start(){ open = true; pump(); },
    add(job){ if(job.priority) jobs.unshift(job); else jobs.push(job); pump(); },
    clear(){ const ids = jobs.map(j => j.id); jobs.length = 0; postMessage({ type:'cleared', ids }); },
  };
}

export const threads = () => self.crossOriginIsolated ? ((navigator.hardwareConcurrency || 4) >= 8 ? 4 : 2) : 1;
