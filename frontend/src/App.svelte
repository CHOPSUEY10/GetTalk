<script>
  import env from './config/env.js';
  import { socket } from './lib/socket.js';

  let socketStatus = 'disconnected';

  const connectSocket = () => {
    socket.connect();

    socketStatus = 'connecting';

    socket.once('connect', () => {
      socketStatus = 'connected';
    });

    socket.once('connect_error', () => {
      socketStatus = 'error';
    });
  }
</script>

<main>
  <h1>GetTalk</h1>

  <section>
    <h2>Frontend Bootstrap</h2>

    <p>
      API URL:
      <code>{env.apiUrl}</code>
    </p>

    <p>
      Socket.IO URL:
      <code>{env.socketUrl}</code>
    </p>

    <p>
      Socket status:
      <strong>{socketStatus}</strong>
    </p>

    <button on:click={connectSocket}>
      Connect Socket.IO
    </button>
  </section>
</main>