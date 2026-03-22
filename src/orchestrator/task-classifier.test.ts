import { describe, it, expect } from 'vitest'
import { TaskClassifier } from './task-classifier'

describe('TaskClassifier', () => {
  const classifier = new TaskClassifier()

  it('classifies search and inspection prompts as inspect', () => {
    expect(classifier.classify('grep for TODOs in src')).toBe('inspect')
    expect(classifier.classify('read package.json and explain it')).toBe('inspect')
  })

  it('classifies code modification prompts as edit', () => {
    expect(classifier.classify('fix the failing auth test')).toBe('edit')
    expect(classifier.classify('implement a new CLI command')).toBe('edit')
  })

  it('classifies milestone and PR style prompts as workflow', () => {
    expect(classifier.classify('create a branch, implement the ticket, and open a PR')).toBe('workflow')
    expect(classifier.classify('run the milestone workflow for feature-x')).toBe('workflow')
  })

  it('classifies general questions as chat', () => {
    expect(classifier.classify('why is this project local first?')).toBe('chat')
    expect(classifier.classify('what is the architecture here?')).toBe('chat')
  })
})
