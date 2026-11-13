const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { test } = require('node:test');

const adapters = {};
vm.createContext(adapters);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../AIApiAdapters.js'), 'utf8')
    .replace(/^\.pragma library\s*/m, ''), adapters);

test('chat and model requests keep credentials out of curl process arguments', async t => {
    const secret = 'fixture-secret-"\\$(not-a-command)';
    let child;
    const requests = [];
    const server = http.createServer((req, res) => {
        const commandLine = fs.readFileSync(`/proc/${child.pid}/cmdline`, 'utf8');
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            requests.push({
                commandLine,
                method: req.method,
                url: req.url,
                authorization: req.headers.authorization,
                body: Buffer.concat(chunks).toString('utf8'),
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{}');
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const base = `http://127.0.0.1:${server.address().port}`;

    async function run(request) {
        assert.ok(request);
        child = spawn(request.command[0], request.command.slice(1), {
            env: { ...process.env, ...request.environment },
        });
        let output = '';
        child.stdout.on('data', data => { output += data; });
        child.stderr.on('data', data => { output += data; });
        const completed = new Promise((resolve, reject) => {
            child.on('error', reject);
            child.on('close', code => code === 0 ? resolve() : reject(new Error(output)));
        });
        child.stdin.end(request.body || '');
        await completed;
        assert.match(output, /DMS_STATUS:200/);
        const received = requests.at(-1);
        assert.ok(!received.commandLine.includes(secret), 'raw credential appeared in process arguments');
        assert.ok(!received.commandLine.includes(encodeURIComponent(secret)), 'encoded credential appeared in process arguments');
        return received;
    }

    const chat = adapters.buildRequest('custom', {
        baseUrl: base, model: 'test', max_tokens: 32,
        messages: [{ role: 'user', content: 'hello' }],
    }, secret);
    const sentChat = await run(adapters.buildCurlRequest(chat, 15));
    assert.equal(sentChat.method, 'POST');
    assert.equal(sentChat.url, '/v1/chat/completions');
    assert.equal(sentChat.authorization, `Bearer ${secret}`);
    assert.equal(JSON.parse(sentChat.body).messages[0].content, 'hello');

    const sentModels = await run(adapters.buildModelsCurlRequest('custom', base, secret));
    assert.equal(sentModels.method, 'GET');
    assert.equal(sentModels.url, '/v1/models');
    assert.equal(sentModels.authorization, `Bearer ${secret}`);

    const sentGeminiModels = await run(adapters.buildModelsCurlRequest('gemini', base, secret));
    assert.equal(sentGeminiModels.method, 'GET');
    assert.equal(new URL(sentGeminiModels.url, base).searchParams.get('key'), secret);
});
