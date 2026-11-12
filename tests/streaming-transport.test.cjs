const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { test } = require('node:test');

const promptMarker = 'system-prompt-fixture-95b7';
const prompt = promptMarker + '日本語\n'.repeat(20000) + '"\\t"';
const apiKey = 'fixture-secret-4af872';
const sourceDir = path.join(__dirname, '..');

function executable(name) {
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
        const candidate = path.join(dir || '.', name);
        try {
            fs.accessSync(candidate, fs.constants.X_OK);
            return candidate;
        } catch (_) {}
    }
    throw new Error(`${name} is required to run the streaming transport test`);
}

function fixtureDirectory() {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'dms-ai-transport-'));
    for (const dir of ['qs/Common', 'qs/Services', 'state', 'config', 'cache', 'runtime', 'bin'])
        fs.mkdirSync(path.join(fixture, dir), { recursive: true, mode: 0o700 });
    for (const file of ['AIAssistantService.qml', 'AIApiAdapters.js'])
        fs.copyFileSync(path.join(sourceDir, file), path.join(fixture, file));
    fs.copyFileSync(path.join(__dirname, 'StreamingTransport.qml'), path.join(fixture, 'shell.qml'));
    fs.symlinkSync('qs/Common', path.join(fixture, 'Common'));
    fs.symlinkSync('qs/Services', path.join(fixture, 'Services'));
    fs.writeFileSync(path.join(fixture, 'request-started'), 'waiting');
    fs.writeFileSync(path.join(fixture, 'qs/Common/qmldir'), 'module qs.Common\nsingleton Paths 1.0 Paths.qml\n');
    fs.writeFileSync(path.join(fixture, 'qs/Common/Paths.qml'), `pragma Singleton
import QtQuick
QtObject { function strip(path) { return path.toString().replace(/^file:\\/\\//, "") } }
`);
    fs.writeFileSync(path.join(fixture, 'qs/Services/qmldir'), 'module qs.Services\nsingleton PluginService 1.0 PluginService.qml\n');
    fs.writeFileSync(path.join(fixture, 'qs/Services/PluginService.qml'), `pragma Singleton
import QtQuick
import Quickshell
QtObject {
    signal pluginDataChanged(string pluginId)
    property var data: ({
        provider: "custom",
        providers: { custom: {
            baseUrl: Quickshell.env("DMS_TEST_URL"), model: "stub-model",
            apiKey: Quickshell.env("DMS_TEST_KEY"), saveApiKey: true,
            systemPrompt: "system-prompt-fixture-95b7" + "日本語\\n".repeat(20000) + "\\\"\\\\t\\\""
        } }
    })
    function loadPluginData(id, key, fallback) { return data[key] === undefined ? fallback : data[key] }
    function savePluginData(id, key, value) {
        const next = Object.assign({}, data); next[key] = value; data = next
        pluginDataChanged(id)
    }
}
`);
    return fixture;
}

function runService(fixture, url, expectedError, searchPath, cancelMode = '', key = apiKey) {
    const env = { ...process.env,
        DMS_TEST_URL: url, DMS_TEST_KEY: key, DMS_TEST_EXPECTED_ERROR: expectedError,
        DMS_TEST_CANCEL: cancelMode,
        DMS_TEST_SIGNAL: path.join(fixture, 'request-started'),
        DMS_LOG_LEVEL: 'error', QS_FORCE_STDERR_LOGGING: '1',
        QT_QPA_PLATFORM: 'offscreen', QT_QUICK_BACKEND: 'software',
        XDG_CONFIG_HOME: path.join(fixture, 'config'),
        XDG_CACHE_HOME: path.join(fixture, 'cache'),
        XDG_STATE_HOME: path.join(fixture, 'state'),
        XDG_RUNTIME_DIR: path.join(fixture, 'runtime'),
        QML_IMPORT_PATH: [fixture, process.env.QML_IMPORT_PATH || ''].filter(Boolean).join(path.delimiter),
        PATH: searchPath,
    };
    for (const key of ['WAYLAND_DISPLAY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY',
                       'INCEPTION_API_KEY', 'DMS_OPENAI_API_KEY', 'DMS_ANTHROPIC_API_KEY',
                       'DMS_GEMINI_API_KEY', 'DMS_INCEPTION_API_KEY', 'DMS_CUSTOM_API_KEY'])
        delete env[key];

    return new Promise((resolve, reject) => {
        const runner = spawn(process.env.QUICKSHELL_BIN || executable('quickshell'),
                             ['-p', path.join(fixture, 'shell.qml'), '--no-color'], { env });
        let output = '';
        runner.stdout.setEncoding('utf8');
        runner.stderr.setEncoding('utf8');
        runner.stdout.on('data', data => { output += data; });
        runner.stderr.on('data', data => { output += data; });
        const timeout = setTimeout(() => runner.kill('SIGKILL'), 15000);
        runner.on('error', error => { clearTimeout(timeout); reject(error); });
        runner.on('close', (code, signal) => {
            clearTimeout(timeout);
            if (code !== 0)
                reject(new Error(`Quickshell exited ${code}, signal ${signal}:\n${output}`));
            else
                resolve(output);
        });
    });
}

