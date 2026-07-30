/*
 * ui.js — 画面まわり
 *   対局 / レッスン / 詰将棋 の3画面と、右の先生パネル。
 */
(function () {
  'use strict';

  var S = window.Shogi, AI = window.ShogiAI, T = window.ShogiTutor, C = window.ShogiClaude;

  // ------------------------------------------------------------ 小道具
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function soon(fn) { setTimeout(fn, 30); }

  // ------------------------------------------------------------ 設定
  var settings = { sound: true, review: true };
  try {
    var saved = JSON.parse(localStorage.getItem('shogi.settings') || '{}');
    if (typeof saved.sound === 'boolean') settings.sound = saved.sound;
    if (typeof saved.review === 'boolean') settings.review = saved.review;
  } catch (e) {}
  function saveSettings() {
    try { localStorage.setItem('shogi.settings', JSON.stringify(settings)); } catch (e) {}
  }

  // ------------------------------------------------------------ 効果音
  var audioCtx = null;
  function click(freq) {
    if (!settings.sound) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'triangle';
      o.frequency.value = freq || 320;
      g.gain.setValueAtTime(0.12, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.11);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + 0.12);
    } catch (e) {}
  }

  // ------------------------------------------------------------ 盤の表示
  function BoardView(root, onClick) {
    var self = this;
    this.root = root;
    this.cells = [];
    this.stars = {};
    this.flip = false;          // true なら盤を180度回して表示（後手を持つとき）
    clear(root);
    for (var i = 0; i < 81; i++) {
      var d = el('div', 'sq');
      d.dataset.idx = i;        // 画面上の位置（マス番号ではない）
      var r = Math.floor(i / 9), c = i % 9;
      // 星は盤そのものの模様なので、反転しても同じ位置に残る（点対称のため）
      if ((r === 2 || r === 5) && (c === 2 || c === 5)) { d.classList.add('star'); this.stars[i] = 1; }
      root.appendChild(d);
      this.cells.push(d);
    }
    if (onClick) {
      root.addEventListener('click', function (e) {
        var cell = e.target.closest ? e.target.closest('.sq') : null;
        if (!cell) return;
        var idx = parseInt(cell.dataset.idx, 10);
        if (idx >= 0) onClick(self.flip ? 80 - idx : idx);
      });
    }
  }

  /** マス番号 → 画面上の位置 */
  BoardView.prototype.at = function (sq) { return this.flip ? 80 - sq : sq; };

  /**
   * st: { targets:{sq:true}, selected, lastFrom, lastTo, checkSq, hilite:[sq], mover, bottom }
   *   bottom … 下側に表示する側（駒の向きの基準）。省略時は先手。
   */
  BoardView.prototype.render = function (pos, st) {
    st = st || {};
    var targets = st.targets || {};
    var bottom = (st.bottom === undefined) ? S.SENTE : st.bottom;
    for (var sq = 0; sq < 81; sq++) {
      var idx = this.at(sq);
      var cell = this.cells[idx];
      var cls = 'sq';
      if (this.stars[idx]) cls += ' star';
      if (sq === st.lastFrom || sq === st.lastTo) cls += ' last';
      if (sq === st.lastTo) cls += ' last-to';
      if (st.hilite && st.hilite.indexOf(sq) >= 0) cls += ' hilite';
      if (sq === st.checkSq) cls += ' check';
      if (sq === st.selected) cls += ' selected';
      var p = pos.board[sq];
      if (targets[sq]) cls += (p !== S.EMPTY) ? ' target capture' : ' target';
      cell.className = cls;
      clear(cell);
      if (p !== S.EMPTY) {
        var owner = S.ownerOf(p);
        var d = el('div', 'pc' + (owner !== bottom ? ' gote' : '') +
          (S.isProm(p) ? ' prom' : '') + (st.mover === owner ? ' mine' : ' static'));
        d.appendChild(el('span', null, S.glyph(p)));
        cell.appendChild(d);
      }
    }
  };

  function renderHand(root, pos, owner, opts) {
    opts = opts || {};
    clear(root);
    var any = false;
    S.HAND_ORDER.forEach(function (t) {
      var n = pos.hand(owner, t);
      if (!n) return;
      any = true;
      var d = el('div', 'hand-pc' + (opts.selected === t ? ' on' : ''));
      d.appendChild(el('span', null, S.GLYPH[t]));
      if (n > 1) d.appendChild(el('i', 'n', String(n)));
      if (opts.onPick) {
        d.addEventListener('click', function () { opts.onPick(t); });
      }
      root.appendChild(d);
    });
    if (!any) root.appendChild(el('span', 'empty', '持ち駒なし'));
  }

  // ------------------------------------------------------------ 駒の動きの図
  function moveDiagram(type, prom, owner) {
    var g = el('div', 'diagram');
    var reach = {};
    S.STEPS[owner][prom ? 1 : 0][type].forEach(function (d) {
      var r = 2 + d[0], c = 2 + d[1];
      if (r >= 0 && r < 5 && c >= 0 && c < 5) reach[r * 5 + c] = 'dot';
    });
    S.SLIDES[owner][prom ? 1 : 0][type].forEach(function (d) {
      var r = 2 + d[0], c = 2 + d[1], last = -1;
      while (r >= 0 && r < 5 && c >= 0 && c < 5) {
        last = r * 5 + c;
        reach[last] = 'dot';
        r += d[0]; c += d[1];
      }
      if (last >= 0) reach[last] = 'far';   // 図の外までまだ進める
    });
    for (var i = 0; i < 25; i++) {
      var d = el('div');
      if (i === 12) {
        d.className = 'self';
        d.textContent = prom ? S.GLYPH_PROM[type] : S.GLYPH[type];
      } else if (reach[i]) {
        d.className = reach[i];
      }
      g.appendChild(d);
    }
    return g;
  }

  // ------------------------------------------------------------ 先生パネル
  var tutorPane, kifuPane, piecePane;

  function pushMsg(o) {
    var box = el('div', 'msg ' + (o.tone || 'ok'));
    box.appendChild(el('div', 'who', o.who || '先生'));
    if (o.title) box.appendChild(el('h4', null, o.title));
    (o.lines || []).forEach(function (line) {
      var p = el('p');
      p.innerHTML = line;
      box.appendChild(p);
    });
    tutorPane.insertBefore(box, tutorPane.firstChild);
    while (tutorPane.children.length > 40) tutorPane.removeChild(tutorPane.lastChild);
    return box;
  }

  function esc(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }

  // ------------------------------------------------------------ 対局
  var boardView;
  var G = {
    pos: null,
    history: [],
    handicap: 'even',
    level: 2,
    over: null,
    busy: false,
    sel: -1,
    dropType: -1,
    targets: {},
    hilite: [],
    lastFrom: -1,
    lastTo: -1,
    counts: {},
    you: S.SENTE,         // あなたが持つ側（先手 or 後手）
    gen: 0,               // 局面を差し替えるたびに増やす（予約済みのAIの手を捨てるため）
    // 相手の手はつねに bridge.js 経由で受け取る（USIエンジン・AI・手入力）
    moveSeq: 0,           // 外部AIから受け取った指し手の通し番号
    waiting: false        // 外部AIの手を待っている最中か
  };

  /**
   * 相手の指し手を予約する。
   * 予約してから実行までの間に新規対局・局面読み込み・待ったが入ったら、
   * その手はもう別の局面のものなので捨てる。
   */
  function scheduleAi() {
    var gen = G.gen;
    soon(function () { if (gen === G.gen) aiTurn(); });
  }

  function posKey(pos) { return S.toSfen(pos).replace(/ \d+$/, ''); }

  function newGame(handicap, side) {
    G.gen++;
    G.waiting = false;
    G.handicap = handicap || G.handicap;
    G.you = (side === undefined) ? G.you : side;
    // 駒を落とすのは相手（上手）のほう
    G.pos = S.newGame(G.handicap, 1 - G.you);
    G.history = [];
    G.over = null;
    G.busy = false;
    G.sel = -1; G.dropType = -1; G.targets = {}; G.hilite = [];
    G.lastFrom = -1; G.lastTo = -1;
    G.counts = {};
    G.counts[posKey(G.pos)] = 1;
    applyOrientation();
    clear(tutorPane);
    var h = S.HANDICAPS[G.handicap];
    var youSente = (G.you === S.SENTE);
    pushMsg({
      tone: 'ok', title: h.label + '・' + (youSente ? '先手' : '後手') + 'で対局開始',
      lines: [
        'あなたは<b>' + (youSente ? '先手' : '後手') + '</b>。あなたの駒がいつも<b>下側</b>に来るように盤を向けてあります。' +
          '駒をクリックすると、動けるマスが緑の丸で光ります。',
        youSente ? 'あなたの先手番です。どうぞ。' : 'まず相手（先手）が指します。少し待ってください。',
        '迷ったら「ヒント」、詰みがありそうなら「詰みチェック」を押してください。'
      ]
    });
    render();
    saveGame();
    // 後手を持ったときは相手（先手）から
    if (G.pos.turn !== G.you) { G.busy = true; render(); scheduleAi(); }
  }

  /** 盤の向き（あなたが下）と、筋・段のラベルをそろえる */
  function applyOrientation() {
    boardView.flip = (G.you === S.GOTE);
    renderBoardLabels(boardView.flip);
  }

  function renderBoardLabels(flip) {
    var fl = $('fileLabels');
    clear(fl);
    for (var c = 0; c < 9; c++) fl.appendChild(el('span', null, String(flip ? c + 1 : 9 - c)));
    var rl = $('rankLabels');
    clear(rl);
    for (var r = 0; r < 9; r++) rl.appendChild(el('span', null, S.RANK_KANJI[flip ? 8 - r : r]));
  }

  function saveGame() {
    try {
      localStorage.setItem('shogi.game', JSON.stringify({
        sfen: S.toSfen(G.pos),
        handicap: G.handicap,
        you: G.you,
        kifu: G.history.map(function (h) { return h.kanji; }),
        over: G.over
      }));
    } catch (e) {}
    pushBridge();
  }

  function loadGame() {
    try {
      var d = JSON.parse(localStorage.getItem('shogi.game') || 'null');
      if (!d || !d.sfen) return false;
      G.pos = S.fromSfen(d.sfen);
      G.handicap = d.handicap || 'even';
      G.you = (d.you === S.GOTE) ? S.GOTE : S.SENTE;
      G.over = d.over || null;
      G.history = (d.kifu || []).map(function (k) { return { kanji: k, undo: null }; });
      G.counts = {};
      G.counts[posKey(G.pos)] = 1;
      return true;
    } catch (e) { return false; }
  }

  function myTurn() { return !G.over && !G.busy && G.pos.turn === G.you; }

  function render() {
    var check = S.inCheck(G.pos, G.pos.turn) ? G.pos.kings[G.pos.turn] : -1;
    boardView.render(G.pos, {
      targets: G.targets,
      selected: G.sel,
      lastFrom: G.lastFrom,
      lastTo: G.lastTo,
      checkSq: check,
      hilite: G.hilite,
      mover: myTurn() ? G.you : -1,
      bottom: G.you
    });
    // handGote / handSente は「上の駒台」「下の駒台」という位置の意味で使う
    renderHand($('handGote'), G.pos, 1 - G.you, {});
    renderHand($('handSente'), G.pos, G.you, {
      selected: G.dropType,
      onPick: myTurn() ? pickDrop : null
    });
    renderStatus();
    renderKifu();
    $('undoBtn').disabled = G.history.length < 2 || G.busy;
    ['hintBtn', 'mateBtn', 'resignBtn'].forEach(function (id) {
      $(id).disabled = !!G.over || G.busy;
    });
    $('askBtn').disabled = G.busy || !C.enabled();
    $('askBtn').title = C.enabled() ? '' : '設定でAPIキーを入れると使えます';
  }

  function renderStatus() {
    var s = $('status');
    s.className = 'status';
    if (G.over) { s.textContent = G.over.text; s.classList.add('alert'); return; }
    if (G.waiting) { s.textContent = '相手（外部AI）の指し手を待っています…'; s.classList.add('think'); return; }
    if (G.busy) { s.textContent = '相手が考えています…'; s.classList.add('think'); return; }
    var parts = [(G.history.length + 1) + '手目'];
    parts.push(G.pos.turn === G.you ? 'あなたの番' : '相手の番');
    if (S.inCheck(G.pos, G.pos.turn)) {
      parts.push('王手！');
      s.classList.add('alert');
    }
    s.textContent = parts.join(' ／ ');
  }

  var evalCache = { key: '', senteCp: null, depth: 0, from: '内蔵' };

  function renderKifu() {
    clear(kifuPane);
    // 形勢は「あなたから見て」表示する（後手を持つときは符号が逆になる）
    var youSente = (G.you === S.SENTE);
    var key = S.toSfen(G.pos);
    var sc = (evalCache.key === key && evalCache.senteCp !== null)
      ? evalCache.senteCp : AI.evaluate(G.pos);
    var mine = youSente ? sc : -sc;
    var pct = Math.max(2, Math.min(98, 50 + mine / 40));
    var wrap = el('div');
    wrap.appendChild(el('p', null, T.describeScore(sc, youSente)));
    if (evalCache.key === key && evalCache.from === 'サーバー') {
      wrap.appendChild(el('p', 'eval-src', 'やねうら王の評価（深さ' + evalCache.depth + '）'));
    }
    var bar = el('div', 'eval-bar');
    var fill = el('i');
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    wrap.appendChild(bar);
    kifuPane.appendChild(wrap);

    var tbl = el('table', 'kifu');
    G.history.forEach(function (h, i) {
      var tr = el('tr');
      if (i === G.history.length - 1) tr.className = 'cur';
      tr.appendChild(el('td', 'n', String(i + 1)));
      tr.appendChild(el('td', null, h.kanji));
      tbl.appendChild(tr);
    });
    if (!G.history.length) {
      var tr0 = el('tr');
      var td0 = el('td', null, 'まだ指されていません');
      tr0.appendChild(td0);
      tbl.appendChild(tr0);
    }
    kifuPane.appendChild(tbl);
  }

  // ---- 入力
  function clearSel() { G.sel = -1; G.dropType = -1; G.targets = {}; }

  function pickDrop(type) {
    if (!myTurn()) return;
    if (G.dropType === type) { clearSel(); render(); return; }
    clearSel();
    G.dropType = type;
    G.hilite = [];
    S.dropsOf(G.pos, type).forEach(function (m) {
      var to = S.mvTo(m);
      (G.targets[to] = G.targets[to] || []).push(m);
    });
    render();
  }

  function onSquare(sq) {
    if (!myTurn()) return;
    G.hilite = [];
    if (G.targets[sq]) { chooseMove(G.targets[sq]); return; }
    var p = G.pos.board[sq];
    if (p !== S.EMPTY && S.ownerOf(p) === G.you) {
      clearSel();
      G.sel = sq;
      S.movesFrom(G.pos, sq).forEach(function (m) {
        var to = S.mvTo(m);
        (G.targets[to] = G.targets[to] || []).push(m);
      });
      if (!Object.keys(G.targets).length) {
        pushMsg({ tone: 'ok', title: 'その駒は動けません', lines: ['ほかの駒を選んでみましょう。'] });
      }
    } else {
      clearSel();
    }
    render();
  }

  /** 成る／成らないが選べるときはダイアログを出す */
  function chooseMove(moves) {
    if (moves.length === 1) { playMove(moves[0]); return; }
    var prom = null, plain = null;
    moves.forEach(function (m) { if (S.mvProm(m)) prom = m; else plain = m; });
    if (prom === null || plain === null) { playMove(moves[0]); return; }
    var pc = G.pos.board[S.mvFrom(prom)];
    $('promoteText').textContent = S.nameOf(pc) + 'を成りますか？';
    $('promoteModal').classList.remove('hidden');
    $('promoteYes').onclick = function () { $('promoteModal').classList.add('hidden'); playMove(prom); };
    $('promoteNo').onclick = function () { $('promoteModal').classList.add('hidden'); playMove(plain); };
  }

  function applyMove(m) {
    var kanji = S.moveToKanji(G.pos, m, G.lastTo, { origin: true });
    var undo = S.doMove(G.pos, m);
    G.history.push({ kanji: kanji, undo: undo, move: m });
    G.lastFrom = S.mvIsDrop(m) ? -1 : S.mvFrom(m);
    G.lastTo = S.mvTo(m);
    var k = posKey(G.pos);
    G.counts[k] = (G.counts[k] || 0) + 1;
    click(S.mvIsDrop(m) ? 260 : 340);
    return kanji;
  }

  function playMove(m) {
    var before = G.pos.clone();
    clearSel();
    applyMove(m);
    render();
    saveGame();
    if (checkEnd()) return;
    G.busy = true;
    render();
    var gen = G.gen;
    if (!settings.review) { soon(scheduleAi); return; }

    // 指す前の局面と、指した後の局面をサーバーに解析させて損得を出す
    reviewWithServer(before, m, gen).then(function (opts) {
      if (gen !== G.gen) return;
      var rv = T.reviewMove(before, m, opts);
      pushMsg({
        tone: rv.tone, title: rv.title,
        lines: ['<span class="mv">' + esc(rv.kanji) + '</span>']
          .concat(rv.lines.map(esc))
          .concat(opts.note ? ['<span class="eval-src">' + esc(opts.note) + '</span>'] : [])
      });
      scheduleAi();
    });
  }

  function aiTurn() {
    if (G.over) { G.busy = false; render(); return; }
    waitForExternal();
  }

  function checkEnd() {
    if (G.over) return true;
    if (S.legalMoves(G.pos).length === 0) {
      var loser = G.pos.turn;
      finish(loser === G.you ? 'lose' : 'win',
        loser === G.you ? 'あなたの負けです（詰み）' : 'あなたの勝ちです！（詰み）');
      return true;
    }
    if (G.counts[posKey(G.pos)] >= 4) {
      finish('draw', '同じ局面が4回現れました（千日手）。引き分けです。');
      return true;
    }
    return false;
  }

  function finish(kind, text) {
    G.over = { kind: kind, text: text };
    G.busy = false;
    render();
    saveGame();
    $('overTitle').textContent =
      kind === 'win' ? '勝ち！' : (kind === 'lose' ? '負け…' : '引き分け');
    $('overText').textContent = text + (
      kind === 'win' ? ' 最後まで丁寧に指せていました。'
        : kind === 'lose' ? ' 「棋譜」タブで、どこで形勢が動いたか振り返ってみましょう。'
          : '');
    $('overModal').classList.remove('hidden');
    pushMsg({ tone: kind === 'win' ? 'great' : (kind === 'lose' ? 'bad' : 'ok'), title: '対局終了', lines: [esc(text)] });
  }

  function undoMove() {
    if (G.busy && !G.waiting) return;
    G.gen++;
    G.waiting = false;
    // 自分の手番に戻るまで戻す（相手の手＋自分の手＝2手）
    var n = 0;
    while (G.history.length && n < 2) {
      var h = G.history[G.history.length - 1];
      if (!h.undo) break;               // 読み込み直した棋譜には戻す情報がない
      G.history.pop();
      var k = posKey(G.pos);
      G.counts[k] = Math.max(0, (G.counts[k] || 1) - 1);
      S.undoMove(G.pos, h.undo);
      n++;
      if (G.pos.turn === G.you) break;
    }
    G.over = null;
    clearSel();
    G.hilite = [];
    var last = G.history[G.history.length - 1];
    G.lastFrom = last && last.move !== undefined && !S.mvIsDrop(last.move) ? S.mvFrom(last.move) : -1;
    G.lastTo = last && last.move !== undefined ? S.mvTo(last.move) : -1;
    render();
    saveGame();
    if (n === 0) {
      pushMsg({
        tone: 'warn', title: '待ったできません',
        lines: ['ページを開き直したあとの対局は、局面だけを引き継いでいるため手を戻せません。この局面から続けてください。']
      });
    } else {
      pushMsg({ tone: 'ok', title: '待った', lines: ['手を戻しました。もう一度考えてみましょう。'] });
    }
  }

  function showHint() {
    G.busy = true; render();
    var gen = G.gen;
    analyze(G.pos, { ms: 700, multipv: 1 }).then(function (d) {
      if (gen !== G.gen) return;
      var given = d ? usiToMove(G.pos, d.bestmove) : null;
      var h = T.hint(G.pos, { bestMove: given });
      if (d && given !== null) {
        h.text += '（やねうら王の推奨・深さ' + d.depth + '）';
      }
      G.busy = false;
      if (h.move) {
        G.hilite = [S.mvTo(h.move)];
        if (!S.mvIsDrop(h.move)) G.hilite.push(S.mvFrom(h.move));
      }
      pushMsg({
        tone: h.urgent ? 'warn' : 'ok',
        title: h.title,
        lines: [esc(h.text), h.move ? 'ヒント：<span class="mv">' + esc(S.sqName(S.mvTo(h.move))) + '</span> のあたりです（盤の青いマス）。' : '']
          .filter(Boolean)
      });
      render();
    });
  }

  function mateCheck() {
    G.busy = true; render();
    var gen = G.gen;
    soon(function () {
      if (gen !== G.gen) return;
      var m1 = S.findMate(G.pos, 1);
      var m3 = m1 ? null : S.findMate(G.pos, 3);
      G.busy = false;
      if (m1 || m3) {
        var mv = m1 || m3;
        G.hilite = [S.mvTo(mv)];
        pushMsg({
          tone: 'great',
          title: (m1 ? '1手詰' : '3手詰') + 'があります！',
          lines: ['詰ます手の行き先は <span class="mv">' + esc(S.sqName(S.mvTo(mv))) + '</span> です。どの駒を使うか考えてみましょう。']
        });
      } else {
        pushMsg({ tone: 'ok', title: '詰みは見つかりません', lines: ['いまは3手以内の詰みはありません。玉のまわりを狭めるか、駒得を狙いましょう。'] });
      }
      render();
    });
  }

  function askClaude() {
    if (!C.enabled()) return;
    var box = pushMsg({ tone: 'claude', who: 'Claude', title: '考えています…', lines: ['<span class="spinner"></span>'] });
    G.busy = true; render();
    C.ask({
      pos: G.pos,
      history: G.history,
      question: 'いまの局面で、私（先手）は何を考えればよいですか。次の一手の候補と、その理由を教えてください。'
    }).then(function (text) {
      box.className = 'msg claude';
      clear(box);
      box.appendChild(el('div', 'who', 'Claude'));
      text.split(/\n{1,}/).forEach(function (line) {
        if (line.trim()) box.appendChild(el('p', null, line));
      });
    }).catch(function (e) {
      box.className = 'msg bad';
      clear(box);
      box.appendChild(el('div', 'who', 'Claude'));
      box.appendChild(el('h4', null, '接続できませんでした'));
      box.appendChild(el('p', null, e.message));
    }).then(function () {
      G.busy = false; render();
    });
  }

  // ------------------------------------------------------------ 駒の説明パネル
  var guideState = { index: 0, prom: false };

  function renderPieceGuide(container) {
    clear(container);
    var list = el('div', 'piece-list');
    T.PIECE_GUIDE.forEach(function (g, i) {
      var b = el('button', i === guideState.index ? 'on' : null, S.GLYPH[g.type]);
      b.addEventListener('click', function () {
        guideState.index = i; guideState.prom = false; renderPieceGuide(container);
      });
      list.appendChild(b);
    });
    container.appendChild(list);

    var g = T.PIECE_GUIDE[guideState.index];
    var canProm = S.CAN_PROMOTE[g.type];
    var body = el('div', 'guide');
    body.appendChild(el('h3', null, g.title + (guideState.prom ? '（成り）' : '')));
    container.appendChild(body);

    container.appendChild(moveDiagram(g.type, guideState.prom, S.SENTE));

    if (canProm) {
      var toggle = el('div', 'piece-list');
      [['もとの駒', false], ['成った駒', true]].forEach(function (o) {
        var b = el('button', guideState.prom === o[1] ? 'on' : null, o[0]);
        b.addEventListener('click', function () { guideState.prom = o[1]; renderPieceGuide(container); });
        toggle.appendChild(b);
      });
      container.appendChild(toggle);
    }

    var d = el('div', 'guide');
    d.appendChild(el('p', null, '動き方：' + (guideState.prom ? '金と同じ（成銀・成桂・成香・と金）／' + g.promo : g.move)));
    d.appendChild(el('p', null, g.text));
    if (!guideState.prom) d.appendChild(el('p', null, g.promo));
    d.appendChild(el('div', 'tip', '💡 ' + g.tip));
    container.appendChild(d);
  }

  // ------------------------------------------------------------ 設定画面
  // ------------------------------------------------------------ 局面の受け渡し
  /** チャットに貼れるテキストにまとめる */
  function shareText() {
    var lines = [];
    lines.push('=== 将棋 局面 ===');
    lines.push('手合割: ' + S.HANDICAPS[G.handicap].label +
      ' / ' + (G.history.length + 1) + '手目' +
      ' / あなた=' + (G.you === S.SENTE
        ? '先手（下の図で下側・v なしの駒）'
        : '後手（下の図で上側・v つきの駒）'));
    lines.push(S.toText(G.pos));
    lines.push('SFEN: ' + S.toSfen(G.pos));
    if (G.history.length) {
      lines.push('棋譜: ' + G.history.map(function (h) { return h.kanji; }).join(' '));
    }
    if (G.over) lines.push('結果: ' + G.over.text);

    // 外部AIに相手役を任せているときは、指し方の説明と合法手を添える
    if (!G.over && G.pos.turn !== G.you) {
      var comSide = (G.pos.turn === S.SENTE) ? '先手' : '後手';
      lines.push('');
      lines.push('★ あなた（COM側 = ' + comSide + '）の手番です。次の一手を指してください。');
      lines.push('指し方: このフォルダの com-move.txt に指し手を1行だけ書く');
      lines.push('        （または POST http://localhost:8765/move に本文として送る）');
      lines.push('書き方: USI「7g7f」「7g7f+」「P*5e」／漢字「▲7六歩」「5二金打」／数字「77-76」 どれでも可');
      lines.push('指せる手（USI）: ' + S.legalMoves(G.pos).map(S.moveToUsi).join(' '));
    }
    lines.push('=================');
    return lines.join('\n');
  }

  /** 貼り付けられた文章から SFEN を1行拾う */
  function extractSfen(text) {
    var lines = String(text).split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/^\s*SFEN\s*[:：]\s*/i, '').trim();
      var m = line.match(/^((?:[+A-Za-z0-9]+\/){8}[+A-Za-z0-9]+)\s+([bw])(?:\s+(\S+))?(?:\s+(\d+))?$/);
      if (m) return m[1] + ' ' + m[2] + ' ' + (m[3] || '-') + ' ' + (m[4] || '1');
    }
    return null;
  }

  function openShare() {
    $('shareTitle').textContent = 'この局面をチャットに貼る';
    $('shareHint').textContent =
      '下の内容をコピーして、Claude とのチャットにそのまま貼り付けてください。盤面・持ち駒・手番・棋譜が全部入っています。';
    $('shareText').value = shareText();
    $('shareCopy').classList.remove('hidden');
    $('shareLoad').classList.add('hidden');
    $('shareModal').classList.remove('hidden');
    $('shareText').select();
  }

  function openLoad() {
    $('shareTitle').textContent = '局面を読み込む';
    $('shareHint').textContent =
      'チャットで教わった局面を貼り付けて「読み込む」を押すと、その局面から指せます。SFEN の行が入っていれば、まわりの文章はあってもかまいません。';
    $('shareText').value = '';
    $('shareCopy').classList.add('hidden');
    $('shareLoad').classList.remove('hidden');
    $('shareModal').classList.remove('hidden');
    $('shareText').focus();
  }

  function copyShare() {
    var ta = $('shareText');
    ta.select();
    var done = function () {
      $('shareCopy').textContent = 'コピーしました';
      setTimeout(function () { $('shareCopy').textContent = 'コピー'; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(ta.value).then(done, function () {
        try { document.execCommand('copy'); done(); } catch (e) {}
      });
    } else {
      try { document.execCommand('copy'); done(); } catch (e) {}
    }
  }

  function loadShare() {
    var sfen = extractSfen($('shareText').value);
    if (!sfen) {
      $('shareHint').textContent = '⚠ SFEN が見つかりませんでした。「lnsgkgsnl/1r5b1/… b - 1」のような行を含めてください。';
      return;
    }
    var pos;
    try { pos = S.fromSfen(sfen); } catch (e) { pos = null; }
    if (!pos || pos.kings[S.SENTE] < 0 || pos.kings[S.GOTE] < 0) {
      $('shareHint').textContent = '⚠ この局面は読み込めませんでした（玉が両方そろっている必要があります）。';
      return;
    }
    G.gen++;
    G.pos = pos;
    G.history = [];
    G.over = null;
    G.busy = false;
    clearSel();
    G.hilite = [];
    G.lastFrom = -1; G.lastTo = -1;
    G.counts = {};
    G.counts[posKey(G.pos)] = 1;
    $('shareModal').classList.add('hidden');
    render();
    saveGame();
    pushMsg({
      tone: 'ok', title: '局面を読み込みました',
      lines: ['ここから指せます。手番は<b>' + (G.pos.turn === S.SENTE ? 'あなた（先手）' : '相手（後手）') + '</b>です。',
        '棋譜はリセットされるので、この手より前には「待った」で戻れません。']
    });
    if (G.pos.turn !== G.you) { G.busy = true; render(); scheduleAi(); }
  }

  // ---- ローカル連携（bridge.py を動かしているときだけ有効）
  var bridge = { url: null };

  function detectBridge() {
    var base = (location.protocol === 'http:' || location.protocol === 'https:')
      ? location.origin : 'http://localhost:8765';
    fetch(base + '/bridge-ping', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) return;
      bridge.url = base;
      $('bridgeState').textContent = '● チャット連携ON（current-position.txt に自動保存）';
      pushBridge();
    }).catch(function () { /* 連携なしでも普通に使える */ });
  }

  function pushBridge() {
    if (!bridge.url) return;
    fetch(bridge.url + '/position', {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=utf-8' },
      body: shareText()
    }).catch(function () {});
  }

  // ------------------------------------------------------------ 外部AIとの対局
  /**
   * 相手の手番を外部（Claude Code / Cursor / ChatGPT など）に任せる。
   * 局面を書き出して、com-move.txt か POST /move に手が来るのを待つ。
   * 連携サーバーが無くても、画面の入力欄から手で入れれば指せる。
   */
  function waitForExternal() {
    G.busy = true;
    G.waiting = true;
    render();
    pushBridge();                       // COMの手番であることを含めて局面を出す
    extMsg('相手（外部AI）の指し手を待っています…', false);
    pollExternal(G.gen);
  }

  function pollExternal(gen) {
    if (gen !== G.gen || !G.waiting || !bridge.url) return;
    var q = '/move?since=' + G.moveSeq + '&sfen=' + encodeURIComponent(S.toSfen(G.pos));
    fetch(bridge.url + q, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (gen !== G.gen || !G.waiting) return;
        if (typeof d.seq === 'number') G.moveSeq = d.seq;
        if (d.move) applyExternalMove(d.move, d.source || '外部');
        else setTimeout(function () { pollExternal(gen); }, 1000);
      })
      .catch(function () {
        if (gen === G.gen && G.waiting) setTimeout(function () { pollExternal(gen); }, 2000);
      });
  }

  /** 外部から届いた指し手を盤に反映する。読めなければ理由を出して待ち続ける */
  function applyExternalMove(text, source) {
    if (G.over) return;
    if (G.pos.turn === G.you) { extMsg('いまはあなたの手番です。', true); return; }
    var r = S.parseMoveText(G.pos, text);
    if (r.move === null) {
      var why = {
        illegal: 'その手は指せません（ルール上の反則か、駒がありません）',
        ambiguous: '候補が複数あります → ' + r.candidates.join(' / ') + '（移動元を付けてください）',
        unreadable: '書き方が読み取れません'
      }[r.error] || '読み取れません';
      extMsg('「' + text + '」: ' + why, true);
      pushMsg({
        tone: 'bad', who: '外部AI', title: '指し手を受け付けられません',
        lines: [esc(String(text)) + ' — ' + esc(why), '正しい手が届くまで待っています。']
      });
      // ここで局面を再送すると、相手が同じ手を出し続けたときに
      // 送受信のループになるので、送らずに待つだけにする
      if (G.waiting) setTimeout(function (g) {
        return function () { pollExternal(g); };
      }(G.gen), 1500);
      return;
    }
    G.waiting = false;
    var kanji = applyMove(r.move);
    G.busy = false;
    render();
    animateOpponentMove(G.lastFrom, G.lastTo);
    saveGame();
    extMsg('相手が ' + kanji + ' と指しました（' + source + '）', false);
    pushMsg({ tone: 'ok', who: '相手（外部AI）', title: kanji, lines: ['受け取り元: ' + esc(source)] });
    if (checkEnd()) return;
    var notes = T.comment(G.pos, G.you === S.SENTE);
    if (notes.length > 1) pushMsg({ tone: 'warn', title: 'いまの局面', lines: notes.slice(1).map(esc) });
    refreshEval();
  }

  /**
   * 相手の指した駒を、移動元から移動先へ滑らせて見せる。
   * 盤は毎回作り直しているので、描画後に「移動先にある駒」を
   * いったん移動元の位置に置いてから、元の位置へ戻す形で動かす。
   */
  function animateOpponentMove(fromSq, toSq) {
    if (toSq === undefined || toSq < 0) return;
    var toCell = boardView.cells[boardView.at(toSq)];
    if (!toCell) return;

    // 指したマスを一瞬光らせる（駒が無い場合でも分かるように）
    toCell.classList.remove('just-moved');
    void toCell.offsetWidth;              // アニメーションをやり直させる
    toCell.classList.add('just-moved');

    var pc = toCell.querySelector('.pc');
    if (!pc) return;
    // 後手の駒は回転しているので、その指定を消さないようにする
    var base = pc.classList.contains('gote') ? ' rotate(180deg)' : '';
    pc.classList.add('moving');

    if (fromSq === undefined || fromSq < 0) {
      // 持ち駒を打った場合は、ふわっと現れる
      pc.style.transition = 'none';
      pc.style.transform = 'scale(.3)' + base;
      pc.style.opacity = '0';
      requestAnimationFrame(function () {
        pc.style.transition = 'transform .28s ease-out, opacity .28s ease-out';
        pc.style.transform = 'scale(1)' + base;
        pc.style.opacity = '1';
      });
    } else {
      var fromCell = boardView.cells[boardView.at(fromSq)];
      if (!fromCell) { pc.classList.remove('moving'); return; }
      var dx = fromCell.offsetLeft - toCell.offsetLeft;
      var dy = fromCell.offsetTop - toCell.offsetTop;
      pc.style.transition = 'none';
      pc.style.transform = 'translate(' + dx + 'px,' + dy + 'px)' + base;
      requestAnimationFrame(function () {
        pc.style.transition = 'transform .32s cubic-bezier(.2,.7,.3,1)';
        pc.style.transform = 'translate(0,0)' + base;
      });
    }

    // 終わったらインラインの指定を消して、ホバーなどの動きを元に戻す
    var done = function () {
      pc.style.transition = '';
      pc.style.transform = '';
      pc.style.opacity = '';
      pc.classList.remove('moving');
      pc.removeEventListener('transitionend', done);
    };
    pc.addEventListener('transitionend', done);
    setTimeout(done, 700);
  }

  function extMsg(text, isError) {
    var e = $('extState');
    if (!e) return;
    e.textContent = text || '';
    e.className = 'ext-state' + (isError ? ' err' : '');
  }

  /** 入力欄から相手の手を指す（ChatGPT の答えを貼り付ける用） */
  function submitManualMove() {
    var box = $('comMoveInput');
    var v = box.value.trim();
    if (!v) return;
    if (G.pos.turn === G.you) { extMsg('いまはあなたの手番です。', true); return; }
    applyExternalMove(v, '手入力');
    box.value = '';
  }

  /** 画面で選ばれている手合割・手番・強さで対局を始める */
  function startNewGame() {
    newGame(
      $('handicapSel').value,
      parseInt($('sideSel').value, 10) === S.GOTE ? S.GOTE : S.SENTE
    );
  }

  // ------------------------------------------------------------ サーバー解析
  /**
   * bridge.js のエンジンに局面を解析させる。
   * 返り値: { bestmove, candidates, depth } または null（使えないとき）
   * 使えない場合は呼び出し側が内蔵エンジンにフォールバックする。
   */
  function analyze(pos, opts) {
    if (!bridge.url) return Promise.resolve(null);
    opts = opts || {};
    return fetch(bridge.url + '/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sfen: S.toSfen(pos), ms: opts.ms, multipv: opts.multipv })
    }).then(function (r) {
      if (!r.ok) return null;
      return r.json();
    }).then(function (d) {
      return (d && !d.error && d.candidates) ? d : null;
    }).catch(function () { return null; });
  }

  /** 解析結果の1件を「手番側から見た点数」にそろえる */
  function cpOf(cand) {
    if (!cand) return null;
    if (typeof cand.mate === 'number') {
      // 詰みは大きな点数に置き換える（正なら手番側の勝ち）
      return cand.mate > 0 ? 30000 - cand.mate : -30000 - cand.mate;
    }
    return (typeof cand.score === 'number') ? cand.score : null;
  }

  /** USIの指し手文字列を、この局面の指し手に変換 */
  function usiToMove(pos, usi) {
    if (!usi) return null;
    var r = S.parseMoveText(pos, usi);
    return r.move;
  }

  /**
   * 講評用に「最善手との差」を求める。
   * サーバーが使えれば、指す前の局面（最善手＋点数）と指した後の局面（点数）を
   * 解析して差を取る。使えなければ内蔵エンジンに任せる（opts を空で返す）。
   */
  function reviewWithServer(before, move, gen) {
    if (!bridge.url) return Promise.resolve({ ms: 400 });
    var after = before.clone();
    S.doMove(after, move);
    return analyze(before, { ms: 500, multipv: 1 }).then(function (b) {
      if (!b || gen !== G.gen) return null;
      return analyze(after, { ms: 500, multipv: 1 }).then(function (a) {
        if (!a || gen !== G.gen) return null;
        var bestCp = cpOf(b.candidates[0]);
        // 指した後の点数は相手番から見た値なので反転する
        var afterCp = cpOf(a.candidates[0]);
        if (bestCp === null || afterCp === null) return null;
        return {
          lossCp: bestCp - (-afterCp),
          bestMove: usiToMove(before, b.bestmove),
          note: 'やねうら王の判定（深さ' + Math.min(b.depth, a.depth) + '）'
        };
      });
    }).then(function (r) { return r || { ms: 400 }; })
      .catch(function () { return { ms: 400 }; });
  }

  /** サーバーに形勢を問い合わせ、返ってきたら棋譜タブを描き直す */
  function refreshEval() {
    if (!bridge.url || G.over) return;
    var key = S.toSfen(G.pos), gen = G.gen;
    analyze(G.pos, { ms: 400, multipv: 1 }).then(function (d) {
      if (!d || gen !== G.gen || S.toSfen(G.pos) !== key) return;
      var cp = cpOf(d.candidates[0]);
      if (cp === null) return;
      // 手番側から見た点数 → 先手から見た点数
      evalCache = {
        key: key, depth: d.depth, from: 'サーバー',
        senteCp: (G.pos.turn === S.SENTE) ? cp : -cp
      };
      renderKifu();
    });
  }

  /** 画面を描き直す */
  function refresh() { render(); }

  function openSettings() {
    $('soundChk').checked = settings.sound;
    $('reviewChk').checked = settings.review;
    $('apiKeyInput').value = C.getKey();
    var sel = $('modelSel');
    clear(sel);
    C.MODELS.forEach(function (m) {
      var o = el('option', null, m.label);
      o.value = m.id;
      sel.appendChild(o);
    });
    sel.value = C.getModel();
    $('settingsModal').classList.remove('hidden');
  }

  function saveSettingsUI() {
    settings.sound = $('soundChk').checked;
    settings.review = $('reviewChk').checked;
    saveSettings();
    C.setKey($('apiKeyInput').value.trim());
    C.setModel($('modelSel').value);
    $('settingsModal').classList.add('hidden');
    refresh();
  }

  // ------------------------------------------------------------ 起動
  function init() {
    tutorPane = $('paneTutor');
    kifuPane = $('paneKifu');
    piecePane = $('panePieces');

    boardView = new BoardView($('board'), onSquare);

    // 手合割・強さ
    var hs = $('handicapSel');
    Object.keys(S.HANDICAPS).forEach(function (k) {
      var o = el('option', null, S.HANDICAPS[k].label);
      o.value = k;
      hs.appendChild(o);
    });
    if (!loadGame()) {
      G.pos = S.newGame('even');
      G.counts[posKey(G.pos)] = 1;
    }
    hs.value = G.handicap;
    $('sideSel').value = String(G.you);
    $('externalRow').classList.remove('hidden');
    applyOrientation();

    // イベント
    $('panelTabs').addEventListener('click', function (e) {
      var p = e.target.dataset && e.target.dataset.pane;
      if (!p) return;
      Array.prototype.forEach.call($('panelTabs').children, function (b) {
        b.classList.toggle('on', b.dataset.pane === p);
      });
      [['tutor', tutorPane], ['kifu', kifuPane], ['pieces', piecePane]].forEach(function (o) {
        o[1].classList.toggle('on', o[0] === p);
      });
      if (p === 'pieces') renderPieceGuide(piecePane);
    });

    $('newGameBtn').addEventListener('click', startNewGame);
    $('undoBtn').addEventListener('click', undoMove);
    $('hintBtn').addEventListener('click', showHint);
    $('mateBtn').addEventListener('click', mateCheck);
    $('askBtn').addEventListener('click', askClaude);
    $('resignBtn').addEventListener('click', function () {
      if (G.over) return;
      finish('lose', 'あなたの投了で終局しました。');
    });

    $('comMoveBtn').addEventListener('click', submitManualMove);
    $('comMoveInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') submitManualMove();
    });

    $('shareBtn').addEventListener('click', openShare);
    $('loadBtn').addEventListener('click', openLoad);
    $('shareCopy').addEventListener('click', copyShare);
    $('shareLoad').addEventListener('click', loadShare);
    $('shareClose').addEventListener('click', function () { $('shareModal').classList.add('hidden'); });

    $('settingsBtn').addEventListener('click', openSettings);
    $('settingsSave').addEventListener('click', saveSettingsUI);
    $('settingsClose').addEventListener('click', function () { $('settingsModal').classList.add('hidden'); });
    $('overClose').addEventListener('click', function () { $('overModal').classList.add('hidden'); });
    $('overNew').addEventListener('click', function () {
      $('overModal').classList.add('hidden');
      startNewGame();
    });

    renderPieceGuide(piecePane);
    detectBridge();
    render();
    pushMsg({
      tone: 'ok', title: 'ようこそ',
      lines: [
        'このアプリでは、将棋を<b>指しながら</b>覚えられます。ルールを知らなくても大丈夫です。',
        'まずは上の「レッスン」で駒の動きを見てから、「対局」で八枚落ちあたりから始めるのがおすすめです。'
      ]
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
