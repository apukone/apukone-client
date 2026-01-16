import http2 from 'http2';

export const ApukoneClient = ({ host, token, onMessage }) => {
  const MESSAGE_ENDPOINT = `/api/agents/messages`;

  let client;
  let req;
  let reconnectTimer;
  const RECONNECT_DELAY = 1000;

  const connectSSE = () => {
    console.log(`Connecting to SSE at ${host}...`);

    client = http2.connect(`${host}`);

    client.on('error', (err) => {
      console.error('Client error:', err);
      cleanup();
      scheduleReconnect();
    });

    req = client.request({
      ':method': 'GET',
      ':path': MESSAGE_ENDPOINT,
      'accept': 'text/event-stream',
      'authorization': `Bearer ${token}`
    });

    req.setEncoding('utf8');

    let buffer = '';

    req.on('data', async (chunk) => {
      // console.log("Received chunk:", chunk); 
      // Uncomment for debugging

      buffer += chunk;

      // SSE events are separated by double newline
      const parts = buffer.split('\n\n');
      buffer = parts.pop(); // Keep the incomplete part in the buffer

      for (const part of parts) {
        if (!part.trim()) continue;

        // Skip comments like ": connected"
        if (part.startsWith(':')) continue;

        const lines = part.split('\n');

        const dataLine = lines.find(line => line.startsWith('data: '));
        if (dataLine) {
          const rawData = dataLine.substring(6); // remove "data: "
          try {
            const payload = JSON.parse(rawData);

            const { agent_id, chat_id, content } = payload;

            if (onMessage && agent_id && chat_id && content) {
              console.log("Message received. Processing payload:", payload);

              // The content from backend is a stringified JSON array of messages
              let messages = [];
              try {
                messages = JSON.parse(content);
              } catch (err) {
                console.error("Failed to parse message content:", err);
              }

              const processedMessage = await onMessage(messages);

              // Send response via HTTP/2 stream
              try {
                const responseBody = JSON.stringify({
                  chat_id,
                  agent_id,
                  message: processedMessage
                });
                const responseBuffer = Buffer.from(responseBody);

                const postReq = client.request({
                  ':method': 'POST',
                  ':path': '/api/inference/finalize',
                  'authorization': `Bearer ${token}`,
                  'content-type': 'application/json',
                  'content-length': responseBuffer.length
                });

                postReq.setEncoding('utf8');
                postReq.on('response', (headers) => {
                  // console.log("Finalize response headers:", headers);
                  const status = headers[':status'];
                  if (status && status !== 200) {
                    console.error(`Error sending response: Status ${status}`);
                    // We can read body to see error message
                  }
                });
                postReq.on('data', (d) => {
                  // console.log("Finalize response data:", d);
                });
                postReq.on('end', () => {
                  console.log("Response sent successfully.");
                });
                postReq.on('error', (e) => {
                  console.error("Error sending response:", e);
                });

                postReq.write(responseBuffer);
                postReq.end();

              } catch (e) {
                console.error("Error creating response request:", e);
              }
            }
          } catch (e) {
            console.error("Error processing message:", e);
          }
        }
      }
    });

    req.on('end', () => {
      console.log('Stream ended.');
      cleanup();
      scheduleReconnect();
    });

    req.on('error', (err) => {
      console.error('Stream error:', err);
      cleanup();
      scheduleReconnect();
    });

    req.end();
  };

  const cleanup = () => {
    if (req) {
      try { req.close(); } catch (e) { }
      req = null;
    }
    if (client) {
      try { client.close(); } catch (e) { }
      client = null;
    }
  };

  const scheduleReconnect = () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectSSE, RECONNECT_DELAY);
  };

  connectSSE();
};
