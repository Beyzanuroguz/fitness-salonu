// Only public, static app assets are cached. Personal APIs always use the network.
const CACHE='formclub-unified-1';
const FILES=['/','/index.html','/style.css','/dashboard.css','/dashboard.js','/app.js','/manifest.webmanifest','/v8.html','/v8.js','/v8-calc.js','/v7.css','/v8.css','/v9/index.html','/v9/v9.js','/v9/v9-core.js','/v9/v9.css','/v9/vendor/qrcode.js','/v9/vendor/jsQR.js','/v9/icons/icon-192.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)))});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{for(const k of await caches.keys())if(k.startsWith('formclub-')&&k!==CACHE)await caches.delete(k);await self.clients.claim()})())});
self.addEventListener('fetch',e=>{
 const r=e.request,u=new URL(r.url);
 if(r.method!=='GET'||u.origin!==self.location.origin||u.pathname.startsWith('/api/')||u.search||!FILES.includes(u.pathname))return;
 e.respondWith(fetch(r).catch(async()=>await caches.match(r)||new Response('Çevrimdışı',{status:503})));
});
