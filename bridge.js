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
const { spawn } = require('child_process');

const PORT = Number(process.env.SHOGI_PORT || 8765);
const ROOT = __dirname;
const OUT_PATH = path.join(ROOT, 'current-position.txt');
const MOVE_PATH = path.join(ROOT, 'com-move.txt');
const MAX_BODY = 64 * 1024;          // 局面テキストは数KBなので十分

/*
 * 相手（COM）側の指し手を受け取る仕組み。
 * 外部のAI（Claude Code / Cursor / ChatGPT など）は次のどちらでも指せる：
 *   1. com-move.txt に指し手を1行書く   ← ファイルが触れるツール向け
 *   2. POST /move に指し手を送る        ← HTTPが叩けるツール向け
 * アプリは GET /move?since=N で新しい手が来ていないか見に行く。
 */
let moveState = { seq: 0, move: '', at: null, source: '', sfen: null };
let fileStamp = null;

function stampOf(target) {
  try { const st = fs.statSync(target); return st.mtimeMs + ':' + st.size; }
  catch (e) { return null; }
}

/**
 * 指し手を受け取る。
 * forSfen を渡すと「その局面のための手」として記録し、別の局面を持つアプリには
 * 渡さない。ブラウザのタブが複数開いていても、手が混ざらないようにするため。
 */
function submitMove(text, source, forSfen) {
  const lines = String(text).split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (!lines.length) return false;
  moveState = {
    seq: moveState.seq + 1, move: lines[0], at: timestamp(),
    source: source, sfen: forSfen || null
  };
  console.log('  指し手を受け取り  ' + lines[0] + '   (' + source + ')');
  return true;
}

/** com-move.txt が書き換わっていたら取り込む */
function pickUpMoveFile() {
  const st = stampOf(MOVE_PATH);
  if (st === null || st === fileStamp) return;
  fileStamp = st;
  try { submitMove(fs.readFileSync(MOVE_PATH, 'utf8'), 'com-move.txt'); } catch (e) {}
}

/*
 * ---------------------------------------------------------------- USIエンジン
 * やねうら王などの将棋ソフト（USI規格）を相手役として動かす。
 *   SHOGI_USI_ENGINE   エンジンの実行ファイル（未指定なら候補から自動で探す）
 *   SHOGI_USI_BYOYOMI  1手の思考時間ミリ秒（既定 1000）
 *   SHOGI_USI_DEPTH    読みの深さ上限。0で無制限（既定 0）。小さくすると弱くなる
 *   SHOGI_USI_THREADS  思考に使うスレッド数（既定 1）
 */
const ENGINE_CANDIDATES = [
  process.env.SHOGI_USI_ENGINE,
  path.join(ROOT, 'engine', 'yaneuraou'),
  path.join(ROOT, '..', 'YaneuraOu', 'bin', 'yaneuraou-nnue'),
  path.join(ROOT, '..', 'YaneuraOu', 'bin', 'yaneuraou-material')
].filter(Boolean);

const ENGINE_BYOYOMI = Number(process.env.SHOGI_USI_BYOYOMI || 1000);
const ENGINE_DEPTH = Number(process.env.SHOGI_USI_DEPTH || 0);
const ENGINE_THREADS = Number(process.env.SHOGI_USI_THREADS || 1);
// 評価関数ごとに推奨値がある。Háo は 20（エンジン既定は 16）
const ENGINE_FV_SCALE = Number(process.env.SHOGI_USI_FV_SCALE || 20);
// 講評・ヒント用の解析。対局相手より強く読ませたいので別枠にしている
const ANALYZE_MS = Number(process.env.SHOGI_USI_ANALYZE_MS || 700);
const ENGINE_HASH = Number(process.env.SHOGI_USI_HASH || 256);

