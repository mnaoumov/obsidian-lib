/**
 * @file
 *
 * Tests for the WebAssembly helpers.
 */

import {
  describe,
  expect,
  it
} from 'vitest';

import {
  compileWasmModule,
  instantiateWasmModule
} from './wasm.ts';

interface AnswerExports extends WebAssembly.Exports {
  readonly answer: () => number;
}

// A module exporting `answer()`, which returns 42: `(module (func (export "answer") (result i32) i32.const 42))`.
const ANSWER_MODULE_BYTES = [
  0x00,
  0x61,
  0x73,
  0x6D,
  0x01,
  0x00,
  0x00,
  0x00,
  0x01,
  0x05,
  0x01,
  0x60,
  0x00,
  0x01,
  0x7F,
  0x03,
  0x02,
  0x01,
  0x00,
  0x07,
  0x0A,
  0x01,
  0x06,
  0x61,
  0x6E,
  0x73,
  0x77,
  0x65,
  0x72,
  0x00,
  0x00,
  0x0A,
  0x06,
  0x01,
  0x04,
  0x00,
  0x41,
  0x2A,
  0x0B
];

describe('compileWasmModule', () => {
  it('compiles once per bytes object', async () => {
    const bytes = new Uint8Array(ANSWER_MODULE_BYTES);
    const first = await compileWasmModule(bytes);
    const second = await compileWasmModule(bytes);
    expect(second).toBe(first);
    expect(await compileWasmModule(new Uint8Array(ANSWER_MODULE_BYTES))).not.toBe(first);
  });

  it('does not cache a failed compilation', async () => {
    const bytes = new Uint8Array([0x00, 0x01]);
    await expect(compileWasmModule(bytes)).rejects.toBeInstanceOf(WebAssembly.CompileError);
    bytes.set([0x00, 0x61]);
    await expect(compileWasmModule(bytes)).rejects.toBeInstanceOf(WebAssembly.CompileError);
  });
});

describe('instantiateWasmModule', () => {
  it('instantiates from bytes and from a compiled module, with typed exports', async () => {
    const fromBytes = await instantiateWasmModule<AnswerExports>(new Uint8Array(ANSWER_MODULE_BYTES).buffer);
    expect(fromBytes.exports.answer()).toBe(42);
    const fromModule = await instantiateWasmModule<AnswerExports>(fromBytes.module, {});
    expect(fromModule.module).toBe(fromBytes.module);
    expect(fromModule.instance).not.toBe(fromBytes.instance);
    expect(fromModule.exports.answer()).toBe(42);
  });
});
