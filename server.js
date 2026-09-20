const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
let MongoClient;
try { ({MongoClient} = require('mongodb')); } catch (error) { MongoClient = null; }
try { require('dotenv').config(); } catch (error) {}

const root = __dirname;
const port = Number(process.env.PORT) || 10000;
const mongoUri = process.env.MONGODB_URI;
const mongoDatabase = process.env.MONGODB_DB || 'sbipay';
let mongoClient;
let mongoConnection;
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

const json = (response, status, body) => {
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache'});
  response.end(JSON.stringify(body));
};

const readBody = request => new Promise((resolve, reject) => {
  let body = '';
  request.on('data', chunk => {
    body += chunk;
    if (body.length > 1_000_000) request.destroy(new Error('Request body too large'));
  });
  request.on('end', () => {
    try { resolve(JSON.parse(body || '{}')); } catch (error) { reject(error); }
  });
  request.on('error', reject);
});

const getDatabase = async () => {
  if (!MongoClient) throw new Error('MongoDB driver is not installed');
  if (!mongoUri) throw new Error('MONGODB_URI is not configured');
  if (!mongoConnection) {
    mongoClient = new MongoClient(mongoUri, {serverSelectionTimeoutMS: 5000});
    mongoConnection = mongoClient.connect().then(() => mongoClient.db(mongoDatabase));
  }
  return mongoConnection;
};

const hashPassword = password => new Promise((resolve, reject) => {
  const salt = crypto.randomBytes(16);
  crypto.scrypt(password, salt, 64, (error, derivedKey) => {
    if (error) return reject(error);
    resolve(`${salt.toString('hex')}:${derivedKey.toString('hex')}`);
  });
});

const handleApi = async (request, response, pathname) => {
  if (request.method === 'GET' && pathname === '/api/health') {
    try { await getDatabase(); return json(response, 200, {ok: true, database: 'connected'}); }
    catch (error) { return json(response, 503, {ok: false, database: 'unavailable'}); }
  }
  if (request.method === 'POST' && pathname === '/api/register') {
    try {
      const payload = await readBody(request);
      const username = String(payload.username || '').trim();
      const phone = String(payload.phone || '').replace(/\D/g, '');
      const password = String(payload.password || '');
      if (!username || phone.length < 10 || password.length < 6) return json(response, 400, {error: 'Invalid registration details'});
      const users = (await getDatabase()).collection('users');
      const bankNumbers = Array.isArray(payload.banks) ? payload.banks.map(bank => String(bank.accountNumber || '')).filter(Boolean) : [];
      const upiIds = Array.isArray(payload.upis) ? payload.upis.map(upi => String(upi.upiId || '')).filter(Boolean) : [];
      const duplicateQuery = {$or: [{phone}, ...bankNumbers.map(accountNumber => ({bankAccount: accountNumber})), ...upiIds.map(upiId => ({upiId}))]};
      if (await users.findOne(duplicateQuery)) return json(response, 409, {error: 'This mobile number, bank account, or UPI is already registered.'});
      if (payload.preflight) return json(response, 200, {ok: true});
      await users.insertOne({username, phone, passwordHash: await hashPassword(password), userId: String(payload.userId || ''), inviteCode: String(payload.inviteCode || ''), ownerCode: String(payload.ownerCode || ''), bankAccount: bankNumbers[0] || '', upiId: upiIds[0] || '', createdAt: new Date()});
      return json(response, 201, {ok: true});
    } catch (error) { return json(response, 503, {error: 'Registration storage is temporarily unavailable.'}); }
  }
  return false;
};

const server = http.createServer((request, response) => {
  const requestedPath = decodeURIComponent(new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`).pathname);
  if (requestedPath.startsWith('/api/')) {
    handleApi(request, response, requestedPath).catch(() => json(response, 500, {error: 'Request failed'}));
    return;
  }
  const relativePath = requestedPath === '/' ? 'index.html' : requestedPath.replace(/^\/+/, '');
  const filePath = path.resolve(root, relativePath);

  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403, {'Content-Type': 'text/plain; charset=utf-8'});
    response.end('Forbidden');
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      response.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
      response.end('Not found');
      return;
    }

    response.writeHead(200, {
      'Content-Type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(response);
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`SBI PAY server listening on port ${port}`);
});

process.on('SIGTERM', async () => {
  if (mongoClient) await mongoClient.close();
  process.exit(0);
});
