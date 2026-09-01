/**
 * 全体計画ファイル（plan.json）の型と検証。
 *
 * 全体計画は一度だけ作り、以降は本文を書き換えない。変更してよいのは各項目の `status` と、
 * 末尾への新項目の追記だけ。この制約は人間の注意力では守れないため、ここで機械的に検証し
 * CI で毎回まわす。
 */

/** 確認手段。`ci` は自動で確かめられる、`human` は人間が実物を見るしかない。 */
export type Automation = 'ci' | 'human';

/**
 * 項目の状態。`awaiting_human` は AI 側の作業が終わり、人間の確認だけが残っている状態。
 * 溜めて一括で聞くため、完了とは別の状態として持つ。
 */
export type Status = 'todo' | 'awaiting_human' | 'done';

/** 当初計画か、途中で追加されたか。進捗を別枠で表示するために持つ。 */
export type Origin = 'initial' | 'added';

export interface PlanItem {
  /** 不変の識別子。`T` + 3 桁以上の数字。一度振ったら二度と変えない。 */
  id: string;
  /** 一言の名前。 */
  title: string;
  /** 完成すると何ができるか。依存元がこれを読んで判断できるように書く。 */
  deliverable: string;
  /**
   * 確かめ方。人間が画面でたどれる操作の手順として書く。
   * 「テストが通る」ではなく「押す・見る」。空にはできない。
   */
  verify: string[];
  /** 依存する項目の id。 */
  dependsOn: string[];
  /** 触るファイル。並列可否の判定に使うため、重複を隠さず全て挙げる。 */
  files: string[];
  automation: Automation;
  status: Status;
  origin: Origin;
  /** 追加項目のみ。どの項目の作業中に判明したか。 */
  note?: string;
}

export interface Plan {
  /** 大計画のゴール。「問題がなければ即リリースできる状態」を書く。 */
  goal: string;
  items: PlanItem[];
}

export interface Progress {
  initial: { done: number; total: number };
  added: { done: number; total: number };
  /** 人間の確認待ち。溜まったらまとめて聞く。 */
  awaitingHuman: string[];
}

const ID_PATTERN = /^T\d{3,}$/;
const AUTOMATIONS: readonly Automation[] = ['ci', 'human'];
const STATUSES: readonly Status[] = ['todo', 'awaiting_human', 'done'];
const ORIGINS: readonly Origin[] = ['initial', 'added'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/**
 * 「何をもって、できたと判断するか」を示す語。
 * これが1つも無い確かめ方は、読んだ人が同じ手順をなぞれない。
 */
const EXPECTED_RESULT_MARKERS = ['確認', '確かめ', '説明してもらう'];

/** 手順として成立する最低限の長さ。「テストが通る」のような一言を弾く。 */
const MIN_VERIFY_STEP_LENGTH = 8;

/**
 * 確かめ方の書き方を検査する。
 *
 * 判定は**項目ごと**に行う。「index.html を開く」「送信ボタンを押す」のような
 * 下ごしらえの手順には期待結果が無くて当然で、1手順ずつ見ると正当な書き方まで弾いてしまう。
 * 見るのは「その項目の確かめ方のどこかに、できたと判断する根拠が書かれているか」。
 */
export function validateVerifySteps(steps: readonly string[]): string[] {
  const errors: string[] = [];

  for (const step of steps) {
    if (step.trim().length < MIN_VERIFY_STEP_LENGTH) {
      errors.push(`確かめ方「${step}」が短すぎます。何をどうすると何が起きるかを書いてください`);
    }
  }

  const hasExpectedResult = steps.some((step) =>
    EXPECTED_RESULT_MARKERS.some((marker) => step.includes(marker)),
  );
  if (!hasExpectedResult) {
    errors.push(
      '確かめ方に、何をもって「できた」と判断するかが書かれていません（例:「pnpm run test を実行し、新しいテストが通ることを確認する」）',
    );
  }

  return errors;
}

/**
 * 計画ファイルを検証し、違反を全て返す。空配列なら妥当。
 *
 * 最初の違反で打ち切らないのは、書いた人が一度に全部直せるようにするため。
 */
export function validatePlan(input: unknown): string[] {
  const errors: string[] = [];

  if (!isRecord(input)) {
    return ['計画ファイルの中身がオブジェクトではありません'];
  }
  if (typeof input.goal !== 'string' || input.goal.trim() === '') {
    errors.push('goal（大計画のゴール）が空です');
  }
  if (!Array.isArray(input.items)) {
    errors.push('items が配列ではありません');
    return errors;
  }

  const seen = new Set<string>();
  let previousNumber = 0;

  input.items.forEach((raw, index) => {
    const where = `items[${index}]`;
    if (!isRecord(raw)) {
      errors.push(`${where}: 項目がオブジェクトではありません`);
      return;
    }

    const id = raw.id;
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      errors.push(`${where}: id は T001 のような形式にしてください（実際: ${String(id)}）`);
    } else {
      if (seen.has(id)) {
        errors.push(`${where}: id ${id} が重複しています`);
      }
      seen.add(id);

      // 番号は不変・単調増加。追加は必ず末尾へ最大値+1 で行うため、
      // 順序が崩れていること自体が「既存項目を書き換えた」証拠になる。
      const current = Number(id.slice(1));
      if (current <= previousNumber) {
        errors.push(
          `${where}: id ${id} が昇順ではありません（直前は T${String(previousNumber).padStart(3, '0')}）`,
        );
      }
      previousNumber = Math.max(previousNumber, current);
    }

    if (typeof raw.title !== 'string' || raw.title.trim() === '') {
      errors.push(`${where}: title が空です`);
    }
    if (typeof raw.deliverable !== 'string' || raw.deliverable.trim() === '') {
      errors.push(`${where}: deliverable（できるもの）が空です`);
    }
    if (!isStringArray(raw.verify) || raw.verify.length === 0) {
      errors.push(
        `${where}: verify（確かめ方）が空です。確かめ方を書けない項目は粒度が大きすぎます`,
      );
    } else {
      for (const violation of validateVerifySteps(raw.verify)) {
        errors.push(`${where}: ${violation}`);
      }
    }
    if (!isStringArray(raw.dependsOn)) {
      errors.push(`${where}: dependsOn が文字列の配列ではありません`);
    }
    if (!isStringArray(raw.files) || raw.files.length === 0) {
      errors.push(`${where}: files（触るファイル）が空です`);
    }
    if (!AUTOMATIONS.includes(raw.automation as Automation)) {
      errors.push(`${where}: automation は ci か human です（実際: ${String(raw.automation)}）`);
    }
    if (!STATUSES.includes(raw.status as Status)) {
      errors.push(
        `${where}: status は todo / awaiting_human / done です（実際: ${String(raw.status)}）`,
      );
    }
    if (!ORIGINS.includes(raw.origin as Origin)) {
      errors.push(`${where}: origin は initial か added です（実際: ${String(raw.origin)}）`);
    }
  });

  // 依存先の存在確認は、全 id が出そろってから行う。
  input.items.forEach((raw, index) => {
    if (!isRecord(raw) || !isStringArray(raw.dependsOn)) return;
    for (const dep of raw.dependsOn) {
      if (!seen.has(dep)) {
        errors.push(`items[${index}]: 依存先 ${dep} が計画に存在しません`);
      }
      if (dep === raw.id) {
        errors.push(`items[${index}]: 自分自身に依存しています`);
      }
    }
  });

  return errors;
}

