/*
 * ルールエンジンの自己テスト。  node test/test-engine.js で実行。
 */
var S = require('../js/engine.js');

var pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.log('  ✗ ' + label); }
}
function eq(a, b, label) {
  if (a === b) pass++;
  else { fail++; console.log('  ✗ ' + label + '  (期待 ' + b + ' / 実際 ' + a + ')'); }
}
/** 順不同の集合比較（漢数字はコードポイント順が直感と違うため） */
function setEq(arr, expected, label) {
  var a = arr.slice().sort().join(','), b = expected.slice().sort().join(',');
  if (a === b) pass++;
  else { fail++; console.log('  ✗ ' + label + '  (期待 ' + b + ' / 実際 ' + a + ')'); }
}
function section(name) { console.log('\n■ ' + name); }

function movesTo(pos, fromName) {
  return S.movesFrom(pos, S.parseSqName(fromName))
    .map(function (m) { return S.sqName(S.mvTo(m)) + (S.mvProm(m) ? '成' : ''); })
    .sort();
}
function play(pos, fromName, toName, prom) {
  var from = S.parseSqName(fromName), to = S.parseSqName(toName);
  var list = S.legalMoves(pos).filter(function (m) {
    return !S.mvIsDrop(m) && S.mvFrom(m) === from && S.mvTo(m) === to &&
      S.mvProm(m) === (prom ? 1 : 0);
  });
  if (!list.length) throw new Error('非合法手: ' + fromName + '→' + toName);
  S.doMove(pos, list[0]);
  return pos;
}
function drop(pos, type, toName) {
  var to = S.parseSqName(toName);
  var list = S.legalMoves(pos).filter(function (m) {
    return S.mvIsDrop(m) && S.mvDropType(m) === type && S.mvTo(m) === to;
  });
  if (!list.length) throw new Error('打てない: ' + toName);
  S.doMove(pos, list[0]);
  return pos;
}

// ---------------------------------------------------------------- 初期局面
section('初期局面');
var pos = S.newGame('even');
eq(S.toSfen(pos), S.HIRATE, 'SFEN 往復');
eq(S.legalMoves(pos).length, 30, '平手初手は30通り');
eq(S.sqName(S.parseSqName('7六')), '7六', 'マス名の往復');
eq(S.legalMoves(S.fromSfen(S.toSfen(pos))).length, 30, 'SFEN 復元後も30通り');

// ---------------------------------------------------------------- 駒の動き
section('駒の動き');
setEq(movesTo(pos, '7七'), ['7六'], '歩は前に1マス');
setEq(movesTo(pos, '8九'), [], '初期局面の桂は自陣の歩に塞がれて動けない');
setEq(movesTo(pos, '2八'), ['1八', '3八', '4八', '5八', '6八', '7八'], '飛車は空いている分だけ走る');
setEq(movesTo(pos, '5九'), ['4八', '5八', '6八'], '玉は塞がっていない3マス');
setEq(movesTo(pos, '1九'), ['1八'], '香車は自陣の歩の手前まで');
setEq(movesTo(pos, '3九'), ['3八', '4八'], '銀は前と斜め前');

// 成りの選択肢
var promTest = S.fromSfen('4k4/9/4P4/9/9/9/9/9/4K4 b - 1');
setEq(movesTo(promTest, '5三'), ['5二', '5二成'], '敵陣に入る手は成/不成を選べる');
var forceProm = S.fromSfen('4k4/4P4/9/9/9/9/9/9/4K4 b - 1');
setEq(movesTo(forceProm, '5二'), ['5一成'], '一段目に行く歩は成り強制');
var forceKnight = S.fromSfen('4k4/9/4N4/9/9/9/9/9/4K4 b - 1');
setEq(movesTo(forceKnight, '5三'), ['4一成', '6一成'], '一段目に跳ねる桂は成り強制');

