/**
 * Detection-only entries: the user gets a clear "not implemented" message instead of
 * a silent failure.
 *
 * DeepSeek has a full adapter in ./deepseek.js (tests in test/adapter-deepseek.test.js),
 * but it is not bundled: with it the bookmarklet exceeds the 64 KB limit, and it is the
 * least reliable of the phase-2 adapters (its API expects a token the web app keeps in
 * localStorage, which this project never reads). Register it in core/registry.js in
 * place of this stub to build a bookmarklet that includes it.
 */
import { STATUS } from '../core/adapter.js'

export const planned = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    status: STATUS.PLANNED,
    allowedPaths: [],
    matches: (location) => location.hostname === 'chat.deepseek.com',
    conversationId: () => null,
    fromDom: () => null,
  },
]
