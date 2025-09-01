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
            'User-Agent': 'RemarkAI',
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

// Generate structured stanzas for discourse
async function generateStanzas(topic) {
    const prompt = `Create a structured discourse starter about "${topic}" with:
1. A main claim (1-2 sentences)
2. Three supporting points (each 1 sentence)
3. One potential counterargument (1 sentence)
4. A thought-provoking question to encourage discussion

Format as:
CLAIM: [main claim]
SUPPORT 1: [supporting point]
SUPPORT 2: [supporting point] 
SUPPORT 3: [supporting point]
COUNTER: [counterargument]
QUESTION: [discussion question]`;

    try {
        const model = ai.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
        const response = await model.generateContent(prompt);
        
        return response.response.text();
    } catch (error) {
        console.error('Stanza generation error:', error);
        return null;
    }
}

// Parse stanzas into structured format
function parseStanzas(text) {
    const lines = text.split('\n').filter(line => line.trim());
    const stanzas = {};
    
    lines.forEach(line => {
        if (line.startsWith('CLAIM:')) stanzas.claim = line.replace('CLAIM:', '').trim();
        if (line.startsWith('SUPPORT 1:')) stanzas.support1 = line.replace('SUPPORT 1:', '').trim();
        if (line.startsWith('SUPPORT 2:')) stanzas.support2 = line.replace('SUPPORT 2:', '').trim();
        if (line.startsWith('SUPPORT 3:')) stanzas.support3 = line.replace('SUPPORT 3:', '').trim();
        if (line.startsWith('COUNTER:')) stanzas.counter = line.replace('COUNTER:', '').trim();
        if (line.startsWith('QUESTION:')) stanzas.question = line.replace('QUESTION:', '').trim();
    });
    
    return stanzas;
}

