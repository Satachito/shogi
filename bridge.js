#!/usr/bin/env node
/*
 * bridge.js — 将棋アプリとチャットをつなぐ小さなサーバー
 *
 *     node bridge.js
 *
 * を実行して http://localhost:8765/ を開くと、1手指すたびにアプリが今の局面を
 * 送ってきて、このフォルダの current-position.txt に書き出します。
 * チャット相手（Claude）はそのファイルを読むだけで今の盤面が分かるので、
 * 毎回コピー＆ペーストしなくても「この局面どう？」と聞けます。
 *
 * - 待ち受けるのは 127.0.0.1（この端末の中）だけ。外からはつながりません。
 * - 書き込むのは current-position.txt の1ファイルだけです。
 * - 止めるときは Ctrl-C。
 *
 * Node.js だけで動きます（追加インストール不要）。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.SHOGI_PORT || 8765);
const ROOT = __dirname;
const OUT_PATH = path.join(ROOT, 'current-position.txt');
const MAX_BODY = 64 * 1024;          // 局面テキストは数KBなので十分

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

// file:// から開いた場合でも通信できるようにしておく
function setCommonHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
}

function sendText(res, code, body) {
  const raw = Buffer.from(body, 'utf8');
  res.writeHead(code, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': raw.length
  });
  res.end(raw);
}

/**
 * 上限つきでリクエスト本文を読む。
 * 上限を超えたら以降はためずに読み捨て、最後にエラーとして返す
 * （接続を切ってしまうと、送った側がエラー内容を受け取れないため）。
 */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let over = false;
    const chunks = [];
    req.on('data', (chunk) => {
      if (over) return;
      size += chunk.length;
      if (size > limit) { over = true; chunks.length = 0; return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (over) {
        const e = new Error('too large');
        e.tooLarge = true;
        reject(e);
      } else {
        resolve(Buffer.concat(chunks).toString('utf8'));
      }
    });
    req.on('error', reject);
  });
}

/** 2026-07-29 08:58:07 の形にそろえる */
function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

/** このフォルダの中のファイルだけを返す */
function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch (e) {
    sendText(res, 400, 'bad request');
    return;
  }
  if (urlPath.endsWith('/')) urlPath += 'index.html';

  const filePath = path.join(ROOT, path.normalize(urlPath));
  // フォルダの外に出ようとしていないか確認する
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    sendText(res, 403, 'forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err) { sendText(res, 404, 'not found'); return; }
    const target = stat.isDirectory() ? path.join(filePath, 'index.html') : filePath;
    fs.readFile(target, (err2, data) => {
      if (err2) { sendText(res, 404, 'not found'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
        'Content-Length': data.length
      });
      res.end(data);
    });
  });
}

function savePosition(text) {
  const stamp = timestamp();
  fs.writeFileSync(OUT_PATH, text.replace(/\n+$/, '') + '\n更新: ' + stamp + '\n', 'utf8');
  const lines = text.split('\n');
  console.log('  局面を更新  ' + stamp + '  ' + (lines[1] || ''));
}

const server = http.createServer((req, res) => {
  setCommonHeaders(res);
  const route = req.url.split('?')[0];

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && route === '/bridge-ping') {
    sendText(res, 200, 'ok');
    return;
  }

  if (req.method === 'POST') {
    if (route !== '/position') { sendText(res, 404, 'not found'); return; }
    readBody(req, MAX_BODY).then((text) => {
      if (!text) { sendText(res, 400, 'empty'); return; }
      try {
        savePosition(text);
        sendText(res, 200, 'ok');
      } catch (e) {
        console.error('  書き込みに失敗しました: ' + e.message);
        sendText(res, 500, 'write failed');
      }
    }).catch((e) => {
      if (res.headersSent) return;
      sendText(res, e && e.tooLarge ? 413 : 400,
        e && e.tooLarge ? 'too large' : 'bad body');
    });
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res);
    return;
  }

  sendText(res, 405, 'method not allowed');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('ポート ' + PORT + ' はすでに使われています。');
    console.error('別のポートを使うには:  SHOGI_PORT=8766 node bridge.js');
  } else {
    console.error(e.message);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('将棋アプリを開いてください  →  http://localhost:' + PORT + '/');
  console.log('局面の書き出し先            →  ' + OUT_PATH);
  console.log('止めるときは Ctrl-C');
});

process.on('SIGINT', () => {
  console.log('\n終了しました。');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
});
