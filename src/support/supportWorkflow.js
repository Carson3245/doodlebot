import crypto from 'node:crypto'
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js'

const SUPPORT_ID_PREFIX = 'support:'
const SESSION_TTL = 5 * 60 * 1000

const CASE_TOPICS = [
  {
    value: 'warning-review',
    label: 'Warning review',
    description: 'Talk with the team about a warning or strike.',
    emoji: '⚠️'
  },
  {
    value: 'timeout-appeal',
    label: 'Timeout appeal',
    description: 'Request that a timeout be reviewed or lifted.',
    emoji: '⏱️'
  },
  {
    value: 'ban-appeal',
    label: 'Ban appeal',
    description: 'Appeal a ban or suspension from the server.',
    emoji: '🔨'
  },
  {
    value: 'report-member',
    label: 'Report a member',
    description: 'Report harassment, abuse, or other violations.',
    emoji: '🚨'
  }
]

const TICKET_TOPICS = [
  {
    value: 'role-change',
    label: 'Role change',
    description: 'Request a role update or new server permissions.',
    emoji: '🎭'
  },
  {
    value: 'event-support',
    label: 'Event support',
    description: 'Get help coordinating events or announcements.',
    emoji: '🎟️'
  },
  {
    value: 'tech-issue',
    label: 'Technical issue',
    description: 'Report a technical problem with the server or bot.',
    emoji: '🐞'
  },
  {
    value: 'other',
    label: 'Other help',
    description: 'Something else that needs attention.',
    emoji: '💬'
  }
]

const TOPIC_LOOKUP = new Map([
  ...CASE_TOPICS.map((topic) => [topic.value, topic]),
  ...TICKET_TOPICS.map((topic) => [topic.value, topic])
])

const sessions = new Map()

function createSessionId() {
  return crypto.randomUUID()
}

function cleanupSession(sessionId) {
  const session = sessions.get(sessionId)
  if (session?.timeout) {
    clearTimeout(session.timeout)
  }
  sessions.delete(sessionId)
}

function scheduleCleanup(sessionId) {
  const timeout = setTimeout(() => {
    cleanupSession(sessionId)
  }, SESSION_TTL)
  const session = sessions.get(sessionId)
  if (session) {
    session.timeout = timeout
  }
}

function buildSummaryContent(session) {
  const lines = ['**Support request setup**']

  if (session.origin === 'dm') {
    lines.push(`Server: ${session.guildName ?? 'Select a server'}`)
  } else {
    lines.push(`Server: ${session.guildName ?? 'Current server'}`)
  }

  const categoryLabel = session.category === 'ticket' ? 'Ticket' : session.category === 'case' ? 'Moderation case' : 'Choose a category'
  lines.push(`Category: ${categoryLabel}`)

  const topicLabel = session.topicLabel ?? 'Choose a topic'
  lines.push(`Topic: ${topicLabel}`)

  lines.push('')
  lines.push('After selecting a category and topic, press **Continue** to describe what you need.')

  return lines.join('\n')
}

function buildCategoryOptions(selected) {
  return [
    {
      label: 'Moderation case',
      value: 'case',
      description: 'Appeal a punishment or report disruptive behaviour.',
      emoji: '🛡️',
      default: selected === 'case'
    },
    {
      label: 'Support ticket',
      value: 'ticket',
      description: 'Ask for help with roles, access, or other requests.',
      emoji: '📨',
      default: selected === 'ticket'
    }
  ]
}

function buildTopicOptions(category, selected) {
  const source = category === 'ticket' ? TICKET_TOPICS : CASE_TOPICS
  return source.map((topic) => ({
    label: topic.label,
    value: topic.value,
    description: topic.description,
    emoji: topic.emoji,
    default: selected === topic.value
  }))
}

function buildGuildOptions(options, selected) {
  return options.map((entry) => ({
    label: entry.name,
    value: entry.id,
    description: 'Send this ticket to that server.',
    default: selected === entry.id
  }))
}