// Create thread with structured stanzas
async function createThread(channelId, content, isStanza = false) {
    let threadName, embed;
    
    if (isStanza) {
        const stanzas = parseStanzas(content);
        threadName = `🧠 Discourse: ${stanzas.claim?.slice(0, 30) || 'Discussion'}...`;
        
        embed = {
            title: '🧠 Structured Discourse Starter',
            fields: [
                { name: '📍 Main Claim', value: stanzas.claim || 'No claim provided', inline: false },
                { name: '✅ Supporting Points', value: `• ${stanzas.support1 || 'N/A'}\n• ${stanzas.support2 || 'N/A'}\n• ${stanzas.support3 || 'N/A'}`, inline: false },
                { name: '⚠️ Potential Counter', value: stanzas.counter || 'No counter provided', inline: false },
                { name: '🤔 Discussion Question', value: stanzas.question || 'What are your thoughts?', inline: false }
            ],
            footer: { text: 'React with 👍 to support, 👎 to challenge, or 🤔 to question. Reply to continue the discourse!' },
            color: 0x7289DA
        };
    } else {
        threadName = `💬 Proposal: ${content.slice(0, 40)}...`;
        embed = {
            title: '🤖 AI-Generated Claim',
            description: `>>> ${content}`,
            footer: { text: 'Reply below to support, challenge, or question this claim.' },
            color: 0x00AE86
        };
    }
    
    const thread = await discordRequest(`channels/${channelId}/threads`, {
        method: 'POST',
        body: {
            name: threadName,
            type: 11, // PUBLIC_THREAD
        }
    });
    
    const threadData = await thread.json();
    
    const components = [{
        type: 1, // ACTION_ROW
        components: [
            {
                type: 2, // BUTTON
                style: 2, // SECONDARY
                label: 'Edit Content',
                emoji: { name: '✏️' },
                custom_id: 'edit_claim'
            },
            {
                type: 2,
                style: 1, // PRIMARY
                label: 'Add Response',
                emoji: { name: '💭' },
                custom_id: 'add_response'
            },
            {
                type: 2,
                style: 3, // SUCCESS
                label: 'Validate Graph',
                emoji: { name: '✅' },
                custom_id: 'validate_graph'
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
        content: isStanza ? content : content,
        stance: 'claim',
        children: [],
        threadId: threadData.id,
        isStanza: isStanza
    };
    
    // Send follow-up encouragement message
    setTimeout(async () => {
        await discordRequest(`channels/${threadData.id}/messages`, {
            method: 'POST',
            body: {
                content: "👋 I'm here to help facilitate this discourse! Feel free to:\n• Share your perspective\n• Ask clarifying questions\n• Challenge any points\n• Build on the ideas presented\n\nLet's explore this topic together! 🚀"
            }
        });
    }, 2000);
    
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
            
            try {
                const stanzaText = await generateStanzas(topic);
                
                if (!stanzaText) {
                    return res.json({
                        type: 4,
                        data: {
                            content: 'Could not generate discourse stanzas. Try a different topic.',
                            flags: 64
                        }
                    });
                }
                
                const stanzas = parseStanzas(stanzaText);
                
                const embed = {
                    title: '🎯 Generated Discourse Stanzas',
                    fields: [
                        { name: '📍 Main Claim', value: stanzas.claim || 'No claim generated', inline: false },
                        { name: '✅ Supporting Points', value: `• ${stanzas.support1 || 'N/A'}\n• ${stanzas.support2 || 'N/A'}\n• ${stanzas.support3 || 'N/A'}`, inline: false },
                        { name: '⚠️ Counter Perspective', value: stanzas.counter || 'No counter generated', inline: false },
                        { name: '🤔 Discussion Starter', value: stanzas.question || 'What are your thoughts?', inline: false }
                    ],
                    footer: { text: 'Use /stanza to create a structured discourse thread with these elements' },
                    color: 0x7289DA
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
                        content: 'Error generating discourse stanzas. Please try again.',
                        flags: 64
                    }
                });
            }
        }
        
        else if (name === 'stanza') {
            const topic = options.find(opt => opt.name === 'topic').value;
            
            try {
                const stanzaText = await generateStanzas(topic);
                
                if (!stanzaText) {
                    return res.json({
                        type: 4,
                        data: {
                            content: 'Could not generate discourse stanzas. Try a different topic.',
                            flags: 64
                        }
                    });
                }
                
                const thread = await createThread(channel_id, stanzaText, true);
                return res.json({
                    type: 4,
                    data: {
                        content: `🧠 Structured discourse thread created: <#${thread.id}>\n\nI'll be monitoring the discussion and can help validate the discourse graph as it develops!`,
                        flags: 64
                    }
                });
                
            } catch (error) {
                console.error('Stanza error:', error);
                return res.json({
                    type: 4,
                    data: {
                        content: 'Error creating discourse thread. Please check bot permissions.',
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
        const { custom_id, message } = data;
        
        if (custom_id === 'edit_claim') {
            return res.json({
                type: 9, // MODAL
                data: {
                    title: 'Edit Content',
                    custom_id: 'edit_modal',
                    components: [{
                        type: 1, // ACTION_ROW
                        components: [{
                            type: 4, // TEXT_INPUT
                            custom_id: 'new_wording',
                            label: 'New content:',
                            style: 2, // PARAGRAPH
                            required: true,
                            max_length: 1000
                        }]
                    }]
                }
            });
        }
        
        else if (custom_id === 'add_response') {
            return res.json({
                type: 9, // MODAL
                data: {
                    title: 'Add Your Response',
                    custom_id: 'response_modal',
                    components: [
                        {
                            type: 1, // ACTION_ROW
                            components: [{
                                type: 4, // TEXT_INPUT
                                custom_id: 'response_type',
                                label: 'Response type (support/challenge/question):',
                                style: 1, // SHORT
                                required: true,
                                max_length: 20
                            }]
                        },
                        {
                            type: 1, // ACTION_ROW
                            components: [{
                                type: 4, // TEXT_INPUT
                                custom_id: 'response_content',
                                label: 'Your response:',
                                style: 2, // PARAGRAPH
                                required: true,
                                max_length: 500
                            }]
                        }
                    ]
                }
            });
        }
        
        else if (custom_id === 'validate_graph') {
            const threadId = message.channel_id;
            const nodes = Object.values(graph).filter(node => node.threadId === threadId);
            
            if (nodes.length === 0) {
                return res.json({
                    type: 4,
                    data: {
                        content: '🔍 No discourse data found yet. Start the conversation and I\'ll help map the discourse graph!',
                        flags: 64
                    }
                });
            }
            
            const validationEmbed = {
                title: '✅ Discourse Graph Validation',
                description: `Found ${nodes.length} discourse node(s) in this thread.`,
                fields: nodes.map((node, i) => ({
                    name: `Node ${i + 1}: ${node.stance.toUpperCase()}`,
                    value: `${node.content.slice(0, 100)}${node.content.length > 100 ? '...' : ''}`,
                    inline: false
                })),
                footer: { text: 'Continue the discussion to build a richer discourse graph!' },
                color: 0x00FF00
            };
            
            return res.json({
                type: 4,
                data: {
                    embeds: [validationEmbed],
                    content: '🎯 **Graph Status**: Looking good! Keep the discourse flowing to create more connections.',
                    flags: 64
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
                title: '🤖 Content (Edited)',
                description: `>>> ${newWording}`,
                footer: { text: 'Reply below to support, challenge, or question this content.' },
                color: 0x00AE86
            };
            
            return res.json({
                type: 7, // UPDATE_MESSAGE
                data: {
                    embeds: [embed]
                }
            });
        }
        
        else if (custom_id === 'response_modal') {
            const responseType = components[0].components[0].value.toLowerCase();
            const responseContent = components[1].components[0].value;
            
            // Validate response type
            const validTypes = ['support', 'challenge', 'question'];
            const stance = validTypes.includes(responseType) ? responseType : 'comment';
            
            // Create response embed
            const responseEmbed = {
                title: `💭 ${stance.charAt(0).toUpperCase() + stance.slice(1)} Response`,
                description: responseContent,
                footer: { text: 'This response has been added to the discourse graph.' },
                color: stance === 'support' ? 0x00FF00 : stance === 'challenge' ? 0xFF0000 : 0xFFFF00
            };
            
            // Store in graph (simplified for now)
            const messageId = Date.now().toString();
            graph[messageId] = {
                parent: req.body.message?.id || null,
                authorTag: req.body.member?.user?.username || 'user',
                content: responseContent,
                stance: stance,
                children: [],
                threadId: req.body.channel_id
            };
            
            return res.json({
                type: 4,
                data: {
                    embeds: [responseEmbed],
                    content: `🎯 Great ${stance}! I've added this to our discourse graph. The conversation is building nicely! 🚀`
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