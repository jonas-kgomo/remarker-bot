# RemarkAI Bot

AI-powered discourse analysis bot for Discord.

## Bot Invite URL
```
https://discord.com/api/oauth2/authorize?client_id=1411682165779075174&permissions=3941734153713728&scope=bot
```

## Commands
- `/propose <text>` - Create a thread with an AI claim
- `/draft <topic>` - Generate 3 AI claims about a topic  
- `/map` - Show discourse graph for current thread

## Setup
1. `npm install`
2. Add your Discord bot token to `.env`
3. `npm start`
A discord bot for remarkable intervention


The bot will have all the sophisticated AI features:

`/propose` - Create AI claim threads
`/draft` - Generate 3 claims and let users pick
`/map` - Show discourse graph

Auto-classification of replies as support/challenge/question
Editable claims with the ✏️ button



Now set up your Vercel deployment:
1. Add environment variables in Vercel dashboard:
DISCORD_TOKEN: Your bot token
GEMINI_API_KEY: Your Gemini API key
PUBLIC_KEY: Your Discord app's public key
CLIENT_ID: Your Discord app's client ID
2. Register commands (run this once):
node register-commands.js
3. Set your Interactions Endpoint URL in Discord:
Go to Discord Developer Portal → Your App → General Information → Interactions Endpoint URL:

https://your-vercel-app.vercel.app/interactions
4. Deploy to Vercel:
vercel --prod
What's your Vercel app URL?
Once you tell me your Vercel URL, I can help you:

Test the endpoint
Configure the Discord webhook
Make sure everything works
The Vercel serverless approach is perfect for Discord bots because:

✅ Zero cold start issues with Discord webhooks
✅ Automatic scaling
✅ Free tier is generous
✅ Global edge network
✅ Easy deployments via git
What's your Vercel deployment URL?