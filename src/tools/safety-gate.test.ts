import { describe, it, expect } from 'vitest'
import { SafetyGate } from './safety-gate'
import type { SafetyConfig } from './safety-gate'

function makeConfig(overrides: Partial<SafetyConfig> = {}): SafetyConfig {
  return {
    always_confirm: [],
    auto_approve: ['read_file', 'git_query'],
    allowed_write_paths: ['.'],
    ...overrides,
  }
}

describe('SafetyGate', () => {
  describe('check', () => {
    it('auto-approves tools in auto_approve list', () => {
      const gate = new SafetyGate(makeConfig())
      const decision = gate.check({ tool: 'read_file', args: { path: 'src/index.ts' } })
      expect(decision).toEqual({ allowed: true, reason: 'auto-approved', requiresConfirmation: false })
    })

    it('requires confirmation for tools in always_confirm list', () => {
      const gate = new SafetyGate(makeConfig({ always_confirm: ['write_file'] }))
      const decision = gate.check({ tool: 'write_file', args: { path: 'src/foo.ts', content: 'x' } })
      expect(decision.allowed).toBe(true)
      expect(decision.requiresConfirmation).toBe(true)
    })

    it('always_confirm takes precedence over auto_approve', () => {
      const gate = new SafetyGate(makeConfig({
        auto_approve: ['write_file'],
        always_confirm: ['write_file'],
      }))
      const decision = gate.check({ tool: 'write_file', args: { path: 'foo.ts', content: 'x' } })
      expect(decision.requiresConfirmation).toBe(true)
    })

    it('allows tools not in either list (default pass-through)', () => {
      const gate = new SafetyGate(makeConfig({ auto_approve: [] }))
      const decision = gate.check({ tool: 'run_command', args: { command: 'ls' } })
      expect(decision.allowed).toBe(true)
      expect(decision.requiresConfirmation).toBe(false)
    })
  })

  describe('checkWritePath', () => {
    it('allows writes within allowed paths', () => {
      const gate = new SafetyGate(makeConfig({ allowed_write_paths: ['.'] }))
      const decision = gate.checkWritePath('src/foo.ts')
      expect(decision.allowed).toBe(true)
    })

    it('blocks writes outside allowed paths', () => {
      const gate = new SafetyGate(makeConfig({ allowed_write_paths: ['src'] }))
      const decision = gate.checkWritePath('/etc/passwd')
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toContain('outside allowed')
    })

    it('allows writes when allowed_write_paths includes "."', () => {
      const gate = new SafetyGate(makeConfig({ allowed_write_paths: ['.'] }))
      const decision = gate.checkWritePath('any/path/file.ts')
      expect(decision.allowed).toBe(true)
    })

    it('supports multiple allowed paths', () => {
      const gate = new SafetyGate(makeConfig({ allowed_write_paths: ['src', 'tests'] }))
      expect(gate.checkWritePath('src/foo.ts').allowed).toBe(true)
      expect(gate.checkWritePath('tests/bar.test.ts').allowed).toBe(true)
      expect(gate.checkWritePath('dist/out.js').allowed).toBe(false)
    })
  })
})