/** USIエンジンと1行ずつやりとりする最小のクライアント */
class UsiEngine {
  constructor(cmdPath) {
    this.cmdPath = cmdPath;
    this.proc = null;
    this.buf = '';
    this.waiters = [];
    this.queue = Promise.resolve();   // 探索は1つずつ順番に
    this.ready = false;
    this.name = path.basename(cmdPath);
    this.options = [];              // エンジンが持つオプション名
  }

  send(line) {
    if (this.proc && this.proc.stdin.writable) this.proc.stdin.write(line + '\n');
  }

  /** test(line) が真を返す行が来るまで待つ */
  waitFor(test, timeoutMs) {
    return new Promise((resolve, reject) => {
      const w = { test: test, resolve: resolve };
      w.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        reject(new Error('エンジンの応答がありません（' + timeoutMs + 'ms）'));
      }, timeoutMs);
      this.waiters.push(w);
    });
  }

  hasOption(name) { return this.options.indexOf(name) >= 0; }

  handleLine(line) {
    if (/^id name /.test(line)) this.name = line.slice(8).trim();
    const om = /^option name (\S+)/.exec(line);
    if (om) this.options.push(om[1]);
    for (const w of this.waiters.slice()) {
      let hit = null;
      try { hit = w.test(line); } catch (e) { hit = null; }
      if (hit) {
        clearTimeout(w.timer);
        this.waiters = this.waiters.filter((x) => x !== w);
        w.resolve(hit === true ? line : hit);
      }
    }
  }

  async start() {
    this.proc = spawn(this.cmdPath, [], { cwd: path.dirname(this.cmdPath) });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => {
      this.buf += chunk;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).replace(/\r$/, '');
        this.buf = this.buf.slice(i + 1);
        this.handleLine(line);
      }
    });
    this.proc.on('error', (e) => console.error('  エンジン起動失敗: ' + e.message));
    this.proc.on('exit', (code) => {
      this.ready = false;
      console.error('  エンジンが終了しました (code ' + code + ')');
    });

    this.send('usi');
    await this.waitFor((l) => l.trim() === 'usiok', 20000);
    this.send('setoption name Threads value ' + ENGINE_THREADS);
    if (this.hasOption('USI_Hash')) this.send('setoption name USI_Hash value ' + ENGINE_HASH);
    if (this.hasOption('FV_SCALE')) {
      this.send('setoption name FV_SCALE value ' + ENGINE_FV_SCALE);
    }
    this.send('isready');
    await this.waitFor((l) => l.trim() === 'readyok', 120000);
    this.send('usinewgame');
    this.ready = true;
    return this.name;
  }

  /** 探索のたびに深さ上限とMultiPVを設定し直す */
  setLimits(depth, multipv) {
    if (this.hasOption('DepthLimit')) {
      this.send('setoption name DepthLimit value ' + (depth > 0 ? depth : 0));
    }
    if (this.hasOption('MultiPV')) {
      this.send('setoption name MultiPV value ' + (multipv || 1));
    }
  }

  /** SFENの局面から最善手をもらう。投了・勝ち宣言なら null */
  bestMove(sfen) {
    const run = async () => {
      if (!this.ready) throw new Error('エンジンが準備できていません');
      this.setLimits(ENGINE_DEPTH, 1);      // 対局は弱めの設定で
      this.send('position sfen ' + sfen);
      this.send('go byoyomi ' + ENGINE_BYOYOMI);
      const line = await this.waitFor((l) => (/^bestmove /.test(l) ? l : null),
        ENGINE_BYOYOMI + 60000);
      const mv = line.trim().split(/\s+/)[1];
      return (mv && mv !== 'resign' && mv !== 'win') ? mv : null;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  /**
   * 局面を解析する。講評・ヒント・形勢表示に使う。
   * 対局用の深さ上限は外して、じっくり読ませる。
   * 返り値: { bestmove, candidates:[{ move, score, mate, pv, depth }], depth }
   *   score は「手番側から見た」点数（centipawn）。mate は手数（正なら手番側の勝ち）
   */
  analyze(sfen, opts) {
    opts = opts || {};
    const ms = Number(opts.ms || ANALYZE_MS);
    const multipv = Math.max(1, Math.min(8, Number(opts.multipv || 1)));
    const run = async () => {
      if (!this.ready) throw new Error('エンジンが準備できていません');
      this.setLimits(0, multipv);           // 解析は深さ無制限
      const found = {};                     // multipv番号 → 情報
      let maxDepth = 0;
      const collect = (line) => {
        if (!/^info /.test(line) || !/ pv /.test(line)) return null;
        const d = /\bdepth (\d+)/.exec(line);
        const k = /\bmultipv (\d+)/.exec(line);
        const cp = /\bscore cp (-?\d+)/.exec(line);
        const mate = /\bscore mate ([+-]?\d+)/.exec(line);
        const pv = /\bpv (.+)$/.exec(line);
        if (!pv) return null;
        const idx = k ? Number(k[1]) : 1;
        if (d) maxDepth = Math.max(maxDepth, Number(d[1]));
        found[idx] = {
          move: pv[1].trim().split(/\s+/)[0],
          score: cp ? Number(cp[1]) : null,
          mate: mate ? Number(mate[1]) : null,
          pv: pv[1].trim().split(/\s+/).slice(0, 8),
          depth: d ? Number(d[1]) : 0
        };
        return null;                        // 待たずに集め続ける
      };
      this.waiters.push({ test: collect, timer: setTimeout(() => {}, 0) });
      this.send('position sfen ' + sfen);
      this.send('go byoyomi ' + ms);
      const line = await this.waitFor((l) => (/^bestmove /.test(l) ? l : null), ms + 60000);
      this.waiters = this.waiters.filter((w) => w.test !== collect);
      const bm = line.trim().split(/\s+/)[1];
      const candidates = Object.keys(found)
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => found[k]);
      return {
        bestmove: (bm && bm !== 'resign' && bm !== 'win') ? bm : null,
        candidates: candidates,
        depth: maxDepth
      };
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  quit() {
    if (!this.proc) return;
    try { this.send('quit'); } catch (e) {}
    setTimeout(() => { try { this.proc.kill(); } catch (e) {} }, 300).unref();
  }
}

let engine = null;

function findEngine() {
  for (const c of ENGINE_CANDIDATES) {
    try { if (fs.statSync(c).isFile()) return c; } catch (e) {}
  }
  return null;
}

/** 局面テキストがCOMの手番を示していれば、エンジンに指させる */
function maybeEngineMove(text) {
  if (!engine || !engine.ready) return;
  if (!/^★ あなた（COM側/m.test(text)) return;
  const m = /^SFEN: (.+)$/m.exec(text);
  if (!m) return;
  const sfen = m[1].trim();
  engine.bestMove(sfen).then((mv) => {
    if (!mv) { console.log('  エンジンは投了を選びました'); return; }
    submitMove(mv, engine.name, sfen);
  }).catch((e) => console.error('  エンジンの思考に失敗: ' + e.message));
}

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

function sendJson(res, code, obj) {
  const raw = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': raw.length
  });
  res.end(raw);
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
    // 相手の思考設定も返す。アプリはこれを見て、
    // ヒントの解析時間を「相手より長く」に合わせる
    sendJson(res, 200, {
      ok: true,
      engine: engine && engine.ready ? {
        name: engine.name,
        byoyomi: ENGINE_BYOYOMI,
        depth: ENGINE_DEPTH,
        analyzeMs: ANALYZE_MS
      } : null
    });
    return;
  }

  // アプリが「新しい指し手が来ていないか」を見に来る
  if (req.method === 'GET' && route === '/move') {
    pickUpMoveFile();
    const qs = req.url.split('?')[1] || '';
    const m = /(?:^|&)since=(\d+)/.exec(qs);
    const since = m ? Number(m[1]) : 0;
    const sm = /(?:^|&)sfen=([^&]*)/.exec(qs);
    let wantSfen = null;
    if (sm) { try { wantSfen = decodeURIComponent(sm[1]); } catch (e) {} }

    // 局面が一致しない手は「まだ無い」として扱う（別のタブ用の手を渡さない）
    const matches = !moveState.sfen || !wantSfen || moveState.sfen === wantSfen;
    const fresh = moveState.seq > since && matches;
    const body = JSON.stringify({
      seq: fresh ? moveState.seq : since,
      move: fresh ? moveState.move : null,
      at: fresh ? moveState.at : null,
      source: fresh ? moveState.source : null
    });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body);
    return;
  }

  // 講評・ヒント・形勢のための局面解析
  if (req.method === 'POST' && route === '/analyze') {
    readBody(req, MAX_BODY).then((body) => {
      if (!engine || !engine.ready) { sendJson(res, 503, { error: 'エンジンがありません' }); return; }
      let q;
      try { q = JSON.parse(body); } catch (e) { sendJson(res, 400, { error: 'JSONではありません' }); return; }
      if (!q || typeof q.sfen !== 'string' || !q.sfen.trim()) {
        sendJson(res, 400, { error: 'sfen がありません' }); return;
      }
      engine.analyze(q.sfen.trim(), { ms: q.ms, multipv: q.multipv })
        .then((r) => sendJson(res, 200, r))
        .catch((e) => sendJson(res, 500, { error: e.message }));
    }).catch((e) => {
      if (!res.headersSent) sendJson(res, e && e.tooLarge ? 413 : 400, { error: 'bad body' });
    });
    return;
  }

  // 外部AIが指し手を送ってくる
  if (req.method === 'POST' && route === '/move') {
    readBody(req, MAX_BODY).then((text) => {
      if (submitMove(text, 'POST /move')) {
        fileStamp = stampOf(MOVE_PATH);   // ファイル側と二重に拾わないようにする
        sendText(res, 200, 'ok');
      } else {
        sendText(res, 400, 'empty');
      }
    }).catch((e) => {
      if (res.headersSent) return;
      sendText(res, e && e.tooLarge ? 413 : 400, 'bad body');
    });
    return;
  }

  if (req.method === 'POST') {
    if (route !== '/position') { sendText(res, 404, 'not found'); return; }
    readBody(req, MAX_BODY).then((text) => {
      if (!text) { sendText(res, 400, 'empty'); return; }
      try {
        savePosition(text);
        sendText(res, 200, 'ok');
        maybeEngineMove(text);
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
  fileStamp = stampOf(MOVE_PATH);   // 起動前に残っていた手は指さない

  const enginePath = findEngine();
  if (enginePath) {
    engine = new UsiEngine(enginePath);
    engine.start().then(function (name) {
      console.log('思考エンジン                →  ' + name);
      console.log('                               ' + enginePath);
      console.log('                               1手 ' + ENGINE_BYOYOMI + 'ms' +
        (ENGINE_DEPTH > 0 ? ' / 深さ上限 ' + ENGINE_DEPTH : ' / 深さ無制限') +
        ' / ' + ENGINE_THREADS + 'スレッド' +
        (engine.hasOption('FV_SCALE') ? ' / FV_SCALE ' + ENGINE_FV_SCALE : ''));
    }).catch(function (e) {
      console.error('思考エンジンを使えません: ' + e.message);
      engine = null;
    });
  } else {
    console.log('思考エンジン                →  なし（手入力またはチャット経由で指してください）');
  }

  console.log('将棋アプリを開いてください  →  http://localhost:' + PORT + '/');
  console.log('局面の書き出し先            →  ' + OUT_PATH);
  console.log('相手の指し手の受け口        →  com-move.txt  /  POST /move');
  console.log('局面の解析（講評・ヒント）  →  POST /analyze');
  console.log('止めるときは Ctrl-C');
});

process.on('SIGINT', () => {
  console.log('\n終了しました。');
  if (engine) engine.quit();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
});
