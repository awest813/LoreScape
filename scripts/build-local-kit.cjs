const fs = require('node:fs');
const path = require('node:path');
const {deflateRawSync} = require('node:zlib');

// Deterministic ZIP writer, independent of platform ZIP utilities.
function crc32(data) {
    let crc = 0xffffffff;
    for (const byte of data) {
        crc ^= byte;
        for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function buildKit(assets) {
    const root = path.resolve(__dirname, '..');
    const output = path.join(root, 'public');
    const files = [];
    for (const name of ['setup.cjs', 'start.cjs', 'gateway.cjs', 'README.txt', 'server-package-lock.json']) files.push([name, fs.readFileSync(path.join(__dirname, 'local-server', name))]);
    for (const name of ['LICENSE', 'NOTICE']) if (fs.existsSync(path.join(root, name))) files.push([name, fs.readFileSync(path.join(root, name))]);
    for (const name of assets.sort()) {
        if (name.endsWith('.map') || name.endsWith('.zip')) continue;
        files.push(['client/' + name, fs.readFileSync(path.join(output, name))]);
    }
    const chunks = [], directory = [];
    let offset = 0;
    for (const [filename, data] of files) {
        const name = Buffer.from('LoreScape-local-server/' + filename);
        const compressed = deflateRawSync(data);
        const crc = crc32(data);
        const header = Buffer.alloc(30);
        header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8); header.writeUInt16LE(33, 12);
        header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10); central.writeUInt16LE(33, 14);
        central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
        chunks.push(header, name, compressed); directory.push(central, name);
        offset += header.length + name.length + compressed.length;
    }
    const central = Buffer.concat(directory);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
    fs.writeFileSync(path.join(output, 'lorescape-local-server.zip'), Buffer.concat([...chunks, central, end]));
    console.log(`Local server setup ZIP built (${files.length} files).`);
}
module.exports = {buildKit};
