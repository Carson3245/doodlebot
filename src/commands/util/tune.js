import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import {
  PERSONALITY_PRESETS,
  applyCreativityPreset,
  applyPersonalityPreset,
  getCreativityPresetNames,
  getPersonalityPresetNames,
  getStyleSync,
  setCreativityControls,
  toggleFeatureFlag,
  updatePersonalitySections
} from '../../config/styleStore.js';

const FEATURE_CHOICES = [
  { name: 'Chat replies', value: 'chatReplies' },
  { name: 'Brain tracking', value: 'brainTracking' }
];

const creativityPresetChoices = getCreativityPresetNames().map((key) => ({
  name: formatPresetLabel(key),
  value: key
}));

const personalityPresetChoices = getPersonalityPresetNames().map((key) => ({
  name: formatPresetLabel(key),
  value: key
}));

export const data = new SlashCommandBuilder()
  .setName('tune')
  .setDescription('Adjust Doodley\'s creativity, personality, and feature toggles.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommandGroup((group) =>
    group
      .setName('creativity')
      .setDescription('Control how imaginative Doodley is.')
      .addSubcommand((sub) =>
        sub
          .setName('preset')
          .setDescription('Apply a preset creativity level.')
          .addStringOption((option) =>
            option
              .setName('level')
              .setDescription('Preset to apply.')
              .setRequired(true)
              .addChoices(...creativityPresetChoices)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('custom')
          .setDescription('Set the temperature and top-p manually.')
          .addNumberOption((option) =>
            option
              .setName('temperature')
              .setDescription('Between 0.1 (grounded) and 1.2 (wild).')
              .setMinValue(0.1)
              .setMaxValue(1.2)
          )
          .addNumberOption((option) =>
            option.setName('top_p').setDescription('Between 0.1 and 1.0.').setMinValue(0.1).setMaxValue(1)
          )
      )
  )
  .addSubcommandGroup((group) =>
    group
      .setName('feature')
      .setDescription('Enable or disable bot features.')
      .addSubcommand((sub) =>
        sub
          .setName('toggle')
          .setDescription('Toggle a feature on or off.')
          .addStringOption((option) =>
            option.setName('feature').setDescription('Feature to toggle.').setRequired(true).addChoices(...FEATURE_CHOICES)
          )
          .addBooleanOption((option) =>
            option.setName('enabled').setDescription('Whether the feature should be enabled.').setRequired(true)
          )
      )
  )
  .addSubcommandGroup((group) =>
    group
      .setName('personality')
      .setDescription('Update Doodley\'s personality and voice.')
      .addSubcommand((sub) =>
        sub
          .setName('preset')
          .setDescription('Apply a personality preset.')
          .addStringOption((option) =>
            option.setName('preset').setDescription('Preset to apply.').setRequired(true).addChoices(...personalityPresetChoices)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('custom')
          .setDescription('Customize personality fields individually.')
          .addStringOption((option) =>
            option.setName('bio').setDescription('Short bio describing Doodley.')
          )
          .addStringOption((option) =>
            option.setName('pronouns').setDescription('Preferred pronouns, e.g., they/them.')
          )
          .addStringOption((option) =>
            option.setName('tone').setDescription('Voice tone, e.g., warm and whimsical.')
          )
          .addStringOption((option) =>
            option.setName('pace').setDescription('Speech pacing, e.g., steady.')
          )
          .addStringOption((option) =>
            option
              .setName('emoji_flavor')
              .setDescription('Emoji vibe, e.g., sparkles.')
          )
          .addStringOption((option) =>
            option
              .setName('signature_phrases')
              .setDescription('Comma-separated list of phrases to sprinkle in replies.')
          )
          .addBooleanOption((option) =>
            option.setName('uses_nickname').setDescription('Mention the member name in replies?')
          )
          .addBooleanOption((option) =>
            option.setName('adds_signoff').setDescription('Add a sign-off to replies?')
          )
          .addStringOption((option) =>
            option
              .setName('signoff_text')
              .setDescription('Text to use at the end of replies.')
          )
      )
  );

export async function execute(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: 'Você precisa da permissão **Gerenciar Servidor** para ajustar a personalidade do Doodley.',
      ephemeral: true
    });
    return;
  }

  const group = interaction.options.getSubcommandGroup();
  const sub = interaction.options.getSubcommand();

  try {
    await interaction.deferReply({ ephemeral: true });

    if (group === 'creativity') {
      await handleCreativity(interaction, sub);
      return;
    }

    if (group === 'feature') {
      await handleFeature(interaction);
      return;
    }

    if (group === 'personality') {
      await handlePersonality(interaction, sub);
      return;
    }

    await interaction.editReply('Comando desconhecido.');
  } catch (error) {
    console.error('Failed to run /tune command:', error);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply('Algo deu errado ao aplicar as alterações. Veja os logs do servidor.');
    } else {
      await interaction.reply({
        content: 'Algo deu errado ao aplicar as alterações. Veja os logs do servidor.',
        ephemeral: true
      });
    }
  }
}

