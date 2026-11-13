const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const context = { Qt: { btoa: value => Buffer.from(value, 'utf8').toString('base64') } };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'markdown2html.js'), 'utf8')
    .replace(/^\.pragma library\s*/, ''), context);

test('ordered list continuation after code does not consume a list number', () => {
    const html = context.markdownToHtml('1. before\n\n   ```js\n   hi\n   ```\n\n   after\n2. next');
    assert.match(html, /<ol start="1"[^>]*>[\s\S]*?before[\s\S]*?<\/ol>/);
    assert.match(html, /<\/table>\s*<p>after<\/p>\s*<ol start="2"[^>]*>\s*<li><p>next<\/p>/);
    assert.doesNotMatch(html, /<ol start="3"/);
});

test('code fence language is rendered as text rather than HTML', () => {
    const html = context.markdownToHtml('```<b>oops</b>&\nx\n```');
    assert.match(html, /&lt;b&gt;oops&lt;\/b&gt;&amp;/);
    assert.doesNotMatch(html, /<b>oops<\/b>/);
});
