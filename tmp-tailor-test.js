const http = require('http');
const data = JSON.stringify({ cv: 'test', jobDescription: 'test' });
const req = http.request(
  {
    hostname: 'localhost',
    port: 3002,
    path: '/api/tailor-cv',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    },
  },
  (res) => {
    console.log('STATUS', res.statusCode);
    let body = '';
    res.on('data', (chunk) => (body += chunk));
    res.on('end', () => console.log('BODY', body));
  }
);
req.on('error', (err) => console.error('ERROR', err.message));
req.write(data);
req.end();
