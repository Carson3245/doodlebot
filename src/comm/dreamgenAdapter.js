import { callDreamGen } from '../chat/providers/dreamgen.js'

const DEFAULT_DM_FALLBACK = 'Unable to deliver message.'

export function createDreamGenAdapter(client) {
  const defaultGuildId = process.env.GUILD_ID ?? null

  async function resolveGuild(guildId) {
    const targetId = guildId ?? defaultGuildId
    if (!targetId) {
      throw new Error('Guild context is required for this action.')
    }
    const cached = client.guilds.cache.get(targetId)
    if (cached) {
      return cached
    }
    return client.guilds.fetch(targetId)
  }

  async function deliverDm(userId, text) {
    const user = await client.users.fetch(userId)
    if (!user) {
      throw new Error('Target user not found.')
    }
    await user.send({ content: text }).catch((error) => {
      throw new Error(error?.message ?? DEFAULT_DM_FALLBACK)
    })
  }

  return {
    async dm(userId, text, { prompt } = {}) {
      const message =
        text ??
        (await callDreamGen({
          messages: [
            {
              role: 'system',
              content:
                prompt ??
                'You are DreamGen, a Discord moderation assistant. Write a short and direct message to the user.'
            }
          ]
        }))
      await deliverDm(userId, message)
    },

    async post(channelId, text) {
      const channel = await client.channels.fetch(channelId)
      if (!channel || !channel.isTextBased?.()) {
        throw new Error('Channel not found or not text-based.')
      }
      await channel.send({ content: text })
    },

    async timeout(userId, seconds, reason, guildId = null) {
      const guild = await resolveGuild(guildId)
      const member = await guild.members.fetch(userId)
      if (!member) {
        throw new Error('Member not found for timeout.')
      }
      await member.timeout(seconds * 1000, reason)
    },

    async kick(userId, reason, guildId = null) {
      const guild = await resolveGuild(guildId)
      await guild.members.kick(userId, reason ?? undefined)
    },

    async ban(userId, days = 0, reason, guildId = null) {
      const guild = await resolveGuild(guildId)
      await guild.members.ban(userId, { deleteMessageDays: days ?? 0, reason: reason ?? undefined })
    }
  }
}
