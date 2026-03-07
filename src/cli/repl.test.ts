import { describe, it, expect } from 'vitest'
import { hasUnclosedCodeBlock, looksLikeStruggle, looksLikeSimpleLocalTask, parseConfirmation } from './repl'

describe('hasUnclosedCodeBlock', () => {
  it('returns false for plain text', () => {
    expect(hasUnclosedCodeBlock('explain this function')).toBe(false)
  })

  it('returns false for a closed code block', () => {
    expect(hasUnclosedCodeBlock('here:\n```js\nconst x = 1\n```')).toBe(false)
  })

  it('returns true for an opening fence with no closing', () => {
    expect(hasUnclosedCodeBlock('here is the code:\n```')).toBe(true)
  })

  it('returns true for a multiline paste cut off mid-block', () => {
    expect(hasUnclosedCodeBlock('fix this:\n```js\nconst x = 1')).toBe(true)
  })

  it('returns false for multiple closed blocks', () => {
    expect(hasUnclosedCodeBlock('```a```\nand\n```b```')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(hasUnclosedCodeBlock('')).toBe(false)
  })
})

describe('looksLikeSimpleLocalTask', () => {
  it('returns true for a grep task', () => {
    expect(looksLikeSimpleLocalTask('grep for TODO comments in src')).toBe(true)
  })

  it('returns true for a git log query', () => {
    expect(looksLikeSimpleLocalTask('git log last 10 commits')).toBe(true)
  })

  it('returns true for a file read request', () => {
    expect(looksLikeSimpleLocalTask('read the package.json file')).toBe(true)
  })

  it('returns false for a complex refactor task', () => {
    expect(looksLikeSimpleLocalTask('refactor the auth module to use async/await')).toBe(false)
  })

  it('returns false for a code generation task', () => {
    expect(looksLikeSimpleLocalTask('write a new REST endpoint for user registration')).toBe(false)
  })
})

describe('looksLikeStruggle', () => {
  it('returns true for "I don\'t have the ability"', () => {
    expect(looksLikeStruggle("I don't have the ability to access your filesystem.")).toBe(true)
  })

  it('returns true for "I cannot access"', () => {
    expect(looksLikeStruggle('I cannot access the files directly.')).toBe(true)
  })

  it('returns true for "I am unable to"', () => {
    expect(looksLikeStruggle("I am unable to read that file.")).toBe(true)
  })

  it('returns true for "I\'m unable to"', () => {
    expect(looksLikeStruggle("I'm unable to run that command.")).toBe(true)
  })

  it('returns true for "I lack the ability"', () => {
    expect(looksLikeStruggle("I lack the ability to execute shell commands.")).toBe(true)
  })

  it('returns false for a normal helpful response', () => {
    expect(looksLikeStruggle('Here are the files I found in the src directory.')).toBe(false)
  })

  it('returns false for "I have access to the tools provided"', () => {
    expect(looksLikeStruggle('I have access to the tools provided.')).toBe(false)
  })
})

describe('parseConfirmation', () => {
  it('returns "proceed" for empty input (default)', () => {
    expect(parseConfirmation('')).toBe('proceed')
  })

  it('returns "proceed" for "y"', () => {
    expect(parseConfirmation('y')).toBe('proceed')
  })

  it('returns "proceed" for "Y"', () => {
    expect(parseConfirmation('Y')).toBe('proceed')
  })

  it('returns "cancel" for "n"', () => {
    expect(parseConfirmation('n')).toBe('cancel')
  })

  it('returns "cancel" for "N"', () => {
    expect(parseConfirmation('N')).toBe('cancel')
  })

  it('returns "switch" for "s"', () => {
    expect(parseConfirmation('s')).toBe('switch')
  })

  it('returns "switch" for "S"', () => {
    expect(parseConfirmation('S')).toBe('switch')
  })

  it('returns "proceed" for unrecognized input', () => {
    expect(parseConfirmation('x')).toBe('proceed')
  })
})
