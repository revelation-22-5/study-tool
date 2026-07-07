const VERSION='v8';
const CACHE='studytool-'+VERSION;
const CORE=['./','./index.html','./app.js','./manifest.webmanifest','./icon-192.png','./icon-512.png','./apple-touch-icon.png'];
const CDN=['https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css','https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js','https://cdn.jsdelivr.net/npm/mathlive@0.100.0/dist/mathlive.min.js'];
self.addEventListener('install',e=>{e.waitUntil((async()=>{const c=await caches.open(CACHE);await c.addAll(CORE);await Promise.allSettled(CDN.map(u=>c.add(u)));self.skipWaiting();})());});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{const k=await caches.keys();await Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)));self.clients.claim();})());});
self.addEventListener('fetch',e=>{const req=e.request;if(req.method!=='GET')return;const url=new URL(req.url);
  const isCDN=url.href.includes('katex')||url.href.includes('mathlive');
  const isCore=url.origin===location.origin;
  if(isCDN){e.respondWith((async()=>{const c=await caches.match(req);if(c)return c;try{const r=await fetch(req);const ch=await caches.open(CACHE);ch.put(req,r.clone());return r;}catch(_){return c||Response.error();}})());}
  else if(isCore){e.respondWith((async()=>{try{const r=await fetch(req);const ch=await caches.open(CACHE);ch.put(req,r.clone());return r;}catch(_){const c=await caches.match(req);return c||caches.match('./index.html');}})());}
});
