/**
 * @file
 *
 * Compiles and instantiates WebAssembly modules inlined into a plugin's bundle.
 *
 * `@mnaoumov/obsidian-dev-toolkit`'s `wasm` feature turns `import bytes from './module.wasm'` into a `Uint8Array`. These
 * helpers compile those bytes once per bytes object and instantiate them with typed exports. The module imports nothing,
 * so a worker entry point can import it too, and a compiled `WebAssembly.Module` can be passed to a worker as a call
 * argument, because it is structured-cloneable.
 */

/**
 * An instantiated module with typed exports.
 *
 * @typeParam TExports - The exports type.
 */
export interface WasmInstance<TExports extends WebAssembly.Exports> {
  /**
   * The instance's exports.
   */
  readonly exports: TExports;

  /**
   * The instance.
   */
  readonly instance: WebAssembly.Instance;

  /**
   * The compiled module, reusable for more instances and passable to a worker.
   */
  readonly module: WebAssembly.Module;
}

const compiledModules = new WeakMap<object, Promise<WebAssembly.Module>>();

/**
 * Compiles WebAssembly bytes, once per bytes object.
 *
 * The cache is keyed by the bytes object itself, so the constant an inlined `.wasm` import gives is compiled once
 * however many times it is asked for, and the compiled module is released with that constant when the plugin unloads. A
 * failed compilation is not cached.
 *
 * @param bytes - The module's bytes.
 * @returns The compiled module.
 */
export async function compileWasmModule(bytes: ArrayBuffer | ArrayBufferView): Promise<WebAssembly.Module> {
  let promise = compiledModules.get(bytes);
  if (!promise) {
    promise = WebAssembly.compile(toBufferSource(bytes));
    compiledModules.set(bytes, promise);
    promise.catch(() => {
      compiledModules.delete(bytes);
    });
  }
  return await promise;
}

/**
 * Instantiates a WebAssembly module, compiling it first when given bytes.
 *
 * Each call makes a new instance with its own memory; nothing here keeps the instance, so dropping every reference to
 * it lets the garbage collector free that memory. Keep it in a field cleared on unload rather than at module scope.
 *
 * @typeParam TExports - The exports type. It is not checked against the module.
 * @param source - The module's bytes, or a module compiled by {@link compileWasmModule}.
 * @param imports - The import object.
 * @returns The instance with typed exports.
 */
export async function instantiateWasmModule<TExports extends WebAssembly.Exports = WebAssembly.Exports>(
  source: ArrayBuffer | ArrayBufferView | WebAssembly.Module,
  imports: WebAssembly.Imports = {}
): Promise<WasmInstance<TExports>> {
  const compiledModule = source instanceof WebAssembly.Module ? source : await compileWasmModule(source);
  const instance = await WebAssembly.instantiate(compiledModule, imports);
  return { exports: instance.exports as TExports, instance, module: compiledModule };
}

function toBufferSource(bytes: ArrayBuffer | ArrayBufferView): BufferSource {
  return bytes as BufferSource;
}
