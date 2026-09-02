import { describe, expect, it } from 'vitest';

import { validateCustomer, type CustomerInput } from './validate.js';

function input(overrides: Partial<CustomerInput> = {}): CustomerInput {
  return { name: '山田太郎', kana: '', company: '', phone: '', email: '', note: '', ...overrides };
}

describe('入力のまちがいを見つける', () => {
  it('全部そろっていれば何も言わない', () => {
    expect(validateCustomer(input({ email: 'taro@example.com' }))).toEqual([]);
  });

  it('名前が空なら「名前を入力してください」', () => {
    const errors = validateCustomer(input({ name: '' }));
    expect(errors).toEqual([{ field: 'name', message: '名前を入力してください' }]);
  });

  it('名前が空白だけでも空とみなす', () => {
    expect(validateCustomer(input({ name: '   ' })).map((e) => e.field)).toEqual(['name']);
  });

  it('メールが空なら何も言わない（必須ではない）', () => {
    expect(validateCustomer(input({ email: '' }))).toEqual([]);
  });

  it('abc のような形はメールとして弾く', () => {
    const errors = validateCustomer(input({ email: 'abc' }));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.field).toBe('email');
    expect(errors[0]?.message).toContain('メールの形が違います');
  });

  it.each(['abc', 'abc@', '@example.com', 'abc@example', 'a b@example.com'])(
    'メールとして弾く: %s',
    (email) => {
      expect(validateCustomer(input({ email })).map((e) => e.field)).toContain('email');
    },
  );

  it.each(['taro@example.com', 'a.b+c@example.co.jp', 'x@y.z'])('メールとして通す: %s', (email) => {
    expect(validateCustomer(input({ email }))).toEqual([]);
  });

  it('まちがいが2つあれば2つとも返す', () => {
    const errors = validateCustomer(input({ name: '', email: 'abc' }));
    expect(errors.map((e) => e.field)).toEqual(['name', 'email']);
  });

  it('長すぎる入力は弾く', () => {
    const errors = validateCustomer(input({ note: 'あ'.repeat(1001) }));
    expect(errors.map((e) => e.field)).toEqual(['note']);
    expect(errors[0]?.message).toContain('メモが長すぎます');
  });

  it('上限ちょうどは通す', () => {
    expect(validateCustomer(input({ note: 'あ'.repeat(1000) }))).toEqual([]);
  });
});
