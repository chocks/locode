import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SymbolIndex, RegexSymbolExtractor } from './symbol-index'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('RegexSymbolExtractor', () => {
  const extractor = new RegexSymbolExtractor()

  it('extracts exported TypeScript functions', () => {
    const content = [
      'export function foo(x: string): boolean {',
      '  return true',
      '}',
    ].join('\n')
    const symbols = extractor.extract('a.ts', content, 'typescript')
    const foo = symbols.find(s => s.name === 'foo')
    expect(foo).toBeDefined()
    expect(foo!.type).toBe('function')
    expect(foo!.file).toBe('a.ts')
    expect(foo!.lineStart).toBe(1)
    expect(foo!.exported).toBe(true)
    expect(foo!.signature).toContain('foo')
  })

  it('extracts non-exported TypeScript functions', () => {
    const content = 'function bar() { return 1 }'
    const symbols = extractor.extract('a.ts', content, 'typescript')
    const bar = symbols.find(s => s.name === 'bar')
    expect(bar).toBeDefined()
    expect(bar!.exported).toBe(false)
  })

  it('extracts TypeScript classes and methods', () => {
    const content = [
      'export class Foo {',
      '  private bar(): void {}',
      '  public baz(x: number): number { return x }',
      '}',
    ].join('\n')
    const symbols = extractor.extract('a.ts', content, 'typescript')
    const cls = symbols.find(s => s.name === 'Foo' && s.type === 'class')
    expect(cls).toBeDefined()
    expect(cls!.exported).toBe(true)
    expect(cls!.lineStart).toBe(1)

    const bar = symbols.find(s => s.name === 'bar' && s.type === 'method')
    expect(bar).toBeDefined()
    expect(bar!.lineStart).toBe(2)

    const baz = symbols.find(s => s.name === 'baz' && s.type === 'method')
    expect(baz).toBeDefined()
  })

  it('extracts TypeScript interfaces and types', () => {
    const content = [
      'export interface Config {',
      '  name: string',
      '}',
      'type Result = { ok: boolean }',
    ].join('\n')
    const symbols = extractor.extract('a.ts', content, 'typescript')
    const iface = symbols.find(s => s.name === 'Config' && s.type === 'interface')
    expect(iface).toBeDefined()
    expect(iface!.exported).toBe(true)
    expect(iface!.lineStart).toBe(1)

    const type = symbols.find(s => s.name === 'Result' && s.type === 'type')
    expect(type).toBeDefined()
    expect(type!.exported).toBe(false)
  })

  it('extracts TypeScript enums', () => {
    const content = 'export enum Color { Red, Green, Blue }'
    const symbols = extractor.extract('a.ts', content, 'typescript')
    const e = symbols.find(s => s.name === 'Color' && s.type === 'enum')
    expect(e).toBeDefined()
    expect(e!.exported).toBe(true)
  })

  it('extracts arrow function const exports', () => {
    const content = [
      'export const handler = (req: Request) => {',
      '  return req.json()',
      '}',
    ].join('\n')
    const symbols = extractor.extract('a.ts', content, 'typescript')
    const handler = symbols.find(s => s.name === 'handler' && s.type === 'function')
    expect(handler).toBeDefined()
    expect(handler!.exported).toBe(true)
  })

  it('extracts JavaScript functions and classes', () => {
    const content = [
      'function foo() { return 1 }',
      'class Bar {',
      '  constructor() {}',
      '}',
    ].join('\n')
    const symbols = extractor.extract('b.js', content, 'javascript')
    expect(symbols.find(s => s.name === 'foo' && s.type === 'function')).toBeDefined()
    expect(symbols.find(s => s.name === 'Bar' && s.type === 'class')).toBeDefined()
  })

  it('extracts CommonJS module.exports', () => {
    const content = 'module.exports = function thing() { return 42 }'
    const symbols = extractor.extract('c.js', content, 'javascript')
    const thing = symbols.find(s => s.name === 'thing' && s.type === 'function')
    expect(thing).toBeDefined()
    expect(thing!.exported).toBe(true)
  })

  it('extracts Python functions and classes', () => {
    const content = [
      'def foo(x):',
      '    return x + 1',
      '',
      'class Bar:',
      '    def method(self):',
      '        pass',
    ].join('\n')
    const symbols = extractor.extract('d.py', content, 'python')
    const foo = symbols.find(s => s.name === 'foo' && s.type === 'function')
    expect(foo).toBeDefined()
    expect(foo!.lineStart).toBe(1)

    const cls = symbols.find(s => s.name === 'Bar' && s.type === 'class')
    expect(cls).toBeDefined()
    expect(cls!.lineStart).toBe(4)

    const method = symbols.find(s => s.name === 'method' && s.type === 'method')
    expect(method).toBeDefined()
    expect(method!.lineStart).toBe(5)
  })

  it('returns empty array for unsupported languages', () => {
    const symbols = extractor.extract('e.go', 'package main', 'go')
    expect(symbols).toEqual([])
  })

  it('ignores commented-out declarations', () => {
    const content = [
      '// export function fake() { return 1 }',
      '/* function alsoFake() {} */',
      'export function real() { return 2 }',
    ].join('\n')
    const symbols = extractor.extract('a.ts', content, 'typescript')
    expect(symbols.find(s => s.name === 'fake')).toBeUndefined()
    expect(symbols.find(s => s.name === 'alsoFake')).toBeUndefined()
    expect(symbols.find(s => s.name === 'real')).toBeDefined()
  })
})