/** 検証を通った計画として読み込む。違反があれば例外を投げる。 */
export function parsePlan(input: unknown): Plan {
  const errors = validatePlan(input);
  if (errors.length > 0) {
    throw new Error(`計画ファイルに問題があります:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  }
  return input as Plan;
}

/**
 * 進捗を数える。計画ファイルに進捗を書き込まないのは、複数の AI が同時に働くとき
 * 合計値の書き換えが競合するため。数えれば必ず正しい値になる。
 */
export function countProgress(plan: Plan): Progress {
  const tally = (origin: Origin) => {
    const items = plan.items.filter((item) => item.origin === origin);
    return { done: items.filter((item) => item.status === 'done').length, total: items.length };
  };
  return {
    initial: tally('initial'),
    added: tally('added'),
    awaitingHuman: plan.items
      .filter((item) => item.status === 'awaiting_human')
      .map((item) => item.id),
  };
}

/**
 * 次に着手する項目を選ぶ。未着手のうち、依存先が全て完了しているもののうち先頭。
 * セッション開始時の「未完の最優先を1つ選ぶ」がこれにあたる。
 */
export function nextItem(plan: Plan): PlanItem | undefined {
  const done = new Set(plan.items.filter((item) => item.status === 'done').map((item) => item.id));
  return plan.items.find(
    (item) => item.status === 'todo' && item.dependsOn.every((dep) => done.has(dep)),
  );
}

/**
 * 2 つの項目を同時に進めてよいか。
 * 依存関係がなく、触るファイルも重ならないときだけ並列にできる。
 * worktree で隔離しても main へのマージ時に衝突するため、ファイルの重複も基準に含める。
 */
export function canRunInParallel(a: PlanItem, b: PlanItem): boolean {
  if (a.id === b.id) return false;
  if (a.dependsOn.includes(b.id) || b.dependsOn.includes(a.id)) return false;
  return !a.files.some((file) => b.files.includes(file));
}

/** 追加項目に振る次の id。既存の最大値 +1。既存の番号は動かさない。 */
export function nextId(plan: Plan): string {
  const max = plan.items.reduce((acc, item) => Math.max(acc, Number(item.id.slice(1))), 0);
  return `T${String(max + 1).padStart(3, '0')}`;
}
