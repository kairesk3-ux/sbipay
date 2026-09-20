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
    mongoConnection = mongoClient.connect()
      .then(() => mongoClient.db(mongoDatabase))
      .catch(error => {
        mongoConnection = null;
        mongoClient = null;
        throw error;
      });
  }
  return mongoConnection;
};

const nextUserId = async database => {
  const latestUser = await database.collection('users').aggregate([
    {$project: {numericId: {$convert: {input: '$userId', to: 'long', onError: 0, onNull: 0}}}},
    {$sort: {numericId: -1}},
    {$limit: 1}
  ]).next();
  const minimum = Math.max(284040, Number(latestUser?.numericId || 0));
  const counters = database.collection('counters');
  await counters.updateOne({_id: 'users'}, {$max: {value: minimum}}, {upsert: true});
  const counter = await counters.findOneAndUpdate(
    {_id: 'users'},
    {$inc: {value: 1}},
    {upsert: true, returnDocument: 'after'}
  );
  return String(counter.value || 284041);
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
  if (request.method === 'GET' && pathname === '/api/team') {
    try {
      const ownerCode = String(new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`).searchParams.get('ownerCode') || '').trim();
      if (!ownerCode) return json(response, 400, {error: 'Owner code is required'});
      const users = (await getDatabase()).collection('users');
      const projection = {projection: {username: 1, userId: 1, inviteCode: 1, ownerCode: 1, activity: 1, depositTotal: 1, createdAt: 1}};
      const directMembers = await users.find({ownerCode}, projection).sort({createdAt: 1}).toArray();
      const directCodes = directMembers.map(member => member.inviteCode).filter(Boolean);
      const indirectMembers = directCodes.length ? await users.find({ownerCode: {$in: directCodes}}, projection).sort({createdAt: 1}).toArray() : [];
      const normalize = (member, level) => ({username: member.username, id: member.userId, inviteCode: member.inviteCode, ownerCode: member.ownerCode, level, activity: Number(member.activity || 0), deposit: Number(member.depositTotal || 0), joinedAt: member.createdAt});
      const normalizedDirect = directMembers.map(member => normalize(member, 'B'));
      const normalizedIndirect = indirectMembers.map(member => normalize(member, 'C'));
      return json(response, 200, {directMembers: normalizedDirect, indirectMembers: normalizedIndirect, totalDeposit: [...normalizedDirect, ...normalizedIndirect].reduce((sum, member) => sum + member.deposit, 0)});
    } catch (error) { return json(response, 503, {error: 'Team data is temporarily unavailable.'}); }
  }
  if (request.method === 'POST' && pathname === '/api/user/stats') {
    try {
      const payload = await readBody(request);
      const userId = String(payload.userId || '').trim();
      if (!userId) return json(response, 400, {error: 'User ID is required'});
      const depositTotal = Math.max(0, Number(payload.depositTotal) || 0);
      const activity = Math.max(0, Number(payload.activity) || 0);
      const users = (await getDatabase()).collection('users');
      const result = await users.updateOne({userId}, {$set: {depositTotal, activity}});
      if (!result.matchedCount) return json(response, 404, {error: 'User not found'});
      return json(response, 200, {ok: true});
    } catch (error) { return json(response, 503, {error: 'User statistics are temporarily unavailable.'}); }
  }
  if (request.method === 'POST' && pathname === '/api/register') {
    try {
      const payload = await readBody(request);
      const username = String(payload.username || '').trim();
      const phone = String(payload.phone || '').replace(/\D/g, '');
      const password = String(payload.password || '');
      if (!username || phone.length < 10 || password.length < 6) return json(response, 400, {error: 'Invalid registration details'});
      const database = await getDatabase();
      const users = database.collection('users');
      const bankNumbers = Array.isArray(payload.banks) ? payload.banks.map(bank => String(bank.accountNumber || '')).filter(Boolean) : [];
      const upiIds = Array.isArray(payload.upis) ? payload.upis.map(upi => String(upi.upiId || '')).filter(Boolean) : [];
      const duplicateQuery = {$or: [{phone}, ...bankNumbers.map(accountNumber => ({bankAccount: accountNumber})), ...upiIds.map(upiId => ({upiId}))]};
      if (await users.findOne(duplicateQuery)) return json(response, 409, {error: 'This mobile number, bank account, or UPI is already registered.'});
      if (payload.preflight) return json(response, 200, {ok: true});
      const userId = await nextUserId(database);
      const inviteCode = `SBI${userId}`;
      const ownerCode = String(payload.ownerCode || '');
      await users.insertOne({username, phone, passwordHash: await hashPassword(password), userId, inviteCode, ownerCode, bankAccount: bankNumbers[0] || '', upiId: upiIds[0] || '', createdAt: new Date()});
      return json(response, 201, {ok: true, userId, inviteCode, ownerCode});
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
