const { verifyKey } = require('discord-interactions');
const { GoogleGenAI } = require('@google/genai');

// Initialize Gemini AI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// In-memory storage for Vercel (you might want to use a database for production)
let graph = {};

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
    
    // Store in graph (in-memory for now)
    graph[messageData.id] = {
        parent: null,
        authorTag: 'ai',
        content: claim,
        stance: 'claim',
        children: [],
        threadId: threadData.id
    };
    
    return threadData;
}

export default async function handler(req, res) {
    // Handle CORS for preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // Health check
    if (req.method === 'GET') {
        return res.status(200).json({ message: 'RemarkAI Bot is running! 🤖' });
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    // Verify Discord signature
    const signature = req.headers['x-signature-ed25519'];
    const timestamp = req.headers['x-signature-timestamp'];
    const body = JSON.stringify(req.body);
    
    const isValidRequest = verifyKey(body, signature, timestamp, process.env.PUBLIC_KEY);
    if (!isValidRequest) {
        return res.status(401).json({ error: 'Bad request signature' });
    }
    
    const { type, data, channel_id } = req.body;
    
    // Handle ping
    if (type === 1) {
        return res.json({ type: 1 });
    }
    
    // Handle slash commands
    if (type === 2) {
        const { name, options } = data;
        
        if (name === 'propose') {
            const text = options.find(opt => opt.name === 'text').value;
            
            try {
                const thread = await createThread(channel_id, text);
                return res.json({
                    type: 4,
                    data: {
                        content: `Thread created: <#${thread.id}>`,
                        flags: 64 // EPHEMERAL
                    }
                });
            } catch (error) {
                console.error('Propose error:', error);
                return res.json({
                    type: 4,
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
                    return res.json({
                        type: 4,
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
                
                return res.json({
                    type: 4,
                    data: {
                        embeds: [embed],
                        flags: 64
                    }
                });
                
            } catch (error) {
                console.error('Draft error:', error);
                return res.json({
                    type: 4,
                    data: {
                        content: 'Error generating claims. Please try again.',
                        flags: 64
                    }
                });
            }
        }
        
        else if (name === 'map') {
            const threadId = channel_id;
            const nodes = Object.values(graph).filter(node => node.threadId === threadId);
            
            if (nodes.length === 0) {
                return res.json({
                    type: 4,
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
            
            return res.json({
                type: 4,
                data: {
                    embeds: [embed],
                    flags: 64
                }
            });
        }
    }
    
    // Handle button interactions
    if (type === 3) {
        const { custom_id } = data;
        
        if (custom_id === 'edit_claim') {
            return res.json({
                type: 9, // MODAL
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
    if (type === 5) {
        const { custom_id, components } = data;
        
        if (custom_id === 'edit_modal') {
            const newWording = components[0].components[0].value;
            
            const embed = {
                title: '🤖 AI-Generated Claim (Edited)',
                description: `>>> ${newWording}`,
                footer: { text: 'Reply below to support, challenge, or question this claim.' },
                color: 0x00AE86
            };
            
            return res.json({
                type: 7, // UPDATE_MESSAGE
                data: {
                    embeds: [embed]
                }
            });
        }
    }
    
    return res.json({
        type: 4,
        data: {
            content: 'Unknown interaction type.'
        }
    });
}