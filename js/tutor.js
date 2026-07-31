/*
 * tutor.js — 「先生」役。指し手の講評・ヒント・形勢を日本語にする。
 *
 * ここに思考ルーチンは無い。手の良し悪しと最善手は bridge.js 経由で
 * やねうら王に聞き、このファイルはそれを言葉にするだけ。
 * 盤の事実（詰み・王手・タダで取られる駒）だけは engine.js で自分で調べる。
 */
;(function (root, factory) {
  var api = factory(typeof require === 'function' ? require('./engine.js') : root.Shogi);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ShogiTutor = api;
})(typeof window !== 'undefined' ? window : globalThis, function (S) {
  'use strict';

  // ====================================================== 駒の解説
  var PIECE_GUIDE = [
    {
      type: S.P, title: '歩兵（ふ）', reading: 'ふ',
      move: '前に1マスだけ。',
      text: '数が多いいちばん弱い駒ですが、将棋でいちばん大事な駒とも言われます。前にしか進めないので、突いた歩は戻れません。',
      promo: '成ると「と金」。金と同じ動きになり、取られても相手の手には「歩」しか渡りません。とても得な成り駒です。',
      tip: '同じ筋（縦の列）に自分の歩が2枚あると「二歩」で反則負け。持ち駒の歩を打つときは必ず確認しましょう。'
    },
    {
      type: S.L, title: '香車（きょうしゃ）', reading: 'きょう',
      move: '前へ何マスでも。ただし後戻りはできません。',
      text: '「槍」とも呼ばれます。前方の駒を串刺しにするように狙えますが、横や後ろには効きません。',
      promo: '成ると「成香」。金と同じ動きになります。',
      tip: '相手の飛車や玉の下から打つと強力です。'
    },
    {
      type: S.N, title: '桂馬（けいま）', reading: 'けい',
      move: '前に2マス＋左右に1マス、の位置へ。間に駒があっても飛び越えられます。',
      text: '将棋で唯一、駒を飛び越えられる駒。ただし前の2か所にしか跳べないので、跳ねたら戻れません。',
      promo: '成ると「成桂」。金と同じ動きになります。',
      tip: '「桂馬の高跳び歩の餌食」。跳ねた桂は歩で取られやすいので、跳ねる前によく考えて。'
    },
    {
      type: S.S, title: '銀将（ぎん）', reading: 'ぎん',
      move: '前と、斜め4方向。真横と真後ろには行けません。',
      text: '斜め後ろに引けるので、前に出ても戻ってこられます。攻めにも守りにも使える便利な駒です。',
      promo: '成ると「成銀」。金と同じ動きになります。',
      tip: '守りでは成らずに使うことも多い駒。金と組ませると堅い囲いになります。'
    },
    {
      type: S.G, title: '金将（きん）', reading: 'きん',
      move: '前・横・後ろと斜め前。斜め後ろだけ行けません。',
      text: '守りの主役。玉のそばに置くと非常に堅くなります。成れない駒のひとつです。',
      promo: '金は成れません。',
      tip: '「金は引く手に好手あり」。前に出すより、玉のそばに引きつける手のほうが有効なことが多いです。'
    },
    {
      type: S.B, title: '角行（かく）', reading: 'かく',
      move: '斜めに何マスでも。',
      text: '飛車と並ぶ大駒。斜めにしか動けないので、同じ色のマスしか行けません。序盤は自分の歩に道を塞がれています。',
      promo: '成ると「竜馬（馬）」。斜めの動きに加えて、前後左右に1マス動けるようになります。',
      tip: '「馬は自陣に置け」。守りに使う馬はとても堅い駒になります。'
    },
    {
      type: S.R, title: '飛車（ひしゃ）', reading: 'ひしゃ',
      move: '縦と横に何マスでも。',
      text: 'いちばん強い駒。1枚しかないので、簡単に取られないように大事に使いましょう。',
      promo: '成ると「竜王（竜）」。縦横の動きに加えて、斜めに1マス動けるようになります。',
      tip: '「大駒は近づけて受けよ」。飛車や角に狙われたら、離れて逃げるより近くに駒を置くほうが有効なことがあります。'
    },
    {
      type: S.K, title: '王将・玉将（おう・ぎょく）', reading: 'おう',
      move: '周囲8方向へ1マスずつ。',
      text: 'この駒を詰ませたら勝ち、詰まされたら負け。取られる手（自殺手）は指せません。',
      promo: '玉は成れません。',
      tip: '「玉の早逃げ八手の得」。危なくなる前に安全な場所へ移しておきましょう。'
    }
  ];

  // ====================================================== レッスン

  /** 形勢を言葉で */
  /**
   * 形勢を日本語にする。
   * @param senteScore 先手から見た点数
   * @param youSente   あなたが先手か（false なら符号を反転して読む）
   */
  function describeScore(senteScore, youSente) {
    var mine = (youSente === false) ? -senteScore : senteScore;
    var a = Math.abs(mine);
    var who = mine > 0 ? 'あなた' : '相手';
    if (a < 250) return '形勢は互角です。';
    if (a < 700) return who + 'が少し良さそうです。';
    if (a < 1600) return who + 'が有利です。';
    if (a < 4000) return who + 'が優勢です。';
    return who + 'の勝勢です。';
  }

  /** 取られそうな自分の駒を探す */
  function findHanging(pos, owner, minLoss) {
    var out = [];
    for (var sq = 0; sq < 81; sq++) {
      var p = pos.board[sq];
      if (p === S.EMPTY || S.ownerOf(p) !== owner) continue;
      var loss = S.hangingLoss(pos, sq);
      if (loss >= (minLoss || 300)) out.push({ sq: sq, piece: p, loss: loss });
    }
    out.sort(function (a, b) { return b.loss - a.loss; });
    return out;
  }

  /** ただで取れる相手の駒 */
  function findFreeCaptures(pos) {
    var res = [], moves = S.legalMoves(pos);
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i], to = S.mvTo(m);
      var victim = pos.board[to];
      if (victim === S.EMPTY) continue;
      var u = S.doMove(pos, m);
      var back = S.hangingLoss(pos, to);
      S.undoMove(pos, u);
      var gain = S.valueOf(victim) - back;
      if (gain >= 300) res.push({ move: m, gain: gain, victim: victim });
    }
    res.sort(function (a, b) { return b.gain - a.gain; });
    return res;
  }

  /** その手が何をする手なのかを一言で */
  function describeMove(pos, move) {
    var to = S.mvTo(move);
    var victim = pos.board[to];
    var parts = [];
    if (victim !== S.EMPTY) parts.push(S.nameOf(victim) + 'を取る');
    if (S.mvProm(move)) parts.push('成る');
    if (S.mvIsDrop(move)) parts.push('持ち駒を打つ');
    var after = pos.clone();
    S.doMove(after, move);
    if (S.inCheck(after, after.turn)) parts.unshift('王手');
    if (!parts.length) {
      var p = S.mvIsDrop(move) ? S.EMPTY : pos.board[S.mvFrom(move)];
      if (p !== S.EMPTY && S.typeOf(p) === S.K) parts.push('玉を安全な場所へ寄せる');
      else if (p !== S.EMPTY && (S.typeOf(p) === S.G || S.typeOf(p) === S.S)) parts.push('守りを固める');
      else if (p !== S.EMPTY && S.typeOf(p) === S.P) parts.push('歩を伸ばして道を作る');
      else parts.push('駒を良い位置に動かす');
    }
    return parts.join('・');
  }

  /**
   * 学習者の指し手を講評する。
   *  before: 指す前の局面（複製して使う）
   *  move  : 指した手
   */
  function reviewMove(before, move, opts) {
    opts = opts || {};
    var mover = before.turn;
    var pos = before.clone();
    var to = S.mvTo(move);
    var victim = pos.board[to];
    var kanji = S.moveToKanji(pos, move);

    var after = pos.clone();
    S.doMove(after, move);

    var res = { kanji: kanji, tone: 'ok', title: '', lines: [] };

    // 詰ませた
    if (S.inCheck(after, after.turn) && S.isCheckmate(after)) {
      res.tone = 'great';
      res.title = '詰みです！';
      res.lines.push(kanji + 'で詰み。お見事でした。');
      return res;
    }

    // 何をした手か
    if (victim !== S.EMPTY) res.lines.push(S.nameOf(victim) + 'を取りました。');
    if (S.inCheck(after, after.turn)) res.lines.push('王手です。');

    // 指した駒がタダで取られないか
    var hangLoss = S.hangingLoss(after, to);
    if (hangLoss >= 300) {
      var moved = after.board[to];
      res.lines.push('注意：' + S.sqName(to) + 'の' + S.nameOf(moved) + 'は、このままだと取られてしまいます。');
    }

    // 良し悪しはエンジンの点数（opts.lossCp）だけで決める。
    // 無いときは、憶測でほめたり叱ったりしない
    if (typeof opts.lossCp !== 'number') {
      res.title = '指しました';
      if (!res.lines.length) res.lines.push(describeMove(pos, move) + '手ですね。');
      res.lines.push('手の良し悪しは bridge.js のエンジンが判定します（いまは繋がっていません）。');
      return res;
    }
    var loss = opts.lossCp;
    var bestMove = (typeof opts.bestMove === 'number') ? opts.bestMove : null;

    if (loss < 120) {
      res.tone = 'great';
      res.title = 'いい手です！';
    } else if (loss < 350) {
      res.tone = 'ok';
      res.title = '悪くありません';
    } else if (loss < 900) {
      res.tone = 'warn';
      res.title = 'もう少し良い手がありました';
    } else {
      res.tone = 'bad';
      res.title = '大きな見落としかもしれません';
    }

    if (loss >= 350 && bestMove !== null) {
      res.lines.push('たとえば ' + S.moveToKanji(pos, bestMove) + ' なら、' +
        describeMove(pos, bestMove) + '手でした。');
    }
    if (loss < 120 && !res.lines.length) {
      res.lines.push(describeMove(pos, move) + '手ですね。');
    }
    return res;
  }

  /**
   * 次の一手のヒント。
   * 返り値: { move, title, text, urgent }
   */
  /**
   * ヒント。opts.bestMove（外部エンジンの最善手）が渡されたときは、
   * **必ずその手を返す**。内蔵エンジンは、それが無いときの代用にしか使わない。
   * 局面の様子（詰み・王手・駒の取り合い）は、その手を説明する言葉に使う。
   */
  function hint(pos, opts) {
    opts = opts || {};
    var me = pos.turn;
    var given = (typeof opts.bestMove === 'number') ? opts.bestMove : null;

    // 1. 詰みがあるか
    var mate1 = S.findMate(pos, 1);
    if (mate1) {
      return { move: given !== null ? given : mate1, title: '詰みがあります！', urgent: true,
        text: '相手の玉を詰ませる手が1手あります。玉の逃げ道と、味方の駒の支えを確認してみてください。' };
    }
    if (opts.mateIn > 0) {
      return { move: given, title: opts.mateIn + '手で詰みます！', urgent: true,
        text: '王手を続けて逃げ道を消していけば詰みます。まずは玉の退路を狭める王手から。' };
    }
    var mate3 = given === null ? S.findMate(pos, 3) : null;
    if (mate3) {
      return { move: mate3, title: '3手で詰みます！', urgent: true,
        text: '王手を続けて逃げ道を消していけば詰みます。まずは玉の退路を狭める王手から。' };
    }

    // 2. 王手されている
    if (S.inCheck(pos, me)) {
      return { move: given, title: 'まず王手を受けましょう', urgent: true,
        text: '「逃げる」「取る」「合駒する」の3つのどれかで王手を解消します。解消できないと負けです。' };
    }

    // 3. タダで取れる駒（エンジンがそれを勧めているときだけ「取れます」と言う）
    var free = findFreeCaptures(pos);
    if (free.length && free[0].gain >= 400 &&
        (given === null || S.mvTo(given) === S.mvTo(free[0].move))) {
      return { move: given !== null ? given : free[0].move, title: 'タダで取れる駒があります',
        text: S.nameOf(free[0].victim) + 'が取れます。取り返される心配もありません。' };
    }

    // 4. タダで取られそうな駒
    var hang = findHanging(pos, me, 400);
    if (hang.length) {
      return { move: given, title: '取られそうな駒があります',
        text: S.sqName(hang[0].sq) + 'の' + S.nameOf(hang[0].piece) +
          'が狙われています。逃げるか、ひも（守り）を付けるか、取り返せる形にしましょう。' };
    }

    // 5. ふつうの局面での有力手
    if (given === null) {
      return { move: null, title: 'ヒントを出せません',
        text: 'bridge.js を起動すると、やねうら王がこの局面の最善手を教えてくれます。' };
    }
    var title = pos.ply < 14 ? '序盤の組み立て' : '有力な手';
    var text = describeMove(pos, given) + '手です。';
    if (pos.ply < 14) {
      text += ' 序盤は「大駒の道を開ける」「玉を囲う」「攻めの形を作る」の3つを意識しましょう。';
    }
    return { move: given, title: title, text: text };
  }

  /** 局面で気をつけることの短い一言（手番の人へ）。形勢は形勢バーが出す */
  function comment(pos) {
    var lines = [];
    if (S.inCheck(pos, pos.turn)) {
      lines.push('王手がかかっています。受けなければいけません。');
    } else {
      var hang = findHanging(pos, pos.turn, 400);
      if (hang.length) {
        lines.push(S.sqName(hang[0].sq) + 'の' + S.nameOf(hang[0].piece) + 'が狙われています。');
      }
      var free = findFreeCaptures(pos);
      if (free.length && free[0].gain >= 400) {
        lines.push('相手の' + S.nameOf(free[0].victim) + 'がタダで取れそうです。');
      }
    }
    return lines;
  }

  return {
    PIECE_GUIDE: PIECE_GUIDE,
    describeScore: describeScore,
    describeMove: describeMove,
    findHanging: findHanging,
    findFreeCaptures: findFreeCaptures,
    reviewMove: reviewMove,
    hint: hint,
    comment: comment
  };
});
