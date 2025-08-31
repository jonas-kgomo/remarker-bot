const express = require('express');
const { verifyKeyMiddleware, InteractionType, InteractionResponseType } = require('discord-interactions');
const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Gemini AI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Discourse graph storage
let graph = {};
const GRAPH_FILE = 'discourse_graph.json';

// Load/save graph functions
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

function saveGraph() {
    fs.writeFileSync(GRAPH_FILE, JSON.stringify(graph, null, 2));
}

// Discord API helper
async function discordRequest(endpoint, options) {
    const url = 'https://discord.com/api/v10/' + endpoint;
    
    if (options.body) options.body = JSON.stringify(options.body);
    
    const res = await fetch(url, {
        headers: {
            Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'User-Agent': 'RemarkAI Bot',
        },
        ...options
    });
    
    if (!res.ok) {
        const data = await res.json();
        console.log(res.status);
        throw new Error(JSON.stringify(data));
    }
    
    return res;
}

// Create thread helper
async function createThread(channelId, claim) {
    const thread = await discordRequest(`channels/${channelId}/threads`, {
        method: 'POST',
        body: {
            name: `💬 Proposal: ${claim.slice(0, 40)}...`,
            type: 11, // PUBLIC_THREAD
        }
    });
    
    const threadData = await thread.json();
    
    // Send starter message
    const embed = {
        title: '🤖 AI-Generated Claim (Editable)',
        description: `>>> ${claim}`,
        footer: { text: 'Reply below to support, challenge, or question this claim.' },
        color: 0x00AE86
    };
    
    const components = [{
        type: 1, // ACTION_ROW
        components: [
            {
                type: 2, // BUTTON
                style: 2, // SECONDARY
                label: 'Edit Wording',
                emoji: { name: '✏️' },
                custom_id: 'edit_claim'
            },
            {
                type: 2,
                style: 1, // PRIMARY
                label: 'Fork Claim',
                emoji: { name: '🔀' },
                custom_id: 'fork_claim'
            },
            {
                type: 2,
                style: 4, // DANGER
                label: 'Delete',
                emoji: { name: '❌' },
                custom_id: 'delete_claim'
            }
        ]
    }];
    
    const message = await discordRequest(`channels/${threadData.id}/messages`, {
        method: 'POST',
        body: {
            embeds: [embed],
            components: components
        }
    });
    
    const messageData = await message.json();
    
    // Pin the message
    await discordRequest(`channels/${threadData.id}/pins/${messageData.id}`, {
        method: 'PUT'
    });
    
    // Store in graph
    graph[messageData.id] = {
        parent: null,
        authorTag: 'ai',
        content: claim,
        stance: 'claim',
        children: [],
        threadId: threadData.id
    };
    saveGraph();
    
    return threadData;
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
        return 'question';
    } catch (error) {
        console.error('Classification error:', error);
        return 'question';
    }
}

// Middleware to verify Discord requests
app.use('/interactions', verifyKeyMiddleware(process.env.PUBLIC_KEY));

// Health check endpoint
app.get('/', (req, res) => {
    res.send('RemarkAI Bot is running! 🤖');
});

// Main interactions endpoint
app.post('/interactions', async (req, res) => {
    const { type, data, member, channel_id } = req.body;
    
    // Handle ping
    if (type === InteractionType.PING) {
        return res.send({ type: InteractionResponseType.PONG });
    }
    
    // Handle slash commands
    if (type === InteractionType.APPLICATION_COMMAND) {
        const { name, options } = data;
        
        if (name === 'propose') {
            const text = options.find(opt => opt.name === 'text').value;
            
            try {
                const thread = await createThread(channel_id, text);
                return res.send({
                    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                    data: {
                        content: `Thread created: <#${thread.id}>`,
                        flags: 64 // EPHEMERAL
                    }
                });
            } catch (error) {
                console.error('Propose error:', error);
                return res.send({
                    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                    data: {
                        content: 'Error creating thread. Please check bot permissions.',
                        flags: 64
                    }
                });
            }
        }
        
        else if (name === 'draft') {
            const topic = options.find(opt => opt.name === 'topic').value;
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
                    return res.send({
                        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                        data: {
                            content: 'Could not generate claims. Try a different topic.',
                            flags: 64
                        }
                    });
                }
                
                const embed = {
                    title: '🎯 AI-Generated Claims',
                    description: lines.map((line, i) => `${i + 1}️⃣ ${line.replace(/^\d+\.?\s*/, '')}`).join('\n\n'),
                    footer: { text: 'Use /propose with your chosen claim to create a thread' },
                    color: 0x00AE86
                };
                
                return res.send({
                    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                    data: {
                        embeds: [embed],
                        flags: 64
                    }
                });
                
            } catch (error) {
                console.error('Draft error:', error);
                return res.send({
                    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                    data: {
                        content: 'Error generating claims. Please try again.',
                        flags: 64
                    }
                });
            }
        }
        
        else if (name === 'map') {
            // Show discourse graph for current thread
            const threadId = channel_id;
            const nodes = Object.values(graph).filter(node => node.threadId === threadId);
            
            if (nodes.length === 0) {
                return res.send({
                    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                    data: {
                        content: 'No discourse data found for this thread.',
                        flags: 64
                    }
                });
            }
            
            const embed = {
                title: '🗺️ Discourse Map',
                description: nodes.map(node => 
                    `**${node.stance.toUpperCase()}** (${node.authorTag}): ${node.content.slice(0, 100)}...`
                ).join('\n\n'),
                color: 0x00AE86
            };
            
            return res.send({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                    embeds: [embed],
                    flags: 64
                }
            });
        }
    }
    
    // Handle button interactions
    if (type === InteractionType.MESSAGE_COMPONENT) {
        const { custom_id } = data;
        
        if (custom_id === 'edit_claim') {
            return res.send({
                type: InteractionResponseType.MODAL,
                data: {
                    title: 'Edit Claim',
                    custom_id: 'edit_modal',
                    components: [{
                        type: 1, // ACTION_ROW
                        components: [{
                            type: 4, // TEXT_INPUT
                            custom_id: 'new_wording',
                            label: 'New wording:',
                            style: 2, // PARAGRAPH
                            required: true
                        }]
                    }]
                }
            });
        }
    }
    
    // Handle modal submissions
    if (type === InteractionType.MODAL_SUBMIT) {
        const { custom_id, components } = data;
        
        if (custom_id === 'edit_modal') {
            const newWording = components[0].components[0].value;
            
            const embed = {
                title: '🤖 AI-Generated Claim (Edited)',
                description: `>>> ${newWording}`,
                footer: { text: 'Reply below to support, challenge, or question this claim.' },
                color: 0x00AE86
            };
            
            return res.send({
                type: InteractionResponseType.UPDATE_MESSAGE,
                data: {
                    embeds: [embed]
                }
            });
        }
    }
    
    return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
            content: 'Unknown interaction type.'
        }
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 RemarkAI webhook server listening on port ${PORT}`);
    loadGraph();
});