// 成った駒の動き（玉は隅に置いて利きの邪魔をしないようにする）
var horse = S.fromSfen('4k4/9/9/9/4+B4/9/9/9/4K4 b - 1');   // 玉は5筋（角の利きに掛からない）
eq(S.movesFrom(horse, S.parseSqName('5五')).length, 20, '馬は角の利き16＋上下左右4');
var dragon = S.fromSfen('8k/9/9/9/4+R4/9/9/9/K8 b - 1');
eq(S.movesFrom(dragon, S.parseSqName('5五')).length, 20, '龍は飛車の利き16＋斜め4');
var tokin = S.fromSfen('8k/9/9/9/4+P4/9/9/9/K8 b - 1');
setEq(movesTo(tokin, '5五'), ['4四', '5四', '6四', '4五', '6五', '5六'], 'と金は金と同じ動き');

// ---------------------------------------------------------------- 王手・詰み
section('王手と詰み');
var check = S.fromSfen('4k4/9/9/9/9/9/9/9/4KR3 b - 1');   // 4九に飛車→王手ではない
ok(!S.inCheck(check, S.GOTE), '離れた飛車は王手ではない');
var check2 = S.fromSfen('4k4/9/9/9/9/9/9/9/4KR3 b - 1');
play(check2, '4九', '4一');
ok(S.inCheck(check2, S.GOTE), '飛車を敵陣に打ち込むと王手');

// 頭金の詰み
var mate = S.fromSfen('4k4/4G4/4L4/9/9/9/9/9/4K4 w - 1');
ok(S.inCheck(mate, S.GOTE), '5二金は王手');
ok(S.isCheckmate(mate), '香で支えた頭金は詰み');

// 玉が逃げられるなら詰みではない
var notMate = S.fromSfen('4k4/4G4/9/9/9/9/9/9/4K4 w - 1');
ok(!S.isCheckmate(notMate), 'ひもの付いていない金は玉に取られる');

// 1手詰の発見
var m1 = S.fromSfen('4k4/9/4L4/9/9/9/9/9/4K4 b G 1');
var found = S.findMate(m1, 1);
ok(found !== null, '1手詰を見つけられる');
if (found) eq(S.sqName(S.mvTo(found)), '5二', '正解は5二金打');

// 3手詰
var m3 = S.fromSfen('3gkg3/9/4L4/9/9/9/9/9/4K4 b GG 1');
ok(S.findMate(m3, 1) === null, 'この局面に1手詰はない');

// ---------------------------------------------------------------- 反則
section('反則の判定');
// 二歩
var nifu = S.fromSfen('4k4/9/9/9/9/9/4P4/9/4K4 b P 1');
var drops5 = S.dropsOf(nifu, S.P).map(function (m) { return S.colOf(S.mvTo(m)); });
ok(drops5.indexOf(4) < 0, '同じ筋に歩は打てない（二歩）');
ok(drops5.indexOf(3) >= 0, '隣の筋には打てる');

// 行きどころのない駒
var deadPiece = S.fromSfen('4k4/9/9/9/9/9/9/9/4K4 b PNL 1');
var rows = { P: [], N: [], L: [] };
S.dropsOf(deadPiece, S.P).forEach(function (m) { rows.P.push(S.rowOf(S.mvTo(m))); });
S.dropsOf(deadPiece, S.N).forEach(function (m) { rows.N.push(S.rowOf(S.mvTo(m))); });
S.dropsOf(deadPiece, S.L).forEach(function (m) { rows.L.push(S.rowOf(S.mvTo(m))); });
ok(rows.P.indexOf(0) < 0, '一段目に歩は打てない');
ok(rows.L.indexOf(0) < 0, '一段目に香は打てない');
ok(rows.N.indexOf(0) < 0 && rows.N.indexOf(1) < 0, '一・二段目に桂は打てない');
ok(rows.P.indexOf(1) >= 0, '二段目には歩を打てる');

