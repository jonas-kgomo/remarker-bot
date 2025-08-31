require('dotenv').config();

const commands = [
    {
        name: 'propose',
        description: 'Start a new AI-originated claim thread',
        options: [
            {
                name: 'text',
                description: 'Claim text',
                type: 3, // STRING
                required: true
            }
        ]
    },
    {
        name: 'draft',
        description: 'Generate 3 AI claims about a topic',
        options: [
            {
                name: 'topic',
                description: 'Topic to generate claims about',
                type: 3, // STRING
                required: true
            }
        ]
    },
    {
        name: 'map',
        description: 'Show discourse graph for current thread'
    }
];

async function registerCommands() {
    const url = `https://discord.com/api/v10/applications/${process.env.CLIENT_ID}/commands`;
    
    const response = await fetch(url, {
        method: 'PUT',
        headers: {
            'Authorization': `Bot ${process.env.DISCORD_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(commands),
    });
    
    if (response.ok) {
        console.log('✅ Commands registered successfully');
    } else {
        const error = await response.text();
        console.error('❌ Error registering commands:', error);
    }
}

registerCommands();