function renderComponents(session) {
  const rows = []

  if (session.origin === 'dm' && session.guildOptions.length > 1) {
    const guildSelect = new StringSelectMenuBuilder()
      .setCustomId(`${SUPPORT_ID_PREFIX}guild:${session.id}`)
      .setPlaceholder('Select the server you need help with')
      .addOptions(buildGuildOptions(session.guildOptions, session.guildId))
      .setMinValues(1)
      .setMaxValues(1)
    rows.push(new ActionRowBuilder().addComponents(guildSelect))
  }

  const categorySelect = new StringSelectMenuBuilder()
    .setCustomId(`${SUPPORT_ID_PREFIX}category:${session.id}`)
    .setPlaceholder('Is this a moderation case or a support ticket?')
    .addOptions(buildCategoryOptions(session.category ?? null))
    .setMinValues(1)
    .setMaxValues(1)
  rows.push(new ActionRowBuilder().addComponents(categorySelect))

  const topicRow = new ActionRowBuilder()
  const topicSelect = new StringSelectMenuBuilder()
    .setCustomId(`${SUPPORT_ID_PREFIX}topic:${session.id}`)
    .setPlaceholder(session.category ? 'Select what you need help with' : 'Pick a category first')
    .setMinValues(1)
    .setMaxValues(1)

  if (!session.category) {
    topicSelect.setDisabled(true)
  } else {
    topicSelect.addOptions(buildTopicOptions(session.category, session.topicValue))
  }

  topicRow.addComponents(topicSelect)
  rows.push(topicRow)

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${SUPPORT_ID_PREFIX}continue:${session.id}`)
      .setLabel('Continue')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!canContinue(session))
  )

  rows.push(buttonRow)
  return rows
}

function canContinue(session) {
  if (!session.category || !session.topicValue) {
    return false
  }
  if (session.origin === 'dm' && !session.guildId) {
    return false
  }
  return true
}

function ensureSession(interaction, sessionId) {
  const session = sessions.get(sessionId)
  if (!session) {
    return null
  }
  if (interaction.user.id !== session.userId) {
    return 'not-owner'
  }
  session.updatedAt = Date.now()
  return session
}

export async function startSupportSession(interaction) {
  const moderation = interaction.client?.moderation
  if (!moderation) {
    await interaction.reply({
      content: 'The moderation system is still starting. Please try again in a moment.',
      ephemeral: interaction.inGuild()
    })
    return
  }

  const sessionId = createSessionId()
  const origin = interaction.inGuild() ? 'guild' : 'dm'

  const session = {
    id: sessionId,
    userId: interaction.user.id,
    origin,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    guildId: interaction.guild?.id ?? null,
    guildName: interaction.guild?.name ?? null,
    guildOptions: [],
    category: null,
    topicValue: null,
    topicLabel: null,
    timeout: null
  }

  if (origin === 'dm') {
    const guildMatches = await moderation.findMemberGuilds(interaction.user.id)
    if (!guildMatches.length) {
      await interaction.reply({
        content: 'I could not find any servers we share. Join the server first, then try again.',
        ephemeral: false
      })
      return
    }

    session.guildOptions = guildMatches
      .map(({ guild }) => ({ id: guild.id, name: guild.name ?? guild.id }))
      .sort((a, b) => a.name.localeCompare(b.name))

    if (session.guildOptions.length === 1) {
      session.guildId = session.guildOptions[0].id
      session.guildName = session.guildOptions[0].name
    }
  }

  sessions.set(sessionId, session)
  scheduleCleanup(sessionId)

  await interaction.reply({
    content: buildSummaryContent(session),
    components: renderComponents(session),
    ephemeral: interaction.inGuild(),
    allowedMentions: { parse: [] }
  })
}

export function isSupportInteraction(interaction) {
  if (!interaction || typeof interaction.customId !== 'string') {
    return false
  }
  return interaction.customId.startsWith(SUPPORT_ID_PREFIX)
}

function parseCustomId(customId) {
  const [, kind, sessionId] = customId.split(':')
  return { kind, sessionId }
}

export async function handleSupportComponentInteraction(interaction) {
  const { kind, sessionId } = parseCustomId(interaction.customId)
  const session = ensureSession(interaction, sessionId)

  if (session === 'not-owner') {
    await interaction.reply({
      content: 'This prompt is linked to a different request.',
      ephemeral: interaction.inGuild()
    })
    return
  }

  if (!session) {
    await interaction.reply({
      content: 'That support prompt has expired. Run `/support` again to start over.',
      ephemeral: interaction.inGuild()
    })
    return
  }

  if (interaction.isStringSelectMenu()) {
    if (kind === 'guild') {
      const choice = interaction.values[0]
      const match = session.guildOptions.find((option) => option.id === choice)
      session.guildId = choice
      session.guildName = match?.name ?? choice
    } else if (kind === 'category') {
      const choice = interaction.values[0]
      session.category = choice === 'ticket' ? 'ticket' : 'case'
      session.topicValue = null
      session.topicLabel = null
    } else if (kind === 'topic') {
      const choice = interaction.values[0]
      const topic = TOPIC_LOOKUP.get(choice)
      session.topicValue = choice
      session.topicLabel = topic?.label ?? choice
    }

    await interaction.update({
      content: buildSummaryContent(session),
      components: renderComponents(session),
      allowedMentions: { parse: [] }
    })
    return
  }

  if (interaction.isButton() && kind === 'continue') {
    if (!canContinue(session)) {
      await interaction.reply({
        content: 'Select a server, category, and topic before continuing.',
        ephemeral: interaction.inGuild()
      })
      return
    }

    const modal = new ModalBuilder()
      .setCustomId(`${SUPPORT_ID_PREFIX}modal:${session.id}`)
      .setTitle('Describe your request')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('support-reason')
            .setLabel('How can we help?')
            .setPlaceholder('Provide any details the moderation team should know.')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1000)
        )
      )

    await interaction.showModal(modal)
  }
}

export async function handleSupportModalSubmit(interaction) {
  const { sessionId } = parseCustomId(interaction.customId)
  const session = ensureSession(interaction, sessionId)

  if (session === 'not-owner') {
    await interaction.reply({
      content: 'This prompt belongs to another user.',
      ephemeral: interaction.inGuild()
    })
    return
  }

  if (!session) {
    await interaction.reply({
      content: 'That support prompt expired. Please run `/support` again.',
      ephemeral: interaction.inGuild()
    })
    return
  }

  const moderation = interaction.client?.moderation
  if (!moderation) {
    await interaction.reply({
      content: 'The moderation system is unavailable right now. Please try again soon.',
      ephemeral: interaction.inGuild()
    })
    cleanupSession(session.id)
    return
  }

  if (!session.guildId) {
    await interaction.reply({
      content: 'Select a server before submitting your request.',
      ephemeral: interaction.inGuild()
    })
    return
  }

  const reason = interaction.fields.getTextInputValue('support-reason')?.trim() ?? ''
  const categoryValue = session.category === 'ticket' ? 'ticket' : 'moderation'

  try {
    const supportConfig = moderation.config?.support ?? {}
    const preferredChannelId = supportConfig.intakeChannelId ?? (session.origin === 'guild' ? interaction.channelId : null)
    const result = await moderation.openSupportRequest({
      guildId: session.guildId,
      userId: interaction.user.id,
      requestedById: interaction.user.id,
      requestedByTag: interaction.user.tag,
      category: categoryValue,
      topicId: session.topicValue,
      topicLabel: session.topicLabel,
      reason,
      origin: session.origin,
      intakeChannelId: preferredChannelId
    })

    const acknowledgement = [
      result.case?.id
        ? `Support request recorded as case **${result.case.id}**.`
        : 'Support request recorded.'
    ]

    acknowledgement.push('A moderator will follow up as soon as possible.')

    await interaction.reply({
      content: acknowledgement.join(' '),
      ephemeral: interaction.inGuild()
    })
  } catch (error) {
    console.error('Failed to open support request:', error)
    await interaction.reply({
      content: error?.message ?? 'I could not create that support request. Please try again later.',
      ephemeral: interaction.inGuild()
    })
  } finally {
    cleanupSession(session.id)
  }
}
