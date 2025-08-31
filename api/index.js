export default function handler(req, res) {
    if (req.method === 'GET') {
        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RemarkAI Bot</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 2rem;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: white;
        }
        .container {
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 2rem;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
        }
        h1 { font-size: 3rem; margin-bottom: 1rem; text-align: center; }
        .subtitle { font-size: 1.2rem; text-align: center; margin-bottom: 2rem; opacity: 0.9; }
        .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.5rem; margin: 2rem 0; }
        .feature {
            background: rgba(255, 255, 255, 0.1);
            padding: 1.5rem;
            border-radius: 15px;
            text-align: center;
        }
        .feature h3 { margin-bottom: 0.5rem; }
        .commands {
            background: rgba(0, 0, 0, 0.2);
            padding: 1.5rem;
            border-radius: 15px;
            margin: 2rem 0;
        }
        .commands h3 { margin-bottom: 1rem; }
        .command { 
            background: rgba(255, 255, 255, 0.1);
            padding: 0.5rem 1rem;
            border-radius: 8px;
            margin: 0.5rem 0;
            font-family: 'Monaco', 'Menlo', monospace;
        }
        .status {
            text-align: center;
            padding: 1rem;
            background: rgba(0, 255, 0, 0.2);
            border-radius: 10px;
            margin-bottom: 2rem;
        }
        a { color: #fff; text-decoration: underline; }
    </style>
</head>
<body>
    <div class="container">
        <div class="status">
            🤖 Bot Status: <strong>Online & Ready</strong>
        </div>
        
        <h1>🤖 RemarkAI Bot</h1>
        <p class="subtitle">AI-powered discourse mapping for Discord communities</p>
        
        <div class="features">
            <div class="feature">
                <h3>🎯 Smart Claims</h3>
                <p>Generate AI-powered discussion topics and claims</p>
            </div>
            <div class="feature">
                <h3>💬 Thread Creation</h3>
                <p>Automatically create organized discussion threads</p>
            </div>
            <div class="feature">
                <h3>🗺️ Discourse Mapping</h3>
                <p>Visualize conversation flow and arguments</p>
            </div>
        </div>
        
        <div class="commands">
            <h3>Available Commands:</h3>
            <div class="command">/draft [topic] - Generate structured discourse stanzas</div>
            <div class="command">/stanza [topic] - Create structured discourse thread</div>
            <div class="command">/propose [text] - Create a simple discussion thread</div>
            <div class="command">/map - View discourse map for current thread</div>
        </div>
        
        <p style="text-align: center; margin-top: 2rem;">
            <a href="https://github.com/jonas-kgomo/remarker-bot" target="_blank">View on GitHub</a> | 
            <a href="/interactions">API Endpoint</a>
        </p>
    </div>
</body>
</html>`;
        
        res.setHeader('Content-Type', 'text/html');
        return res.status(200).send(html);
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
}