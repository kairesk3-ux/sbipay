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
  const minimum = Math.max(19999, Number(latestUser?.numericId || 0));
  const counters = database.collection('counters');
  await counters.updateOne({_id: 'users'}, {$max: {value: minimum}}, {upsert: true});
  const counter = await counters.findOneAndUpdate(
    {_id: 'users'},
    {$inc: {value: 1}},
    {upsert: true, returnDocument: 'after'}
  );
  return String(counter.value || 20000);
};

const hashPassword = password => new Promise((resolve, reject) => {
  const salt = crypto.randomBytes(16);
  crypto.scrypt(password, salt, 64, (error, derivedKey) => {
    if (error) return reject(error);
    resolve(`${salt.toString('hex')}:${derivedKey.toString('hex')}`);
  });
});

const verifyPassword = (password, storedHash) => new Promise((resolve, reject) => {
  const [saltHex, keyHex] = String(storedHash || '').split(':');
  if (!saltHex || !keyHex) return resolve(false);
  crypto.scrypt(password, Buffer.from(saltHex, 'hex'), 64, (error, derivedKey) => {
    if (error) return reject(error);
    const storedKey = Buffer.from(keyHex, 'hex');
    resolve(storedKey.length === derivedKey.length && crypto.timingSafeEqual(storedKey, derivedKey));
  });
});

const publicProfile = user => ({username: user.username, id: user.userId, inviteCode: user.inviteCode, ownerCode: user.ownerCode, createdAt: user.createdAt});

const fallbackDataPath = path.join(root, 'data', 'admin-store.json');
const ensureFallbackData = () => {
  fs.mkdirSync(path.dirname(fallbackDataPath), {recursive: true});
  if (!fs.existsSync(fallbackDataPath)) {
    fs.writeFileSync(fallbackDataPath, JSON.stringify({users: [], upi: [], payments: []}, null, 2));
  }
  try {
    const data = JSON.parse(fs.readFileSync(fallbackDataPath, 'utf8'));
    if (!Array.isArray(data.users)) data.users = [];
    if (!Array.isArray(data.upi)) data.upi = [];
    if (!Array.isArray(data.payments)) data.payments = [];
    fs.writeFileSync(fallbackDataPath, JSON.stringify(data, null, 2));
    return data;
  } catch (error) {
    const fallback = {users: [], upi: [], payments: []};
    fs.writeFileSync(fallbackDataPath, JSON.stringify(fallback, null, 2));
    return fallback;
  }
};

const seedFallbackData = async () => {
  let data = ensureFallbackData();
  if (data.users.length > 0) return data;
  const seedUsers = [
    {userId: '20030590', username: 'Amit', phone: '9876543210', passwordHash: await hashPassword('admin123'), inviteCode: 'SBI20030590', ownerCode: 'SBI20030000', isActive: true, balance: 1250, depositBalance: 0, status: 'enabled', walletLimit: 5000, createdAt: new Date().toISOString()},
    {userId: '20030591', username: 'Rohit', phone: '9876543211', passwordHash: await hashPassword('admin123'), inviteCode: 'SBI20030591', ownerCode: 'SBI20030590', isActive: true, balance: 870, depositBalance: 0, status: 'enabled', walletLimit: 3500, createdAt: new Date().toISOString()},
    {userId: '20030592', username: 'Sameer', phone: '9876543212', passwordHash: await hashPassword('admin123'), inviteCode: 'SBI20030592', ownerCode: 'SBI20030590', isActive: false, balance: 0, depositBalance: 0, status: 'disabled', walletLimit: 1500, createdAt: new Date().toISOString()},
    {userId: '20030593', username: 'Neha', phone: '9876543213', passwordHash: await hashPassword('admin123'), inviteCode: 'SBI20030593', ownerCode: 'SBI20030591', isActive: true, balance: 2040, depositBalance: 0, status: 'enabled', walletLimit: 4000, createdAt: new Date().toISOString()}
  ];
  const seedUpi = [
    {id: 'upi-1', upiId: 'amit@paytm', ownerUserId: '20030590', ownerName: 'Amit', app: 'Paytm', enabled: true, risk: false, min: 50, max: 5000},
    {id: 'upi-2', upiId: 'rohit@mobikwik', ownerUserId: '20030591', ownerName: 'Rohit', app: 'Mobikwik', enabled: true, risk: true, min: 100, max: 7000},
    {id: 'upi-3', upiId: 'sameer@phonepe', ownerUserId: '20030592', ownerName: 'Sameer', app: 'PhonePe', enabled: false, risk: false, min: 20, max: 2500}
  ];
  const seedPayments = [
    {id: 'pay-1', userId: '20030590', amount: 1500, type: 'deposit', status: 'success', channel: 'Paytm', createdAt: new Date().toISOString()},
    {id: 'pay-2', userId: '20030591', amount: 820, type: 'deposit', status: 'pending', channel: 'Mobikwik', createdAt: new Date().toISOString()},
    {id: 'pay-3', userId: '20030593', amount: 960, type: 'deposit', status: 'success', channel: 'Freecharge', createdAt: new Date().toISOString()}
  ];
  data = {users: seedUsers, upi: seedUpi, payments: seedPayments};
  fs.writeFileSync(fallbackDataPath, JSON.stringify(data, null, 2));
  return data;
};

