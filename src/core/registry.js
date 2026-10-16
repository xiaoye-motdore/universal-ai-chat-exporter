import { assertAdapter } from './adapter.js'
import chatgpt from '../adapters/chatgpt.js'
import claude from '../adapters/claude.js'
import gemini from '../adapters/gemini.js'
import grok from '../adapters/grok.js'
import perplexity from '../adapters/perplexity.js'
import copilot from '../adapters/copilot.js'
import { planned } from '../adapters/planned.js'

export const adapters = [chatgpt, claude, gemini, grok, perplexity, copilot, ...planned].map(assertAdapter)

export function detectAdapter(location) {
  return adapters.find((a) => a.matches(location)) || null
}

export function supportedNames() {
  return adapters.filter((a) => a.status !== 'planned').map((a) => a.name)
}