describe('SymbolIndex', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locode-sym-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function writeFile(name: string, content: string): string {
    const filePath = path.join(tmpDir, name)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content, 'utf8')
    return filePath
  }

  it('indexFile stores symbols and search finds them by name', async () => {
    const index = new SymbolIndex()
    const content = 'export function myFunc() { return 1 }'
    await index.indexFile('a.ts', content, 'typescript')

    const results = index.search('myFunc')
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('myFunc')
    expect(results[0].type).toBe('function')
  })

  it('search is case-insensitive and supports partial match', async () => {
    const index = new SymbolIndex()
    const content = 'export function getUserData() { return null }'
    await index.indexFile('a.ts', content, 'typescript')

    const results = index.search('userdata')
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('getUserData')
  })

  it('search filters by type', async () => {
    const index = new SymbolIndex()
    const content = [
      'export function foo() {}',
      'export class Foo {}',
    ].join('\n')
    await index.indexFile('a.ts', content, 'typescript')

    const fns = index.search('foo', { type: 'function' })
    expect(fns).toHaveLength(1)
    expect(fns[0].type).toBe('function')

    const classes = index.search('foo', { type: 'class' })
    expect(classes).toHaveLength(1)
    expect(classes[0].type).toBe('class')
  })

  it('forFile returns all symbols in a file', async () => {
    const index = new SymbolIndex()
    const content = [
      'export function foo() {}',
      'export function bar() {}',
    ].join('\n')
    await index.indexFile('a.ts', content, 'typescript')

    const symbols = index.forFile('a.ts')
    expect(symbols).toHaveLength(2)
    expect(symbols.map(s => s.name).sort()).toEqual(['bar', 'foo'])
  })

  it('getCode returns the source lines for a symbol', async () => {
    const index = new SymbolIndex()
    const content = [
      'export function foo() {',
      '  return 42',
      '}',
      'export function bar() {}',
    ].join('\n')
    const filePath = writeFile('a.ts', content)
    await index.indexFile(filePath, content, 'typescript')

    const foo = index.search('foo')[0]
    const code = await index.getCode(foo)
    expect(code).toContain('export function foo() {')
  })

  it('removeFile clears symbols for that file', async () => {
    const index = new SymbolIndex()
    await index.indexFile('a.ts', 'export function foo() {}', 'typescript')
    await index.indexFile('b.ts', 'export function bar() {}', 'typescript')

    index.removeFile('a.ts')
    expect(index.search('foo')).toHaveLength(0)
    expect(index.search('bar')).toHaveLength(1)
  })

  it('save and load round-trips the symbol index', async () => {
    const index = new SymbolIndex()
    await index.indexFile('a.ts', 'export function foo() {}', 'typescript')

    const storageDir = path.join(tmpDir, 'index')
    await index.save(storageDir)

    const reloaded = new SymbolIndex()
    await reloaded.load(storageDir)

    expect(reloaded.search('foo')).toHaveLength(1)
    expect(reloaded.forFile('a.ts')).toHaveLength(1)
  })

  it('all() returns every indexed symbol', async () => {
    const index = new SymbolIndex()
    await index.indexFile('a.ts', 'export function foo() {}\nexport class Bar {}', 'typescript')
    await index.indexFile('b.ts', 'export function baz() {}', 'typescript')

    expect(index.all()).toHaveLength(3)
  })

  it('respects languages config — only extracts symbols for configured languages', async () => {
    const index = new SymbolIndex(['typescript'])
    await index.indexFile('a.ts', 'export function foo() {}', 'typescript')
    await index.indexFile('b.py', 'def bar(): pass', 'python')

    expect(index.search('foo')).toHaveLength(1)
    expect(index.search('bar')).toHaveLength(0)
  })
})