const normalizeUserForAdmin = user => ({
  userId: String(user.userId || user.id || ''),
  username: user.username || 'Unknown',
  phone: String(user.phone || ''),
  inviteCode: user.inviteCode || '',
  ownerCode: user.ownerCode || '',
  isActive: user.isActive !== false,
  status: user.status || (user.isActive === false ? 'disabled' : 'enabled'),
  balance: Number(user.balance || 0),
  depositBalance: Number(user.depositBalance || 0),
  walletLimit: Number(user.walletLimit || 0),
  upiId: user.upiId || '',
  createdAt: user.createdAt || new Date().toISOString()
});

const getUserCollection = async () => {
  if (mongoUri && MongoClient) return (await getDatabase()).collection('users');
  return null;
};

const handleApi = async (request, response, pathname) => {
  if (request.method === 'GET' && pathname === '/api/health') {
    try { await getDatabase(); return json(response, 200, {ok: true, database: 'connected'}); }
    catch (error) { return json(response, 503, {ok: false, database: 'unavailable'}); }
  }
  if (request.method === 'GET' && pathname === '/api/user') {
    try {
      const userId = String(new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`).searchParams.get('userId') || '').trim();
      if (!userId) return json(response, 400, {error: 'User ID is required'});
      const user = await (await getDatabase()).collection('users').findOne({userId});
      return user ? json(response, 200, {user: publicProfile(user)}) : json(response, 404, {error: 'User not found'});
    } catch (error) { return json(response, 503, {error: 'Profile is temporarily unavailable.'}); }
  }
  if (request.method === 'POST' && pathname === '/api/login') {
    try {
      const payload = await readBody(request);
      const phone = String(payload.phone || '').replace(/\D/g, '');
      const password = String(payload.password || '');
      if (mongoUri && MongoClient) {
        const user = await (await getDatabase()).collection('users').findOne({phone});
        if (!user || user.isActive === false || !(await verifyPassword(password, user.passwordHash))) return json(response, 401, {error: user && user.isActive === false ? 'Invalid Account' : 'Invalid phone number or password.'});
        return json(response, 200, {user: publicProfile(user)});
      }
      const fallback = await seedFallbackData();
      const user = fallback.users.find(entry => String(entry.phone) === String(phone));
      if (!user || user.isActive === false || !(await verifyPassword(password, user.passwordHash))) return json(response, 401, {error: user && user.isActive === false ? 'Invalid Account' : 'Invalid phone number or password.'});
      return json(response, 200, {user: publicProfile(user)});
    } catch (error) { return json(response, 503, {error: 'Login service is temporarily unavailable.'}); }
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
      if (mongoUri && MongoClient) {
        const database = await getDatabase();
        const users = database.collection('users');
        const bankNumbers = Array.isArray(payload.banks) ? payload.banks.map(bank => String(bank.accountNumber || '')).filter(Boolean) : [];
        const upiIds = Array.isArray(payload.upis) ? payload.upis.map(upi => String(upi.upiId || '')).filter(Boolean) : [];
        const duplicateQuery = {$or: [{phone}, ...bankNumbers.map(accountNumber => ({bankAccount: accountNumber})), ...upiIds.map(upiId => ({upiId}))]};
        if (await users.findOne({phone})) return json(response, 409, {error: 'This number is already registered.'});
        if (await users.findOne(duplicateQuery)) return json(response, 409, {error: 'This number is already registered.'});
        if (payload.preflight) return json(response, 200, {ok: true});
        const userId = await nextUserId(database);
        const inviteCode = `SBI${userId}`;
        const ownerCode = String(payload.ownerCode || '');
        if (ownerCode && !(await users.findOne({inviteCode: ownerCode}, {projection: {_id: 1}}))) return json(response, 400, {error: 'Invalid invitation code.'});
        await users.insertOne({username, phone, passwordHash: await hashPassword(password), userId, inviteCode, ownerCode, bankAccount: bankNumbers[0] || '', upiId: upiIds[0] || '', isActive: true, createdAt: new Date()});
        return json(response, 201, {ok: true, userId, inviteCode, ownerCode});
      }
      const fallback = await seedFallbackData();
      const bankNumbers = Array.isArray(payload.banks) ? payload.banks.map(bank => String(bank.accountNumber || '')).filter(Boolean) : [];
      const upiIds = Array.isArray(payload.upis) ? payload.upis.map(upi => String(upi.upiId || '')).filter(Boolean) : [];
      const duplicate = fallback.users.some(entry => entry.phone === phone || bankNumbers.includes(String(entry.bankAccount || '')) || upiIds.includes(String(entry.upiId || '')));
      if (duplicate) return json(response, 409, {error: 'This number is already registered.'});
      if (payload.preflight) return json(response, 200, {ok: true});
      const userId = String(Math.max(20030000, ...fallback.users.map(user => Number(user.userId) || 20030000)) + 1);
      const inviteCode = `SBI${userId}`;
      const ownerCode = String(payload.ownerCode || '');
      if (ownerCode && !fallback.users.some(user => user.inviteCode === ownerCode)) return json(response, 400, {error: 'Invalid invitation code.'});
      fallback.users.push({username, phone, passwordHash: await hashPassword(password), userId, inviteCode, ownerCode, bankAccount: bankNumbers[0] || '', upiId: upiIds[0] || '', isActive: true, balance: 0, depositBalance: 0, walletLimit: 0, createdAt: new Date().toISOString()});
      fs.writeFileSync(fallbackDataPath, JSON.stringify(fallback, null, 2));
      return json(response, 201, {ok: true, userId, inviteCode, ownerCode});
    } catch (error) { return json(response, 503, {error: 'Registration storage is temporarily unavailable.'}); }
  }

  if (request.method === 'GET' && pathname === '/api/admin/users') {
    try {
      if (mongoUri && MongoClient) {
        const users = await (await getDatabase()).collection('users').find({}).sort({createdAt: -1}).toArray();
        return json(response, 200, {items: users.map(normalizeUserForAdmin)});
      }
      const fallback = await seedFallbackData();
      return json(response, 200, {items: fallback.users.map(normalizeUserForAdmin)});
    } catch (error) {
      return json(response, 503, {error: 'Admin user data is temporarily unavailable.'});
    }
  }

  if (request.method === 'PATCH' && pathname.startsWith('/api/admin/users/')) {
    try {
      const userId = pathname.split('/').pop();
      const payload = await readBody(request);
      if (mongoUri && MongoClient) {
        const update = {};
        if (typeof payload.enabled === 'boolean') update.isActive = payload.enabled;
        if (typeof payload.limit === 'number') update.walletLimit = payload.limit;
        if (typeof payload.limit === 'string' && payload.limit.trim() !== '') update.walletLimit = Number(payload.limit);
        if (typeof payload.password === 'string' && payload.password.trim()) update.passwordHash = await hashPassword(payload.password);
        if (Object.keys(update).length === 0) return json(response, 400, {error: 'No valid admin update provided'});
        const result = await (await getDatabase()).collection('users').updateOne({userId}, {$set: update});
        return json(response, result.modifiedCount ? 200 : 404, {ok: result.modifiedCount > 0, userId});
      }
      const fallback = await seedFallbackData();
      const index = fallback.users.findIndex(user => String(user.userId) === String(userId));
      if (index === -1) return json(response, 404, {error: 'User not found'});
      if (typeof payload.enabled === 'boolean') fallback.users[index].isActive = payload.enabled;
      if (typeof payload.limit === 'number') fallback.users[index].walletLimit = payload.limit;
      if (typeof payload.limit === 'string' && payload.limit.trim() !== '') fallback.users[index].walletLimit = Number(payload.limit);
      if (typeof payload.password === 'string' && payload.password.trim()) fallback.users[index].passwordHash = await hashPassword(payload.password);
      if (typeof payload.status === 'string') { fallback.users[index].status = payload.status; fallback.users[index].isActive = payload.status !== 'disabled'; }
      fs.writeFileSync(fallbackDataPath, JSON.stringify(fallback, null, 2));
      return json(response, 200, {ok: true, userId});
    } catch (error) {
      return json(response, 503, {error: 'Admin update failed.'});
    }
  }

  if (request.method === 'GET' && pathname === '/api/admin/upi') {
    try {
      if (mongoUri && MongoClient) {
        const items = await (await getDatabase()).collection('users').find({}).project({upiId: 1, userId: 1, username: 1, phone: 1, upiEnabled: 1, riskStatus: 1, minLimit: 1, maxLimit: 1}).toArray();
        return json(response, 200, {items: items.map(item => ({id: item.upiId || item.userId, upiId: item.upiId || '', ownerUserId: item.userId || '', ownerName: item.username || '', app: item.upiId?.includes('@') ? item.upiId.split('@')[1] : 'UPI', enabled: item.upiEnabled !== false, risk: item.riskStatus === 'risk', min: Number(item.minLimit || 0), max: Number(item.maxLimit || 0)}))});
      }
      const fallback = await seedFallbackData();
      return json(response, 200, {items: fallback.upi});
    } catch (error) {
      return json(response, 503, {error: 'UPI data is temporarily unavailable.'});
    }
  }

  if (request.method === 'PATCH' && pathname.startsWith('/api/admin/upi/')) {
    try {
      const recordId = pathname.split('/').pop();
      const payload = await readBody(request);
      if (mongoUri && MongoClient) {
        const update = {};
        if (typeof payload.enabled === 'boolean') update.upiEnabled = payload.enabled;
        if (typeof payload.risk === 'boolean') update.riskStatus = payload.risk ? 'risk' : 'unrisk';
        if (typeof payload.min === 'number') update.minLimit = payload.min;
        if (typeof payload.max === 'number') update.maxLimit = payload.max;
        const result = await (await getDatabase()).collection('users').updateOne({upiId: recordId}, {$set: update});
        return json(response, result.modifiedCount ? 200 : 404, {ok: result.modifiedCount > 0, id: recordId});
      }
      const fallback = await seedFallbackData();
      const index = fallback.upi.findIndex(item => String(item.id) === String(recordId));
      if (index === -1) return json(response, 404, {error: 'UPI record not found'});
      if (typeof payload.enabled === 'boolean') fallback.upi[index].enabled = payload.enabled;
      if (typeof payload.risk === 'boolean') fallback.upi[index].risk = payload.risk;
      if (typeof payload.min === 'number') fallback.upi[index].min = payload.min;
      if (typeof payload.max === 'number') fallback.upi[index].max = payload.max;
      fs.writeFileSync(fallbackDataPath, JSON.stringify(fallback, null, 2));
      return json(response, 200, {ok: true, id: recordId});
    } catch (error) {
      return json(response, 503, {error: 'UPI update failed.'});
    }
  }

  if (request.method === 'GET' && pathname === '/api/admin/payments') {
    try {
      if (mongoUri && MongoClient) {
        const items = await (await getDatabase()).collection('payments').find({}).sort({createdAt: -1}).toArray();
        return json(response, 200, {items: items});
      }
      const fallback = await seedFallbackData();
      return json(response, 200, {items: fallback.payments});
    } catch (error) {
      return json(response, 503, {error: 'Payment records are temporarily unavailable.'});
    }
  }

  if (request.method === 'GET' && pathname === '/api/admin/summary') {
    try {
      if (mongoUri && MongoClient) {
        const users = await (await getDatabase()).collection('users').countDocuments({});
        const active = await (await getDatabase()).collection('users').countDocuments({isActive: {$ne: false}});
        const payments = await (await getDatabase()).collection('payments').countDocuments({});
        return json(response, 200, {users, active, payments});
      }
      const fallback = await seedFallbackData();
      return json(response, 200, {users: fallback.users.length, active: fallback.users.filter(user => user.isActive !== false).length, payments: fallback.payments.length});
    } catch (error) {
      return json(response, 503, {error: 'Admin summary is temporarily unavailable.'});
    }
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
