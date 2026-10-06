// TCP proxy :LISTEN -> :TARGET with a control port. GET /down makes every
// connection fail (and kills open ones), GET /up restores. Simulates a phone
// losing signal without relying on the browser's offline emulation.
import net from 'node:net';
import http from 'node:http';

const LISTEN = Number(process.env.LISTEN ?? 5393);
const TARGET = Number(process.env.TARGET ?? 5390);
const CONTROL = Number(process.env.CONTROL ?? 5394);
let down = false;
const open = new Set();

net
  .createServer((client) => {
    if (down) return client.destroy();
    const upstream = net.connect(TARGET, '127.0.0.1');
    open.add(client);
    open.add(upstream);
    const done = () => {
      open.delete(client);
      open.delete(upstream);
      client.destroy();
      upstream.destroy();
    };
    client.on('error', done).on('close', done);
    upstream.on('error', done).on('close', done);
    client.pipe(upstream).pipe(client);
  })
  .listen(LISTEN);

http
  .createServer((req, res) => {
    if (req.url === '/down') {
      down = true;
      for (const s of open) s.destroy();
      open.clear();
    } else if (req.url === '/up') down = false;
    res.end(down ? 'down' : 'up');
  })
  .listen(CONTROL);
console.log(`proxy ${LISTEN} -> ${TARGET}, control ${CONTROL}`);
