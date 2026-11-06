// Векторы смысла (решение 2026-11-06): multilingual-e5-small в ONNX на процессоре сервера,
// без сети и без Python — так же, как в личном хабе. Префиксы обязательны: «query: » для вопроса,
// «passage: » для записи. Вектор — среднее по частям текста, длина 1.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { unitVector } from '../../../../packages/core/src/index.ts';
import { UnigramTokenizer } from './unigram-tokenizer.ts';

export type EmbedKind = 'query' | 'passage';

export interface Embedder {
  /** имя модели — хранится у записи, при смене модели векторы пересчитываются */
  readonly name: string;
  readonly dim: number;
  /** близость, ниже которой запись не считается найденной по смыслу */
  readonly minScore: number;
  embed(texts: readonly string[], kind: EmbedKind): Promise<Float32Array[]>;
}

/** onnxruntime-node — только то, что используется. */
interface Ort {
  InferenceSession: { create(file: string, options?: object): Promise<OrtSession> };
  Tensor: new (type: string, data: BigInt64Array, dims: number[]) => object;
}
interface OrtSession {
  inputNames: readonly string[];
  run(feeds: Record<string, object>): Promise<Record<string, { data: Float32Array; dims: readonly number[] }>>;
}

/** e5 в ONNX: папка с model_quantized.onnx (или model.onnx) и tokenizer.json. */
export class E5Embedder implements Embedder {
  readonly name: string;
  readonly dim: number;
  // Замер на 173 записях Brain (2026-11-06): нужная запись — 0,87–0,90, соседние — 0,84–0,86,
  // посторонний вопрос («рецепт борща») — не выше 0,81. Ниже порога запись по смыслу не считается найденной.
  readonly minScore = 0.83;
  private readonly session: OrtSession;
  private readonly ort: Ort;
  private readonly tokenizer: UnigramTokenizer;
  private readonly maxLength = 512;
  private readonly batch = 16;

  private constructor(name: string, dim: number, session: OrtSession, ort: Ort, tokenizer: UnigramTokenizer) {
    this.name = name;
    this.dim = dim;
    this.session = session;
    this.ort = ort;
    this.tokenizer = tokenizer;
  }

  static async load(folder: string): Promise<E5Embedder> {
    const modelFile = ['model_quantized.onnx', 'model.onnx'].map((name) => path.join(folder, name)).find((file) => existsSync(file));
    if (!modelFile) throw new Error(`В папке модели нет model_quantized.onnx или model.onnx: ${folder}`);
    const tokenizer = new UnigramTokenizer(JSON.parse(readFileSync(path.join(folder, 'tokenizer.json'), 'utf8')));
    const ort = (await import('onnxruntime-node')) as unknown as Ort;
    const session = await ort.InferenceSession.create(modelFile, { executionProviders: ['cpu'], graphOptimizationLevel: 'all' });
    const probe = new E5Embedder(path.basename(folder), 0, session, ort, tokenizer);
    const [first] = await probe.run(['query: проверка']);
    return new E5Embedder(path.basename(folder), first!.length, session, ort, tokenizer);
  }

  async embed(texts: readonly string[], kind: EmbedKind): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += this.batch) {
      out.push(...(await this.run(texts.slice(i, i + this.batch).map((text) => `${kind}: ${text}`))));
    }
    return out;
  }

  private async run(texts: readonly string[]): Promise<Float32Array[]> {
    const encoded = texts.map((text) => this.tokenizer.encode(text, this.maxLength));
    const width = Math.max(...encoded.map((ids) => ids.length));
    const ids = new BigInt64Array(texts.length * width).fill(BigInt(this.tokenizer.padId));
    const mask = new BigInt64Array(texts.length * width);
    encoded.forEach((row, r) =>
      row.forEach((id, c) => {
        ids[r * width + c] = BigInt(id);
        mask[r * width + c] = 1n;
      }),
    );
    const dims = [texts.length, width];
    const feeds: Record<string, object> = {};
    for (const name of this.session.inputNames) {
      if (name === 'input_ids') feeds[name] = new this.ort.Tensor('int64', ids, dims);
      else if (name === 'attention_mask') feeds[name] = new this.ort.Tensor('int64', mask, dims);
      else if (name === 'token_type_ids') feeds[name] = new this.ort.Tensor('int64', new BigInt64Array(texts.length * width), dims);
      else throw new Error(`Неизвестный вход модели: ${name}`);
    }
    const result = await this.session.run(feeds);
    const hidden = result['last_hidden_state'] ?? Object.values(result)[0]!;
    const dim = hidden.dims[2]!;
    // среднее по частям текста без заполнителей, затем длина 1 (как в e5)
    return encoded.map((row, r) => {
      const v = new Float32Array(dim);
      for (let c = 0; c < row.length; c++) for (let d = 0; d < dim; d++) v[d] = v[d]! + hidden.data[(r * width + c) * dim + d]!;
      return unitVector(v);
    });
  }
}

/**
 * Модель для тестов: «мешок» основ слов по хешам — похожие тексты дают близкие векторы.
 * Без сети и файлов; настоящая модель проверяется вручную на стенде.
 */
export class HashEmbedder implements Embedder {
  readonly name = 'hash';
  readonly dim: number;
  readonly minScore = 0.2;
  constructor(dim = 128) {
    this.dim = dim;
  }
  async embed(texts: readonly string[]): Promise<Float32Array[]> {
    return texts.map((text) => {
      const v = new Float32Array(this.dim);
      for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
        let h = 2166136261;
        for (const ch of word.slice(0, 5)) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619);
        const at = (h >>> 0) % this.dim;
        v[at] = v[at]! + 1;
      }
      return unitVector(v);
    });
  }
}