// 打ち歩詰め: 1一玉／2一に後手の香（自分の駒で逃げ道が塞がっている）／2三に先手の金
// ここに 1二歩と打つと詰みなので反則になる。
var uchifu = S.fromSfen('7lk/9/7G1/9/9/9/9/9/4K4 b P 1');
var pawnTo12 = S.dropsOf(uchifu, S.P).filter(function (m) { return S.sqName(S.mvTo(m)) === '1二'; });
eq(pawnTo12.length, 0, '打ち歩詰めは反則');
// 反則なのは「打つ」場合だけ。盤上の歩を突いて詰ますのは合法（突き歩詰め）
var tsukifu = S.fromSfen('7lk/9/7GP/9/9/9/9/9/4K4 b - 1');
var adv = S.movesFrom(tsukifu, S.parseSqName('1三')).filter(function (m) { return S.sqName(S.mvTo(m)) === '1二'; });
ok(adv.length > 0, '盤上の歩を突いて詰ますのは合法');
var afterPush = tsukifu.clone();
S.doMove(afterPush, adv[0]);
ok(S.isCheckmate(afterPush), '突き歩詰めは確かに詰んでいる');

// 自殺手・ピン
var pin2 = S.fromSfen('4r4/9/9/9/9/9/4G4/9/4K4 b - 1');
setEq(movesTo(pin2, '5七'), ['5六', '5八'], 'ピンされた金は筋から離れられない');

// ---------------------------------------------------------------- 持ち駒
section('駒を取る・打つ');
var cap = S.newGame('even');
play(cap, '7七', '7六'); play(cap, '3三', '3四');
play(cap, '8八', '2二', true);   // 角交換（成って取る）
eq(cap.hand(S.SENTE, S.B), 1, '取った角が持ち駒になる');
eq(S.glyph(cap.at(S.parseSqName('2二'))), '馬', '成って取ったので馬');
play(cap, '3一', '2二');
eq(cap.hand(S.GOTE, S.B), 1, '成駒を取っても持ち駒は「角」');

// 取り返しと待った（undo）の整合性
section('undo の整合性');
var u = S.newGame('even');
var before = S.toSfen(u);
var mv = S.legalMoves(u);
var allOk = true;
for (var i = 0; i < mv.length; i++) {
  var rec = S.doMove(u, mv[i]);
  S.undoMove(u, rec);
  if (S.toSfen(u) !== before) { allOk = false; break; }
}
ok(allOk, '全ての初手で do→undo が元に戻る');

var deep = S.newGame('even');
var stack = [];
for (var d = 0; d < 20; d++) {
  var ms = S.legalMoves(deep);
  stack.push(S.doMove(deep, ms[(d * 7) % ms.length]));
}
while (stack.length) S.undoMove(deep, stack.pop());
eq(S.toSfen(deep), S.HIRATE, '20手進めて全部戻すと初期局面');

// ---------------------------------------------------------------- 駒落ち
section('駒落ち');
var two = S.newGame('two');
ok(two.at(S.parseSqName('8二')) === S.EMPTY, '二枚落ちは飛車がない');
ok(two.at(S.parseSqName('2二')) === S.EMPTY, '二枚落ちは角がない');
ok(two.at(S.parseSqName('2八')) !== S.EMPTY, '下手の飛車は残る');
eq(S.newGame('eight').board.filter(function (x) { return x !== S.EMPTY; }).length, 40 - 8, '八枚落ちは8枚少ない');

// ---------------------------------------------------------------- 手数
section('手の総数（既知の値との照合）');
function perft(p, depth) {
  var ms = S.legalMoves(p);
  if (depth === 1) return ms.length;
  var total = 0;
  for (var i = 0; i < ms.length; i++) {
    var r = S.doMove(p, ms[i]);
    total += perft(p, depth - 1);
    S.undoMove(p, r);
  }
  return total;
}
var t0 = Date.now();
eq(perft(S.newGame('even'), 1), 30, 'perft(1) = 30');
eq(perft(S.newGame('even'), 2), 900, 'perft(2) = 900');
eq(perft(S.newGame('even'), 3), 25470, 'perft(3) = 25470');
eq(perft(S.newGame('even'), 4), 719731, 'perft(4) = 719731');
console.log('  perft(1..4) 所要 ' + (Date.now() - t0) + 'ms');

console.log('\n' + (fail === 0 ? '✓ 全 ' + pass + ' 件パス' : '✗ ' + fail + ' 件失敗 / ' + pass + ' 件パス'));
process.exit(fail ? 1 : 0);
