// Токенизатор SentencePiece Unigram по tokenizer.json (multilingual-e5: словарь XLM-R, 250 тыс. частей).
// Перенесён из личного хаба (personal-hub, E1-12). Без сторонних библиотек: нормализация, «▁» вместо пробела,
// разбор слова алгоритмом Витерби по оценкам частей. Нормализатор «Precompiled» (nmt_nfkc) заменён на NFKC — как в transformers.js.

type TokenizerJson = {
  model: { type: string; vocab: [string, number][]; unk_id: number };
  added_tokens?: { id: number; content: string }[];
};

/** Управляющие символы и невидимые пробелы нулевой ширины — удаляются при нормализации. */
// Управляющие символы здесь нужны намеренно: их и вычищаем.
// eslint-disable-next-line no-control-regex
const INVISIBLE = new RegExp('[\u0000-\u0008\u000B\u000E-\u001F\u007F\u200B-\u200D\uFEFF]', 'g');

export class UnigramTokenizer {
  private readonly ids = new Map<string, number>();
  private readonly scores: Float64Array;
  private readonly maxPiece: number;
  private readonly unkScore: number;
  readonly unkId: number;
  readonly bosId: number;
  readonly eosId: number;
  readonly padId: number;

  constructor(json: TokenizerJson) {
    if (json.model.type !== 'Unigram') throw new Error('Ожидался токенизатор Unigram, а не ' + json.model.type + '.');
    const vocab = json.model.vocab;
    this.scores = new Float64Array(vocab.length);
    let maxPiece = 1;
    let minScore = 0;
    vocab.forEach(([piece, score], id) => {
      this.ids.set(piece, id);
      this.scores[id] = score;
      maxPiece = Math.max(maxPiece, [...piece].length);
      if (score < minScore) minScore = score;
    });
    this.maxPiece = maxPiece;
    // Как в SentencePiece: незнакомый символ дороже любой части словаря.
    this.unkScore = minScore - 10;
    this.unkId = json.model.unk_id;
    const special = (content: string, fallback: number) => json.added_tokens?.find((t) => t.content === content)?.id ?? fallback;
    this.bosId = special('<s>', 0);
    this.padId = special('<pad>', 1);
    this.eosId = special('</s>', 2);
  }

  /** NFKC, управляющие символы — прочь, пробелы любого вида — один пробел. */
  static normalize(text: string): string {
    return text.normalize('NFKC').replace(INVISIBLE, '').replace(/\s+/gu, ' ').trim();
  }

  /** Слова с «▁» в начале (Metaspace, add_prefix_space). */
  static pretokenize(text: string): string[] {
    const normalized = UnigramTokenizer.normalize(text);
    return normalized ? normalized.split(' ').map((word) => '▁' + word) : [];
  }

  /** Лучший разбор слова на части словаря по сумме оценок (Витерби). */
  private segment(word: string): number[] {
    const chars = [...word];
    const n = chars.length;
    const best = new Float64Array(n + 1).fill(-Infinity);
    const from = new Int32Array(n + 1).fill(-1);
    const piece = new Int32Array(n + 1).fill(-1);
    best[0] = 0;
    for (let i = 0; i < n; i++) {
      if (best[i] === -Infinity) continue;
      let text = '';
      let matched = false;
      for (let j = i; j < Math.min(n, i + this.maxPiece); j++) {
        text += chars[j];
        const id = this.ids.get(text);
        if (id === undefined) continue;
        if (id === this.unkId) continue;
        matched = matched || j === i;
        const score = best[i]! + this.scores[id]!;
        if (score > best[j + 1]!) { best[j + 1] = score; from[j + 1] = i; piece[j + 1] = id; }
      }
      if (!matched) {
        const score = best[i]! + this.unkScore;
        if (score > best[i + 1]!) { best[i + 1] = score; from[i + 1] = i; piece[i + 1] = this.unkId; }
      }
    }
    const out: number[] = [];
    for (let at = n; at > 0; at = from[at]!) out.push(piece[at]!);
    out.reverse();
    // Подряд идущие незнакомые символы — одна часть <unk>.
    return out.filter((id, k) => !(id === this.unkId && out[k - 1] === this.unkId));
  }

  /** Части текста без служебных <s> и </s>. */
  tokenize(text: string): number[] {
    return UnigramTokenizer.pretokenize(text).flatMap((word) => this.segment(word));
  }

  /** Вход модели: <s> части </s>, не длиннее maxLength (лишнее отрезается, </s> сохраняется). */
  encode(text: string, maxLength = 512): number[] {
    const body = this.tokenize(text).slice(0, Math.max(0, maxLength - 2));
    return [this.bosId, ...body, this.eosId];
  }

  piece(id: number): string | undefined {
    for (const [text, value] of this.ids) if (value === id) return text;
    return undefined;
  }
}
