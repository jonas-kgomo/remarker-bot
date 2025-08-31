const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { GoogleGenAI } = require('@google/genai');
 
const fs = require('fs');
require('dotenv').config();

// Initialize Gemini AI
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
// Discourse graph storage
let graph = {};
const GRAPH_FILE = 'discourse_graph.json';

// Load existing graph
function loadGraph() {
    try {
        if (fs.existsSync(GRAPH_FILE)) {
            graph = JSON.parse(fs.readFileSync(GRAPH_FILE, 'utf8'));
        }
    } catch (error) {
        console.log('Starting with empty graph');
        graph = {};
    }
}

// Save graph
function saveGraph() {
    fs.writeFileSync(GRAPH_FILE, JSON.stringify(graph, null, 2));
}

// Create client with necessary intents
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ] 
});

// Helper function to spawn thread
async function spawnThread(channel, claim, _interaction) {
    const thread = await channel.threads.create({
        name: `💬 Proposal: ${claim.slice(0, 40)}...`,
        reason: 'Remarker AI proposal'
    });

    const embed = new EmbedBuilder()
        .setTitle('🤖 AI-Generated Claim (Editable)')
        .setDescription(`>>> ${claim}`)
        .setFooter({ text: 'Reply below to support, challenge, or question this claim.' })
        .setColor(0x00AE86);

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('edit_claim')
                .setLabel('Edit Wording')
                .setEmoji('✏️')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('fork_claim')
                .setLabel('Fork Claim')
                .setEmoji('🔀')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('delete_claim')
                .setLabel('Delete')
                .setEmoji('❌')
                .setStyle(ButtonStyle.Danger)
        );

    const starter = await thread.send({ embeds: [embed], components: [row] });
    await starter.pin();

    // Store in graph
    graph[starter.id] = {
        parent: null,
        authorTag: 'ai',
        content: claim,
        stance: 'claim',
        children: [],
        threadId: thread.id
    };
    saveGraph();

    return thread;
}

// Classify response using Gemini
async function classifyResponse(message, parentClaim) {
    try {
        const prompt = `Classify this response to the claim "${parentClaim}":

Response: "${message}"

Classify as exactly one of: support, challenge, question

Only respond with the single word classification.`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash-001',
            contents: prompt,
        });
        const classification = response.text.trim().toLowerCase();
        
        if (['support', 'challenge', 'question'].includes(classification)) {
            return classification;
        }
        return 'question'; // default
    } catch (error) {
        console.error('Classification error:', error);
        return 'question';
    }
}

