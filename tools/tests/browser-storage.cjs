const assert = require('node:assert/strict');
const {chromium} = require(process.env.LORESCAPE_PLAYWRIGHT_PATH || 'playwright');
(async () => {
    const browser = await chromium.launch({executablePath: process.env.LORESCAPE_CHROMIUM_PATH});
    try {
        const context = await browser.newContext(); const page = await context.newPage();
        await page.goto((process.env.LORESCAPE_TEST_URL || 'http://localhost:8080') + '/coop.html');
        const result = await page.evaluate(async () => {
            const {SaveStore, crc32} = await import('/coop/storage.mjs'); const store = new SaveStore();
            const data = store.newWorld('Storage test'); const bytes = new Uint8Array(144); bytes.set([0x20,4,0,5]);
            new DataView(bytes.buffer).setUint32(140, crc32(bytes.subarray(0,140))); store.setCharacter(data, 'testchar', bytes);
            if (store.character(data, 'constructor').length) throw new Error('Inherited character key was returned');
            store.setCharacter(data, 'constructor', bytes); store.setCharacter(data, '__proto__', bytes);
            if (store.character(data, 'constructor').length !== 144 || Object.getPrototypeOf(data.characters) !== Object.prototype) throw new Error('Unsafe character dictionary');
            const originalId = data.id; const pending = store.commit(data); data.id = 'mutated-id'; await pending;
            if (!(await store.read(originalId)) || await store.read('mutated-id')) throw new Error('Commit used mutable identity');
            data.id = originalId;
            if ((await Promise.all([store.open(), store.open()]))[0] !== store.db) throw new Error('Duplicate database handles');
            await store.commit(data); data.settings.xpRate = 2; await store.commit(data); data.settings.xpRate = 5; await store.commit(data);
            const db = await store.open();
            await new Promise((resolve,reject) => { const tx=db.transaction('worlds','readwrite'); const records=tx.objectStore('worlds'); const req=records.get(data.id); req.onsuccess=()=>{req.result.history[0].checksum='damaged';records.put(req.result);};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error); });
            const restored = await store.load(data.id);
            if (!restored.recovered || restored.data.settings.xpRate !== 2) throw new Error('Failed corrupt-latest recovery');
            const before = JSON.stringify(await store.read(data.id));
            await new Promise(resolve => { const tx=db.transaction('worlds','readwrite');tx.objectStore('worlds').put({id:data.id,history:[]});tx.abort();tx.onabort=resolve; });
            if (JSON.stringify(await store.read(data.id)) !== before) throw new Error('Aborted transaction changed the stored world');
            const archive = await store.export(data.id); const imported = await store.import(archive);
            if (imported.id === data.id || store.character(imported,'testchar').length !== bytes.length) throw new Error('Failed portable import');
            let rejected=0;
            for(const bad of [JSON.stringify({...JSON.parse(archive),version:9}), archive.replace('Storage test','Tampered test')]) { try { await store.inspect(bad); } catch { rejected++; } }
            if(rejected!==2) throw new Error('Invalid archives were accepted');
            const recovered=await store.recover(data.id); if(recovered.settings.xpRate!==2) throw new Error('Failed explicit recovery');
            return {archive,characters:Object.keys(imported.characters),count:(await store.read(data.id)).history.length};
        });
        assert.deepEqual(result.characters,['testchar','constructor','__proto__']); assert.equal(result.count,3);
        const other = await browser.newContext(); const otherPage=await other.newPage(); await otherPage.goto((process.env.LORESCAPE_TEST_URL || 'http://localhost:8080')+'/coop.html');
        const imported=await otherPage.evaluate(async archive=>{const {SaveStore}=await import('/coop/storage.mjs');const store=new SaveStore();const data=await store.import(archive);return {count:(await store.list()).length,bytes:store.character(data,'testchar').length};},result.archive);
        assert.equal(imported.count,1);assert.equal(imported.bytes,144);
        console.log('PASS: three snapshots, corrupt-latest recovery, aborted writes, archive validation, safe character keys, immutable commits, and import into another browser profile');
    } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