async function handleCreativity(interaction, sub) {
  if (sub === 'preset') {
    const level = interaction.options.getString('level', true);
    const updated = await applyCreativityPreset(level);
    const creativity = updated.creativity ?? getStyleSync().creativity;
    await interaction.editReply(
      `✨ Criatividade ajustada para **${formatPresetLabel(level)}**.\n` +
        `• Temperatura: \`${creativity.temperature.toFixed(2)}\`\n` +
        `• Top-p: \`${creativity.topP.toFixed(2)}\``
    );
    return;
  }

  if (sub === 'custom') {
    const temperature = interaction.options.getNumber('temperature');
    const topP = interaction.options.getNumber('top_p');

    if (temperature === null && topP === null) {
      await interaction.editReply('Informe pelo menos temperatura ou top-p para personalizar a criatividade.');
      return;
    }

    const result = await setCreativityControls({ temperature, topP });
    await interaction.editReply(
      '🎛️ Criatividade personalizada aplicada.\n' +
        `• Temperatura: \`${result.temperature.toFixed(2)}\`\n` +
        `• Top-p: \`${result.topP.toFixed(2)}\``
    );
    return;
  }

  await interaction.editReply('Subcomando de criatividade não reconhecido.');
}

async function handleFeature(interaction) {
  const featureKey = interaction.options.getString('feature', true);
  const enabled = interaction.options.getBoolean('enabled', true);
  const features = await toggleFeatureFlag(featureKey, enabled);
  const label = FEATURE_CHOICES.find((choice) => choice.value === featureKey)?.name ?? featureKey;
  const status = features[featureKey] ? 'ativado' : 'desativado';
  await interaction.editReply(`🔧 O recurso **${label}** foi ${status}.`);
}

async function handlePersonality(interaction, sub) {
  if (sub === 'preset') {
    const presetKey = interaction.options.getString('preset', true);
    await applyPersonalityPreset(presetKey);
    const chosen = PERSONALITY_PRESETS[presetKey];
    const tone = chosen?.voice?.tone ?? getStyleSync().voice.tone;
    await interaction.editReply(
      `🌟 Personalidade **${formatPresetLabel(presetKey)}** aplicada!\n` +
        `Doodley agora responde com um tom **${tone}**.`
    );
    return;
  }

  if (sub === 'custom') {
    const identityUpdates = {};
    const voiceUpdates = {};
    const responseUpdates = {};
    const summary = [];

    const bio = interaction.options.getString('bio');
    if (bio) {
      identityUpdates.bio = bio;
      summary.push('bio');
    }

    const pronouns = interaction.options.getString('pronouns');
    if (pronouns) {
      identityUpdates.pronouns = pronouns;
      summary.push('pronomes');
    }

    const tone = interaction.options.getString('tone');
    if (tone) {
      voiceUpdates.tone = tone;
      summary.push('tom');
    }

    const pace = interaction.options.getString('pace');
    if (pace) {
      voiceUpdates.pace = pace;
      summary.push('ritmo');
    }

    const emojiFlavor = interaction.options.getString('emoji_flavor');
    if (emojiFlavor) {
      voiceUpdates.emojiFlavor = emojiFlavor;
      summary.push('emoji');
    }

    const signatureRaw = interaction.options.getString('signature_phrases');
    if (signatureRaw) {
      voiceUpdates.signaturePhrases = signatureRaw
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      if (voiceUpdates.signaturePhrases.length > 0) {
        summary.push('frases de efeito');
      }
    }

    const usesNickname = interaction.options.getBoolean('uses_nickname');
    if (usesNickname !== null) {
      responseUpdates.usesNickname = usesNickname;
      summary.push(usesNickname ? 'usar apelido' : 'sem apelido');
    }

    const addsSignOff = interaction.options.getBoolean('adds_signoff');
    if (addsSignOff !== null) {
      responseUpdates.addsSignOff = addsSignOff;
      summary.push(addsSignOff ? 'com despedida' : 'sem despedida');
    }

    const signOffText = interaction.options.getString('signoff_text');
    if (signOffText) {
      responseUpdates.signOffText = signOffText;
      summary.push('texto de despedida');
    }

    const payload = {};
    if (Object.keys(identityUpdates).length > 0) {
      payload.identity = identityUpdates;
    }
    if (Object.keys(voiceUpdates).length > 0) {
      payload.voice = voiceUpdates;
    }
    if (Object.keys(responseUpdates).length > 0) {
      payload.response = responseUpdates;
    }

    if (Object.keys(payload).length === 0) {
      await interaction.editReply('Forneça pelo menos um campo para atualizar a personalidade.');
      return;
    }

    await updatePersonalitySections(payload);
    const summaryText = summary.length > 0 ? summary.join(', ') : 'detalhes';
    await interaction.editReply(`🛠️ Personalidade atualizada (${summaryText}).`);
    return;
  }

  await interaction.editReply('Subcomando de personalidade não reconhecido.');
}

function formatPresetLabel(key) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
