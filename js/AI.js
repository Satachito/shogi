/*
 * AI.js — Claude API 連携（任意機能）
 *
 * APIキーを設定すると、組み込みの「先生」に加えて本物の Claude が
 * 局面を日本語で解説してくれる。キーが未設定でもアプリは全機能動作する。
 *
 * ブラウザから直接 api.anthropic.com を呼ぶため
 * anthropic-dangerous-direct-browser-access ヘッダを付ける。
 * キーはこの端末の localStorage にのみ保存され、他へは送信しない。
 */
;(function (root) {
  'use strict';

  var S = root.Shogi, T = root.ShogiTutor;

  var ENDPOINT = 'https://api.anthropic.com/v1/messages';
  var VERSION = '2023-06-01';

  var MODELS = [
    { id: 'claude-opus-5', label: 'Claude Opus 5（いちばん賢い）', effort: true },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5（速い）', effort: true },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5（いちばん速い）', effort: false }
  ];

  var STORE_KEY = 'shogi.claude.key';
  var STORE_MODEL = 'shogi.claude.model';

  function getKey() { try { return localStorage.getItem(STORE_KEY) || ''; } catch (e) { return ''; } }
  function setKey(k) { try { k ? localStorage.setItem(STORE_KEY, k) : localStorage.removeItem(STORE_KEY); } catch (e) {} }
  function getModel() { try { return localStorage.getItem(STORE_MODEL) || MODELS[0].id; } catch (e) { return MODELS[0].id; } }
  function setModel(m) { try { localStorage.setItem(STORE_MODEL, m); } catch (e) {} }
  function enabled() { return !!getKey(); }

  var SYSTEM = [
    'あなたは将棋を教える先生です。相手は将棋を覚えたばかりの初心者で、日本語で会話します。',
    '',
    '守ってほしいこと:',
    '- 返答は日本語で、200〜400字程度。長くなりすぎないこと。',
    '- 専門用語を使うときは、かんたんな言い換えを添える（例:「垂れ歩（次に成って攻める歩）」）。',
    '- 局面はテキスト図で渡されます。「v」が付いている駒が後手（Claude側・上側）、付いていないのが先手（生徒・下側）です。',
    '- 段は上から一〜九、筋は左から9〜1です。マスは「7六」のように筋・段の順で呼びます。',
    '- 生徒は先手（下側）です。生徒の立場に立って、次に何を考えればよいかを教えてください。',
    '- 具体的な手を勧めるときは「▲7六歩」のように書き、なぜその手が良いのかを必ず添えること。',
    '- 盤面から読み取れないことは断定しない。分からないときは分からないと言う。',
    '- 励ましつつ、間違いははっきり指摘する。おだてすぎない。',
    '- 箇条書きは3つまで。見出しや装飾はつけない。'
  ].join('\n');

  /** 現在の局面を Claude に渡すためのテキストにまとめる */
  function describePosition(pos, history, extra) {
    var lines = [];
    lines.push('【現在の局面】');
    lines.push(S.toText(pos));
    lines.push('');
    lines.push('SFEN: ' + S.toSfen(pos));
    if (history && history.length) {
      var recent = history.slice(-16).map(function (h) { return h.kanji; });
      lines.push('');
      lines.push('【ここまでの指し手（直近' + recent.length + '手）】');
      lines.push(recent.join(' '));
    }
    if (extra) {
      lines.push('');
      lines.push(extra);
    }
    return lines.join('\n');
  }

  /**
   * Claude に質問する。
   * opts: { pos, history, question, extra, signal }
   * 戻り値: Promise<string>
   */
  function ask(opts) {
    var key = getKey();
    if (!key) return Promise.reject(new Error('APIキーが設定されていません。'));

    var model = getModel();
    var spec = MODELS.filter(function (m) { return m.id === model; })[0] || MODELS[0];

    var body = {
      model: model,
      // 思考ぶんの余裕を見て多めに取る（Opus 5 は既定で思考するため）
      max_tokens: 4000,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: describePosition(opts.pos, opts.history, opts.extra) +
          '\n\n【質問】\n' + (opts.question || 'この局面について、初心者向けにアドバイスをください。')
      }]
    };
    // effort は Haiku では使えないのでモデルを見て付ける
    if (spec.effort) body.output_config = { effort: 'medium' };

    return fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': VERSION,
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body),
      signal: opts.signal
    }).then(function (res) {
      return res.json().then(function (data) { return { status: res.status, data: data }; });
    }).then(function (r) {
      if (r.status !== 200) {
        var msg = (r.data && r.data.error && r.data.error.message) || ('HTTP ' + r.status);
        if (r.status === 401) msg = 'APIキーが正しくないようです。設定を確認してください。';
        if (r.status === 429) msg = 'リクエストが多すぎます。少し待ってからもう一度お試しください。';
        throw new Error(msg);
      }
      var d = r.data;
      // 安全対策で断られた場合
      if (d.stop_reason === 'refusal') {
        throw new Error('この内容には回答できないと判断されました。');
      }
      var text = (d.content || [])
        .filter(function (b) { return b.type === 'text'; })
        .map(function (b) { return b.text; })
        .join('\n')
        .trim();
      return text || '（返答が空でした）';
    }).catch(function (e) {
      if (e.name === 'AbortError') throw e;
      // file:// から開くと CORS で失敗することがある
      if (e instanceof TypeError) {
        throw new Error(
          'Claude に接続できませんでした。ファイルを直接開いていると通信がブロックされることがあります。' +
          'ターミナルでこのフォルダに移動し「python3 -m http.server 8000」を実行して、' +
          'http://localhost:8000/ から開いてみてください。'
        );
      }
      throw e;
    });
  }

  root.ShogiClaude = {
    MODELS: MODELS,
    getKey: getKey, setKey: setKey,
    getModel: getModel, setModel: setModel,
    enabled: enabled,
    ask: ask,
    describePosition: describePosition
  };
})(window);
