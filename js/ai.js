/*
 * ai.js — 対局相手＆解析用の思考ルーチン
 *
 * αβ法 + 静止探索 + 反復深化。Web Worker を使わず（file:// で開けるように）
 * 制限時間つきで探索するので UI が長く固まることはない。
 */
;(function (root, factory) {
  var api = factory(typeof require === 'function' ? require('./engine.js') : root.Shogi);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ShogiAI = api;
})(typeof window !== 'undefined' ? window : globalThis, function (S) {
  'use strict';

  var MATE = 100000;

  // 難易度設定
  var LEVELS = [
    { key: 'beginner', label: '入門',  depth: 1, ms: 120,  noise: 260 },
    { key: 'easy',     label: '初級',  depth: 2, ms: 350,  noise: 110 },
    { key: 'normal',   label: '中級',  depth: 4, ms: 1200, noise: 35 },
    { key: 'hard',     label: '上級',  depth: 6, ms: 2500, noise: 0 }
  ];

  // ------------------------------------------------------------ 簡易定跡
  // 「先手から見た」自然な序盤の手。後手番のときは点対称に読み替える。
  // 序盤をそれらしく指させるためのもので、強さのためではない。
  var BOOK = [
    ['7七', '7六', 10], ['2七', '2六', 10], ['2六', '2五', 5],
    ['7九', '6八', 6], ['6九', '7八', 6], ['5九', '6八', 6],
    ['6八', '7八', 5], ['7八', '8八', 4], ['4九', '5八', 5],
    ['3九', '3八', 5], ['8八', '7七', 4],
    ['6七', '6六', 4], ['5七', '5六', 4], ['4七', '4六', 3],
    ['3七', '3六', 3], ['1七', '1六', 2], ['9七', '9六', 2]
  ];

  function mirror(sq) { return 80 - sq; }   // 先手座標 → 後手座標

  /** 駒がぶつかっている局面かどうか。ここでは定跡ではなく探索に任せる。 */
  function tactical(pos, legal) {
    var i, sq;
    for (i = 0; i < legal.length; i++) {
      var victim = pos.board[S.mvTo(legal[i])];
      if (victim !== S.EMPTY && S.valueOf(victim) >= 300) return true;   // 大きな駒が取れる
    }
    for (sq = 0; sq < 81; sq++) {
      var p = pos.board[sq];
      if (p === S.EMPTY || S.ownerOf(p) !== pos.turn) continue;
      if (S.valueOf(p) < 300) continue;
      if (S.hangingLoss(pos, sq) >= 300) return true;                     // 大きな駒が取られそう
    }
    return false;
  }

  function bookMove(pos) {
    if (pos.ply >= 14) return null;
    if (S.inCheck(pos, pos.turn)) return null;
    var legal = S.legalMoves(pos);
    if (tactical(pos, legal)) return null;
    var pool = [];
    for (var i = 0; i < BOOK.length; i++) {
      var from = S.parseSqName(BOOK[i][0]), to = S.parseSqName(BOOK[i][1]);
      if (pos.turn === S.GOTE) { from = mirror(from); to = mirror(to); }
      for (var j = 0; j < legal.length; j++) {
        var m = legal[j];
        if (S.mvIsDrop(m) || S.mvFrom(m) !== from || S.mvTo(m) !== to || S.mvProm(m)) continue;
        // 指した結果タダで取られる手は採用しない
        var u = S.doMove(pos, m);
        var loss = S.hangingLoss(pos, to);
        S.undoMove(pos, u);
        if (loss > 0) continue;
        for (var w = 0; w < BOOK[i][2]; w++) pool.push(m);
      }
    }
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // ---------------------------------------------------------- 駒の働き
  // 位置による加点。前に出た駒ほど少し高く評価する。
  var PST = (function () {
    var t = [];
    for (var owner = 0; owner < 2; owner++) {
      t[owner] = [[], []];
      for (var prom = 0; prom < 2; prom++) {
        for (var type = 0; type < 8; type++) {
          var arr = new Int16Array(81);
          for (var sq = 0; sq < 81; sq++) {
            var row = S.rowOf(sq), col = S.colOf(sq);
            // 自陣からどれだけ前進しているか（0〜8）
            var adv = (owner === S.SENTE) ? (8 - row) : row;
            var centerness = 4 - Math.abs(col - 4);
            var v = 0;
            if (type === S.P && !prom) v = adv * 6;
            else if (type === S.L && !prom) v = adv * 3;
            else if (type === S.N && !prom) v = adv * 4;
            else if (type === S.S) v = adv * 5 + centerness * 2;
            else if (type === S.G) v = adv * 4 + centerness * 2;
            else if (type === S.B) v = centerness * 4 + adv * 2;
            else if (type === S.R) v = adv * 3;
            else if (type === S.K) v = -adv * 12 - centerness * 6;  // 玉は自陣の端が安全
            if (prom && type !== S.K) v += 10;
            arr[sq] = v;
          }
          t[owner][prom][type] = arr;
        }
      }
    }
    return t;
  })();

  var ADJ = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

  /** 先手から見た評価値 */
  function evaluate(pos) {
    var score = 0, sq, p, o;
    for (sq = 0; sq < 81; sq++) {
      p = pos.board[sq];
      if (p === S.EMPTY) continue;
      o = S.ownerOf(p);
      var v = S.valueOf(p) + PST[o][S.isProm(p)][S.typeOf(p)][sq];
      score += (o === S.SENTE) ? v : -v;
    }
    // 持ち駒はいつでも使えるので少し割り増し
    for (o = 0; o < 2; o++) {
      for (var i = 0; i < S.HAND_ORDER.length; i++) {
        var t = S.HAND_ORDER[i], n = pos.hands[o * 8 + t];
        if (!n) continue;
        var hv = n * (S.VALUE[t] + 30);
        score += (o === S.SENTE) ? hv : -hv;
      }
    }
    // 囲い（玉の周りに味方の駒があるか）
    for (o = 0; o < 2; o++) {
      var ksq = pos.kings[o];
      if (ksq < 0) continue;
      var r = S.rowOf(ksq), c = S.colOf(ksq), guards = 0;
      for (var a = 0; a < 8; a++) {
        var rr = r + ADJ[a][0], cc = c + ADJ[a][1];
        if (rr < 0 || rr > 8 || cc < 0 || cc > 8) continue;
        var q = pos.board[rr * 9 + cc];
        if (q !== S.EMPTY && S.ownerOf(q) === o) guards++;
      }
      var kv = guards * 32;
      if (S.isAttacked(pos.board, ksq, 1 - o)) kv -= 180;
      score += (o === S.SENTE) ? kv : -kv;
    }
    return score;
  }

  // ------------------------------------------------------------ 手の並べ替え
  function scoreMove(pos, m) {
    var s = 0;
    var to = S.mvTo(m);
    var victim = pos.board[to];
    if (victim !== S.EMPTY) {
      var attacker = S.mvIsDrop(m) ? 0 : S.valueOf(pos.board[S.mvFrom(m)]);
      s += 10000 + S.valueOf(victim) * 8 - attacker;   // 安い駒で高い駒を取る手を先に
    }
    if (S.mvProm(m)) s += 3000;
    if (S.mvIsDrop(m)) s -= 60;
    return s;
  }

  function orderMoves(pos, moves, pvMove) {
    var scored = moves.map(function (m) {
      return { m: m, s: (m === pvMove ? 1e9 : scoreMove(pos, m)) };
    });
    scored.sort(function (a, b) { return b.s - a.s; });
    return scored.map(function (x) { return x.m; });
  }

  // ---------------------------------------------------------------- 探索
  function Searcher(deadline) {
    this.nodes = 0;
    this.deadline = deadline;
    this.aborted = false;
  }

  Searcher.prototype.timeUp = function () {
    if (this.aborted) return true;
    if ((this.nodes & 1023) === 0 && Date.now() > this.deadline) this.aborted = true;
    return this.aborted;
  };

  /** 駒の取り合いが落ち着くまで読む（大駒をタダで取られる読み抜けを防ぐ） */
  Searcher.prototype.quiesce = function (pos, alpha, beta, ply) {
    this.nodes++;
    if (this.timeUp()) return 0;
    var sign = (pos.turn === S.SENTE) ? 1 : -1;
    var stand = evaluate(pos) * sign;
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (ply > 6) return stand;

    var moves = S.legalMoves(pos), i;
    var caps = [];
    for (i = 0; i < moves.length; i++) {
      var m = moves[i];
      if (pos.board[S.mvTo(m)] !== S.EMPTY) caps.push(m);
    }
    caps = orderMoves(pos, caps, -1);
    for (i = 0; i < caps.length; i++) {
      var u = S.doMove(pos, caps[i]);
      var sc = -this.quiesce(pos, -beta, -alpha, ply + 1);
      S.undoMove(pos, u);
      if (this.aborted) return 0;
      if (sc >= beta) return sc;
      if (sc > alpha) alpha = sc;
    }
    return alpha;
  };

  Searcher.prototype.search = function (pos, depth, alpha, beta, ply) {
    this.nodes++;
    if (this.timeUp()) return 0;
    if (depth <= 0) return this.quiesce(pos, alpha, beta, ply);

    var moves = S.legalMoves(pos);
    if (moves.length === 0) return -MATE + ply;          // 詰まされた
    moves = orderMoves(pos, moves, -1);

    var best = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var u = S.doMove(pos, moves[i]);
      var sc = -this.search(pos, depth - 1, -beta, -alpha, ply + 1);
      S.undoMove(pos, u);
      if (this.aborted) return 0;
      if (sc > best) best = sc;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  };

  /**
   * 手番側の最善手を選ぶ。
   * 返り値: { move, score, depth, nodes, mate }  （手がなければ move=null）
   */
  function think(pos, opts) {
    opts = opts || {};
    var level = LEVELS[opts.level === undefined ? 2 : opts.level] || LEVELS[2];
    var maxDepth = opts.depth || level.depth;
    var budget = opts.ms || level.ms;
    var noise = (opts.noise === undefined) ? level.noise : opts.noise;

    var moves = S.legalMoves(pos);
    if (moves.length === 0) return { move: null, score: -MATE, depth: 0, nodes: 0, mate: true };
    if (moves.length === 1) return { move: moves[0], score: 0, depth: 0, nodes: 0, mate: false };

    // まず詰みを探す（1手・3手）
    var mateMove = S.findMate(pos, 1) || (maxDepth >= 3 ? S.findMate(pos, 3) : null);
    if (mateMove) return { move: mateMove, score: MATE, depth: 3, nodes: 0, mate: true };

    // 序盤は定跡から選ぶ（毎回同じ将棋にならないよう確率的に）
    if (opts.useBook !== false && Math.random() < 0.75) {
      var bm = bookMove(pos);
      if (bm) return { move: bm, score: 0, depth: 0, nodes: 0, mate: false, book: true };
    }

    var deadline = Date.now() + budget;
    var searcher = new Searcher(deadline);
    var bestMove = moves[0], bestScore = 0, reached = 0;

    for (var d = 1; d <= maxDepth; d++) {
      var results = [];
      var alpha = -Infinity;
      var ordered = orderMoves(pos, moves, bestMove);
      var stop = false;
      for (var i = 0; i < ordered.length; i++) {
        var u = S.doMove(pos, ordered[i]);
        var sc = -searcher.search(pos, d - 1, -Infinity, -alpha, 1);
        S.undoMove(pos, u);
        if (searcher.aborted) { stop = true; break; }
        results.push({ m: ordered[i], s: sc });
        if (sc > alpha) alpha = sc;
      }
      if (stop || results.length === 0) break;
      results.sort(function (a, b) { return b.s - a.s; });
      reached = d;
      // 弱いレベルでは最善手ぴったりではなく、少し幅を持たせて選ぶ
      if (noise > 0) {
        var top = results[0].s;
        var cands = results.filter(function (r) { return r.s >= top - noise; });
        var pick = cands[Math.floor(Math.random() * cands.length)];
        bestMove = pick.m; bestScore = pick.s;
      } else {
        bestMove = results[0].m; bestScore = results[0].s;
      }
      if (Math.abs(bestScore) > MATE - 100) break;
      if (Date.now() > deadline) break;
    }

    return {
      move: bestMove,
      score: (pos.turn === S.SENTE) ? bestScore : -bestScore,  // 先手視点に揃える
      depth: reached,
      nodes: searcher.nodes,
      mate: Math.abs(bestScore) > MATE - 100
    };
  }

  /** 局面の静的な形勢（先手視点、歩1枚=100） */
  function quickEval(pos) { return evaluate(pos); }

  /**
   * 「この手を指すとどうなるか」を浅く読む。先手視点の評価値を返す。
   */
  function evalAfter(pos, move, ms) {
    var u = S.doMove(pos, move);
    var searcher = new Searcher(Date.now() + (ms || 200));
    // search は「手番側から見た値」を返すので、指した側の視点に反転する
    var sc = -searcher.search(pos, 2, -Infinity, Infinity, 0);
    var senteScore = (u.mover === S.SENTE) ? sc : -sc;
    S.undoMove(pos, u);
    return senteScore;
  }

  return {
    LEVELS: LEVELS, MATE: MATE,
    evaluate: quickEval, think: think, evalAfter: evalAfter, bookMove: bookMove
  };
});
