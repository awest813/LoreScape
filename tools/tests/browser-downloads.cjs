const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require(process.env.LORESCAPE_PLAYWRIGHT_PATH || '/opt/codex/cua_node/lib/node_modules/playwright');
(async () => {
 const dir = path.resolve(process.env.LORESCAPE_DOWNLOAD_DIR || 'dist');
 let mode = '', stopped = false;
 const types = {'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm'};
 const server = http.createServer((req,res) => {
  const name = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file = path.join(dir, name === '/coop' ? '/coop.html' : name);
  if (name === '/offline-assets.json' && mode) {
   const m = JSON.parse(fs.readFileSync(file)); if(mode !== 'repair') m.revision = 'd'.repeat(20);
   if(mode === 'duplicate') {m.assets.push(m.assets[0]);m.bytes += m.assets[0].bytes;}
   if(mode === 'corrupt' || mode === 'repair') m.assets[0].sha256 = '0'.repeat(64);
   res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(m));return;
  }
  const send = () => {if(res.destroyed)return; if(!fs.existsSync(file) || !fs.statSync(file).isFile()){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);};
  if(mode === 'slow' && name.includes('/data/')) setTimeout(send,1000);else send();
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base = `http://localhost:${server.address().port}`;
 const browser = await chromium.launch({executablePath:process.env.LORESCAPE_CHROMIUM_PATH || '/usr/bin/chromium'});
 try {
  const context = await browser.newContext({acceptDownloads:true});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/coop');await page.evaluate(()=>document.querySelector('#devicePanel').open=true);
  await page.waitForFunction(()=>document.querySelector('#offlineStatus').textContent.includes('not downloaded'));
  mode='slow';await page.locator('#downloadOffline').click();await page.waitForFunction(()=>document.querySelector('#offlineStatus').textContent.includes('Downloading'));
  await page.locator('#cancelOffline').click();await page.waitForFunction(()=>document.querySelector('#cancelOffline').hidden);
  assert.match(await page.locator('#notice').textContent(),/cancelled/);
  assert.equal((await page.evaluate(()=>caches.keys())).filter(n=>n.startsWith('lorescape-assets')).length,0);
  console.log('PASS: cancel cleans partial files and releases operation for retry');
  mode='';await page.locator('#downloadOffline').click();await page.waitForFunction(()=>document.querySelector('#offlineStatus').textContent.includes('Offline ready') || document.querySelector('#notice').classList.contains('error'),null,{timeout:180000});
  assert.match(await page.locator('#offlineStatus').textContent(), /Offline ready/, await page.locator('#notice').textContent());
  await page.waitForFunction(()=>document.querySelector('#cancelOffline').hidden);
  console.log('PASS: full game pack downloaded and verified');
  for(const fault of ['duplicate','corrupt','slow','quota']) {
   if(fault==='quota') await context.serviceWorkers()[0].evaluate(()=>{globalThis.__originalPut=Cache.prototype.put;Cache.prototype.put=function(){throw new DOMException('Test storage full','QuotaExceededError');};});
   mode=fault;await page.locator('#downloadOffline').click();
   if(fault==='slow'){await page.waitForFunction(()=>document.querySelector('#offlineStatus').textContent.includes('Downloading'));await page.locator('#cancelOffline').click();}
   await page.waitForFunction(()=>document.querySelector('#cancelOffline').hidden);
   assert.match(await page.locator('#offlineStatus').textContent(),/Offline ready/);
   if(fault!=='slow') assert.match(await page.locator('#notice').textContent(),fault==='duplicate'?/Invalid offline manifest/:fault==='quota'?/Not enough browser storage/:/changed during download/);
   assert.equal((await page.evaluate(()=>caches.keys())).filter(n=>n.startsWith('lorescape-assets')).length,1);
   if(fault==='quota') await context.serviceWorkers()[0].evaluate(()=>{Cache.prototype.put=globalThis.__originalPut;});
  }
  mode='';console.log('PASS: duplicate manifest, corrupt update, storage quota and cancelled update retain previous pack');
  const repair = await page.evaluate(async()=>{
   const cache=await caches.open((await caches.keys()).find(n=>n.startsWith('lorescape-assets')));
   const m=await (await fetch('/offline-assets.json')).json();await cache.delete(m.assets[0].url);
   return {url:m.assets[0].url,count:(await cache.keys()).length};
  });
  mode='repair';await page.locator('#downloadOffline').click();await page.waitForFunction(()=>document.querySelector('#cancelOffline').hidden);
  assert.match(await page.locator('#notice').textContent(),/changed during download/);
  assert.equal(await page.evaluate(async()=>{const c=await caches.open((await caches.keys()).find(n=>n.startsWith('lorescape-assets')));return (await c.keys()).length;}),repair.count);
  mode='';await page.evaluate(async url=>{const c=await caches.open((await caches.keys()).find(n=>n.startsWith('lorescape-assets')));await c.put(url,await fetch(url));},repair.url);
  console.log('PASS: failed repair of the same revision keeps remaining cached files');
  // Instrument only this disposable profile's cache to inspect actual offline gameplay.
  await page.evaluate(async()=>{
   const names=await caches.keys();const cache=await caches.open(names.find(n=>n.startsWith('lorescape-assets')));
   const response=await cache.match('/index.js');const source=await response.text();const marker=/\(new ([\w$]+)\)\.run\(\)/;
   if(!marker.test(source))throw Error('Game bootstrap missing');
   await cache.put('/index.js',new Response(source.replace(marker,'(window.__smokeGame = new $1).run()'),{headers:response.headers}));
  });
  server.closeAllConnections();await new Promise(r=>server.close(r));stopped=true;
  await context.setOffline(true);await page.reload();await page.evaluate(()=>document.querySelector('#devicePanel').open=true);
  await page.locator('#batteryPreset').click();await page.locator('#worldName').fill('Download audit world');await page.locator('#solo').click();
  await page.waitForFunction(()=>window.LoreCoop?.ready,null,{timeout:60000}).catch(async error=>{console.error('OFFLINE START',await page.locator('#notice').textContent(), await page.locator('#startupPanel').textContent(),errors);throw error;});
  await page.waitForFunction(()=>document.querySelector('#startupPanel').hidden);
  const frame=page.frames().find(f=>f.url().includes('world=999'));await frame.waitForFunction(()=>window.__smokeGame?.fontBold12,null,{timeout:60000});
  await frame.evaluate(async()=>{const g=window.__smokeGame;g.username='downloadqa';g.password='private';await g.login(g.username,g.password,false);});
  await frame.waitForFunction(()=>window.__smokeGame.ingame && window.__smokeGame.sceneState===2,null,{timeout:40000});
  await page.locator('#save').click();await page.waitForFunction(()=>/progress saved/i.test(document.querySelector('#notice').textContent));
  const downloadPromise=page.waitForEvent('download');await page.locator('#sessionExport').click();const download=await downloadPromise;
  assert.match(download.suggestedFilename(),/^lorescape-Download-audit-world-\d{4}-.*\.json$/);assert.equal(await download.failure(),null);
  const text=fs.readFileSync(await download.path(),'utf8');
  const checked=await page.evaluate(async text=>{const {SaveStore}=await import('/coop/storage.mjs');const data=await new SaveStore().inspect(text);return data;},text);
  assert.deepEqual(Object.keys(checked.characters),['downloadqa']);
  const restored = await page.evaluate(async text=>{const {SaveStore}=await import('/coop/storage.mjs');const store=new SaveStore();const data=await store.import(text);const result={id:data.id,characters:Object.keys(data.characters)};await store.remove(data.id);return result;},text);
  assert.notEqual(restored.id,checked.id);assert.deepEqual(restored.characters,['downloadqa']);
  await page.locator('#leave').click();
  await page.evaluate(()=>document.querySelectorAll('details').forEach(d=>d.open=true));
  const lobbyDownloadPromise=page.waitForEvent('download');await page.locator('#export').click();const lobbyDownload=await lobbyDownloadPromise;
  assert.match(lobbyDownload.suggestedFilename(),/^lorescape-Download-audit-world-/);assert.equal(await lobbyDownload.failure(),null);
  assert.match(await page.locator('#notice').textContent(),/Backup download started/);
  assert.deepEqual(errors,[]);
  console.log('PASS: offline world starts, character logs in, saves and exports a valid dated backup');
 }finally{await browser.close();if(!stopped){server.closeAllConnections();await new Promise(r=>server.close(r));}}
})().catch(e=>{console.error(e);process.exitCode=1;});
