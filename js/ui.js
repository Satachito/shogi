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
    this.root = root;
    this.cells = [];
    this.stars = {};
    clear(root);
    for (var sq = 0; sq < 81; sq++) {
      var d = el('div', 'sq');
      d.dataset.sq = sq;
      var r = S.rowOf(sq), c = S.colOf(sq);
      if ((r === 2 || r === 5) && (c === 2 || c === 5)) { d.classList.add('star'); this.stars[sq] = 1; }
      root.appendChild(d);
      this.cells.push(d);
    }
    if (onClick) {
      root.addEventListener('click', function (e) {
        var cell = e.target.closest ? e.target.closest('.sq') : null;
        if (cell) onClick(parseInt(cell.dataset.sq, 10));
      });
    }
  }

  /**
   * st: { targets:{sq:true}, selected, lastFrom, lastTo, checkSq, hilite:[sq], mover }
   */
  BoardView.prototype.render = function (pos, st) {
    st = st || {};
    var targets = st.targets || {};
    for (var sq = 0; sq < 81; sq++) {
      var cell = this.cells[sq];
      var cls = 'sq';
      if (this.stars[sq]) cls += ' star';
      if (sq === st.lastFrom || sq === st.lastTo) cls += ' last';
      if (st.hilite && st.hilite.indexOf(sq) >= 0) cls += ' hilite';
      if (sq === st.checkSq) cls += ' check';
      if (sq === st.selected) cls += ' selected';
      var p = pos.board[sq];
      if (targets[sq]) cls += (p !== S.EMPTY) ? ' target capture' : ' target';
      cell.className = cls;
      clear(cell);
      if (p !== S.EMPTY) {
        var owner = S.ownerOf(p);
        var d = el('div', 'pc' + (owner === S.GOTE ? ' gote' : '') +
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
    counts: {}
  };
  var YOU = S.SENTE;

  function posKey(pos) { return S.toSfen(pos).replace(/ \d+$/, ''); }

  function newGame(handicap, level) {
    G.handicap = handicap || G.handicap;
    G.level = (level === undefined) ? G.level : level;
    G.pos = S.newGame(G.handicap);
    G.history = [];
    G.over = null;
    G.busy = false;
    G.sel = -1; G.dropType = -1; G.targets = {}; G.hilite = [];
    G.lastFrom = -1; G.lastTo = -1;
    G.counts = {};
    G.counts[posKey(G.pos)] = 1;
    clear(tutorPane);
    var h = S.HANDICAPS[G.handicap];
    pushMsg({
      tone: 'ok', title: h.label + 'で対局開始',
      lines: [
        'あなたは<b>先手（下側）</b>です。駒をクリックすると、動けるマスが緑の丸で光ります。',
        '迷ったら「ヒント」、詰みがありそうなら「詰みチェック」を押してください。'
      ]
    });
    render();
    saveGame();
  }

  function saveGame() {
    try {
      localStorage.setItem('shogi.game', JSON.stringify({
        sfen: S.toSfen(G.pos),
        handicap: G.handicap,
        level: G.level,
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
      G.level = (d.level === undefined) ? 2 : d.level;
      G.over = d.over || null;
      G.history = (d.kifu || []).map(function (k) { return { kanji: k, undo: null }; });
      G.counts = {};
      G.counts[posKey(G.pos)] = 1;
      return true;
    } catch (e) { return false; }
  }

  function myTurn() { return !G.over && !G.busy && G.pos.turn === YOU; }

  function render() {
    var check = S.inCheck(G.pos, G.pos.turn) ? G.pos.kings[G.pos.turn] : -1;
    boardView.render(G.pos, {
      targets: G.targets,
      selected: G.sel,
      lastFrom: G.lastFrom,
      lastTo: G.lastTo,
      checkSq: check,
      hilite: G.hilite,
      mover: myTurn() ? YOU : -1
    });
    renderHand($('handGote'), G.pos, S.GOTE, {});
    renderHand($('handSente'), G.pos, S.SENTE, {
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
    if (G.busy) { s.textContent = '相手が考えています…'; s.classList.add('think'); return; }
    var parts = [(G.history.length + 1) + '手目'];
    parts.push(G.pos.turn === YOU ? 'あなたの番' : '相手の番');
    if (S.inCheck(G.pos, G.pos.turn)) {
      parts.push('王手！');
      s.classList.add('alert');
    }
    s.textContent = parts.join(' ／ ');
  }

  function renderKifu() {
    clear(kifuPane);
    var sc = AI.evaluate(G.pos);
    var pct = Math.max(2, Math.min(98, 50 + sc / 40));
    var wrap = el('div');
    wrap.appendChild(el('p', null, T.describeScore(sc)));
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
    if (p !== S.EMPTY && S.ownerOf(p) === YOU) {
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
    soon(function () {
      if (settings.review) {
        var rv = T.reviewMove(before, m, { ms: 400 });
        pushMsg({ tone: rv.tone, title: rv.title, lines: [ '<span class="mv">' + esc(rv.kanji) + '</span>' ].concat(rv.lines.map(esc)) });
      }
      soon(aiTurn);
    });
  }

  function aiTurn() {
    if (G.over) { G.busy = false; render(); return; }
    var res = AI.think(G.pos, { level: G.level });
    if (!res.move) { G.busy = false; checkEnd(); return; }
    applyMove(res.move);
    G.busy = false;
    render();
    saveGame();
    if (checkEnd()) return;
    // 王手されている・大駒が危ないなど、気づいてほしいことだけ知らせる
    var notes = T.comment(G.pos);
    if (notes.length > 1) {
      pushMsg({ tone: 'warn', title: 'いまの局面', lines: notes.slice(1).map(esc) });
    }
  }

  function checkEnd() {
    if (G.over) return true;
    if (S.legalMoves(G.pos).length === 0) {
      var loser = G.pos.turn;
      finish(loser === YOU ? 'lose' : 'win',
        loser === YOU ? 'あなたの負けです（詰み）' : 'あなたの勝ちです！（詰み）');
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
    if (G.busy) return;
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
      if (G.pos.turn === YOU) break;
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
    soon(function () {
      var h = T.hint(G.pos);
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
    soon(function () {
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

  // ------------------------------------------------------------ レッスン
  var lessonIndex = 0;

  function renderLessonNav() {
    var nav = $('lessonNav');
    clear(nav);
    T.LESSONS.forEach(function (l, i) {
      var b = el('button', i === lessonIndex ? 'on' : null);
      b.appendChild(document.createTextNode(l.title));
      b.appendChild(el('small', null, l.summary));
      b.addEventListener('click', function () { lessonIndex = i; renderLesson(); });
      nav.appendChild(b);
    });
  }

  function renderLesson() {
    renderLessonNav();
    var body = $('lessonBody');
    clear(body);
    var lesson = T.LESSONS[lessonIndex];
    body.appendChild(el('h2', null, lesson.title));

    lesson.blocks.forEach(function (b) {
      if (b.t === 'p') {
        var p = el('p'); p.innerHTML = b.text; body.appendChild(p);
      } else if (b.t === 'ul') {
        var ul = el('ul');
        b.items.forEach(function (it) { var li = el('li'); li.innerHTML = it; ul.appendChild(li); });
        body.appendChild(ul);
      } else if (b.t === 'note') {
        var n = el('div', 'note'); n.innerHTML = b.text; body.appendChild(n);
      } else if (b.t === 'table') {
        var tbl = el('table', 'value-table');
        b.rows.forEach(function (row) {
          var tr = el('tr');
          row.forEach(function (cell) { tr.appendChild(el('td', null, cell)); });
          tbl.appendChild(tr);
        });
        body.appendChild(tbl);
      } else if (b.t === 'pieces') {
        var box = el('div');
        renderPieceGuide(box);
        body.appendChild(box);
      } else if (b.t === 'board') {
        body.appendChild(demoBoard(b));
      }
      if (b.t === 'note' || b.t === 'board') body.appendChild(el('hr'));
    });
  }

  /** レッスン中の触れる盤面 */
  function demoBoard(spec) {
    var wrap = el('div', 'demo');
    var pos = S.fromSfen(spec.sfen);
    var holder = el('div', 'demo-board-wrap');
    var frame = el('div', 'board-frame');
    var boardEl = el('div', 'board');
    frame.appendChild(boardEl);
    holder.appendChild(frame);

    var state = { sel: -1, dropType: -1, targets: {} };
    var handRoot = null;
    var view = new BoardView(boardEl, function (sq) {
      if (state.targets[sq]) { state.sel = -1; state.dropType = -1; state.targets = {}; draw(); return; }
      var p = pos.board[sq];
      state.targets = {}; state.dropType = -1;
      if (p !== S.EMPTY && S.ownerOf(p) === pos.turn) {
        state.sel = sq;
        S.movesFrom(pos, sq).forEach(function (m) { state.targets[S.mvTo(m)] = true; });
      } else { state.sel = -1; }
      draw();
    });

    function draw() {
      view.render(pos, {
        targets: state.targets, selected: state.sel, mover: pos.turn
      });
      if (handRoot) {
        renderHand(handRoot, pos, pos.turn, {
          selected: state.dropType,
          onPick: function (t) {
            state.sel = -1; state.targets = {};
            state.dropType = (state.dropType === t) ? -1 : t;
            if (state.dropType >= 0) {
              S.dropsOf(pos, t).forEach(function (m) { state.targets[S.mvTo(m)] = true; });
            }
            draw();
          }
        });
      }
    }

    if (spec.hand) {
      handRoot = el('div', 'hand hand-sente');
      wrap.appendChild(holder);
      wrap.appendChild(handRoot);
    } else {
      wrap.appendChild(holder);
    }
    draw();

    if (spec.from) {
      var sq = S.parseSqName(spec.from);
      state.sel = sq;
      S.movesFrom(pos, sq).forEach(function (m) { state.targets[S.mvTo(m)] = true; });
      draw();
    }
    if (spec.caption) wrap.appendChild(el('p', 'caption', spec.caption));
    return wrap;
  }

  // ------------------------------------------------------------ 詰将棋
  var TS = { index: 0, pos: null, left: 0, stack: [], done: false, sel: -1, dropType: -1, targets: {} };

  function loadProblem(i) {
    TS.index = (i + T.PROBLEMS.length) % T.PROBLEMS.length;
    var p = T.PROBLEMS[TS.index];
    TS.pos = S.fromSfen(p.sfen);
    TS.left = p.moves;
    TS.stack = [];
    TS.done = false;
    clear(tutorPane);
    pushMsg({
      tone: 'ok',
      title: '第' + (TS.index + 1) + '問（' + p.moves + '手詰）',
      lines: [
        'あなたは先手です。' + p.moves + '手で相手の玉を詰ませてください。',
        '王手の連続で、逃げ道をなくすのがコツです。'
      ]
    });
    $('tsumeLabel').textContent = '第' + (TS.index + 1) + '問 / 全' + T.PROBLEMS.length + '問（' + p.moves + '手詰）';
    renderTsume();
  }

  function renderTsume() {
    var check = S.inCheck(TS.pos, TS.pos.turn) ? TS.pos.kings[TS.pos.turn] : -1;
    boardView.render(TS.pos, {
      targets: TS.targets || {},
      selected: TS.sel === undefined ? -1 : TS.sel,
      checkSq: check,
      hilite: [],
      mover: (!TS.done && TS.pos.turn === S.SENTE) ? S.SENTE : -1
    });
    renderHand($('handGote'), TS.pos, S.GOTE, {});
    renderHand($('handSente'), TS.pos, S.SENTE, {
      selected: TS.dropType === undefined ? -1 : TS.dropType,
      onPick: (!TS.done && TS.pos.turn === S.SENTE) ? tsumePickDrop : null
    });
    var s = $('status');
    s.className = 'status';
    s.textContent = TS.done ? '正解！ 次の問題へどうぞ。' : ('あと' + TS.left + '手で詰ませてください。');
    if (TS.done) s.classList.add('think');
    clear(kifuPane);
    kifuPane.appendChild(el('p', null, '詰将棋モードです。「対局」タブに戻ると、指しかけの対局が続きから再開できます。'));
  }

  function tsumeClear() { TS.sel = -1; TS.dropType = -1; TS.targets = {}; }

  function tsumePickDrop(type) {
    if (TS.done) return;
    if (TS.dropType === type) { tsumeClear(); renderTsume(); return; }
    tsumeClear();
    TS.dropType = type;
    S.dropsOf(TS.pos, type).forEach(function (m) {
      var to = S.mvTo(m);
      (TS.targets[to] = TS.targets[to] || []).push(m);
    });
    renderTsume();
  }

  function onTsumeSquare(sq) {
    if (TS.done || TS.pos.turn !== S.SENTE) return;
    if (TS.targets && TS.targets[sq]) { tsumeChoose(TS.targets[sq]); return; }
    var p = TS.pos.board[sq];
    tsumeClear();
    if (p !== S.EMPTY && S.ownerOf(p) === S.SENTE) {
      TS.sel = sq;
      S.movesFrom(TS.pos, sq).forEach(function (m) {
        var to = S.mvTo(m);
        (TS.targets[to] = TS.targets[to] || []).push(m);
      });
    }
    renderTsume();
  }

  function tsumeChoose(moves) {
    if (moves.length === 1) { tsumePlay(moves[0]); return; }
    var prom = null, plain = null;
    moves.forEach(function (m) { if (S.mvProm(m)) prom = m; else plain = m; });
    if (prom === null || plain === null) { tsumePlay(moves[0]); return; }
    $('promoteText').textContent = '成りますか？';
    $('promoteModal').classList.remove('hidden');
    $('promoteYes').onclick = function () { $('promoteModal').classList.add('hidden'); tsumePlay(prom); };
    $('promoteNo').onclick = function () { $('promoteModal').classList.add('hidden'); tsumePlay(plain); };
  }

  function tsumePlay(m) {
    var kanji = S.moveToKanji(TS.pos, m);
    tsumeClear();
    var undo = S.doMove(TS.pos, m);
    TS.stack.push(undo);
    click(340);

    // 詰んだ？
    if (S.legalMoves(TS.pos).length === 0 && S.inCheck(TS.pos, TS.pos.turn)) {
      TS.done = true;
      renderTsume();
      pushMsg({ tone: 'great', title: '正解！', lines: [esc(kanji) + ' まで。お見事です。'] });
      click(660);
      return;
    }
    // 王手になっていない
    if (!S.inCheck(TS.pos, TS.pos.turn)) {
      S.undoMove(TS.pos, TS.stack.pop());
      renderTsume();
      pushMsg({ tone: 'warn', title: 'この手では詰みません', lines: [esc(kanji) + ' は王手になっていません。詰将棋は王手の連続で追いつめます。'] });
      return;
    }
    // 王手だが、この後もう詰まない
    var rest = TS.left - 1;
    if (rest <= 0 || !stillMate(rest)) {
      S.undoMove(TS.pos, TS.stack.pop());
      renderTsume();
      pushMsg({ tone: 'warn', title: '惜しい！', lines: [esc(kanji) + ' は王手ですが、これでは逃げられてしまいます。ほかの手を探しましょう。'] });
      return;
    }
    // 相手の応手
    var def = AI.think(TS.pos, { level: 2, noise: 0, useBook: false }).move;
    var defKanji = S.moveToKanji(TS.pos, def);
    TS.stack.push(S.doMove(TS.pos, def));
    TS.left = rest - 1;
    renderTsume();
    pushMsg({ tone: 'ok', title: '相手の応手', lines: [esc(kanji) + ' に対して ' + esc(defKanji) + '。あと' + TS.left + '手です。'] });
  }

  /** 相手の手番になった局面から、残り n 手で詰むか */
  function stillMate(n) {
    var moves = S.legalMoves(TS.pos);
    if (!moves.length) return true;
    for (var i = 0; i < moves.length; i++) {
      var u = S.doMove(TS.pos, moves[i]);
      var ok = S.findMate(TS.pos, n - 1) !== null;
      S.undoMove(TS.pos, u);
      if (!ok) return false;
    }
    return true;
  }

  // ------------------------------------------------------------ 画面切り替え
  var view = 'play';

  function setView(v) {
    view = v;
    Array.prototype.forEach.call($('viewTabs').children, function (b) {
      b.classList.toggle('on', b.dataset.view === v);
    });
    $('gameLayout').classList.toggle('hidden', v === 'lesson');
    $('lessonLayout').classList.toggle('hidden', v !== 'lesson');
    $('playControls').classList.toggle('hidden', v !== 'play');
    $('tsumeControls').classList.toggle('hidden', v !== 'tsume');
    if (v === 'lesson') renderLesson();
    if (v === 'tsume') { tsumeClear(); loadProblem(TS.index); }
    if (v === 'play') { clear(tutorPane); render(); pushMsg({ tone: 'ok', title: '対局にもどりました', lines: ['続きからどうぞ。'] }); }
  }

  // ------------------------------------------------------------ 設定画面
  // ------------------------------------------------------------ 局面の受け渡し
  /** チャットに貼れるテキストにまとめる */
  function shareText() {
    var lines = [];
    lines.push('=== 将棋 局面 ===');
    lines.push('手合割: ' + S.HANDICAPS[G.handicap].label +
      ' / ' + (G.history.length + 1) + '手目' +
      ' / あなた=先手（下側・v なしの駒）');
    lines.push(S.toText(G.pos));
    lines.push('SFEN: ' + S.toSfen(G.pos));
    if (G.history.length) {
      lines.push('棋譜: ' + G.history.map(function (h) { return h.kanji; }).join(' '));
    }
    if (G.over) lines.push('結果: ' + G.over.text);
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
    if (G.pos.turn !== YOU) { G.busy = true; render(); soon(aiTurn); }
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

  /** いま表示している画面を描き直す */
  function refresh() {
    if (view === 'tsume') renderTsume();
    else if (view === 'play') render();
  }

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

    // 盤ラベル
    var fl = $('fileLabels');
    for (var c = 0; c < 9; c++) fl.appendChild(el('span', null, String(9 - c)));
    var rl = $('rankLabels');
    for (var r = 0; r < 9; r++) rl.appendChild(el('span', null, S.RANK_KANJI[r]));

    boardView = new BoardView($('board'), function (sq) {
      if (view === 'play') onSquare(sq);
      else if (view === 'tsume') onTsumeSquare(sq);
    });

    // 手合割・強さ
    var hs = $('handicapSel');
    Object.keys(S.HANDICAPS).forEach(function (k) {
      var o = el('option', null, S.HANDICAPS[k].label);
      o.value = k;
      hs.appendChild(o);
    });
    var ls = $('levelSel');
    AI.LEVELS.forEach(function (lv, i) {
      var o = el('option', null, lv.label);
      o.value = i;
      ls.appendChild(o);
    });

    if (!loadGame()) {
      G.pos = S.newGame('even');
      G.counts[posKey(G.pos)] = 1;
    }
    hs.value = G.handicap;
    ls.value = G.level;

    // イベント
    $('viewTabs').addEventListener('click', function (e) {
      if (e.target.dataset && e.target.dataset.view) setView(e.target.dataset.view);
    });
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

    $('newGameBtn').addEventListener('click', function () {
      newGame($('handicapSel').value, parseInt($('levelSel').value, 10));
    });
    $('undoBtn').addEventListener('click', undoMove);
    $('hintBtn').addEventListener('click', showHint);
    $('mateBtn').addEventListener('click', mateCheck);
    $('askBtn').addEventListener('click', askClaude);
    $('resignBtn').addEventListener('click', function () {
      if (G.over) return;
      finish('lose', 'あなたの投了で終局しました。');
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
      newGame($('handicapSel').value, parseInt($('levelSel').value, 10));
    });

    $('tsumePrev').addEventListener('click', function () { loadProblem(TS.index - 1); });
    $('tsumeNext').addEventListener('click', function () { loadProblem(TS.index + 1); });
    $('tsumeReset').addEventListener('click', function () { loadProblem(TS.index); });
    $('tsumeHint').addEventListener('click', function () {
      pushMsg({ tone: 'ok', title: 'ヒント', lines: [esc(T.PROBLEMS[TS.index].hint)] });
    });
    $('tsumeAnswer').addEventListener('click', function () {
      var p = T.PROBLEMS[TS.index];
      var line = T.solveLine(S.fromSfen(p.sfen), p.moves);
      pushMsg({
        tone: 'ok', title: '答え（' + p.theme + '）',
        lines: [esc(line.join('　')) + ' まで' + p.moves + '手詰。']
      });
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
