import test from 'node:test'
import assert from 'node:assert/strict'

import { finalizeReply, sanitizeMemberName } from './responder.js'

test('finalizeReply keeps Unicode characters and emojis intact', () => {
  const reply = finalizeReply({
    raw: 'Doodley: Olá, tudo bem? 🌟',
    botName: 'Doodley',
    member: 'Ana',
    style: {}
  })

  assert.equal(reply, 'Olá, tudo bem? 🌟')
})

test('finalizeReply collapses roleplay blocks into a concise response', () => {
  const raw =
    'Doodley: First line of thought. Second idea appears! Third sentence keeps going? Extra fluff continues.'

  const reply = finalizeReply({
    raw,
    botName: 'Doodley',
    member: 'Ana',
    style: {}
  })

  assert.equal(reply, 'First line of thought. Second idea appears!')
})

test('sanitizeMemberName strips formatting and dangerous characters', () => {
  const sanitized = sanitizeMemberName('**Minds\n`DROP TABLE`** <script>')
  assert.equal(sanitized, 'Minds DROP TABLE')
})
