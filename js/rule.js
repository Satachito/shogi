/*
 * rule.js — 将棋のルールエンジン
 *
 * 盤面は 81 マスの Int8Array。index = row * 9 + col
 *   row 0 = 一段目（上＝後手陣）, row 8 = 九段目（下＝先手陣）
 *   col 0 = 9筋（左端）,          col 8 = 1筋（右端）
 * これは SFEN の並び順とまったく同じなので、相互変換が素直に書ける。
 *
 * 駒のエンコード: (owner << 4) | (promoted << 3) | type   … 空きマスは -1
 */
;(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.Shogi = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // ---------------------------------------------------------------- 定数
  var SENTE = 0, GOTE = 1;
  var EMPTY = -1;

  // 駒の種類（数値）
  var K = 0, R = 1, B = 2, G = 3, S = 4, N = 5, L = 6, P = 7;

  var SFEN_CHARS = ['k', 'r', 'b', 'g', 's', 'n', 'l', 'p'];
  // 盤上の表示（1文字）
  var GLYPH      = ['玉', '飛', '角', '金', '銀', '桂', '香', '歩'];
  var GLYPH_PROM = ['玉', '龍', '馬', '金', '全', '圭', '杏', 'と'];
  // 棋譜・説明用の正式名
  var NAME       = ['玉', '飛車', '角行', '金', '銀', '桂馬', '香車', '歩'];
  var NAME_PROM  = ['玉', '龍', '馬', '金', '成銀', '成桂', '成香', 'と金'];
  // 駒台に並べる順（強い順）
  var HAND_ORDER = [R, B, G, S, N, L, P];

  // 駒の価値（歩=100 換算）
  var VALUE      = [15000, 1040, 950, 690, 640, 450, 430, 100];
  var VALUE_PROM = [15000, 1300, 1150, 690, 670, 640, 640, 600];

  var CAN_PROMOTE = [false, true, true, false, true, true, true, true];

  var RANK_KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

  var ALL8 = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  var ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  var DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

  // STEPS[owner][promoted][type] = 1マスだけ動ける方向
  // SLIDES[owner][promoted][type] = 何マスでも走れる方向
  var STEPS = [], SLIDES = [];
  (function buildTables() {
    for (var o = 0; o < 2; o++) {
      STEPS[o] = [[], []];
      SLIDES[o] = [[], []];
      var d = (o === SENTE) ? -1 : 1;               // 前進方向
      var gold = [[d, 0], [d, -1], [d, 1], [0, -1], [0, 1], [-d, 0]];
      for (var pr = 0; pr < 2; pr++) {
        for (var t = 0; t < 8; t++) {
          var st = [], sl = [];
          if (pr) {
            if (t === R) { st = DIAG; sl = ORTH; }        // 龍
            else if (t === B) { st = ORTH; sl = DIAG; }   // 馬
            else if (t === K) { st = ALL8; }
            else { st = gold; }                           // と金・成香・成桂・成銀
          } else {
            if (t === K) st = ALL8;
            else if (t === R) sl = ORTH;
            else if (t === B) sl = DIAG;
            else if (t === G) st = gold;
            else if (t === S) st = [[d, 0], [d, -1], [d, 1], [-d, -1], [-d, 1]];
            else if (t === N) st = [[2 * d, -1], [2 * d, 1]];
            else if (t === L) sl = [[d, 0]];
            else if (t === P) st = [[d, 0]];
          }
          STEPS[o][pr][t] = st;
          SLIDES[o][pr][t] = sl;
        }
      }
    }
  })();

  // ------------------------------------------------------------ 駒ヘルパ
  function mk(owner, type, prom) { return (owner << 4) | ((prom ? 1 : 0) << 3) | type; }
  function ownerOf(p) { return p >> 4; }
  function typeOf(p) { return p & 7; }
  function isProm(p) { return (p >> 3) & 1; }
  function glyph(p) { return isProm(p) ? GLYPH_PROM[typeOf(p)] : GLYPH[typeOf(p)]; }
  function nameOf(p) { return isProm(p) ? NAME_PROM[typeOf(p)] : NAME[typeOf(p)]; }
  function valueOf(p) { return isProm(p) ? VALUE_PROM[typeOf(p)] : VALUE[typeOf(p)]; }

  function sqOf(row, col) { return row * 9 + col; }
  function rowOf(sq) { return (sq / 9) | 0; }
  function colOf(sq) { return sq % 9; }
  /** 内部インデックス → 「7六」のような表記 */
  function sqName(sq) { return (9 - colOf(sq)) + RANK_KANJI[rowOf(sq)]; }

  function lastRank(owner) { return owner === SENTE ? 0 : 8; }
  function secondLastRank(owner) { return owner === SENTE ? 1 : 7; }
  function inZone(row, owner) { return owner === SENTE ? row <= 2 : row >= 6; }

  // -------------------------------------------------------------- 指し手
  // 32bit に詰める:  from(0-80,打は127) | to<<7 | promote<<14 | dropType<<15
  function encMove(from, to, prom, dropType) {
    return (from & 127) | (to << 7) | ((prom ? 1 : 0) << 14) | ((dropType || 0) << 15);
  }
  function mvFrom(m) { return m & 127; }
  function mvTo(m) { return (m >> 7) & 127; }
  function mvProm(m) { return (m >> 14) & 1; }
  function mvDropType(m) { return (m >> 15) & 7; }
  function mvIsDrop(m) { return (m & 127) === 127; }

  // -------------------------------------------------------------- 局面
  function Position() {
    this.board = new Int8Array(81).fill(EMPTY);
    this.hands = new Int8Array(16);     // hands[owner*8 + type]
    this.turn = SENTE;
    this.ply = 0;
    this.kings = [-1, -1];
  }

  Position.prototype.clone = function () {
    var p = new Position();
    p.board.set(this.board);
    p.hands.set(this.hands);
    p.turn = this.turn;
    p.ply = this.ply;
    p.kings = this.kings.slice();
    return p;
  };
  Position.prototype.at = function (sq) { return this.board[sq]; };
  Position.prototype.hand = function (owner, type) { return this.hands[owner * 8 + type]; };

  function refreshKings(pos) {
    pos.kings = [-1, -1];
    for (var sq = 0; sq < 81; sq++) {
      var p = pos.board[sq];
      if (p !== EMPTY && typeOf(p) === K) pos.kings[ownerOf(p)] = sq;
    }
  }

  // ---------------------------------------------------------- SFEN 変換
  var HIRATE = 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1';

  function fromSfen(sfen) {
    var pos = new Position();
    var parts = sfen.trim().split(/\s+/);
    var rows = parts[0].split('/');
    for (var r = 0; r < 9; r++) {
      var c = 0, s = rows[r] || '9', i = 0, prom = false;
      while (i < s.length) {
        var ch = s[i++];
        if (ch === '+') { prom = true; continue; }
        if (ch >= '1' && ch <= '9') { c += parseInt(ch, 10); prom = false; continue; }
        var lower = ch.toLowerCase();
        var t = SFEN_CHARS.indexOf(lower);
        if (t >= 0) pos.board[sqOf(r, c)] = mk(ch === lower ? GOTE : SENTE, t, prom);
        c++; prom = false;
      }
    }
    pos.turn = (parts[1] === 'w') ? GOTE : SENTE;
    var hs = parts[2] || '-';
    if (hs !== '-') {
      var num = 0;
      for (var j = 0; j < hs.length; j++) {
        var hc = hs[j];
        if (hc >= '0' && hc <= '9') { num = num * 10 + parseInt(hc, 10); continue; }
        var lo = hc.toLowerCase();
        var ht = SFEN_CHARS.indexOf(lo);
        if (ht >= 0) pos.hands[(hc === lo ? GOTE : SENTE) * 8 + ht] += (num || 1);
        num = 0;
      }
    }
    pos.ply = parts[3] ? Math.max(0, parseInt(parts[3], 10) - 1) : 0;
    refreshKings(pos);
    return pos;
  }

  function toSfen(pos) {
    var out = [];
    for (var r = 0; r < 9; r++) {
      var s = '', blank = 0;
      for (var c = 0; c < 9; c++) {
        var p = pos.board[sqOf(r, c)];
        if (p === EMPTY) { blank++; continue; }
        if (blank) { s += blank; blank = 0; }
        var ch = SFEN_CHARS[typeOf(p)];
        if (ownerOf(p) === SENTE) ch = ch.toUpperCase();
        s += (isProm(p) ? '+' : '') + ch;
      }
      if (blank) s += blank;
      out.push(s);
    }
    var hand = '';
    for (var o = 0; o < 2; o++) {
      for (var k = 0; k < HAND_ORDER.length; k++) {
        var t = HAND_ORDER[k], n = pos.hands[o * 8 + t];
        if (!n) continue;
        var hch = SFEN_CHARS[t];
        if (o === SENTE) hch = hch.toUpperCase();
        hand += (n > 1 ? n : '') + hch;
      }
    }
    return out.join('/') + ' ' + (pos.turn === SENTE ? 'b' : 'w') + ' ' +
      (hand || '-') + ' ' + (pos.ply + 1);
  }

  /** 駒落ち。落とすマスは後手側の座標で書く（上手が先手のときは点対称に読み替える） */
  var HANDICAPS = {
    'even':  { label: '平手',     remove: [] },
    'lance': { label: '香落ち',   remove: ['1一'] },
    'bishop':{ label: '角落ち',   remove: ['2二'] },
    'rook':  { label: '飛車落ち', remove: ['8二'] },
    'two':   { label: '二枚落ち', remove: ['8二', '2二'] },
    'four':  { label: '四枚落ち', remove: ['8二', '2二', '1一', '9一'] },
    'six':   { label: '六枚落ち', remove: ['8二', '2二', '1一', '9一', '2一', '8一'] },
    'eight': { label: '八枚落ち', remove: ['8二', '2二', '1一', '9一', '2一', '8一', '3一', '7一'] }
  };

  function parseSqName(str) {
    var file = parseInt(str[0], 10);
    var rank = RANK_KANJI.indexOf(str[1]) + 1;
    return sqOf(rank - 1, 9 - file);
  }

  /**
   * 初期局面を作る。
   * @param handicap 手合割のキー（'even' など）
   * @param uwate    駒を落とす側（上手）。省略時は後手。
   */
  function newGame(handicap, uwate) {
    var pos = fromSfen(HIRATE);
    var h = HANDICAPS[handicap || 'even'];
    var up = (uwate === undefined || uwate === null) ? GOTE : uwate;
    if (h) {
      h.remove.forEach(function (sn) {
        var sq = parseSqName(sn);
        // 上手が先手なら、盤を180度回した位置の駒を落とす
        pos.board[up === GOTE ? sq : 80 - sq] = EMPTY;
      });
    }
    refreshKings(pos);
    return pos;
  }

  // ---------------------------------------------------------- 利き判定
  /** sq が owner=by 側の駒に狙われているか */
  function isAttacked(board, sq, by) {
    var r = rowOf(sq), c = colOf(sq), i, j, p, list;

    // 隣接する「歩く駒」
    for (i = 0; i < 8; i++) {
      var rr = r + ALL8[i][0], cc = c + ALL8[i][1];
      if (rr < 0 || rr > 8 || cc < 0 || cc > 8) continue;
      p = board[rr * 9 + cc];
      if (p === EMPTY || ownerOf(p) !== by) continue;
      list = STEPS[by][isProm(p)][typeOf(p)];
      for (j = 0; j < list.length; j++) {
        if (list[j][0] === -ALL8[i][0] && list[j][1] === -ALL8[i][1]) return true;
      }
    }

    // 桂馬（隣接しないので別扱い）
    var kd = (by === SENTE) ? -1 : 1;
    var nr = r - 2 * kd;
    if (nr >= 0 && nr <= 8) {
      for (i = -1; i <= 1; i += 2) {
        var nc = c + i;
        if (nc < 0 || nc > 8) continue;
        p = board[nr * 9 + nc];
        if (p !== EMPTY && ownerOf(p) === by && typeOf(p) === N && !isProm(p)) return true;
      }
    }

    // 飛角香（走る駒）
    for (i = 0; i < 8; i++) {
      var dr = ALL8[i][0], dc = ALL8[i][1];
      var xr = r + dr, xc = c + dc;
      while (xr >= 0 && xr <= 8 && xc >= 0 && xc <= 8) {
        p = board[xr * 9 + xc];
        if (p !== EMPTY) {
          if (ownerOf(p) === by) {
            list = SLIDES[by][isProm(p)][typeOf(p)];
            for (j = 0; j < list.length; j++) {
              if (list[j][0] === -dr && list[j][1] === -dc) return true;
            }
          }
          break;
        }
        xr += dr; xc += dc;
      }
    }
    return false;
  }

  function inCheck(pos, owner) {
    var ksq = pos.kings[owner];
    if (ksq < 0) return false;
    return isAttacked(pos.board, ksq, 1 - owner);
  }

  // -------------------------------------------------------------- 手生成
  function mustPromote(type, toRow, owner) {
    if (type === P || type === L) return toRow === lastRank(owner);
    if (type === N) return toRow === lastRank(owner) || toRow === secondLastRank(owner);
    return false;
  }

  function pushMove(out, from, to, type, prom, owner) {
    var toRow = rowOf(to), fromRow = rowOf(from);
    if (!prom && CAN_PROMOTE[type] && (inZone(toRow, owner) || inZone(fromRow, owner))) {
      out.push(encMove(from, to, 1, 0));
      if (!mustPromote(type, toRow, owner)) out.push(encMove(from, to, 0, 0));
    } else {
      out.push(encMove(from, to, 0, 0));
    }
  }

  function hasPawnInFile(board, col, owner) {
    for (var r = 0; r < 9; r++) {
      var p = board[r * 9 + col];
      if (p !== EMPTY && ownerOf(p) === owner && typeOf(p) === P && !isProm(p)) return true;
    }
    return false;
  }

  /** 疑似合法手（自玉が取られる手も含む） */
  function pseudoMoves(pos) {
    var out = [], b = pos.board, me = pos.turn, sq, i;
    for (sq = 0; sq < 81; sq++) {
      var p = b[sq];
      if (p === EMPTY || ownerOf(p) !== me) continue;
      var t = typeOf(p), pr = isProm(p), r = rowOf(sq), c = colOf(sq);
      var st = STEPS[me][pr][t];
      for (i = 0; i < st.length; i++) {
        var rr = r + st[i][0], cc = c + st[i][1];
        if (rr < 0 || rr > 8 || cc < 0 || cc > 8) continue;
        var q = b[rr * 9 + cc];
        if (q !== EMPTY && ownerOf(q) === me) continue;
        pushMove(out, sq, rr * 9 + cc, t, pr, me);
      }
      var sl = SLIDES[me][pr][t];
      for (i = 0; i < sl.length; i++) {
        var xr = r + sl[i][0], xc = c + sl[i][1];
        while (xr >= 0 && xr <= 8 && xc >= 0 && xc <= 8) {
          var q2 = b[xr * 9 + xc];
          if (q2 !== EMPTY && ownerOf(q2) === me) break;
          pushMove(out, sq, xr * 9 + xc, t, pr, me);
          if (q2 !== EMPTY) break;
          xr += sl[i][0]; xc += sl[i][1];
        }
      }
    }
    // 持ち駒を打つ
    for (var h = 0; h < HAND_ORDER.length; h++) {
      var ht = HAND_ORDER[h];
      if (pos.hands[me * 8 + ht] <= 0) continue;
      for (sq = 0; sq < 81; sq++) {
        if (b[sq] !== EMPTY) continue;
        var row = rowOf(sq);
        if ((ht === P || ht === L) && row === lastRank(me)) continue;   // 行きどころのない駒
        if (ht === N && (row === lastRank(me) || row === secondLastRank(me))) continue;
        if (ht === P && hasPawnInFile(b, colOf(sq), me)) continue;      // 二歩
        out.push(encMove(127, sq, 0, ht));
      }
    }
    return out;
  }

  function doMove(pos, m) {
    var from = mvFrom(m), to = mvTo(m), prom = mvProm(m), dt = mvDropType(m);
    var me = pos.turn;
    var u = { m: m, captured: EMPTY, mover: me };
    if (from === 127) {
      pos.board[to] = mk(me, dt, 0);
      pos.hands[me * 8 + dt]--;
    } else {
      var p = pos.board[from];
      var cap = pos.board[to];
      if (cap !== EMPTY) {
        pos.hands[me * 8 + typeOf(cap)]++;
        u.captured = cap;
      }
      pos.board[from] = EMPTY;
      pos.board[to] = prom ? (p | 8) : p;
      if (typeOf(p) === K) pos.kings[me] = to;
    }
    pos.turn = 1 - me;
    pos.ply++;
    return u;
  }

  function undoMove(pos, u) {
    var m = u.m, from = mvFrom(m), to = mvTo(m), prom = mvProm(m), dt = mvDropType(m);
    var me = u.mover;
    pos.turn = me;
    pos.ply--;
    if (from === 127) {
      pos.board[to] = EMPTY;
      pos.hands[me * 8 + dt]++;
    } else {
      var p = pos.board[to];
      var orig = prom ? (p & ~8) : p;
      pos.board[from] = orig;
      pos.board[to] = u.captured;
      if (u.captured !== EMPTY) pos.hands[me * 8 + typeOf(u.captured)]--;
      if (typeOf(orig) === K) pos.kings[me] = from;
    }
  }

  /**
   * 合法手の一覧。
   * skipUchifu=true で打ち歩詰めの判定を省略する（内部の再帰用）。
   */
  function legalMoves(pos, skipUchifu) {
    var cand = pseudoMoves(pos), out = [];
    for (var i = 0; i < cand.length; i++) {
      var m = cand[i];
      var u = doMove(pos, m);
      var ksq = pos.kings[u.mover];
      var ok = (ksq < 0) || !isAttacked(pos.board, ksq, 1 - u.mover);
      if (ok && !skipUchifu && mvIsDrop(m) && mvDropType(m) === P) {
        // 打ち歩詰め: 歩を打って詰ましたら反則
        var oks = pos.kings[pos.turn];
        if (oks >= 0 && isAttacked(pos.board, oks, u.mover) && legalMoves(pos, true).length === 0) {
          ok = false;
        }
      }
      undoMove(pos, u);
      if (ok) out.push(m);
    }
    return out;
  }

  function isCheckmate(pos) {
    return legalMoves(pos).length === 0;
  }

  /** ある駒（from）の行ける場所の一覧（UI のハイライト用） */
  function movesFrom(pos, from) {
    return legalMoves(pos).filter(function (m) { return !mvIsDrop(m) && mvFrom(m) === from; });
  }
  /** ある持ち駒を打てる場所の一覧 */
  function dropsOf(pos, type) {
    return legalMoves(pos).filter(function (m) { return mvIsDrop(m) && mvDropType(m) === type; });
  }

  // ------------------------------------------------------------ 棋譜表記
  /**
   * 「▲７六歩」形式の文字列を作る。pos は指す前の局面。
   * prevTo を渡すと「同」を使う。
   */
  function moveToKanji(pos, m, prevTo, opts) {
    var to = mvTo(m), from = mvFrom(m);
    var mark = pos.turn === SENTE ? '▲' : '△';
    var place = (prevTo !== undefined && prevTo === to) ? '同' : sqName(to);
    var s, extra = '';
    if (mvIsDrop(m)) {
      s = NAME[mvDropType(m)];
      extra = '打';
    } else {
      var p = pos.board[from];
      s = nameOf(p);
      if (mvProm(m)) extra = '成';
      else if (CAN_PROMOTE[typeOf(p)] && !isProm(p) &&
        (inZone(rowOf(to), pos.turn) || inZone(rowOf(from), pos.turn)) &&
        !mustPromote(typeOf(p), rowOf(to), pos.turn)) extra = '不成';
    }
    var origin = (opts && opts.origin && !mvIsDrop(m))
      ? '(' + (9 - colOf(from)) + (rowOf(from) + 1) + ')' : '';
    return mark + place + s + extra + origin;
  }

  /** 盤面のテキスト図（Claude へ渡す用・デバッグ用） */
  function toText(pos) {
    var lines = [];
    lines.push('  ９ ８ ７ ６ ５ ４ ３ ２ １');
    lines.push(' +---------------------------+');
    for (var r = 0; r < 9; r++) {
      var s = '|';
      for (var c = 0; c < 9; c++) {
        var p = pos.board[sqOf(r, c)];
        if (p === EMPTY) s += ' ・';
        else s += (ownerOf(p) === SENTE ? ' ' : 'v') + glyph(p);
      }
      lines.push(s + '|' + RANK_KANJI[r]);
    }
    lines.push(' +---------------------------+');
    for (var o = 0; o < 2; o++) {
      var h = [];
      for (var k = 0; k < HAND_ORDER.length; k++) {
        var t = HAND_ORDER[k], n = pos.hands[o * 8 + t];
        if (n) h.push(NAME[t] + (n > 1 ? n : ''));
      }
      lines.push((o === SENTE ? '先手' : '後手') + 'の持駒: ' + (h.join(' ') || 'なし'));
    }
    lines.push('手番: ' + (pos.turn === SENTE ? '先手' : '後手'));
    return lines.join('\n');
  }

  // ------------------------------------------------- 静的な駒の取り合い
  /** sq のマスを狙っている owner 側の駒のうち、最も安い駒の価値（いなければ -1） */
  function cheapestAttacker(pos, sq, owner) {
    var best = -1;
    var moves = pseudoMovesFor(pos, owner);
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      if (mvIsDrop(m) || mvTo(m) !== sq) continue;
      var v = valueOf(pos.board[mvFrom(m)]);
      if (best < 0 || v < best) best = v;
    }
    return best;
  }

  function pseudoMovesFor(pos, owner) {
    if (pos.turn === owner) return pseudoMoves(pos);
    var saved = pos.turn;
    pos.turn = owner;
    var mv = pseudoMoves(pos);
    pos.turn = saved;
    return mv;
  }

  /**
   * sq にある駒が「ただで取られそう」かを大まかに判定する。
   * 戻り値は損失の見積り（0 なら安全）。
   */
  function hangingLoss(pos, sq) {
    var p = pos.board[sq];
    if (p === EMPTY) return 0;
    if (typeOf(p) === K) return 0;              // 玉は「取られる駒」ではない（王手は別で見る）
    var me = ownerOf(p);
    var attacker = cheapestAttacker(pos, sq, 1 - me);
    if (attacker < 0) return 0;                 // 狙われていない

    // ひも（守り駒）は、そのマスをいったん空にしてから数える。
    // 自分の駒がいるマスへは動けないので、置いたままでは1枚も見つからない
    pos.board[sq] = EMPTY;
    var defender = cheapestAttacker(pos, sq, me);
    pos.board[sq] = p;

    if (defender < 0) return valueOf(p);        // 紐なし → まるまる損
    if (attacker < valueOf(p)) return valueOf(p) - attacker; // 安い駒で取られる
    return 0;
  }

  // ------------------------------------------------------------ 詰み探索
  /**
   * 手番側が n 手（奇数）で詰ませられるか調べる。
   * 見つかれば最初の一手（指し手）を、なければ null を返す。
   */
  function findMate(pos, n) {
    if (n <= 0) return null;
    var moves = legalMoves(pos);
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      var u = doMove(pos, m);
      var gives = inCheck(pos, pos.turn);
      var solved = false;
      if (gives) {
        if (legalMoves(pos).length === 0) solved = true;
        else if (n >= 3) solved = defenderAllMated(pos, n - 1);
      }
      undoMove(pos, u);
      if (solved) return m;
    }
    return null;
  }

  function defenderAllMated(pos, n) {
    var moves = legalMoves(pos);
    if (moves.length === 0) return true;
    for (var i = 0; i < moves.length; i++) {
      var u = doMove(pos, moves[i]);
      var mated = findMate(pos, n - 1) !== null;
      undoMove(pos, u);
      if (!mated) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- API
  // ---------------------------------------------------------- 指し手の読み書き
  // 外部のAIやツールとやりとりするための入出力。
  // 書き出しは USI（将棋ソフト共通の書き方）、読み取りは USI・数字・漢字のどれでも受ける。

  var USI_PIECE = ['K', 'R', 'B', 'G', 'S', 'N', 'L', 'P'];   // 添字＝駒種

  /** マス番号 → USI（例: 7七 → '7g'） */
  function sqUsi(sq) { return String(9 - colOf(sq)) + 'abcdefghi'[rowOf(sq)]; }

  /** USI → マス番号。読めなければ -1 */
  function usiSq(str) {
    var file = parseInt(str[0], 10);
    var rank = 'abcdefghi'.indexOf(str[1]) + 1;
    if (!(file >= 1 && file <= 9) || rank < 1) return -1;
    return sqOf(rank - 1, 9 - file);
  }

  /** 指し手 → USI（例: '7g7f' / '7g7f+' / 'P*5e'） */
  function moveToUsi(m) {
    if (mvIsDrop(m)) return USI_PIECE[mvDropType(m)] + '*' + sqUsi(mvTo(m));
    return sqUsi(mvFrom(m)) + sqUsi(mvTo(m)) + (mvProm(m) ? '+' : '');
  }

  /** その手を表す書き方を全部集める（読み取りの照合用） */
  function moveAliases(pos, m) {
    var out = [moveToUsi(m), moveToKanji(pos, m, -1).replace(/^[▲△]/, '')];
    var to = sqName(mvTo(m));
    if (mvIsDrop(m)) {
      var dt = mvDropType(m);
      out.push(to + GLYPH[dt] + '打', to + GLYPH[dt], to + NAME[dt] + '打', to + NAME[dt]);
    } else {
      var pc = pos.board[mvFrom(m)], t = typeOf(pc), pr = isProm(pc);
      var g = pr ? GLYPH_PROM[t] : GLYPH[t], n = pr ? NAME_PROM[t] : NAME[t];
      var suf = mvProm(m) ? '成' : '';
      var fromNum = String(9 - colOf(mvFrom(m))) + String(rowOf(mvFrom(m)) + 1);
      var toNum = String(9 - colOf(mvTo(m))) + String(rowOf(mvTo(m)) + 1);
      out.push(to + g + suf, to + n + suf);
      out.push(to + g + suf + '(' + fromNum + ')', to + n + suf + '(' + fromNum + ')');
      out.push(fromNum + '-' + toNum + (mvProm(m) ? '+' : ''));
      out.push(fromNum + toNum + (mvProm(m) ? '+' : ''));
      if (!mvProm(m) && CAN_PROMOTE[t] && !pr) out.push(to + g + '不成', to + n + '不成');
    }
    return out;
  }

  /**
   * 文字列から指し手を読み取る。USI（7g7f, P*5e）、数字（77-76, 7776+）、
   * 漢字（7六歩, ▲2四歩成, 5二金打）のどれでも受け付ける。
   * @return { move, error, candidates }
   *         move が null のとき error は
   *         'unreadable'（書き方が不明）/ 'illegal'（読めたが指せない）/ 'ambiguous'（候補が複数）
   */
  function parseMoveText(pos, text) {
    var fail = function (err, cand) { return { move: null, error: err, candidates: cand || [] }; };
    if (text === undefined || text === null) return fail('unreadable');

    var s = String(text)
      .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[Ａ-Ｚａ-ｚ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/＋/g, '+').replace(/＊/g, '*')
      .replace(/\s+/g, '')
      .replace(/^[▲△▼▽先後手]+/, '')      // 手番記号は無視
      .replace(/^[0-9]+[.．]/, '');          // 「12.」のような手数も無視
    if (!s) return fail('unreadable');

    var legal = legalMoves(pos);
    var hit = [], i, j;

    // USI の打つ手だけ大文字小文字を吸収したいので、比較は素の文字列と小文字の両方で
    for (i = 0; i < legal.length; i++) {
      var al = moveAliases(pos, legal[i]);
      for (j = 0; j < al.length; j++) {
        if (al[j] === s || al[j].toLowerCase() === s.toLowerCase()) { hit.push(legal[i]); break; }
      }
    }
    if (hit.length === 1) return { move: hit[0], error: null, candidates: [] };
    if (hit.length > 1) {
      return fail('ambiguous', hit.map(function (m) { return moveToKanji(pos, m, -1, { origin: true }); }));
    }

    // 形としては読めるが指せない手なのか、そもそも読めないのかを分けて返す
    var shaped = /^([1-9][a-i])([1-9][a-i])\+?$/i.test(s) ||
                 /^[KRBGSNLP]\*[1-9][a-i]$/i.test(s) ||
                 /^[1-9][1-9][-x]?[1-9][1-9](\+|成)?$/.test(s) ||
                 /^[1-9][一二三四五六七八九]/.test(s);
    return fail(shaped ? 'illegal' : 'unreadable');
  }

  return {
    SENTE: SENTE, GOTE: GOTE, EMPTY: EMPTY,
    K: K, R: R, B: B, G: G, S: S, N: N, L: L, P: P,
    GLYPH: GLYPH, GLYPH_PROM: GLYPH_PROM, NAME: NAME, NAME_PROM: NAME_PROM,
    HAND_ORDER: HAND_ORDER, VALUE: VALUE, VALUE_PROM: VALUE_PROM,
    CAN_PROMOTE: CAN_PROMOTE, RANK_KANJI: RANK_KANJI,
    STEPS: STEPS, SLIDES: SLIDES, HANDICAPS: HANDICAPS, HIRATE: HIRATE,

    Position: Position,
    mk: mk, ownerOf: ownerOf, typeOf: typeOf, isProm: isProm,
    glyph: glyph, nameOf: nameOf, valueOf: valueOf,
    sqOf: sqOf, rowOf: rowOf, colOf: colOf, sqName: sqName, parseSqName: parseSqName,
    inZone: inZone, lastRank: lastRank, mustPromote: mustPromote,

    moveToUsi: moveToUsi, parseMoveText: parseMoveText,
    encMove: encMove, mvFrom: mvFrom, mvTo: mvTo, mvProm: mvProm,
    mvDropType: mvDropType, mvIsDrop: mvIsDrop,

    newGame: newGame, fromSfen: fromSfen, toSfen: toSfen, toText: toText,
    refreshKings: refreshKings,
    pseudoMoves: pseudoMoves, legalMoves: legalMoves, movesFrom: movesFrom, dropsOf: dropsOf,
    doMove: doMove, undoMove: undoMove,
    isAttacked: isAttacked, inCheck: inCheck, isCheckmate: isCheckmate,
    hangingLoss: hangingLoss, cheapestAttacker: cheapestAttacker,
    findMate: findMate,
    moveToKanji: moveToKanji
  };
});