client.once('clientReady', async () => {
    console.log(`✅ Bot is online! Logged in as ${client.user.tag}`);
    loadGraph();
    
    // Register slash commands
    const commands = [
        new SlashCommandBuilder()
            .setName('propose')
            .setDescription('Start a new AI-originated claim thread')
            .addStringOption(option =>
                option.setName('text')
                    .setDescription('Claim text')
                    .setRequired(true)
            ),
        new SlashCommandBuilder()
            .setName('draft')
            .setDescription('Generate 3 AI claims about a topic')
            .addStringOption(option =>
                option.setName('topic')
                    .setDescription('Topic to generate claims about')
                    .setRequired(true)
            ),
        new SlashCommandBuilder()
            .setName('map')
            .setDescription('Show discourse graph for current thread')
    ];

    try {
        await client.application.commands.set(commands);
        console.log('✅ Slash commands registered');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
});

// Handle slash commands
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        if (commandName === 'propose') {
            try {
                const text = interaction.options.getString('text');
                const thread = await spawnThread(interaction.channel, text, interaction);
                await interaction.reply({ content: `Thread created: ${thread}`, ephemeral: true });
            } catch (error) {
                console.error('Propose error:', error);
                await interaction.reply({ content: 'Error creating thread. Please check bot permissions (Create Threads, Send Messages).', ephemeral: true });
            }
        }

        else if (commandName === 'draft') {
            const topic = interaction.options.getString('topic');
            const prompt = `Give 3 concise one-sentence claims about: ${topic}`;
            
            try {
                const response = await ai.models.generateContent({
                    model: 'gemini-2.0-flash-001',
                    contents: prompt,
                });
                const lines = response.text.trim().split('\n')
                    .filter(line => line.trim() && !line.match(/^\d+\.?\s*$/))
                    .slice(0, 3);

                if (lines.length === 0) {
                    await interaction.reply({ content: 'Could not generate claims. Try a different topic.', ephemeral: true });
                    return;
                }

                const embed = new EmbedBuilder()
                    .setTitle('🎯 AI-Generated Claims')
                    .setDescription(lines.map((line, i) => `${i + 1}️⃣ ${line.replace(/^\d+\.?\s*/, '')}`).join('\n\n'))
                    .setFooter({ text: 'React with a number to create a thread for that claim' })
                    .setColor(0x00AE86);

                await interaction.reply({ embeds: [embed] });
                const fetchedMessage = await interaction.fetchReply();
                
                const emojis = ['1️⃣', '2️⃣', '3️⃣'].slice(0, lines.length);
                
                // Add reactions with error handling
                try {
                    for (const emoji of emojis) {
                        await fetchedMessage.react(emoji);
                    }
                } catch (reactionError) {
                    console.error('Could not add reactions - missing permissions:', reactionError.message);
                    await interaction.followUp({ 
                        content: 'Claims generated but I need "Add Reactions" permission to let you select them. Please use `/propose` with your chosen claim instead.', 
                        ephemeral: true 
                    });
                    return;
                }

                const collector = fetchedMessage.createReactionCollector({ 
                    filter: (reaction, user) => !user.bot && emojis.includes(reaction.emoji.name),
                    max: 1,
                    time: 60000
                });

                collector.on('collect', async (reaction, user) => {
                    try {
                        const idx = emojis.indexOf(reaction.emoji.name);
                        const chosen = lines[idx].replace(/^\d+\.?\s*/, '');
                        const thread = await spawnThread(interaction.channel, chosen, interaction);
                        await interaction.followUp({ content: `${user} created thread: ${thread}`, ephemeral: false });
                    } catch (threadError) {
                        console.error('Thread creation error:', threadError);
                        await interaction.followUp({ content: 'Error creating thread. Please check bot permissions.', ephemeral: true });
                    }
                });

            } catch (error) {
                console.error('Draft error:', error);
                if (!interaction.replied) {
                    await interaction.reply({ content: 'Error generating claims. Please try again.', ephemeral: true });
                }
            }
        }

        else if (commandName === 'map') {
            // Show discourse graph for current thread
            const threadId = interaction.channel.isThread() ? interaction.channel.id : null;
            if (!threadId) {
                await interaction.reply({ content: 'This command only works in threads.', ephemeral: true });
                return;
            }

            const nodes = Object.values(graph).filter(node => node.threadId === threadId);
            if (nodes.length === 0) {
                await interaction.reply({ content: 'No discourse data found for this thread.', ephemeral: true });
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle('🗺️ Discourse Map')
                .setDescription(nodes.map(node => 
                    `**${node.stance.toUpperCase()}** (${node.authorTag}): ${node.content.slice(0, 100)}...`
                ).join('\n\n'))
                .setColor(0x00AE86);

            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
    }

    // Handle button interactions
    else if (interaction.isButton()) {
        if (interaction.customId === 'edit_claim') {
            const modal = new ModalBuilder()
                .setCustomId('edit_modal')
                .setTitle('Edit Claim');

            const textInput = new TextInputBuilder()
                .setCustomId('new_wording')
                .setLabel('New wording:')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            const actionRow = new ActionRowBuilder().addComponents(textInput);
            modal.addComponents(actionRow);

            await interaction.showModal(modal);
        }
    }

    // Handle modal submissions
    else if (interaction.isModalSubmit()) {
        if (interaction.customId === 'edit_modal') {
            const newWording = interaction.fields.getTextInputValue('new_wording');
            
            // Update the message
            const embed = new EmbedBuilder()
                .setTitle('🤖 AI-Generated Claim (Edited)')
                .setDescription(`>>> ${newWording}`)
                .setFooter({ text: 'Reply below to support, challenge, or question this claim.' })
                .setColor(0x00AE86);

            await interaction.update({ embeds: [embed] });

            // Update graph
            if (graph[interaction.message.id]) {
                graph[interaction.message.id].content = newWording;
                saveGraph();
            }
        }
    }
});

// Handle message replies in threads
client.on('messageCreate', async message => {
    if (message.author.bot || !message.channel.isThread()) return;

    // Find the starter message in our graph
    const starterNode = Object.values(graph).find(node => node.threadId === message.channel.id);
    if (!starterNode) return;

    // Classify the response
    const stance = await classifyResponse(message.content, starterNode.content);
    
    // Store in graph
    graph[message.id] = {
        parent: Object.keys(graph).find(key => graph[key] === starterNode),
        authorTag: message.author.username,
        content: message.content,
        stance: stance,
        children: [],
        threadId: message.channel.id
    };

    // Add to parent's children
    if (starterNode) {
        const parentKey = Object.keys(graph).find(key => graph[key] === starterNode);
        if (!graph[parentKey].children.includes(message.id)) {
            graph[parentKey].children.push(message.id);
        }
    }

    saveGraph();

    // React with stance emoji
    const stanceEmojis = {
        'support': '✅',
        'challenge': '❌', 
        'question': '❓'
    };
    
    if (stanceEmojis[stance]) {
        await message.react(stanceEmojis[stance]);
    }
});

client.login(process.env.DISCORD_TOKEN);