function listen(server) {
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function streamingServer(requests, firstDelay = 30, firstSignal = '') {
    return http.createServer((req, res) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            requests.push({ url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
            if (requests.length === 1 && firstSignal)
                fs.writeFileSync(firstSignal, 'received');
            const delay = requests.length === 1 ? firstDelay : 30;
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            res.write('data: {"choices":[{"delta":{"content":"part A"}}]}\n\n');
            setTimeout(() => {
                if (!res.destroyed) {
                    res.write('data: {"choices":[{"delta":{"content":" + B"}}]}\n\ndata: [DONE]\n\n');
                    setTimeout(() => { if (!res.destroyed) res.end(); }, 300);
                }
            }, delay);
        });
    });
}

test('large instructions reach curl intact and sequential streamed replies complete', async t => {
    const fixture = fixtureDirectory();
    t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
    const requests = [];
    const server = streamingServer(requests);
    t.after(() => { server.closeAllConnections(); server.close(); });
    const port = await listen(server);
    const quotedKey = 'fixture-secret-$(printf changed)-";$SHELL';
    const output = await runService(fixture, `http://127.0.0.1:${port}`, '', process.env.PATH, '', quotedKey);
    assert.match(output, /TRANSPORT_STREAMING_OK/);
    assert.equal(requests.length, 2);
    for (const request of requests) {
        assert.equal(request.url, '/v1/chat/completions');
        assert.equal(request.headers.authorization, `Bearer ${quotedKey}`);
        assert.equal(request.body.messages[0].role, 'system');
        assert.equal(request.body.messages[0].content, prompt);
    }
    assert.deepEqual(requests[0].body.messages.slice(1), [{ role: 'user', content: 'first' }]);
    assert.deepEqual(requests[1].body.messages.slice(1), [
        { role: 'user', content: 'first' }, { role: 'assistant', content: 'part A + B' },
        { role: 'user', content: 'second' },
    ]);
});

test('cancelling a streaming request does not interfere with the next request', async t => {
    const fixture = fixtureDirectory();
    t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
    const requests = [];
    const server = streamingServer(requests, 1000, path.join(fixture, 'request-started'));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const port = await listen(server);
    const output = await runService(fixture, `http://127.0.0.1:${port}`, '', process.env.PATH, 'in-flight');
    assert.match(output, /TRANSPORT_STREAMING_OK/);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].body.messages[0].content, prompt);
    assert.deepEqual(requests[1].body.messages.slice(1), [{ role: 'user', content: 'second' }]);
});

test('cancelling before process startup leaves the next request intact', async t => {
    const fixture = fixtureDirectory();
    t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
    const requests = [];
    const server = streamingServer(requests);
    t.after(() => { server.closeAllConnections(); server.close(); });
    const port = await listen(server);
    const output = await runService(fixture, `http://127.0.0.1:${port}`, '', process.env.PATH, 'immediate');
    assert.match(output, /TRANSPORT_STREAMING_OK/);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.messages[0].content, prompt);
    assert.deepEqual(requests[0].body.messages.slice(1), [{ role: 'user', content: 'second' }]);
});

test('HTTP errors still appear as request errors', async t => {
    const fixture = fixtureDirectory();
    t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
    const server = http.createServer((req, res) => {
        req.resume();
        req.on('end', () => {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end('{"error":"unauthorized"}');
        });
    });
    t.after(() => { server.closeAllConnections(); server.close(); });
    const port = await listen(server);
    const output = await runService(fixture, `http://127.0.0.1:${port}`,
                                    'Request failed (HTTP 401): {"error":"unauthorized"}', process.env.PATH);
    assert.match(output, /TRANSPORT_ERROR_OK/);
});

test('startup failures end the request without exposing credentials', async t => {
    for (const scenario of [
        { shell: false, error: 'Unable to start request process.' },
        { shell: true, error: 'Request failed (exit 127)' },
    ]) {
        const fixture = fixtureDirectory();
        t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
        const bin = path.join(fixture, 'bin');
        fs.symlinkSync(executable('mkdir'), path.join(bin, 'mkdir'));
        if (scenario.shell)
            fs.symlinkSync(executable('sh'), path.join(bin, 'sh'));
        const output = await runService(fixture, 'http://127.0.0.1:9', scenario.error, bin);
        assert.match(output, /TRANSPORT_ERROR_OK/);
        assert.ok(!output.includes(apiKey), 'startup failure logged the API key');
        assert.ok(!output.includes(promptMarker), 'startup failure logged the prompt');
    }
});
