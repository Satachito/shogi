/*
 * 思考ルーチンの動作確認。  node test/test-ai.js
 */
var S = require('../js/engine.js');
var AI = require('../js/ai.js');

var pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) pass++;
  else { fail++; console.log('  ✗ ' + label); }
}
function legalSet(pos) {
  var set = {};
  S.legalMoves(pos).forEach(function (m) { set[m] = true; });
  return set;
}

console.log('■ 基本動作');
var pos = S.newGame('even');
var t0 = Date.now();
var r = AI.think(pos, { level: 2 });
console.log('  中級の初手: ' + S.moveToKanji(pos, r.move) +
  '  深さ' + r.depth + ' / ' + r.nodes + '局面 / ' + (Date.now() - t0) + 'ms');
ok(r.move !== null && legalSet(pos)[r.move], '合法手を返す');

console.log('\n■ 各レベルが時間内に指す');
for (var lv = 0; lv < AI.LEVELS.length; lv++) {
  var p = S.newGame('even');
  var start = Date.now();
  var res = AI.think(p, { level: lv });
  var ms = Date.now() - start;
  console.log('  ' + AI.LEVELS[lv].label + ': ' + S.moveToKanji(p, res.move) +
    ' (' + ms + 'ms, 深さ' + res.depth + ')');
  ok(res.move !== null && legalSet(p)[res.move], AI.LEVELS[lv].label + 'が合法手を返す');
  ok(ms < AI.LEVELS[lv].ms + 3000, AI.LEVELS[lv].label + 'が時間内に終わる');
}

console.log('\n■ 詰みを見つける');
var m1 = S.fromSfen('4k4/9/4L4/9/9/9/9/9/4K4 b G 1');
var r1 = AI.think(m1, { level: 2 });
ok(r1.mate && S.sqName(S.mvTo(r1.move)) === '5二', '1手詰（5二金打）を選ぶ');

console.log('\n■ タダの駒は取る');
// 後手の飛車が5五にただで浮いている
var free = S.fromSfen('4k4/9/9/9/4r4/4P4/9/9/4K4 b - 1');
var r2 = AI.think(free, { level: 2, noise: 0 });
ok(S.sqName(S.mvTo(r2.move)) === '5五', '歩で飛車を取る手を選ぶ  → ' + S.moveToKanji(free, r2.move));

console.log('\n■ タダで取られる手は指さない');
// 自分の飛車を、相手の歩の前に動かせる局面
var hang = S.fromSfen('4k4/9/4p4/9/9/9/9/4R4/4K4 b - 1');
var r3 = AI.think(hang, { level: 2, noise: 0 });
ok(S.sqName(S.mvTo(r3.move)) !== '5四', '歩に取られる位置に飛車を出さない  → ' + S.moveToKanji(hang, r3.move));

console.log('\n■ 王手されたら受ける');
var checked = S.fromSfen('4k4/9/9/9/9/9/9/4r4/4K4 b - 1');
ok(S.inCheck(checked, S.SENTE), '先手玉に王手が掛かっている');
var r4 = AI.think(checked, { level: 1 });
var after = checked.clone();
S.doMove(after, r4.move);
ok(!S.inCheck(after, S.SENTE), '王手を解消する手を指す  → ' + S.moveToKanji(checked, r4.move));

console.log('\n■ 40手の自己対局が最後まで進む');
var g = S.newGame('even'), moves = 0, err = null;
try {
  for (var i = 0; i < 40; i++) {
    var res2 = AI.think(g, { level: 1 });
    if (!res2.move) break;
    if (!legalSet(g)[res2.move]) { err = '非合法手 at ' + i; break; }
    S.doMove(g, res2.move);
    moves++;
  }
} catch (e) { err = e.message; }
ok(err === null, '例外なく進行' + (err ? ' — ' + err : ''));
ok(moves === 40, '40手指せた（実際 ' + moves + '手）');
console.log('  最終局面:\n' + S.toText(g).split('\n').map(function (l) { return '    ' + l; }).join('\n'));

console.log('\n' + (fail === 0 ? '✓ 全 ' + pass + ' 件パス' : '✗ ' + fail + ' 件失敗 / ' + pass + ' 件パス'));
process.exit(fail ? 1 : 0);
