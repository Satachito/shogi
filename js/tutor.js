/*
 * tutor.js — 「先生」役。
 *   - 指し手の講評、ヒント、形勢の言葉での説明
 *   - レッスンの教材データ
 *   - 詰将棋の問題（すべてエンジンで詰みを検証済み）
 */
;(function (root, factory) {
  var api = factory(
    typeof require === 'function' ? require('./engine.js') : root.Shogi,
    typeof require === 'function' ? require('./ai.js') : root.ShogiAI
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ShogiTutor = api;
})(typeof window !== 'undefined' ? window : globalThis, function (S, AI) {
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
  var LESSONS = [
    {
      id: 'about',
      title: '1. 将棋ってどんなゲーム？',
      summary: '目的とルールの全体像',
      blocks: [
        { t: 'p', text: '将棋は2人で遊ぶボードゲームです。9×9の盤の上で駒を動かし、<b>相手の玉（king）を捕まえたら勝ち</b>。それだけがルールの目的です。' },
        { t: 'p', text: '下側が<b>先手（せんて）</b>、上側が<b>後手（ごて）</b>。先手から交互に1手ずつ指します。このアプリではあなたが先手（下側）です。' },
        { t: 'ul', items: [
          '駒は自分の手前から向こうへ進む。盤は自分側から見る。',
          '相手の駒があるマスに動けば、その駒を<b>取れる</b>。',
          '取った駒は<b>自分の駒として盤に打てる</b>（＝持ち駒）。ここが将棋の最大の特徴です。',
          '相手の玉に「次に取るぞ」と迫るのが<b>王手</b>。どうやっても逃げられない状態が<b>詰み</b>で、そこで勝負あり。'
        ] },
        { t: 'note', text: 'チェスと違い、取った駒を使い回せるので、駒が減らずに終盤ほど盤上がにぎやかになります。' },
        { t: 'board', sfen: S.HIRATE, caption: '対局開始の並べ方（平手）。盤上の駒をクリックすると、その駒が動けるマスが光ります。' }
      ]
    },
    {
      id: 'pieces',
      title: '2. 駒の動きを覚える',
      summary: '8種類の駒と、その利き',
      blocks: [
        { t: 'p', text: 'まずはこれだけ。図の <span class="legend-dot"></span> が、その駒の行けるマスです。丸をクリックすると解説が変わります。' },
        { t: 'pieces' },
        { t: 'note', text: '覚え方のコツ：<b>金・銀・玉</b>の3つは「1マスずつ動く仲間」、<b>飛車・角・香車</b>は「どこまでも走る仲間」、<b>歩・桂</b>は特別。' }
      ]
    },
    {
      id: 'promote',
      title: '3. 成る（なる）',
      summary: '敵陣に入ると駒が強くなる',
      blocks: [
        { t: 'p', text: '相手側の3段（<b>敵陣</b>）に駒が<b>入る・出る・敵陣の中で動く</b>とき、その駒を裏返して強い駒にできます。これが<b>成り</b>です。' },
        { t: 'ul', items: [
          '<b>歩・香・桂・銀</b>が成ると、すべて<b>金と同じ動き</b>になります。',
          '<b>飛車</b>が成ると<b>竜</b>（飛車＋斜め1マス）。<b>角</b>が成ると<b>馬</b>（角＋縦横1マス）。',
          '<b>金と玉は成れません。</b>',
          '成るかどうかは自由（不成も選べます）。ただし、その先で二度と動けなくなる場合は<b>成らなければいけません</b>。'
        ] },
        { t: 'board', sfen: '4k4/9/4P4/9/9/9/9/9/4K4 b - 1', from: '5三', caption: '5三の歩をクリック。敵陣（一〜三段目）に入る手なので「成る／成らない」を選べます。' },
        { t: 'note', text: '取った成り駒は、持ち駒になるときは元の駒に戻ります。「と金」を取っても、持ち駒は「歩」です。' }
      ]
    },
    {
      id: 'drop',
      title: '4. 持ち駒を打つ',
      summary: '将棋でいちばん面白いルール',
      blocks: [
        { t: 'p', text: '取った駒は<b>自分の持ち駒</b>になり、手番のときに盤の空いているマスへ<b>打つ</b>ことができます（1手かかります）。' },
        { t: 'ul', items: [
          '打った駒は必ず<b>成っていない状態</b>で盤に出ます。',
          '打ったその瞬間には成れません。次に動かすときに敵陣なら成れます。',
          '盤上のどこでも空いていれば打てますが、次の3つは反則です。'
        ] },
        { t: 'p', text: '<b>打てない場所・打ち方（反則）</b>' },
        { t: 'ul', items: [
          '<b>二歩</b>：同じ筋に自分の歩がすでにあるとき、そこへ歩は打てません（盤上の歩を動かすのは OK）。',
          '<b>行きどころのない駒</b>：一段目の歩・香、一〜二段目の桂は、動けなくなるので打てません。',
          '<b>打ち歩詰め</b>：<b>歩を打って</b>相手を詰ませるのは反則。同じ形でも、盤上の歩を突いて詰ますのは合法です。'
        ] },
        { t: 'note', text: 'このアプリでは反則手はそもそも指せないようになっています。駒台の駒をクリックすると、打てるマスだけが光ります。' },
        { t: 'board', sfen: '4k4/9/9/9/9/9/4P4/9/4K4 b P 1', hand: true, caption: '駒台の歩をクリックしてみましょう。5筋には歩があるので、5筋には打てません（二歩）。' }
      ]
    },
    {
      id: 'check',
      title: '5. 王手と詰み',
      summary: '勝負の決まり方',
      blocks: [
        { t: 'p', text: '相手の玉を次に取れる状態にすることを<b>王手</b>といいます。王手をかけられた側は、必ずそれを解消しなければなりません。方法は3つ。' },
        { t: 'ul', items: [
          '<b>逃げる</b>：玉を安全なマスへ動かす。',
          '<b>取る</b>：王手をかけている駒を取る。',
          '<b>合駒（あいごま）</b>：飛車・角・香の王手なら、間に駒を置いて防ぐ。'
        ] },
        { t: 'p', text: 'この3つがどれもできない状態が<b>詰み</b>。そこで対局終了です。' },
        { t: 'board', sfen: '4k4/4G4/4L4/9/9/9/9/9/4K4 w - 1', caption: '典型的な詰みの形「頭金（あたまきん）」。5二の金は5三の香が支えているので玉では取れず、逃げ場もありません。' },
        { t: 'note', text: '自分の玉が取られてしまう手（自殺手）は指せません。このアプリでは選べないようになっています。' }
      ]
    },
    {
      id: 'value',
      title: '6. 駒の価値と交換',
      summary: '損か得かを考える',
      blocks: [
        { t: 'p', text: 'だいたいの目安（歩を1とした場合）。持ち駒になると、どこにでも打てるぶん少し価値が上がります。' },
        { t: 'table', rows: [
          ['歩', '1'], ['香', '4'], ['桂', '4.5'], ['銀', '6.5'],
          ['金', '7'], ['角', '9.5'], ['飛', '10'], ['と金・成銀など', '6前後']
        ] },
        { t: 'ul', items: [
          '安い駒で高い駒を取れるなら<b>駒得</b>。ふつうは得です。',
          '取られそうな駒には<b>ひも（守り）</b>を付ける。取り返せる形なら「タダ取られ」ではありません。',
          '<b>飛車と角は大駒</b>。序盤でタダで取られると、それだけで形勢が大きく傾きます。'
        ] },
        { t: 'note', text: 'ただし終盤は「駒得より速さ」。玉を詰ませられるなら、駒を捨てても構いません。' }
      ]
    },
    {
      id: 'opening',
      title: '7. 序盤の心得',
      summary: '最初の10手で何をするか',
      blocks: [
        { t: 'p', text: '序盤にやることは3つだけです。' },
        { t: 'ul', items: [
          '<b>大駒の道を開ける</b>：▲7六歩で角の道、▲2六歩で飛車の前を開く。',
          '<b>玉を囲う</b>：玉を右か左に動かし、金銀で周りを固める。',
          '<b>攻めの形を作る</b>：飛車の周りに銀を出して、狙う筋を決める。'
        ] },
        { t: 'p', text: '<b>覚えやすくて堅い「美濃囲い」</b>' },
        { t: 'board', sfen: 'lnsgkgsnl/1r5b1/p1pppp1pp/1p4p2/9/2PP5/PP2PPPPP/1BSRG1SK1/LN3G1NL b - 1',
          caption: '先手が美濃囲い（２八玉・３八銀・５八金・４九金）に組んだところ。飛車を6八に振った「四間飛車」との組み合わせが定番です。' },
        { t: 'ul', items: [
          '玉を盤の端に寄せて、金銀3枚で囲む。これだけで格段に粘り強くなります。',
          '横からの攻めに強く、振り飛車（飛車を左側に動かす戦法）と好相性です。',
          '手順の一例：▲7六歩 → ▲6八飛 → ▲4八玉 → ▲3八玉 → ▲2八玉 → ▲3八銀 → ▲5八金左'
        ] },
        { t: 'note', text: 'まずは「玉を動かさずに攻める」のをやめるだけで、ぐっと勝率が上がります。囲いは3手でも4手でも構いません。' }
      ]
    },
    {
      id: 'endgame',
      title: '8. 終盤のコツ',
      summary: '寄せの基本',
      blocks: [
        { t: 'p', text: '終盤は「相手の玉をどれだけ速く詰ませるか」の勝負です。' },
        { t: 'ul', items: [
          '<b>玉は下段に落とす</b>：上に逃がすと捕まえにくくなります。',
          '<b>金・銀は玉に近づけて使う</b>：離れた王手は逃げられるだけ。',
          '<b>退路を塞いでから王手</b>：先に逃げ道を消すのが「寄せ」の基本。',
          '<b>詰みがあるなら駒は惜しまない</b>：詰ませば勝ちです。'
        ] },
        { t: 'p', text: '対局中に「詰みがあるかも？」と思ったら、<b>詰みチェック</b>ボタンを押してください。1手詰・3手詰があるか教えます。' },
        { t: 'note', text: '詰将棋を毎日1問解くのが、いちばん効く上達法です。「詰将棋」タブへどうぞ。' }
      ]
    }
  ];

  // ====================================================== 詰将棋
  // すべて findMate() で詰みと解の一意性を確認済み。
  var PROBLEMS = [
    { id: 't1', moves: 1, sfen: '4k4/9/9/9/1B7/9/9/9/K8 b G 1',
      hint: '玉の真上に金を打ちましょう。取られないよう、味方の駒が支えているマスを探します。',
      theme: '頭金（あたまきん）' },
    { id: 't2', moves: 1, sfen: '5k3/9/5S3/9/9/9/9/9/K8 b BG 1',
      hint: '銀が支えているマスはどこでしょう。角は使いません。',
      theme: '銀のひもで頭金' },
    { id: 't3', moves: 1, sfen: '3k5/4R4/9/9/9/9/9/9/K8 b RS 1',
      hint: '飛車をもう1枚、玉の隣に。先にいる飛車が支えになります。',
      theme: '飛車を並べる' },
    { id: 't4', moves: 1, sfen: '4k4/2p6/3G5/9/9/9/9/9/K8 b RG 1',
      hint: '6三の金の利きをよく見て。金を打つマスは1つだけです。',
      theme: '金で支えて頭金' },
    { id: 't5', moves: 1, sfen: '3gk4/9/4B4/9/4S4/9/9/9/K8 b RG 1',
      hint: '相手の金が守っていますが、逃げ道は角が押さえています。',
      theme: '守り駒があっても詰む' },
    { id: 't6', moves: 3, sfen: '3k5/9/5R3/9/9/9/9/9/K8 b GL 1',
      hint: 'まず飛車を成って竜を作り、玉の逃げ道を狭めます。逃げたところに金を打ちます。',
      theme: '竜で追って金で仕留める' },
    { id: 't7', moves: 3, sfen: '9/4Bk3/8R/9/9/9/9/9/K8 b RP 1',
      hint: '角を成って馬を作ります。玉が逃げたところへ、持ち駒の飛車を打ちましょう。',
      theme: '馬を作ってから寄せる' }
  ];

  /** 詰み手順（読み筋）を文字列の配列で返す */
  function solveLine(pos, n) {
    if (n <= 0) return [];
    var m = S.findMate(pos, n);
    if (!m) return [];
    var out = [S.moveToKanji(pos, m)];
    var u = S.doMove(pos, m);
    if (S.legalMoves(pos).length > 0) {
      // 相手の応手のうち、まだ詰みが続くもの（＝最善の抵抗）を1つ選ぶ
      var defs = S.legalMoves(pos), chosen = null;
      for (var i = 0; i < defs.length && !chosen; i++) {
        var v = S.doMove(pos, defs[i]);
        if (S.findMate(pos, n - 2)) chosen = defs[i];
        S.undoMove(pos, v);
      }
      if (chosen) {
        out.push(S.moveToKanji(pos, chosen));
        var v2 = S.doMove(pos, chosen);
        out = out.concat(solveLine(pos, n - 2));
        S.undoMove(pos, v2);
      }
    }
    S.undoMove(pos, u);
    return out;
  }

  // ====================================================== 講評ロジック
  var YOU = S.SENTE;   // 学習者は先手

  function scoreFor(owner, senteScore) {
    return owner === S.SENTE ? senteScore : -senteScore;
  }

  /** 形勢を言葉で */
  function describeScore(senteScore) {
    var a = Math.abs(senteScore);
    var who = senteScore > 0 ? 'あなた' : 'Claude';
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

    // 損得の計算（浅い探索）
    var best = AI.think(pos, { level: 2, noise: 0, useBook: false, ms: opts.ms || 500 });
    var bestScore = scoreFor(mover, best.score);
    var actualScore = scoreFor(mover, AI.evalAfter(pos, move, opts.ms || 300));
    var loss = bestScore - actualScore;

    // 指した駒がタダで取られないか
    var hangLoss = S.hangingLoss(after, to);
    if (hangLoss >= 300) {
      var moved = after.board[to];
      res.lines.push('注意：' + S.sqName(to) + 'の' + S.nameOf(moved) + 'は、このままだと取られてしまいます。');
    }

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

    if (loss >= 350 && best.move) {
      res.lines.push('たとえば ' + S.moveToKanji(pos, best.move) + ' なら、' +
        describeMove(pos, best.move) + '手でした。');
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
  function hint(pos, opts) {
    opts = opts || {};
    var me = pos.turn;

    // 1. 詰みがあるか
    var mate1 = S.findMate(pos, 1);
    if (mate1) {
      return { move: mate1, title: '詰みがあります！', urgent: true,
        text: '相手の玉を詰ませる手が1手あります。玉の逃げ道と、味方の駒の支えを確認してみてください。' };
    }
    var mate3 = S.findMate(pos, 3);
    if (mate3) {
      return { move: mate3, title: '3手で詰みます！', urgent: true,
        text: '王手を続けて逃げ道を消していけば詰みます。まずは玉の退路を狭める王手から。' };
    }

    // 2. 王手されている
    if (S.inCheck(pos, me)) {
      var esc = AI.think(pos, { level: 2, noise: 0, useBook: false, ms: 500 });
      return { move: esc.move, title: 'まず王手を受けましょう', urgent: true,
        text: '「逃げる」「取る」「合駒する」の3つのどれかで王手を解消します。解消できないと負けです。' };
    }

    // 3. タダで取れる駒
    var free = findFreeCaptures(pos);
    if (free.length && free[0].gain >= 400) {
      return { move: free[0].move, title: 'タダで取れる駒があります',
        text: S.nameOf(free[0].victim) + 'が取れます。取り返される心配もありません。' };
    }

    // 4. タダで取られそうな駒
    var hang = findHanging(pos, me, 400);
    if (hang.length) {
      var save = AI.think(pos, { level: 2, noise: 0, useBook: false, ms: 600 });
      return { move: save.move, title: '取られそうな駒があります',
        text: S.sqName(hang[0].sq) + 'の' + S.nameOf(hang[0].piece) +
          'が狙われています。逃げるか、ひも（守り）を付けるか、取り返せる形にしましょう。' };
    }

    // 5. ふつうの局面での有力手
    var best = AI.think(pos, { level: 2, noise: 0, useBook: false, ms: 700 });
    if (!best.move) return { move: null, title: '指す手がありません', text: '詰んでいます。' };
    var title = pos.ply < 14 ? '序盤の組み立て' : '有力な手';
    var text = describeMove(pos, best.move) + '手です。';
    if (pos.ply < 14) {
      text += ' 序盤は「大駒の道を開ける」「玉を囲う」「攻めの形を作る」の3つを意識しましょう。';
    }
    return { move: best.move, title: title, text: text };
  }

  /** 局面についての短いコメント（手番の人へ） */
  function comment(pos) {
    var lines = [];
    var sc = AI.evaluate(pos);
    lines.push(describeScore(sc));
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
    LESSONS: LESSONS,
    PROBLEMS: PROBLEMS,
    YOU: YOU,
    solveLine: solveLine,
    describeScore: describeScore,
    describeMove: describeMove,
    findHanging: findHanging,
    findFreeCaptures: findFreeCaptures,
    reviewMove: reviewMove,
    hint: hint,
    comment: comment
  };
});
