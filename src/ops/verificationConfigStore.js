import { readJson, writeJson } from '../control-center/data/jsonStore.js'

const CONFIG_FILE = 'ops/verification_config.json'

const defaultData = {
  updatedAt: null,
  guilds: {}
}

let cache = null
let loadingPromise = null

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

async function loadData() {
  if (cache) {
    return cache
  }
  if (loadingPromise) {
    return loadingPromise
  }
  loadingPromise = (async () => {
    try {
      const payload = await readJson(CONFIG_FILE, defaultData)
      cache = normalizeData(payload)
      return cache
    } catch (error) {
      console.warn('Failed to load verification config dataset, using defaults:', error)
      cache = clone(defaultData)
      return cache
    }
  })()
  try {
    return await loadingPromise
  } finally {
    loadingPromise = null
  }
}

function normalizeData(input) {
  const source = input && typeof input === 'object' ? input : defaultData
  const guilds = source.guilds && typeof source.guilds === 'object' ? source.guilds : {}
  const normalizedGuilds = {}
  for (const [guildId, config] of Object.entries(guilds)) {
    normalizedGuilds[String(guildId)] = normalizeConfig(config)
  }
  return {
    updatedAt: source.updatedAt ?? null,
    guilds: normalizedGuilds
  }
}

function normalizeConfig(config) {
  const source = config && typeof config === 'object' ? config : {}
  return {
    channelId: source.channelId ? String(source.channelId) : null,
    approvedRoleIds: Array.isArray(source.approvedRoleIds)
      ? source.approvedRoleIds
          .map((roleId) => (roleId ? String(roleId) : null))
          .filter(Boolean)
      : [],
    staffChannelId: source.staffChannelId ? String(source.staffChannelId) : null,
    questions: Array.isArray(source.questions)
      ? source.questions.map((question) => normalizeQuestion(question)).filter(Boolean)
      : [],
    messageId: source.messageId ? String(source.messageId) : null,
    lastUpdated: source.lastUpdated ? new Date(source.lastUpdated).toISOString() : null,
    metadata: source.metadata && typeof source.metadata === 'object' ? { ...source.metadata } : {}
  }
}

function normalizeQuestion(question) {
  if (!question || typeof question !== 'object') {
    return null
  }
  const id = question.id ? String(question.id) : createQuestionId()
  const label = typeof question.label === 'string' ? question.label.trim() : ''
  if (!label) {
    return null
  }
  const required = question.required !== undefined ? Boolean(question.required) : true
  const type = typeof question.type === 'string' ? question.type : 'text'
  return {
    id,
    label,
    type,
    placeholder: typeof question.placeholder === 'string' ? question.placeholder : '',
    required,
    order: Number.isFinite(Number(question.order)) ? Number(question.order) : 0
  }
}

let questionCounter = 0
function createQuestionId() {
  questionCounter += 1
  return `q${questionCounter}`
}

async function persist(data) {
  const payload = {
    updatedAt: data.updatedAt ?? new Date().toISOString(),
    guilds: data.guilds
  }
  await writeJson(CONFIG_FILE, payload)
  cache = payload
  return cache
}

export async function getVerificationConfig(guildId) {
  const data = await loadData()
  if (!guildId) {
    return {
      guildId: null,
      channelId: null,
      approvedRoleIds: [],
      staffChannelId: null,
      questions: [],
      messageId: null,
      lastUpdated: data.updatedAt
    }
  }
  const normalizedGuild = String(guildId)
  const config = data.guilds[normalizedGuild]
  return {
    guildId: normalizedGuild,
    ...(config ?? {
      channelId: null,
      approvedRoleIds: [],
      staffChannelId: null,
      questions: [],
      messageId: null,
      lastUpdated: null
    })
  }
}

export async function setVerificationConfig(guildId, config) {
  if (!guildId) {
    throw new Error('guildId is required to set verification config')
  }
  const data = await loadData()
  const normalizedGuild = String(guildId)
  const payload = normalizeConfig(config)
  const now = new Date().toISOString()
  data.guilds[normalizedGuild] = {
    ...payload,
    lastUpdated: now
  }
  data.updatedAt = now
  await persist(data)
  return {
    guildId: normalizedGuild,
    ...data.guilds[normalizedGuild]
  }
}

export async function listVerificationConfigs() {
  const data = await loadData()
  return Object.entries(data.guilds).map(([guildId, config]) => ({
    guildId,
    ...config
  }))
}

export async function resetVerificationConfigData() {
  cache = null
  await writeJson(CONFIG_FILE, clone(defaultData))
}
