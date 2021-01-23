const ReconnectingWebSocket = require('reconnecting-websocket');
const WS =                    require('ws');

//////
// WebSocket server setup
function noop() {}

function heartbeat() {
  this.isAlive = true;
}

function parse_message(message) {
  let action = undefined;
  let topic = undefined;
  try {
    message = JSON.parse(message);
    action = message.action;
    topic = message.topic;
  } catch (e) {
    console.error('Error parsing message:');
    console.error(message);
    console.error(e);
    return;
  }
  
  if (action == 'subscribe' && topic == 'confirmation') this.subscribe_confirmations = true;
  else if (action == 'unsubscribe' && topic == 'confirmation') this.subscribe_confirmations = false;
  
  else if (action == 'subscribe' && topic == 'cps') this.subscribe_cps = true;
  else if (action == 'unsubscribe' && topic == 'cps') this.subscribe_cps = false;
}

const wss = new WS.Server({ port: process.env.PORT });

wss.on('connection', function connection(ws, req) {
  ws.isAlive = true;
  ws.on('pong', heartbeat);
  ws.on('message', parse_message);
});

const interval = setInterval(function ping() {
  wss.clients.forEach(function each(ws) {
    if (ws.isAlive === false) return ws.terminate();

    ws.isAlive = false;
    ws.ping(noop);
  });
}, 30000);

wss.on('close', function close() {
  clearInterval(interval);
});

// Block bucket; fills with blocks to be dumped to emit all
let block_bucket = [];
function block_dump() {
      if (block_bucket.length == 0) return;

      let data = {
	      dtg: new Date(),
	      topic: 'confirmation',
	      cps: get_cps(),
	      blocks: block_bucket,
	      duration: Number(process.env.BLOCK_DUMP_PERIODICITY)
      }
      wss.clients.forEach(function each(client) {
        if (client !== ws && client.readyState === WS.OPEN && client.subscribe_confirmations == true) {
          client.send(JSON.stringify(data));
        }
      });
      block_bucket = [];
}
setInterval(block_dump, Number(process.env.BLOCK_DUMP_PERIODICITY));

// Confirmations per second
let blocks = new Array(30).fill(0);
setInterval(update_cps, 1*1000);

function update_cps() {
      // Every second update the array
      blocks = blocks.slice(1,);
      blocks.push(0);
}

function get_cps() {
      let cps = blocks.reduce(function(a, b) { return a + b; }, 0) / blocks.length;
      return cps;
}

var cps_emit = setInterval(function() {
  wss.clients.forEach(function each(client) {
    if (client !== ws && client.readyState === WS.OPEN && client.subscribe_cps == true) {
      client.send(JSON.stringify({
        dtg: new Date(),
        topic: 'cps',
        cps: get_cps(),
        seconds: blocks.length,
      }));
    }
  });
}, process.env.CPS_PERIODICITY);

//////
// Messaging

// Connect to this host
let ws_host = 'ws://localhost:7078'

// Create a websocket and reconnect if broken
ws = new ReconnectingWebSocket(ws_host, [], {
  WebSocket: WS,
  connectionTimeout: 1000,
  maxRetries: Infinity,
  maxReconnectionDelay: 8000,
  minReconnectionDelay: 3000
});

// A tracked account was detected
ws.onmessage = msg => {
  if (typeof msg.data === 'string') {
      let data = JSON.parse(msg.data);
      if (data.topic == 'confirmation') {
           block_bucket.push(data.message);
           blocks[blocks.length-1] += 1;
      }
      // console.log(msg.data)
  }
}

// As soon as we connect, subscribe to confirmations
ws.onopen = () => {
  console.log('WebSocket Client Connected')
  if (ws.readyState === ws.OPEN) {
    let msg = {
            "action": "subscribe",
            "topic": "confirmation",
	    "options": {
		    "confirmation_type": "all"
	    }
          }
    ws.send(JSON.stringify(msg))
  }
}
ws.onclose = () => {
  console.log("WebSocket Client Closed")
}
ws.onerror = (e) => {
  console.error("Websocket: " + e.error)
}