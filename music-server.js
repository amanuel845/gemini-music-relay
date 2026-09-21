import { WebSocketServer } from 'ws';
import { GoogleGenAI } from '@google/genai';
import http from 'http';

process.on('unhandledRejection', (r) => console.error('❌ unhandled:', r));
process.on('uncaughtException',  (e) => console.error('❌ uncaught:', e));

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Music relay alive\n');
});

console.log('API key present:', !!process.env.GEMINI_API_KEY);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Serve on /music so the frontend URL can stay consistent
const wss = new WebSocketServer({ server, path: '/music' });

wss.on('connection', async (clientWs) => {
  console.log('--- [music] browser connected ---');
  let session;

  const send = (obj) => {
    try { clientWs.send(JSON.stringify(obj)); } catch (_) {}
  };

  try {
    session = await ai.live.music.connect({
      model: 'models/lyria-realtime-exp',
      callbacks: {
        onmessage: (message) => {
          if (message?.serverContent?.audioChunks) {
            for (const chunk of message.serverContent.audioChunks) {
              if (chunk?.data) send({ type: 'audio', audio: chunk.data });
            }
          } else {
            send({ type: 'server', payload: message });
          }
        },
        onerror: (e) => {
          console.error('   [music] onerror:', e?.message || e);
          send({ type: 'error', message: String(e?.message || e) });
        },
        onclose: (e) => {
          console.log('   [music] onclose:', e?.reason || e);
          send({ type: 'closed' });
          clientWs.close();
        },
      },
    });
    console.log('✅ [music] ai.live.music.connect returned');
  } catch (err) {
    console.error('❌ [music] connect threw:', err);
    send({ type: 'error', message: String(err?.message || err) });
    clientWs.close();
    return;
  }

  send({ type: 'ready' });

  clientWs.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.action === 'prompts' && Array.isArray(msg.prompts)) {
        await session.setWeightedPrompts({
          weightedPrompts: msg.prompts.map((p) => ({
            text: p.text,
            weight: typeof p.weight === 'number' ? p.weight : 1.0,
          })),
        });
        send({ type: 'ack', action: 'prompts' });
      }
      else if (msg.action === 'config') {
        await session.setMusicGenerationConfig({ musicGenerationConfig: msg.config || {} });
        send({ type: 'ack', action: 'config' });
      }
      else if (msg.action === 'play')  { await session.play();  send({ type: 'ack', action: 'play' }); }
      else if (msg.action === 'pause') { await session.pause(); send({ type: 'ack', action: 'pause' }); }
      else if (msg.action === 'stop')  { await session.stop();  send({ type: 'ack', action: 'stop' }); }
      else if (msg.action === 'reset') { await session.resetContext(); send({ type: 'ack', action: 'reset' }); }
    } catch (e) {
      console.error('❌ [music] forward error:', e);
      send({ type: 'error', message: e.message });
    }
  });

  clientWs.on('close', () => { try { session.close(); } catch (_) {} });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log('🎵 Music relay listening on :' + PORT));
